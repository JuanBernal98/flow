import { fileRowId } from "../../lib/ids";
import type { SidebarEntry } from "../../lib/files";
import { fitText, padText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import { getFileStateIcon } from "../../lib/fileState";

/** Render one file row in the navigation sidebar. */
export function FileListItem({
  entry,
  selected,
  textWidth,
  theme,
  onSelect,
}: {
  entry: SidebarEntry;
  selected: boolean;
  textWidth: number;
  theme: AppTheme;
  onSelect: () => void;
}) {
  const rowBackground = selected ? theme.panelAlt : theme.background;
  const { icon, color } = getFileStateIcon(entry, theme);
  const iconWidth = icon ? 2 : 0; // icon + space
  const statsSectionWidth = entry.agentCommentsText ? entry.agentCommentsText.length + 1 : 0;
  // One blank column keeps the selection rail off the icon, as in the workspace's ticket rows.
  const railGapWidth = 1;
  const labelWidth = Math.max(1, textWidth - railGapWidth - iconWidth - statsSectionWidth);
  const name = fitText(entry.name, labelWidth);
  // Ambiguous names get their folder, muted, in whatever room the name leaves.
  const hint = entry.folderHint
    ? fitText(`  ${entry.folderHint}`, Math.max(0, labelWidth - name.length))
    : "";

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
      <box width={railGapWidth} height={1} flexShrink={0} backgroundColor={rowBackground} />
      <box
        style={{
          flexGrow: 1,
          height: 1,
          flexDirection: "row",
          backgroundColor: rowBackground,
        }}
      >
        {icon && <text fg={color}>{icon} </text>}
        <text width={labelWidth} flexShrink={0} fg={theme.text}>
          {name}
          <span fg={theme.muted}>{padText(hint, labelWidth - name.length)}</span>
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
