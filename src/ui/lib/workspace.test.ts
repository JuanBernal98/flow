import { describe, expect, test } from "bun:test";
import {
  filterWorkspaceItems,
  mergedTicketIds,
  moveApprovedToReadyToMerge,
  reviewTicketId,
  type WorkspaceItem,
} from "./workspace";

describe("reviewTicketId", () => {
  test("reads the ticket from the branch name, wherever it sits", () => {
    expect(
      reviewTicketId({ sourceBranch: "PROJ-20805-fitness-toolkit-defaults", title: "x" }),
    ).toBe("PROJ-20805");
    expect(
      reviewTicketId({ sourceBranch: "feat/PROJ-20485-n1-workflow-04", title: "PROJ-1: other" }),
    ).toBe("PROJ-20485");
  });

  test("falls back to the title when the branch has no ticket", () => {
    expect(
      reviewTicketId({
        sourceBranch: "fallow-dead-code-gate",
        title: "PROJ-20829 chore(client): fail MRs that add dead code",
      }),
    ).toBe("PROJ-20829");
  });

  test("with project keys, only those projects' ids count", () => {
    const review = { sourceBranch: "fix-utf8", title: "UTF-8 names for OPS-590 exports" };
    expect(reviewTicketId(review)).toBe("UTF-8");
    expect(reviewTicketId(review, ["OPS"])).toBe("OPS-590");
    expect(reviewTicketId(review, ["PROJ"])).toBeUndefined();
  });

  test("finds nothing in lowercase or id-free names", () => {
    expect(
      reviewTicketId({
        sourceBranch: "n1-workflow/review-fixes-05-10",
        title: "docs(solvers): N-1 and N-1 RAC are solver workflows",
      }),
    ).toBeUndefined();
    expect(
      reviewTicketId({ sourceBranch: "drop-legacy-v2/02-mandatory-write", title: "refactor: x" }),
    ).toBeUndefined();
  });
});

describe("filterWorkspaceItems", () => {
  const items: WorkspaceItem[] = [
    {
      id: "PROJ-1",
      ticketId: "PROJ-1",
      title: "Clamp the badge",
      section: "todo",
      status: "pending",
    },
    {
      id: "!4100",
      ticketId: "OPS-12",
      title: "Fix the feeder selector",
      section: "reviews",
      status: "awaitingReview",
      mergeRequestIid: 4100,
      detail: "teammate",
    },
  ];
  const ids = (query: string, mergeRequestIid?: (item: WorkspaceItem) => number | undefined) =>
    filterWorkspaceItems(items, query, mergeRequestIid).map((item) => item.id);

  test("keeps everything for an empty query", () => {
    expect(ids("  ")).toEqual(["PROJ-1", "!4100"]);
  });

  test("matches ids, the ticket a review names, title, and author, ignoring case", () => {
    expect(ids("4100")).toEqual(["!4100"]);
    expect(ids("ops-12")).toEqual(["!4100"]);
    expect(ids("badge")).toEqual(["PROJ-1"]);
    expect(ids("TEAMMATE")).toEqual(["!4100"]);
  });

  test("needs every word, and finds a task by the MR its card shows", () => {
    expect(ids("feeder teammate")).toEqual(["!4100"]);
    expect(ids("feeder badge")).toEqual([]);
    expect(ids("!77", (item) => (item.id === "PROJ-1" ? 77 : item.mergeRequestIid))).toEqual([
      "PROJ-1",
    ]);
  });
});

describe("moveApprovedToReadyToMerge", () => {
  test("moves only approved tickets out of Needs approval, into its own section after it", () => {
    const items: WorkspaceItem[] = [
      { id: "PROJ-1", title: "Doing", section: "todo", status: "inProgress" },
      { id: "PROJ-2", title: "Waiting", section: "approval", status: "awaitingReview" },
      { id: "PROJ-3", title: "Approved", section: "approval", status: "awaitingReview" },
      { id: "!9", title: "Theirs", section: "reviews", status: "awaitingReview" },
    ];
    const moved = moveApprovedToReadyToMerge(items, (item) =>
      ["PROJ-1", "PROJ-3"].includes(item.id),
    );
    expect(moved.map((item) => [item.id, item.section, item.status])).toEqual([
      ["PROJ-1", "todo", "inProgress"],
      ["PROJ-2", "approval", "awaitingReview"],
      ["PROJ-3", "readyToMerge", "approved"],
      ["!9", "reviews", "awaitingReview"],
    ]);
  });
});

describe("mergedTicketIds", () => {
  test("picks only tickets waiting on approval whose MR is merged", () => {
    const items: WorkspaceItem[] = [
      { id: "PROJ-1", title: "Doing", section: "todo", status: "inProgress" },
      { id: "PROJ-2", title: "Merged", section: "approval", status: "awaitingReview" },
      { id: "PROJ-3", title: "Open MR", section: "approval", status: "awaitingReview" },
      { id: "!9", title: "Theirs", section: "reviews", status: "awaitingReview" },
    ];
    const states: Record<string, "opened" | "merged"> = {
      "PROJ-1": "merged",
      "PROJ-2": "merged",
      "PROJ-3": "opened",
      "!9": "merged",
    };
    expect(mergedTicketIds(items, (item) => states[item.id])).toEqual(["PROJ-2"]);
  });
});
