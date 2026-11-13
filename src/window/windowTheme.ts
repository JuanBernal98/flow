import type { WindowTheme } from "./data";
import { contrastingTextColor } from "../ui/lib/color";

/** Derive desktop colors once for native bootstrap and React updates. */
export function windowThemeStyles(theme: WindowTheme): Record<string, string> {
  const { colors } = theme;
  const dark = theme.appearance === "dark";

  const properties: Record<string, string> = {};
  properties["color-scheme"] = theme.appearance;
  properties["--bg"] = colors.background;
  properties["--sidebar"] = colors.panel;
  properties["--panel"] = colors.panelAlt;
  properties["--text"] = colors.text;
  properties["--muted"] = colors.muted;
  properties["--faint"] = colors.faint;
  // One hairline color for every divider, softer than the theme's border like the terminal's rules.
  properties["--line"] = `color-mix(in srgb, ${colors.border} 55%, transparent)`;
  properties["--accent"] = colors.accent;
  properties["--selected"] = `color-mix(in srgb, ${colors.accent} 18%, transparent)`;
  properties["--hover"] = dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)";
  properties["--chip"] = dark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.05)";
  properties["--add"] = colors.added;
  properties["--commit-text"] = contrastingTextColor(colors.added);
  properties["--propose-text"] = contrastingTextColor(colors.accent);
  properties["--del"] = colors.removed;
  properties["--modified"] = colors.modified;
  // Pierre reads these through its shadow DOM, so hunks use the terminal's diff colors.
  // Code sits in a slightly darker block; line numbers stay outside it, on the window background.
  properties["--code-bg"] = dark
    ? `color-mix(in srgb, ${colors.background} 86%, black)`
    : `color-mix(in srgb, ${colors.background} 97.5%, black)`;
  properties["--diffs-bg-context-override"] = "var(--code-bg)";
  properties["--diffs-bg-context-gutter-override"] = colors.background;
  // Same scheme as the terminal: rows get the faint tint, changed words the stronger one.
  properties["--diffs-bg-addition-override"] = colors.addedRow;
  properties["--diffs-bg-deletion-override"] = colors.removedRow;
  properties["--diffs-bg-addition-emphasis-override"] = colors.addedWord;
  properties["--diffs-bg-deletion-emphasis-override"] = colors.removedWord;
  properties["--diffs-bg-addition-number-override"] = colors.background;
  properties["--diffs-bg-deletion-number-override"] = colors.background;
  properties["--diffs-bg-separator-override"] = colors.panel;
  properties["--diffs-bg-buffer-override"] = "var(--code-bg)";
  properties["--diffs-fg-number-override"] = colors.faint;
  properties["--diffs-addition-color-override"] = colors.added;
  properties["--diffs-deletion-color-override"] = colors.removed;
  return properties;
}
