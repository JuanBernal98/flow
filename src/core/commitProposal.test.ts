import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo, gitTest } from "../../test/helpers/git-repo";
import {
  approveCommitProposal,
  cancelCommitProposal,
  executeCommitProposal,
  failCommitProposal,
  publishCommitProposal,
  readCommitProposal,
  requestCommitProposal,
  claimCommitProposal,
  type CommitPlan,
} from "./commitProposal";
import { nextAgentWatchEvents, readAgentWatchSnapshot } from "./agentWatch";

afterEach(cleanupTestTicketRepos);
setDefaultTimeout(20_000);

test("selected files define the only allowed proposal scope and unrelated staged work survives execution", () => {
  const root = createTestProposalRepo();
  const pending = requestCommitProposal(root, ["app.ts"]);
  expect(pending.snapshot.files).toEqual(["app.ts"]);
  expect(() => requestCommitProposal(root, ["new file.ts"])).toThrow("changing its file selection");
  expect(() => publishCommitProposal(root, pending.id, PLAN)).toThrow("every pending file");
  claimCommitProposal(root, pending.id, "Codex");
  expect(readCommitProposal(root)?.claimedBy).toBe("Codex");
  writeFileSync(join(root, "new file.ts"), "export const outside = true;\n");
  publishCommitProposal(root, pending.id, { agentName: "Codex", commits: [PLAN.commits[0]] });
  approveCommitProposal(root, pending.id);
  expect(executeCommitProposal(root, pending.id).status).toBe("completed");
  expect(gitTest(root, ["show", "--format=", "--name-only", "HEAD"])).toBe("app.ts");
  expect(gitTest(root, ["diff", "--cached", "--name-only"])).toBe("new file.ts");
  expect(readFileSync(join(root, "new file.ts"), "utf8")).toContain("outside = true");
});

test("selecting a renamed file includes the old path without adding unrelated changes", () => {
  const root = createTestProposalRepo();
  writeFileSync(join(root, "app.ts"), "export const value = 1;\n");
  gitTest(root, ["mv", "app.ts", "renamed.ts"]);
  expect(requestCommitProposal(root, ["renamed.ts"]).snapshot.files).toEqual([
    "app.ts",
    "renamed.ts",
  ]);
});

test("approval can select one proposal while unapproved groups remain uncommitted", () => {
  const root = createTestProposalRepo();
  const pending = requestCommitProposal(root);
  publishCommitProposal(root, pending.id, PLAN);
  expect(() => approveCommitProposal(root, pending.id, [])).toThrow("at least one");
  expect(() => approveCommitProposal(root, pending.id, [8])).toThrow("valid commit");
  expect(() => approveCommitProposal(root, pending.id, [0, 0])).toThrow("duplicate indexes");
  expect(approveCommitProposal(root, pending.id, [1]).approvedCommits).toEqual([1]);
  expect(executeCommitProposal(root, pending.id)).toMatchObject({
    status: "completed",
    completed: 1,
  });
  expect(gitTest(root, ["show", "--format=", "--name-only", "HEAD"])).toBe("new file.ts");
  expect(gitTest(root, ["diff", "--name-only", "HEAD"])).toBe("app.ts");
});

/** A feature checkout with two pending files, one already staged. */
function createTestProposalRepo() {
  const { work } = createTestTicketRepo();
  gitTest(work, ["switch", "-c", "PROJ-42-commits"]);
  writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
  writeFileSync(join(work, "new file.ts"), "export const fresh = true;\n");
  gitTest(work, ["add", "new file.ts"]);
  return work;
}

const PLAN: CommitPlan = {
  agentName: "Codex",
  commits: [
    {
      kind: "commit",
      message: "fix: use the corrected value\n\nKeep the value consistent.",
      files: ["app.ts"],
    },
    { kind: "commit", message: "feat: expose the new value", files: ["new file.ts"] },
  ],
};

