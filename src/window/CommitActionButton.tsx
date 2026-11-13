/** @jsxImportSource react */
import { DESKTOP_KEYS } from "./shortcuts";

/** Hidden sidebar panels retain their buttons; hotkeys must only activate the visible action. */
export function activateVisibleCommitAction(container: ParentNode | null) {
  const button = [...(container?.querySelectorAll<HTMLButtonElement>(".commit-button") ?? [])].find(
    (candidate) => candidate.getClientRects().length > 0,
  );
  if (!button || button.disabled) return false;
  button.click();
  return true;
}

/** One full-width footer action, with separate proposal and commit colors and busy states. */
export function CommitActionButton({
  label,
  phase,
  loading = false,
  disabled = false,
  onClick,
}: {
  label: string;
  phase: "propose" | "commit";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className="commit-button"
      data-phase={phase}
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading}
      aria-label={label}
      aria-keyshortcuts="Shift+C"
      title={`${label} (${DESKTOP_KEYS.commitAction})`}
    >
      {loading ? (
        <span className="commit-button-spinner" aria-hidden="true" />
      ) : (
        <svg
          width="15"
          height="15"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path
            d={
              phase === "commit"
                ? "m3 8 3.2 3.2L13 4.5"
                : "m6 4 1.25 3.75L11 9l-3.75 1.25L6 14l-1.25-3.75L1 9l3.75-1.25Z M12 1l.75 2.25L15 4l-2.25.75L12 7l-.75-2.25L9 4l2.25-.75Z"
            }
          />
        </svg>
      )}
      {label}
    </button>
  );
}
