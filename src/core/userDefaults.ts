/**
 * Answers flow remembers per user, so they are asked once: `flow setup` saves the YouTrack
 * URL here and `flow init` offers it in every repository. They live in the user config
 * (`~/.config/flow/config.toml`) under `[defaults]`, a section no command reads as preferences.
 * Saving edits only that one line and keeps the rest of the file as the user wrote it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolveGlobalConfigPath } from "./paths";

export interface UserDefaults {
  youtrackUrl?: string;
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
    const url =
      typeof section === "object" && section !== null && "youtrack_url" in section
        ? section.youtrack_url
        : undefined;
    return typeof url === "string" && url.trim() ? { youtrackUrl: url.trim() } : {};
  } catch {
    return {};
  }
}

/** Remember the YouTrack URL, replacing an earlier one and leaving every other line untouched. */
export function saveUserYouTrackUrl(url: string, path = resolveGlobalConfigPath()) {
  if (!path) {
    return;
  }
  const line = `youtrack_url = ${JSON.stringify(url)}`;
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = text.split("\n");
  const header = lines.findIndex((candidate) => candidate.trim() === `[${SECTION}]`);
  let next: string;
  if (header === -1) {
    const block = `[${SECTION}]\n# Answers \`flow setup\` remembers for \`flow init\`.\n${line}\n`;
    next = text.trim() ? `${text.trimEnd()}\n\n${block}` : block;
  } else {
    const end = lines.findIndex((candidate, index) => index > header && /^\s*\[/.test(candidate));
    const sectionEnd = end === -1 ? lines.length : end;
    const existing = lines.findIndex(
      (candidate, index) =>
        index > header && index < sectionEnd && /^\s*youtrack_url\s*=/.test(candidate),
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