test("desktop request, proposal, approval and execution share one id and preserve exact groups", () => {
  const root = createTestProposalRepo();
  const head = gitTest(root, ["rev-parse", "HEAD"]);
  const request = requestCommitProposal(root);
  const event = nextAgentWatchEvents(
    { seenCommentKeys: new Set(), handledRequestId: null },
    readAgentWatchSnapshot(root),
  );
  expect(event.lines).toEqual([
    `flow request: commit PROJ-42 --proposal ${request.id} --phase propose`,
  ]);
  expect(requestCommitProposal(root).id).toBe(request.id);
  expect(() => executeCommitProposal(root, request.id)).toThrow("expected phase");
  publishCommitProposal(root, request.id, PLAN);
  expect(readCommitProposal(root)?.status).toBe("ready");
  expect(gitTest(root, ["rev-parse", "HEAD"])).toBe(head);
  approveCommitProposal(root, request.id);
  expect(readAgentWatchSnapshot(root).request).toMatchObject({
    proposalId: request.id,
    phase: "execute",
  });
  const result = executeCommitProposal(root, request.id);
  expect(result.status).toBe("completed");
  expect(result.completed).toBe(2);
  const commits = gitTest(root, ["rev-list", "--reverse", `${head}..HEAD`]).split("\n");
  expect(commits).toHaveLength(2);
  expect(gitTest(root, ["show", "--format=", "--name-only", commits[0]!])).toBe("app.ts");
  expect(gitTest(root, ["show", "--format=", "--name-only", commits[1]!])).toBe("new file.ts");
  expect(gitTest(root, ["show", "-s", "--format=%B", commits[0]!])).toBe(PLAN.commits[0]!.message);
  expect(gitTest(root, ["status", "--porcelain", "--untracked-files=no"])).toBe("");
  expect(() => executeCommitProposal(root, request.id)).toThrow("expected phase");
});

test("cancelled requests reject late proposals and approval cannot be reused for a new request", () => {
  const root = createTestProposalRepo();
  const first = requestCommitProposal(root);
  cancelCommitProposal(root, first.id);
  const second = requestCommitProposal(root);
  expect(second.id).not.toBe(first.id);
  expect(() => publishCommitProposal(root, first.id, PLAN)).toThrow("expected phase");
  publishCommitProposal(root, second.id, PLAN);
  expect(() => approveCommitProposal(root, first.id)).toThrow("expected phase");
  expect(readCommitProposal(root)?.status).toBe("ready");
});

test("a new Propose action supersedes old replies without requiring a cancel button", () => {
  const root = createTestProposalRepo();
  const first = requestCommitProposal(root, ["app.ts"]);
  publishCommitProposal(root, first.id, { agentName: "Codex", commits: [PLAN.commits[0]] });
  const second = requestCommitProposal(root, ["new file.ts"], true);
  expect(second.id).not.toBe(first.id);
  expect(second.snapshot.files).toEqual(["new file.ts"]);
  expect(() => approveCommitProposal(root, first.id)).toThrow("expected phase");
  expect(() => publishCommitProposal(root, first.id, PLAN)).toThrow("expected phase");
});

test("changed untracked contents, index or branch invalidate the reviewed snapshot", () => {
  const root = createTestProposalRepo();
  const pending = requestCommitProposal(root);
  publishCommitProposal(root, pending.id, PLAN);
  writeFileSync(join(root, "new file.ts"), "export const fresh = false;\n");
  expect(() => approveCommitProposal(root, pending.id)).toThrow("repository changed");
  writeFileSync(join(root, "new file.ts"), "export const fresh = true;\n");
  gitTest(root, ["reset", "--", "new file.ts"]);
  expect(() => approveCommitProposal(root, pending.id)).toThrow("repository changed");
  gitTest(root, ["add", "new file.ts"]);
  approveCommitProposal(root, pending.id);
  gitTest(root, ["switch", "-c", "different-branch"]);
  expect(() => executeCommitProposal(root, pending.id)).toThrow("repository changed");
});

