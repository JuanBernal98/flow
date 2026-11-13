/** @jsxImportSource react */
import { memo, useCallback, useMemo } from "react";
import type React from "react";
import { PatchDiff, type DiffLineAnnotation, type PatchDiffProps } from "@pierre/diffs/react";
import type { PersistedComment } from "../core/comments";
import type { WindowDiffFile } from "./data";
import { FileAccordion } from "./FileAccordion";
import { fileAnchor, hunkHoldsLine, type WindowHunk } from "./review";

/** One inline discussion and its optional editor. */
export interface DiffNote {
  comments: PersistedComment[];
  editing: boolean;
}

/** Memoized per-file rendering keeps unrelated discussions out of Pierre's update path. */
export const DiffFile = memo(function DiffFile({
  file,
  selected,
  onSelectFile,
  options,
  focused,
  comments,
  editing,
  replyingTo,
  renderNote,
  hunks,
  onFocusHunk,
}: {
  file: WindowDiffFile;
  selected: boolean;
  onSelectFile: (path: string, checked: boolean) => void;
  options: PatchDiffProps<DiffNote, undefined>["options"];
  focused: WindowHunk | null;
  comments: PersistedComment[];
  editing: boolean;
  replyingTo?: number | null;
  renderNote: (annotation: DiffLineAnnotation<DiffNote>) => React.ReactNode;
  hunks: WindowHunk[];
  onFocusHunk: (index: number) => void;
}) {
  const onSelectionChange = useCallback(
    (checked: boolean) => onSelectFile(file.path, checked),
    [onSelectFile, file.path],
  );
  const fileOptions = useMemo(
    () => ({
      ...options,
      onLineClick: ({ lineNumber }: { lineNumber: number }) => {
        const hunk = hunks.find((candidate) => hunkHoldsLine(candidate, file.path, lineNumber));
        if (hunk) onFocusHunk(hunk.index);
      },
    }),
    [options, hunks, file.path, onFocusHunk],
  );
  // The focused hunk shows as Pierre's line selection, on the new side like the terminal.
  const selectedLines = useMemo(
    () =>
      focused
        ? { start: focused.newRange[0], end: focused.newRange[1], side: "additions" as const }
        : null,
    [focused],
  );
  // One thread per commented line; the editor joins the thread on the focused hunk's last line.
  const notes = useMemo(() => {
    const threads = new Map<number, DiffNote>();
    for (const comment of comments) {
      if (comment.file !== file.path) continue;
      const thread = threads.get(comment.line) ?? { comments: [], editing: false };
      thread.comments.push(comment);
      threads.set(comment.line, thread);
    }
    if (editing && focused) {
      const line =
        comments.find((comment) => comment.id === replyingTo)?.line ?? focused.newRange[1];
      threads.set(line, { comments: threads.get(line)?.comments ?? [], editing: true });
    }
    return [...threads].map(([lineNumber, metadata]): DiffLineAnnotation<DiffNote> => ({
      side: "additions",
      lineNumber,
      metadata,
    }));
  }, [comments, file.path, editing, focused, replyingTo]);
  return (
    <FileAccordion
      id={fileAnchor(file.path)}
      path={file.path}
      selected={selected}
      selectionDisabled={file.pending === false}
      onSelectionChange={onSelectionChange}
      expandable={/^@@ /m.test(file.patch)}
      emptyLabel={
        file.status === "added" || file.status === "deleted" ? "Empty file" : "No text changes"
      }
      header={
        <>
          <span className="file-header-label">
            <span className={`file-header-name ${file.status}`}>
              {file.path.slice(file.path.lastIndexOf("/") + 1)}
            </span>
            <span className="file-header-dir">
              {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
            </span>
          </span>
          <span className="stat">
            <span className="add">+{file.additions}</span>{" "}
            <span className="del">-{file.deletions}</span>
          </span>
        </>
      }
    >
      <div className="code-block">
        <PatchDiff<DiffNote>
          patch={file.patch}
          options={fileOptions}
          selectedLines={selectedLines}
          lineAnnotations={notes}
          renderAnnotation={renderNote}
        />
      </div>
    </FileAccordion>
  );
});
