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

export interface WindowDiffFile {
  path: string;
  patch: string;
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
      return {
        path,
        patch: chunk,
        additions: lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
        deletions: lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
      };
    });
}

/** A ticket's overview as the agent wrote it, or null when there is none. */
export function loadWindowOverview(repoRoot: string, ticketId: string) {
  return readTicketOverview(repoRoot, ticketId);
}
