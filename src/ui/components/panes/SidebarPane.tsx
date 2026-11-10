import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { sidebarAncestorPaths, visibleSidebarEntries, type SidebarEntry } from "../../lib/files";
import { fileRowId } from "../../lib/ids";
import { isStepDownKey, isStepUpKey } from "../../lib/keyboard";
import type { AppTheme } from "../../themes";
import { FileGroupHeader, FileListItem } from "./FileListItem";

/** Render the file navigation sidebar. */
export function SidebarPane({
  entries,
  scrollRef,
  selectedFileId,
  theme,
  width,
  onSelectFile,
  keyboardActive = false,
  onFocusTree,
}: {
  entries: SidebarEntry[];
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  selectedFileId?: string;
  theme: AppTheme;
  width: number;
  onSelectFile: (fileId: string) => void;
  keyboardActive?: boolean;
  onFocusTree?: () => void;
}) {
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(() => new Set());
  const [cursorId, setCursorId] = useState(selectedFileId);
  const visibleEntries = useMemo(
    () => visibleSidebarEntries(entries, collapsedPaths),
    [entries, collapsedPaths],
  );
  const cursor =
    visibleEntries.find((entry) => entry.id === cursorId) ??
    visibleEntries.find((entry) => entry.id === selectedFileId) ??
    visibleEntries[0];

  useEffect(() => {
    const selected = entries.find((entry) => entry.id === selectedFileId);
    if (!selected) return;
    const ancestors = sidebarAncestorPaths(selected);
    setCollapsedPaths((current) => {
      if (!ancestors.some((path) => current.has(path))) return current;
      return new Set([...current].filter((path) => !ancestors.includes(path)));
    });
    setCursorId(selectedFileId);
  }, [entries, selectedFileId]);

  useEffect(() => {
    const target = keyboardActive
      ? cursor
      : visibleEntries.find((entry) => entry.id === selectedFileId);
    if (target) scrollRef.current?.scrollChildIntoView(fileRowId(target.id));
  }, [keyboardActive, cursor, selectedFileId, visibleEntries, scrollRef]);

  /** Toggle only navigation visibility, leaving the active diff untouched. */
  const toggleGroup = (entry: SidebarEntry) => {
    if (entry.kind !== "group") return;
    setCursorId(entry.id);
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  };

  useKeyboard((key) => {
    if (!keyboardActive || !cursor || key.ctrl || key.meta) return;
    const index = visibleEntries.indexOf(cursor);
    if (isStepDownKey(key) || isStepUpKey(key)) {
      const delta = isStepDownKey(key) ? 1 : -1;
      setCursorId(
        visibleEntries[Math.max(0, Math.min(visibleEntries.length - 1, index + delta))]?.id,
      );
    } else if (key.name === "home" || key.name === "end") {
      setCursorId(visibleEntries[key.name === "home" ? 0 : visibleEntries.length - 1]?.id);
    } else if (key.name === "return" || key.name === "space" || key.sequence === " ") {
      if (cursor.kind === "group") toggleGroup(cursor);
      else onSelectFile(cursor.id);
    } else if (key.name === "right" && cursor.kind === "group") {
      if (collapsedPaths.has(cursor.path)) toggleGroup(cursor);
      else setCursorId(visibleEntries[index + 1]?.id ?? cursor.id);
    } else if (key.name === "left") {
      if (cursor.kind === "group" && !collapsedPaths.has(cursor.path)) toggleGroup(cursor);
      else {
        const parent = visibleEntries
          .slice(0, index)
          .findLast((entry) => entry.kind === "group" && entry.path === cursor.parentPath);
        if (parent) setCursorId(parent.id);
      }
    }
  });
  const fileEntries = entries.filter((entry) => entry.kind === "file");
  const additions = fileEntries.reduce((total, entry) => total + entry.stats.additions, 0);
  const deletions = fileEntries.reduce((total, entry) => total + entry.stats.deletions, 0);
  const additionsTruncated = fileEntries.some((entry) => entry.statsTruncated);
  const contentTextWidth = Math.max(4, width - 4);

  return (
    <box
      id="file-tree-pane"
      style={{
        width,
        backgroundColor: theme.panel,
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
        <text fg={theme.muted}>{`${fileEntries.length} Changes`}</text>
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
        rootOptions={{ backgroundColor: theme.panel }}
        wrapperOptions={{ backgroundColor: theme.panel }}
        viewportOptions={{ backgroundColor: theme.panel }}
        contentOptions={{ backgroundColor: theme.panel }}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <box style={{ width: "100%", flexDirection: "column" }}>
          {visibleEntries.map((entry) =>
            entry.kind === "group" ? (
              <FileGroupHeader
                key={entry.id}
                entry={entry}
                collapsed={collapsedPaths.has(entry.path)}
                selected={keyboardActive && cursor?.id === entry.id}
                onToggle={() => {
                  onFocusTree?.();
                  toggleGroup(entry);
                }}
                textWidth={contentTextWidth}
                theme={theme}
              />
            ) : (
              <FileListItem
                key={entry.id}
                entry={entry}
                selected={keyboardActive ? cursor?.id === entry.id : entry.id === selectedFileId}
                textWidth={contentTextWidth}
                theme={theme}
                onSelect={() => onSelectFile(entry.id)}
              />
            ),
          )}
        </box>
      </scrollbox>
    </box>
  );
}
