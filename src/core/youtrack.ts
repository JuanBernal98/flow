/**
 * YouTrack client behind the workspace Tasks section.
 *
 * The instance is the repository's `[youtrack] url` (see `repoIntegrations`), but a repository
 * never decides where a token goes: each token is bound to its server. On macOS it is the Keychain
 * item `flow-youtrack:<host>`; elsewhere `FLOW_YOUTRACK_TOKEN` counts only for the host in
 * `FLOW_YOUTRACK_URL`. A repository pointing at any other server finds no token, so nothing is sent.
 * Requests never follow redirects, and the token is never logged, persisted, or echoed in errors.
 */
import { z } from "zod";

// Keychain items are `flow-youtrack:<host>`, one per server.
const KEYCHAIN_SERVICE_PREFIX = "flow-youtrack";
// All my open tickets in one request; the workspace splits off the ones in Review by State.
const ASSIGNED_TASKS_QUERY = "for: me #Unresolved sort by: updated desc";
const ISSUE_FIELDS = "idReadable,summary,customFields(name,value(name))";
const MAX_TASKS = 50;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** One assigned YouTrack issue as the workspace shows it. */
export interface YouTrackTask {
  id: string;
  summary: string;
  state?: string;
  url: string;
}

/** Outcome of one Tasks load; every failure is a value so the UI never has to catch. */
export type WorkspaceTasksResult =
  | { kind: "ready"; tasks: YouTrackTask[] }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

type FetchImpl = (input: URL, init?: RequestInit) => Promise<Response>;

export interface YouTrackDeps {
  /** The repository's YouTrack instance. */
  url?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Read the Keychain token stored for one host. */
  readKeychainToken?: (host: string) => string | undefined;
  fetchImpl?: FetchImpl;
  fetchTimeoutMs?: number;
}

interface YouTrackConnection {
  baseUrl: URL;
  token: string;
}

const IssuesSchema = z.array(
  z.object({
    idReadable: z.string(),
    summary: z.string().nullable(),
    customFields: z.array(z.object({ name: z.string(), value: z.unknown() })).default([]),
  }),
);

const NamedValueSchema = z.object({ name: z.string() });

const CurrentUserSchema = z.object({ login: z.string() });

const IssueAssignmentSchema = z.object({
  customFields: z.array(z.object({ name: z.string(), value: z.unknown() })).default([]),
});

const AssigneeSchema = z.object({ login: z.string() });

/** The Keychain service that holds the token for one YouTrack host. */
export function youTrackKeychainService(host: string) {
  return `${KEYCHAIN_SERVICE_PREFIX}:${host}`;
}

/** Read one Keychain item's secret without ever routing it through argv or stdout logs. */
function readKeychainItem(service: string) {
  const proc = Bun.spawnSync(["security", "find-generic-password", "-s", service, "-w"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (proc.exitCode !== 0) {
    return undefined;
  }
  const token = proc.stdout.toString().trim();
  return token.length > 0 ? token : undefined;
}

/** The Keychain token stored for one host. */
function readKeychainToken(host: string) {
  return readKeychainItem(youTrackKeychainService(host));
}

/** The token for one server, or undefined when none is stored for that server. */
function tokenForHost(
  host: string,
  {
    env = process.env,
    platform = process.platform,
    readKeychainToken: readToken = readKeychainToken,
  }: Pick<YouTrackDeps, "env" | "platform" | "readKeychainToken">,
) {
  const envToken = env.FLOW_YOUTRACK_TOKEN?.trim();
  const envHost = parseInstanceUrl(env.FLOW_YOUTRACK_URL?.trim() ?? "")?.host;
  if (envToken && envHost === host) {
    return envToken;
  }
  return platform === "darwin" ? readToken(host) : undefined;
}

/** Accept https, plus plain http only for loopback so a token never crosses the network in clear. */
function parseInstanceUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.endsWith("/") ? raw : `${raw}/`);
  } catch {
    return undefined;
  }
  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  return secure || loopback ? url : undefined;
}

/** Link to one issue on an instance. */
function issueUrl(baseUrl: URL, ticketId: string) {
  return new URL(`issue/${encodeURIComponent(ticketId)}`, baseUrl).href;
}

/** Link to a ticket on a YouTrack instance, or undefined when the instance URL is not usable. */
export function youTrackIssueUrl(instanceUrl: string, ticketId: string) {
  const baseUrl = parseInstanceUrl(instanceUrl.trim());
  return baseUrl ? issueUrl(baseUrl, ticketId) : undefined;
}

