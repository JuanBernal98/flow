import type { DiffFile } from "../../../core/types";
import { FILE_SEPARATOR_ROWS } from "../../lib/fileSectionLayout";
import { diffSectionId } from "../../lib/ids";
import type { AppTheme } from "../../themes";
import { DiffFileHeaderRow } from "./DiffFileHeaderRow";

interface DiffSectionPlaceholderProps {
  bodyHeight: number;
  file: DiffFile;
  headerLabelWidth: number;
  headerStatsWidth: number;
  showHeader: boolean;
  showSeparator: boolean;
  theme: AppTheme;
  onSelect: () => void;
}

/** Reserve offscreen section height without mounting its full diff rows. */
export function DiffSectionPlaceholder({
  bodyHeight,
  file,
  headerLabelWidth,
  headerStatsWidth,
  showHeader,
  showSeparator,
  theme,
  onSelect,
}: DiffSectionPlaceholderProps) {
  return (
    <box
      id={diffSectionId(file.id)}
      style={{
        width: "100%",
        flexDirection: "column",
        backgroundColor: theme.background,
      }}
    >
      {showSeparator ? (
        <box
          style={{
            width: "100%",
            height: FILE_SEPARATOR_ROWS,
            backgroundColor: theme.background,
          }}
        />
      ) : null}

      {showHeader ? (
        <DiffFileHeaderRow
          file={file}
          headerLabelWidth={headerLabelWidth}
          headerStatsWidth={headerStatsWidth}
          theme={theme}
          onSelect={onSelect}
        />
      ) : null}

      <box style={{ width: "100%", height: bodyHeight, backgroundColor: theme.contextBg }} />
    </box>
  );
}
