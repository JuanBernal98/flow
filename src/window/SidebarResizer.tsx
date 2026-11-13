/** @jsxImportSource react */
import { useEffect, useRef } from "react";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "./preferences";
import { prepareReviewResize } from "./reviewResize";

interface SidebarDrag {
  startX: number;
  startWidth: number;
  width: number;
  maximum: number;
  pointerId: number;
  panes: HTMLElement;
  restoreReview: () => void;
}

/** Clamp the latest pointer position without measuring layout again during the drag. */
function sidebarDragWidth(current: SidebarDrag, clientX: number) {
  return Math.round(
    Math.max(
      MIN_SIDEBAR_WIDTH,
      Math.min(current.maximum, current.startWidth + current.startX - clientX),
    ),
  );
}

/** Preview width through CSS once per frame; save React preferences only when dragging finishes. */
export function SidebarResizer({ onResize }: { onResize: (width: number) => void }) {
  const drag = useRef<SidebarDrag | null>(null);
  const frame = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (drag.current) {
        drag.current.panes.style.setProperty(
          "--files-sidebar-width",
          `${drag.current.startWidth}px`,
        );
        delete drag.current.panes.dataset.sidebarResizing;
        drag.current.restoreReview();
      }
    },
    [],
  );
  const preview = () => {
    frame.current = 0;
    if (drag.current)
      drag.current.panes.style.setProperty("--files-sidebar-width", `${drag.current.width}px`);
  };
  const finish = (cancelled: boolean) => {
    const current = drag.current;
    if (!current) return;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (cancelled) current.width = current.startWidth;
    preview();
    delete current.panes.dataset.sidebarResizing;
    current.restoreReview();
    drag.current = null;
    if (!cancelled) onResize(current.width);
  };
  return (
    <div
      className="sidebar-resizer"
      aria-hidden="true"
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const sidebar = event.currentTarget.closest<HTMLElement>(".files");
        const panes = event.currentTarget.closest<HTMLElement>(".panes");
        if (!sidebar || !panes) return;
        event.preventDefault();
        const width = sidebar.getBoundingClientRect().width;
        drag.current = {
          startX: event.clientX,
          startWidth: width,
          width,
          maximum: Math.min(
            MAX_SIDEBAR_WIDTH,
            Math.max(MIN_SIDEBAR_WIDTH, panes.clientWidth - 240),
          ),
          pointerId: event.pointerId,
          panes,
          restoreReview: prepareReviewResize(panes),
        };
        panes.dataset.sidebarResizing = "true";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        const width = sidebarDragWidth(current, event.clientX);
        if (width === current.width) return;
        current.width = width;
        if (!frame.current) frame.current = requestAnimationFrame(preview);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current.width = sidebarDragWidth(drag.current, event.clientX);
        finish(false);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(true);
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) finish(true);
      }}
    />
  );
}
