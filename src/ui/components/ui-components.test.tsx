import { describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, createRef, useEffect, useState, type ReactNode } from "react";
import type { AppBootstrap, DiffFile } from "../../core/types";
import { createTestVcsAppBootstrap } from "../../../test/helpers/app-bootstrap";
import { createTestDiffFile as buildTestDiffFile, lines } from "../../../test/helpers/diff-helpers";
import { hexColorDistance } from "../lib/color";
import { FILE_SEPARATOR_ROWS } from "../lib/fileSectionLayout";
import { resolveTheme } from "../themes";
import { measureDiffSectionGeometry } from "../lib/diffSectionGeometry";

const { AppHost } = await import("../AppHost");
const { buildSidebarEntries } = await import("../lib/files");
const { HelpDialog } = await import("./chrome/HelpDialog");
const { SidebarPane } = await import("./panes/SidebarPane");
const { CommentCard } = await import("./panes/CommentCard");
const { DiffPane } = await import("./panes/DiffPane");
const { DiffFileHeaderRow } = await import("./panes/DiffFileHeaderRow");
const { StatusBar } = await import("./chrome/StatusBar");
const { DiffSectionPlaceholder } = await import("./panes/DiffSectionPlaceholder");
const { PierreDiffView } = await import("../diff/PierreDiffView");

function createTestDiffFile(
  id: string,
  path: string,
  before: string,
  after: string,
  withAgent = false,
): DiffFile {
  return buildTestDiffFile({
    after,
    annotations: withAgent
      ? [
          {
            newRange: [2, 2],
            rationale: `Why ${path} changed`,
            summary: `Annotation for ${path}`,
          },
        ]
      : [],
    before,
    context: 3,
    id,
    path,
  });
}

function createWindowingFiles(count: number) {
  return Array.from({ length: count }, (_, index) =>
    createTestDiffFile(
      `window-${index + 1}`,
      `window-${index + 1}.ts`,
      lines(`export const file${index + 1} = ${index + 1};`),
      lines(
        `export const file${index + 1} = ${index + 10};`,
        `export const file${index + 1}Extra = true;`,
      ),
    ),
  );
}

function createHighlightPrefetchWindowFiles() {
  return Array.from({ length: 4 }, (_, index) => {
    const marker = `prefetchMarker${index + 1}`;
    const before = lines(
      `export const ${marker} = ${index + 1};`,
      ...Array.from(
        { length: 8 },
        (_, lineIndex) =>
          `export function keep${index + 1}_${lineIndex}(value: number) { return value + ${lineIndex}; }`,
      ),
    );
    const after = lines(
      `export const ${marker} = ${index + 100};`,
      ...Array.from(
        { length: 8 },
        (_, lineIndex) =>
          `export function keep${index + 1}_${lineIndex}(value: number) { return value * ${lineIndex + 2}; }`,
      ),
    );

    return createTestDiffFile(`prefetch-${index + 1}`, `prefetch-${index + 1}.ts`, before, after);
  });
}

function createMultiHunkDiffFile(id: string, path: string) {
  const before = lines(
    "export const line1 = 1;",
    "export const line2 = 2;",
    "export const line3 = 3;",
    "export const line4 = 4;",
    "export const line5 = 5;",
    "export const line6 = 6;",
    "export const line7 = 7;",
    "export const line8 = 8;",
    "export const line9 = 9;",
    "export const line10 = 10;",
    "export const line11 = 11;",
    "export const line12 = 12;",
  );
  const after = lines(
    "export const line1 = 1;",
    "export const line2 = 200;",
    "export const line3 = 3;",
    "export const line4 = 4;",
    "export const line5 = 5;",
    "export const line6 = 6;",
    "export const line7 = 7;",
    "export const line8 = 8;",
    "export const line9 = 9;",
    "export const line10 = 10;",
    "export const line11 = 1100;",
    "export const line12 = 12;",
  );

  return createTestDiffFile(id, path, before, after);
}

/** Build one tall file with two distant changed lines so the diff parser produces two hunks. */
function createWideTwoHunkDiffFile(id: string, path: string, start = 1) {
  const beforeLines = Array.from(
    { length: 80 },
    (_, index) => `export const line${start + index} = ${start + index};`,
  );
  const afterLines = [...beforeLines];

  afterLines[0] = `export const line${start} = ${start + 1000};`;
  afterLines[59] = `export const line${start + 59} = ${start + 5900};`;

  return createTestDiffFile(id, path, lines(...beforeLines), lines(...afterLines));
}

function createViewportSizedBottomHunkDiffFile(id: string, path: string) {
  const beforeLines = Array.from(
    { length: 20 },
    (_, index) => `export const line${index + 1} = ${index + 1};`,
  );
  const afterLines = [...beforeLines];

  afterLines[1] = "export const line2 = 200;";
  afterLines[13] = "export const line14 = 1400;";
  afterLines[14] = "export const line15 = 1500;";
  afterLines[15] = "export const line16 = 1600;";

  return createTestDiffFile(id, path, lines(...beforeLines), lines(...afterLines));
}

function createWrappedViewportSizedBottomHunkDiffFile(id: string, path: string) {
  const beforeLines = Array.from(
    { length: 20 },
    (_, index) => `export const line${index + 1} = ${index + 1};`,
  );
  const afterLines = [...beforeLines];

  afterLines[1] = "export const line2 = 200;";
  afterLines[13] =
    "export const line14 = 'this is a long wrapped replacement for line 14 in the selected hunk';";
  afterLines[14] =
    "export const line15 = 'this is a long wrapped replacement for line 15 in the selected hunk';";

  return createTestDiffFile(id, path, lines(...beforeLines), lines(...afterLines));
}

function createTallDiffFile(id: string, path: string, count: number) {
  const before = lines(
    ...Array.from({ length: count }, (_, index) => `export const line${index + 1} = ${index + 1};`),
  );
  const after = lines(
    ...Array.from(
      { length: count },
      (_, index) => `export const line${index + 1} = ${index + 1001};`,
    ),
  );

  return createTestDiffFile(id, path, before, after);
}

function createCollapsedTopDiffFile(
  id: string,
  path: string,
  totalLines: number,
  changedLine: number,
) {
  const beforeLines = Array.from(
    { length: totalLines },
    (_, index) => `export const line${String(index + 1).padStart(3, "0")} = ${index + 1};`,
  );
  const afterLines = [...beforeLines];
  afterLines[changedLine - 1] = `export const line${changedLine} = 9999;`;

  return createTestDiffFile(id, path, lines(...beforeLines), lines(...afterLines));
}

function createDiffPaneProps(
  files: DiffFile[],
  theme = resolveTheme("midnight", null),
  overrides: Partial<Parameters<typeof DiffPane>[0]> = {},
): Parameters<typeof DiffPane>[0] {
  return {
    diffContentWidth: 72,
    files,
    headerLabelWidth: 40,
    headerStatsWidth: 16,
    layout: "split" as const,
    scrollRef: createRef<ScrollBoxRenderable>(),
    selectedFileId: files[0]?.id,
    selectedHunkIndex: 0,
    showLineNumbers: true,
    showHunkHeaders: true,
    wrapLines: false,
    wrapToggleScrollTop: null,
    theme,
    width: 76,
    onSelectFile: () => {},
    ...overrides,
  };
}

function settleDiffPane(setup: Awaited<ReturnType<typeof testRender>>) {
  return act(async () => {
    await setup.renderOnce();
    await Bun.sleep(0);
    await setup.renderOnce();
  });
}

async function waitForFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (frame: string) => boolean,
  attempts = 8,
) {
  let frame = setup.captureCharFrame();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate(frame)) {
      return frame;
    }

    await act(async () => {
      await Bun.sleep(0);
      await setup.renderOnce();
    });
    frame = setup.captureCharFrame();
  }

  return frame;
}

function createBootstrap(): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:ui",
    files: [
      createTestDiffFile(
        "alpha",
        "alpha.ts",
        "export const alpha = 1;\n",
        "export const alpha = 2;\nexport const add = true;\n",
        true,
      ),
      createTestDiffFile(
        "beta",
        "beta.ts",
        "export const beta = 1;\n",
        "export const betaValue = 1;\n",
      ),
    ],
    initialMode: "split",
    inputMode: "auto",
    summary: "Patch summary",
  });
}

