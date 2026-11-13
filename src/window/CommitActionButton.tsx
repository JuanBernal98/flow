/** @jsxImportSource react */
import { DESKTOP_KEYS } from "./shortcuts";

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
                : "m8 2 1.6 4.4L14 8l-4.4 1.6L8 14l-1.6-4.4L2 8l4.4-1.6Z"
            }
          />
        </svg>
      )}
      {label}
    </button>
  );
}
