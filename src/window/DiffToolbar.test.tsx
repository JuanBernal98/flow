/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffToolbar } from "./DiffToolbar";

test("diff toolbar exposes the active layout and review totals above the stream", () => {
  const html = renderToStaticMarkup(
    <DiffToolbar
      files={[{ path: "app.ts", patch: "", status: "modified", additions: 12, deletions: 3 }]}
      diffStyle="split"
      onDiffStyle={() => {}}
      onToggleFold={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Split diff" aria-pressed="true"');
  expect(html).toContain('aria-label="Stacked diff" aria-pressed="false"');
  expect(html).toContain('class="add">+12');
  expect(html).toContain('class="del">−3');
  expect(html).toContain('aria-label="Expand / collapse all files"');
});

test("diff toolbar disables folding while loading", () => {
  const html = renderToStaticMarkup(
    <DiffToolbar files={null} diffStyle="unified" onDiffStyle={() => {}} onToggleFold={() => {}} />,
  );
  expect(html).toContain('aria-label="Expand / collapse all files" disabled=""');
  expect(html).not.toContain('class="stat"');
});
