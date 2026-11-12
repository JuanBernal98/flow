import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveBundledCommentsFixSkillPath, resolveGlobalConfigPath } from "./paths";

function createTempRoot(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("paths", () => {
  test("resolves the XDG config path", () => {
    const env = { XDG_CONFIG_HOME: join("/tmp", "xdg-home") } as NodeJS.ProcessEnv;

    expect(resolveGlobalConfigPath(env)).toBe(join("/tmp", "xdg-home", "flow", "config.toml"));
  });

  test("falls back to HOME for the config path", () => {
    const env = { HOME: join("/tmp", "home") } as NodeJS.ProcessEnv;

    expect(resolveGlobalConfigPath(env)).toBe(
      join("/tmp", "home", ".config", "flow", "config.toml"),
    );
  });

  test("locates the bundled flow review skill from source", () => {
    const resolvedPath = resolveBundledCommentsFixSkillPath([import.meta.dir]);

    expect(resolvedPath).toEndWith(join("skills", "flow-comments-fix", "SKILL.md"));
  });

  test("locates the bundled skill from a sibling flow package in flat node_modules", () => {
    const tempRoot = createTempRoot("flow-skill-path-");

    try {
      const nestedPackageRoot = join(tempRoot, "node_modules", "flow");
      const skillPath = join(nestedPackageRoot, "skills", "flow-comments-fix", "SKILL.md");
      const fakeBinary = join(tempRoot, "node_modules", "flow-linux-x64", "bin", "flow");

      mkdirSync(dirname(skillPath), { recursive: true });
      mkdirSync(dirname(fakeBinary), { recursive: true });
      writeFileSync(skillPath, "# skill\n");
      writeFileSync(fakeBinary, "binary\n");

      expect(resolveBundledCommentsFixSkillPath([fakeBinary])).toBe(skillPath);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
