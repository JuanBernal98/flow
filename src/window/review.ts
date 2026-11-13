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

/** Index the stream once and preserve unchanged per-file inputs to memoized diff components. */
export function groupWindowHunks(
  hunks: readonly WindowHunk[],
  previous: ReadonlyMap<string, WindowHunk[]> = new Map(),
) {
  const grouped = new Map<string, WindowHunk[]>();
  for (const hunk of hunks) {
    const group = grouped.get(hunk.path) ?? [];
    group.push(hunk);
    grouped.set(hunk.path, group);
  }
  for (const [path, group] of grouped) {
    const before = previous.get(path);
    if (
      before &&
      group.length === before.length &&
      group.every((hunk, index) => hunk === before[index])
    )
      grouped.set(path, before);
  }
  return grouped;
}

/** List the hunks of each patch, file by file, in the order the diff shows them. */
export function listWindowHunks(
  files: readonly { path: string; patch: string }[],
  previous: WindowHunk[] = [],
): WindowHunk[] {
  const hunks: WindowHunk[] = [];
  for (const file of files) {
    for (const match of file.patch.matchAll(HUNK_HEADER)) {
      const start = Number(match[3]);
      const count = Number(match[4] ?? "1");
      const hunk: WindowHunk = {
        index: hunks.length,
        path: file.path,
        newRange: [start, Math.max(start, start + Math.max(count, 1) - 1)],
      };
      const before = previous[hunk.index];
      hunks.push(
        before &&
          before.path === hunk.path &&
          before.newRange[0] === hunk.newRange[0] &&
          before.newRange[1] === hunk.newRange[1]
          ? before
          : hunk,
      );
    }
  }
  return hunks.length === previous.length && hunks.every((hunk, index) => hunk === previous[index])
    ? previous
    : hunks;
}

/** Retain the current file and nearest hunk when live edits insert or remove earlier hunks. */
export function refreshedHunkIndex(
  previous: WindowHunk | null,
  hunks: readonly WindowHunk[],
  fallback: number,
) {
  if (previous) {
    const candidates = hunks.filter((hunk) => hunk.path === previous.path);
    const nearest = candidates.reduce<WindowHunk | null>(
      (best, hunk) =>
        !best ||
        Math.abs(hunk.newRange[0] - previous.newRange[0]) <
          Math.abs(best.newRange[0] - previous.newRange[0])
          ? hunk
          : best,
      null,
    );
    if (nearest) return nearest.index;
  }
  return Math.max(0, Math.min(fallback, hunks.length - 1));
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

/** Stable DOM target shared by diff rendering and sidebar navigation. */
export function fileAnchor(path: string) {
  return `file-${path}`;
}
