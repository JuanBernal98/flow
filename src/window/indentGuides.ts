/** Count rendered indentation columns with the same tab width as the desktop renderer. */
function indentationColumns(text: string) {
  let columns = 0;
  for (const character of text) {
    if (character === " ") columns += 1;
    else if (character === "\t") columns += 2 - (columns % 2);
    else break;
  }
  return columns;
}

/** Infer a consistent space indentation unit without treating alignment spaces as a full level. */
function indentationUnit(columns: readonly number[]) {
  let unit = 0;
  for (const count of columns) {
    let remainder = count;
    while (remainder) {
      const next = unit % remainder;
      unit = remainder;
      remainder = next;
    }
  }
  return Math.max(2, Math.min(unit || 2, 8));
}

/** Add guides after Pierre renders; unchanged lines retain their styles without extra DOM writes. */
export function applyIndentGuides(container: HTMLElement) {
  const lines = [
    ...(container.shadowRoot ?? container).querySelectorAll<HTMLElement>("[data-line]"),
  ];
  const columns = lines.map((line) => indentationColumns(line.textContent ?? ""));
  const unit = indentationUnit(columns.filter((count) => count > 0));
  lines.forEach((line, index) => {
    const width = `${columns[index] ?? 0}ch`;
    const step = `${unit}ch`;
    if (line.style.getPropertyValue("--indent-size") !== width)
      line.style.setProperty("--indent-size", width);
    if (line.style.getPropertyValue("--indent-step") !== step)
      line.style.setProperty("--indent-step", step);
  });
}
