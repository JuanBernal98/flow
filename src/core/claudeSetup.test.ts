import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyClaudeSetup,
  renderSessionStartOutput,
  renderSkillStub,
  withFlowSessionStartHook,
  type BundledSkillSource,
} from "./claudeSetup";

const FLOW_BIN = "/home/test/.local/bin/flow";
const TEST_SKILLS: BundledSkillSource[] = [
  {
    name: "flow-review",
    markdown: "---\nname: flow-review\ndescription: Review against the ticket.\n---\n\nBody.\n",
  },
  {
    name: "flow-mr-open",
    markdown:
      "---\nname: flow-mr-open\ndescription: Open the MR.\ndisable-model-invocation: true\n---\n\nBody.\n",
  },
];

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway Claude config directory. */
function createTestClaudeDir() {
  const dir = mkdtempSync(join(tmpdir(), "flow-claude-setup-"));
  testRoots.push(dir);
  return dir;
}

function readTestSettings(claudeDir: string) {
  return JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
}

describe("renderSkillStub", () => {
  test("keeps the skill's frontmatter and sends Claude to `flow skill show`", () => {
    const stub = renderSkillStub(TEST_SKILLS[1]!, FLOW_BIN);
    expect(stub).toStartWith(
      "---\nname: flow-mr-open\ndescription: Open the MR.\ndisable-model-invocation: true\n---\n",
    );
    expect(stub).toContain(`'${FLOW_BIN}' skill show flow-mr-open`);
    expect(stub).toContain("`$ARGUMENTS`");
  });
});

describe("withFlowSessionStartHook", () => {
  test("replaces flow's hook and keeps every other hook and setting", () => {
    const settings = {
      theme: "dark",
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "lint" }] }],
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "'/old/flow' hook session-start --bin '/old/flow'" },
            ],
          },
          { hooks: [{ type: "command", command: "echo hello" }] },
        ],
      },
    };
    const next = withFlowSessionStartHook(settings, "'flow' hook session-start --bin 'flow'");
    expect(next).toEqual({
      theme: "dark",
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "lint" }] }],
        SessionStart: [
          { hooks: [{ type: "command", command: "echo hello" }] },
          {
            hooks: [
              { type: "command", command: "'flow' hook session-start --bin 'flow'", timeout: 10 },
            ],
          },
        ],
      },
    });
    // Removing it leaves no empty SessionStart or hooks behind.
    expect(
      withFlowSessionStartHook(withFlowSessionStartHook({}, "x hook session-start"), undefined),
    ).toEqual({});
  });
});

describe("applyClaudeSetup", () => {
  test("installs stubs and the hook, and a second run changes nothing", () => {
    const claudeDir = createTestClaudeDir();
    const first = applyClaudeSetup({ claudeDir, flowBin: FLOW_BIN, skills: TEST_SKILLS });
    expect(first.map((change) => change.action)).toEqual(["install", "install", "install"]);
    expect(existsSync(join(claudeDir, "skills", "flow-review", "SKILL.md"))).toBe(true);
    expect(readTestSettings(claudeDir).hooks.SessionStart[0].hooks[0].command).toBe(
      `'${FLOW_BIN}' hook session-start --bin '${FLOW_BIN}'`,
    );

    const second = applyClaudeSetup({ claudeDir, flowBin: FLOW_BIN, skills: TEST_SKILLS });
    expect(second.every((change) => change.action === "unchanged")).toBe(true);
  });

  test("removes flow's stubs for skills it no longer ships, never someone else's skill", () => {
    const claudeDir = createTestClaudeDir();
    mkdirSync(join(claudeDir, "skills", "mr"), { recursive: true });
    writeFileSync(
      join(claudeDir, "skills", "mr", "SKILL.md"),
      "---\nname: mr\n---\n\n~/.local/bin/flow skill show mr\n",
    );
    mkdirSync(join(claudeDir, "skills", "my-own"), { recursive: true });
    writeFileSync(
      join(claudeDir, "skills", "my-own", "SKILL.md"),
      "---\nname: my-own\n---\n\nMine.\n",
    );

    const changes = applyClaudeSetup({ claudeDir, flowBin: FLOW_BIN, skills: TEST_SKILLS });
    expect(changes).toContainEqual({ action: "remove", target: "skill mr" });
    expect(existsSync(join(claudeDir, "skills", "mr"))).toBe(false);
    expect(existsSync(join(claudeDir, "skills", "my-own", "SKILL.md"))).toBe(true);
  });

  test("a dry run writes nothing, and uninstall removes only flow's entries", () => {
    const claudeDir = createTestClaudeDir();
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ theme: "dark" }));

    const preview = applyClaudeSetup({
      claudeDir,
      flowBin: FLOW_BIN,
      skills: TEST_SKILLS,
      dryRun: true,
    });
    expect(preview.map((change) => change.action)).toEqual(["install", "install", "update"]);
    expect(existsSync(join(claudeDir, "skills"))).toBe(false);
    expect(readTestSettings(claudeDir)).toEqual({ theme: "dark" });

    applyClaudeSetup({ claudeDir, flowBin: FLOW_BIN, skills: TEST_SKILLS });
    applyClaudeSetup({ claudeDir, flowBin: FLOW_BIN, skills: TEST_SKILLS, uninstall: true });
    expect(existsSync(join(claudeDir, "skills", "flow-review"))).toBe(false);
    expect(readTestSettings(claudeDir)).toEqual({ theme: "dark" });
  });

  test("stops before touching anything when settings.json is not valid JSON", () => {
    const claudeDir = createTestClaudeDir();
    writeFileSync(join(claudeDir, "settings.json"), "{ broken");
    expect(() => applyClaudeSetup({ claudeDir, flowBin: FLOW_BIN, skills: [] })).toThrow(
      "is not valid JSON",
    );
    expect(readFileSync(join(claudeDir, "settings.json"), "utf8")).toBe("{ broken");
  });
});

describe("renderSessionStartOutput", () => {
  test("asks Claude to arm the watcher and names the current skills", () => {
    const output = JSON.parse(renderSessionStartOutput("/repo", FLOW_BIN));
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const context: string = output.hookSpecificOutput.additionalContext;
    expect(context).toContain(`[cd '/repo' && '${FLOW_BIN}' watch]`);
    expect(context).toContain("flow-comments-fix skill");
    expect(context).toContain("flow-ticket-context skill");
    expect(context).toContain("flow-review skill");
    expect(context).toContain("'flow request: commit [<ID>]'");
    expect(context).toContain("flow-commit-create skill");
    expect(context).toContain("'flow request: mr-open [<ID>]'");
    expect(context).toContain("flow-mr-open skill");
  });
});
