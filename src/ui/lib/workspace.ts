import type { ReviewMergeRequest, WorkspaceReviewsResult } from "../../core/gitlab";
import { DEFAULT_WORKFLOW, type TicketWorkflow } from "../../core/repoIntegrations";
import { belongsToTicket } from "../../core/ticketSwitch";
import type { WorkspaceTasksResult, YouTrackTask } from "../../core/youtrack";

/** Tasks state: a finished YouTrack load, or one still in flight. */
export type WorkspaceTasksState = { kind: "loading" } | WorkspaceTasksResult;

/** Reviews state: a finished GitLab load, or one still in flight. */
export type WorkspaceReviewsState = { kind: "loading" } | WorkspaceReviewsResult;

export type WorkspaceSectionId = "todo" | "approval" | "readyToMerge" | "reviews";

export type WorkspaceStatus = "pending" | "inProgress" | "awaitingReview" | "approved";

/** Sidebar order and headings; selection walks items in this same order. */
export const WORKSPACE_SECTIONS: { id: WorkspaceSectionId; title: string }[] = [
  { id: "todo", title: "To do" },
  { id: "approval", title: "Needs approval" },
  { id: "readyToMerge", title: "Ready to merge" },
  { id: "reviews", title: "Reviews" },
];

/** One selectable workspace row, already reduced to what the sidebar draws. */
export interface WorkspaceItem {
  id: string;
  /** Ticket the Overview pane shows: a task's own id, or the one a review's branch or title names. */
  ticketId?: string;
  title: string;
  section: WorkspaceSectionId;
  status: WorkspaceStatus;
  /** Where `h` opens the item: the ticket, also for a review whose ticket is known. */
  url?: string;
  /** Where `g` opens a review: its merge request. Tickets find theirs by branch instead. */
  mergeRequestUrl?: string;
  /** A review's merge request number, which `R` hands the agent. */
  mergeRequestIid?: number;
  /** Extra context after the id, such as a review's author. */
  detail?: string;
  /** A review's source branch, which Enter checks out. */
  branch?: string;
  /** A review's target branch, which its diff is compared against. */
  baseBranch?: string;
  /** A ticket's YouTrack state, as YouTrack names it. */
  state?: string;
}

/** Tickets in the squad's review state wait on someone else's approval. */
function isInReview(task: YouTrackTask, workflow: TicketWorkflow) {
  return task.state?.toLowerCase() === workflow.reviewState.toLowerCase();
}

/**
 * In progress when the state is one of the squad's in-progress states, or, without that list, any
 * state that reads as active work; everything else is open.
 */
function taskStatus(task: YouTrackTask, workflow: TicketWorkflow): WorkspaceStatus {
  if (isInReview(task, workflow)) {
    return "awaitingReview";
  }
  const state = task.state?.toLowerCase();
  if (!state) {
    return "pending";
  }
  const inProgress =
    workflow.inProgressStates.length > 0
      ? workflow.inProgressStates.some((name) => name.toLowerCase() === state)
      : /progress|develop|doing/.test(state);
  return inProgress ? "inProgress" : "pending";
}

// Ticket ids such as PROJ-20805 or OPS-590, which branches and MR titles carry by convention.
// Project keys have at least two characters, so prose like "N-1" is not mistaken for a ticket.
const TICKET_IDS_IN_TEXT = /\b([A-Z][A-Z0-9]+)-\d+\b/g;

/**
 * The ticket a merge request works on, read from its branch name, else its title. With
 * `projectKeys` (`[youtrack] project_keys`), only those projects' ids count, so `UTF-8` in a title
 * or another squad's ticket is never taken for it.
 */
export function reviewTicketId(
  review: Pick<ReviewMergeRequest, "sourceBranch" | "title">,
  projectKeys: readonly string[] = [],
) {
  const firstTicketIn = (text: string) =>
    [...text.matchAll(TICKET_IDS_IN_TEXT)].find(
      (match) => projectKeys.length === 0 || projectKeys.includes(match[1]!),
    )?.[0];
  return firstTicketIn(review.sourceBranch) ?? firstTicketIn(review.title);
}

