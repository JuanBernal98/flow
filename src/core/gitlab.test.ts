import { describe, expect, test } from "bun:test";
import {
  linkTicketMergeRequests,
  loadMyMergeRequests,
  loadSquadReviews,
  type GlabRun,
  type MergeRequest,
} from "./gitlab";

/** Build one merge request with only the fields a test cares about overridden. */
function createTestMergeRequest(overrides: Partial<MergeRequest>): MergeRequest {
  return {
    iid: 1,
    state: "opened",
    sourceBranch: "PROJ-1",
    url: "https://gitlab.example.test/group/repo/-/merge_requests/1",
    updatedAt: "2026-11-10T10:00:00Z",
    approved: false,
    ...overrides,
  };
}

describe("loadMyMergeRequests", () => {
  test("asks glab for my MRs and drops closed ones", async () => {
    const calls: string[][] = [];
    const mergeRequests = await loadMyMergeRequests(async (args) => {
      calls.push(args);
      return {
        ok: true,
        stdout: JSON.stringify([
          {
            iid: 7,
            state: "opened",
            source_branch: "PROJ-7-badge",
            web_url: "https://gitlab.example.test/mr/7",
            updated_at: "2026-11-10T10:00:00Z",
            title: "ignored",
          },
          {
            iid: 8,
            state: "closed",
            source_branch: "PROJ-8",
            web_url: "https://gitlab.example.test/mr/8",
            updated_at: "2026-11-10T10:00:00Z",
          },
        ]),
      };
    });
    expect(calls[0]).toContain("--author=@me");
    expect(calls[0]).toContain("--output=json");
    expect(mergeRequests).toEqual([
      {
        iid: 7,
        state: "opened",
        sourceBranch: "PROJ-7-badge",
        url: "https://gitlab.example.test/mr/7",
        updatedAt: "2026-11-10T10:00:00Z",
        approved: false,
      },
    ]);
  });

  test("marks an open MR approved only when someone besides me approved it", async () => {
    const approvals: Record<string, string[]> = {
      "projects/:id/merge_requests/7/approvals": ["teammate"],
      "projects/:id/merge_requests/8/approvals": ["me"],
    };
    const mergeRequests = await loadMyMergeRequests(async (args) => {
      if (args[0] === "api") {
        const approvers = approvals[args[1] ?? ""] ?? [];
        return {
          ok: true,
          stdout: JSON.stringify({
            approved_by: approvers.map((username) => ({ user: { username } })),
          }),
        };
      }
      return {
        ok: true,
        stdout: JSON.stringify(
          [7, 8].map((iid) => ({
            iid,
            state: "opened",
            author: { username: "me" },
            source_branch: `PROJ-${iid}`,
            web_url: `https://gitlab.example.test/mr/${iid}`,
            updated_at: "2026-11-10T10:00:00Z",
          })),
        ),
      };
    });
    expect(mergeRequests.map((mr) => [mr.iid, mr.approved])).toEqual([
      [7, true],
      [8, false],
    ]);
  });

  test("reads a failed or garbled glab call as no merge requests", async () => {
    expect(await loadMyMergeRequests(async () => ({ ok: false, stdout: "" }))).toEqual([]);
    expect(await loadMyMergeRequests(async () => ({ ok: true, stdout: "not json" }))).toEqual([]);
    expect(await loadMyMergeRequests(async () => ({ ok: true, stdout: "{}" }))).toEqual([]);
  });
});

describe("linkTicketMergeRequests", () => {
  test("links a ticket through its branch name, not a lookalike id", () => {
    const mr = createTestMergeRequest({ iid: 5, sourceBranch: "PROJ-12-fix" });
    const links = linkTicketMergeRequests([mr], ["PROJ-12", "PROJ-1"]);
    expect(links.get("PROJ-12")).toBe(mr);
    expect(links.has("PROJ-1")).toBe(false);
  });

  test("prefers the newest open MR over merged and older ones", () => {
    const merged = createTestMergeRequest({
      iid: 1,
      state: "merged",
      updatedAt: "2026-11-11T00:00:00Z",
    });
    const olderOpen = createTestMergeRequest({ iid: 2, sourceBranch: "PROJ-1-a" });
    const newerOpen = createTestMergeRequest({
      iid: 3,
      sourceBranch: "PROJ-1-b",
      updatedAt: "2026-11-10T12:00:00Z",
    });
    expect(linkTicketMergeRequests([merged, olderOpen, newerOpen], ["PROJ-1"]).get("PROJ-1")).toBe(
      newerOpen,
    );
    expect(linkTicketMergeRequests([merged], ["PROJ-1"]).get("PROJ-1")).toBe(merged);
  });

  test("links the checked-out branch's MR over a newer sibling", () => {
    const current = createTestMergeRequest({ iid: 4, sourceBranch: "PROJ-1-mine" });
    const newer = createTestMergeRequest({
      iid: 5,
      sourceBranch: "PROJ-1-other",
      updatedAt: "2026-11-11T00:00:00Z",
    });
    expect(linkTicketMergeRequests([current, newer], ["PROJ-1"], "PROJ-1-mine").get("PROJ-1")).toBe(
      current,
    );
  });
});