function createWrapBootstrap(): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:wrap",
    files: [
      createTestDiffFile(
        "wrap",
        "wrap.ts",
        "export const message = 'short';\n",
        "export const message = 'this is a very long wrapped line for diff rendering coverage';\n",
      ),
    ],
  });
}

function createEmptyDiffFile(type: "change" | "rename-pure" | "new" | "deleted"): DiffFile {
  return {
    id: `empty:${type}`,
    path: `${type}.ts`,
    patch: "",
    language: "typescript",
    stats: {
      additions: 0,
      deletions: 0,
    },
    metadata: {
      hunks: [],
      type,
    } as never,
    annotations: [],
  };
}

async function captureFrame(node: ReactNode, width = 120, height = 24) {
  const setup = await testRender(node, { width, height });

  try {
    await act(async () => {
      await setup.renderOnce();
    });

    return setup.captureCharFrame();
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
}

function frameHasHighlightedMarker(
  frame: { lines: Array<{ spans: Array<{ text: string; fg?: unknown; bg?: unknown }> }> },
  marker: string,
) {
  return frame.lines.some((line) => {
    const text = line.spans.map((span) => span.text).join("");

    if (!text.includes(marker)) {
      return false;
    }

    return line.spans.some(
      (span) => span.text.includes(marker) && span.text.trim().length < text.trim().length,
    );
  });
}

/** Convert captured RGBA output back into a #rrggbb color string for contrast assertions. */
function capturedColorToHex(color: { buffer?: ArrayLike<number> } | undefined) {
  const buffer = color?.buffer;
  if (!buffer || buffer[0] == null || buffer[1] == null || buffer[2] == null) {
    return null;
  }

  const componentToHex = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, "0");

  return `#${componentToHex(buffer[0])}${componentToHex(buffer[1])}${componentToHex(buffer[2])}`;
}

/** Measure the rendered background contrast between one word-diff span and its surrounding line. */
function renderedWordDiffBackgroundDistance(
  frame: { lines: Array<{ spans: Array<{ text: string; bg?: { buffer?: ArrayLike<number> } }> }> },
  marker: string,
) {
  for (const line of frame.lines) {
    const spanIndex = line.spans.findIndex((span) => span.text.includes(marker));
    if (spanIndex <= 0) {
      continue;
    }

    const wordBg = capturedColorToHex(line.spans[spanIndex]?.bg);
    const surroundingBg = capturedColorToHex(line.spans[spanIndex - 1]?.bg);
    if (!wordBg || !surroundingBg) {
      continue;
    }

    return hexColorDistance(wordBg, surroundingBg);
  }

  return null;
}

