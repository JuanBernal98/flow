import { isEscapeKey } from "../../lib/keyboard";
import type { AppTheme } from "../../themes";

/** Render the active filter input, or the current notice with the theme in use on the right. */
export function StatusBar({
  filter,
  filterFocused,
  filterPlaceholder = "type to filter files",
  noticeText,
  reviewMode,
  terminalWidth,
  theme,
  onFilterInput,
  onFilterSubmit,
}: {
  /** The value the input edits: the file filter, or the workspace's while it owns the input. */
  filter: string;
  filterFocused: boolean;
  filterPlaceholder?: string;
  noticeText?: string;
  /** What a `flow diff` review compares (`B` switches it), e.g. "Branch vs origin/main". */
  reviewMode?: string;
  terminalWidth: number;
  theme: AppTheme;
  onFilterInput: (value: string) => void;
  onFilterSubmit: () => void;
}) {
  return (
    <box
      style={{
        height: 1,
        backgroundColor: theme.panelAlt,
        paddingLeft: 1,
        paddingRight: 1,
        alignItems: "center",
        flexDirection: "row",
        // The theme label sits flush right; the filter input keeps its pieces packed left.
        justifyContent: filterFocused ? "flex-start" : "space-between",
      }}
    >
      {filterFocused ? (
        <>
          <text fg={theme.badgeNeutral}>filter:</text>
          <box style={{ width: 1, height: 1 }}>
            <text fg={theme.muted}> </text>
          </box>
          <input
            width={Math.max(12, terminalWidth - 11)}
            value={filter}
            placeholder={filterPlaceholder}
            focused={true}
            onInput={onFilterInput}
            onSubmit={onFilterSubmit}
            onKeyDown={(key) => {
              if (!isEscapeKey(key)) {
                return;
              }

              key.preventDefault();
              key.stopPropagation();

              if (filter.length > 0) {
                onFilterInput("");
                return;
              }

              onFilterSubmit();
            }}
          />
        </>
      ) : filter.length > 0 ? (
        <text fg={theme.muted}>{`filter=${filter}`}</text>
      ) : noticeText ? (
        <text fg={theme.muted}>{noticeText}</text>
      ) : (
        <text fg={theme.muted}>Press ? for help</text>
      )}
      {/* What the review compares (`B` switches it) and the theme in use (`t` cycles it). */}
      {filterFocused ? null : (
        <text fg={theme.muted}>
          {`${reviewMode ? `Diff mode: ${reviewMode} · ` : ""}theme: ${theme.label}`}
        </text>
      )}
    </box>
  );
}
