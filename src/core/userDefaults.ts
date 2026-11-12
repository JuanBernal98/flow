/**
 * Answers flow remembers per user, so they are asked once: `flow setup` saves the YouTrack
 * URL and the language Claude writes in here, and `flow init` offers the URL in every repository.
 * They live in the user config (`~/.config/flow/config.toml`) under `[defaults]`, a section no
 * command reads as preferences. Saving edits only that one line and keeps the rest of the file as
 * the user wrote it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveGlobalConfigPath } from "./paths";

export interface UserDefaults {
  youtrackUrl?: string;
  /** A language code like `es`, for what Claude writes: overviews, reviews, and summaries. */
  language?: string;
}

const SECTION = "defaults";

/** Read the remembered answers; a missing or unreadable config remembers nothing. */
export function readUserDefaults(path = resolveGlobalConfigPath()): UserDefaults {
  if (!path || !existsSync(path)) {
    return {};
  }
  try {
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const section = parsed[SECTION];
    if (typeof section !== "object" || section === null) {
      return {};
    }
    const text = (key: string) => {
      const value = (section as Record<string, unknown>)[key];
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    };
    const defaults: UserDefaults = {};
    const youtrackUrl = text("youtrack_url");
    const language = text("language");
    if (youtrackUrl) defaults.youtrackUrl = youtrackUrl;
    if (language) defaults.language = language;
    return defaults;
  } catch {
    return {};
  }
}

/** Remember the YouTrack URL, replacing an earlier one and leaving every other line untouched. */
export function saveUserYouTrackUrl(url: string, path = resolveGlobalConfigPath()) {
  saveUserDefault("youtrack_url", url, path);
}

/** Remember the language code Claude writes in, replacing an earlier one. */
export function saveUserLanguage(code: string, path = resolveGlobalConfigPath()) {
  saveUserDefault("language", code, path);
}

/** Write one `[defaults]` key, creating the section when the config has none. */
function saveUserDefault(key: string, value: string, path: string | undefined) {
  if (!path) {
    return;
  }
  const line = `${key} = ${JSON.stringify(value)}`;
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = text.split("\n");
  const header = lines.findIndex((candidate) => candidate.trim() === `[${SECTION}]`);
  let next: string;
  if (header === -1) {
    const block = `[${SECTION}]\n# Answers \`flow setup\` remembers.\n${line}\n`;
    next = text.trim() ? `${text.trimEnd()}\n\n${block}` : block;
  } else {
    const end = lines.findIndex((candidate, index) => index > header && /^\s*\[/.test(candidate));
    const sectionEnd = end === -1 ? lines.length : end;
    const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
    const existing = lines.findIndex(
      (candidate, index) => index > header && index < sectionEnd && keyPattern.test(candidate),
    );
    if (existing === -1) {
      lines.splice(header + 1, 0, line);
    } else {
      lines[existing] = line;
    }
    next = lines.join("\n");
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
}
