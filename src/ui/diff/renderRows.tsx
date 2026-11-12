import { memo, type ReactNode } from "react";
import type { DiffFile } from "../../core/types";
import type { AppTheme } from "../themes";
import {
  resolveCodeBlockColumn,
  resolveSplitCellGeometry,
  resolveSplitPaneWidths,
  resolveStackCellGeometry,
} from "./codeColumns";
import type { DiffRow, RenderSpan, SplitLineCell, StackLineCell } from "./pierre";
import { blendHex } from "../lib/color";
import { fitText } from "../lib/text";

// Shared text fitting lives in lib/text; this module re-exports it for diff-row callers.
export { fitText };

/** Slice styled spans to one visible window while preserving color runs. */
function sliceSpansWindow(spans: RenderSpan[], offset: number, width: number) {
  if (width <= 0) {
    return {
      spans: [] as RenderSpan[],
      usedWidth: 0,
    };
  }

  const sliced: RenderSpan[] = [];
  let remainingOffset = Math.max(0, offset);
  let remaining = width;
  let usedWidth = 0;

  for (const span of spans) {
    if (remaining <= 0) {
      break;
    }

    if (remainingOffset >= span.text.length) {
      remainingOffset -= span.text.length;
      continue;
    }

    const start = remainingOffset;
    const text = span.text.slice(start, start + remaining);
    remainingOffset = 0;

    if (text.length === 0) {
      continue;
    }

    const nextSpan = {
      ...span,
      text,
    };

    const previous = sliced.at(-1);
    if (previous && previous.fg === nextSpan.fg && previous.bg === nextSpan.bg) {
      previous.text += nextSpan.text;
    } else {
      sliced.push(nextSpan);
    }

    remaining -= text.length;
    usedWidth += text.length;
  }

  return {
    spans: sliced,
    usedWidth,
  };
}

// Signs and line numbers outside the active hunk keep this share of their color, so the active
// hunk reads as lit without any extra chrome.
const INACTIVE_GUTTER_STRENGTH = 0.45;
const inactiveHunkThemes = new WeakMap<AppTheme, AppTheme>();

/** The theme rows outside the active hunk render with: only gutter glyph colors fade. */
function inactiveHunkTheme(theme: AppTheme) {
  let faded = inactiveHunkThemes.get(theme);
  if (!faded) {
    faded = {
      ...theme,
      addedSignColor: blendHex(theme.addedSignColor, theme.addedBg, INACTIVE_GUTTER_STRENGTH),
      removedSignColor: blendHex(theme.removedSignColor, theme.removedBg, INACTIVE_GUTTER_STRENGTH),
      muted: blendHex(theme.muted, theme.contextBg, INACTIVE_GUTTER_STRENGTH),
      lineNumberFg: blendHex(theme.lineNumberFg, theme.lineNumberBg, INACTIVE_GUTTER_STRENGTH),
    };
    inactiveHunkThemes.set(theme, faded);
  }
  return faded;
}

// Blank lead column where a colored rail used to sit; note guides still draw into it, and each
// row paints it with its own gutter background so the diff has no left edge.
const ROW_LEAD = " ";

// Line numbers sit outside the file card on the pane background; the sign and the code carry the
// card surface or the row's addition/deletion tint across the full row.
const SIGN_ZONE_WIDTH = 2;

/** Pick split-view colors from the semantic diff cell kind. */
function splitCellPalette(kind: SplitLineCell["kind"], theme: AppTheme) {
  if (kind === "addition") {
    return {
      gutterBg: theme.background,
      contentBg: theme.addedBg,
      signColor: theme.addedSignColor,
      numberColor: theme.lineNumberFg,
    };
  }

  if (kind === "deletion") {
    return {
      gutterBg: theme.background,
      contentBg: theme.removedBg,
      signColor: theme.removedSignColor,
      numberColor: theme.lineNumberFg,
    };
  }

  // The side with no counterpart line takes the card's plain surface, so it reads as blank space
  // rather than a filled gap.
  if (kind === "empty") {
    return {
      gutterBg: theme.background,
      contentBg: theme.contextBg,
      signColor: theme.muted,
      numberColor: theme.lineNumberFg,
    };
  }

  return {
    gutterBg: theme.background,
    contentBg: theme.contextBg,
    signColor: theme.muted,
    numberColor: theme.lineNumberFg,
  };
}

