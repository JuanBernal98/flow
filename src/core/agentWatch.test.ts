import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReviewRequest, writeTicketContextRequest } from "./agentRequests";
import {
  nextAgentWatchEvents,
  readAgentWatchSnapshot,
  resolveWatchFiles,
  runAgentWatch,
  type AgentWatchState,
} from "./agentWatch";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    const { ownerFile, handledRequestFile } = resolveWatchFiles(root, "stream");
    rmSync(root, { recursive: true, force: true });
    rmSync(ownerFile, { force: true });
    rmSync(handledRequestFile, { force: true });
  }
});

/** A throwaway repo root with an empty `.flow/`. */
function createTestRepoRoot() {
  const root = mkdtempSync(join(tmpdir(), "agent-watch-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".flow"));
  return root;
}

/** Write a minimal valid comments file. */
function writeTestComments(
  root: string,
  comments: { id: number; body: string; author?: "user" | "agent" }[],
) {
  writeFileSync(
    join(root, ".flow", "comments.json"),
    JSON.stringify({
      schema: 1,
      comments: comments.map(({ id, body, author }) => ({
        id,
        file: "src/app.ts",
        line: 1,
        range: [1, 1],
        anchor: "0123456789abcdef",
        body,
        ...(author ? { author } : {}),
      })),
    }),
  );
}

const EMPTY_STATE: AgentWatchState = { seenCommentKeys: new Set(), handledRequestId: null };

describe("nextAgentWatchEvents", () => {
  test("announces new comments once and keys them by content, not id", () => {
    const first = nextAgentWatchEvents(EMPTY_STATE, {
      comments: [{ id: 1, key: "a" }],
      request: null,
    });
    expect(first.lines).toEqual(["new flow comments: 1"]);

    const repeat = nextAgentWatchEvents(first.state, {
      comments: [{ id: 1, key: "a" }],
      request: null,
    });
    expect(repeat.lines).toEqual([]);

    // Resolving 1 and adding a different comment that reuses id 1 is still news.
    const reused = nextAgentWatchEvents(repeat.state, {
      comments: [{ id: 1, key: "b" }],
      request: null,
    });
    expect(reused.lines).toEqual(["new flow comments: 1"]);
  });

  test("announces each request id once", () => {
    const first = nextAgentWatchEvents(EMPTY_STATE, {
      comments: [],
      request: { id: "r1", type: "ticket-context", ticket: "PROJ-1" },
    });
    expect(first.lines).toEqual(["flow request: ticket-context PROJ-1 --request r1"]);
    expect(first.state.handledRequestId).toBe("r1");

    const again = nextAgentWatchEvents(first.state, {
      comments: [],
      request: { id: "r1", type: "ticket-context", ticket: "PROJ-1" },
    });
    expect(again.lines).toEqual([]);
  });

  test("announces commit and MR requests, with the ticket only when there is one", () => {
    const commit = nextAgentWatchEvents(EMPTY_STATE, {
      comments: [],
      request: { id: "r1", type: "commit" },
    });
    expect(commit.lines).toEqual(["flow request: commit --request r1"]);
    const mergeRequest = nextAgentWatchEvents(commit.state, {
      comments: [],
      request: { id: "r2", type: "mr-open", ticket: "PROJ-3" },
    });
    expect(mergeRequest.lines).toEqual(["flow request: mr-open PROJ-3 --request r2"]);
  });

  test("announces a review with its merge request when it has one", () => {
    const withMergeRequest = nextAgentWatchEvents(EMPTY_STATE, {
      comments: [],
      request: { id: "r1", type: "review", ticket: "PROJ-1", mergeRequest: 4100 },
    });
    expect(withMergeRequest.lines).toEqual(["flow request: review PROJ-1 !4100 --request r1"]);

    const branchOnly = nextAgentWatchEvents(withMergeRequest.state, {
      comments: [],
      request: { id: "r2", type: "review", ticket: "PROJ-2" },
    });
    expect(branchOnly.lines).toEqual(["flow request: review PROJ-2 --request r2"]);
  });
});

describe("readAgentWatchSnapshot", () => {
  test("reads comments and the newest request, treating bad files as empty", () => {
    const root = createTestRepoRoot();
    expect(readAgentWatchSnapshot(root)).toEqual({ comments: [], request: null, requests: [] });

    writeTestComments(root, [{ id: 3, body: "rename this" }]);
    const request = writeTicketContextRequest(root, "PROJ-9");
    const snapshot = readAgentWatchSnapshot(root);
    expect(snapshot.comments.map((comment) => comment.id)).toEqual([3]);
    expect(snapshot.request).toEqual({ id: request.id, type: "ticket-context", ticket: "PROJ-9" });

    const review = writeReviewRequest(root, "PROJ-9", 4100);
    expect(readAgentWatchSnapshot(root).request).toEqual({
      id: review.id,
      type: "review",
      ticket: "PROJ-9",
      mergeRequest: 4100,
    });

    // The agent's own comments are not announced back to it.
    writeTestComments(root, [
      { id: 3, body: "rename this" },
      { id: 4, body: "flagged by me", author: "agent" },
    ]);
    expect(readAgentWatchSnapshot(root).comments.map((comment) => comment.id)).toEqual([3]);

    writeFileSync(join(root, ".flow", "requests.json"), "{ half-written");
    expect(readAgentWatchSnapshot(root).request).toBeNull();
  });
});

describe("runAgentWatch", () => {
  test("streams events, survives a re-arm without replaying requests, and yields to a newer watcher", async () => {
    const root = createTestRepoRoot();
    writeTestComments(root, [{ id: 1, body: "first" }]);
    const firstRequest = writeTicketContextRequest(root, "PROJ-1");

    const firstLines: string[] = [];
    const first = runAgentWatch(root, (line) => firstLines.push(line));
    await Bun.sleep(300);
    expect(firstLines).toEqual([
      "new flow comments: 1",
      `flow request: ticket-context PROJ-1 --request ${firstRequest.id}`,
    ]);

    // A newer watcher takes over: the first one stops, and the delivered request is not replayed.
    const secondLines: string[] = [];
    const second = runAgentWatch(root, (line) => secondLines.push(line));
    await first;
    const secondRequest = writeTicketContextRequest(root, "PROJ-2");
    await Bun.sleep(1_300);
    expect(secondLines).toEqual([
      "new flow comments: 1",
      `flow request: ticket-context PROJ-2 --request ${secondRequest.id}`,
    ]);

    // Stop the second watcher by handing ownership away.
    writeFileSync(resolveWatchFiles(root, "stream").ownerFile, "someone-else");
    await second;
    expect(existsSync(resolveWatchFiles(root, "stream").handledRequestFile)).toBe(true);
  }, 10_000);
});
