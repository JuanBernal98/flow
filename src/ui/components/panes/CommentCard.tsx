import type { Annotation, LayoutMode } from "../../../core/types";
import { wrapText } from "../../lib/agentPopover";
import { padText } from "../../lib/text";
import type { AppTheme } from "../../themes";

/**
 * Render one review comment as a short chat on a purple card: the user's comment, then the
 * agent's replies.
 * Metadata stays quiet so the comment body carries the visual weight.
 */

/** Parse `flow-comment:42` style ids back into their numeric handle, if shaped that way. */
function parseCommentId(annotationId: string | undefined): number | null {
  if (!annotationId?.startsWith("flow-comment:")) {
    return null;
  }
  const parsed = Number.parseInt(annotationId.slice("flow-comment:".length), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Build the muted metadata header for one comment card. */
function buildMetadataLabel(
  annotationId: string | undefined,
  commentIndex: number,
  commentCount: number,
) {
  const id = parseCommentId(annotationId);
  if (id === null) {
    return "";
  }
  return commentCount > 1 ? `#${id} · ${commentIndex + 1} of ${commentCount}` : `#${id}`;
}

const GUTTER_PADDING = 1;
const LEFT_INDENT = 3;

interface InlineNoteLine {
  kind: "summary" | "rationale" | "reply";
  text: string;
}

// Chat-style speaker labels: the user's comment, then the agent's replies.
const USER_LABEL = "You: ";
/** Label named agents without guessing the identity of older messages. */
function agentLabel(name?: string) {
  return `${name ?? "Agent"}: `;
}

/** Wrap one chat message under its speaker label, continuation lines aligned with the text. */
function wrapChatMessage(label: string, text: string, width: number) {
  return wrapText(text, Math.max(1, width - label.length)).map(
    (line, index) => `${index === 0 ? label : " ".repeat(label.length)}${line}`,
  );
}

/** Compute the body width and wrapped lines for the card body. */
function buildBodyLines(annotation: Annotation, width: number) {
  const bodyWidth = Math.max(1, width - LEFT_INDENT - GUTTER_PADDING);
  const lines: InlineNoteLine[] = [
    // An agent's own comment opens with its label and reads like its replies.
    ...wrapChatMessage(
      annotation.author === "agent" ? agentLabel(annotation.agentName) : USER_LABEL,
      annotation.summary ?? "",
      bodyWidth,
    ).map((text) => ({ kind: annotation.author === "agent" ? "reply" : "summary", text }) as const),
    ...(annotation.rationale
      ? wrapText(annotation.rationale, bodyWidth).map(
          (text) => ({ kind: "rationale", text }) as const,
        )
      : []),
    ...(annotation.replies ?? []).flatMap((reply) =>
      wrapChatMessage(agentLabel(reply.agentName), reply.body, bodyWidth).map(
        (text) => ({ kind: "reply", text }) as const,
      ),
    ),
  ];
  return { bodyWidth, lines };
}

export function measureCommentCardHeight({
  annotation,
  width,
}: {
  annotation: Annotation;
  anchorSide?: "old" | "new";
  layout?: Exclude<LayoutMode, "auto">;
  width: number;
}) {
  const { lines } = buildBodyLines(annotation, width);
  // Title row + body rows + one trailing spacer.
  return 1 + lines.length + 1;
}

/** Render the card itself, anchored at the bottom of the hunk it annotates. */
export function CommentCard({
  annotation,
  commentCount = 1,
  commentIndex = 0,
  onClose,
  theme,
  width,
}: {
  annotation: Annotation;
  anchorSide?: "old" | "new";
  layout?: Exclude<LayoutMode, "auto">;
  commentCount?: number;
  commentIndex?: number;
  onClose?: () => void;
  theme: AppTheme;
  width: number;
}) {
  const { bodyWidth, lines } = buildBodyLines(annotation, width);
  const metadataLabel = buildMetadataLabel(annotation.id, commentIndex, commentCount);
  const closeText = onClose ? "[x]" : "";
  const metadataWidth = Math.max(1, bodyWidth - (closeText ? closeText.length + 1 : 0));

  return (
    <box style={{ width: "100%", flexDirection: "column", backgroundColor: theme.noteBackground }}>
      {/* Always render the metadata row so card height stays predictable. */}
      <CommentRow theme={theme} width={width}>
        <box style={{ width: metadataWidth, height: 1, backgroundColor: theme.noteBackground }}>
          <text fg={theme.muted} bg={theme.noteBackground}>
            {padText(metadataLabel, metadataWidth)}
          </text>
        </box>
        {closeText ? (
          <box
            onMouseUp={onClose}
            style={{
              width: closeText.length + 1,
              height: 1,
              backgroundColor: theme.noteBackground,
            }}
          >
            <text fg={theme.muted} bg={theme.noteBackground}>{` ${closeText}`}</text>
          </box>
        ) : null}
      </CommentRow>

      {lines.map((line, index) => (
        <CommentRow key={`${line.kind}:${index}`} theme={theme} width={width}>
          <box style={{ width: bodyWidth, height: 1, backgroundColor: theme.noteBackground }}>
            <text
              // The user's words are softer; the agent's answer reads in the normal text color.
              fg={line.kind === "reply" ? theme.text : theme.muted}
              bg={theme.noteBackground}
            >
              {padText(line.text, bodyWidth)}
            </text>
          </box>
        </CommentRow>
      ))}

      {/* Diff-background spacer keeps adjacent comment cards separate. */}
      <box style={{ width: "100%", height: 1, backgroundColor: theme.panel }}>
        <text>{" ".repeat(Math.max(0, width))}</text>
      </box>
    </box>
  );
}

/** One row of the card: left indent + content. */
function CommentRow({
  children,
  theme,
  width: _width,
}: {
  children: React.ReactNode;
  theme: AppTheme;
  width: number;
}) {
  return (
    <box
      style={{
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: theme.noteBackground,
      }}
    >
      <box style={{ width: LEFT_INDENT, height: 1, backgroundColor: theme.noteBackground }}>
        <text>{" ".repeat(LEFT_INDENT)}</text>
      </box>
      <box style={{ width: GUTTER_PADDING, height: 1, backgroundColor: theme.noteBackground }}>
        <text>{" ".repeat(GUTTER_PADDING)}</text>
      </box>
      {children}
    </box>
  );
}