/** Pick stack-view colors from the semantic diff cell kind. */
function stackCellPalette(kind: StackLineCell["kind"], theme: AppTheme) {
  if (kind === "addition") {
    return {
      gutterBg: theme.background,
      contentBg: theme.addedBg,
      signColor: theme.addedSignColor,
      numberColor: theme.lineNumberFg,
    };
  }

  if (kind === "deletion") {
    return {
      gutterBg: theme.background,
      contentBg: theme.removedBg,
      signColor: theme.removedSignColor,
      numberColor: theme.lineNumberFg,
    };
  }

  return {
    gutterBg: theme.background,
    contentBg: theme.contextBg,
    signColor: theme.muted,
    numberColor: theme.lineNumberFg,
  };
}

/** Keep line numbers neutral while preserving the semantic color of change signs. */
function renderGutter(
  text: string,
  palette: ReturnType<typeof splitCellPalette>,
  keyPrefix: string,
) {
  // The last two columns are the sign and its space, which stay inside the row's tinted band;
  // only the line number before them sits outside the code block on the pane background.
  const numberText = text.slice(0, Math.max(0, text.length - SIGN_ZONE_WIDTH));
  const signZone = text.slice(numberText.length);
  return (
    <span key={`${keyPrefix}:gutter`} fg={palette.numberColor} bg={palette.gutterBg}>
      {numberText}
      <span fg={palette.signColor} bg={palette.contentBg}>
        {signZone}
      </span>
    </span>
  );
}

/** Render a fixed-width inline span sequence for one diff cell. */
function renderInlineSpans(
  spans: RenderSpan[],
  width: number,
  fallbackColor: string,
  fallbackBg: string,
  keyPrefix: string,
  horizontalOffset = 0,
) {
  const { spans: trimmed, usedWidth } = sliceSpansWindow(spans, horizontalOffset, width);
  let padding = Math.max(0, width - usedWidth);

  if (padding > 0) {
    const lastSpan = trimmed.at(-1);

    // Fold trailing padding into the last span when the colors already match.
    // That keeps the output identical while avoiding one extra rendered span.
    if (
      lastSpan &&
      (lastSpan.fg ?? fallbackColor) === fallbackColor &&
      (lastSpan.bg ?? fallbackBg) === fallbackBg
    ) {
      lastSpan.text += " ".repeat(padding);
      padding = 0;
    }
  }

  return (
    <>
      {trimmed.map((span, index) => (
        <span
          key={`${keyPrefix}:${index}`}
          fg={span.fg ?? fallbackColor}
          bg={span.bg ?? fallbackBg}
        >
          {span.text}
        </span>
      ))}
      {padding > 0 ? (
        <span
          key={`${keyPrefix}:padding`}
          fg={fallbackColor}
          bg={fallbackBg}
        >{`${" ".repeat(padding)}`}</span>
      ) : null}
    </>
  );
}

interface WrappedCellLine {
  gutterText: string;
  spans: RenderSpan[];
}

interface WrappedCellLayout {
  gutterWidth: number;
  palette: ReturnType<typeof splitCellPalette> | ReturnType<typeof stackCellPalette>;
  lines: WrappedCellLine[];
}

/** Wrap styled spans into visual lines while preserving color runs across splits. */
function wrapSpans(spans: RenderSpan[], width: number) {
  if (width <= 0) {
    return [[]] as RenderSpan[][];
  }

  const lines: RenderSpan[][] = [[]];
  let current = lines[0]!;
  let remaining = width;

  for (const span of spans) {
    let offset = 0;

    while (offset < span.text.length) {
      if (remaining <= 0) {
        current = [];
        lines.push(current);
        remaining = width;
      }

      const text = span.text.slice(offset, offset + remaining);
      if (text.length === 0) {
        break;
      }

      const nextSpan = {
        ...span,
        text,
      };
      const previous = current.at(-1);
      if (previous && previous.fg === nextSpan.fg && previous.bg === nextSpan.bg) {
        previous.text += nextSpan.text;
      } else {
        current.push(nextSpan);
      }

      offset += text.length;
      remaining -= text.length;
    }
  }

  return lines;
}

