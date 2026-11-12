import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { MergeRequest } from "../../../core/gitlab";
import type { LineStats } from "../../../core/ticketStats";
import { blendHex } from "../../lib/color";
import { fitText } from "../../lib/text";
import type { AppTheme } from "../../themes";
import {
  describeReviewsPlaceholder,
  describeTasksPlaceholder,
  WORKSPACE_SECTIONS,
  type WorkspaceItem,
  type WorkspaceReviewsState,
  type WorkspaceStatus,
  type WorkspaceTasksState,
} from "../../lib/workspace";

const WORKSPACE_STATUS_STYLES = {
  pending: { symbol: "○", color: "muted" },
  inProgress: { symbol: "◐", color: "accent" },
  awaitingReview: { symbol: "◇", color: "muted" },
  approved: { symbol: "✓", color: "badgeAdded" },
} as const satisfies Record<WorkspaceStatus, { symbol: string; color: keyof AppTheme }>;

// The cursor background keeps this share of panelAlt over the pane background, so it reads as a
// light hover rather than a second selection next to the active ticket's rail.
const CURSOR_BACKGROUND_STRENGTH = 0.5;

/** Colored `+a −d` totals, styled like the file tree's change heading. */
function LineStatsSpans({ stats, theme }: { stats: LineStats; theme: AppTheme }) {
  return (
    <>
      <span fg={theme.badgeAdded}>{`+${stats.additions}`}</span>{" "}
      <span fg={theme.badgeRemoved}>{`−${stats.deletions}`}</span>
    </>
  );
}

