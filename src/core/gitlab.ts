/**
 * GitLab merge requests behind the workspace: my own, linked to ticket cards, and my squad's,
 * listed under Reviews. Read through the `glab` CLI so flow reuses its login and resolves the
 * project from the repository's remote.
 */
import { z } from "zod";
import { belongsToTicket } from "./ticketSwitch";

// Enough to cover every ticket still open; older MRs belong to resolved tickets.
const MAX_MERGE_REQUESTS = 100;
const GLAB_TIMEOUT_MS = 15_000;
// Squad MRs untouched for longer than this are treated as abandoned.
const REVIEW_MAX_AGE_DAYS = 14;

/** One of my merge requests, reduced to what links it to a ticket. */
export interface MergeRequest {
  iid: number;
  state: "opened" | "merged";
  sourceBranch: string;
  url: string;
  updatedAt: string;
  /** Open and approved by someone besides me, so it can be merged. */
  approved: boolean;
}

/** Run glab in one repository; any failure (missing binary, no login, timeout) is `ok: false`. */
export type GlabRun = (args: string[]) => Promise<{ ok: boolean; stdout: string }>;

const MergeRequestsSchema = z.array(
  z.object({
    iid: z.number(),
    state: z.string(),
    author: z.object({ username: z.string() }).optional(),
    source_branch: z.string(),
    web_url: z.string(),
    updated_at: z.string(),
  }),
);

/** Build a glab runner bound to one repository. */
export function createGlabRun(cwd: string): GlabRun {
  return async (args) => {
    try {
      const proc = Bun.spawn(["glab", ...args], {
        cwd,
        windowsHide: true,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        timeout: GLAB_TIMEOUT_MS,
      });
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return { ok: exitCode === 0, stdout };
    } catch {
      return { ok: false, stdout: "" };
    }
  };
}

/**
 * Load my open and merged merge requests; closed ones were abandoned and link nothing. Each open
 * one is checked for an approval by someone besides me, one approvals call per MR.
 */
export async function loadMyMergeRequests(glab: GlabRun): Promise<MergeRequest[]> {
  const result = await glab([
    "mr",
    "list",
    "--author=@me",
    "--all",
    "--output=json",
    `--per-page=${MAX_MERGE_REQUESTS}`,
  ]);
  if (!result.ok) {
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return [];
  }
  const parsed = MergeRequestsSchema.safeParse(json);
  if (!parsed.success) {
    return [];
  }
  return Promise.all(
    parsed.data.flatMap((mr) => {
      const state = mr.state;
      if (state !== "opened" && state !== "merged") {
        return [];
      }
      return [
        (async (): Promise<MergeRequest> => ({
          iid: mr.iid,
          state,
          sourceBranch: mr.source_branch,
          url: mr.web_url,
          updatedAt: mr.updated_at,
          approved:
            state === "opened" &&
            (await hasOutsideApproval(glab, mr.iid, mr.author?.username ?? "")),
        }))(),
      ];
    }),
  );
}

/**
 * Pick each ticket's merge request by its source branch. A ticket split over several branches
 * links to the checked-out branch's MR, else its most recently updated open MR, falling back to
 * the newest merged one.
 */