/** Build wrapped split-cell gutter/content lines while keeping continuation gutters blank. */
function buildWrappedSplitCell(
  cell: SplitLineCell,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  prefixWidth: number,
  theme: AppTheme,
) {
  const palette = splitCellPalette(cell.kind, theme);
  const { gutterWidth, contentWidth } = resolveSplitCellGeometry(
    width,
    lineNumberDigits,
    prefixWidth,
  );
  const firstGutterText = formatGutterText(
    cell.lineNumber,
    lineNumberDigits,
    showLineNumbers,
    gutterWidth,
  );
  const wrappedSpans = wrapSpans(cell.spans, contentWidth);

  return {
    gutterWidth,
    palette,
    lines: wrappedSpans.map((spans, index) => ({
      gutterText: index === 0 ? firstGutterText : " ".repeat(gutterWidth),
      spans,
    })),
  } satisfies WrappedCellLayout;
}

/**
 * The single stack-view line number: the new-file number for additions and context, the old-file
 * number for deletions, which have no new-side line.
 */
function stackLineNumber(cell: StackLineCell) {
  return cell.newLineNumber ?? cell.oldLineNumber;
}

/**
 * Lay out one gutter as the line number plus a two-column margin inside the row tint. The number
 * columns are always reserved, blank when numbers are hidden, so the code keeps its column either
 * way. There is no `+`/`-` sign: the row tint already marks additions and deletions.
 */
function formatGutterText(
  lineNumber: number | undefined,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  gutterWidth: number,
) {
  const number =
    showLineNumbers && lineNumber
      ? String(lineNumber).padStart(lineNumberDigits, " ")
      : " ".repeat(lineNumberDigits);
  return `${number} `.padEnd(gutterWidth);
}

/** Build wrapped stack-cell gutter/content lines while keeping continuation gutters blank. */
function buildWrappedStackCell(
  cell: StackLineCell,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  prefixWidth: number,
  theme: AppTheme,
) {
  const palette = stackCellPalette(cell.kind, theme);
  const { gutterWidth, contentWidth } = resolveStackCellGeometry(
    width,
    lineNumberDigits,
    prefixWidth,
  );
  const firstGutterText = formatGutterText(
    stackLineNumber(cell),
    lineNumberDigits,
    showLineNumbers,
    gutterWidth,
  );
  const wrappedSpans = wrapSpans(cell.spans, contentWidth);

  return {
    gutterWidth,
    palette,
    lines: wrappedSpans.map((spans, index) => ({
      gutterText: index === 0 ? firstGutterText : " ".repeat(gutterWidth),
      spans,
    })),
  } satisfies WrappedCellLayout;
}

/** Render one split-view cell as prefix + gutter + content spans. */
function renderSplitCell(
  cell: SplitLineCell,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  theme: AppTheme,
  keyPrefix: string,
  contentOffset = 0,
  prefix?: {
    text: string;
    fg: string;
    bg: string;
  },
) {
  const palette = splitCellPalette(cell.kind, theme);
  const prefixWidth = prefix?.text.length ?? 0;
  const { gutterWidth, contentWidth } = resolveSplitCellGeometry(
    width,
    lineNumberDigits,
    prefixWidth,
  );
  const gutterText = formatGutterText(
    cell.lineNumber,
    lineNumberDigits,
    showLineNumbers,
    gutterWidth,
  );

  return (
    <>
      {prefix ? (
        <span key={`${keyPrefix}:prefix`} fg={prefix.fg} bg={prefix.bg}>
          {prefix.text}
        </span>
      ) : null}
      {renderGutter(gutterText, palette, keyPrefix)}
      {renderInlineSpans(
        cell.spans,
        contentWidth,
        theme.text,
        palette.contentBg,
        `${keyPrefix}:content`,
        contentOffset,
      )}
    </>
  );
}