/** Render YouTrack tasks and GitLab reviews independently of the active review. */
export function WorkspaceSidebar({
  items,
  filter,
  tasks,
  reviews,
  activeItemId,
  ticketStats,
  ticketMergeRequests,
  width,
  expanded,
  focused,
  selectedIndex,
  theme,
  onSelect,
}: {
  /** The cards left after `/`; the whole list while no filter is set. */
  items: WorkspaceItem[];
  /** The `/` query that narrowed `items`, or empty. */
  filter: string;
  tasks: WorkspaceTasksState;
  reviews: WorkspaceReviewsState;
  /** Ticket or review of the checked-out branch, marked with the rail. */
  activeItemId: string | null;
  /** Lines changed on each ticket's branch; tickets without a branch are absent. */
  ticketStats: ReadonlyMap<string, LineStats>;
  /** Merge request linked to each ticket through its branch; `g` opens it. */
  ticketMergeRequests: ReadonlyMap<string, MergeRequest>;
  width: number;
  expanded: boolean;
  focused: boolean;
  selectedIndex: number;
  theme: AppTheme;
  onSelect: (index: number) => void;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const cursorBackground = blendHex(theme.panelAlt, theme.background, CURSOR_BACKGROUND_STRENGTH);
  const sections = WORKSPACE_SECTIONS.map((section) => {
    const sectionItems = items
      .map((item, index) => ({
        item,
        index,
        stats: ticketStats.get(item.id),
        mergeRequest: ticketMergeRequests.get(item.id),
      }))
      .filter(({ item }) => item.section === section.id);
    return { ...section, items: sectionItems };
  })
    // Ready to merge only appears once an MR is approved, so it never costs space empty.
    .filter((section) => section.id !== "readyToMerge" || section.items.length > 0);
  const sectionSize = (sectionId: string) =>
    sections.find((section) => section.id === sectionId)?.items.length ?? 0;
  // A filtered section that loaded fine but matches nothing says so, instead of "Nothing to do".
  const filteredOut = (sectionId: string) =>
    filter &&
    (sectionId === "reviews" ? reviews : tasks).kind === "ready" &&
    !sectionSize(sectionId)
      ? "No matches"
      : undefined;
  const placeholders: Partial<Record<string, string>> = {
    todo: filteredOut("todo") ?? describeTasksPlaceholder(tasks, sectionSize("todo")),
    reviews: filteredOut("reviews") ?? describeReviewsPlaceholder(reviews, sectionSize("reviews")),
  };
  // Sections have no meaningful count until the load behind them finishes.
  const showsCount = (sectionId: string) =>
    (sectionId === "reviews" ? reviews : tasks).kind === "ready";
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
          {filter ? (
            <box id="workspace-filter" height={1} paddingX={1} flexShrink={0}>
              <text fg={theme.muted}>{fitText(`/ ${filter} · Esc clears`, width - 2)}</text>
            </box>
          ) : null}
          {sections.map((section, sectionIndex) => (
            <box
              // Remount the section when the filter changes: OpenTUI leaves a card reinserted
              // before its siblings unpainted in a real terminal, so cards are never reinserted.
              key={`${section.id}:${filter}`}
              id={`workspace-section-${section.id}`}
              flexDirection="column"
              flexShrink={0}
              marginTop={sectionIndex > 0 ? 1 : 0}
              backgroundColor={theme.background}
            >
              <box
                id={`workspace-heading-${section.id}`}
                height={3}
                paddingTop={1}
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                flexDirection="row"
                justifyContent="space-between"
              >
                <text fg={theme.muted}>{section.title}</text>
                <text fg={theme.muted}>{showsCount(section.id) ? section.items.length : ""}</text>
              </box>
              {placeholders[section.id] ? (
                <box
                  id={`workspace-${section.id}-placeholder`}
                  height={2}
                  paddingX={1}
                  flexDirection="column"
                >
                  <text fg={theme.muted}>{fitText(placeholders[section.id] ?? "", width - 4)}</text>
                </box>
              ) : null}
              {section.items.map(({ item, index, stats, mergeRequest }) => {
                // The rail marks the checked-out branch's ticket wherever the cursor is. The
                // cursor itself is a faint background, shown only while the pane owns the
                // keyboard, since that is when Enter, h, and r act on it.
                const active = item.id === activeItemId;
                const hovered = focused && selectedIndex === index;
                const rowBackground = hovered ? cursorBackground : theme.background;
                return (
                  <box key={item.id} id={`workspace-${index}`} height={3} flexDirection="column">
                    <box
                      id={`workspace-row-${index}`}
                      height={2}
                      flexDirection="row"
                      backgroundColor={rowBackground}
                      onMouseUp={() => onSelect(index)}
                    >
                      {/* Solid selection rail, then a one-column gap so it never touches the icon. */}
                      <box
                        id={`workspace-rail-${index}`}
                        width={1}
                        height={2}
                        flexShrink={0}
                        backgroundColor={active ? theme.accent : rowBackground}
                      />
                      <box width={1} height={2} flexShrink={0} />
                      <box flexGrow={1} paddingRight={1} flexDirection="column">
                        <text fg={theme.text}>
                          <span fg={theme[WORKSPACE_STATUS_STYLES[item.status].color]}>
                            {WORKSPACE_STATUS_STYLES[item.status].symbol}
                          </span>{" "}
                          {fitText(item.title, width - 6)}
                        </text>
                        {/* Ids on the left (a review's ticket beside its MR, like a task's MR
                            beside its ticket), the branch's line totals flush right. */}
                        <box flexDirection="row" justifyContent="space-between">
                          <text fg={theme.muted}>
                            {fitText(
                              `  ${[
                                item.id,
                                item.ticketId !== item.id && item.ticketId,
                                mergeRequest && `!${mergeRequest.iid}`,
                                item.detail,
                              ]
                                .filter(Boolean)
                                .join(" · ")}`,
                              width - 4,
                            )}
                          </text>
                          {stats ? (
                            <text>
                              <LineStatsSpans stats={stats} theme={theme} />
                            </text>
                          ) : null}
                        </box>
                      </box>
                    </box>
                  </box>
                );
              })}
            </box>
          ))}
        </scrollbox>
      ) : null}
    </box>
  );
}
