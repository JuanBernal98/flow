/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import type { DiffLineAnnotation, PatchDiffProps } from "@pierre/diffs/react";
import { DiffFile, type DiffNote } from "../../src/window/DiffFile";
import { CommentThread } from "../../src/window/CommentThread";
import { CommentEditor } from "../../src/window/CommentEditor";
import { groupFileComments, EMPTY_FILE_COMMENTS } from "../../src/window/fileComments";
import type { PersistedComment } from "../../src/core/comments";
import type { WindowDiffFile } from "../../src/window/data";
import { REVIEW_DIFF_CSS } from "../../src/window/reviewStyles";
import { listWindowHunks } from "../../src/window/review";

const testFiles: WindowDiffFile[] = ["comment-a.ts", "comment-b.ts"].map((path) => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n-export const a = 1;\n+export const a = 2;\n export const b = true;\n`,
}));
const testHunks = listWindowHunks(testFiles);
const testRenders = [0, 0];
const testOptions = testFiles.map((_, index): PatchDiffProps<DiffNote, undefined>["options"] => ({
  diffStyle: index === 0 ? "split" : "unified",
  disableFileHeader: true,
  overflow: "scroll",
  unsafeCSS: REVIEW_DIFF_CSS,
  onPostRender: () => {
    testRenders[index] = (testRenders[index] ?? 0) + 1;
  },
}));
/** Stable handlers keep this fixture on the same memoization path as the app. */
function onTestCommentAction() {}
let onTestStartComment = onTestCommentAction;
let testReplyId: number | null = null;
/** Render the production thread and editor inside Pierre's real annotation slot. */
function renderTestComment(annotation: DiffLineAnnotation<DiffNote>) {
  return (
    <CommentThread
      userName="Alex"
      comments={annotation.metadata.comments}
      editor={
        <CommentEditor
          active={annotation.metadata.editing}
          onActivate={() => {
            testReplyId = annotation.metadata.comments.at(-1)?.id ?? null;
            onTestStartComment();
          }}
          onSave={onTestCommentAction}
          onCancel={onTestCommentAction}
        />
      }
    />
  );
}

/** Exercise focus, inline positioning and updates through the real per-file renderer. */
export function TestInlineComments() {
  const [editing, setEditing] = useState(false);
  onTestStartComment = () => setEditing(true);
  const [comments, setComments] = useState<PersistedComment[]>(() =>
    testFiles.map((file, index) => ({
      id: index + 1,
      file: file.path,
      line: 2,
      range: [1, 2],
      anchor: "0000000000000000",
      body: "Review this code",
      createdAt: new Date().toISOString(),
    })),
  );
  const previous = useRef(new Map<string, PersistedComment[]>());
  const grouped = useMemo(() => {
    const next = groupFileComments(comments, previous.current);
    previous.current = next;
    return next;
  }, [comments]);
  useEffect(() => {
    let baseline = 0;
    let focused = false;
    let visible = false;
    let originalField: HTMLTextAreaElement | null = null;
    const timers = [
      setTimeout(() => {
        originalField = document.querySelector<HTMLTextAreaElement>("#comment-review textarea")!;
        originalField.focus();
      }, 500),
      setTimeout(() => {
        const field = document.querySelector<HTMLTextAreaElement>("#comment-review textarea")!;
        const bounds = document.getElementById("comment-review")!.getBoundingClientRect();
        const rect = field.getBoundingClientRect();
        focused = document.activeElement === field;
        visible = rect.top >= bounds.top && rect.bottom <= bounds.bottom;
        baseline = testRenders[1]!;
        setComments(
          (current) =>
            JSON.parse(
              JSON.stringify(
                current.map((comment, index) =>
                  index === 0
                    ? {
                        ...comment,
                        replies: [
                          {
                            author: "agent",
                            agentName: "Codex",
                            body: "Fixed",
                            createdAt: new Date().toISOString(),
                          },
                        ],
                      }
                    : comment,
                ),
              ),
            ) as PersistedComment[],
        );
      }, 1200),
      setTimeout(() => {
        const thread = document.querySelector<HTMLElement>("#comment-review .thread")!;
        const style = getComputedStyle(thread);
        const messages = [...thread.querySelectorAll<HTMLElement>(".thread-message")];
        const shadow = thread.closest("diffs-container")!.shadowRoot!;
        const gutter = shadow.querySelector('[data-gutter-buffer="annotation"]')!;
        const content = shadow.querySelector("[data-content]")!;
        const annotation = shadow.querySelector("[data-line-annotation]")!;
        const result = document.createElement("pre");
        result.id = "comment-result";
        result.textContent = JSON.stringify({
          focused,
          visible,
          sameField: document.querySelector("#comment-review textarea") === originalField,
          unrelatedRenders: testRenders[1]! - baseline,
          margin: style.margin,
          border: style.borderTopWidth,
          gutterMatches:
            getComputedStyle(gutter).backgroundColor ===
            getComputedStyle(shadow.querySelector("pre")!).backgroundColor,
          codeMatches:
            getComputedStyle(annotation).backgroundColor ===
            getComputedStyle(content).backgroundColor,
          bodySize: getComputedStyle(thread.querySelector(".thread-body")!).fontSize,
          metaSize: getComputedStyle(thread.querySelector(".thread-meta")!).fontSize,
          separator: getComputedStyle(messages[1]!).borderTopWidth,
          matchingBorders: getComputedStyle(messages[1]!).borderTopColor === style.borderTopColor,
          placeholder:
            document.getElementById("file-comment-b.ts")!.querySelector("textarea[placeholder]") !==
            null,
          noAvatars: thread.querySelector(".avatar") === null,
          sameBackground:
            new Set(messages.map((message) => getComputedStyle(message).backgroundColor)).size ===
            1,
          radius: style.borderRadius,
          dates: thread.querySelectorAll("time").length,
          insideCode: thread.closest(".code-block") !== null,
        });
        document.body.append(result);
      }, 2200),
      setTimeout(() => {
        document.querySelector<HTMLTextAreaElement>("#comment-review textarea")!.focus();
        setComments((current) =>
          current.map((comment, index) =>
            index === 0
              ? {
                  ...comment,
                  replies: [
                    ...(comment.replies ?? []),
                    { author: "user", body: "What about the other case?" },
                  ],
                }
              : comment,
          ),
        );
      }, 2500),
      setTimeout(() => {
        const thread = document.querySelector<HTMLElement>("#comment-review .thread")!;
        const result = document.createElement("pre");
        result.id = "conversation-result";
        result.textContent = JSON.stringify({
          replyId: testReplyId,
          users: thread.querySelectorAll(".thread-message.user").length,
          agents: thread.querySelectorAll(".thread-message.agent").length,
          pending: thread.textContent?.includes("Awaiting reply"),
          sameField: document.querySelector("#comment-review textarea") === originalField,
        });
        document.body.append(result);
      }, 3300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div id="comment-review" style={{ width: 900, height: 300, overflow: "auto" }}>
      <div style={{ height: 400 }} />
      {testFiles.map((file, index) => (
        <DiffFile
          key={file.path}
          file={file}
          selected={false}
          onSelectFile={onTestCommentAction}
          options={testOptions[index]}
          focused={index === 0 && editing ? testHunks[0]! : null}
          comments={grouped.get(file.path) ?? EMPTY_FILE_COMMENTS}
          editing={index === 0 && editing}
          renderNote={renderTestComment}
          hunks={testHunks}
          onFocusHunk={onTestCommentAction}
        />
      ))}
    </div>
  );
}