/** Render one stack-view cell as prefix + combined gutter + content spans. */
function renderStackCell(
  cell: StackLineCell,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  theme: AppTheme,
  keyPrefix: string,
  contentOffset = 0,
  prefix?: {
    text: string;
    fg: string;
    bg: string;
  },
) {
  const palette = stackCellPalette(cell.kind, theme);
  const prefixWidth = prefix?.text.length ?? 0;
  const { gutterWidth, contentWidth } = resolveStackCellGeometry(
    width,
    lineNumberDigits,
    prefixWidth,
  );

  return (
    <>
      {prefix ? (
        <span key={`${keyPrefix}:prefix`} fg={prefix.fg} bg={prefix.bg}>
          {prefix.text}
        </span>
      ) : null}
      {renderGutter(
        formatGutterText(stackLineNumber(cell), lineNumberDigits, showLineNumbers, gutterWidth),
        palette,
        keyPrefix,
      )}
      {renderInlineSpans(
        cell.spans,
        contentWidth,
        theme.text,
        palette.contentBg,
        `${keyPrefix}:content`,
        contentOffset,
      )}
    </>
  );
}

/** Render one already-wrapped split cell line with its persistent rail/separator prefix. */
function renderWrappedSplitCellLine(
  line: WrappedCellLine,
  palette: ReturnType<typeof splitCellPalette>,
  contentWidth: number,
  theme: AppTheme,
  keyPrefix: string,
  prefix: {
    text: string;
    fg: string;
    bg: string;
  },
) {
  return (
    <>
      <span key={`${keyPrefix}:prefix`} fg={prefix.fg} bg={prefix.bg}>
        {prefix.text}
      </span>
      {renderGutter(line.gutterText, palette, keyPrefix)}
      {renderInlineSpans(
        line.spans,
        contentWidth,
        theme.text,
        palette.contentBg,
        `${keyPrefix}:content`,
      )}
    </>
  );
}

/** Render one already-wrapped stack cell line with its persistent rail prefix. */
function renderWrappedStackCellLine(
  line: WrappedCellLine,
  palette: ReturnType<typeof stackCellPalette>,
  contentWidth: number,
  theme: AppTheme,
  keyPrefix: string,
  prefix: {
    text: string;
    fg: string;
    bg: string;
  },
) {
  return (
    <>
      <span key={`${keyPrefix}:prefix`} fg={prefix.fg} bg={prefix.bg}>
        {prefix.text}
      </span>
      {renderGutter(line.gutterText, palette, keyPrefix)}
      {renderInlineSpans(
        line.spans,
        contentWidth,
        theme.text,
        palette.contentBg,
        `${keyPrefix}:content`,
      )}
    </>
  );
}

/** Explain why a file still appears in the review stream even when it has no textual hunks. */
export function diffMessage(file: DiffFile) {
  if (file.metadata.type === "rename-pure") {
    return "No textual hunks. This change only renames the file.";
  }

  if (file.isBinary) {
    return "Binary file skipped";
  }

  if (file.isTooLarge) {
    return "File too large to render automatically.";
  }

  if (file.metadata.type === "new") {
    return "No textual hunks. The file is marked as new.";
  }

  if (file.metadata.type === "deleted") {
    return "No textual hunks. The file is marked as deleted.";
  }

  return "No textual hunks to render for this file.";
}

/**
 * Render collapsed and hunk-header rows.
 *
 * Hunks that carry one or more comments used to render a `[Comment]` badge
 * on the right side of the header. The card rendered beneath the hunk is
 * the canonical comment surface, so the badge was a redundant third
 * representation — dropped here for visual consistency.
 */