describe("UI components", () => {
  test("diff file headers retain the basename when a long directory must be truncated", async () => {
    const file = createTestDiffFile(
      "header",
      "src/very/long/directory/handler.ts",
      "const value = 1;\n",
      "const value = 2;\n",
    );
    const frame = await captureFrame(
      <DiffFileHeaderRow
        file={file}
        headerLabelWidth={14}
        headerStatsWidth={16}
        theme={resolveTheme("zed", null)}
      />,
      32,
      1,
    );
    expect(frame).toContain("handler.ts");
    expect(frame).toContain("…");
    expect(frame).toContain("+1 -1");
  });

  test.each(["split", "stack"] as const)(
    "the line-number margin marks lines skipped between hunks with an ellipsis in %s",
    async (layout) => {
      // Lines 1 and 3 change and line 2 does not, so line 2 folds between two hunks.
      const file = buildTestDiffFile({ id: "skipped", path: "skipped.ts" });
      const theme = resolveTheme("zed", null);
      const setup = await testRender(
        <PierreDiffView
          file={file}
          layout={layout}
          showLineNumbers={true}
          showHunkHeaders={false}
          theme={theme}
          width={72}
          selectedHunkIndex={0}
          scrollable={false}
        />,
        { width: 76, height: 12 },
      );
      try {
        await settleDiffPane(setup);
        const frameLines = setup.captureCharFrame().split("\n");
        const foldLine = frameLines.find((line) => line.includes("...")) ?? "";
        // The ellipsis alone marks the fold: no rule across the card, just `...` where numbers sit.
        // Split marks both halves, stack its single number column.
        expect(foldLine.trim()).toMatch(layout === "split" ? /^\.\.\. +\.\.\.$/ : /^\.\.\.$/);
        expect(frameLines.some((line) => line.includes("─"))).toBe(false);
        const numberLine = frameLines.find((line) => line.includes("gamma")) ?? "";
        expect(foldLine.indexOf("...") + 3).toBe(numberLine.indexOf("3") + 1);
      } finally {
        await act(async () => {
          setup.renderer.destroy();
        });
      }
    },
  );

  test.each([
    { layout: "split", wrapLines: false },
    { layout: "split", wrapLines: true },
    { layout: "stack", wrapLines: false },
    { layout: "stack", wrapLines: true },
  ] as const)(
    "diff gutters keep numbers neutral and rows tinted without signs in $layout (wrap=$wrapLines)",
    async ({ layout, wrapLines }) => {
      const file = createTestDiffFile(
        "gutters",
        "gutters.ts",
        `const message = 'previous ${"long content ".repeat(8)}';\n`,
        `const message = 'updated ${"long content ".repeat(8)}';\n`,
      );
      const theme = resolveTheme("zed", null);
      const setup = await testRender(
        <PierreDiffView
          file={file}
          layout={layout}
          wrapLines={wrapLines}
          showLineNumbers={true}
          showHunkHeaders={false}
          theme={theme}
          width={72}
          selectedHunkIndex={0}
          scrollable={false}
        />,
        { width: 76, height: 18 },
      );
      try {
        await settleDiffPane(setup);
        const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
        // No +/- signs: the row tint alone marks additions and deletions.
        expect(spans.some((span) => ["+", "-"].includes(span.text.trim()))).toBe(false);
        expect(spans.some((span) => capturedColorToHex(span.bg) === theme.addedBg)).toBe(true);
        expect(spans.some((span) => capturedColorToHex(span.bg) === theme.removedBg)).toBe(true);
        expect(
          spans.some(
            (span) =>
              /^\s*\d+(?:\s+\d+)?\s*$/.test(span.text) &&
              capturedColorToHex(span.fg) === theme.lineNumberFg,
          ),
        ).toBe(true);
      } finally {
        await act(async () => {
          setup.renderer.destroy();
        });
      }
    },
  );

  test.each(["split", "stack"] as const)(
    "only the active hunk keeps full-color line numbers in %s view",
    async (layout) => {
      const before = Array.from({ length: 30 }, (_, index) => `const line${index} = 0;`);
      const after = before.map((line, index) =>
        index === 1 ? "const first = 2;" : index === 27 ? "const second = 2;" : line,
      );
      const file = createTestDiffFile(
        "active-hunk",
        "active-hunk.ts",
        `${before.join("\n")}\n`,
        `${after.join("\n")}\n`,
      );
      const theme = resolveTheme("zed", null);
      const setup = await testRender(
        <PierreDiffView
          file={file}
          layout={layout}
          showLineNumbers={true}
          showHunkHeaders={false}
          theme={theme}
          width={96}
          selectedHunkIndex={0}
          scrollable={false}
        />,
        { width: 100, height: 40 },
      );
      try {
        await settleDiffPane(setup);
        const lines = setup.captureSpans().lines;
        const lineNumberColor = (marker: string) => {
          // Syntax highlighting may split the marker across spans, so match the whole row.
          const line = lines.find((candidate) =>
            candidate.spans
              .map((span) => span.text)
              .join("")
              .includes(marker),
          );
          const number = line?.spans.find((span) => /^\s*\d+\s*$/.test(span.text));
          return number ? capturedColorToHex(number.fg) : undefined;
        };
        expect(lineNumberColor("first = 2")).toBe(theme.lineNumberFg);
        const inactive = lineNumberColor("second = 2");
        expect(inactive).toBeDefined();
        expect(inactive).not.toBe(theme.lineNumberFg);
      } finally {
        await act(async () => {
          setup.renderer.destroy();
        });
      }
    },
  );

  test("line numbers sit outside the code block while the block margin keeps the row tint", async () => {
    const file = createTestDiffFile(
      "gutter-split",
      "gutter-split.ts",
      "export const value = 1;\n",
      "export const value = 2;\n",
    );
    const theme = resolveTheme("zed", null);
    const setup = await testRender(
      <PierreDiffView
        file={file}
        layout="stack"
        showLineNumbers={true}
        showHunkHeaders={false}
        theme={theme}
        width={60}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      { width: 64, height: 6 },
    );
    try {
      await settleDiffPane(setup);
      const addedRow = setup.captureSpans().lines.find((line) =>
        line.spans
          .map((span) => span.text)
          .join("")
          .includes("value = 2"),
      );
      if (!addedRow) throw new Error("Missing the added row");
      const numberIndex = addedRow.spans.findIndex((span) => span.text.trim() === "1");
      // The span right after the number is the block's two-column margin, already tinted.
      const marginSpan = addedRow.spans[numberIndex + 1];
      expect(capturedColorToHex(addedRow.spans[numberIndex]?.bg)).toBe(theme.background);
      expect(marginSpan?.text.trim()).toBe("");
      expect(capturedColorToHex(marginSpan?.bg)).toBe(theme.addedBg);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("split view leaves the side without a counterpart line blank", async () => {
    const file = createTestDiffFile(
      "blank-side",
      "blank-side.ts",
      "export const alpha = 1;\n",
      "export const alpha = 2;\nexport const added = true;\n",
    );
    const theme = resolveTheme("zed", null);
    const setup = await testRender(
      <PierreDiffView
        file={file}
        layout="split"
        showLineNumbers={true}
        showHunkHeaders={false}
        theme={theme}
        width={96}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      { width: 100, height: 12 },
    );
    try {
      await settleDiffPane(setup);
      const addedOnlyRow = setup.captureSpans().lines.find((line) =>
        line.spans
          .map((span) => span.text)
          .join("")
          .includes("added = true"),
      );
      if (!addedOnlyRow) throw new Error("Missing the addition-only row");
      // The empty left half carries no tint: only the pane background (gutter) and the card's
      // plain surface (code) appear before the right cell's addition tint starts.
      const untinted = new Set<string | null>([theme.background, theme.contextBg]);
      const firstFilled = addedOnlyRow.spans.findIndex(
        (span) => !untinted.has(capturedColorToHex(span.bg)),
      );
      const blankWidth = addedOnlyRow.spans
        .slice(0, firstFilled)
        .reduce((width, span) => width + span.text.length, 0);
      expect(blankWidth).toBeGreaterThanOrEqual(46);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("SidebarPane lists filenames only with global change totals in its heading", async () => {
    const theme = resolveTheme("midnight", null);
    const files = [
      createTestDiffFile(
        "app",
        "src/ui/App.tsx",
        "export const app = 1;\n",
        "export const app = 2;\nexport const view = true;\n",
        true,
      ),
      createTestDiffFile(
        "menu",
        "src/ui/MenuDropdown.tsx",
        lines(
          "export const menu = 1;",
          "export const remove1 = true;",
          "export const remove2 = true;",
          "export const remove3 = true;",
        ),
        "export const menu = 1;\n",
      ),
      createTestDiffFile(
        "watch",
        "src/core/watch.ts",
        "export const watch = 1;\n",
        lines(
          "export const watch = 1;",
          "export const add1 = true;",
          "export const add2 = true;",
          "export const add3 = true;",
          "export const add4 = true;",
          "export const add5 = true;",
        ),
      ),
      {
        ...createTestDiffFile(
          "rename",
          "src/ui/Renamed.tsx",
          "export const renamed = true;\n",
          "export const renamed = true;\n",
        ),
        previousPath: "src/ui/Legacy.tsx",
        stats: { additions: 0, deletions: 0 },
      },
    ];
    const frame = await captureFrame(
      <SidebarPane
        entries={buildSidebarEntries(files)}
        scrollRef={createRef()}
        selectedFileId="app"
        theme={theme}
        width={42}
        onSelectFile={() => {}}
      />,
      46,
      16,
    );

    // Filenames only, with no folder headings or indentation.
    expect(frame).not.toContain("src/ui/");
    expect(frame).not.toContain("src/core/");
    const frameLines = frame.split("\n");
    const appColumn = frameLines.find((line) => line.includes("App.tsx"))?.indexOf("○ ") ?? -1;
    const watchColumn = frameLines.find((line) => line.includes("watch.ts"))?.indexOf("○ ") ?? -2;
    // Pane padding, the selection rail, then one blank column before the icon.
    expect(appColumn).toBe(3);
    expect(appColumn).toBe(watchColumn);
    // States read by shape, not only color: modified files get a hollow dot instead of a letter.
    expect(frame).toContain("○ App.tsx");
    expect(frame).not.toMatch(/\bM App\.tsx/);
    expect(frame).toContain(" App.tsx");
    expect(frame).toContain(" MenuDropdown.tsx");
    expect(frame).toContain(" watch.ts");
    expect(frame).toContain("4 Changes");
    expect(frame).toContain("+7 −4");
    expect(frame).toContain("*1");
    expect(frame.split("\n").find((line) => line.includes("App.tsx"))).not.toContain("+2");
    expect(frame).not.toContain("+0");
    expect(frame).not.toContain("−0");
    expect(frame).not.toContain("M +2 -1 AI");
  });

  test("DiffPane renders all diff sections in file order", async () => {
    const bootstrap = createBootstrap();
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={72}
        files={bootstrap.changeset.files}
        headerLabelWidth={40}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="alpha"
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={true}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={76}
        onSelectFile={() => {}}
      />,
      80,
      18,
    );

    expect(frame).toContain("alpha.ts");
    expect(frame).toContain("beta.ts");
    expect(frame).toContain("@@ -1,1 +1,2 @@");
    expect(frame).toContain("@@ -1,1 +1,1 @@");
    // The inline card under alpha.ts's hunk is the canonical comment surface.
    expect(frame).toContain("Annotation for alpha.ts");
    expect(frame.indexOf("alpha.ts")).toBeLessThan(frame.indexOf("beta.ts"));
  });

  test("DiffPane scrolls a later selected file into view in the windowed path", async () => {
    const files = createWindowingFiles(6);
    const theme = resolveTheme("midnight", null);
    const props = createDiffPaneProps(files, theme, {
      diffContentWidth: 88,
      selectedFileId: files[5]?.id,
      width: 92,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 96,
      height: 12,
    });

    try {
      await settleDiffPane(setup);
      const frame = await waitForFrame(
        setup,
        (nextFrame) => nextFrame.includes("window-6.ts") && nextFrame.includes("file6Extra = true"),
        20,
      );

      expect(frame).toContain("window-6.ts");
      expect(frame).toContain("export const file6Extra = true;");
      expect(frame).not.toContain("window-1.ts");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane scrolls to the selected later hunk when hunk headers are hidden", async () => {
    const theme = resolveTheme("midnight", null);
    const files = [
      createTestDiffFile(
        "intro",
        "intro.ts",
        lines("export const intro = 1;"),
        lines("export const intro = 2;", "export const introExtra = true;"),
      ),
      createMultiHunkDiffFile("target", "target.ts"),
    ];
    const props = createDiffPaneProps(files, theme, {
      diffContentWidth: 96,
      headerLabelWidth: 48,
      selectedFileId: "target",
      selectedHunkIndex: 1,
      showHunkHeaders: false,
      width: 100,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 104,
      height: 10,
    });

    try {
      await settleDiffPane(setup);
      const frame = await waitForFrame(
        setup,
        (text) => text.includes("11   export const line11 = 11;") && !text.includes("intro.ts"),
      );

      expect(frame).toContain("11   export const line11 = 11;");
      expect(frame).toContain("11   export const line11 = 1100;");
      expect(frame).not.toContain("2   export const line2 = 2;");
      expect(frame).not.toContain("2   export const line2 = 200;");
      expect(frame).not.toContain("intro.ts");
      expect(frame).not.toContain("@@ -1,3 +1,3 @@");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane keeps the sticky-header lane stable through the divider and next-header handoff", async () => {
    const theme = resolveTheme("midnight", null);
    const firstFile = createTallDiffFile("first", "first.ts", 18);
    const secondFile = createTallDiffFile("second", "second.ts", 18);
    const scrollRef = createRef<ScrollBoxRenderable>();
    const props = createDiffPaneProps([firstFile, secondFile], theme, {
      diffContentWidth: 88,
      headerLabelWidth: 48,
      headerStatsWidth: 16,
      scrollRef,
      width: 92,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 96,
      height: 10,
    });

    const firstBodyHeight = measureDiffSectionGeometry(
      firstFile,
      "split",
      true,
      theme,
      [],
      88,
      true,
      false,
    ).bodyHeight;
    const secondHeaderTop = firstBodyHeight + FILE_SEPARATOR_ROWS;
    const separatorTop = firstBodyHeight;
    const settleStickyScroll = async () => {
      await act(async () => {
        for (let iteration = 0; iteration < 2; iteration += 1) {
          await Bun.sleep(0);
          await setup.renderOnce();
        }
      });
    };

    try {
      await settleDiffPane(setup);

      let frame = setup.captureCharFrame();
      expect((frame.match(/first\.ts/g) ?? []).length).toBe(1);

      await act(async () => {
        scrollRef.current?.scrollTo(3);
      });
      await settleStickyScroll();

      frame = await waitForFrame(setup, (nextFrame) => nextFrame.includes("first.ts"));
      expect(frame).toContain("first.ts");
      const stickyViewportHeight = scrollRef.current?.viewport.height ?? 0;
      expect(stickyViewportHeight).toBeGreaterThan(0);

      await act(async () => {
        scrollRef.current?.scrollTo(separatorTop);
      });
      await settleStickyScroll();

      frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("first.ts") &&
          nextFrame.includes("second.ts") &&
          nextFrame.split("\n")[2]?.trim() === "",
      );
      expect(frame).toContain("first.ts");
      expect(frame.split("\n")[2]?.trim()).toBe("");
      expect(frame).not.toContain("────");
      expect(scrollRef.current?.viewport.height ?? 0).toBe(stickyViewportHeight);

      await act(async () => {
        scrollRef.current?.scrollTo(secondHeaderTop);
      });
      await settleStickyScroll();

      frame = await waitForFrame(
        setup,
        (nextFrame) => nextFrame.includes("first.ts") && nextFrame.includes("second.ts"),
      );
      expect(frame).toContain("first.ts");
      expect(frame).toContain("second.ts");
      expect(scrollRef.current?.viewport.height ?? 0).toBe(stickyViewportHeight);

      await act(async () => {
        scrollRef.current?.scrollTo(secondHeaderTop + 1);
      });
      await settleStickyScroll();

      frame = await waitForFrame(
        setup,
        (nextFrame) => nextFrame.includes("second.ts") && !nextFrame.includes("first.ts"),
      );
      expect(frame).not.toContain("first.ts");
      expect(frame).toContain("second.ts");
      expect(frame).toContain("@@ -1,18 +1,18 @@");
      expect(scrollRef.current?.viewport.height ?? 0).toBe(stickyViewportHeight);

      await act(async () => {
        scrollRef.current?.scrollTo(secondHeaderTop + 2);
      });
      await settleStickyScroll();

      frame = await waitForFrame(
        setup,
        (nextFrame) => nextFrame.includes("second.ts") && !nextFrame.includes("@@ -1,18 +1,18 @@"),
      );
      expect(frame).toContain("second.ts");
      expect(frame).not.toContain("@@ -1,18 +1,18 @@");
      expect(scrollRef.current?.viewport.height ?? 0).toBe(stickyViewportHeight);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane advances the review stream under the always-pinned file header when the file starts mid-way", async () => {
    const theme = resolveTheme("midnight", null);
    const firstFile = createCollapsedTopDiffFile("late", "late.ts", 400, 366);
    const secondFile = createTallDiffFile("second", "second.ts", 4);
    const scrollRef = createRef<ScrollBoxRenderable>();
    const props = createDiffPaneProps([firstFile, secondFile], theme, {
      diffContentWidth: 88,
      headerLabelWidth: 48,
      headerStatsWidth: 16,
      scrollRef,
      width: 92,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 96,
      height: 7,
    });

    try {
      await settleDiffPane(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("late.ts");
      // Folds at a file's top take no rows, so the hunk header sits right under the file header.
      expect(frame.split("\n")[2]).toContain("@@ -363,7 +363,7 @@");

      await act(async () => {
        scrollRef.current?.scrollTo(1);
      });
      await settleDiffPane(setup);

      frame = await waitForFrame(setup, (nextFrame) => !nextFrame.includes("@@ -363,7 +363,7 @@"));
      expect(frame).toContain("late.ts");
      expect(frame.split("\n")[2]).toContain("export const line363 = 363;");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane returns cleanly to the first hunk after scrolling back up under the pinned file header", async () => {
    const theme = resolveTheme("midnight", null);
    const firstFile = createCollapsedTopDiffFile("late", "late.ts", 400, 366);
    const secondFile = createTallDiffFile("second", "second.ts", 4);
    const scrollRef = createRef<ScrollBoxRenderable>();
    const props = createDiffPaneProps([firstFile, secondFile], theme, {
      diffContentWidth: 88,
      headerLabelWidth: 48,
      headerStatsWidth: 16,
      scrollRef,
      width: 92,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 96,
      height: 7,
    });

    try {
      await settleDiffPane(setup);

      await act(async () => {
        scrollRef.current?.scrollTo(1);
      });
      await settleDiffPane(setup);

      let frame = await waitForFrame(
        setup,
        (nextFrame) => !nextFrame.includes("@@ -363,7 +363,7 @@"),
      );
      expect((frame.match(/late\.ts/g) ?? []).length).toBe(1);

      await act(async () => {
        scrollRef.current?.scrollTo(0);
      });
      await settleDiffPane(setup);

      frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("@@ -363,7 +363,7 @@") &&
          (nextFrame.match(/late\.ts/g) ?? []).length === 1,
      );
      expect(frame.split("\n")[2]).toContain("@@ -363,7 +363,7 @@");
      expect((frame.match(/late\.ts/g) ?? []).length).toBe(1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane keeps bottom scroll stable when offscreen agent notes are windowed out", async () => {
    const theme = resolveTheme("midnight", null);
    const firstFile = createTallDiffFile("first", "first.ts", 18);
    firstFile.annotations = [
      {
        newRange: [2, 2],
        summary: "Offscreen note should still reserve geometry at EOF.",
        rationale:
          "If measurement drops this note after first.ts leaves the viewport, max scroll shrinks.",
      },
    ];
    const files = [firstFile, createTallDiffFile("last", "last.ts", 24)];
    const scrollRef = createRef<ScrollBoxRenderable>();
    const props = createDiffPaneProps(files, theme, {
      diffContentWidth: 88,
      headerLabelWidth: 48,
      headerStatsWidth: 16,
      scrollRef,
      selectedFileId: undefined,
      width: 92,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 96,
      height: 10,
    });

    try {
      await settleDiffPane(setup);

      let bottomScrollTop = 0;
      await act(async () => {
        scrollRef.current?.scrollTo(1_000_000);
        bottomScrollTop = scrollRef.current?.scrollTop ?? 0;
      });
      expect(bottomScrollTop).toBeGreaterThan(0);

      await settleDiffPane(setup);
      expect(scrollRef.current?.scrollTop ?? 0).toBe(bottomScrollTop);

      await act(async () => {
        scrollRef.current?.scrollTo(bottomScrollTop + 1);
      });
      await settleDiffPane(setup);

      expect(scrollRef.current?.scrollTop ?? 0).toBe(bottomScrollTop);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane lets manual scrolling move away from a bottom-clamped file-top alignment", async () => {
    const theme = resolveTheme("midnight", null);
    const files = [
      createTallDiffFile("first", "first.ts", 30),
      createTestDiffFile(
        "second",
        "second.ts",
        lines(
          "export const shortLine1 = 1;",
          "export const shortLine2 = 2;",
          "export const shortLine3 = 3;",
        ),
        lines(
          "export const shortLine1 = 10;",
          "export const shortLine2 = 20;",
          "export const shortLine3 = 30;",
        ),
      ),
    ];
    const scrollRef = createRef<ScrollBoxRenderable>();

    function BottomAlignedFileHarness() {
      const [selectedFileTopAlignRequestId, setSelectedFileTopAlignRequestId] = useState(0);

      useEffect(() => {
        setSelectedFileTopAlignRequestId(1);
      }, []);

      return (
        <DiffPane
          {...createDiffPaneProps(files, theme, {
            diffContentWidth: 88,
            headerLabelWidth: 48,
            headerStatsWidth: 16,
            scrollRef,
            selectedFileId: "second",
            selectedHunkIndex: 0,
            selectedFileTopAlignRequestId,
            width: 92,
          })}
        />
      );
    }

    const setup = await testRender(<BottomAlignedFileHarness />, {
      width: 96,
      height: 10,
    });

    try {
      await settleDiffPane(setup);

      const bottomScrollTop = scrollRef.current?.scrollTop ?? 0;
      expect(bottomScrollTop).toBeGreaterThan(0);

      await act(async () => {
        scrollRef.current?.scrollTo(bottomScrollTop - 1);
      });
      await settleDiffPane(setup);

      expect(scrollRef.current?.scrollTop ?? 0).toBe(bottomScrollTop - 1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane keeps a viewport-sized selected hunk fully visible when it fits", async () => {
    const theme = resolveTheme("midnight", null);
    const props = createDiffPaneProps(
      [createViewportSizedBottomHunkDiffFile("target", "target.ts")],
      theme,
      {
        diffContentWidth: 96,
        headerLabelWidth: 48,
        selectedFileId: "target",
        selectedHunkIndex: 1,
        showHunkHeaders: false,
        width: 100,
      },
    );
    const setup = await testRender(<DiffPane {...props} />, {
      width: 104,
      height: 12,
    });

    try {
      await settleDiffPane(setup);
      const frame = await waitForFrame(
        setup,
        (text) =>
          text.includes("16   export const line16 = 16;") &&
          !text.includes("2   export const line2 = 2;"),
      );

      expect(frame).toContain("export const line11 = 11;");
      expect(frame).toContain("14   export const line14 = 14;");
      expect(frame).toContain("14   export const line14 = 1400;");
      expect(frame).toContain("16   export const line16 = 16;");
      expect(frame).toContain("16   export const line16 = 1600;");
      expect(frame).not.toContain("2   export const line2 = 2;");
      expect(frame).not.toContain("2   export const line2 = 200;");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane keeps a selected wrapped hunk fully visible when it fits", async () => {
    const theme = resolveTheme("midnight", null);
    const props = createDiffPaneProps(
      [createWrappedViewportSizedBottomHunkDiffFile("target", "target.ts")],
      theme,
      {
        diffContentWidth: 76,
        headerLabelWidth: 40,
        selectedFileId: "target",
        selectedHunkIndex: 1,
        showHunkHeaders: false,
        width: 80,
        wrapLines: true,
      },
    );
    const setup = await testRender(<DiffPane {...props} />, {
      width: 84,
      height: 17,
    });

    try {
      await settleDiffPane(setup);
      const frame = await waitForFrame(
        setup,
        (text) =>
          text.includes("18   export const line18 = 18;") &&
          !text.includes("2   export const line2 = 2;"),
      );

      expect(frame).toContain("11   export const line11 = 11;");
      expect(frame).toContain("14   export const line14 = 'this is");
      expect(frame).toContain("15   export const line15 = 'this is");
      expect(frame).toContain("18   export const line18 = 18;");
      expect(frame).not.toContain("2   export const line2 = 2;");
      expect(frame).not.toContain("2   export const line2 = 200;");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane keeps a distant selected hunk visible when row windowing narrows one file body", async () => {
    const theme = resolveTheme("midnight", null);
    const props = createDiffPaneProps([createWideTwoHunkDiffFile("target", "target.ts")], theme, {
      diffContentWidth: 96,
      headerLabelWidth: 48,
      selectedFileId: "target",
      selectedHunkIndex: 1,
      width: 100,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 104,
      height: 12,
    });

    try {
      await settleDiffPane(setup);
      const frame = await waitForFrame(setup, (nextFrame) => nextFrame.includes("line60 = 5901"));

      expect(frame).toContain("line60 = 5901");
      expect(frame).not.toContain("line1 = 1001");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane keeps a selected hunk with inline notes fully visible when it fits", async () => {
    const theme = resolveTheme("midnight", null);
    const file = createViewportSizedBottomHunkDiffFile("target", "target.ts");
    file.annotations = [
      {
        newRange: [14, 16],
        summary: "Keep the selected hunk visible with its note.",
      },
    ];
    const props = createDiffPaneProps([file], theme, {
      diffContentWidth: 96,
      headerLabelWidth: 48,
      selectedFileId: "target",
      selectedHunkIndex: 1,
      showHunkHeaders: false,
      width: 100,
    });
    const setup = await testRender(<DiffPane {...props} />, {
      width: 104,
      height: 20,
    });

    try {
      await settleDiffPane(setup);
      const frame = await waitForFrame(setup, (text) =>
        text.includes("Keep the selected hunk visible with its note."),
      );

      // The minimal note card (left accent + title + body, no box border) keeps
      // the selected hunk and its inline comment visible together.
      expect(frame).toContain("Keep the selected hunk visible with its note.");
      expect(frame).toContain("11   export const line11 = 11;");
      expect(frame).toContain("16   export const line16 = 1600;");
      expect(frame).toContain("export const line19 = 19;");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("DiffPane scrollToNote positions the inline note near the viewport top instead of the hunk top", async () => {
    const theme = resolveTheme("midnight", null);

    // Build a file with two distant hunks so the second hunk is far below the first when scrolled
    // to the hunk top. The annotation anchors on the second hunk.
    const beforeLines = Array.from(
      { length: 80 },
      (_, index) => `export const line${index + 1} = ${index + 1};`,
    );
    const afterLines = [...beforeLines];
    // flow 0: change at line 1
    afterLines[0] = "export const line1 = 100;";
    // flow 1: changes at lines 60-65 to make a multi-line hunk
    afterLines[59] = "export const line60 = 6000;";
    afterLines[60] = "export const line61 = 6100;";
    afterLines[61] = "export const line62 = 6200;";
    afterLines[62] = "export const line63 = 6300;";
    afterLines[63] = "export const line64 = 6400;";
    afterLines[64] = "export const line65 = 6500;";

    const file = createTestDiffFile(
      "deep-note",
      "deep-note.ts",
      lines(...beforeLines),
      lines(...afterLines),
    );
    file.annotations = [
      {
        newRange: [63, 63],
        summary: "Note anchored on second hunk.",
      },
    ];

    // Without scrollToNote: hunk top (context before line 60) is near viewport top,
    // but the note card (anchored at line 63) may be below the visible area.
    const propsWithoutFlag = createDiffPaneProps([file], theme, {
      diffContentWidth: 96,
      headerLabelWidth: 48,
      selectedFileId: "deep-note",
      selectedHunkIndex: 1,
      showHunkHeaders: true,
      width: 100,
    });
    const setupWithout = await testRender(<DiffPane {...propsWithoutFlag} />, {
      width: 104,
      height: 12,
    });

    try {
      await settleDiffPane(setupWithout);
      const frameWithout = await waitForFrame(setupWithout, (text) => text.includes("line57"));

      // flow context (lines near 57-59) should be visible at the top.
      expect(frameWithout).toContain("line57");
      // Note card should NOT be visible — it's below the 12-row viewport.
      expect(frameWithout).not.toContain("Note anchored on second hunk.");
    } finally {
      await act(async () => {
        setupWithout.renderer.destroy();
      });
    }

    // With scrollToNote: note card should be near the viewport top.
    const propsWithFlag = createDiffPaneProps([file], theme, {
      diffContentWidth: 96,
      headerLabelWidth: 48,
      selectedFileId: "deep-note",
      selectedHunkIndex: 1,
      scrollToNote: true,
      showHunkHeaders: true,
      width: 100,
    });
    const setupWith = await testRender(<DiffPane {...propsWithFlag} />, {
      width: 104,
      height: 12,
    });

    try {
      await settleDiffPane(setupWith);
      const frameWith = await waitForFrame(setupWith, (text) =>
        text.includes("Note anchored on second hunk."),
      );

      // Note should be visible.
      expect(frameWith).toContain("Note anchored on second hunk.");
    } finally {
      await act(async () => {
        setupWith.renderer.destroy();
      });
    }
  });

  test("CommentCard shows agent replies under the comment and counts them in its height", async () => {
    const theme = resolveTheme("midnight", null);
    const { measureCommentCardHeight } = await import("./panes/CommentCard");
    const annotation = {
      id: "flow-comment:4",
      summary: "rename this helper",
      replies: ["done, it is now formatGutterText"],
    };
    const frame = await captureFrame(
      <CommentCard annotation={annotation} theme={theme} width={60} />,
      64,
      8,
    );

    // Chat style: the user's comment, then the agent's reply, each under its speaker label.
    expect(frame).toContain("Yo: rename this helper");
    expect(frame).toContain("Agente: done, it is now formatGutterText");
    // Title + summary + reply + spacer.
    expect(measureCommentCardHeight({ annotation, width: 60 })).toBe(4);

    // A comment the agent wrote itself opens with its own label.
    const agentFrame = await captureFrame(
      <CommentCard
        annotation={{ id: "flow-comment:5", summary: "mira este bucle", author: "agent" }}
        theme={theme}
        width={60}
      />,
      64,
      6,
    );
    expect(agentFrame).toContain("Agente: mira este bucle");
    expect(agentFrame).not.toContain("Yo:");
  });

  test("CommentCard renders #id metadata, a Yo: body, and the close affordance", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <CommentCard
        annotation={{
          id: "flow-comment:42",
          summary: "Summary line",
          rationale: "Rationale line.",
        }}
        theme={theme}
        width={96}
        onClose={() => {}}
      />,
      100,
      5,
    );

    const lines = frame.split("\n");
    // First three rows: muted `#42` metadata with the close affordance, then body lines. Cards
    // carry no accent bar.
    expect(frame).not.toContain("▎");
    expect(lines[0]).toContain("#42");
    expect(lines[0]).toContain("[x]");
    expect(lines[1]).toContain("Yo: Summary line");
    expect(lines[2]).toContain("Rationale line.");
  });

  test("DiffPane renders all visible hunk notes across the review stream", async () => {
    const bootstrap = createBootstrap();
    bootstrap.changeset.files[1]!.annotations = [
      {
        newRange: [1, 1],
        summary: "Annotation for beta.ts",
        rationale: "Why beta.ts changed",
      },
    ];

    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={88}
        files={bootstrap.changeset.files}
        headerLabelWidth={48}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="alpha"
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={true}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={92}
        onSelectFile={() => {}}
      />,
      96,
      28,
    );

    expect(frame).toContain("Annotation for alpha.ts");
    expect(frame).toContain("Why alpha.ts changed");
    expect(frame).toContain("Annotation for beta.ts");
    expect(frame).toContain("Why beta.ts changed");
    // Inline cards render *below* their hunk, so the comment body should
    // appear after the last hunk line in the frame string.
    expect(frame.indexOf("Annotation for alpha.ts")).toBeGreaterThan(
      frame.indexOf("2   export const add = true;"),
    );
    expect(frame).not.toContain("alpha.ts note");
    expect(frame).not.toContain("review");
    expect(frame).not.toContain("confidence");
  });

  test("DiffPane split inline notes hand off directly to the anchored row without shifting it", async () => {
    const bootstrap = createBootstrap();
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={88}
        files={bootstrap.changeset.files}
        headerLabelWidth={48}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="alpha"
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={true}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={92}
        onSelectFile={() => {}}
      />,
      96,
      16,
    );

    const lines = frame.split("\n");
    // The card sits at the hunk bottom: its `Yo:` comment row comes after the last hunk row.
    const lastHunkRowIndex = lines.findIndex((line) => line.includes("export const add = true;"));
    const cardRowIndex = lines.findIndex(
      (line, idx) => idx > lastHunkRowIndex && line.includes("Yo: "),
    );
    expect(lastHunkRowIndex).toBeGreaterThanOrEqual(0);
    expect(cardRowIndex).toBeGreaterThan(lastHunkRowIndex);
    expect(frame).toContain("Annotation for alpha.ts");

    // The hunk's two changed rows still render at the same column.
    const changedLine = lines.find((line) => line.includes("export const alpha = 2;"));
    const annotatedLine = lines.find((line) => line.includes("export const add = true;"));
    expect(changedLine).toBeDefined();
    expect(annotatedLine).toBeDefined();
    expect(changedLine?.indexOf("+ export const")).toBe(annotatedLine?.indexOf("+ export const"));
  });

  test("DiffPane shows all inline notes when a hunk has multiple notes", async () => {
    const bootstrap = createBootstrap();
    const theme = resolveTheme("midnight", null);
    const file = bootstrap.changeset.files[0]!;
    file.annotations = [
      {
        newRange: [2, 2],
        rationale: "First rationale.",
      },
      {
        newRange: [2, 2],
        rationale: "Second rationale.",
      },
    ];

    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={88}
        files={bootstrap.changeset.files}
        headerLabelWidth={48}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="alpha"
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={true}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={92}
        onSelectFile={() => {}}
      />,
      96,
      24,
    );

    expect(frame).toContain("First rationale.");
    expect(frame).toContain("Second rationale.");
    // Two distinct cards mean two `Yo:` comment rows below the hunk.
    const lines = frame.split("\n");
    const lastHunkRowIndex = lines.findIndex((line) => line.includes("export const alpha = 2;"));
    const cardRowsBelowHunk = lines
      .slice(lastHunkRowIndex + 1)
      .filter((line) => line.includes("Yo: ")).length;
    expect(cardRowsBelowHunk).toBeGreaterThanOrEqual(2);
  });

  test("StatusBar renders filter mode affordance", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <StatusBar
        filter="beta"
        filterFocused={true}
        terminalWidth={60}
        theme={theme}
        onFilterInput={() => {}}
        onFilterSubmit={() => {}}
      />,
      60,
      3,
    );

    expect(frame).toContain("filter:");
    expect(frame).toContain("beta");
  });

  test("StatusBar renders a notice when no filter is active", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <StatusBar
        filter=""
        filterFocused={false}
        noticeText="branch base: origin/main"
        terminalWidth={60}
        theme={theme}
        onFilterInput={() => {}}
        onFilterSubmit={() => {}}
      />,
      60,
      3,
    );

    expect(frame).toContain("branch base: origin/main");
  });

  test("StatusBar names the theme in use next to the notice", async () => {
    const theme = resolveTheme("claude", "dark");
    const frame = await captureFrame(
      <StatusBar
        filter=""
        filterFocused={false}
        noticeText="Press ? for help"
        reviewMode="Branch vs origin/main"
        terminalWidth={80}
        theme={theme}
        onFilterInput={() => {}}
        onFilterSubmit={() => {}}
      />,
      80,
      3,
    );

    const statusLine = frame.split("\n").find((line) => line.includes("Press ? for help")) ?? "";
    expect(statusLine).toContain("Press ? for help");
    expect(statusLine.trimEnd()).toEndWith("Diff mode: Branch vs origin/main · theme: Claude Dark");
  });

  test("StatusBar keeps filter input precedence over a notice", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <StatusBar
        filter="beta"
        filterFocused={true}
        noticeText="branch base: origin/main"
        terminalWidth={60}
        theme={theme}
        onFilterInput={() => {}}
        onFilterSubmit={() => {}}
      />,
      60,
      3,
    );

    expect(frame).toContain("filter:");
    expect(frame).toContain("beta");
    expect(frame).not.toContain("branch base:");
  });

  test("StatusBar keeps filter summary precedence over a notice", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <StatusBar
        filter="beta"
        filterFocused={false}
        noticeText="branch base: origin/main"
        terminalWidth={60}
        theme={theme}
        onFilterInput={() => {}}
        onFilterSubmit={() => {}}
      />,
      60,
      3,
    );

    expect(frame).toContain("filter=beta");
    expect(frame).not.toContain("branch base:");
  });

  test("HelpDialog renders every documented control row without overlap", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <HelpDialog terminalHeight={60} terminalWidth={76} theme={theme} onClose={() => {}} />,
      76,
      60,
    );

    const expectedRows = [
      "Controls help",
      "[Esc]",
      "Navigation",
      "↑ / ↓           move line-by-line",
      "Space / b       page down / up",
      "Ctrl+D / Ctrl+U half page down / up",
      "K / J           previous / next hunk",
      "← / →           scroll code left / right (Shift = faster)",
      "gg / G          jump to first / last hunk",
      "Home / End      jump to top / bottom",
      "Comments",
      "a               add comment on this hunk",
      "{ / }           previous / next comment",
      "d               delete one comment on this hunk",
      "D               clear all drifted comments (confirm)",
      "e               open this file in $EDITOR at the hunk",
      "Review",
      "/               focus file filter",
      "Tab             toggle files/filter focus",
      "r / q           reload / quit",
      "View",
      "1 / 2 / 0       split / stack / auto",
      "s / t           sidebar / theme",
      "l / w / m       lines / wrap / metadata",
      "Workspace",
      "Enter           switch to the ticket's branch (stashes changes)",
      "Browser",
      "h               open the ticket in YouTrack",
      "g               open its merge request in GitLab",
      "Agent actions",
      "X               write or refresh the ticket overview",
      "R               review the code against the ticket",
      "C               propose commits, then make them",
      "P               open the merge request",
      "Mouse",
      "Wheel           scroll vertically",
      "Shift+Wheel     scroll code horizontally",
    ] as const;

    for (const expectedRow of expectedRows) {
      expect(frame).toContain(expectedRow);
    }

    const lines = frame.split("\n");
    const blankModalRow = /│\s+│/;
    const commentsHeaderIndex = lines.findIndex((line) => line.includes("│ Comments"));
    const reviewHeaderIndex = lines.findIndex((line) => line.includes("│ Review"));
    const viewHeaderIndex = lines.findIndex((line) => line.includes("│ View"));
    const mouseHeaderIndex = lines.findIndex((line) => line.includes("│ Mouse"));

    expect(lines[commentsHeaderIndex - 1]).toMatch(blankModalRow);
    expect(lines[reviewHeaderIndex - 1]).toMatch(blankModalRow);
    expect(lines[viewHeaderIndex - 1]).toMatch(blankModalRow);
    expect(lines[mouseHeaderIndex - 1]).toMatch(blankModalRow);
    expect(frame).not.toContain("linese/Awrapt/smetadata");
    expect(frame).not.toContain("reloade/uquit");
  });

  test("DiffSectionPlaceholder preserves offscreen section chrome without mounting rows", async () => {
    const bootstrap = createBootstrap();
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffSectionPlaceholder
        bodyHeight={6}
        file={bootstrap.changeset.files[0]!}
        headerLabelWidth={40}
        headerStatsWidth={16}
        showHeader={true}
        showSeparator={true}
        theme={theme}
        onSelect={() => {}}
      />,
      80,
      10,
    );

    expect(frame).toContain("alpha.ts");
    expect(frame).toContain("+2");
    expect(frame).toContain("-1");
    expect(frame).not.toContain("export const alpha = 2;");
  });

  test("DiffPane renders an empty-state message when no files are visible", async () => {
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={72}
        files={[]}
        headerLabelWidth={40}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId={undefined}
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={true}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={76}
        onSelectFile={() => {}}
      />,
      80,
      10,
    );

    expect(frame).toContain("No files match the current filter.");
  });

  test("DiffPane can hide line numbers while keeping the code column", async () => {
    const bootstrap = createBootstrap();
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={72}
        files={bootstrap.changeset.files}
        headerLabelWidth={40}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="alpha"
        selectedHunkIndex={0}
        showLineNumbers={false}
        showHunkHeaders={true}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={76}
        onSelectFile={() => {}}
      />,
      80,
      18,
    );

    expect(frame).not.toContain("1   export const alpha = 1;");
    expect(frame).not.toContain("1   export const alpha = 2;");
    // The number margin stays reserved, so code keeps its column with numbers hidden.
    expect(frame).toContain("        export const alpha = 1;");
    expect(frame).toContain("        export const alpha = 2;");
  });

  test("DiffPane can wrap long diff lines onto continuation rows", async () => {
    const bootstrap = createWrapBootstrap();
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={48}
        files={bootstrap.changeset.files}
        headerLabelWidth={24}
        headerStatsWidth={12}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="wrap"
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={true}
        wrapLines={true}
        wrapToggleScrollTop={null}
        theme={theme}
        width={52}
        onSelectFile={() => {}}
      />,
      56,
      20,
    );

    // At this width the long line wraps across several continuation rows under a blank gutter.
    expect(frame).toContain("1   export const mes");
    expect(frame).toContain("a very long wrap");
    expect(frame).toContain("ped line for dif");
    expect(frame).toContain("rage';");
  });

  test("DiffPane can hide hunk metadata rows without hiding code lines", async () => {
    const bootstrap = createBootstrap();
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <DiffPane
        diffContentWidth={72}
        files={bootstrap.changeset.files}
        headerLabelWidth={40}
        headerStatsWidth={16}
        layout="split"
        scrollRef={createRef()}
        selectedFileId="alpha"
        selectedHunkIndex={0}
        showLineNumbers={true}
        showHunkHeaders={false}
        wrapLines={false}
        wrapToggleScrollTop={null}
        theme={theme}
        width={76}
        onSelectFile={() => {}}
      />,
      80,
      18,
    );

    expect(frame).not.toContain("@@ -1,1 +1,2 @@");
    expect(frame).not.toContain("@@ -1,1 +1,1 @@");
    expect(frame).toContain("1   export const alpha = 1;");
    expect(frame).toContain("1   export const alpha = 2;");
  });

  test("PierreDiffView renders stack-mode wrapped continuation rows", async () => {
    const file = createWrapBootstrap().changeset.files[0]!;
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <PierreDiffView
        file={file}
        layout="stack"
        theme={theme}
        width={48}
        selectedHunkIndex={0}
        wrapLines={true}
        scrollable={false}
      />,
      52,
      18,
    );

    const addedLines = frame
      .split("\n")
      .filter(
        (line) =>
          !line.includes("@@") &&
          (line.includes("export const message = 'this is") || /^\s{5,}\S/.test(line)),
      );

    expect(frame).toContain("1   export const message = 'short';");
    expect(addedLines[0]).toContain("1   export const message = 'this is");
    expect(addedLines.length).toBeGreaterThanOrEqual(2);
    // Continuation rows carry the rest of the line under a blank gutter.
    const continuation = addedLines.slice(1).join(" ");
    expect(continuation).toContain("wrapped line");
    expect(continuation).toContain("rage';");
  });

  test("PierreDiffView can reveal offscreen code columns in nowrap mode", async () => {
    const file = createWrapBootstrap().changeset.files[0]!;
    const theme = resolveTheme("midnight", null);

    const baseFrame = await captureFrame(
      <PierreDiffView
        file={file}
        layout="stack"
        theme={theme}
        width={48}
        selectedHunkIndex={0}
        wrapLines={false}
        scrollable={false}
      />,
      52,
      12,
    );
    const shiftedFrame = await captureFrame(
      <PierreDiffView
        file={file}
        layout="stack"
        theme={theme}
        width={48}
        selectedHunkIndex={0}
        wrapLines={false}
        codeHorizontalOffset={48}
        scrollable={false}
      />,
      52,
      12,
    );

    expect(baseFrame).toContain("this is a very");
    expect(baseFrame).not.toContain("diff rendering coverage';");
    expect(shiftedFrame).toContain("coverage';");
    expect(shiftedFrame).not.toContain("this is a very");
  });

  test("split view wraps the same long diff line across more rows than stack view at the same width", async () => {
    const file = createWrapBootstrap().changeset.files[0]!;
    const theme = resolveTheme("midnight", null);
    const width = 64;

    const splitFrame = await captureFrame(
      <PierreDiffView
        file={file}
        layout="split"
        theme={theme}
        width={width}
        selectedHunkIndex={0}
        wrapLines={true}
        scrollable={false}
      />,
      width + 4,
      18,
    );
    const stackFrame = await captureFrame(
      <PierreDiffView
        file={file}
        layout="stack"
        theme={theme}
        width={width}
        selectedHunkIndex={0}
        wrapLines={true}
        scrollable={false}
      />,
      width + 4,
      18,
    );

    const splitContinuationRows = splitFrame.split("\n").filter((line) => /^\s{20,}\S/.test(line));
    const stackContinuationRows = stackFrame
      .split("\n")
      .filter((line) => !line.includes("@@") && /^\s{5,}\S/.test(line));

    expect(splitFrame).toContain("1   export const message = '");
    expect(stackFrame).toContain("1   export const message = 'this is a very long wrapped line");
    expect(splitContinuationRows.length).toBeGreaterThan(stackContinuationRows.length);
  });

  test("PierreDiffView anchors range-less notes to the first visible row when hunk headers are hidden", async () => {
    const file = createTestDiffFile(
      "note-fallback",
      "note-fallback.ts",
      "export const value = 1;\n",
      "export const value = 2;\nexport const added = true;\n",
    );
    const theme = resolveTheme("midnight", null);
    const frame = await captureFrame(
      <PierreDiffView
        file={file}
        layout="split"
        theme={theme}
        width={88}
        selectedHunkIndex={0}
        visibleAgentNotes={[
          {
            id: "note:ungrounded",
            annotation: {
              rationale: "Falls back to the first visible row.",
            },
          },
        ]}
        showHunkHeaders={false}
        scrollable={false}
      />,
      92,
      18,
    );

    expect(frame).not.toContain("@@ -1,1 +1,2 @@");
    expect(frame).toContain("Falls back to the first visible");
    expect(frame).toContain("row.");
    // Range-less notes now anchor at the hunk bottom too, so the card sits
    // after the last hunk row rather than above the first one.
    expect(frame.indexOf("Falls back")).toBeGreaterThan(
      frame.indexOf("1   export const value = 1;"),
    );
  });

  test("PierreDiffView shows contextual messages when there is no selected file or no textual hunks", async () => {
    const theme = resolveTheme("midnight", null);

    const noFileFrame = await captureFrame(
      <PierreDiffView
        file={undefined}
        layout="split"
        theme={theme}
        width={72}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      76,
      6,
    );
    expect(noFileFrame).toContain("No file selected.");

    const renameOnlyFrame = await captureFrame(
      <PierreDiffView
        file={createEmptyDiffFile("rename-pure")}
        layout="split"
        theme={theme}
        width={72}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      76,
      6,
    );
    expect(renameOnlyFrame).toContain("This change only renames the file.");

    const newFileFrame = await captureFrame(
      <PierreDiffView
        file={createEmptyDiffFile("new")}
        layout="split"
        theme={theme}
        width={72}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      76,
      6,
    );
    expect(newFileFrame).toContain("The file is marked as new.");

    const deletedFileFrame = await captureFrame(
      <PierreDiffView
        file={createEmptyDiffFile("deleted")}
        layout="split"
        theme={theme}
        width={72}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      76,
      6,
    );
    expect(deletedFileFrame).toContain("The file is marked as deleted.");

    const binaryFileFrame = await captureFrame(
      <PierreDiffView
        file={{
          ...createEmptyDiffFile("change"),
          id: "empty:binary",
          isBinary: true,
          path: "image.png",
        }}
        layout="split"
        theme={theme}
        width={72}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      76,
      6,
    );
    expect(binaryFileFrame).toContain("Binary file skipped");
  });

  test("PierreDiffView renders word-diff spans with a visibly different background in split view", async () => {
    const file = createTestDiffFile(
      "word-diff",
      "word-diff.ts",
      "export const answer = 41;\nexport const stable = true;\n",
      "export const answer = 42;\nexport const stable = true;\n",
    );
    const theme = resolveTheme("graphite", null);
    const setup = await testRender(
      <PierreDiffView
        file={file}
        layout="split"
        theme={theme}
        width={120}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      { width: 124, height: 10 },
    );

    try {
      let removedBackgroundDistance: number | null = null;
      let addedBackgroundDistance: number | null = null;

      for (let iteration = 0; iteration < 200; iteration += 1) {
        await act(async () => {
          await setup.renderOnce();
          await Bun.sleep(0);
          await setup.renderOnce();
          await Bun.sleep(0);
        });

        const frame = setup.captureSpans();
        removedBackgroundDistance = renderedWordDiffBackgroundDistance(frame, "41");
        addedBackgroundDistance = renderedWordDiffBackgroundDistance(frame, "42");

        if (
          removedBackgroundDistance !== null &&
          addedBackgroundDistance !== null &&
          removedBackgroundDistance > 0 &&
          addedBackgroundDistance > 0
        ) {
          break;
        }
      }

      expect(removedBackgroundDistance).toBeGreaterThanOrEqual(28);
      expect(addedBackgroundDistance).toBeGreaterThanOrEqual(28);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("PierreDiffView reuses highlighted rows after unmounting and remounting a file section", async () => {
    const file = createTestDiffFile(
      "cache",
      "cache.ts",
      "export const cacheMarker = 1;\nexport function cacheKeep(value: number) { return value + 1; }\n",
      "export const cacheMarker = 2;\nexport function cacheKeep(value: number) { return value * 2; }\n",
    );
    const theme = resolveTheme("midnight", null);

    const firstSetup = await testRender(
      <PierreDiffView
        file={file}
        layout="split"
        theme={theme}
        width={180}
        selectedHunkIndex={0}
        scrollable={false}
      />,
      { width: 184, height: 10 },
    );

    try {
      let ready = false;
      for (let iteration = 0; iteration < 400; iteration += 1) {
        await act(async () => {
          await firstSetup.renderOnce();
          await Bun.sleep(0);
          await firstSetup.renderOnce();
          await Bun.sleep(0);
        });

        if (frameHasHighlightedMarker(firstSetup.captureSpans(), "cacheMarker")) {
          ready = true;
          break;
        }
      }

      expect(ready).toBe(true);
    } finally {
      await act(async () => {
        firstSetup.renderer.destroy();
      });
    }

    const secondSetup = await testRender(
      <PierreDiffView
        file={file}
        layout="split"
        theme={theme}
        width={180}
        selectedHunkIndex={0}
        shouldLoadHighlight={false}
        scrollable={false}
      />,
      { width: 184, height: 10 },
    );

    try {
      await act(async () => {
        await secondSetup.renderOnce();
      });

      expect(frameHasHighlightedMarker(secondSetup.captureSpans(), "cacheMarker")).toBe(true);
    } finally {
      await act(async () => {
        secondSetup.renderer.destroy();
      });
    }
  });

  test("DiffPane prefetches highlight data for files approaching the viewport before they mount", async () => {
    const files = createHighlightPrefetchWindowFiles();
    const theme = resolveTheme("midnight", null);
    const setup = await testRender(
      <DiffPane
        {...createDiffPaneProps(files, theme, {
          diffContentWidth: 92,
          width: 96,
        })}
      />,
      { width: 100, height: 10 },
    );
    const thirdFileCheck = await testRender(
      <PierreDiffView
        file={files[2]}
        layout="split"
        theme={theme}
        width={180}
        selectedHunkIndex={0}
        shouldLoadHighlight={false}
        scrollable={false}
      />,
      { width: 184, height: 10 },
    );

    try {
      await settleDiffPane(setup);

      const initialFrame = setup.captureCharFrame();
      expect(initialFrame).not.toContain("prefetch-3.ts");

      let prefetched = false;
      for (let iteration = 0; iteration < 400; iteration += 1) {
        await act(async () => {
          await setup.renderOnce();
          await thirdFileCheck.renderOnce();
          await Bun.sleep(0);
          await setup.renderOnce();
          await thirdFileCheck.renderOnce();
          await Bun.sleep(0);
        });

        if (frameHasHighlightedMarker(thirdFileCheck.captureSpans(), "prefetchMarker3")) {
          prefetched = true;
          break;
        }
      }

      expect(prefetched).toBe(true);
    } finally {
      await act(async () => {
        thirdFileCheck.renderer.destroy();
        setup.renderer.destroy();
      });
    }
  });

  test("App renders the multi-file stream and AI badges", async () => {
    const bootstrap = createBootstrap();
    const frame = await captureFrame(<AppHost bootstrap={bootstrap} />, 280, 24);

    expect(frame).not.toContain("File  View  Navigate  Theme  Agent  Help");
    expect(frame).toContain("alpha.ts");
    expect(frame).toContain("beta.ts");
    // Hunk ranges are metadata, hidden by default; file cards separate hunks visually.
    expect(frame).not.toContain("@@");
    // The single bootstrap annotation renders as an inline comment card with
    // its rationale visible beneath the alpha.ts hunk.
    expect(frame).toContain("Annotation for alpha.ts");
    expect(frame).not.toContain("Changeset summary");
  });
});