/** Reduce one squad merge request to a Reviews row. */
function reviewItem(
  review: ReviewMergeRequest,
  issueUrl: (ticketId: string) => string | undefined,
  projectKeys: readonly string[],
): WorkspaceItem {
  const ticketId = reviewTicketId(review, projectKeys);
  return {
    id: `!${review.iid}`,
    ticketId,
    title: review.title,
    section: "reviews",
    status: "awaitingReview",
    url: ticketId ? issueUrl(ticketId) : undefined,
    mergeRequestUrl: review.url,
    mergeRequestIid: review.iid,
    detail: review.author,
    branch: review.sourceBranch,
    baseBranch: review.targetBranch,
  };
}

/**
 * Move tickets waiting on approval whose MR someone approved into Ready to merge. YouTrack only
 * says a ticket is in review; the approval lives on its MR, which is linked after tasks load.
 */
export function moveApprovedToReadyToMerge(
  items: WorkspaceItem[],
  isApproved: (item: WorkspaceItem) => boolean,
): WorkspaceItem[] {
  const moved = items.map((item): WorkspaceItem =>
    item.section === "approval" && isApproved(item)
      ? { ...item, section: "readyToMerge", status: "approved" }
      : item,
  );
  return WORKSPACE_SECTIONS.flatMap((section) =>
    moved.filter((item) => item.section === section.id),
  );
}

/**
 * My tickets waiting on approval whose linked MR is already merged. A ticket links to a merged MR
 * only when none of its MRs is still open, so these have nothing left to merge.
 */
export function mergedTicketIds(
  items: WorkspaceItem[],
  mergeRequestState: (item: WorkspaceItem) => "opened" | "merged" | undefined,
) {
  return items
    .filter((item) => item.section === "approval" && mergeRequestState(item) === "merged")
    .map((item) => item.id);
}

/** Whether the checked-out branch is this item's: a ticket's `<id>-*` branch, or a review's own. */
export function itemOwnsBranch(item: WorkspaceItem, branch: string) {
  return item.section === "reviews" ? item.branch === branch : belongsToTicket(branch, item.id);
}

/** Flatten tasks and reviews into the single selection order the sidebar and keys share. */
export function buildWorkspaceItems(
  tasks: WorkspaceTasksState,
  reviews: WorkspaceReviewsState,
  issueUrl: (ticketId: string) => string | undefined = () => undefined,
  projectKeys: readonly string[] = [],
  workflow: TicketWorkflow = DEFAULT_WORKFLOW,
): WorkspaceItem[] {
  const taskItems: WorkspaceItem[] =
    tasks.kind === "ready"
      ? tasks.tasks.map((task) => ({
          id: task.id,
          ticketId: task.id,
          title: task.summary || task.id,
          section: isInReview(task, workflow) ? "approval" : "todo",
          status: taskStatus(task, workflow),
          url: task.url,
          state: task.state,
        }))
      : [];
  const reviewItems =
    reviews.kind === "ready"
      ? reviews.reviews.map((review) => reviewItem(review, issueUrl, projectKeys))
      : [];
  const items = [...taskItems, ...reviewItems];
  return WORKSPACE_SECTIONS.flatMap((section) =>
    items.filter((item) => item.section === section.id),
  );
}

/**
 * Keep the items whose ids, ticket, title, or author contain every word of the query, ignoring
 * case. `mergeRequestIid` adds the `!iid` a task's card shows, so `4100` finds it too.
 */
export function filterWorkspaceItems(
  items: WorkspaceItem[],
  query: string,
  mergeRequestIid: (item: WorkspaceItem) => number | undefined = (item) => item.mergeRequestIid,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return items;
  }
  return items.filter((item) => {
    const iid = mergeRequestIid(item);
    const searchable = [item.id, item.ticketId, iid && `!${iid}`, item.title, item.detail]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => searchable.includes(word));
  });
}

/** Explain an empty To do section, or return undefined when it lists tasks. */
export function describeTasksPlaceholder(
  tasks: WorkspaceTasksState,
  todoCount: number,
): string | undefined {
  switch (tasks.kind) {
    case "loading":
      return "Loading tasks…";
    case "ready":
      return todoCount === 0 ? "Nothing to do" : undefined;
    case "unconfigured":
    case "error":
      return tasks.message;
  }
}

/** Explain an empty Reviews section, or return undefined when it lists merge requests. */
export function describeReviewsPlaceholder(
  reviews: WorkspaceReviewsState,
  reviewCount: number,
): string | undefined {
  switch (reviews.kind) {
    case "loading":
      return "Loading reviews…";
    case "ready":
      return reviewCount === 0 ? "Nothing to review" : undefined;
    case "unconfigured":
    case "error":
      return reviews.message;
  }
}
