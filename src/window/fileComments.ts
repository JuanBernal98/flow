import type { PersistedComment } from "../core/comments";

export const EMPTY_FILE_COMMENTS: PersistedComment[] = [];

/** Preserve each unchanged file's comments so one reply cannot redraw the whole review. */
export function groupFileComments(
  comments: readonly PersistedComment[],
  previous: ReadonlyMap<string, PersistedComment[]>,
) {
  const grouped = new Map<string, PersistedComment[]>();
  for (const comment of comments) {
    const group = grouped.get(comment.file) ?? [];
    group.push(comment);
    grouped.set(comment.file, group);
  }
  for (const [path, group] of grouped) {
    const before = previous.get(path);
    if (before && JSON.stringify(before) === JSON.stringify(group)) grouped.set(path, before);
  }
  return grouped;
}
