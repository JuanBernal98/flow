/**
 * `flow setup`: install what Claude Code needs to work with flow, from this checkout.
 *
 * - One stub per bundled skill under `<claude>/skills/<name>/SKILL.md`. A stub carries the skill's
 *   frontmatter (Claude reads it before running anything) and tells Claude to print the real
 *   instructions with `flow skill show`, so they always match the installed flow.
 * - A SessionStart hook in `<claude>/settings.json` that runs `flow hook session-start`, which asks
 *   Claude to arm `flow watch` and says what to do with each event. Its text lives here too.
 *
 * Everything flow writes is recognizable as flow's own, so re-running setup replaces it and
 * `--uninstall` removes it without touching anything else in the user's Claude config.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { agentRequestInstructions } from "./agentRequestStore";

/** One bundled skill: its name and the full Markdown the repo ships. */
export interface BundledSkillSource {
  name: string;
  markdown: string;
}

/** What setup did, or would do with `--dry-run`, as lines for the report. */
export interface SetupChange {
  action: "install" | "update" | "remove" | "unchanged";
  target: string;
}

// A stub is flow's when its body sends Claude to `flow skill show` (quoted path or not), so stubs
// for skills flow no longer ships are found and removed on the next setup.
const FLOW_STUB_PATTERN = /flow(?:\.(?:cmd|exe))?['"]? skill show /i;
// The hook command flow installs, whatever path flow lives at.
const FLOW_HOOK_MARKER = "hook session-start";
const HOOK_TIMEOUT_SECONDS = 10;

/** Claude Code's config directory: `$CLAUDE_CONFIG_DIR`, else `~/.claude`. */
export function resolveClaudeDir(env: NodeJS.ProcessEnv = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/** Quote a path for a POSIX shell command line. */
function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The frontmatter block of a skill, `---` lines included, or undefined when it has none. */
function frontmatterOf(markdown: string) {
  const match = /^---\n[\s\S]*?\n---\n/.exec(markdown.replaceAll("\r\n", "\n"));
  return match?.[0];
}

/** Build the stub Claude loads for one bundled skill. */
export function renderSkillStub(
  skill: BundledSkillSource,
  flowBin: string,
  agent: "claude" | "codex" = "claude",
) {
  const frontmatter = frontmatterOf(skill.markdown);
  if (!frontmatter) {
    throw new Error(`The bundled skill \`${skill.name}\` has no frontmatter.`);
  }
  return [
    frontmatter.trimEnd(),
    "",
    "The instructions live in flow, versioned with its code, so they always match its commands and",
    "formats. Run this and follow its output exactly:",
    "",
    agent === "codex" && process.platform === "win32" ? "```powershell" : "```sh",
    `${agent === "codex" && process.platform === "win32" ? `& '${flowBin.replaceAll("'", "''")}'` : shellQuote(flowBin)} skill show ${skill.name}`,
    "```",
    "",
    ...(agent === "claude"
      ? [
          "Arguments for this invocation: `$ARGUMENTS`. Wherever the instructions say `<argumentos>`, they",
          "mean these.",
        ]
      : [
          "Use the arguments from the user's prompt or the Flow event wherever the workflow says `<argumentos>`.",
          "Use the equivalent tools available in this session for provider-specific tool names. If a required",
          "integration is unavailable, report it and stop. Preserve the workflow's approval steps.",
        ]),
    "",
    "If the command is missing or fails, say so and stop instead of guessing the workflow.",
    "",
  ].join("\n");
}

/** The command the SessionStart hook runs. */
export function sessionStartHookCommand(flowBin: string) {
  return `${shellQuote(flowBin)} hook session-start --bin ${shellQuote(flowBin)}`;
}

/** What the SessionStart hook tells Claude in one repository. */
export function renderSessionStartContext(repoRoot: string, flowBin: string) {
  const watch = `cd ${shellQuote(repoRoot)} && ${shellQuote(flowBin)} watch`;
  return [
    `flow is installed for this repo (${repoRoot}).`,
    "At the start of this session, before anything else, arm a Monitor (timeout_ms 1800000,",
    `description 'new flow review comments') with this exact command (no extra arguments): [${watch}].`,
    "Re-arm it whenever it expires.",
    "On each 'new flow comments' event: if you are mid-task, finish the current step first, then",
    "handle those comments with the flow-comments-fix skill, then resume the interrupted task where",
    "it left off. Never drop the user's current work for a comment.",
    "On each 'flow request: ticket-context <ID>' event, the user just switched to that ticket in flow",
    "and its branch is already checked out: if you are mid-task, finish the current step first, then",
    "run the flow-ticket-context skill with that ID and show its summary.",
    "On each 'flow request: review <ID> [!<iid>]' event, the user pressed R to review that ticket's",
    "code (that MR, else the ticket's branch) against the ticket: if you are mid-task, finish the",
    "current step first, then run the flow-review skill with those arguments and show its summary.",
    "On each 'flow request: commit [<ID>]' event, the user pressed C: once you are not mid-task, run",
    "the flow-commit-create skill with those arguments; it proposes the commits and waits for approval.",
    "Commit events with --proposal <id> --phase propose|execute use that skill's desktop mode:",
    "publish the proposal for flow open, or execute only the plan already approved in its window.",
    "On each 'flow request: mr-open [<ID>]' event, the user pressed P: once you are not mid-task, run",
    "the flow-mr-open skill; it asks for approval before every outside action.",
    "Do not switch branches, stash, or run /flow-ticket-switch for these events.",
    agentRequestInstructions(),
    "Don't mention the watcher to the user unless asked.",
  ].join(" ");
}

/** The hook's stdout: Claude Code's SessionStart output with the context above. */
export function renderSessionStartOutput(repoRoot: string, flowBin: string) {
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: renderSessionStartContext(repoRoot, flowBin),
    },
  })}\n`;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether one hook entry is a command flow installed. */
function isFlowHook(hook: unknown, marker: string) {
  return isJsonObject(hook) && typeof hook.command === "string" && hook.command.includes(marker);
}

/**
 * Return settings with flow's SessionStart hook replaced by `command`, or removed when `command`
 * is undefined. Every other hook and setting is kept as it was.
 */
export function withFlowSessionStartHook(settings: JsonObject, command: string | undefined) {
  return withFlowHook(settings, "SessionStart", command, FLOW_HOOK_MARKER);
}

/** Replace only Flow's entries for one lifecycle event, preserving other hook providers. */
export function withFlowHook(
  settings: JsonObject,
  event: string,
  command: string | undefined,
  marker: string,
  extra: JsonObject = {},
) {
  const hooks = isJsonObject(settings.hooks) ? settings.hooks : {};
  const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
  // Drop flow's hooks from every group, and any group that held nothing else.
  const kept = groups.flatMap((group) => {
    if (!isJsonObject(group) || !Array.isArray(group.hooks)) {
      return [group];
    }
    const others = group.hooks.filter((hook) => !isFlowHook(hook, marker));
    return others.length > 0 ? [{ ...group, hooks: others }] : [];
  });
  const sessionStart = command
    ? [...kept, { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS, ...extra }] }]
    : kept;

  const nextHooks: JsonObject = { ...hooks };
  if (sessionStart.length > 0) {
    nextHooks[event] = sessionStart;
  } else {
    delete nextHooks[event];
  }
  const next: JsonObject = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    next.hooks = nextHooks;
  } else {
    delete next.hooks;
  }
  return next;
}

/** Read `settings.json`; a missing file is empty settings, a broken one stops setup. */
export function readSetupSettings(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON; fix it and run setup again.`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${path} does not hold a JSON object; fix it and run setup again.`);
  }
  return parsed;
}

/** Write `content` unless the file already holds it, and say which it was. */
export function writeIfChanged(
  path: string,
  content: string,
  dryRun: boolean,
): SetupChange["action"] {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (existing === content) {
    return "unchanged";
  }
  if (!dryRun) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return existing === undefined ? "install" : "update";
}

/** Skill directories under `<claude>/skills` whose stub points at flow. */
export function findFlowStubs(skillsDir: string) {
  if (!existsSync(skillsDir)) {
    return [];
  }
  return readdirSync(skillsDir).filter((name) => {
    const stubPath = join(skillsDir, name, "SKILL.md");
    return existsSync(stubPath) && FLOW_STUB_PATTERN.test(readFileSync(stubPath, "utf8"));
  });
}

/**
 * Whether Claude Code's flow stubs lag behind this checkout: a bundled skill has no stub, or a flow
 * stub names a skill flow no longer ships. False when setup never ran, so plain diff-viewer users
 * are never nagged.
 */
export function claudeSetupIsStale(claudeDir: string, skillNames: readonly string[]) {
  const skillsDir = join(claudeDir, "skills");
  const installed = findFlowStubs(skillsDir);
  if (installed.length === 0) {
    return false;
  }
  return (
    skillNames.some((name) => !existsSync(join(skillsDir, name, "SKILL.md"))) ||
    installed.some((name) => !skillNames.includes(name))
  );
}

export interface ClaudeSetupOptions {
  claudeDir: string;
  flowBin: string;
  skills: BundledSkillSource[];
  dryRun?: boolean;
  uninstall?: boolean;
}

/** Install (or with `uninstall`, remove) flow's skill stubs and SessionStart hook. */
export function applyClaudeSetup({
  claudeDir,
  flowBin,
  skills,
  dryRun = false,
  uninstall = false,
}: ClaudeSetupOptions): SetupChange[] {
  const changes: SetupChange[] = [];
  // Read settings first: when the file is broken, setup stops before writing anything.
  const settingsPath = join(claudeDir, "settings.json");
  const settings = readSetupSettings(settingsPath);
  const skillsDir = join(claudeDir, "skills");
  const currentNames = new Set(skills.map((skill) => skill.name));

  if (!uninstall) {
    for (const skill of skills) {
      const stubPath = join(skillsDir, skill.name, "SKILL.md");
      changes.push({
        action: writeIfChanged(stubPath, renderSkillStub(skill, flowBin), dryRun),
        target: `skill ${skill.name}`,
      });
    }
  }
  // Stubs for names flow no longer ships (or every flow stub, when uninstalling) go away.
  for (const name of findFlowStubs(skillsDir)) {
    if (uninstall || !currentNames.has(name)) {
      if (!dryRun) {
        rmSync(join(skillsDir, name), { recursive: true, force: true });
      }
      changes.push({ action: "remove", target: `skill ${name}` });
    }
  }

  const nextSettings = withFlowSessionStartHook(
    settings,
    uninstall ? undefined : sessionStartHookCommand(flowBin),
  );
  const settingsAction = writeIfChanged(
    settingsPath,
    `${JSON.stringify(nextSettings, null, 2)}\n`,
    dryRun,
  );
  changes.push({
    action: settingsAction === "unchanged" ? "unchanged" : uninstall ? "remove" : settingsAction,
    target: "SessionStart hook",
  });

  return changes;
}