/** Resolve where to talk to and with which token, or explain what is missing. */
function resolveConnection({
  url,
  env = process.env,
  platform = process.platform,
  readKeychainToken: readToken = readKeychainToken,
}: YouTrackDeps): YouTrackConnection | { kind: "unconfigured"; message: string } {
  const rawUrl = url?.trim();
  if (!rawUrl) {
    return { kind: "unconfigured", message: "Set [youtrack] url in .flow/config.toml" };
  }
  const baseUrl = parseInstanceUrl(rawUrl);
  if (!baseUrl) {
    return { kind: "unconfigured", message: "YouTrack URL needs https" };
  }

  const token = tokenForHost(baseUrl.host, { env, platform, readKeychainToken: readToken });
  if (!token) {
    return {
      kind: "unconfigured",
      message: `No YouTrack token for ${baseUrl.host}; run \`flow setup\``,
    };
  }

  return { baseUrl, token };
}

/**
 * The token stored for one instance, for handing to Claude's YouTrack MCP during setup. Callers
 * must never print it.
 */
export function readYouTrackToken(
  instanceUrl: string,
  deps: Pick<YouTrackDeps, "env" | "platform" | "readKeychainToken"> = {},
) {
  const host = parseInstanceUrl(instanceUrl.trim())?.host;
  return host ? tokenForHost(host, deps) : undefined;
}

/** Whether a token is stored for one instance, without ever returning or printing it. */
export function hasYouTrackToken(
  instanceUrl: string,
  deps: Pick<YouTrackDeps, "env" | "platform" | "readKeychainToken"> = {},
) {
  return Boolean(readYouTrackToken(instanceUrl, deps));
}

/** Pull the display name of a single-value custom field such as State. */
function customFieldName(fields: { name: string; value: unknown }[], fieldName: string) {
  const parsed = NamedValueSchema.safeParse(
    fields.find((field) => field.name === fieldName)?.value,
  );
  return parsed.success ? parsed.data.name : undefined;
}

const YouTrackErrorSchema = z.object({ error_description: z.string().min(1) });

/**
 * Map an HTTP failure to a message that is useful without leaking request details. YouTrack's own
 * `error_description` (such as why a command was rejected) is kept; the token never appears in it.
 */
function describeHttpFailure(status: number, body: unknown) {
  if (status === 401 || status === 403) {
    return "YouTrack rejected the token";
  }
  const error = YouTrackErrorSchema.safeParse(body);
  return error.success
    ? `YouTrack responded ${status}: ${error.data.error_description}`
    : `YouTrack responded ${status}`;
}

