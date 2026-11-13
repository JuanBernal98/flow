import { describe, expect, test } from "bun:test";
import { groupWindowHunks, hunkHoldsLine, listWindowHunks, stepFile } from "./review";

const files = [
  { path: "a.ts", patch: "diff --git\n@@ -1,3 +1,4 @@\n x\n@@ -20,2 +21,5 @@ fn\n y\n" },
  { path: "b.ts", patch: "diff --git\n@@ -0,0 +1 @@\n+z\n" },
  { path: "c.ts", patch: "diff --git\n@@ -4,2 +4,0 @@\n-gone\n" },
];

test("a live edit preserves other files' hunk inputs and removes deleted files from the index", () => {
  const before = listWindowHunks(files);
  const grouped = groupWindowHunks(before);
  const changed = [{ ...files[0]!, patch: "@@ -1 +10 @@\n-old\n+new\n" }, ...files.slice(1)];
  const next = groupWindowHunks(listWindowHunks(changed, before), grouped);
  expect(next.get("a.ts")).not.toBe(grouped.get("a.ts"));
  // Removing an earlier hunk changes global indexes, so downstream inputs must update too.
  expect(next.get("b.ts")?.[0]?.index).toBe(1);
  const sameCount = [
    { ...files[0]!, patch: "@@ -1 +10 @@\n-old\n+new\n@@ -20 +21 @@\n-x\n+y\n" },
    ...files.slice(1),
  ];
  const stable = groupWindowHunks(listWindowHunks(sameCount, before), grouped);
  expect(stable.get("b.ts")).toBe(grouped.get("b.ts"));
  expect(stable.get("c.ts")).toBe(grouped.get("c.ts"));
  expect(groupWindowHunks(before.slice(0, 2), grouped).has("b.ts")).toBe(false);
});

describe("listWindowHunks", () => {
  test("lists every hunk in file order with its inclusive new-side range", () => {
    expect(listWindowHunks(files)).toEqual([
      { index: 0, path: "a.ts", newRange: [1, 4] },
      { index: 1, path: "a.ts", newRange: [21, 25] },
      { index: 2, path: "b.ts", newRange: [1, 1] },
      // A pure deletion keeps one line, like the terminal's hunkLineRange.
      { index: 3, path: "c.ts", newRange: [4, 4] },
    ]);
  });
});

describe("stepFile", () => {
  const hunks = listWindowHunks(files);
  test("jumps to the first hunk of the next or previous file and stops at the ends", () => {
    expect(stepFile(hunks, 0, 1)).toBe(2);
    expect(stepFile(hunks, 1, 1)).toBe(2);
    expect(stepFile(hunks, 3, 1)).toBe(3);
    expect(stepFile(hunks, 2, -1)).toBe(0);
    expect(stepFile(hunks, 1, -1)).toBe(0);
  });
});

describe("hunkHoldsLine", () => {
  test("matches lines inside a hunk of the same file only", () => {
    const [first] = listWindowHunks(files);
    expect(first && hunkHoldsLine(first, "a.ts", 4)).toBe(true);
    expect(first && hunkHoldsLine(first, "a.ts", 5)).toBe(false);
    expect(first && hunkHoldsLine(first, "b.ts", 2)).toBe(false);
  });
});
