/**
 * The window's review stream: every hunk of every changed file in order, the unit the keyboard
 * focus moves through, like the terminal's hunk cursor.
 */

export interface WindowHunk {
  /** Position in the review stream. */
  index: number;
  path: string;
  /** Inclusive new-side lines, as the terminal's `hunkLineRange` computes them. */
  newRange: [number, number];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

/** List the hunks of each patch, file by file, in the order the diff shows them. */
export function listWindowHunks(files: readonly { path: string; patch: string }[]): WindowHunk[] {
  const hunks: WindowHunk[] = [];
  for (const file of files) {
    for (const match of file.patch.matchAll(HUNK_HEADER)) {
      const start = Number(match[3]);
      const count = Number(match[4] ?? "1");
      hunks.push({
        index: hunks.length,
        path: file.path,
        newRange: [start, Math.max(start, start + Math.max(count, 1) - 1)],
      });
    }
  }
  return hunks;
}

/** The first hunk of the next (or previous) file, or the current one at either end. */
export function stepFile(hunks: readonly WindowHunk[], current: number, direction: 1 | -1) {
  const path = hunks[current]?.path;
  if (direction === 1) {
    const next = hunks.findIndex((hunk, index) => index > current && hunk.path !== path);
    return next === -1 ? current : next;
  }
  const previousPath = hunks.findLast((hunk, index) => index < current && hunk.path !== path)?.path;
  if (previousPath === undefined) return hunks.findIndex((hunk) => hunk.path === path);
  return hunks.findIndex((hunk) => hunk.path === previousPath);
}

/** Whether a comment's line falls inside a hunk. */
export function hunkHoldsLine(hunk: WindowHunk, path: string, line: number) {
  return hunk.path === path && line >= hunk.newRange[0] && line <= hunk.newRange[1];
}
