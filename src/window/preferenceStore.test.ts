import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWindowPreferences, saveWindowPreferences } from "./preferenceStore";
import { normalizeWindowPreferences } from "./preferences";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Keep preference persistence tests isolated from the user's real settings. */
function createTestPreferencesPath() {
  const root = mkdtempSync(join(tmpdir(), "flow-preferences-"));
  roots.push(root);
  return join(root, "window-settings.json");
}

test("diff font preferences survive a new read independently of the repository or launch URL", () => {
  const path = createTestPreferencesPath();
  expect(readWindowPreferences(path)).toEqual({ diffFontSize: 16 });
  saveWindowPreferences({ diffFontSize: 16 }, path);
  expect(readWindowPreferences(path)).toEqual({ diffFontSize: 16 });
  saveWindowPreferences({ diffFontSize: 14.5 }, path);
  expect(readWindowPreferences(path)).toEqual({ diffFontSize: 14.5 });
});

test("invalid settings fall back to the current font size instead of breaking startup", () => {
  const path = createTestPreferencesPath();
  writeFileSync(path, "{ incomplete");
  expect(readWindowPreferences(path)).toEqual({ diffFontSize: 16 });
  for (const diffFontSize of [0, -1, 1000, NaN, Infinity, "16"]) {
    expect(normalizeWindowPreferences({ diffFontSize })).toEqual({ diffFontSize: 16 });
  }
  expect(normalizeWindowPreferences({ diffFontSize: 14.7 })).toEqual({ diffFontSize: 14.5 });
});
