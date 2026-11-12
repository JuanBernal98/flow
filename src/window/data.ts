/**
 * What the window shows, loaded with the same core functions the terminal UI uses: the workspace
 * (tickets and reviews), the checked-out branch's diff against its base, and ticket overviews.
 */
import {
  createGlabRun,
  linkTicketMergeRequests,
  loadMyMergeRequests,
  loadSquadReviews,
} from "../core/gitlab";
import { resolveConfiguredCliInput } from "../core/config";
import {
  computeAnchorForFile,
  mutateCommentsFile,
  readCommentsFile,
  withAddedComment,
  withRemovedComment,
  type PersistedComment,
} from "../core/comments";
import { readRepoIntegrations } from "../core/repoIntegrations";
import { readTicketOverview } from "../core/ticketOverview";
import { loadYouTrackTasks, youTrackIssueUrl } from "../core/youtrack";
import {
  buildWorkspaceItems,
  itemOwnsBranch,
  moveApprovedToReadyToMerge,
  type WorkspaceItem,
} from "../ui/lib/workspace";

export interface WindowWorkspace {
  items: WorkspaceItem[];
  branch: string | null;
  checkedOutId: string | null;
  notice?: string;
}

/** A terminal theme's colors, as the window paints them. */
export interface WindowTheme {
  id: string;
  label: string;
  appearance: "light" | "dark";
  codeTheme: string;
  colors: {
    background: string;
    panel: string;
    panelAlt: string;
    border: string;
    accent: string;
    accentMuted: string;
    text: string;
    muted: string;
    faint: string;
    added: string;
    removed: string;
    /** A changed row's tint, and the stronger one for the words that changed in it. */
    addedRow: string;
    removedRow: string;
    addedWord: string;
    removedWord: string;
  };
}

export interface WindowThemes {
  themes: WindowTheme[];
  /** The configured theme id; `claude` follows the system appearance. */
  configured: string;
}

export interface WindowDiffFile {
  path: string;
  patch: string;
  status: "added" | "deleted" | "renamed" | "modified";
  additions: number;
  deletions: number;
}

/** Run git in the repository and return stdout, or "" when it fails. */
function git(repoRoot: string, args: string[], okExitCodes: readonly number[] = [0]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "ignore",
  });
  return okExitCodes.includes(result.exitCode) ? result.stdout.toString() : "";
}

/** The workspace sections, with each ticket linked to its merge request. */
export async function loadWindowWorkspace(repoRoot: string): Promise<WindowWorkspace> {
  const integrations = readRepoIntegrations(repoRoot);
  const branch = git(repoRoot, ["branch", "--show-current"]).trim() || null;
  const youtrackUrl = integrations.youtrackUrl;
  const glab = integrations.gitlab ? createGlabRun(repoRoot) : undefined;
  const [tasks, reviews, mergeRequests] = await Promise.all([
    youtrackUrl
      ? loadYouTrackTasks({ url: youtrackUrl })
      : Promise.resolve({
          kind: "unconfigured" as const,
          message: "No YouTrack in .flow/config.toml",
        }),
    glab
      ? loadSquadReviews(glab, { label: integrations.reviewLabel })
      : Promise.resolve({
          kind: "unconfigured" as const,
          message: "No GitLab in .flow/config.toml",
        }),
    glab ? loadMyMergeRequests(glab) : Promise.resolve([]),
  ]);
  const items = buildWorkspaceItems(
    tasks,
    reviews,
    youtrackUrl ? (ticketId) => youTrackIssueUrl(youtrackUrl, ticketId) : undefined,
    integrations.projectKeys,
    integrations.workflow,
  );
  const links = linkTicketMergeRequests(
    mergeRequests,
    items.flatMap((item) => (item.ticketId ? [item.ticketId] : [])),
    branch ?? undefined,
  );
  const withMergeRequests = items.map((item) => {
    const mr = item.ticketId ? links.get(item.ticketId) : undefined;
    return mr && !item.mergeRequestUrl
      ? {
          ...item,
          mergeRequestUrl: mr.url,
          mergeRequestIid: mr.iid,
          branch: item.branch ?? mr.sourceBranch,
        }
      : item;
  });
  const linked = moveApprovedToReadyToMerge(withMergeRequests, (item) =>
    Boolean(item.ticketId && links.get(item.ticketId)?.approved),
  );
  const checkedOut = branch ? linked.find((item) => itemOwnsBranch(item, branch)) : undefined;
  const notice =
    integrations.error ??
    (tasks.kind === "error"
      ? tasks.message
      : reviews.kind === "error"
        ? reviews.message
        : undefined);
  return {
    items: linked,
    branch,
    checkedOutId: checkedOut?.id ?? null,
    ...(notice ? { notice } : {}),
  };
}

