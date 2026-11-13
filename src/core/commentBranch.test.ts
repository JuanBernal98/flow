import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCommentBranch } from "./commentBranch";

test("linked worktrees and detached checkouts have their own discussion identity", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-comment-branch-"));
  try {
    mkdirSync(join(root, "metadata"));
    writeFileSync(join(root, ".git"), "gitdir: metadata\n");
    writeFileSync(join(root, "metadata", "HEAD"), "ref: refs/heads/feature/linked\n");
    expect(readCommentBranch(root)).toBe("feature/linked");
    const head = "a".repeat(40);
    writeFileSync(join(root, "metadata", "HEAD"), `${head}\n`);
    expect(readCommentBranch(root)).toBe(`detached:${head}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
