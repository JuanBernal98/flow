/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsPanel } from "./SettingsPanel";

test("settings exposes a labeled diff-only font slider and the current pixel size", () => {
  const html = renderToStaticMarkup(
    <SettingsPanel fontSize={16} onFontSize={() => {}} onClose={() => {}} />,
  );
  expect(html).toContain('aria-labelledby="settings-title"');
  expect(html).toContain('for="diff-font-size">Diff font size');
  expect(html).toContain('min="10" max="24" step="0.5"');
  expect(html).toContain('value="16"');
  expect(html).toContain("16 px");
  expect(html).toContain('aria-label="Close settings"');
});