/** Everything on the branch since it left its base, committed or not, one patch per file. */
export function loadWindowDiff(repoRoot: string): WindowDiffFile[] {
  const base = readRepoIntegrations(repoRoot).workflow.baseBranch;
  // The remote base when there is one, else the local branch (a repository without a remote).
  const mergeBase =
    git(repoRoot, ["merge-base", `origin/${base}`, "HEAD"]).trim() ||
    git(repoRoot, ["merge-base", base, "HEAD"]).trim();
  const tracked = git(repoRoot, ["diff", "--no-color", "--no-ext-diff", mergeBase || "HEAD"]);
  // Like `flow diff`, new files count before they are added.
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .map((path) =>
      git(repoRoot, ["diff", "--no-color", "--no-index", "--", "/dev/null", path], [0, 1]),
    )
    .join("");
  return `${tracked}${untracked}`
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "))
    .map((chunk) => {
      const path =
        /^\+\+\+ b\/(.+)$/m.exec(chunk)?.[1] ?? /^--- a\/(.+)$/m.exec(chunk)?.[1] ?? "file";
      const lines = chunk.split("\n");
      const status = /^new file mode/m.test(chunk)
        ? "added"
        : /^deleted file mode/m.test(chunk)
          ? "deleted"
          : /^rename from/m.test(chunk)
            ? "renamed"
            : "modified";
      return {
        path,
        patch: chunk,
        status,
        additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
        deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
      };
    });
}

/** A ticket's overview as the agent wrote it, or null when there is none. */
export function loadWindowOverview(repoRoot: string, ticketId: string) {
  return readTicketOverview(repoRoot, ticketId);
}

/** The terminal's themes and the one the user and repository configs pick, layered the same way. */
export async function loadWindowThemes(repoRoot: string): Promise<WindowThemes> {
  const [{ THEMES }, { codeThemeName }] = await Promise.all([
    import("../ui/themes"),
    import("../ui/diff/pierre"),
  ]);
  const configured = resolveConfiguredCliInput(
    { kind: "vcs", staged: false, options: {} },
    { cwd: repoRoot },
  ).input.options.theme;
  return {
    configured: configured ?? "zed",
    themes: THEMES.map((theme) => ({
      id: theme.id,
      label: theme.label,
      appearance: theme.appearance,
      codeTheme: codeThemeName(theme),
      colors: {
        background: theme.background,
        panel: theme.panel,
        panelAlt: theme.panelAlt,
        border: theme.border,
        accent: theme.accent,
        accentMuted: theme.accentMuted,
        text: theme.text,
        muted: theme.muted,
        faint: theme.lineNumberFg,
        added: theme.addedSignColor,
        removed: theme.removedSignColor,
        addedRow: theme.addedBg,
        removedRow: theme.removedBg,
        addedWord: theme.addedContentBg,
        removedWord: theme.removedContentBg,
      },
    })),
  };
}

/** The review comments in `.flow/comments.json`, as the terminal UI and the agent read them. */
export function loadWindowComments(repoRoot: string): PersistedComment[] {
  return readCommentsFile(repoRoot).comments;
}

/**
 * Add the user's comment on a hunk, like `a` in the terminal: it sits on the hunk's last new-side
 * line, anchored to that line's text so it can follow the code as it moves.
 */
export function addWindowComment(
  repoRoot: string,
  draft: { file: string; range: [number, number]; body: string },
): PersistedComment {
  const body = draft.body.trim();
  if (!body) {
    throw new Error("A comment needs some text.");
  }
  const line = draft.range[1];
  const anchor = computeAnchorForFile(repoRoot, draft.file, line);
  if (!anchor) {
    throw new Error(`${draft.file} has no line ${line} to comment on.`);
  }
  let added: PersistedComment | undefined;
  mutateCommentsFile(repoRoot, (current) => {
    const next = withAddedComment(current, {
      file: draft.file,
      line,
      range: draft.range,
      anchor,
      body,
      author: "user",
    });
    added = next.comment;
    return next.file;
  });
  if (!added) {
    throw new Error("The comment was not saved.");
  }
  return added;
}

/** Remove one comment, like resolving it in the terminal. */
export function removeWindowComment(repoRoot: string, id: number) {
  mutateCommentsFile(repoRoot, (current) => withRemovedComment(current, id));
}