function renderHeaderRow(
  row: Extract<DiffRow, { type: "collapsed" | "hunk-header" }>,
  width: number,
  theme: AppTheme,
  codeBlockColumn: number,
  layout: "split" | "stack",
  anchorId?: string,
) {
  // Folds between hunks are a blank card row marked only by `...` in the number margin; hunk
  // headers, shown only with the metadata toggle, carry their `@@` range in muted text. Each card segment keeps its line-number
  // margin on the pane background, so split view gets one rule per half and never paints over the
  // right half's margin.
  const halves =
    layout === "split"
      ? [resolveSplitPaneWidths(width).leftWidth, resolveSplitPaneWidths(width).rightWidth]
      : [width];
  const fg = theme.muted;
  // A fold marks lines the review skips, so its number margin says so where the numbers sit:
  // right-aligned like them, as an ellipsis that fits even a one- or two-digit column.
  const numberWidth = Math.max(0, codeBlockColumn - 1);
  const skippedMarker = numberWidth >= 3 ? "..." : "…";
  const margin =
    row.type === "collapsed"
      ? `${skippedMarker.padStart(numberWidth)} `.slice(-codeBlockColumn)
      : " ".repeat(codeBlockColumn);

  /** One full-width row: number margin on the pane background, then card segments. */
  const renderLine = (lineKey: string, fill: (cardWidth: number, half: number) => string) => (
    <text key={lineKey}>
      {halves.map((halfWidth, index) => {
        const cardWidth = Math.max(0, halfWidth - codeBlockColumn);
        return (
          <span key={`${lineKey}:half:${index}`}>
            <span fg={theme.lineNumberFg} bg={theme.background}>
              {margin.slice(0, Math.min(halfWidth, codeBlockColumn))}
            </span>
            <span fg={fg} bg={theme.contextBg}>
              {fill(cardWidth, index)}
            </span>
          </span>
        );
      })}
    </text>
  );
  const line =
    row.type === "collapsed"
      ? renderLine(`${row.key}:fold`, (cardWidth) => " ".repeat(cardWidth))
      : renderLine(`${row.key}:range`, (cardWidth, half) =>
          half === 0 ? fitText(row.text, cardWidth).padEnd(cardWidth) : " ".repeat(cardWidth),
        );

  return (
    <box
      key={row.key}
      id={anchorId}
      style={{
        width: "100%",
        height: 1,
        // Only the card spans carry the card surface, so the row never paints past the block.
        backgroundColor: theme.background,
      }}
    >
      {line}
    </box>
  );
}

/**
 * Whether a folded run of unchanged lines sits between two hunks. Only those render, as one row
 * marked `...` in the number margin; folds at a file's top or bottom take no rows.
 */
function isFoldBetweenHunks(row: Extract<DiffRow, { type: "collapsed" | "hunk-header" }>) {
  return row.type === "collapsed" && row.hunkIndex > 0 && !row.key.endsWith(":trailing");
}

/** Measure how many terminal rows one rendered diff row occupies. */
export function measureRenderedRowHeight(
  row: DiffRow,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  showHunkHeaders: boolean,
  wrapLines: boolean,
  theme: AppTheme,
) {
  if (row.type === "hunk-header") {
    return showHunkHeaders ? 1 : 0;
  }

  if (row.type === "collapsed") {
    return isFoldBetweenHunks(row) ? 1 : 0;
  }

  if (row.type === "split-line") {
    if (!wrapLines) {
      return 1;
    }

    const markerWidth = 1;
    const { leftWidth, rightWidth } = resolveSplitPaneWidths(width);
    const leftLayout = buildWrappedSplitCell(
      row.left,
      leftWidth,
      lineNumberDigits,
      showLineNumbers,
      markerWidth,
      theme,
    );
    const rightLayout = buildWrappedSplitCell(
      row.right,
      rightWidth,
      lineNumberDigits,
      showLineNumbers,
      markerWidth,
      theme,
    );

    return Math.max(leftLayout.lines.length, rightLayout.lines.length);
  }

  if (row.type !== "stack-line") {
    return 1;
  }

  if (!wrapLines) {
    return 1;
  }

  const layout = buildWrappedStackCell(
    row.cell,
    width,
    lineNumberDigits,
    showLineNumbers,
    ROW_LEAD.length,
    theme,
  );
  return layout.lines.length;
}