test("every pending file is assigned once and repository internals cannot enter a proposal", () => {
  const root = createTestProposalRepo();
  const pending = requestCommitProposal(root);
  expect(() =>
    publishCommitProposal(root, pending.id, { ...PLAN, commits: [PLAN.commits[0]] }),
  ).toThrow("every pending file");
  expect(() =>
    publishCommitProposal(root, pending.id, {
      ...PLAN,
      commits: [...PLAN.commits, PLAN.commits[0]],
    }),
  ).toThrow("every pending file");
  expect(() =>
    publishCommitProposal(root, pending.id, {
      ...PLAN,
      commits: [{ kind: "commit", message: "bad", files: ["../outside"] }],
    }),
  ).toThrow();
  expect(() =>
    publishCommitProposal(root, pending.id, {
      ...PLAN,
      commits: [{ kind: "commit", message: "bad", files: [".flow/requests.json"] }],
    }),
  ).toThrow();
  expect(() =>
    publishCommitProposal(root, pending.id, {
      ...PLAN,
      commits: [{ ...PLAN.commits[0], message: "fix: x\n\nCo-Authored-By: no" }, PLAN.commits[1]],
    }),
  ).toThrow("Co-Authored-By");
  failCommitProposal(root, pending.id, "Cannot determine a useful grouping.");
  expect(readCommitProposal(root)).toMatchObject({
    status: "failed",
    error: "Cannot determine a useful grouping.",
  });
});

test("fixups fold into an unpublished local commit and refuse published targets", () => {
  const root = createTestProposalRepo();
  const published = gitTest(root, ["rev-parse", "HEAD"]);
  gitTest(root, ["add", "--", "app.ts"]);
  gitTest(root, ["commit", "--only", "-m", "fix: correct the value", "--", "app.ts"]);
  const target = gitTest(root, ["rev-parse", "HEAD"]);
  writeFileSync(join(root, "app.ts"), "export const value = 3;\n");
  const pending = requestCommitProposal(root);
  expect(() =>
    publishCommitProposal(root, pending.id, {
      ...PLAN,
      commits: [
        { kind: "fixup", target: published, message: "fixup! init", files: ["app.ts"] },
        PLAN.commits[1],
      ],
    }),
  ).toThrow("not reached a remote");
  publishCommitProposal(root, pending.id, {
    ...PLAN,
    commits: [
      { kind: "fixup", target, message: "fixup! fix: correct the value", files: ["app.ts"] },
      PLAN.commits[1],
    ],
  });
  approveCommitProposal(root, pending.id);
  expect(executeCommitProposal(root, pending.id).status).toBe("completed");
  expect(gitTest(root, ["rev-list", "--count", `${published}..HEAD`])).toBe("2");
  expect(gitTest(root, ["log", "--format=%s", `${published}..HEAD`])).not.toContain("fixup!");
  expect(readFileSync(join(root, "app.ts"), "utf8")).toContain("value = 3");
});

test("a failing commit hook reports the error without bypassing it or creating a commit", () => {
  const root = createTestProposalRepo();
  const head = gitTest(root, ["rev-parse", "HEAD"]);
  const hooks = join(root, "test-hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho 'review hook rejected' >&2\nexit 1\n", {
    mode: 0o755,
  });
  gitTest(root, ["config", "core.hooksPath", hooks]);
  gitTest(root, ["config", "status.showUntrackedFiles", "no"]);
  // Ignore the test-only hook so the proposal's pending files remain the two product changes.
  writeFileSync(join(root, ".git", "info", "exclude"), "test-hooks/\n.flow/\n");
  const pending = requestCommitProposal(root);
  publishCommitProposal(root, pending.id, PLAN);
  approveCommitProposal(root, pending.id);
  const result = executeCommitProposal(root, pending.id);
  expect(result).toMatchObject({ status: "failed", completed: 0 });
  expect(result.error).toContain("review hook rejected");
  expect(gitTest(root, ["rev-parse", "HEAD"])).toBe(head);
});
