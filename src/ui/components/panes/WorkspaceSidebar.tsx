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

const WORKSPACE_SECTIONS = ["Tasks", "Reviews"].map((title) => ({
  title,
  items: WORKSPACE_ITEMS.map((item, index) => ({ item, index })).filter(
    ({ item }) => item.section === title,
  ),
}));

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
      id="workspace-pane"
      width={width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      {expanded ? (
        <scrollbox
          ref={scrollRef}
          width="100%"
          flexGrow={1}
          scrollY={true}
          focused={false}
          rootOptions={{ backgroundColor: theme.background }}
          wrapperOptions={{ backgroundColor: theme.background }}
          viewportOptions={{ backgroundColor: theme.background }}
          contentOptions={{ backgroundColor: theme.background }}
          verticalScrollbarOptions={{ visible: false }}
          horizontalScrollbarOptions={{ visible: false }}
        >
          {WORKSPACE_SECTIONS.map((section, sectionIndex) => (
            <box
              key={section.title}
              id={`workspace-section-${section.title}`}
              flexDirection="column"
              flexShrink={0}
              marginTop={sectionIndex > 0 ? 1 : 0}
              backgroundColor={theme.background}
            >
              <box
                id={`workspace-heading-${section.title}`}
                height={3}
                paddingTop={1}
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                flexDirection="row"
                justifyContent="space-between"
              >
                <text fg={theme.muted}>{section.title}</text>
                <text fg={theme.muted}>{section.items.length}</text>
              </box>
              {section.items.map(({ item, index }) => (
                <box key={item.id} id={`workspace-${index}`} height={3} flexDirection="column">
                  <box
                    id={`workspace-row-${index}`}
                    height={2}
                    paddingX={1}
                    flexDirection="column"
                    backgroundColor={selectedIndex === index ? theme.panelAlt : theme.background}
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
              ))}
            </box>
          ))}
        </scrollbox>
      ) : null}
    </box>
  );
}
