/**
 * Dependency checks for `flow setup`: everything flow and its agent skills need on this
 * machine, all of it required. A failed check carries a remedy: a command setup may run once the
 * user agrees, or steps the user takes elsewhere. Every probe is injectable so tests never spawn
 * tools.
 */
import { userInfo } from "node:os";
import { readUserDefaults } from "./userDefaults";
import { hasLegacyYouTrackToken, hasYouTrackToken } from "./youtrack";

/** How to fix a failed check. Setup never runs anything without asking first. */
export type SetupRemedy =
  /** A command setup can run in the user's terminal, after showing it and asking. */
  | { kind: "run"; command: string[] }
  /**
   * Create and store the YouTrack token for the user's instance: setup offers to open the token
   * page, then stores it in the Keychain under that server (`keychainAccount`, through the hidden
   * prompt) after asking. Without a Keychain the user exports it by hand.
   */
  | { kind: "youtrack-token"; keychainAccount?: string }
  /** Bind a token stored before tokens had a server to the user's instance, after asking. */
  | { kind: "youtrack-token-migrate" }
  /** Connect Claude's YouTrack MCP from the remembered URL and the stored token. */
  | { kind: "youtrack-mcp" }
  /** Something only the user can do elsewhere; setup waits and checks again. */
  | { kind: "manual"; steps: string };

export interface SetupCheck {
  status: "ok" | "fail";
  name: string;
  /** What it is needed for and what is wrong, when it failed. */
  detail?: string;
  remedy?: SetupRemedy;
}

export interface SetupCheckDeps {
  /** Path of a command on PATH, or null. */
  which: (command: string) => string | null;
  /** Run a command; only its exit code and stdout matter. */
  run: (args: string[]) => Promise<{ exitCode: number; stdout: string }>;
  /** The token for the remembered instance: stored, only in the old server-less item, or missing. */
  youTrackToken: () => "ok" | "legacy" | "missing";
  platform: NodeJS.Platform;
  /** The account name the Keychain item is stored under. */
  username: string;
}

/** Claude connectors the skills call, matched against `claude mcp list` lines. */
const CONNECTORS = [
  {
    name: "YouTrack MCP",
    pattern: /youtrack/i,
    usedBy:
      "flow-ticket-switch, flow-ticket-context, flow-review, and flow-mr-open read tickets with it",
    remedy: { kind: "youtrack-mcp" },
  },
  {
    name: "Notion connector",
    pattern: /notion/i,
    usedBy: "flow-ticket-context reads linked Notion pages with it",
    remedy: {
      kind: "manual",
      steps: "In Claude Code, run /mcp, pick Notion, and authorize it in the browser.",
    },
  },
  {
    name: "Slack connector",
    pattern: /slack/i,
    usedBy: "flow-mr-open posts the review request with it",
    remedy: {
      kind: "manual",
      steps: "In Claude Code, run /mcp, pick Slack, and authorize it in the browser.",
    },
  },
] as const satisfies { name: string; pattern: RegExp; usedBy: string; remedy: SetupRemedy }[];

/** Default probes against the real machine. */
export function createSetupCheckDeps(): SetupCheckDeps {
  return {
    which: (command) => Bun.which(command),
    run: async (args) => {
      try {
        const proc = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const [stdout, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          proc.exited,
        ]);
        return { exitCode, stdout };
      } catch {
        return { exitCode: 1, stdout: "" };
      }
    },
    youTrackToken: () => {
      const url = readUserDefaults().youtrackUrl;
      if (url && hasYouTrackToken(url)) return "ok";
      return hasLegacyYouTrackToken() ? "legacy" : "missing";
    },
    platform: process.platform,
    username: userInfo().username,
  };
}

/** Check one connector's line in `claude mcp list`. */
function checkConnector(connector: (typeof CONNECTORS)[number], mcpList: string): SetupCheck {
  const line = mcpList.split("\n").find((candidate) => connector.pattern.test(candidate));
  if (line && /connected/i.test(line) && !/needs auth|failed/i.test(line)) {
    return { status: "ok", name: connector.name };
  }
  return {
    status: "fail",
    name: connector.name,
    detail: `${line ? "not connected" : "not set up"}: ${connector.usedBy}`,
    remedy: connector.remedy,
  };
}

/** Run every check, in the order fixes depend on each other. The slow `claude mcp list` runs once. */
export async function runSetupChecks(deps: SetupCheckDeps): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];

  checks.push(
    deps.which("bun")
      ? { status: "ok", name: "bun" }
      : {
          status: "fail",
          name: "bun",
          detail: "flow runs on bun",
          remedy: {
            kind: "manual",
            steps: "Install bun from https://bun.sh, then open a new terminal.",
          },
        },
  );

  if (!deps.which("glab")) {
    checks.push({
      status: "fail",
      name: "glab",
      detail: "not installed: flow reads MRs and Reviews with it",
      remedy:
        deps.platform === "darwin" && deps.which("brew")
          ? { kind: "run", command: ["brew", "install", "glab"] }
          : {
              kind: "manual",
              steps: "Install glab: https://gitlab.com/gitlab-org/cli#installation",
            },
    });
  } else {
    const auth = await deps.run(["glab", "auth", "status"]);
    checks.push(
      auth.exitCode === 0
        ? { status: "ok", name: "glab" }
        : {
            status: "fail",
            name: "glab",
            detail:
              "cannot reach your GitLab: log in, or, if your GitLab sits behind an access proxy (such as Cloudflare Access), set that up first following your company's guide",
            remedy: { kind: "run", command: ["glab", "auth", "login"] },
          },
    );
  }

  const token = deps.youTrackToken();
  checks.push(
    token === "ok"
      ? { status: "ok", name: "YouTrack token" }
      : token === "legacy"
        ? {
            status: "fail",
            name: "YouTrack token",
            detail: "stored for any server; flow now binds each token to its YouTrack",
            remedy: { kind: "youtrack-token-migrate" },
          }
        : {
            status: "fail",
            name: "YouTrack token",
            detail:
              "missing: create a permanent token in YouTrack (profile → Account Security → Tokens)",
            remedy: {
              kind: "youtrack-token",
              keychainAccount: deps.platform === "darwin" ? deps.username : undefined,
            },
          },
  );

  if (!deps.which("claude")) {
    checks.push({
      status: "fail",
      name: "Claude Code",
      detail:
        "`claude` is not on PATH, so the YouTrack, Notion, and Slack connectors cannot be checked",
      remedy: {
        kind: "manual",
        steps: "Install Claude Code from https://claude.com/claude-code, then open a new terminal.",
      },
    });
    return checks;
  }
  const mcp = await deps.run(["claude", "mcp", "list"]);
  for (const connector of CONNECTORS) {
    checks.push(checkConnector(connector, mcp.stdout));
  }
  return checks;
}
