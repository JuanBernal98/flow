/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";

/** Focus the mounted inline editor without letting the browser choose an unrelated scroll target. */
export function CommentEditor({
  onSave,
  onCancel,
  active = true,
  onActivate,
}: {
  onSave: (body: string) => void;
  onCancel: () => void;
  active?: boolean;
  onActivate?: () => void;
}) {
  const [body, setBody] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    if (!active) {
      setBody("");
      if (document.activeElement === field) field.blur();
      return;
    }
    const observer = new ResizeObserver(focusWhenVisible);
    /** Pierre may attach the annotation slot after React mounts the editor. */
    function focusWhenVisible() {
      if (!field || field.getBoundingClientRect().height === 0) return;
      observer.disconnect();
      field.focus({ preventScroll: true });
      field.closest(".thread")?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
    observer.observe(field);
    focusWhenVisible();
    const frame = requestAnimationFrame(focusWhenVisible);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [active]);
  return (
    <div className="thread-editor">
      <textarea
        ref={input}
        aria-label="Write a comment"
        rows={2}
        value={body}
        placeholder="Leave a comment…"
        title="Enter saves · Shift+Enter adds a line · Esc cancels"
        onFocus={() => {
          if (!active) onActivate?.();
        }}
        onChange={(event) => {
          if (!active) onActivate?.();
          setBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (body.trim()) onSave(body);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}
