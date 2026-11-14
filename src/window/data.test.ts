import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo, gitTest } from "../../test/helpers/git-repo";
import { loadWindowDiff, parseWindowDiff } from "./data";
import { startWindowServer } from "./open";

afterEach(cleanupTestTicketRepos);

test("Git failures reach the desktop API instead of becoming an empty review", async () => {
  const { work } = createTestTicketRepo();
  const { server, url, closeDiffWatch } = startWindowServer(work);
  const address = new URL(url);
  const headers = { "x-flow-secret": address.hash.slice(1) };
  try {
    expect(await loadWindowDiff(work)).toEqual([]);
    writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
    gitTest(work, ["config", "diff.algorithm", "invalid-flow-test"]);
    await expect(loadWindowDiff(work)).rejects.toThrow("Git could not load the review (diff)");
    const failed = await fetch(`${address.origin}/api/diff`, { headers });
    expect(failed.status).toBe(500);
    expect(await failed.text()).toContain("invalid-flow-test");
    gitTest(work, ["config", "--unset", "diff.algorithm"]);
    const recovered = await fetch(`${address.origin}/api/diff`, { headers });
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject([{ path: "app.ts" }]);
  } finally {
    closeDiffWatch();
    await server.stop(true);
  }
});

test("branch review falls back from missing remote and local base refs", async () => {
  const { work } = createTestTicketRepo();
  gitTest(work, ["update-ref", "-d", "refs/remotes/origin/main"]);
  writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
  expect(await loadWindowDiff(work, "branch")).toMatchObject([{ path: "app.ts" }]);
  gitTest(work, ["branch", "-m", "feature"]);
  expect(await loadWindowDiff(work, "branch")).toMatchObject([{ path: "app.ts" }]);
});

test("window patch preserves empty-file names and untracked membership without line headers", () => {
  const files = parseWindowDiff(
    "diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000..e69de29\n",
    new Set(["empty.txt"]),
  );
  expect(files).toMatchObject([
    { path: "empty.txt", status: "added", untracked: true, additions: 0, deletions: 0 },
  ]);
});

test("window patch preserves rename destinations without text changes", () => {
  const files = parseWindowDiff(
    "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n",
  );
  expect(files).toMatchObject([{ path: "new.txt", status: "renamed", additions: 0, deletions: 0 }]);
});

test("window diff distinguishes tracked additions from untracked files for change groups", async () => {
  const { work } = createTestTicketRepo();
  writeFileSync(join(work, "staged.ts"), "export const staged = true;\n");
  gitTest(work, ["add", "staged.ts"]);
  writeFileSync(join(work, "new file.ts"), "export const untracked = true;\n");
  const files = await loadWindowDiff(work);
  expect(files.find((file) => file.path === "staged.ts")).toMatchObject({
    status: "added",
    untracked: false,
  });
  expect(files.find((file) => file.path === "new file.ts")).toMatchObject({
    status: "added",
    untracked: true,
  });
  expect(files.every((file) => file.pending === true)).toBe(true);
});

test("pending and branch scopes distinguish committable work from already committed review files", async () => {
  const { work } = createTestTicketRepo();
  gitTest(work, ["switch", "-c", "feature"]);
  writeFileSync(join(work, "committed.ts"), "export const done = true;\n");
  gitTest(work, ["add", "committed.ts"]);
  gitTest(work, ["commit", "-m", "feat: committed change"]);
  writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
  expect((await loadWindowDiff(work)).map((file) => file.path)).toEqual(["app.ts"]);
  const branch = await loadWindowDiff(work, "branch");
  expect(branch.find((file) => file.path === "committed.ts")?.pending).toBe(false);
  expect(branch.find((file) => file.path === "app.ts")?.pending).toBe(true);
});

test("in-process untracked patches preserve empty files, indentation, and missing final newlines", async () => {
  const { work } = createTestTicketRepo();
  writeFileSync(join(work, "empty.ts"), "");
  writeFileSync(join(work, "new.ts"), "  const nested = true;");
  const files = await loadWindowDiff(work);
  expect(files.find((file) => file.path === "empty.ts")).toMatchObject({
    status: "added",
    untracked: true,
    additions: 0,
  });
  expect(files.find((file) => file.path === "new.ts")).toMatchObject({
    status: "added",
    untracked: true,
    additions: 1,
  });
  expect(files.find((file) => file.path === "new.ts")?.patch).toContain("+  const nested = true;");
  expect(files.find((file) => file.path === "new.ts")?.patch).toContain(
    "No newline at end of file",
  );
});
