import { expect, test } from "bun:test";
import { reconcileDiffFiles } from "./diffRefresh";
import type { WindowDiffFile } from "./data";
import { listWindowHunks, refreshedHunkIndex } from "./review";

/** Minimal diff file used to verify refresh identity and cursor behavior. */
function createTestFile(path: string, start = 1): WindowDiffFile {
  return {
    path,
    patch: `@@ -${start} +${start} @@\n-before\n+after\n`,
    status: "modified",
    additions: 1,
    deletions: 1,
  };
}

test("unchanged refreshes preserve file and hunk identities; changed files update independently", () => {
  const previous = [createTestFile("a.ts"), createTestFile("b.ts")];
  expect(
    reconcileDiffFiles(
      previous,
      previous.map((file) => ({ ...file })),
    ),
  ).toBe(previous);
  const hunks = listWindowHunks(previous);
  expect(listWindowHunks(previous, hunks)).toBe(hunks);
  const next = reconcileDiffFiles(previous, [createTestFile("a.ts", 20), createTestFile("b.ts")]);
  expect(next[0]).not.toBe(previous[0]);
  expect(next[1]).toBe(previous[1]);
  expect(listWindowHunks(next, hunks)[1]).toBe(hunks[1]);
});

test("the cursor stays in its file when earlier files or hunks disappear", () => {
  const hunks = listWindowHunks([createTestFile("a.ts"), createTestFile("b.ts", 30)]);
  expect(refreshedHunkIndex(hunks[1]!, listWindowHunks([createTestFile("b.ts", 31)]), 1)).toBe(0);
  expect(refreshedHunkIndex(hunks[1]!, [], 1)).toBe(0);
});
