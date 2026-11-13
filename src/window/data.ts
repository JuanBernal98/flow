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
import { parsePatchFiles } from "@pierre/diffs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTwoFilesPatch } from "diff";
import {
  computeAnchorForFile,
  mutateCommentsFile,
  readCommentsFile,
  readPostImagesForComments,
  resolveComments,
  withAddedComment,
  withCommentReply,
  withCommentRead,
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
  /** Ticket panels are available only when this repository configures YouTrack. */
  ticketsEnabled: boolean;
  items: WorkspaceItem[];
  branch: string | null;
  checkedOutId: string | null;
  notice?: string;
}

/** Resolve local pane visibility and the checked-out branch without waiting for remote services. */
export async function loadWindowLocalWorkspace(repoRoot: string): Promise<WindowWorkspace> {
  return {
    ticketsEnabled: Boolean(readRepoIntegrations(repoRoot).youtrackUrl),
    items: [],
    branch: (await git(repoRoot, ["branch", "--show-current"])).trim() || null,
    checkedOutId: null,
  };
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
    modified: string;
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
  /** New working-tree files remain distinct from additions already tracked by Git. */
  untracked?: boolean;
  /** Only pending files can enter a new commit proposal, even in a whole-branch review. */
  pending?: boolean;
  status: "added" | "deleted" | "renamed" | "modified";
  additions: number;
  deletions: number;
}

/** Run git in the repository and return stdout, or "" when it fails. */
async function git(repoRoot: string, args: string[], okExitCodes: readonly number[] = [0]) {
  const result = Bun.spawn(["git", ...args], {
    cwd: repoRoot,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [output, exitCode] = await Promise.all([new Response(result.stdout).text(), result.exited]);
  return okExitCodes.includes(exitCode) ? output : "";
}

/** The workspace sections, with each ticket linked to its merge request. */
export async function loadWindowWorkspace(repoRoot: string): Promise<WindowWorkspace> {
  const integrations = readRepoIntegrations(repoRoot);
  const branchReady = git(repoRoot, ["branch", "--show-current"]);
  const youtrackUrl = integrations.youtrackUrl;
  const glab = integrations.gitlab ? createGlabRun(repoRoot) : undefined;
  const [tasks, reviews, mergeRequests, branchOutput] = await Promise.all([
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
    branchReady,
  ]);
  const branch = branchOutput.trim() || null;
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
    ticketsEnabled: Boolean(youtrackUrl),
    items: linked,
    branch,
    checkedOutId: checkedOut?.id ?? null,
    ...(notice ? { notice } : {}),
  };
}

export type WindowDiffScope = "pending" | "branch";

/** Pending work by default, or the full branch with committed files marked for review only. */
export async function loadWindowDiff(
  repoRoot: string,
  scope: WindowDiffScope = "pending",
): Promise<WindowDiffFile[]> {
  const base = readRepoIntegrations(repoRoot).workflow.baseBranch;
  // The remote base when there is one, else the local branch (a repository without a remote).
  const mergeBase =
    scope === "branch"
      ? (await git(repoRoot, ["merge-base", `origin/${base}`, "HEAD"])).trim() ||
        (await git(repoRoot, ["merge-base", base, "HEAD"])).trim()
      : "HEAD";
  const [tracked, untrackedOutput, pendingOutput] = await Promise.all([
    git(repoRoot, ["diff", "--no-color", "--no-ext-diff", mergeBase || "HEAD"]),
    git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
    scope === "branch"
      ? git(repoRoot, ["diff", "--no-renames", "--name-only", "-z", "HEAD"])
      : Promise.resolve(""),
  ]);
  // Like `flow diff`, new files count before they are added.
  const untrackedPaths = new Set(untrackedOutput.split("\0").filter(Boolean));
  const untracked: string[] = [];
  // Bound file reads and Git fallbacks even when a repository has many untracked files.
  for (const path of untrackedPaths) untracked.push(await untrackedWindowPatch(repoRoot, path));
  const pendingPaths = new Set([...pendingOutput.split("\0"), ...untrackedPaths]);
  return parseWindowDiff(`${tracked}${untracked.join("")}`, untrackedPaths).map((file) => ({
    ...file,
    pending: scope === "pending" || pendingPaths.has(file.path),
  }));
}

/** Synthesize ordinary text additions in-process; Git handles binary files, symlinks and quoted paths. */
async function untrackedWindowPatch(repoRoot: string, path: string) {
  const fullPath = join(repoRoot, path);
  try {
    if (!/[\s"\\]/.test(path) && (await lstat(fullPath)).isFile()) {
      const contents = await readFile(fullPath);
      if (!contents.includes(0))
        return `diff --git a/${path} b/${path}\nnew file mode 100644\n${createTwoFilesPatch("/dev/null", path, "", contents.toString("utf8"))}`;
    }
  } catch {
    /* A file can disappear between listing it and reading its patch. */
  }
  return git(repoRoot, ["diff", "--no-color", "--no-index", "--", "/dev/null", path], [0, 1]);
}

/** Preserve Pierre's filenames even when a patch has no line headers, as with empty files. */
export function parseWindowDiff(
  patch: string,
  untrackedPaths: ReadonlySet<string> = new Set(),
): WindowDiffFile[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((chunk) => chunk.startsWith("diff --git "))
    .map((chunk) => {
      const path = parsePatchFiles(chunk)[0]?.files[0]?.name ?? "file";
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
        untracked: untrackedPaths.has(path),
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
  const { THEMES } = await import("../ui/themes");
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
      codeTheme: theme.codeTheme ?? (theme.appearance === "dark" ? "pierre-dark" : "pierre-light"),
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
        modified: theme.fileModified,
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
  const comments = readCommentsFile(repoRoot).comments;
  return resolveComments(comments, readPostImagesForComments(repoRoot, comments))
    .filter((comment) => comment.state === "anchored")
    .map(({ state: _state, ...comment }) => comment);
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

/** Continue a discussion without creating another anchored comment. */
export function replyToWindowComment(repoRoot: string, id: number, body: string) {
  if (!body.trim()) throw new Error("A reply needs some text.");
  mutateCommentsFile(repoRoot, (current) =>
    withCommentReply(current, id, body.trim(), undefined, "user"),
  );
}

/** Persist which agent messages the reviewer has actually opened. */
export function markWindowCommentRead(repoRoot: string, id: number, replyCount: number) {
  mutateCommentsFile(repoRoot, (current) => withCommentRead(current, id, replyCount));
}

/** The git user's name, for the user's avatar and name in comment threads. */
export async function loadWindowUserName(repoRoot: string) {
  return (await git(repoRoot, ["config", "user.name"])).trim() || "You";
}
