import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@pierre/diffs";
import type { DiffFile } from "../../core/types";
import {
  buildSplitRows,
  buildStackRows,
  codeThemeName,
  loadHighlightedDiff,
  type DiffRow,
} from "./pierre";
import { resolveTheme } from "../themes";
import { createTestDiffFile } from "../../../test/helpers/diff-helpers";

function createDiffFile(): DiffFile {
  const metadata = parseDiffFromFile(
    {
      name: "example.ts",
      contents: "export const answer = 41;\nexport const stable = true;\n",
      cacheKey: "before",
    },
    {
      name: "example.ts",
      contents:
        "export const answer = 42;\nexport const stable = true;\nexport const added = true;\n",
      cacheKey: "after",
    },
    { context: 3 },
    true,
  );

  return {
    id: "example",
    path: "example.ts",
    patch: "",
    language: "typescript",
    stats: {
      additions: 2,
      deletions: 1,
    },
    metadata,
    annotations: [],
  };
}

function createEmptyLineDiffFile(): DiffFile {
  const metadata = parseDiffFromFile(
    {
      name: "empty.ts",
      contents: "function foo() {\n  return 1;\n}\n",
      cacheKey: "before-empty",
    },
    {
      name: "empty.ts",
      contents: "function foo() {\n\n  return 2;\n}\n",
      cacheKey: "after-empty",
    },
    { context: 3 },
    true,
  );

  return {
    id: "empty",
    path: "empty.ts",
    patch: "",
    language: "typescript",
    stats: {
      additions: 2,
      deletions: 1,
    },
    metadata,
    annotations: [],
  };
}

function createMarkdownDiffFile(): DiffFile {
  const metadata = parseDiffFromFile(
    {
      name: "notes.md",
      contents: "plain\n",
      cacheKey: "before-md",
    },
    {
      name: "notes.md",
      contents: "# Heading\n`inline code`\nplain\n",
      cacheKey: "after-md",
    },
    { context: 3 },
    true,
  );

  return {
    id: "notes-md",
    path: "notes.md",
    patch: "",
    language: "markdown",
    stats: {
      additions: 2,
      deletions: 0,
    },
    metadata,
    annotations: [],
  };
}

