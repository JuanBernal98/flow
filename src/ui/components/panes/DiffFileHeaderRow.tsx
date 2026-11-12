import type { DiffFile } from "../../../core/types";
import {
  findMaxLineNumber,
  resolveCodeBlockColumn,
  resolveLineNumberDigits,
} from "../../diff/codeColumns";
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

const TITLE_INSET = 1;

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
  // The title sits one column inside the file's tinted code block, so the number gutter reads as
  // margin and the title gets a touch of indent over the code.
  const titleIndent =
    resolveCodeBlockColumn(resolveLineNumberDigits(findMaxLineNumber(file))) + TITLE_INSET;
  const statsWidth = Math.min(headerStatsWidth, additionsText.length + deletionsText.length + 1);
  const labelWidth = Math.max(
    1,
    headerLabelWidth +
      headerStatsWidth -
      statsWidth -
      (stateLabel?.length ?? 0) -
      // headerLabelWidth already accounts for the one-column padding the title used to have.
      (titleIndent - 1),
  );
  // The filename leads in the text color, since it is what you scan for; its folder follows, muted,
  // as context. Color alone carries the contrast, without bold.
  const lastSlash = filename.lastIndexOf("/");
  const name = fitText(filename.slice(lastSlash + 1), labelWidth);
  const folderText = lastSlash > 0 ? `  ${filename.slice(0, lastSlash)}` : "";
  const directory = fitText(folderText, Math.max(0, labelWidth - name.length));

  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexShrink: 0,
        flexDirection: "row",
        justifyContent: "space-between",
        paddingLeft: titleIndent,
        paddingRight: 1,
        backgroundColor: theme.background,
      }}
      onMouseUp={onSelect}
    >
      <box style={{ flexDirection: "row", backgroundColor: theme.background }}>
        <text fg={theme.text} bg={theme.background}>
          {name}
          <span fg={theme.muted}>{directory}</span>
        </text>
        {stateLabel && (
          <text fg={theme.muted} bg={theme.background}>
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
          backgroundColor: theme.background,
        }}
      >
        <text fg={theme.badgeAdded} bg={theme.background}>
          {additionsText}
        </text>
        <text fg={theme.muted} bg={theme.background}>
          {" "}
        </text>
        <text fg={theme.badgeRemoved} bg={theme.background}>
          {deletionsText}
        </text>
      </box>
    </box>
  );
}
