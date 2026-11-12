import { basename, dirname } from "node:path/posix";
import type { FileDiffMetadata } from "@pierre/diffs";
import { normalizeDiffPath } from "../../core/diffPaths";
import type { DiffFile } from "../../core/types";

/** One file row in the flat sidebar list. */
export interface SidebarEntry {
  id: string;
  name: string;
  /** Folder shown beside the name only when another changed file shares that name. */
  folderHint: string | null;
  agentCommentsText: string | null;
  stats: DiffFile["stats"];
  statsTruncated: boolean;
  changeType: FileDiffMetadata["type"];
  isUntracked: boolean;
}

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

/**
 * Build the flat sidebar list in review stream order: filenames only, with the folder added as a
 * hint just for names that would otherwise be ambiguous.
 */
export function buildSidebarEntries(files: DiffFile[]): SidebarEntry[] {
  const paths = files.map((file) => normalizeDiffPath(file.path) ?? file.path);
  const nameCounts = new Map<string, number>();
  for (const path of paths) {
    nameCounts.set(basename(path), (nameCounts.get(basename(path)) ?? 0) + 1);
  }

  return files.map((file, index) => {
    const path = paths[index] ?? file.path;
    const folder = dirname(path);
    const agentCommentCount = file.annotations.length;
    return {
      id: file.id,
      name: sidebarFileName(file),
      folderHint: (nameCounts.get(basename(path)) ?? 0) > 1 && folder !== "." ? folder : null,
      agentCommentsText: agentCommentCount > 0 ? `*${agentCommentCount}` : null,
      stats: file.stats,
      statsTruncated: file.statsTruncated ?? false,
      changeType: file.metadata.type,
      isUntracked: file.isUntracked ?? false,
    };
  });
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
