import type { DiffFile } from "../../../core/types";
import { fileLabelParts } from "../../lib/files";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";

interface DiffFileHeaderRowProps {
  file: DiffFile;
  headerLabelWidth: number;
  headerStatsWidth: number;
  theme: AppTheme;
  onSelect?: () => void;
}

/** Render one file header row in the review stream or sticky overlay. */
export function DiffFileHeaderRow({
  file,
  headerLabelWidth,
  headerStatsWidth,
  theme,
  onSelect,
}: DiffFileHeaderRowProps) {
  const additionsText = `+${file.stats.additions}${file.statsTruncated ? "+" : ""}`;
  const deletionsText = `-${file.stats.deletions}`;
  const { filename, stateLabel } = fileLabelParts(file);
  const statsWidth = Math.min(headerStatsWidth, additionsText.length + deletionsText.length + 1);
  const labelWidth = Math.max(
    1,
    headerLabelWidth + headerStatsWidth - statsWidth - (stateLabel?.length ?? 0),
  );
  const lastSlash = filename.lastIndexOf("/");
  const name = fitText(filename.slice(lastSlash + 1), labelWidth);
  const directory = fitText(
    filename.slice(0, lastSlash + 1),
    Math.max(0, labelWidth - name.length),
  );

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.panelAlt,
      }}
      onMouseUp={onSelect}
    >
      <box style={{ flexDirection: "row", backgroundColor: theme.panelAlt }}>
        <text fg={theme.text} bg={theme.panelAlt}>
          <span fg={theme.muted}>{directory}</span>
          <b>{name}</b>
        </text>
        {stateLabel && (
          <text fg={theme.muted} bg={theme.panelAlt}>
            {stateLabel}
          </text>
        )}
      </box>
      <box
        style={{
          width: statsWidth,
          flexShrink: 0,
          height: 1,
          flexDirection: "row",
          justifyContent: "flex-end",
          backgroundColor: theme.panelAlt,
        }}
      >
        <text fg={theme.badgeAdded} bg={theme.panelAlt}>
          {additionsText}
        </text>
        <text fg={theme.muted} bg={theme.panelAlt}>
          {" "}
        </text>
        <text fg={theme.badgeRemoved} bg={theme.panelAlt}>
          {deletionsText}
        </text>
      </box>
    </box>
  );
}