/** Render one diff row. */
function renderRow(
  row: DiffRow,
  width: number,
  lineNumberDigits: number,
  showLineNumbers: boolean,
  showHunkHeaders: boolean,
  wrapLines: boolean,
  codeHorizontalOffset: number,
  baseTheme: AppTheme,
  layout: "split" | "stack",
  selected: boolean,
  annotated: boolean,
  anchorId?: string,
  noteGuideSide?: "old" | "new",
) {
  let baseRow: ReactNode;
  const theme = selected ? baseTheme : inactiveHunkTheme(baseTheme);

  if (row.type === "collapsed") {
    baseRow = isFoldBetweenHunks(row)
      ? renderHeaderRow(
          row,
          width,
          baseTheme,
          resolveCodeBlockColumn(lineNumberDigits),
          layout,
          anchorId,
        )
      : null;
  } else if (row.type === "hunk-header") {
    baseRow = showHunkHeaders
      ? renderHeaderRow(
          row,
          width,
          baseTheme,
          resolveCodeBlockColumn(lineNumberDigits),
          layout,
          anchorId,
        )
      : null;
  } else if (row.type === "split-line") {
    const guideOnOldSide = noteGuideSide === "old";
    const guideOnNewSide = noteGuideSide === "new";

    // Reserve fixed columns for the diff rails and center separator slot.
    const { leftWidth, rightWidth } = resolveSplitPaneWidths(width);
    const rightRenderWidth = Math.max(0, rightWidth - (guideOnNewSide ? 1 : 0));
    // The lead column takes its row's gutter background so no colored edge shows.
    const leftPrefix = {
      text: guideOnOldSide ? "│" : ROW_LEAD,
      fg: theme.noteBorder,
      bg: splitCellPalette(row.left.kind, theme).gutterBg,
    };
    const rightPrefix = {
      text: ROW_LEAD,
      fg: theme.noteBorder,
      bg: splitCellPalette(row.right.kind, theme).gutterBg,
    };

    if (!wrapLines) {
      baseRow = (
        <box id={anchorId} style={{ width: "100%", height: 1 }}>
          <text>
            {renderSplitCell(
              row.left,
              leftWidth,
              lineNumberDigits,
              showLineNumbers,
              theme,
              `${row.key}:left`,
              codeHorizontalOffset,
              leftPrefix,
            )}
            {renderSplitCell(
              row.right,
              rightRenderWidth,
              lineNumberDigits,
              showLineNumbers,
              theme,
              `${row.key}:right`,
              codeHorizontalOffset,
              rightPrefix,
            )}
            {guideOnNewSide ? (
              <span key={`${row.key}:note-guide`} fg={theme.noteBorder}>
                │
              </span>
            ) : null}
          </text>
        </box>
      );
    } else {
      const leftLayout = buildWrappedSplitCell(
        row.left,
        leftWidth,
        lineNumberDigits,
        showLineNumbers,
        leftPrefix.text.length,
        theme,
      );
      const rightLayout = buildWrappedSplitCell(
        row.right,
        rightRenderWidth,
        lineNumberDigits,
        showLineNumbers,
        rightPrefix.text.length,
        theme,
      );
      const leftContentWidth = Math.max(
        0,
        leftWidth - leftPrefix.text.length - leftLayout.gutterWidth,
      );
      const rightContentWidth = Math.max(
        0,
        rightRenderWidth - rightPrefix.text.length - rightLayout.gutterWidth,
      );
      const visualLineCount = Math.max(leftLayout.lines.length, rightLayout.lines.length);

      baseRow = (
        <box id={anchorId} style={{ width: "100%", flexDirection: "column" }}>
          {Array.from({ length: visualLineCount }, (_, index) => {
            const leftLine = leftLayout.lines[index] ?? {
              gutterText: " ".repeat(leftLayout.gutterWidth),
              spans: [],
            };
            const rightLine = rightLayout.lines[index] ?? {
              gutterText: " ".repeat(rightLayout.gutterWidth),
              spans: [],
            };

            return (
              <box key={`${row.key}:wrap:${index}`} style={{ width: "100%", height: 1 }}>
                <text>
                  {renderWrappedSplitCellLine(
                    leftLine,
                    leftLayout.palette,
                    leftContentWidth,
                    theme,
                    `${row.key}:left:${index}`,
                    leftPrefix,
                  )}
                  {renderWrappedSplitCellLine(
                    rightLine,
                    rightLayout.palette,
                    rightContentWidth,
                    theme,
                    `${row.key}:right:${index}`,
                    rightPrefix,
                  )}
                  {guideOnNewSide ? (
                    <span key={`${row.key}:note-guide:${index}`} fg={theme.noteBorder}>
                      │
                    </span>
                  ) : null}
                </text>
              </box>
            );
          })}
        </box>
      );
    }
  } else if (row.type === "stack-line") {
    const guideOnOldSide = noteGuideSide === "old";
    const guideOnNewSide = noteGuideSide === "new";
    const contentWidth = Math.max(0, width - (guideOnNewSide ? 1 : 0));
    const prefix = {
      text: guideOnOldSide ? "│" : ROW_LEAD,
      fg: theme.noteBorder,
      bg: stackCellPalette(row.cell.kind, theme).gutterBg,
    };

    if (!wrapLines) {
      baseRow = (
        <box id={anchorId} style={{ width: "100%", height: 1 }}>
          <text>
            {renderStackCell(
              row.cell,
              contentWidth,
              lineNumberDigits,
              showLineNumbers,
              theme,
              `${row.key}:stack`,
              codeHorizontalOffset,
              prefix,
            )}
            {guideOnNewSide ? (
              <span key={`${row.key}:note-guide`} fg={theme.noteBorder}>
                │
              </span>
            ) : null}
          </text>
        </box>
      );
    } else {
      const layout = buildWrappedStackCell(
        row.cell,
        contentWidth,
        lineNumberDigits,
        showLineNumbers,
        prefix.text.length,
        theme,
      );
      const wrappedContentWidth = Math.max(
        0,
        contentWidth - prefix.text.length - layout.gutterWidth,
      );

      baseRow = (
        <box id={anchorId} style={{ width: "100%", flexDirection: "column" }}>
          {layout.lines.map((line, index) => (
            <box key={`${row.key}:wrap:${index}`} style={{ width: "100%", height: 1 }}>
              <text>
                {renderWrappedStackCellLine(
                  line,
                  layout.palette,
                  wrappedContentWidth,
                  theme,
                  `${row.key}:stack:${index}`,
                  prefix,
                )}
                {guideOnNewSide ? (
                  <span key={`${row.key}:note-guide:${index}`} fg={theme.noteBorder}>
                    │
                  </span>
                ) : null}
              </text>
            </box>
          ))}
        </box>
      );
    }
  } else {
    baseRow = (
      <box style={{ width: "100%", height: 1 }}>
        <text fg={theme.muted}>Unsupported row.</text>
      </box>
    );
  }

  return baseRow;
}

