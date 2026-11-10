import type { MouseEvent as TuiMouseEvent } from "@opentui/core";

/** Keep pane resizing available at a borderless boundary. */
export function PaneDivider({
  dividerHitLeft,
  dividerHitWidth,
  onMouseDown,
  onMouseDrag,
  onMouseDragEnd,
  onMouseUp,
}: {
  dividerHitLeft: number;
  dividerHitWidth: number;
  onMouseDown: (event: TuiMouseEvent) => void;
  onMouseDrag: (event: TuiMouseEvent) => void;
  onMouseDragEnd: (event: TuiMouseEvent) => void;
  onMouseUp: (event: TuiMouseEvent) => void;
}) {
  return (
    <box
      style={{
        position: "absolute",
        top: 1,
        bottom: 1,
        left: dividerHitLeft,
        width: dividerHitWidth,
        zIndex: 30,
      }}
      // A wider invisible target keeps the shared pane edge easy to drag.
      onMouseDown={onMouseDown}
      onMouseDrag={onMouseDrag}
      onMouseUp={onMouseUp}
      onMouseDragEnd={onMouseDragEnd}
    />
  );
}
