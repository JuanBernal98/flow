import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDiffFile } from "../../test/helpers/diff-helpers";
import { readFocusRequest, resolveFocusTarget, writeFocusRequest } from "./focusRequests";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("focus requests", () => {
  test("round-trip through .flow/focus.json, newest wins, no temp files left", () => {
    const root = mkdtempSync(join(tmpdir(), "focus-requests-"));
    roots.push(root);
    expect(readFocusRequest(root)).toBeNull();

    const first = writeFocusRequest(root, "src/a.ts", 12);
    const second = writeFocusRequest(root, "src/b.ts");

    expect(readFocusRequest(root)).toEqual(second);
    expect(second.id).not.toBe(first.id);
    expect(second.line).toBeUndefined();
    expect(readdirSync(join(root, ".flow"))).toEqual(["focus.json"]);

    writeFileSync(join(root, ".flow", "focus.json"), "{ broken");
    expect(readFocusRequest(root)).toBeNull();
  });

  test("resolve to the hunk holding the line, the next one, or the last one", () => {
    const before = Array.from({ length: 40 }, (_, index) => `const v${index + 1} = ${index + 1};`);
    const after = before.map((line, index) =>
      index === 4 || index === 29 ? line.replace(/= \d+/, "= 0") : line,
    );
    const file = createTestDiffFile({
      id: "f",
      path: "src/a.ts",
      before: `${before.join("\n")}\n`,
      after: `${after.join("\n")}\n`,
      context: 1,
    });

    expect(resolveFocusTarget([file], { file: "src/a.ts", line: 5 })).toEqual({
      fileId: "f",
      hunkIndex: 0,
    });
    expect(resolveFocusTarget([file], { file: "src/a.ts", line: 20 })).toEqual({
      fileId: "f",
      hunkIndex: 1,
    });
    expect(resolveFocusTarget([file], { file: "src/a.ts", line: 39 })).toEqual({
      fileId: "f",
      hunkIndex: 1,
    });
    expect(resolveFocusTarget([file], { file: "src/a.ts" })).toEqual({ fileId: "f", hunkIndex: 0 });
    expect(resolveFocusTarget([file], { file: "src/missing.ts" })).toBeNull();
  });
});
