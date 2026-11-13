// Pierre paints code with its syntax theme's background in its "theme" layer; this CSS sits in
// its later "unsafe" layer, so the window's background wins without !important (which would flip
// the layer order and lose).
export const REVIEW_DIFF_CSS = `
:host,
pre,
code {
  --diffs-bg: var(--bg);
  background-color: var(--bg);
  --diffs-font-family: ui-monospace, "SF Mono", Menlo, monospace;
  --diffs-font-size: var(--diff-font-size, 16px);
  --diffs-line-height: var(--diff-line-height, 26px);
}
/* Keep Pierre's split grid intact; only the host needs an explicit block layout. */
:host {
  display: block;
  width: 100%;
}
/* Columns can shrink below long code lines and scroll within their own half of the diff. */
pre,
[data-diff],
[data-code] {
  width: 100%;
  min-width: 0;
}
[data-code] {
  display: grid;
}
/* A fixed number column, so the file title above can line up with the code box. */
[data-code] {
  --diffs-code-grid: var(--gutter-width) minmax(0, 1fr);
  grid-template-columns: var(--gutter-width) minmax(0, 1fr);
  /* No reserved scrollbar lane or outer padding, so the box spans exactly under its title. */
  --diffs-scrollbar-gutter-override: 0px;
  scrollbar-gutter: auto;
  padding-block: 0;
  --diffs-min-number-column-width: 0;
}
/* Like Zed: line numbers on the window background, the code in a framed, slightly darker box. */
[data-content] {
  --diffs-bg: var(--code-bg);
  background-color: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
/* Omitted context is one hairline across code and gutter, without an empty row or ellipsis. */
[data-separator="simple"] {
  min-height: 1px;
  height: 1px;
  background-color: var(--line);
}
[data-gutter-buffer] {
  padding-inline: 0 1.5ch;
}
/* The focused hunk, like the terminal: no tint of its own, only its line numbers at full strength
   while every other hunk's numbers fade. */
[data-selected-line] {
  --diffs-computed-selected-line-bg: var(--diffs-computed-diff-line-bg);
}
[data-column-number] {
  color: color-mix(in srgb, var(--faint) 50%, var(--bg));
}
[data-column-number][data-selected-line] {
  --diffs-selection-number-fg: var(--muted);
  color: var(--muted);
}
/* Pierre mixes each row's tint with the background; the terminal paints the tint as is. */
[data-line],
[data-column-number],
[data-gutter-buffer],
[data-no-newline] {
  --mix-light: 0%;
  --mix-dark: 0%;
}
/* Paint the change accent inside each code row so it never shifts columns or text. */
[data-line][data-line-type="change-addition"] {
  --diff-row-accent: var(--diffs-addition-base);
}
[data-line][data-line-type="change-deletion"] {
  --diff-row-accent: var(--diffs-deletion-base);
}
/* Extend each row's paint into fractional raster gaps without changing its layout. */
[data-line] {
  box-shadow: inset 3px 0 0 var(--diff-row-accent, transparent), 0 1px 0 var(--diffs-line-bg);
  background-image: repeating-linear-gradient(to right, color-mix(in srgb, var(--faint) 22%, transparent) 0 1px, transparent 1px var(--indent-step, 2ch));
  background-size: var(--indent-size, 0px) 100%;
  background-repeat: no-repeat;
  background-position: 1ch 0;
}
/* Breathing room inside the box: the first and last rows grow, so the room takes their color (green
   on a new line) and the gutter rows grow alike, keeping numbers on their lines. */
[data-content] > :first-child,
[data-gutter] > :first-child {
  padding-top: 6px;
}
[data-content] > :last-child,
[data-gutter] > :last-child {
  padding-bottom: 6px;
}
[data-column-number] {
  border-right: 0;
  padding-left: 0;
  padding-right: 1.5ch;
  --diffs-min-number-column-width: 0;
  --diffs-fg-number-addition-override: var(--faint);
  --diffs-fg-number-deletion-override: var(--faint);
}
`;
