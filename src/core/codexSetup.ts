/** Install the same Flow workflows for ChatGPT/Codex using native lifecycle hooks. */
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, rmSync } from "node:fs";
import {
  findFlowStubs,
  readSetupSettings,
  renderSkillStub,
  withFlowHook,
  writeIfChanged,
  type BundledSkillSource,
  type SetupChange,
} from "./claudeSetup";

const CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"] as const;

/** Use Codex's config location and the standard user-scoped Agent Skills directory. */
export function resolveCodexSetupPaths(env: NodeJS.ProcessEnv = process.env) {
  return {
    codexDir: env.CODEX_HOME || join(homedir(), ".codex"),
    skillsDir: join(homedir(), ".agents", "skills"),
  };
}

/** Quote a command argument without letting paths become shell code. */
function quotePosix(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Install or remove only Flow's stubs and hooks, with preview and repeatable updates. */
export function applyCodexSetup({
  codexDir,
  skillsDir,
  flowBin,
  skills,
  dryRun = false,
  uninstall = false,
}: {
  codexDir: string;
  skillsDir: string;
  flowBin: string;
  skills: BundledSkillSource[];
  dryRun?: boolean;
  uninstall?: boolean;
}): SetupChange[] {
  const hooksPath = join(codexDir, "hooks.json");
  let settings = readSetupSettings(hooksPath);
  const ownedSkills = new Set(findFlowStubs(skillsDir));
  if (!uninstall) {
    for (const skill of skills) {
      if (existsSync(join(skillsDir, skill.name, "SKILL.md")) && !ownedSkills.has(skill.name)) {
        throw new Error(
          `Skill ${skill.name} already exists and is not a Flow stub; setup left it unchanged.`,
        );
      }
    }
  }
  const command = `${quotePosix(flowBin)} hook codex --bin ${quotePosix(flowBin)}`;
  const psBin = `'${flowBin.replaceAll("'", "''")}'`;
  const windowsScript = `& ${psBin} hook codex --bin ${psBin}`;
  const commandWindows = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(windowsScript, "utf16le").toString("base64")}`;
  for (const event of CODEX_HOOK_EVENTS) {
    settings = withFlowHook(settings, event, uninstall ? undefined : command, "hook codex", {
      commandWindows,
    });
  }
  const changes: SetupChange[] = [];
  if (!uninstall) {
    for (const skill of skills) {
      changes.push({
        action: writeIfChanged(
          join(skillsDir, skill.name, "SKILL.md"),
          renderSkillStub(skill, flowBin, "codex"),
          dryRun,
        ),
        target: `skill ${skill.name}`,
      });
    }
  }
  const currentNames = new Set(skills.map((skill) => skill.name));
  for (const name of findFlowStubs(skillsDir)) {
    if (uninstall || !currentNames.has(name)) {
      if (!dryRun) rmSync(join(skillsDir, name), { recursive: true, force: true });
      changes.push({ action: "remove", target: `skill ${name}` });
    }
  }
  const action = writeIfChanged(hooksPath, `${JSON.stringify(settings, null, 2)}\n`, dryRun);
  changes.push({
    action: action === "unchanged" ? action : uninstall ? "remove" : action,
    target: "Codex lifecycle hooks",
  });
  return changes;
}
