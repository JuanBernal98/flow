/** @jsxImportSource react */
import type React from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { DiffLineAnnotation } from "@pierre/diffs/react";
import type { PersistedComment } from "../core/comments";
import type { WindowDiffFile, WindowDiffScope, WindowTheme } from "./data";
import { hunkHoldsLine, type WindowHunk } from "./review";
import { reviewGutterWidth } from "./reviewLayout";
import { REVIEW_DIFF_CSS } from "./reviewStyles";
import { applyIndentGuides } from "./indentGuides";
import { observeStickyFileHeaders } from "./stickyFileHeaders";
import { CommentThread } from "./CommentThread";
import { CommentEditor } from "./CommentEditor";
import { DiffFile, type DiffNote } from "./DiffFile";
import { EMPTY_FILE_COMMENTS, groupFileComments } from "./fileComments";
import { navigateReview, type ReviewNavigation } from "./reviewNavigation";
export type DiffStyle = "split" | "unified";

const EMPTY_FILE_HUNKS: WindowHunk[] = [];

/** Coordinate the review stream while each file owns its diff rendering and inline discussions. */
export const DiffPane = memo(function DiffPane({
  navigation,
  files,
  selectedPaths,
  onSelectFile,
  diffStyle,
  scope,
  theme,
  hunks,
  hunksByFile,
  focusedHunk,
  comments,
  editing,
  replyingTo,
  onSaveComment,
  onCancelComment,
  onStartComment,
  onReplyComment,
  onReadComment,
  onFocusHunk,
  userName,
}: {
  navigation: ReviewNavigation | null;
  files: WindowDiffFile[] | null;
  selectedPaths: ReadonlySet<string>;
  onSelectFile: (path: string, checked: boolean) => void;
  diffStyle: DiffStyle;
  scope: WindowDiffScope;
  theme: WindowTheme | null;
  hunks: WindowHunk[];
  hunksByFile: ReadonlyMap<string, WindowHunk[]>;
  focusedHunk: WindowHunk | null;
  comments: PersistedComment[];
  editing: boolean;
  replyingTo: number | null;
  onSaveComment: (body: string) => void;
  onCancelComment: () => void;
  onStartComment: (index: number) => void;
  onReplyComment: (comment: PersistedComment) => void;
  onReadComment: (comment: PersistedComment) => void;
  onFocusHunk: (index: number) => void;
  userName: string;
}) {
  const codeTheme = theme?.codeTheme;
  const previousComments = useRef(new Map<string, PersistedComment[]>());
  const fileComments = useMemo(() => {
    const grouped = groupFileComments(comments, previousComments.current);
    previousComments.current = grouped;
    return grouped;
  }, [comments]);
  const appearance = theme?.appearance;
  useEffect(
    () => observeStickyFileHeaders(document.querySelector<HTMLElement>(".diff")),
    [files, codeTheme],
  );
  const gutter = useMemo(
    () => ({ "--gutter-width": reviewGutterWidth(files ?? []) }) as React.CSSProperties,
    [files],
  );
  const options = useMemo(
    () =>
      ({
        theme: codeTheme ?? { dark: "pierre-dark", light: "pierre-light" },
        themeType: appearance ?? "system",
        diffStyle,
        overflow: "scroll",
        disableFileHeader: true,
        diffIndicators: "none",
        hunkSeparators: "simple",
        unsafeCSS: REVIEW_DIFF_CSS,
        onPostRender: applyIndentGuides,
      }) as const,
    [diffStyle, codeTheme, appearance],
  );

  const navigationHunks = useRef(hunks);
  useLayoutEffect(() => {
    navigationHunks.current = hunks;
  }, [hunks]);
  useLayoutEffect(
    () =>
      navigateReview(
        document.querySelector<HTMLElement>(".diff"),
        navigation,
        navigationHunks.current,
      ),
    [navigation],
  );

  const commentActions = useRef({ onSaveComment, onReplyComment });
  useLayoutEffect(() => {
    commentActions.current = { onSaveComment, onReplyComment };
  }, [onSaveComment, onReplyComment]);
  const saveCurrentComment = useCallback(
    (body: string) => commentActions.current.onSaveComment(body),
    [],
  );
  const replyToCurrentComment = useCallback(
    (comment: PersistedComment) => commentActions.current.onReplyComment(comment),
    [],
  );
  const renderNote = useCallback(
    (annotation: DiffLineAnnotation<DiffNote>) => {
      const note = annotation.metadata;
      const path = note.comments[0]?.file;
      return (
        <CommentThread
          comments={note.comments}
          userName={userName}
          onRead={onReadComment}
          editor={
            <CommentEditor
              active={note.editing}
              onSave={saveCurrentComment}
              onCancel={onCancelComment}
              onActivate={() => {
                const comment = note.comments.at(-1);
                if (comment) {
                  replyToCurrentComment(comment);
                  return;
                }
                const hunk = navigationHunks.current.find((candidate) =>
                  hunkHoldsLine(candidate, path ?? "", annotation.lineNumber),
                );
                if (hunk) onStartComment(hunk.index);
              }}
            />
          }
        />
      );
    },
    [
      saveCurrentComment,
      onCancelComment,
      onStartComment,
      replyToCurrentComment,
      onReadComment,
      userName,
    ],
  );

  // Wait for the theme so code is not highlighted twice on launch.
  if (files === null || theme === null) {
    return <main className="diff" />;
  }
  return (
    <main className="diff" style={gutter}>
      {files.length === 0 ? (
        <p className="empty">
          {scope === "pending" ? "No pending changes." : "No changes on this branch yet."}
        </p>
      ) : null}
      {files.map((file) => {
        const focused = focusedHunk?.path === file.path ? focusedHunk : null;
        return (
          <DiffFile
            key={file.path}
            file={file}
            selected={selectedPaths.has(file.path)}
            onSelectFile={onSelectFile}
            options={options}
            focused={focused}
            comments={fileComments.get(file.path) ?? EMPTY_FILE_COMMENTS}
            editing={editing && focused !== null}
            replyingTo={editing && focused !== null ? replyingTo : null}
            renderNote={renderNote}
            hunks={hunksByFile.get(file.path) ?? EMPTY_FILE_HUNKS}
            onFocusHunk={onFocusHunk}
          />
        );
      })}
    </main>
  );
});
