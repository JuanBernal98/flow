import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";

const WORKSPACE_STATUSES = {
  pending: { symbol: "○", label: "Open", color: "muted" },
  inProgress: { symbol: "◐", label: "In progress", color: "accent" },
  completed: { symbol: "●", label: "Completed", color: "addedSignColor" },
  awaitingReview: { symbol: "◇", label: "Awaiting review", color: "muted" },
  approved: { symbol: "✓", label: "Approved", color: "addedSignColor" },
} as const;

export const WORKSPACE_ITEMS = [
  {
    id: "FLOW-101",
    title: "Workspace sidebar",
    section: "Tasks",
    status: "inProgress",
    added: 48,
    removed: 12,
  },
  {
    id: "FLOW-102",
    title: "Review navigation",
    section: "Tasks",
    status: "pending",
    added: 21,
    removed: 5,
  },
  { id: "!42", title: "Simplify diff layout", section: "Reviews", status: "awaitingReview" },
  { id: "!43", title: "Stable comment anchors", section: "Reviews", status: "approved" },
] as const;

/** Render local workspace examples independently of the active review. */
export function WorkspaceSidebar({
  width,
  expanded,
  focused,
  selectedIndex,
  theme,
  onSelect,
}: {
  width: number;
  expanded: boolean;
  focused: boolean;
  selectedIndex: number;
  theme: AppTheme;
  onSelect: (index: number) => void;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollChildIntoView(`workspace-${selectedIndex}`);
  }, [selectedIndex, expanded]);

  return (
    <box
      width={width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.panel}
      border={["right"]}
      borderColor={theme.panelAlt}
    >
      {expanded ? (
        <scrollbox
          ref={scrollRef}
          width="100%"
          flexGrow={1}
          scrollY={true}
          focused={false}
          verticalScrollbarOptions={{ visible: false }}
          horizontalScrollbarOptions={{ visible: false }}
        >
          {WORKSPACE_ITEMS.map((item, index) => (
            <box key={item.id} flexDirection="column" flexShrink={0}>
              {index === 0 || WORKSPACE_ITEMS[index - 1]?.section !== item.section ? (
                <box
                  id={`workspace-heading-${item.section}`}
                  height={3}
                  paddingTop={1}
                  flexShrink={0}
                  paddingLeft={1}
                  paddingRight={1}
                  flexDirection="row"
                  justifyContent="space-between"
                  border={["bottom"]}
                  borderColor={theme.panelAlt}
                >
                  <text fg={theme.muted}>{item.section}</text>
                  <text fg={theme.muted}>
                    {WORKSPACE_ITEMS.filter((entry) => entry.section === item.section).length}
                  </text>
                </box>
              ) : null}
              <box id={`workspace-${index}`} height={3} flexDirection="column">
                <box
                  id={`workspace-row-${index}`}
                  height={2}
                  paddingX={1}
                  flexDirection="column"
                  backgroundColor={selectedIndex === index ? theme.panelAlt : theme.panel}
                  onMouseUp={() => onSelect(index)}
                >
                  <text fg={selectedIndex === index && focused ? theme.accent : theme.text}>
                    <span fg={theme[WORKSPACE_STATUSES[item.status].color]}>
                      {WORKSPACE_STATUSES[item.status].symbol}
                    </span>{" "}
                    {fitText(item.title, width - 5)}
                  </text>
                  {"added" in item ? (
                    <text fg={theme.muted}>
                      {`  ${item.id}  `}
                      <span fg={theme.addedSignColor}>{`+${item.added}`}</span>{" "}
                      <span fg={theme.removedSignColor}>{`−${item.removed}`}</span>
                    </text>
                  ) : (
                    <text fg={theme.muted}>
                      {fitText(
                        `  ${item.id} · ${WORKSPACE_STATUSES[item.status].label}`,
                        width - 3,
                      )}
                    </text>
                  )}
                </box>
              </box>
            </box>
          ))}
        </scrollbox>
      ) : null}
    </box>
  );
}