describe("loadSquadReviews", () => {
  /** A squad MR as GitLab's API returns it. */
  function createTestApiMergeRequest(iid: number, reviewers: string[] = []) {
    return {
      iid,
      title: `MR ${iid}`,
      author: { username: `author-${iid}` },
      reviewers: reviewers.map((username) => ({ username })),
      source_branch: `branch-${iid}`,
      target_branch: iid === 4 ? "branch-1" : "main",
      web_url: `https://gitlab.example.test/mr/${iid}`,
    };
  }

  /**
   * Answer `glab api` like GitLab would for user `me`: MRs 1-4 are open, 2 was approved by a
   * teammate and 3 only by its own author. Records each requested path.
   */
  function createTestReviewGlab(paths: string[]): GlabRun {
    const approvers: Record<number, string[]> = { 2: ["teammate"], 3: ["author-3"] };
    return async ([, path = ""]) => {
      paths.push(path);
      const reply = (body: unknown) => ({ ok: true, stdout: JSON.stringify(body) });
      if (path === "user") return reply({ username: "me" });
      const approvals = /merge_requests\/(\d+)\/approvals$/.exec(path);
      if (approvals) {
        const iid = Number(approvals[1]);
        return reply({
          approved_by: (approvers[iid] ?? []).map((username) => ({ user: { username } })),
        });
      }
      if (path.includes("approved_by_ids=Any")) {
        return reply([createTestApiMergeRequest(2), createTestApiMergeRequest(3)]);
      }
      return reply([
        createTestApiMergeRequest(1),
        createTestApiMergeRequest(2),
        createTestApiMergeRequest(3),
        createTestApiMergeRequest(4, ["me"]),
      ]);
    };
  }

  test("lists open non-draft MRs by others that nobody but their author approved", async () => {
    const paths: string[] = [];
    const result = await loadSquadReviews(createTestReviewGlab(paths), {
      label: "my-team",
      now: new Date("2026-11-15T00:00:00Z"),
    });

    const query = new URL(`https://x.test/${paths[1]}`).searchParams;
    expect(query.get("labels")).toBe("my-team");
    expect(query.get("not[author_username]")).toBe("me");
    expect(query.get("state")).toBe("opened");
    expect(query.get("wip")).toBe("no");
    expect(query.get("updated_after")).toBe("2026-11-01T00:00:00.000Z");
    // Only the MRs GitLab reports as approved need their approvers looked up.
    expect(paths.filter((path) => path.endsWith("/approvals")).toSorted()).toEqual([
      "projects/:id/merge_requests/2/approvals",
      "projects/:id/merge_requests/3/approvals",
    ]);
    if (result.kind !== "ready") throw new Error(`Expected reviews, got ${result.kind}`);
    // 4 asks me for review so it leads; 2 is gone; 3's self-approval does not count.
    expect(result.reviews.map((review) => review.iid)).toEqual([4, 1, 3]);
    expect(result.reviews[0]).toMatchObject({
      author: "author-4",
      sourceBranch: "branch-4",
      targetBranch: "branch-1",
    });
  });

  test("explains a missing label or login instead of listing nothing", async () => {
    const paths: string[] = [];
    expect(await loadSquadReviews(createTestReviewGlab(paths), { label: undefined })).toEqual({
      kind: "unconfigured",
      message: "Set [gitlab] review_label in .flow/config.toml",
    });
    expect(paths).toEqual([]);
    expect(
      await loadSquadReviews(async () => ({ ok: false, stdout: "" }), { label: "my-team" }),
    ).toEqual({ kind: "error", message: "glab is not logged in" });
  });
});
