import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useState, type RefObject } from "react";
import type { SidebarEntry } from "../../lib/files";
import { fileRowId } from "../../lib/ids";
import { isStepDownKey, isStepUpKey } from "../../lib/keyboard";
import type { AppTheme } from "../../themes";
import { FileListItem } from "./FileListItem";

/** Render the file navigation sidebar. */
export function SidebarPane({
  entries,
  scrollRef,
  selectedFileId,
  theme,
  width,
  onSelectFile,
  keyboardActive = false,
}: {
  entries: SidebarEntry[];
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  selectedFileId?: string;
  theme: AppTheme;
  width: number;
  onSelectFile: (fileId: string) => void;
  keyboardActive?: boolean;
}) {
  const [cursorId, setCursorId] = useState(selectedFileId);
  const cursor =
    entries.find((entry) => entry.id === cursorId) ??
    entries.find((entry) => entry.id === selectedFileId) ??
    entries[0];

  useEffect(() => {
    setCursorId(selectedFileId);
  }, [selectedFileId]);

  useEffect(() => {
    const target = keyboardActive ? cursor : entries.find((entry) => entry.id === selectedFileId);
    if (target) scrollRef.current?.scrollChildIntoView(fileRowId(target.id));
  }, [keyboardActive, cursor, selectedFileId, entries, scrollRef]);

  useKeyboard((key) => {
    if (!keyboardActive || !cursor || key.ctrl || key.meta) return;
    const index = entries.indexOf(cursor);
    if (isStepDownKey(key) || isStepUpKey(key)) {
      const delta = isStepDownKey(key) ? 1 : -1;
      setCursorId(entries[Math.max(0, Math.min(entries.length - 1, index + delta))]?.id);
    } else if (key.name === "home" || key.name === "end") {
      setCursorId(entries[key.name === "home" ? 0 : entries.length - 1]?.id);
    } else if (key.name === "return" || key.name === "space" || key.sequence === " ") {
      onSelectFile(cursor.id);
    }
  });
  const additions = entries.reduce((total, entry) => total + entry.stats.additions, 0);
  const deletions = entries.reduce((total, entry) => total + entry.stats.deletions, 0);
  const additionsTruncated = entries.some((entry) => entry.statsTruncated);
  const contentTextWidth = Math.max(4, width - 4);

  return (
    <box
      id="file-tree-pane"
      style={{
        width,
        backgroundColor: theme.background,
        paddingBottom: 1,
        paddingX: 1,
        flexDirection: "column",
      }}
    >
      <box
        id="file-tree-heading"
        height={3}
        flexShrink={0}
        paddingTop={1}
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={theme.muted}>{`${entries.length} Changes`}</text>
        <text>
          <span fg={theme.badgeAdded}>{`+${additions}${additionsTruncated ? "+" : ""}`}</span>{" "}
          <span fg={theme.badgeRemoved}>{`−${deletions}`}</span>
        </text>
      </box>
      <scrollbox
        ref={scrollRef}
        width="100%"
        flexGrow={1}
        focused={false}
        scrollY={true}
        viewportCulling={true}
        rootOptions={{ backgroundColor: theme.background }}
        wrapperOptions={{ backgroundColor: theme.background }}
        viewportOptions={{ backgroundColor: theme.background }}
        contentOptions={{ backgroundColor: theme.background }}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box style={{ width: "100%", flexDirection: "column" }}>
          {entries.map((entry) => (
            <FileListItem
              key={entry.id}
              entry={entry}
              selected={keyboardActive ? cursor?.id === entry.id : entry.id === selectedFileId}
              textWidth={contentTextWidth}
              theme={theme}
              onSelect={() => onSelectFile(entry.id)}
            />
          ))}
        </box>
      </scrollbox>
    </box>
  );
}