/** Fetch one API path with the token and a timeout; any failure is a message, never a throw. */
async function requestYouTrack(
  connection: YouTrackConnection,
  deps: YouTrackDeps,
  url: URL,
  init: { method?: string; body?: string } = {},
): Promise<{ ok: true; json: unknown } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
  );
  timer.unref?.();
  try {
    const response = await (deps.fetchImpl ?? fetch)(url, {
      method: init.method,
      body: init.body,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      // A redirect could carry the token to another server, so none is ever followed.
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        message: `YouTrack redirected the request (${response.status}); flow does not follow redirects with your token`,
      };
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      return { ok: false, message: describeHttpFailure(response.status, body) };
    }
    return { ok: true, json: await response.json() };
  } catch {
    return {
      ok: false,
      message: controller.signal.aborted ? "YouTrack timed out" : "YouTrack is unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}

const MyIssuesSchema = z.array(z.object({ idReadable: z.string() }));

const CommandAssistSchema = z.object({
  commands: z.array(z.object({ error: z.boolean() })).default([]),
});

/** Whether the instance answers with the token, and as whom; for `flow init`. */
export async function checkYouTrackAccess(
  deps: YouTrackDeps,
): Promise<{ ok: true; login: string } | { ok: false; message: string }> {
  const connection = resolveConnection(deps);
  if ("kind" in connection) {
    return { ok: false, message: connection.message };
  }
  const url = new URL("api/users/me", connection.baseUrl);
  url.searchParams.set("fields", "login");
  const response = await requestYouTrack(connection, deps, url);
  if (!response.ok) {
    return response;
  }
  const me = CurrentUserSchema.safeParse(response.json);
  return me.success
    ? { ok: true, login: me.data.login }
    : { ok: false, message: "Unexpected YouTrack response" };
}

/**
 * Whether `state` is a State value tickets can move to, checked by parsing `State <state>` on one of
 * my tickets without applying it. Undefined when that cannot be told, such as with no tickets.
 */
export async function isYouTrackState(state: string, deps: YouTrackDeps) {
  const connection = resolveConnection(deps);
  if ("kind" in connection) {
    return undefined;
  }
  const issuesUrl = new URL("api/issues", connection.baseUrl);
  issuesUrl.searchParams.set("query", "for: me");
  issuesUrl.searchParams.set("fields", "idReadable");
  issuesUrl.searchParams.set("$top", "1");
  const issues = await requestYouTrack(connection, deps, issuesUrl);
  const issue = issues.ok ? MyIssuesSchema.safeParse(issues.json) : undefined;
  const ticketId = issue?.success ? issue.data[0]?.idReadable : undefined;
  if (!ticketId) {
    return undefined;
  }
  const query = `State ${state}`;
  const assist = await requestYouTrack(
    connection,
    deps,
    new URL("api/commands/assist?fields=commands(error)", connection.baseUrl),
    {
      method: "POST",
      body: JSON.stringify({ query, caret: query.length, issues: [{ idReadable: ticketId }] }),
    },
  );
  const parsed = assist.ok ? CommandAssistSchema.safeParse(assist.json) : undefined;
  if (!parsed?.success || parsed.data.commands.length === 0) {
    return undefined;
  }
  return parsed.data.commands.every((command) => !command.error);
}

/**
 * Whether a project key exists on the instance, for `flow init`: YouTrack rejects a search on an
 * unknown project. Undefined when that cannot be told.
 */
export async function isYouTrackProject(projectKey: string, deps: YouTrackDeps) {
  const connection = resolveConnection(deps);
  if ("kind" in connection) {
    return undefined;
  }
  const url = new URL("api/issues", connection.baseUrl);
  url.searchParams.set("query", `project: {${projectKey}}`);
  url.searchParams.set("fields", "idReadable");
  url.searchParams.set("$top", "1");
  const response = await requestYouTrack(connection, deps, url);
  if (response.ok) {
    return true;
  }
  return response.message.startsWith("YouTrack responded 400") ? false : undefined;
}

/** What happened when flow tried to close a ticket whose MR was merged. */
export type MergedTicketResult =
  | { kind: "moved"; state: string }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; message: string };

/**
 * Move a ticket whose MR was merged from Review to `targetState`. It is read again right before,
 * and only moved while it is still assigned to the token owner and still in Review, so a ticket
 * someone reassigned or moved since the last load is never touched.
 */
export async function moveMergedTicket(
  ticketId: string,
  targetState: string,
  deps: YouTrackDeps = {},
  reviewState = "Review",
): Promise<MergedTicketResult> {
  const connection = resolveConnection(deps);
  if ("kind" in connection) {
    return { kind: "error", message: connection.message };
  }

  const meUrl = new URL("api/users/me", connection.baseUrl);
  meUrl.searchParams.set("fields", "login");
  const issueApiUrl = new URL(`api/issues/${encodeURIComponent(ticketId)}`, connection.baseUrl);
  issueApiUrl.searchParams.set("fields", "customFields(name,value(name,login))");
  const [me, issue] = await Promise.all([
    requestYouTrack(connection, deps, meUrl),
    requestYouTrack(connection, deps, issueApiUrl),
  ]);
  if (!me.ok) return { kind: "error", message: me.message };
  if (!issue.ok) return { kind: "error", message: issue.message };
  const login = CurrentUserSchema.safeParse(me.json);
  const fields = IssueAssignmentSchema.safeParse(issue.json);
  if (!login.success || !fields.success) {
    return { kind: "error", message: "Unexpected YouTrack response" };
  }

  const assignee = AssigneeSchema.safeParse(
    fields.data.customFields.find((field) => field.name === "Assignee")?.value,
  );
  if (!assignee.success || assignee.data.login !== login.data.login) {
    return { kind: "skipped", reason: "not assigned to you" };
  }
  // The workspace only ever moves a ticket out of the review state, and only while it is still mine.
  if (
    customFieldName(fields.data.customFields, "State")?.toLowerCase() !== reviewState.toLowerCase()
  ) {
    return { kind: "skipped", reason: "no longer in Review" };
  }

  // A command sets the state whether State is a plain enum or a workflow state machine. The value
  // goes in bare, spaces included (`State Concept Done`): YouTrack rejects `State {Done}`.
  const moved = await requestYouTrack(
    connection,
    deps,
    new URL("api/commands", connection.baseUrl),
    {
      method: "POST",
      body: JSON.stringify({ query: `State ${targetState}`, issues: [{ idReadable: ticketId }] }),
    },
  );
  return moved.ok
    ? { kind: "moved", state: targetState }
    : { kind: "error", message: moved.message };
}

/** Load the unresolved issues assigned to the token owner, including those in review. */
export async function loadYouTrackTasks(deps: YouTrackDeps = {}): Promise<WorkspaceTasksResult> {
  const connection = resolveConnection(deps);
  if ("kind" in connection) {
    return connection;
  }

  const url = new URL("api/issues", connection.baseUrl);
  url.searchParams.set("query", ASSIGNED_TASKS_QUERY);
  url.searchParams.set("fields", ISSUE_FIELDS);
  url.searchParams.set("$top", String(MAX_TASKS));

  const response = await requestYouTrack(connection, deps, url);
  if (!response.ok) {
    return { kind: "error", message: response.message };
  }
  const parsed = IssuesSchema.safeParse(response.json);
  if (!parsed.success) {
    return { kind: "error", message: "Unexpected YouTrack response" };
  }
  return {
    kind: "ready",
    tasks: parsed.data.map((issue) => ({
      id: issue.idReadable,
      summary: issue.summary ?? "",
      state: customFieldName(issue.customFields, "State"),
      url: issueUrl(connection.baseUrl, issue.idReadable),
    })),
  };
}