describe("Pierre diff rows", () => {
  test("emphasizes changed words only when part of a line changed", async () => {
    const metadata = parseDiffFromFile(
      {
        name: "words.ts",
        contents: "export const answer = 41;\nconst old = 1;\n",
        cacheKey: "words-before",
      },
      {
        name: "words.ts",
        contents: "export const answer = 42;\nreturn rewrittenEntirely(true);\n",
        cacheKey: "words-after",
      },
      { context: 3 },
      true,
    );
    const file: DiffFile = { ...createDiffFile(), id: "words", path: "words.ts", metadata };
    const theme = resolveTheme("claude-dark", null);
    const highlighted = await loadHighlightedDiff(file, codeThemeName(theme));
    const additions = buildStackRows(file, highlighted, theme).flatMap((row) =>
      row.type === "stack-line" && row.cell.kind === "addition" ? [row.cell.spans] : [],
    );
    const emphasized = (spans: { text: string; bg?: string }[]) =>
      spans.filter((span) => span.bg === theme.addedContentBg).map((span) => span.text.trim());

    // One changed number keeps its word emphasis; a rewritten line keeps the plain row tint.
    expect(emphasized(additions[0] ?? [])).toEqual(["42"]);
    expect(emphasized(additions[1] ?? [])).toEqual([]);
  });

  test("highlights code with a theme's own code theme, such as Claude Code's for claude-dark", async () => {
    const file = createDiffFile();
    const claude = resolveTheme("claude-dark", null);
    expect(codeThemeName(claude)).toBe("claude-code-monokai-extended");
    expect(codeThemeName(resolveTheme("midnight", null))).toBe("pierre-dark");

    const tokenColors = (codeTheme: string) =>
      loadHighlightedDiff(file, codeTheme).then((highlighted) =>
        buildStackRows(file, highlighted, claude).flatMap((row) =>
          row.type === "stack-line" ? row.cell.spans.map((span) => span.fg) : [],
        ),
      );
    const claudeColors = new Set(
      (await tokenColors(codeThemeName(claude))).map((color) => color?.toLowerCase()),
    );
    // Claude Code's keyword pink and its cyan for declarations, which Pierre's palette never uses.
    expect(claudeColors.has("#f92672")).toBe(true);
    expect(claudeColors.has("#66d9ef")).toBe(true);
    expect(new Set(await tokenColors("pierre-dark"))).not.toEqual(claudeColors);
  });

  test("builds split rows with Pierre-highlighted emphasis spans", async () => {
    const file = createDiffFile();
    const theme = resolveTheme("midnight", null);
    const highlighted = await loadHighlightedDiff(file);
    const rows = buildSplitRows(file, highlighted, theme);

    expect(rows.some((row) => row.type === "hunk-header")).toBe(true);

    const changedRow = rows.find(
      (row) =>
        row.type === "split-line" && row.left.kind === "deletion" && row.right.kind === "addition",
    );

    expect(changedRow).toBeDefined();

    if (!changedRow || changedRow.type !== "split-line") {
      throw new Error("Expected a split-line change row");
    }

    const removedWordSpan = changedRow.left.spans.find((span) => span.text.includes("41"));
    const addedWordSpan = changedRow.right.spans.find((span) => span.text.includes("42"));

    expect(removedWordSpan).toBeDefined();
    expect(addedWordSpan).toBeDefined();
    expect(removedWordSpan?.bg).toBeDefined();
    expect(addedWordSpan?.bg).toBeDefined();
    expect(changedRow.left.spans.some((span) => span.text.includes("export") && span.bg)).toBe(
      false,
    );
    expect(changedRow.right.spans.some((span) => span.text.includes("export") && span.bg)).toBe(
      false,
    );
    expect(
      changedRow.right.spans.some(
        (span) => span.text.includes("export") && typeof span.fg === "string",
      ),
    ).toBe(true);
  });

  test("builds stacked rows with separate deletion and addition lines", () => {
    const file = createDiffFile();
    const theme = resolveTheme("paper", null);
    const rows = buildStackRows(file, null, theme);

    const deletionRow = rows.find(
      (row) => row.type === "stack-line" && row.cell.kind === "deletion",
    );
    const additionRow = rows.find(
      (row) => row.type === "stack-line" && row.cell.kind === "addition",
    );

    expect(deletionRow).toBeDefined();
    expect(additionRow).toBeDefined();

    if (!deletionRow || deletionRow.type !== "stack-line") {
      throw new Error("Expected a stacked deletion row");
    }

    if (!additionRow || additionRow.type !== "stack-line") {
      throw new Error("Expected a stacked addition row");
    }

    expect(deletionRow.cell.oldLineNumber).toBe(1);
    expect(deletionRow.cell.newLineNumber).toBeUndefined();
    expect(additionRow.cell.oldLineNumber).toBeUndefined();
    expect(additionRow.cell.newLineNumber).toBe(1);
  });

  test("does not produce newline characters in spans for highlighted empty lines", async () => {
    const file = createEmptyLineDiffFile();
    const theme = resolveTheme("midnight", null);
    const highlighted = await loadHighlightedDiff(file);

    for (const buildRows of [buildSplitRows, buildStackRows]) {
      const rows = buildRows(file, highlighted, theme);
      const allSpans = rows.flatMap((row) => {
        if (row.type === "split-line") return [...row.left.spans, ...row.right.spans];
        if (row.type === "stack-line") return row.cell.spans;
        return [];
      });

      expect(allSpans.every((span) => !span.text.includes("\n"))).toBe(true);
    }
  });

  test("remaps Pierre markdown reds and greens away from diff-semantic hues", async () => {
    const file = createMarkdownDiffFile();

    for (const themeId of ["midnight", "paper"] as const) {
      const theme = resolveTheme(themeId, null);
      const highlighted = await loadHighlightedDiff(file, codeThemeName(theme));
      const rows = buildStackRows(file, highlighted, theme).filter(
        (row): row is Extract<DiffRow, { type: "stack-line" }> =>
          row.type === "stack-line" && row.cell.kind === "addition",
      );

      const headingRow = rows.find((row) =>
        row.cell.spans.some((span) => span.text.includes("Heading")),
      );
      const inlineCodeRow = rows.find((row) =>
        row.cell.spans.some((span) => span.text.includes("inline code")),
      );

      expect(headingRow).toBeDefined();
      expect(inlineCodeRow).toBeDefined();

      if (!headingRow || !inlineCodeRow) {
        throw new Error("Expected highlighted markdown rows");
      }

      expect(
        headingRow.cell.spans.some(
          (span) => span.text.includes("Heading") && span.fg === theme.syntaxColors.keyword,
        ),
      ).toBe(true);
      expect(
        inlineCodeRow.cell.spans.some(
          (span) => span.text.includes("inline code") && span.fg === theme.syntaxColors.string,
        ),
      ).toBe(true);
      expect(
        headingRow.cell.spans.some((span) => span.fg === "#ff6762" || span.fg === "#d52c36"),
      ).toBe(false);
      expect(
        inlineCodeRow.cell.spans.some((span) => span.fg === "#5ecc71" || span.fg === "#199f43"),
      ).toBe(false);
    }
  });

  test("keeps reserved-color remaps isolated across dark themes", async () => {
    const file = createMarkdownDiffFile();
    const highlighted = await loadHighlightedDiff(file, "pierre-dark");

    for (const themeId of ["graphite", "midnight", "ember"] as const) {
      const theme = resolveTheme(themeId, null);
      const rows = buildStackRows(file, highlighted, theme).filter(
        (row): row is Extract<DiffRow, { type: "stack-line" }> =>
          row.type === "stack-line" && row.cell.kind === "addition",
      );

      const headingRow = rows.find((row) =>
        row.cell.spans.some((span) => span.text.includes("Heading")),
      );
      const inlineCodeRow = rows.find((row) =>
        row.cell.spans.some((span) => span.text.includes("inline code")),
      );

      expect(headingRow).toBeDefined();
      expect(inlineCodeRow).toBeDefined();

      if (!headingRow || !inlineCodeRow) {
        throw new Error("Expected highlighted markdown rows");
      }

      expect(
        headingRow.cell.spans.some(
          (span) => span.text.includes("Heading") && span.fg === theme.syntaxColors.keyword,
        ),
      ).toBe(true);
      expect(
        inlineCodeRow.cell.spans.some(
          (span) => span.text.includes("inline code") && span.fg === theme.syntaxColors.string,
        ),
      ).toBe(true);
    }
  });
});

test("split sides flow independently so a deletion leaves no gap on the right", () => {
  const file = createTestDiffFile({
    id: "compact",
    context: 3,
    path: "compact.ts",
    before: "const one = 1;\nconst two = 2;\nconst three = 3;\n",
    after: "const one = 1;\nconst three = 3;\n",
  });
  const rows = buildSplitRows(file, null, resolveTheme("midnight", null)).filter(
    (row) => row.type === "split-line",
  );

  expect(
    rows.map((row) =>
      row.type === "split-line"
        ? [row.left.lineNumber ?? null, row.left.kind, row.right.lineNumber ?? null, row.right.kind]
        : null,
    ),
  ).toEqual([
    [1, "context", 1, "context"],
    [2, "deletion", 2, "context"],
    [3, "context", null, "empty"],
  ]);
});
