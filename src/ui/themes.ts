import { RGBA, SyntaxStyle, type ThemeMode } from "@opentui/core";
import { CLAUDE_CODE_DARK_CODE_THEME, CLAUDE_CODE_LIGHT_CODE_THEME } from "./diff/claudeCodeThemes";

export interface AppTheme {
  id: string;
  label: string;
  appearance: "light" | "dark";
  /** Syntax theme Pierre highlights code with, by name; defaults to Pierre's own for the mode. */
  codeTheme?: string;
  background: string;
  panel: string;
  panelAlt: string;
  border: string;
  accent: string;
  accentMuted: string;
  text: string;
  muted: string;
  addedBg: string;
  removedBg: string;
  contextBg: string;
  addedContentBg: string;
  removedContentBg: string;
  contextContentBg: string;
  addedSignColor: string;
  removedSignColor: string;
  lineNumberBg: string;
  lineNumberFg: string;
  selectedHunk: string;
  badgeAdded: string;
  badgeRemoved: string;
  badgeNeutral: string;
  fileNew: string;
  fileDeleted: string;
  fileRenamed: string;
  fileModified: string;
  fileUntracked: string;
  noteBorder: string;
  noteBackground: string;
  noteTitleBackground: string;
  noteTitleText: string;
  syntaxColors: SyntaxColors;
  syntaxStyle: SyntaxStyle;
}

type SyntaxColors = {
  default: string;
  keyword: string;
  string: string;
  comment: string;
  number: string;
  function: string;
  property: string;
  type: string;
  punctuation: string;
};

/** Build the syntax palette OpenTUI should use for in-terminal code rendering. */
function createSyntaxStyle(colors: SyntaxColors) {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(colors.default) },
    keyword: { fg: RGBA.fromHex(colors.keyword), bold: true },
    string: { fg: RGBA.fromHex(colors.string) },
    comment: { fg: RGBA.fromHex(colors.comment), italic: true },
    number: { fg: RGBA.fromHex(colors.number) },
    function: { fg: RGBA.fromHex(colors.function) },
    method: { fg: RGBA.fromHex(colors.function) },
    property: { fg: RGBA.fromHex(colors.property) },
    variable: { fg: RGBA.fromHex(colors.default) },
    constant: { fg: RGBA.fromHex(colors.number), bold: true },
    type: { fg: RGBA.fromHex(colors.type) },
    class: { fg: RGBA.fromHex(colors.type) },
    punctuation: { fg: RGBA.fromHex(colors.punctuation) },
  });
}

/** Lazily attach syntax colors so startup only pays for the active theme's token style. */
function withLazySyntaxStyle(
  theme: Omit<AppTheme, "syntaxColors" | "syntaxStyle">,
  syntaxColors: SyntaxColors,
): AppTheme {
  let syntaxStyle: SyntaxStyle | null = null;

  return {
    ...theme,
    syntaxColors,
    get syntaxStyle() {
      syntaxStyle ??= createSyntaxStyle(syntaxColors);
      return syntaxStyle;
    },
  };
}

