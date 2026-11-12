import type { MergeRequest } from "../../../core/gitlab";
import type { StoredTicketOverview } from "../../../core/ticketOverview";
import type { LineStats } from "../../../core/ticketStats";
import { fitText } from "../../lib/text";
import type { WorkspaceItem } from "../../lib/workspace";
import type { AppTheme } from "../../themes";

/** Bullet sections in display order; `code` and the one-sentence summary render on their own. */
const BULLET_SECTIONS = [
  { key: "why", title: "Why" },
  { key: "todo", title: "What to do" },
  { key: "acceptance", title: "Acceptance criteria" },
] as const satisfies { key: keyof StoredTicketOverview["overview"]; title: string }[];

/** Say how long ago an ISO timestamp was, in the coarsest unit that is not zero. */
export function describeAge(writtenAt: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(writtenAt)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** One titled block of the overview, spaced like the workspace headings. */
function Section({
  title,
  theme,
  children,
}: {
  title: string;
  theme: AppTheme;
  children: React.ReactNode;
}) {
  return (
    <box flexDirection="column" flexShrink={0} marginTop={1}>
      <text fg={theme.accent}>{title}</text>
      {children}
    </box>
  );
}

/** Bulleted lines that wrap under their own text rather than under the bullet. */
function BulletList({
  items,
  theme,
  marker = () => "•",
}: {
  items: string[];
  theme: AppTheme;
  marker?: (index: number) => string;
}) {
  return (
    <>
      {items.map((item, index) => (
        <box key={index} flexDirection="row" flexShrink={0}>
          <text fg={theme.muted} flexShrink={0}>{`${marker(index)} `}</text>
          <text fg={theme.text} wrapMode="word" flexGrow={1} flexShrink={1}>
            {item}
          </text>
        </box>
      ))}
    </>
  );
}

/**
 * Show what the coding agent understood about one ticket, with live ticket facts on top. The
 * agent writes the sections; flow adds state, MR, and line totals so they never go stale.
 */
export function TicketOverviewPane({
  item,
  overview,
  mergeRequest,
  stats,
  commitsSinceWritten,
  width,
  theme,
}: {
  /** The checked-out branch's ticket or review; the cursor never changes it. */
  item: WorkspaceItem | undefined;
  overview: StoredTicketOverview | null;
  mergeRequest: MergeRequest | undefined;
  stats: LineStats | undefined;
  /** Commits on the branch since the overview was written; undefined when unknown. */
  commitsSinceWritten: number | undefined;
  width: number;
  theme: AppTheme;
}) {
  const textWidth = Math.max(0, width - 4);
  const facts = item
    ? [
        item.id,
        item.ticketId !== item.id && item.ticketId,
        item.state,
        mergeRequest && `!${mergeRequest.iid}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const freshness = overview
    ? [
        `Written ${describeAge(overview.writtenAt)}`,
        commitsSinceWritten ? `${commitsSinceWritten} commits since` : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const placeholder = !item
    ? "No ticket checked out. Select one in the workspace."
    : !item.ticketId
      ? "This review names no ticket."
      : !overview
        ? "No overview yet. Press X to ask the agent for this ticket's context."
        : undefined;
  // A review is judged against the ticket's goal; where the code goes and how to build it
  // depend on the merge request, which the diff already shows.
  const showsImplementation = item?.section !== "reviews";

  return (
    <box
      id="overview-pane"
      width={width}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <scrollbox
        width="100%"
        flexGrow={1}
        scrollY={true}
        focused={false}
        rootOptions={{ backgroundColor: theme.background }}
        wrapperOptions={{ backgroundColor: theme.background }}
        viewportOptions={{ backgroundColor: theme.background }}
        contentOptions={{ backgroundColor: theme.background, paddingX: 1, paddingTop: 1 }}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <text fg={theme.muted}>Overview</text>
        {item ? (
          <box flexDirection="column" flexShrink={0} marginTop={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.muted}>{fitText(facts, textWidth - 12)}</text>
              {stats ? (
                <text>
                  <span fg={theme.badgeAdded}>{`+${stats.additions}`}</span>{" "}
                  <span fg={theme.badgeRemoved}>{`−${stats.deletions}`}</span>
                </text>
              ) : null}
            </box>
            <text fg={theme.text} wrapMode="word">
              {item.title}
            </text>
          </box>
        ) : null}
        {placeholder ? (
          <box id="overview-placeholder" marginTop={1} flexShrink={0}>
            <text fg={theme.muted} wrapMode="word">
              {placeholder}
            </text>
          </box>
        ) : null}
        {overview && !placeholder ? (
          <>
            <text fg={theme.muted}>{fitText(freshness, textWidth)}</text>
            <Section title="In one sentence" theme={theme}>
              <text fg={theme.text} wrapMode="word">
                {overview.overview.summary}
              </text>
            </Section>
            {BULLET_SECTIONS.map(({ key, title }) => (
              <Section key={key} title={title} theme={theme}>
                <BulletList items={overview.overview[key]} theme={theme} />
              </Section>
            ))}
            {showsImplementation && overview.overview.code.length > 0 ? (
              <Section title="Where in the code" theme={theme}>
                {overview.overview.code.map((entry, index) => (
                  <box key={index} flexDirection="column" flexShrink={0}>
                    <text fg={theme.accent}>{fitText(entry.path, textWidth)}</text>
                    <text fg={theme.muted} wrapMode="word">
                      {`  ${entry.note}`}
                    </text>
                  </box>
                ))}
              </Section>
            ) : null}
            {overview.overview.questions.length > 0 ? (
              <Section title="Questions & assumptions" theme={theme}>
                <BulletList items={overview.overview.questions} theme={theme} marker={() => "?"} />
              </Section>
            ) : null}
            {showsImplementation ? (
              <Section title="Plan" theme={theme}>
                <BulletList
                  items={overview.overview.plan}
                  theme={theme}
                  marker={(index) => `${index + 1}.`}
                />
              </Section>
            ) : null}
            <box height={1} flexShrink={0} />
          </>
        ) : null}
      </scrollbox>
    </box>
  );
}
