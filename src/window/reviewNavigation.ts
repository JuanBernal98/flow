import type { PersistedComment } from "../core/comments";
import { unreadCommentAnchor } from "../core/commentThread";
import { fileAnchor, type WindowHunk } from "./review";
import { revealFileAccordion } from "./FileAccordion";

export type ReviewNavigation =
  | { kind: "file"; path: string }
  | { kind: "hunk"; index: number }
  | { kind: "comment"; comment: PersistedComment };

/** One cancellable scroll request for file, hunk and discussion navigation, including repeated clicks. */
export function navigateReview(
  container: HTMLElement | null,
  request: ReviewNavigation | null,
  hunks: readonly WindowHunk[],
) {
  if (!container || !request) return () => {};
  const hunk = request.kind === "hunk" ? hunks[request.index] : null;
  const path =
    request.kind === "file"
      ? request.path
      : request.kind === "comment"
        ? request.comment.file
        : hunk?.path;
  if (!path) return () => {};
  const file = document.getElementById(fileAnchor(path));
  if (!file || !container.contains(file)) return () => {};
  revealFileAccordion(file);
  let frame = 0;
  let attempts = 0;
  let cancelled = false;
  /** Wait for Pierre's selected row, then scroll only the review pane. */
  const reveal = () => {
    if (cancelled) return;
    const target =
      request.kind === "file"
        ? file
        : request.kind === "comment"
          ? document.getElementById(unreadCommentAnchor(request.comment))
          : file
              .querySelector("diffs-container")
              ?.shadowRoot?.querySelector(
                `[data-selected-line][data-column-number="${hunk?.newRange[0]}"]`,
              );
    if (!target && attempts++ < 30) {
      frame = requestAnimationFrame(reveal);
      return;
    }
    const bounds = (target ?? file).getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    const header = file.querySelector(".file-header")?.getBoundingClientRect().height ?? 0;
    let offset = 0;
    if (request.kind === "file" || !target) offset = bounds.top - viewport.top;
    else if (request.kind === "comment")
      offset = bounds.top - viewport.top - (viewport.height - bounds.height) / 2;
    else if (bounds.top < viewport.top + header) offset = bounds.top - viewport.top - header;
    else if (bounds.bottom > viewport.bottom) offset = bounds.bottom - viewport.bottom;
    if (offset) container.scrollTop += offset;
  };
  const cancel = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
  };
  // User input always wins over a delayed renderer response.
  container.addEventListener("wheel", cancel, { passive: true });
  container.addEventListener("pointerdown", cancel);
  reveal();
  return () => {
    cancel();
    container.removeEventListener("wheel", cancel);
    container.removeEventListener("pointerdown", cancel);
  };
}