export const THEMES: AppTheme[] = [
  withLazySyntaxStyle(
    {
      id: "graphite",
      label: "Graphite",
      appearance: "dark",
      background: "#111315",
      panel: "#171a1d",
      panelAlt: "#1d2126",
      border: "#343c45",
      accent: "#d5e0ea",
      accentMuted: "#414a54",
      text: "#f2f4f6",
      muted: "#9aa4af",
      addedBg: "#1f3025",
      removedBg: "#372526",
      contextBg: "#181c20",
      addedContentBg: "#24362a",
      removedContentBg: "#432b2d",
      contextContentBg: "#1e2328",
      addedSignColor: "#88d39b",
      removedSignColor: "#f0a0a0",
      lineNumberBg: "#14181b",
      lineNumberFg: "#798592",
      selectedHunk: "#3b434b",
      badgeAdded: "#88d39b",
      badgeRemoved: "#f0a0a0",
      badgeNeutral: "#a9b4bf",
      fileNew: "#88d39b",
      fileDeleted: "#f0a0a0",
      fileRenamed: "#e6cf98",
      fileModified: "#c49bff",
      fileUntracked: "#7fd1ff",
      noteBorder: "#c6a0ff",
      noteBackground: "#241c31",
      noteTitleBackground: "#322446",
      noteTitleText: "#f5edff",
    },
    {
      default: "#f2f4f6",
      keyword: "#c4d0da",
      string: "#d8c6ef",
      comment: "#7f8b97",
      number: "#e6cf98",
      function: "#dfe6ed",
      property: "#bac8d4",
      type: "#d3d9e2",
      punctuation: "#7f8b97",
    },
  ),
  withLazySyntaxStyle(
    {
      id: "midnight",
      label: "Midnight",
      appearance: "dark",
      background: "#08111f",
      panel: "#0e1b2e",
      panelAlt: "#13243a",
      border: "#284264",
      accent: "#7fd1ff",
      accentMuted: "#355578",
      text: "#eef4ff",
      muted: "#8da5c7",
      addedBg: "#153526",
      removedBg: "#47262a",
      contextBg: "#0f1b2d",
      addedContentBg: "#102a1f",
      removedContentBg: "#371b1e",
      contextContentBg: "#132238",
      addedSignColor: "#69d69a",
      removedSignColor: "#ff8e8e",
      lineNumberBg: "#0b1627",
      lineNumberFg: "#56739a",
      selectedHunk: "#20466a",
      badgeAdded: "#5ad188",
      badgeRemoved: "#ff8b8b",
      badgeNeutral: "#89a5d3",
      fileNew: "#5ad188",
      fileDeleted: "#ff8b8b",
      fileRenamed: "#ffd883",
      fileModified: "#b794f6",
      fileUntracked: "#7fd1ff",
      noteBorder: "#c49bff",
      noteBackground: "#211a36",
      noteTitleBackground: "#30234f",
      noteTitleText: "#f5eeff",
    },
    {
      default: "#e8f1ff",
      keyword: "#8ed4ff",
      string: "#c7b4ff",
      comment: "#6e85a7",
      number: "#ffd883",
      function: "#b6c9ff",
      property: "#a8d6ff",
      type: "#a4b7ff",
      punctuation: "#6e85a7",
    },
  ),
  withLazySyntaxStyle(
    {
      id: "paper",
      label: "Paper",
      appearance: "light",
      background: "#f4efe6",
      panel: "#fffaf3",
      panelAlt: "#f8f1e7",
      border: "#d8c8b3",
      accent: "#77593a",
      accentMuted: "#d7ccbe",
      text: "#2f2417",
      muted: "#786753",
      addedBg: "#dff0e1",
      removedBg: "#f6ddde",
      contextBg: "#faf6ee",
      addedContentBg: "#eaf8ec",
      removedContentBg: "#fbebeb",
      contextContentBg: "#fffaf3",
      addedSignColor: "#3f8d58",
      removedSignColor: "#b4545b",
      lineNumberBg: "#f2e9dc",
      lineNumberFg: "#9b8367",
      selectedHunk: "#eadcc5",
      badgeAdded: "#3f8d58",
      badgeRemoved: "#b4545b",
      badgeNeutral: "#8e7355",
      fileNew: "#3f8d58",
      fileDeleted: "#b4545b",
      fileRenamed: "#9f6c1f",
      fileModified: "#7d5bc4",
      fileUntracked: "#4a6890",
      noteBorder: "#7d5bc4",
      noteBackground: "#efe6ff",
      noteTitleBackground: "#e3d7ff",
      noteTitleText: "#462b74",
    },
    {
      default: "#2f2417",
      keyword: "#7b5a35",
      string: "#4a6890",
      comment: "#8f7a65",
      number: "#9f6c1f",
      function: "#5a4a8e",
      property: "#356b7f",
      type: "#5f5f9a",
      punctuation: "#8f7a65",
    },
  ),
  withLazySyntaxStyle(
    {
      id: "ember",
      label: "Ember",
      appearance: "dark",
      background: "#140b08",
      panel: "#22120d",
      panelAlt: "#2c1710",
      border: "#643627",
      accent: "#ffb07a",
      accentMuted: "#5d3428",
      text: "#fff0e6",
      muted: "#c7a18d",
      addedBg: "#183424",
      removedBg: "#4a1f1f",
      contextBg: "#24140e",
      addedContentBg: "#21432c",
      removedContentBg: "#5a2727",
      contextContentBg: "#2b1711",
      addedSignColor: "#83d99d",
      removedSignColor: "#ff9d8f",
      lineNumberBg: "#1c100c",
      lineNumberFg: "#9a735f",
      selectedHunk: "#6a3829",
      badgeAdded: "#83d99d",
      badgeRemoved: "#ff9d8f",
      badgeNeutral: "#f1be9d",
      fileNew: "#83d99d",
      fileDeleted: "#ff9d8f",
      fileRenamed: "#ffd08f",
      fileModified: "#d8b4fe",
      fileUntracked: "#ffb07a",
      noteBorder: "#e1a3ff",
      noteBackground: "#311d36",
      noteTitleBackground: "#452650",
      noteTitleText: "#fff0ff",
    },
    {
      default: "#fff0e6",
      keyword: "#ffb47f",
      string: "#ffd3a8",
      comment: "#a17d69",
      number: "#ffd08f",
      function: "#ffd9b3",
      property: "#ffc89f",
      type: "#f7c5b0",
      punctuation: "#a17d69",
    },
  ),
  withLazySyntaxStyle(
    {
      id: "zed",
      label: "Zed One Dark",
      appearance: "dark",
      background: "#242835",
      panel: "#353944",
      panelAlt: "#464a52",
      border: "#53565d",
      accent: "#74ade8",
      accentMuted: "#3a4553",
      text: "#cccac2",
      muted: "#9a9a98",
      addedBg: "#39423e",
      removedBg: "#39333a",
      contextBg: "#242835",
      addedContentBg: "#404a43",
      removedContentBg: "#4a3a41",
      contextContentBg: "#242835",
      addedSignColor: "#d5fe80",
      removedSignColor: "#f18779",
      lineNumberBg: "#242835",
      lineNumberFg: "#878a98",
      selectedHunk: "#3a4553",
      badgeAdded: "#d5fe80",
      badgeRemoved: "#f18779",
      badgeNeutral: "#9a9a98",
      fileNew: "#d5fe80",
      fileDeleted: "#f18779",
      fileRenamed: "#74ade8",
      fileModified: "#c6a565",
      fileUntracked: "#d5fe80",
      noteBorder: "#b477cf",
      // Comment cards read as a chat on a purple surface in every theme.
      noteBackground: "#2d2539",
      noteTitleBackground: "#464a52",
      noteTitleText: "#cccac2",
    },
    {
      default: "#acb2be",
      keyword: "#b477cf",
      string: "#dec184",
      comment: "#878e98",
      number: "#bf956a",
      function: "#73ade9",
      property: "#74ade8",
      type: "#6eb4bf",
      punctuation: "#acb2be",
    },
  ),
  // Claude: the user's iTerm profile (its background, text, and ANSI palette) with Claude Code's
  // accents — the Claude orange, the lavender, and its diff greens and reds. Like that iTerm
  // profile it has a dark and a light variant; `claude` picks one from the terminal's mode.
  withLazySyntaxStyle(
    {
      id: "claude-dark",
      label: "Claude Dark",
      appearance: "dark",
      // Code colors are Claude Code's own "Monokai Extended" palette.
      codeTheme: CLAUDE_CODE_DARK_CODE_THEME,
      background: "#15191f",
      panel: "#1c2129",
      panelAlt: "#232933",
      border: "#343b46",
      accent: "#d77757",
      accentMuted: "#3b2c27",
      text: "#dcdcdc",
      muted: "#999999",
      // Diff rows use the palette Claude Code's diff highlighter paints edits with in dark themes:
      // near-black green and red tints that read as transparent over the background, slightly
      // stronger tints for changed words, and its decoration colors for the +/- signs. Context
      // sits on the plain background.
      addedBg: "#002800",
      removedBg: "#430000",
      contextBg: "#15191f",
      addedContentBg: "#044700",
      removedContentBg: "#5c0200",
      contextContentBg: "#15191f",
      addedSignColor: "#50c850",
      removedSignColor: "#dc5a5a",
      lineNumberBg: "#15191f",
      lineNumberFg: "#686868",
      selectedHunk: "#26324a",
      badgeAdded: "#4eba65",
      badgeRemoved: "#ff6b80",
      badgeNeutral: "#999999",
      fileNew: "#4eba65",
      fileDeleted: "#ff6b80",
      fileRenamed: "#b1b9f9",
      fileModified: "#ffc107",
      fileUntracked: "#00c5c7",
      noteBorder: "#b1b9f9",
      // Comment cards read as a chat on a purple surface in every theme.
      noteBackground: "#262540",
      noteTitleBackground: "#232933",
      noteTitleText: "#dcdcdc",
    },
    {
      default: "#dcdcdc",
      keyword: "#e17ee1",
      string: "#a7abf2",
      comment: "#686868",
      number: "#c7c400",
      function: "#00c5c7",
      property: "#c7c7c7",
      type: "#d77757",
      punctuation: "#999999",
    },
  ),
  withLazySyntaxStyle(
    {
      id: "claude-light",
      label: "Claude Light",
      appearance: "light",
      // Code colors are Claude Code's own "GitHub" palette for light themes.
      codeTheme: CLAUDE_CODE_LIGHT_CODE_THEME,
      background: "#fafafa",
      panel: "#f1f1f1",
      panelAlt: "#e8e8e8",
      border: "#d4d4d4",
      accent: "#c4633f",
      accentMuted: "#f3ddd4",
      text: "#101010",
      muted: "#6b6b6b",
      // The light counterpart of Claude Code's diff highlighter palette.
      addedBg: "#dcffdc",
      removedBg: "#ffdcdc",
      contextBg: "#fafafa",
      addedContentBg: "#b2ffb2",
      removedContentBg: "#ffc7c7",
      contextContentBg: "#fafafa",
      addedSignColor: "#248a3d",
      removedSignColor: "#cf222e",
      lineNumberBg: "#fafafa",
      lineNumberFg: "#8a8a8a",
      selectedHunk: "#d6e6fb",
      badgeAdded: "#2c7a39",
      badgeRemoved: "#ab2b3f",
      badgeNeutral: "#6b6b6b",
      fileNew: "#2c7a39",
      fileDeleted: "#ab2b3f",
      fileRenamed: "#5769f7",
      fileModified: "#966c1e",
      fileUntracked: "#0f8a8c",
      noteBorder: "#8a63d2",
      noteBackground: "#efeafb",
      noteTitleBackground: "#e8e8e8",
      noteTitleText: "#101010",
    },
    {
      default: "#101010",
      keyword: "#a626a4",
      string: "#2744c7",
      comment: "#8a8a8a",
      number: "#966c1e",
      function: "#0f6f8a",
      property: "#3a3a3a",
      type: "#c4633f",
      punctuation: "#6b6b6b",
    },
  ),
];

/** Resolve a named theme or fall back to flow's explicit built-in default. */
export function resolveTheme(requested: string | undefined, themeMode: ThemeMode | null) {
  // `claude` follows the terminal like the iTerm profile it comes from; dark when unknown.
  const id = requested === "claude" ? `claude-${themeMode ?? "dark"}` : requested;
  const exact = THEMES.find((theme) => theme.id === id);
  if (exact) {
    return exact;
  }

  return THEMES.find((theme) => theme.id === "zed") ?? THEMES[0]!;
}
