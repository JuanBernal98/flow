import { fileRowId } from "../../lib/ids";
import type { FileGroupEntry, FileListEntry } from "../../lib/files";
import { fitText, padText } from "../../lib/text";
import type { AppTheme } from "../../themes";

/** Get icon and color for file state using standard git status codes. */
function getFileStateIcon(entry: FileListEntry, theme: AppTheme): { icon: string; color: string } {
  if (entry.isUntracked) {
    return { icon: "?", color: theme.fileUntracked };
  }

  switch (entry.changeType) {
    case "new":
      return { icon: "A", color: theme.fileNew };
    case "deleted":
      return { icon: "D", color: theme.fileDeleted };
    case "rename-pure":
    case "rename-changed":
      return { icon: "R", color: theme.fileRenamed };
    case "change":
      return { icon: "M", color: theme.fileModified };
    default:
      return { icon: "", color: theme.text };
  }
}

/** Render one folder header in the navigation sidebar. */
export function FileGroupHeader({
  entry,
  collapsed = false,
  selected = false,
  onToggle,
  textWidth,
  theme,
}: {
  entry: FileGroupEntry;
  collapsed?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  textWidth: number;
  theme: AppTheme;
}) {
  const indent = Math.min(entry.depth * 2, Math.max(0, textWidth - 5));
  const rowBackground = selected ? theme.panelAlt : theme.panel;
  return (
    <box
      id={fileRowId(entry.id)}
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        paddingLeft: 1 + indent,
        paddingRight: 1,
        backgroundColor: rowBackground,
      }}
      onMouseUp={onToggle}
    >
      <text fg={selected ? theme.text : theme.muted} bg={rowBackground}>
        {collapsed ? "▸ " : "▾ "}
        {fitText(entry.label, Math.max(1, textWidth - indent - 2))}
      </text>
    </box>
  );
}

/** Render one file row in the navigation sidebar. */
export function FileListItem({
  entry,
  selected,
  textWidth,
  theme,
  onSelect,
}: {
  entry: FileListEntry;
  selected: boolean;
  textWidth: number;
  theme: AppTheme;
  onSelect: () => void;
}) {
  const rowBackground = selected ? theme.panelAlt : theme.panel;
  const { icon, color } = getFileStateIcon(entry, theme);
  const iconWidth = icon ? 2 : 0; // icon + space
  const statsSectionWidth = entry.agentCommentsText ? entry.agentCommentsText.length + 1 : 0;
  const indent = Math.min(
    entry.depth * 2,
    Math.max(0, textWidth - iconWidth - statsSectionWidth - 7),
  );
  const nameWidth = Math.max(1, textWidth - indent - iconWidth - statsSectionWidth);

  return (
    <box
      id={fileRowId(entry.id)}
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        paddingRight: 1,
        backgroundColor: rowBackground,
        flexDirection: "row",
      }}
      onMouseUp={onSelect}
    >
      <box
        width={1}
        height={1}
        flexShrink={0}
        backgroundColor={selected ? theme.accent : rowBackground}
      />
      <box
        style={{
          flexGrow: 1,
          height: 1,
          paddingLeft: indent,
          flexDirection: "row",
          backgroundColor: rowBackground,
        }}
      >
        {icon && <text fg={color}>{icon} </text>}
        <text width={nameWidth} flexShrink={0} fg={theme.text}>
          {padText(fitText(entry.name, nameWidth), nameWidth)}
        </text>
        {statsSectionWidth > 0 && (
          <box
            style={{
              width: statsSectionWidth,
              flexShrink: 0,
              height: 1,
              flexDirection: "row",
              justifyContent: "flex-end",
              backgroundColor: rowBackground,
            }}
          >
            <text fg={theme.noteBorder}>{entry.agentCommentsText}</text>
          </box>
        )}
      </box>
    </box>
  );
}
