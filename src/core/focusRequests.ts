/**
 * Focus requests travel the other way from `requests.json`: the coding agent asks the open review
 * to show a file (and line), and the TUI jumps there. They live in their own `.flow/focus.json`
 * so an agent write can never overwrite a request flow left for the agent.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FLOW_DIR } from "./flowPaths";
import { hunkLineRange } from "./hunkRange";
import type { DiffFile } from "./types";

const FOCUS_FILENAME = "focus.json";

const FocusFileSchema = z.object({
  request: z.object({
    id: z.string(),
    file: z.string().min(1),
    line: z.number().int().positive().optional(),
  }),
});

export interface FocusRequest {
  /** Unique per write, so the TUI acts on each request once. */
  id: string;
  /** Repo-relative path, as the review shows it. */
  file: string;
  /** 1-based line in the file's new version; omitted to show the file's first hunk. */
  line?: number;
}

/** Ask the open review to show a file, replacing any earlier focus request. */
export function writeFocusRequest(repoRoot: string, file: string, line?: number) {
  const dir = join(repoRoot, FLOW_DIR);
  mkdirSync(dir, { recursive: true });
  const request: FocusRequest = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    ...(line === undefined ? {} : { line }),
  };
  // Same-directory temp file plus rename, so the TUI never reads a half-written request.
  const tempPath = join(dir, `.${FOCUS_FILENAME}.${process.pid}.${request.id}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify({ schema: 1, request }, null, 2)}\n`, "utf8");
  renameSync(tempPath, join(dir, FOCUS_FILENAME));
  return request;
}

/** Read the newest focus request, or null when there is none or it is unreadable. */
export function readFocusRequest(repoRoot: string): FocusRequest | null {
  const path = join(repoRoot, FLOW_DIR, FOCUS_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = FocusFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data.request : null;
  } catch {
    return null;
  }
}

/**
 * Map a request onto the review: the file by its current or previous path, and the hunk that holds
 * the line, else the first hunk after it, else the last one. Null when the file is not in review.
 */
export function resolveFocusTarget(
  files: DiffFile[],
  request: Pick<FocusRequest, "file" | "line">,
) {
  const file = files.find((candidate) =>
    [candidate.path, candidate.previousPath].includes(request.file),
  );
  if (!file) {
    return null;
  }
  const ranges = file.metadata.hunks.map((hunk) => hunkLineRange(hunk).newRange);
  const line = request.line;
  if (line === undefined || ranges.length === 0) {
    return { fileId: file.id, hunkIndex: 0 };
  }
  const containing = ranges.findIndex(([start, end]) => line >= start && line <= end);
  const after = ranges.findIndex(([start]) => start > line);
  const hunkIndex = containing >= 0 ? containing : after >= 0 ? after : ranges.length - 1;
  return { fileId: file.id, hunkIndex };
}
