/** @jsxImportSource react */
import type { WindowDiffFile, WindowDiffScope } from "./data";
import { DESKTOP_KEYS } from "./shortcuts";

/** Review controls embedded in the custom window title bar. */
export function DiffToolbar({
  files,
  diffStyle,
  onDiffStyle,
  onToggleFold,
  scope = "pending",
  onToggleScope,
}: {
  files: readonly WindowDiffFile[] | null;
  diffStyle: "split" | "unified";
  onDiffStyle: (style: "split" | "unified") => void;
  onToggleFold: () => void;
  scope?: WindowDiffScope;
  onToggleScope?: () => void;
}) {
  const totals = (files ?? []).reduce(
    (sum, file) => ({
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return (
    <div className="diff-toolbar" role="toolbar" aria-label="Diff view controls">
      <div className="diff-toolbar-actions">
        <button
          className="diff-scope"
          type="button"
          aria-label={
            scope === "pending"
              ? `Show branch changes (${DESKTOP_KEYS.scope})`
              : `Show pending changes (${DESKTOP_KEYS.scope})`
          }
          onClick={onToggleScope}
        >
          <span>{scope === "pending" ? "Pending changes" : "Branch changes"}</span>
        </button>
        <button
          type="button"
          className="icon-button"
          title="Expand / collapse all files"
          aria-label="Expand / collapse all files"
          disabled={!files?.length}
          onClick={onToggleFold}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="m5 6 3-3 3 3M5 10l3 3 3-3" />
          </svg>
        </button>
        <div className="diff-toolbar-actions" role="group" aria-label="Diff layout">
          {(["unified", "split"] as const).map((style) => (
            <button
              type="button"
              key={style}
              className={`icon-button${diffStyle === style ? " on" : ""}`}
              title={style === "split" ? "Split (1)" : "Stacked (2)"}
              aria-label={style === "split" ? "Split diff" : "Stacked diff"}
              aria-pressed={diffStyle === style}
              onClick={() => onDiffStyle(style)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                aria-hidden="true"
              >
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                <path d={style === "split" ? "M8 2.5v11" : "M1.5 8h13"} />
              </svg>
            </button>
          ))}
        </div>
      </div>
      {files ? (
        <span className="stat">
          <span className="add">+{totals.additions.toLocaleString()}</span>{" "}
          <span className="del">−{totals.deletions.toLocaleString()}</span>
        </span>
      ) : null}
    </div>
  );
}
