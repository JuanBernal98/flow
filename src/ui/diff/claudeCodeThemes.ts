/**
 * Syntax themes that reproduce Claude Code's code colors. Claude Code highlights with highlight.js
 * and its own palettes, "Monokai Extended" for dark themes and "GitHub" for light ones; these
 * TextMate themes map the same colors onto the scopes Pierre's highlighter emits, so code reads
 * the same in flow as in a Claude Code session.
 */
import { registerCustomTheme } from "@pierre/diffs";

export const CLAUDE_CODE_DARK_CODE_THEME = "claude-code-monokai-extended";
export const CLAUDE_CODE_LIGHT_CODE_THEME = "claude-code-github";

/** Colors per highlight.js class, as Claude Code assigns them. */
interface ClaudeCodePalette {
  foreground: string;
  background: string;
  comment: string;
  string: string;
  number: string;
  /** Plain keywords and operators: `if`, `return`, `import`, `=`. */
  keyword: string;
  /** Declaration keywords Claude Code singles out: `const`, `let`, `function`, `class`, `type`. */
  storage: string;
  function: string;
  type: string;
  builtIn: string;
  params: string;
  property: string;
  punctuation: string;
}

const MONOKAI_EXTENDED: ClaudeCodePalette = {
  foreground: "#f8f8f2",
  background: "#272822",
  comment: "#75715e",
  string: "#e6db74",
  number: "#be84ff",
  keyword: "#f92672",
  storage: "#66d9ef",
  function: "#a6e22e",
  type: "#a6e22e",
  builtIn: "#a6e22e",
  params: "#fd971f",
  property: "#ffffff",
  punctuation: "#f8f8f2",
};

const GITHUB: ClaudeCodePalette = {
  foreground: "#333333",
  background: "#ffffff",
  comment: "#969896",
  string: "#183691",
  number: "#0086b3",
  keyword: "#a71d5d",
  storage: "#a71d5d",
  function: "#795da3",
  type: "#000000",
  builtIn: "#0086b3",
  params: "#0086b3",
  property: "#0086b3",
  punctuation: "#333333",
};

/** Build a TextMate theme that colors each scope family the way Claude Code colors its class. */
function createClaudeCodeTheme(name: string, type: "dark" | "light", palette: ClaudeCodePalette) {
  const rule = (scope: string[], foreground: string) => ({ scope, settings: { foreground } });
  return {
    name,
    type,
    fg: palette.foreground,
    bg: palette.background,
    colors: {
      "editor.foreground": palette.foreground,
      "editor.background": palette.background,
    },
    tokenColors: [
      { settings: { foreground: palette.foreground, background: palette.background } },
      rule(["comment", "punctuation.definition.comment"], palette.comment),
      rule(
        ["string", "string.template", "string.regexp", "punctuation.definition.string"],
        palette.string,
      ),
      rule(["constant.numeric", "constant.language", "constant.character"], palette.number),
      rule(
        ["keyword", "keyword.control", "keyword.operator", "keyword.other", "storage.modifier"],
        palette.keyword,
      ),
      // Last match wins, so declarations override the generic keyword color above.
      rule(["storage.type", "storage.type.function", "storage.type.class"], palette.storage),
      rule(
        ["entity.name.function", "support.function", "meta.function-call entity.name.function"],
        palette.function,
      ),
      rule(
        ["entity.name.type", "entity.name.class", "entity.other.inherited-class", "support.class"],
        palette.type,
      ),
      rule(["support.type", "support.type.primitive", "support.constant"], palette.builtIn),
      rule(["variable.parameter", "meta.parameters variable"], palette.params),
      rule(
        [
          "variable.other.property",
          "variable.other.object.property",
          "support.variable.property",
          "meta.object-literal.key",
          "variable.language",
        ],
        palette.property,
      ),
      rule(["entity.other.attribute-name"], palette.function),
      rule(["punctuation", "meta.brace"], palette.punctuation),
      // highlight.js leaves symbolic operators, type-annotation colons, and arrows uncolored;
      // only word operators such as `new` and `typeof` keep the keyword color.
      rule(
        [
          "keyword.operator",
          "keyword.operator.type.annotation",
          "storage.type.function.arrow",
          "punctuation.separator",
        ],
        palette.foreground,
      ),
      rule(["keyword.operator.new", "keyword.operator.expression"], palette.keyword),
    ],
  };
}

let registered = false;

/** Make both themes resolvable by name in Pierre; safe to call more than once. */
export function registerClaudeCodeThemes() {
  if (registered) {
    return;
  }
  registered = true;
  registerCustomTheme(
    CLAUDE_CODE_DARK_CODE_THEME,
    async () => createClaudeCodeTheme(CLAUDE_CODE_DARK_CODE_THEME, "dark", MONOKAI_EXTENDED),
    "textmate",
  );
  registerCustomTheme(
    CLAUDE_CODE_LIGHT_CODE_THEME,
    async () => createClaudeCodeTheme(CLAUDE_CODE_LIGHT_CODE_THEME, "light", GITHUB),
    "textmate",
  );
}
