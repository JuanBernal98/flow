import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readUserDefaults, saveUserYouTrackUrl } from "./userDefaults";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A path for a user config inside a throwaway directory. */
function createTestConfigPath(content?: string) {
  const root = mkdtempSync(join(tmpdir(), "flow-defaults-"));
  testRoots.push(root);
  const path = join(root, "flow", "config.toml");
  if (content !== undefined) {
    saveUserYouTrackUrl("https://placeholder.test", path);
    writeFileSync(path, content);
  }
  return path;
}

describe("user defaults", () => {
  test("remembers the YouTrack URL in a new config and reads it back", () => {
    const path = createTestConfigPath();
    expect(readUserDefaults(path)).toEqual({});
    saveUserYouTrackUrl("https://yt.test", path);
    expect(readUserDefaults(path)).toEqual({ youtrackUrl: "https://yt.test" });
  });

  test("replaces only that line, keeping the user's other settings and comments", () => {
    const path = createTestConfigPath(
      '# my settings\ntheme = "claude"\n\n[defaults]\nyoutrack_url = "https://old.test"\n\n[pager]\nmode = "stack"\n',
    );
    saveUserYouTrackUrl("https://yt.test", path);
    const text = readFileSync(path, "utf8");
    expect(text).toBe(
      '# my settings\ntheme = "claude"\n\n[defaults]\nyoutrack_url = "https://yt.test"\n\n[pager]\nmode = "stack"\n',
    );
  });

  test("adds a [defaults] section after existing settings", () => {
    const path = createTestConfigPath('theme = "zed"\n');
    saveUserYouTrackUrl("https://yt.test", path);
    expect(Bun.TOML.parse(readFileSync(path, "utf8"))).toEqual({
      theme: "zed",
      defaults: { youtrack_url: "https://yt.test" },
    });
  });
});
