import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCodexSetup } from "./codexSetup";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Isolated Codex and skill directories keep tests away from the user's configuration. */
function createTestCodexSetup() {
  const root = mkdtempSync(join(tmpdir(), "flow-codex-setup-"));
  roots.push(root);
  return {
    codexDir: join(root, "codex"),
    skillsDir: join(root, "skills"),
    flowBin: join(root, "bin", "flow"),
    skills: [
      {
        name: "flow-review",
        markdown: "---\nname: flow-review\ndescription: Review a Flow ticket.\n---\n\nReview.\n",
      },
    ],
  };
}

test("Codex setup installs discoverable skills and all event checkpoints, and reruns unchanged", () => {
  const options = createTestCodexSetup();
  options.skills[0]!.markdown = options.skills[0]!.markdown.replaceAll("\n", "\r\n");
  applyCodexSetup(options);
  const stub = readFileSync(join(options.skillsDir, "flow-review", "SKILL.md"), "utf8");
  expect(stub).toContain("skill show flow-review");
  expect(stub).not.toContain("$ARGUMENTS");
  const hooks = readFileSync(join(options.codexDir, "hooks.json"), "utf8");
  for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"])
    expect(hooks).toContain(`"${event}"`);
  expect(hooks).toContain("commandWindows");
  expect(hooks).not.toContain("PermissionRequest");
  expect(applyCodexSetup(options).every((change) => change.action === "unchanged")).toBe(true);
});

test("Codex preview writes nothing and uninstall preserves other hooks and personal skills", () => {
  const options = createTestCodexSetup();
  applyCodexSetup({ ...options, dryRun: true });
  expect(existsSync(options.codexDir)).toBe(false);
  expect(existsSync(options.skillsDir)).toBe(false);
  mkdirSync(options.codexDir, { recursive: true });
  const hooksPath = join(options.codexDir, "hooks.json");
  const original = {
    description: "My hooks",
    hooks: {
      SessionStart: [
        { matcher: "startup", hooks: [{ type: "command", command: "my-personal-hook" }] },
      ],
      Stop: [{ hooks: [{ type: "command", command: "check-tests" }] }],
    },
  };
  writeFileSync(hooksPath, JSON.stringify(original));
  mkdirSync(join(options.skillsDir, "personal"), { recursive: true });
  writeFileSync(join(options.skillsDir, "personal", "SKILL.md"), "Personal instructions");
  applyCodexSetup(options);
  applyCodexSetup({ ...options, uninstall: true });
  expect(JSON.parse(readFileSync(hooksPath, "utf8"))).toEqual(original);
  expect(readFileSync(join(options.skillsDir, "personal", "SKILL.md"), "utf8")).toBe(
    "Personal instructions",
  );
  expect(existsSync(join(options.skillsDir, "flow-review"))).toBe(false);
});

test("Codex setup refuses malformed hook files and skill collisions before writing", () => {
  const options = createTestCodexSetup();
  mkdirSync(options.codexDir, { recursive: true });
  const hooksPath = join(options.codexDir, "hooks.json");
  writeFileSync(hooksPath, "{ incomplete");
  expect(() => applyCodexSetup(options)).toThrow("not valid JSON");
  expect(existsSync(options.skillsDir)).toBe(false);
  writeFileSync(hooksPath, "{}");
  mkdirSync(join(options.skillsDir, "flow-review"), { recursive: true });
  writeFileSync(join(options.skillsDir, "flow-review", "SKILL.md"), "My custom skill");
  expect(() => applyCodexSetup(options)).toThrow("not a Flow stub");
  expect(readFileSync(hooksPath, "utf8")).toBe("{}");
  expect(readFileSync(join(options.skillsDir, "flow-review", "SKILL.md"), "utf8")).toBe(
    "My custom skill",
  );
});
