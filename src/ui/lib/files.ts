import { basename, dirname } from "node:path/posix";
import type { FileDiffMetadata } from "@pierre/diffs";
import { normalizeDiffPath } from "../../core/diffPaths";
import type { DiffFile } from "../../core/types";

export interface FileListEntry {
  kind: "file";
  id: string;
  name: string;
  depth: number;
  parentPath: string;
  agentCommentsText: string | null;
  additionsText: string | null;
  deletionsText: string | null;
  changeType: FileDiffMetadata["type"];
  isUntracked: boolean;
}

export interface FileGroupEntry {
  kind: "group";
  id: string;
  label: string;
  path: string;
  parentPath: string;
  depth: number;
}

export type SidebarEntry = FileListEntry | FileGroupEntry;

/** Build the filename-first label shown inside one sidebar row. */
function sidebarFileName(file: DiffFile) {
  const path = normalizeDiffPath(file.path) ?? file.path;
  const previousPath = normalizeDiffPath(file.previousPath);

  if (!previousPath || previousPath === path) {
    return basename(path);
  }

  const previousName = basename(previousPath);
  const nextName = basename(path);
  return previousName === nextName ? nextName : `${previousName} -> ${nextName}`;
}

/** Hide zero-value file stats so the sidebar only shows real line deltas. */
function formatSidebarStat(prefix: "+" | "-", value: number, truncated = false) {
  return value > 0 ? `${prefix}${value}${truncated ? "+" : ""}` : null;
}

/** Build the visible stats badges for one sidebar row.
 * Keep the agent-note badge first so it reads as review context before line churn.
 */
export function sidebarEntryStats(
  entry: Pick<FileListEntry, "agentCommentsText" | "additionsText" | "deletionsText">,
) {
  const stats: Array<{ kind: "agent-comment" | "addition" | "deletion"; text: string }> = [];

  if (entry.agentCommentsText) {
    stats.push({ kind: "agent-comment", text: entry.agentCommentsText });
  }

  if (entry.additionsText) {
    stats.push({ kind: "addition", text: entry.additionsText });
  }

  if (entry.deletionsText) {
    stats.push({ kind: "deletion", text: entry.deletionsText });
  }

  return stats;
}

/** Measure the rendered sidebar stats width, including the space between badges. */
export function sidebarEntryStatsWidth(
  entry: Pick<FileListEntry, "agentCommentsText" | "additionsText" | "deletionsText">,
) {
  return sidebarEntryStats(entry).reduce(
    (width, stat, index) => width + stat.text.length + (index > 0 ? 1 : 0),
    0,
  );
}

/** Apply the app's file filter query to the visible review stream. */
export function filterReviewFiles(files: DiffFile[], query: string): DiffFile[] {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return files;
  }

  return files.filter((file) => {
    const haystack = [normalizeDiffPath(file.path), normalizeDiffPath(file.previousPath)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(trimmedQuery);
  });
}

/** Build the grouped sidebar entries while preserving the review stream order. */
export function buildSidebarEntries(files: DiffFile[]): SidebarEntry[] {
  const entries: SidebarEntry[] = [];
  let activeParts: string[] = [];

  files.forEach((file, index) => {
    const path = normalizeDiffPath(file.path) ?? file.path;
    const group = dirname(path);
    const parts = group === "." ? [] : group.split("/");
    let sharedDepth = 0;
    while (sharedDepth < parts.length && activeParts[sharedDepth] === parts[sharedDepth]) {
      sharedDepth += 1;
    }
    for (let depth = sharedDepth; depth < parts.length; depth += 1) {
      const directoryPath = parts.slice(0, depth + 1).join("/");
      entries.push({
        kind: "group",
        id: `group:${directoryPath}:${index}`,
        label: `${parts[depth]}/`,
        path: directoryPath,
        parentPath: parts.slice(0, depth).join("/"),
        depth,
      });
    }
    activeParts = parts;

    const agentCommentCount = file.annotations.length;

    entries.push({
      kind: "file",
      id: file.id,
      name: sidebarFileName(file),
      depth: parts.length,
      parentPath: parts.join("/"),
      agentCommentsText: agentCommentCount > 0 ? `*${agentCommentCount}` : null,
      additionsText: formatSidebarStat("+", file.stats.additions, file.statsTruncated),
      deletionsText: formatSidebarStat("-", file.stats.deletions),
      changeType: file.metadata.type,
      isUntracked: file.isUntracked ?? false,
    });
  });

  return entries;
}

/** List directory ancestors from the root to the entry's immediate parent. */
export function sidebarAncestorPaths(entry: SidebarEntry): string[] {
  const parts = entry.parentPath ? entry.parentPath.split("/") : [];
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Fold navigation rows without changing the files in the review stream. */
export function visibleSidebarEntries(
  entries: SidebarEntry[],
  collapsedPaths: ReadonlySet<string>,
): SidebarEntry[] {
  return entries.filter(
    (entry) => !sidebarAncestorPaths(entry).some((path) => collapsedPaths.has(path)),
  );
}

/** Split file label into filename and state label for styled rendering. */
export function fileLabelParts(file: DiffFile | undefined): {
  filename: string;
  stateLabel: string | null;
} {
  if (!file) {
    return { filename: "No file selected", stateLabel: null };
  }

  const path = normalizeDiffPath(file.path) ?? file.path;
  const previousPath = normalizeDiffPath(file.previousPath);
  const baseLabel = previousPath && previousPath !== path ? `${previousPath} -> ${path}` : path;

  // Determine state label for special cases
  let stateLabel: string | null = null;
  if (file.isUntracked) {
    stateLabel = " (untracked)";
  } else if (file.metadata.type === "new") {
    stateLabel = " (new)";
  } else if (file.metadata.type === "deleted") {
    stateLabel = " (deleted)";
  }

  return { filename: baseLabel, stateLabel };
}
