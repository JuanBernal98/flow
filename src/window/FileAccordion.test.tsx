/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FileAccordion } from "./FileAccordion";

test("empty files stay selectable without a disclosure or blank code container", () => {
  const html = renderToStaticMarkup(
    <FileAccordion
      id="file-empty.txt"
      path="empty.txt"
      selected
      onSelectionChange={() => {}}
      header={<span>empty.txt</span>}
      expandable={false}
      emptyLabel="Empty file"
    >
      <div className="code-block" />
    </FileAccordion>,
  );
  expect(html).toContain("Empty file");
  expect(html).toContain('aria-label="Select empty.txt" checked=""');
  expect(html).not.toContain("<details");
  expect(html).not.toContain("<summary");
  expect(html).not.toContain("<svg");
  expect(html).not.toContain('class="code-block"');
});

test("text diffs put the disclosure before the shared checkbox and filename", () => {
  const html = renderToStaticMarkup(
    <FileAccordion
      id="file-app.ts"
      path="app.ts"
      selected={false}
      onSelectionChange={() => {}}
      header={<span>app.ts</span>}
    >
      <div className="code-block" />
    </FileAccordion>,
  );
  expect(html).toContain('<details class="file" id="file-app.ts" open="">');
  expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("<input"));
  expect(html.indexOf("<input")).toBeLessThan(html.indexOf("<span>app.ts"));
  expect(html).toContain('class="code-block"');
});
