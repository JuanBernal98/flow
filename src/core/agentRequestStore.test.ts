import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeCommitRequest, writeReviewRequest, writeTicketContextRequest } from "./agentRequests";
import {
  claimAgentRequest,
  finishAgentRequest,
  pendingAgentRequests,
  readAgentRequests,
} from "./agentRequestStore";
import { recordAgentCheckpoint } from "./agentSession";
import {
  nextAgentWatchEvents,
  readAgentWatchSnapshot,
  AGENT_REMINDER_INTERVAL_MS,
} from "./agentWatch";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
/** A minimal branch-aware repository is sufficient to exercise durable delivery. */
function createTestRequestRepo() {
  const root = mkdtempSync(join(tmpdir(), "flow-request-store-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feature-a\n");
  return root;
}

test("independent jobs survive new requests and only obsolete context is superseded", () => {
  const root = createTestRequestRepo();
  const first = writeTicketContextRequest(root, "PROJ-1");
  const review = writeReviewRequest(root, "PROJ-1", 42);
  const commit = writeCommitRequest(root, "PROJ-1");
  const second = writeTicketContextRequest(root, "PROJ-2");
  expect(pendingAgentRequests(root).map((request) => request.id)).toEqual([
    review.id,
    commit.id,
    second.id,
  ]);
  expect(readAgentRequests(root).find((request) => request.id === first.id)?.status).toBe(
    "superseded",
  );
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feature-b\n");
  expect(pendingAgentRequests(root)).toEqual([]);
  writeCommitRequest(root, "PROJ-3");
  writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/feature-a\n");
  expect(pendingAgentRequests(root).map((request) => request.id)).toEqual([
    review.id,
    commit.id,
    second.id,
  ]);
});

test("unacknowledged notifications repeat with the same id and stop immediately after pickup", () => {
  const root = createTestRequestRepo();
  const request = writeReviewRequest(root, "PROJ-1", undefined);
  const first = nextAgentWatchEvents(
    { seenCommentKeys: new Set(), handledRequestId: null },
    readAgentWatchSnapshot(root),
    1000,
  );
  const early = nextAgentWatchEvents(first.state, readAgentWatchSnapshot(root), 2000);
  expect(early.lines).toEqual([]);
  const reminder = nextAgentWatchEvents(
    early.state,
    readAgentWatchSnapshot(root),
    1000 + AGENT_REMINDER_INTERVAL_MS,
  );
  expect(reminder.lines).toEqual(first.lines);
  claimAgentRequest(root, request.id, "Codex");
  expect(nextAgentWatchEvents(reminder.state, readAgentWatchSnapshot(root), 200_000).lines).toEqual(
    [],
  );
  finishAgentRequest(root, request.id, "Codex");
  expect(() => claimAgentRequest(root, request.id, "Codex")).toThrow("completed");
});

test("pickup and completion are idempotent and cannot be stolen by another session", () => {
  const root = createTestRequestRepo();
  recordAgentCheckpoint(root, "session-a", "Codex", "PostToolUse");
  const request = writeReviewRequest(root, "PROJ-1", undefined);
  const picked = claimAgentRequest(root, request.id, "Codex");
  expect(claimAgentRequest(root, request.id, "Codex")).toEqual(picked);
  expect(() => finishAgentRequest(root, request.id, "Claude")).toThrow("owning session");
  recordAgentCheckpoint(root, "session-b", "Codex", "PostToolUse");
  expect(() => claimAgentRequest(root, request.id, "Codex")).toThrow("another agent session");
  recordAgentCheckpoint(root, "session-a", "Codex", "PostToolUse");
  const done = finishAgentRequest(root, request.id, "Codex");
  expect(finishAgentRequest(root, request.id, "Codex")).toEqual(done);
  expect(done.claimedAt).toBeDefined();
  expect(done.completedAt).toBeDefined();
});

test("legacy queues remain readable and invalid queues are never silently overwritten", () => {
  const root = createTestRequestRepo();
  mkdirSync(join(root, ".flow"));
  const path = join(root, ".flow", "requests.json");
  writeFileSync(
    path,
    JSON.stringify({ schema: 1, request: { id: "legacy", type: "review", ticket: "PROJ-1" } }),
  );
  expect(pendingAgentRequests(root)[0]?.id).toBe("legacy");
  writeCommitRequest(root, undefined);
  expect(readAgentRequests(root)).toHaveLength(2);
  writeFileSync(path, "{ invalid");
  expect(() => writeCommitRequest(root, undefined)).toThrow("Invalid Flow request queue");
  expect(readFileSync(path, "utf8")).toBe("{ invalid");
});

test("concurrent CLI writers retain every independent job and only one agent wins pickup", async () => {
  const root = createTestRequestRepo();
  /** Run independent processes so queue locking is tested beyond one event loop. */
  const run = async (operation: string, author: string, id = "") => {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        resolve(import.meta.dir, "../../test/helpers/agent-request-test-worker.ts"),
        root,
        operation,
        author,
        id,
      ],
      { windowsHide: true, stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, output, error };
  };
  const results = await Promise.all(
    ["PROJ-1", "PROJ-2", "PROJ-3"].map((ticket) => run("enqueue", ticket)),
  );
  expect(results.map((result) => result.exitCode)).toEqual([0, 0, 0]);
  const queued = pendingAgentRequests(root);
  expect(queued).toHaveLength(3);
  const claims = await Promise.all([
    run("claim", "Codex", queued[0]!.id),
    run("claim", "Claude", queued[0]!.id),
  ]);
  expect(claims.filter((result) => result.exitCode === 0)).toHaveLength(1);
  expect(readAgentRequests(root)).toHaveLength(3);
}, 10_000);