export function linkTicketMergeRequests(
  mergeRequests: MergeRequest[],
  ticketIds: string[],
  currentBranch?: string,
) {
  const ranked = mergeRequests.toSorted(
    (a, b) =>
      Number(b.sourceBranch === currentBranch) - Number(a.sourceBranch === currentBranch) ||
      Number(b.state === "opened") - Number(a.state === "opened") ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
  const links = new Map<string, MergeRequest>();
  for (const ticketId of ticketIds) {
    const mr = ranked.find((candidate) => belongsToTicket(candidate.sourceBranch, ticketId));
    if (mr) {
      links.set(ticketId, mr);
    }
  }
  return links;
}

/** A squad merge request waiting on review, as the Reviews section shows it. */
export interface ReviewMergeRequest {
  iid: number;
  title: string;
  author: string;
  sourceBranch: string;
  /** Branch the MR merges into; stacked MRs target another MR's branch, not main. */
  targetBranch: string;
  url: string;
}

/** Outcome of one Reviews load; every failure is a value so the UI never has to catch. */
export type WorkspaceReviewsResult =
  | { kind: "ready"; reviews: ReviewMergeRequest[] }
  | { kind: "unconfigured"; message: string }
  | { kind: "error"; message: string };

const ReviewMergeRequestsSchema = z.array(
  z.object({
    iid: z.number(),
    title: z.string(),
    author: z.object({ username: z.string() }),
    reviewers: z.array(z.object({ username: z.string() })).default([]),
    source_branch: z.string(),
    target_branch: z.string(),
    web_url: z.string(),
  }),
);

const ApprovalsSchema = z.object({
  approved_by: z.array(z.object({ user: z.object({ username: z.string() }) })),
});

const CurrentUserSchema = z.object({ username: z.string() });

/** Run `glab api` and parse its JSON, or undefined on any failure. */
async function glabApi(glab: GlabRun, path: string): Promise<unknown> {
  const result = await glab(["api", path]);
  if (!result.ok) {
    return undefined;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
}

/** Whether anyone besides the author approved the MR; an unreadable answer counts as no. */
async function hasOutsideApproval(glab: GlabRun, iid: number, author: string) {
  const approvals = ApprovalsSchema.safeParse(
    await glabApi(glab, `projects/:id/merge_requests/${iid}/approvals`),
  );
  return (
    approvals.success &&
    approvals.data.approved_by.some((approval) => approval.user.username !== author)
  );
}

/**
 * Load the merge requests labelled for my squad that still wait on a first review: open, not
 * drafts, written by someone else, approved by nobody but their author, and touched in the last
 * weeks. Ones that ask me for review come first, then most recently updated.
 */
export async function loadSquadReviews(
  glab: GlabRun,
  { label, now = new Date() }: { label: string | undefined; now?: Date },
): Promise<WorkspaceReviewsResult> {
  if (!label) {
    return { kind: "unconfigured", message: "Set [gitlab] review_label in .flow/config.toml" };
  }
  const user = CurrentUserSchema.safeParse(await glabApi(glab, "user"));
  if (!user.success) {
    return { kind: "error", message: "glab is not logged in" };
  }
  const me = user.data.username;
  const updatedAfter = new Date(now.getTime() - REVIEW_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    state: "opened",
    labels: label,
    "not[author_username]": me,
    wip: "no",
    updated_after: updatedAfter.toISOString(),
    order_by: "updated_at",
    per_page: String(MAX_MERGE_REQUESTS),
  });
  const approvedQuery = new URLSearchParams(query);
  approvedQuery.set("approved_by_ids", "Any");

  // `:id` makes glab resolve the project from the repository's remote.
  const [open, approved] = await Promise.all([
    glabApi(glab, `projects/:id/merge_requests?${query}`),
    glabApi(glab, `projects/:id/merge_requests?${approvedQuery}`),
  ]);
  const parsedOpen = ReviewMergeRequestsSchema.safeParse(open);
  const parsedApproved = ReviewMergeRequestsSchema.safeParse(approved);
  if (!parsedOpen.success || !parsedApproved.success) {
    return { kind: "error", message: "Could not load merge requests" };
  }

  // GitLab can only say "has approvals"; authors may approve their own MR, which is no review,
  // so only the few approved ones are checked one by one.
  const reviewed = new Set(
    (
      await Promise.all(
        parsedApproved.data.map(async (mr) =>
          (await hasOutsideApproval(glab, mr.iid, mr.author.username)) ? mr.iid : undefined,
        ),
      )
    ).filter((iid) => iid !== undefined),
  );

  const asksMe = (mr: { reviewers: { username: string }[] }) =>
    mr.reviewers.some((reviewer) => reviewer.username === me);
  // Stable sort keeps GitLab's updated-at order within each group.
  const ordered = parsedOpen.data
    .filter((mr) => !reviewed.has(mr.iid))
    .toSorted((a, b) => Number(asksMe(b)) - Number(asksMe(a)));
  return {
    kind: "ready",
    reviews: ordered.map((mr) => ({
      iid: mr.iid,
      title: mr.title,
      author: mr.author.username,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      url: mr.web_url,
    })),
  };
}
