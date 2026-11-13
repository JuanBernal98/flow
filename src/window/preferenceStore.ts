import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolveGlobalConfigPath } from "../core/paths";
import { normalizeWindowPreferences, type WindowPreferences } from "./preferences";

/** Keep desktop preferences alongside the user's config, independent of the launch port. */
function preferencesPath() {
  const config = resolveGlobalConfigPath() ?? join(homedir(), ".config", "flow", "config.toml");
  return join(dirname(config), "window-settings.json");
}

/** A missing or malformed preferences file falls back to the current defaults. */
export function readWindowPreferences(path = preferencesPath()): WindowPreferences {
  try {
    return normalizeWindowPreferences(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return normalizeWindowPreferences(null);
  }
}

/** Atomically persist user settings so they survive restarts and repository changes. */
export function saveWindowPreferences(preferences: WindowPreferences, path = preferencesPath()) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
  return preferences;
}