interface DiffRowViewProps {
  row: DiffRow;
  width: number;
  lineNumberDigits: number;
  showLineNumbers: boolean;
  showHunkHeaders: boolean;
  wrapLines: boolean;
  codeHorizontalOffset: number;
  theme: AppTheme;
  layout: "split" | "stack";
  /** Whether the row belongs to the active hunk, whose gutter keeps full color. */
  selected: boolean;
  annotated: boolean;
  anchorId?: string;
  noteGuideSide?: "old" | "new";
}

/** Render one diff row, memoized to avoid unnecessary rerenders. */
export const DiffRowView = memo(
  function DiffRowViewComponent({
    row,
    width,
    lineNumberDigits,
    showLineNumbers,
    showHunkHeaders,
    wrapLines,
    codeHorizontalOffset,
    theme,
    layout,
    selected,
    annotated,
    anchorId,
    noteGuideSide,
  }: DiffRowViewProps) {
    return renderRow(
      row,
      width,
      lineNumberDigits,
      showLineNumbers,
      showHunkHeaders,
      wrapLines,
      codeHorizontalOffset,
      theme,
      layout,
      selected,
      annotated,
      anchorId,
      noteGuideSide,
    );
  },
  (previous, next) => {
    return (
      previous.row === next.row &&
      previous.width === next.width &&
      previous.lineNumberDigits === next.lineNumberDigits &&
      previous.showLineNumbers === next.showLineNumbers &&
      previous.showHunkHeaders === next.showHunkHeaders &&
      previous.wrapLines === next.wrapLines &&
      previous.codeHorizontalOffset === next.codeHorizontalOffset &&
      previous.theme === next.theme &&
      previous.layout === next.layout &&
      previous.selected === next.selected &&
      previous.annotated === next.annotated &&
      previous.anchorId === next.anchorId &&
      previous.noteGuideSide === next.noteGuideSide
    );
  },
);
