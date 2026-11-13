import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommitRequest, writeReviewRequest } from "./agentRequests";
import { resolveWatchFiles, runAgentWatch } from "./agentWatch";
import { runCodexHook } from "./codexWatch";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const { ownerFile, handledRequestFile } = resolveWatchFiles(root);
    rmSync(root, { recursive: true, force: true });
    for (const path of [
      ownerFile,
      handledRequestFile,
      `${handledRequestFile}.codex`,
      `${ownerFile}.codex.json`,
      `${ownerFile}.codex.json.lock`,
      ...Object.values(resolveWatchFiles(root, "stream")),
    ])
      rmSync(path, { force: true });
  }
});

test("a running stream and Codex hooks deliver independently without stealing requests", async () => {
  const root = createTestCodexWatchRepo();
  runCodexHook(createTestHookInput(root, "SessionStart"), "flow");
  const lines: string[] = [];
  const stream = runAgentWatch(root, (line) => lines.push(line));
  try {
    writeCommitRequest(root, undefined);
    await Bun.sleep(1200);
    expect(lines).toContain("flow request: commit");
    expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toContain(
      "flow request: commit",
    );
    expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toBe("");
  } finally {
    writeFileSync(resolveWatchFiles(root, "stream").ownerFile, "stop-test-stream");
    await stream;
  }
}, 10_000);

test("a legacy stream cannot consume the pending proposal or permanently displace the Codex session", () => {
  const root = createTestCodexWatchRepo();
  runCodexHook(createTestHookInput(root, "SessionStart"), "flow");
  const { ownerFile, handledRequestFile } = resolveWatchFiles(root);
  const request = writeCommitRequest(root, undefined);
  writeFileSync(ownerFile, "1234-5678");
  writeFileSync(handledRequestFile, request.id);
  expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toContain(
    "flow request: commit",
  );
  expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toBe("");
});

/** Only file-based fixtures are needed: event delivery never invokes Git or an agent process. */
function createTestCodexWatchRepo() {
  const root = mkdtempSync(join(tmpdir(), "flow-codex-watch-"));
  roots.push(root);
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, ".flow"));
  return root;
}

/** A lifecycle checkpoint from one local agent session. */
function createTestHookInput(cwd: string, hook_event_name: string, session_id = "test-session") {
  return { cwd, hook_event_name, session_id, source: "startup" };
}

test("Codex delivers each request once across tool, prompt, and stop checkpoints", () => {
  const root = createTestCodexWatchRepo();
  const start = runCodexHook(createTestHookInput(root, "SessionStart"), "flow");
  expect(start).toContain("flow-commit-create");
  writeCommitRequest(root, undefined);
  const output = runCodexHook(createTestHookInput(root, "PostToolUse"), "flow");
  expect(output).toContain("flow request: commit");
  expect(JSON.parse(output)).toMatchObject({
    hookSpecificOutput: { hookEventName: "PostToolUse" },
  });
  expect(runCodexHook(createTestHookInput(root, "UserPromptSubmit"), "flow")).toBe("");
  expect(runCodexHook(createTestHookInput(root, "Stop"), "flow")).toBe("");
  writeReviewRequest(root, "PROJ-1", 42);
  expect(JSON.parse(runCodexHook(createTestHookInput(root, "Stop"), "flow"))).toMatchObject({
    decision: "block",
  });
  expect(runCodexHook(createTestHookInput(root, "Stop"), "flow")).toBe("");
});

test("Codex comment events detect edits while ignoring the agent's own comments", () => {
  const root = createTestCodexWatchRepo();
  runCodexHook(createTestHookInput(root, "SessionStart"), "flow");
  const writeComments = (body: string) =>
    writeFileSync(
      join(root, ".flow", "comments.json"),
      JSON.stringify({
        schema: 1,
        comments: [
          {
            id: 1,
            file: "app.ts",
            line: 1,
            range: [1, 1],
            anchor: "0123456789abcdef",
            body,
            author: "user",
          },
          {
            id: 2,
            file: "app.ts",
            line: 1,
            range: [1, 1],
            anchor: "0123456789abcdef",
            body: "Agent's review",
            author: "agent",
          },
        ],
      }),
    );
  writeComments("Please simplify");
  const output = runCodexHook(createTestHookInput(root, "PostToolUse"), "flow");
  expect(output).toContain("new flow comments: 1");
  expect(output).not.toContain("new flow comments: 1 2");
  expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toBe("");
  writeComments("Please simplify the other branch too");
  expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toContain(
    "new flow comments: 1",
  );
});

test("the newest session owns delivery; compacting or subagent hooks do not steal it", () => {
  const root = createTestCodexWatchRepo();
  runCodexHook(createTestHookInput(root, "SessionStart", "first"), "flow");
  runCodexHook(createTestHookInput(root, "SessionStart", "second"), "flow");
  writeCommitRequest(root, undefined);
  expect(runCodexHook(createTestHookInput(root, "PostToolUse", "first"), "flow")).toBe("");
  expect(
    runCodexHook(
      { ...createTestHookInput(root, "SessionStart", "first"), source: "compact" },
      "flow",
    ),
  ).toBe("");
  expect(
    runCodexHook(
      { ...createTestHookInput(root, "PostToolUse", "second"), agent_id: "child" },
      "flow",
    ),
  ).toBe("");
  expect(runCodexHook(createTestHookInput(root, "PostToolUse", "second"), "flow")).toContain(
    "flow request: commit",
  );
  runCodexHook(createTestHookInput(root, "SessionStart", "third"), "flow");
  expect(runCodexHook(createTestHookInput(root, "PostToolUse", "third"), "flow")).toBe("");
});

test("hooks stay quiet outside repositories and with invalid inputs", () => {
  expect(runCodexHook({}, "flow")).toBe("");
  expect(runCodexHook(createTestHookInput(tmpdir(), "SessionStart"), "flow")).toBe("");
});

test("busy checkpoints defer events without consuming them", () => {
  const root = createTestCodexWatchRepo();
  runCodexHook(createTestHookInput(root, "SessionStart"), "flow");
  const lockPath = `${resolveWatchFiles(root).ownerFile}.codex.json.lock`;
  writeFileSync(lockPath, "held by another hook");
  writeCommitRequest(root, undefined);
  expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toBe("");
  rmSync(lockPath);
  expect(runCodexHook(createTestHookInput(root, "PostToolUse"), "flow")).toContain(
    "flow request: commit",
  );
});
