import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Read branch identity without spawning Git on every comments poll, including linked worktrees. */
export function readCommentBranch(repoRoot: string): string | undefined {
  try {
    let gitDir = join(repoRoot, ".git");
    if (statSync(gitDir).isFile()) {
      const target = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, "utf8"))?.[1]?.trim();
      if (!target) return undefined;
      gitDir = resolve(repoRoot, target);
    }
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: refs/heads/")) return head.slice("ref: refs/heads/".length);
    return /^[0-9a-f]{40,64}$/.test(head) ? `detached:${head}` : undefined;
  } catch {
    return undefined;
  }
}
