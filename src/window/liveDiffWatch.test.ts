import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveDiffWatch } from "./liveDiffWatch";
import { createDiffEvents } from "./diffEvents";

/** Fail bounded waits without leaving a pending stream read behind. */
async function nextTestEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const timeout = setTimeout(() => {
    void reader.cancel("Timed out waiting for a diff event");
  }, 5000);
  try {
    const result = await reader.read();
    expect(result.done).toBe(false);
    return new TextDecoder().decode(result.value);
  } finally {
    clearTimeout(timeout);
  }
}

test("streams tracked, untracked, nested-directory and Git changes, ignoring generated files", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-live-diff-"));
  const watcher = createLiveDiffWatch(root);
  /** Prepare an actual Git worktree without relying on a user identity or commit hooks. */
  function git(...args: string[]) {
    const result = Bun.spawnSync(["git", ...args], { cwd: root, windowsHide: true });
    expect(result.exitCode).toBe(0);
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    git("init", "--quiet");
    writeFileSync(join(root, ".gitignore"), "build/\n.flow/\n");
    writeFileSync(join(root, "tracked.ts"), "before\n");
    git("add", ".");
    const abort = new AbortController();
    const response = createDiffEvents(watcher, abort.signal);
    reader = response.body!.getReader();
    expect(await nextTestEvent(reader)).toContain("event: ready");
    writeFileSync(join(root, "tracked.ts"), "after\n");
    expect(await nextTestEvent(reader)).toContain("event: change");
    mkdirSync(join(root, "new-folder"));
    writeFileSync(join(root, "new-folder", "file.ts"), "new\n");
    expect(await nextTestEvent(reader)).toContain("event: change");
    writeFileSync(join(root, "new-folder", "file.ts"), "edited\n");
    expect(await nextTestEvent(reader)).toContain("event: change");
    git("add", "tracked.ts");
    expect(await nextTestEvent(reader)).toContain("event: change");
    await Bun.sleep(400);
    const before = watcher.revision;
    mkdirSync(join(root, "build"));
    writeFileSync(join(root, "build", "generated.js"), "ignored\n");
    mkdirSync(join(root, ".flow"));
    writeFileSync(join(root, ".flow", "requests.json"), "{}\n");
    await Bun.sleep(500);
    expect(watcher.revision).toBe(before);
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader?.cancel();
    watcher.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
