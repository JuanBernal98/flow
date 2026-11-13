/** @jsxImportSource react */
import { useEffect, useRef } from "react";
import { DEFAULT_DIFF_FONT_SIZE, MIN_DIFF_FONT_SIZE, MAX_DIFF_FONT_SIZE } from "./preferences";

/** A small native modal keeps focus inside settings and returns it to the status-bar trigger. */
export function SettingsPanel({
  fontSize,
  onFontSize,
  onClose,
}: {
  fontSize: number;
  onFontSize: (size: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      className="settings-panel"
      ref={dialog}
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-content">
        <header className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Close settings"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <section className="settings-section" aria-labelledby="editor-settings-title">
          <h3 id="editor-settings-title">Editor</h3>
          <div className="settings-row">
            <div>
              <label htmlFor="diff-font-size">Diff font size</label>
              <p id="diff-font-description">Size of the code and line numbers in the review.</p>
            </div>
            <div className="settings-font-control">
              <input
                id="diff-font-size"
                type="range"
                min={MIN_DIFF_FONT_SIZE}
                max={MAX_DIFF_FONT_SIZE}
                step="0.5"
                value={fontSize}
                aria-describedby="diff-font-description"
                onChange={(event) => onFontSize(Number(event.target.value))}
              />
              <output htmlFor="diff-font-size">{fontSize} px</output>
            </div>
          </div>
          <button
            className="settings-reset"
            type="button"
            disabled={fontSize === DEFAULT_DIFF_FONT_SIZE}
            onClick={() => onFontSize(DEFAULT_DIFF_FONT_SIZE)}
          >
            Reset to default
          </button>
        </section>
      </div>
    </dialog>
  );
}

/** Restrained outline gear for the status bar. */
export function SettingsIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9.5 3-.6 2.1-1.7 1L5 5.6 2.5 10l1.6 1.5v2L2.5 15 5 19.4l2.2-.5 1.7 1 .6 2.1h5l.6-2.1 1.7-1 2.2.5 2.5-4.4-1.6-1.5v-2L21.5 10 19 5.6l-2.2.5-1.7-1L14.5 3z" />
      <circle cx="12" cy="12.5" r="3" />
    </svg>
  );
}
