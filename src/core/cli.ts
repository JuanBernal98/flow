import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command, Option } from "commander";
import type {
  CommonOptions,
  HelpCommandInput,
  LayoutMode,
  PagerCommandInput,
  ParsedCliInput,
} from "./types";
import {
  renderCommentsHelp,
  runCommentsAdd,
  runCommentsList,
  runCommentsReply,
  runCommentsResolve,
  runCommentsShow,
} from "./cliComments";
import { FlowUserError } from "./errors";
import { WORKTREE_BASE_REF } from "./git";
import { resolveBundledCommentsFixSkillPath } from "./paths";
import { resolveCliVersion } from "./version";
import type { BranchReviewRequest } from "./types";

/** Validate one requested layout mode from CLI input. */
function parseLayoutMode(value: string): LayoutMode {
  if (value === "auto" || value === "split" || value === "stack") {
    return value;
  }

  throw new Error(`Invalid layout mode: ${value}`);
}

/** Read one paired positive/negative boolean flag directly from raw argv. */
function resolveBooleanFlag(argv: string[], enabledFlag: string, disabledFlag: string) {
  let resolved: boolean | undefined;

  for (const arg of argv) {
    if (arg === enabledFlag) {
      resolved = true;
      continue;
    }

    if (arg === disabledFlag) {
      resolved = false;
    }
  }

  return resolved;
}

/** Normalize the flags shared by every input mode. */
function buildCommonOptions(
  options: {
    mode?: LayoutMode;
    theme?: string;
    pager?: boolean;
    watch?: boolean;
  },
  argv: string[],
): CommonOptions {
  return {
    mode: options.mode,
    theme: options.theme,
    pager: options.pager ? true : undefined,
    watch: resolveBooleanFlag(argv, "--watch", "--no-watch"),
    excludeUntracked: resolveBooleanFlag(argv, "--exclude-untracked", "--no-exclude-untracked"),
    lineNumbers: resolveBooleanFlag(argv, "--line-numbers", "--no-line-numbers"),
    wrapLines: resolveBooleanFlag(argv, "--wrap", "--no-wrap"),
    hunkHeaders: resolveBooleanFlag(argv, "--hunk-headers", "--no-hunk-headers"),
    fileTree: resolveBooleanFlag(argv, "--file-tree", "--no-file-tree"),
    overview: resolveBooleanFlag(argv, "--overview", "--no-overview"),
  };
}

/** Attach the shared view flags to a subcommand parser. */
function applyCommonOptions(command: Command) {
  return command
    .option("--mode <mode>", "layout mode: auto, split, stack", parseLayoutMode)
    .option("--theme <theme>", "named theme override")
    .option("--pager", "use pager-style chrome and controls")
    .option("--line-numbers", "show line numbers")
    .option("--no-line-numbers", "hide line numbers")
    .option("--wrap", "wrap long diff lines")
    .option("--no-wrap", "truncate long diff lines to one row")
    .option("--hunk-headers", "show hunk metadata rows")
    .option("--no-hunk-headers", "hide hunk metadata rows")
    .option("--file-tree", "open the file tree at startup")
    .option("--no-file-tree", "start with the file tree closed")
    .option("--overview", "open the ticket Overview pane at startup")
    .option("--no-overview", "start with the Overview pane closed");
}

/** Attach auto-refresh support to review commands that can reopen their source input. */
function applyWatchOption(command: Command) {
  return command
    .option("--watch", "auto-reload when the current diff input changes (the default)")
    .option("--no-watch", "keep the review still until you reload with `r`");
}

/** Render plain-text version output for `flow --version`. */
function renderCliVersion() {
  return `${resolveCliVersion()}\n`;
}

// Skills shipped under `skills/`; the first one is the default.
export const BUNDLED_SKILLS = [
  "flow-comments-fix",
  "flow-ticket-switch",
  "flow-ticket-context",
  "flow-review",
  "flow-commit-create",
  "flow-mr-open",
] as const;
type BundledSkill = (typeof BUNDLED_SKILLS)[number];

/** Resolve a bundled skill's path; they all sit beside flow-comments-fix in every package layout. */
function resolveBundledSkillPath(name: BundledSkill) {
  return join(dirname(dirname(resolveBundledCommentsFixSkillPath())), name, "SKILL.md");
}

/** Render a bundled skill itself, so agents read the installed version's rules. */
function renderBundledSkill(name: BundledSkill) {
  const content = readFileSync(resolveBundledSkillPath(name), "utf8");
  return content.endsWith("\n") ? content : `${content}\n`;
}

/** Build the `flow skill` help text. */
function renderSkillHelp() {
  return [
    "Usage: flow skill <path|show> [name]",
    "",
    "  path   print a bundled skill's path",
    "  show   print a bundled skill",
    "",
    `Skills: ${BUNDLED_SKILLS.join(", ")} (default: flow-comments-fix).`,
    "",
    "Point your agent's skill at `flow skill show <name>` so its instructions always match the",
    "installed flow, instead of a copied file that drifts across upgrades.",
    "",
  ].join("\n");
}

/** Build the top-level help text shown by bare `flow` and `flow --help`. */
function renderCliHelp() {
  return [
    "Usage: flow <command> [options]",
    "",
    "Review diffs in a TUI, leave inline comments, and let a coding agent resolve them through .flow/comments.json.",
    "",
    "Commands:",
    "  flow                                    in a repository: open the workspace and review (flow diff)",
    "  flow diff [target] [-- <pathspec...>]   review staged + unstaged changes or compare against a target",
    "  flow diff --staged [-- <pathspec...>]   review only staged changes",
    "  flow diff --unstaged [-- <pathspec...>] review only unstaged changes",
    "  flow diff --branch[=base]               review everything on the current branch vs its base",
    "  flow diff <left> <right>                compare two concrete files",
    "  flow show [target] [-- <pathspec...>]   review the last commit or a given target",
    "  flow stash show [ref]                   review a stash entry",
    "  flow patch [file]                       review a patch file or stdin",
    "  flow pager                              general Git pager wrapper with diff detection",
    "  flow difftool <left> <right> [path]     review Git difftool file pairs",
    "  flow comments [list|show|resolve]       inspect or resolve review comments without the TUI",
    "  flow skill <path|show>                  print the bundled agent review skill (path or text)",
    "  flow watch                              stream review events for a coding agent's terminal",
    "  flow focus <file>[:line]                ask the open review to show a file and line",
    "  flow overview write <ticket>            store a ticket overview (JSON on stdin) for the Overview pane",
    "  flow setup                              set up or refresh flow's dependencies and Claude Code",
    "  flow init                               connect this repository: write its .flow/config.toml",
    "",
    "Global options:",
    "  -h, --help                              show help",
    "  -v, --version                           show version",
    "",
    "Common review options:",
    "  --mode <mode>                           layout mode: auto, split, stack",
    "  --watch                                 auto-reload when the current diff input changes",
    "  --pager                                 use pager-style chrome and controls",
    "  --line-numbers / --no-line-numbers      show or hide line numbers",
    "  --wrap / --no-wrap                      wrap or truncate long diff lines",
    "  --hunk-headers / --no-hunk-headers      show or hide hunk metadata rows",
    "  --file-tree / --no-file-tree            open the file tree at startup, or not",
    "  --overview / --no-overview              open the ticket Overview pane at startup, or not",
    "  --theme <theme>                         named theme override",
    "",
    "Git diff options:",
    "  --staged, --cached                      review only staged changes",
    "  --unstaged                              review only unstaged changes",
    "  --exclude-untracked                     hide untracked files in working tree reviews",
    "  --branch [base]                         review the whole branch vs base (origin/HEAD by default)",
    "",
    "Notes:",
    "  Run `flow <command> --help` for command-specific syntax and options.",
    '  "target" refers to a generic set of changes; it can be any git ref or commit range',
    "",
  ].join("\n");
}

/** Split raw arguments into command tokens and optional pathspecs after `--`. */
function splitPathspecArgs(tokens: string[]) {
  const separatorIndex = tokens.indexOf("--");
  if (separatorIndex === -1) {
    return { commandTokens: tokens, pathspecs: [] as string[] };
  }

  return {
    commandTokens: tokens.slice(0, separatorIndex),
    pathspecs: tokens.slice(separatorIndex + 1),
  };
}

/** Return whether both diff operands are concrete files on disk. */
function areExistingFiles(left: string, right: string) {
  return [left, right].every((path) => existsSync(path) && statSync(path).isFile());
}

/** Parse one standalone command while letting us capture `--help` as plain text. */
async function parseStandaloneCommand(command: Command, tokens: string[]) {
  command.exitOverride();

  try {
    await command.parseAsync(["bun", "flow", ...tokens]);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "commander.helpDisplayed"
    ) {
      return;
    }

    throw error;
  }
}

/** Build one command parser with the shared flow options attached. */
function createCommand(name: string, description: string) {
  return applyCommonOptions(new Command(name).description(description));
}

/** Parse the overloaded `flow diff` command. */
async function parseDiffCommand(tokens: string[], _argv: string[]): Promise<ParsedCliInput> {
  const { commandTokens, pathspecs } = splitPathspecArgs(tokens);
  const command = applyWatchOption(
    createCommand("diff", "review diffs or compare two concrete files"),
  )
    .option("--staged", "review only staged changes (index vs HEAD)")
    .option("--cached", "alias for --staged")
    .option("--unstaged", "review only unstaged changes (working tree vs index)")
    .option("--exclude-untracked", "exclude untracked files from working tree reviews")
    .addOption(
      new Option(
        "--no-exclude-untracked",
        "include untracked files in working tree reviews",
      ).hideHelp(),
    )
    .option(
      "--branch [base]",
      "review everything on the current branch versus its base (the default; base defaults to origin/HEAD)",
    )
    .option("--no-branch", "review only uncommitted changes against HEAD")
    .argument("[targets...]");

  let parsedTargets: string[] = [];
  let parsedOptions: Record<string, unknown> = {};

  command.action((targets: string[], options: Record<string, unknown>) => {
    parsedTargets = targets;
    parsedOptions = options;
  });

  if (commandTokens.includes("--help") || commandTokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, commandTokens);

  const staged = Boolean(parsedOptions.staged) || Boolean(parsedOptions.cached);
  const unstaged = Boolean(parsedOptions.unstaged);
  if (staged && unstaged) {
    throw new FlowUserError("`flow diff --staged` cannot be combined with `--unstaged`.", [
      "Run `flow diff` with no scope flag to review staged and unstaged changes together.",
    ]);
  }
  // Scan the command tokens (already stripped of post-`--` pathspecs) so a
  // pathspec literally named e.g. `--no-wrap` does not flip a view option.
  const options = buildCommonOptions(parsedOptions, commandTokens);
  const normalizedPathspecs = pathspecs.length > 0 ? pathspecs : undefined;

  // A bare `flow diff` reviews the whole branch; `--no-branch`, a scope flag, or a target opts out.
  const branchReview =
    parseBranchReviewOption(parsedOptions.branch) ??
    (parsedOptions.branch === undefined && !staged && !unstaged && parsedTargets.length === 0
      ? { implicit: true }
      : undefined);
  if (branchReview) {
    if (staged || unstaged) {
      throw new FlowUserError(
        "`flow diff --branch` cannot be combined with `--staged` or `--unstaged`.",
        ["`--branch` already includes staged and unstaged work on top of the branch base."],
      );
    }
    if (parsedTargets.length > 0) {
      throw new FlowUserError("`flow diff --branch` does not take positional revision arguments.", [
        "Pass the base via the flag, e.g. `flow diff --branch=origin/main`.",
        "Use `[-- <pathspec...>]` to narrow the review to specific files.",
      ]);
    }

    return {
      kind: "vcs",
      staged: false,
      pathspecs: normalizedPathspecs,
      options,
      branchReview,
    };
  }

  if (parsedTargets.length === 0) {
    // Working-tree review scope is encoded purely in the comparison base:
    //   --staged   -> index vs HEAD       (staged: true, no range)
    //   --unstaged -> working tree vs index (plain `git diff`, no range)
    //   default    -> working tree vs HEAD  (range "HEAD" => staged + unstaged combined)
    return {
      kind: "vcs",
      staged,
      range: staged || unstaged ? undefined : WORKTREE_BASE_REF,
      pathspecs: normalizedPathspecs,
      options,
    };
  }

  if (unstaged) {
    throw new FlowUserError("`flow diff --unstaged` does not take positional revision arguments.", [
      "`--unstaged` only scopes a working-tree review (working tree vs index).",
      "Drop the revision, or use `flow diff <range>` to compare against it.",
    ]);
  }

  if (parsedTargets.length === 1) {
    return {
      kind: "vcs",
      range: parsedTargets[0],
      staged,
      pathspecs: normalizedPathspecs,
      options,
    };
  }

  if (!staged && !normalizedPathspecs) {
    if (parsedTargets.length === 2 && areExistingFiles(parsedTargets[0]!, parsedTargets[1]!)) {
      return {
        kind: "diff",
        left: parsedTargets[0]!,
        right: parsedTargets[1]!,
        options,
      };
    }

    return {
      kind: "vcs",
      range: parsedTargets[0]!,
      staged,
      pathspecs: parsedTargets.slice(1),
      options,
    };
  }

  throw new Error(
    "Use `flow diff [target] [-- pathspec...]`, `flow diff <left> <right>` for file comparison.",
  );
}

/**
 * Translate commander's `--branch [base]` option value into a `BranchReviewRequest`.
 *
 * - `--branch` alone parses as `true` → request branch mode, base resolved later.
 * - `--branch=foo` / `--branch foo` parses as the string → carry that explicit base through.
 * - Absent → `undefined`, leaving regular `flow diff` behavior intact.
 */
function parseBranchReviewOption(value: unknown): BranchReviewRequest | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === true) {
    return {};
  }

  if (typeof value === "string" && value.length > 0) {
    return { explicitBase: value };
  }

  return undefined;
}

/** Parse the Git-style `flow show` command. */
async function parseShowCommand(tokens: string[], _argv: string[]): Promise<ParsedCliInput> {
  const { commandTokens, pathspecs } = splitPathspecArgs(tokens);
  const command = applyWatchOption(
    createCommand("show", "review the last commit or a given ref"),
  ).argument("[ref]");

  let parsedRef: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action((ref: string | undefined, options: Record<string, unknown>) => {
    parsedRef = ref;
    parsedOptions = options;
  });

  if (commandTokens.includes("--help") || commandTokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, commandTokens);

  return {
    kind: "show",
    ref: parsedRef,
    pathspecs: pathspecs.length > 0 ? pathspecs : undefined,
    options: buildCommonOptions(parsedOptions, commandTokens),
  };
}

/** Parse the patch-file / stdin patch entrypoint. */
async function parsePatchCommand(tokens: string[], argv: string[]): Promise<ParsedCliInput> {
  const command = applyWatchOption(
    createCommand("patch", "review a patch file, or read a patch from stdin"),
  ).argument("[file]");

  let parsedFile: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action((file: string | undefined, options: Record<string, unknown>) => {
    parsedFile = file;
    parsedOptions = options;
  });

  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, tokens);

  return {
    kind: "patch",
    file: parsedFile,
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Parse the general pager wrapper command used from Git `core.pager`. */
async function parsePagerCommand(
  tokens: string[],
  argv: string[],
): Promise<PagerCommandInput | HelpCommandInput> {
  const command = createCommand("pager", "general Git pager wrapper with diff detection");
  let parsedOptions: Record<string, unknown> = {};

  command.action((options: Record<string, unknown>) => {
    parsedOptions = options;
  });

  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, tokens);

  return {
    kind: "pager",
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Parse Git difftool-style two-file review commands. */
async function parseDifftoolCommand(tokens: string[], argv: string[]): Promise<ParsedCliInput> {
  const command = applyWatchOption(createCommand("difftool", "review Git difftool file pairs"))
    .argument("<left>")
    .argument("<right>")
    .argument("[path]");

  let parsedLeft = "";
  let parsedRight = "";
  let parsedPath: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action(
    (left: string, right: string, path: string | undefined, options: Record<string, unknown>) => {
      parsedLeft = left;
      parsedRight = right;
      parsedPath = path;
      parsedOptions = options;
    },
  );

  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, tokens);

  return {
    kind: "difftool",
    left: parsedLeft,
    right: parsedRight,
    path: parsedPath,
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Pull every positional id from `flow comments resolve` and reject the rest. */
function parseResolveIds(args: string[]): number[] {
  const ids: number[] = [];
  for (const raw of args) {
    if (raw.startsWith("-")) {
      throw new FlowUserError(`\`flow comments resolve\` takes ids only, got \`${raw}\`.`);
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== raw) {
      throw new FlowUserError(
        `\`flow comments resolve\` expects positive integer ids, got \`${raw}\`.`,
      );
    }
    ids.push(parsed);
  }
  return ids;
}

/**
 * Parse `flow comments ...` and execute the requested action eagerly.
 *
 * Like `flow skill path`, these are print-and-exit commands rather than TUI
 * sessions, so we build the output here and return it as `kind: "help"` so
 * `main.tsx` writes it to stdout and exits 0. Errors raise `FlowUserError`,
 * which `formatCliError` renders cleanly with exit 1.
 */
async function parseCommentsCommand(tokens: string[]): Promise<HelpCommandInput> {
  const [subcommand, ...rest] = tokens;

  // `--help`/`-h` at any position short-circuits to the subcommand help text.
  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: renderCommentsHelp() };
  }

  if (!subcommand || subcommand === "list") {
    const json = rest.includes("--json");
    const extras = rest.filter((arg) => arg !== "--json");
    if (extras.length > 0) {
      throw new FlowUserError(`Unexpected argument for \`flow comments list\`: \`${extras[0]}\`.`);
    }

    return { kind: "help", text: runCommentsList(json ? "json" : "text") };
  }

  if (subcommand === "show") {
    const json = rest.includes("--json");
    let contextLines: number | undefined;
    const positionals: string[] = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i]!;
      if (arg === "--json") {
        continue;
      }
      if (arg === "--context") {
        const next = rest[i + 1];
        if (next === undefined) {
          throw new FlowUserError("`flow comments show --context` requires a number.");
        }
        const parsed = Number.parseInt(next, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== next) {
          throw new FlowUserError(
            `\`flow comments show --context\` expects a non-negative integer, got \`${next}\`.`,
          );
        }
        contextLines = parsed;
        i += 1;
        continue;
      }
      if (arg.startsWith("--context=")) {
        const value = arg.slice("--context=".length);
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
          throw new FlowUserError(
            `\`flow comments show --context\` expects a non-negative integer, got \`${value}\`.`,
          );
        }
        contextLines = parsed;
        continue;
      }
      positionals.push(arg);
    }

    if (positionals.length === 0) {
      throw new FlowUserError("`flow comments show` requires a comment id.");
    }
    if (positionals.length > 1) {
      throw new FlowUserError("`flow comments show` takes exactly one id.");
    }

    const id = Number.parseInt(positionals[0]!, 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== positionals[0]) {
      throw new FlowUserError(
        `\`flow comments show\` expects a positive integer id, got \`${positionals[0]}\`.`,
      );
    }

    return {
      kind: "help",
      text: runCommentsShow(id, json ? "json" : "text", { contextLines }),
    };
  }

  if (subcommand === "resolve") {
    const ids = parseResolveIds(rest);
    return { kind: "help", text: runCommentsResolve(ids) };
  }

  if (subcommand === "add") {
    const [filePath, rawRange, ...words] = rest;
    const rangeMatch = /^(\d+)(?:-(\d+))?$/.exec(rawRange ?? "");
    if (!filePath || !rangeMatch) {
      throw new FlowUserError("Usage: flow comments add <file> <start-end> <text>");
    }
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : start;
    return { kind: "help", text: runCommentsAdd(filePath, [start, end], words.join(" ")) };
  }

  if (subcommand === "reply") {
    const [rawId, ...words] = rest;
    const id = Number.parseInt(rawId ?? "", 10);
    if (!Number.isInteger(id) || id <= 0 || String(id) !== rawId) {
      throw new FlowUserError(
        "`flow comments reply` expects a positive integer id, then the text.",
      );
    }
    return { kind: "help", text: runCommentsReply(id, words.join(" ")) };
  }

  throw new FlowUserError(`Unknown \`flow comments\` subcommand: \`${subcommand}\`.`, [
    "Use one of: list, show, resolve, reply, add. Run `flow comments --help` for details.",
  ]);
}

/**
 * Parse `flow focus <file>[:line] [line]`: ask the open review to show a file and line. Like the
 * comments commands it writes a file under `.flow/` and exits; the TUI picks it up.
 */
async function parseFocusCommand(tokens: string[]): Promise<HelpCommandInput> {
  const usage = "Usage: flow focus <file>[:line] [line]";
  if (tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${usage}\n` };
  }
  if (tokens.length === 0 || tokens.length > 2) {
    throw new FlowUserError(usage);
  }
  const [target = "", explicitLine] = tokens;
  const match = /^(.*?):(\d+)$/.exec(target);
  const file = match?.[1] ?? target;
  const rawLine = explicitLine ?? match?.[2];
  const line = rawLine === undefined ? undefined : Number.parseInt(rawLine, 10);
  if (line !== undefined && (!Number.isInteger(line) || line <= 0 || String(line) !== rawLine)) {
    throw new FlowUserError(`\`flow focus\` expects a positive line number, got \`${rawLine}\`.`);
  }
  const { findRepoRoot } = await import("./config");
  const { writeFocusRequest } = await import("./focusRequests");
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new FlowUserError("Not inside a git repository.");
  }
  writeFocusRequest(repoRoot, file, line);
  return { kind: "help", text: `Asked the review to show ${line ? `${file}:${line}` : file}.\n` };
}

/**
 * Parse `flow overview write <ticket>`: validate the agent's ticket overview from stdin and store
 * it under `.flow/overviews/`, where the Overview pane picks it up.
 */
async function parseOverviewCommand(tokens: string[]): Promise<HelpCommandInput> {
  const usage = "Usage: flow overview write <ticket> < overview.json";
  const [subcommand, ticketId, ...extra] = tokens;
  if (!subcommand || tokens.includes("--help") || tokens.includes("-h")) {
    return { kind: "help", text: `${usage}\n` };
  }
  if (subcommand !== "write" || !ticketId || extra.length > 0) {
    throw new FlowUserError(usage);
  }
  const { describeOverviewIssues, isTicketId, TicketOverviewSchema, writeTicketOverview } =
    await import("./ticketOverview");
  if (!isTicketId(ticketId)) {
    throw new FlowUserError(
      `\`flow overview write\` expects a ticket id like PROJ-123, got \`${ticketId}\`.`,
    );
  }
  const { findRepoRoot } = await import("./config");
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new FlowUserError("Not inside a git repository.");
  }

  let json: unknown;
  try {
    json = JSON.parse(await Bun.stdin.text());
  } catch {
    throw new FlowUserError("`flow overview write` expects the overview as JSON on stdin.");
  }
  const parsed = TicketOverviewSchema.safeParse(json);
  if (!parsed.success) {
    throw new FlowUserError("The overview does not match the expected sections.", [
      ...describeOverviewIssues(parsed.error),
    ]);
  }
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repoRoot, stderr: "ignore" });
  writeTicketOverview(repoRoot, ticketId, parsed.data, {
    commit: head.exitCode === 0 ? head.stdout.toString().trim() : undefined,
  });
  return { kind: "help", text: `Stored the overview for ${ticketId}.\n` };
}

/** Parse `flow skill ...` for bundled skill discovery commands. */
async function parseSkillCommand(tokens: string[]): Promise<HelpCommandInput> {
  const [subcommand, ...rest] = tokens;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return {
      kind: "help",
      text: renderSkillHelp(),
    };
  }

  if (subcommand !== "path" && subcommand !== "show") {
    throw new Error("Only `flow skill path` and `flow skill show` are supported.");
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    return {
      kind: "help",
      text: renderSkillHelp(),
    };
  }

  const [name = "flow-comments-fix", ...extra] = rest;
  if (extra.length > 0) {
    throw new Error(`\`flow skill ${subcommand}\` takes at most one skill name.`);
  }
  const skill = BUNDLED_SKILLS.find((candidate) => candidate === name);
  if (!skill) {
    throw new FlowUserError(`Unknown skill \`${name}\`. Use one of: ${BUNDLED_SKILLS.join(", ")}.`);
  }

  return {
    kind: "help",
    text: subcommand === "show" ? renderBundledSkill(skill) : `${resolveBundledSkillPath(skill)}\n`,
  };
}

/** Build the `flow setup` help text. */
function renderSetupHelp() {
  return [
    "Usage: flow setup [--dry-run] [--uninstall]",
    "",
    "Set flow up, or refresh it after a `git pull`; it only touches what is missing or changed:",
    "  - flow's own dependencies (`bun install` in this checkout)",
    "  - a stub per bundled skill in ~/.claude/skills (they print the real text with `flow skill show`)",
    "  - a SessionStart hook in ~/.claude/settings.json that arms `flow watch` in each repository",
    "It first checks what flow needs (glab logged in, a YouTrack token, and the YouTrack, Notion,",
    "and Slack connectors) and offers to fix each missing one, showing the command and asking first.",
    "",
    "  --dry-run     show what would change without writing anything",
    "  --uninstall   remove flow's skills and hook",
    "",
    "Uses $CLAUDE_CONFIG_DIR instead of ~/.claude when set.",
    "",
  ].join("\n");
}

/** Show a path with the home directory as `~`. */
function displayPath(path: string) {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * Find the installed `flow` command that stubs and the hook should call. Another tool named `flow`
 * (such as the JavaScript type checker) may be on PATH, so a candidate only counts when it knows
 * flow's skills.
 */
function resolveInstalledFlowBin() {
  const candidates = [Bun.which("flow"), join(homedir(), ".local", "bin", "flow")];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) {
      continue;
    }
    const probe = Bun.spawnSync([candidate, "skill", "path", "flow-comments-fix"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    if (probe.exitCode === 0 && probe.stdout.toString().includes("flow-comments-fix")) {
      return candidate;
    }
  }
  throw new FlowUserError("This flow is not installed on your PATH yet.", [
    "Run `bun run install:bin` in this checkout first, then `flow setup`.",
  ]);
}

/**
 * Remember the YouTrack URL for `flow init` when Claude's YouTrack MCP already has it, as on a
 * machine set up before. `claude mcp get` also prints the token, so only the URL line is read.
 */
async function rememberYouTrackUrlFromMcp() {
  const { readUserDefaults, saveUserYouTrackUrl } = await import("./userDefaults");
  if (readUserDefaults().youtrackUrl) {
    return undefined;
  }
  const url = readYouTrackMcpUrl();
  if (url) {
    saveUserYouTrackUrl(url);
  }
  return url;
}

/** The instance Claude's YouTrack MCP points at, reading only the URL line (the rest has the token). */
function readYouTrackMcpUrl() {
  const result = Bun.spawnSync(["claude", "mcp", "get", "youtrack"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const url = /^\s*URL:\s*(https:\/\/\S+?)\/mcp\/?\s*$/m.exec(result.stdout.toString())?.[1];
  return result.exitCode === 0 ? url : undefined;
}

/** Ask, run, and print in the user's terminal for setup's remedies. */
async function createTerminalRemedyIo(): Promise<import("./setupRemedies").RemedyIo> {
  const [readline, { checkYouTrackAccess, readYouTrackToken }, userDefaults] = await Promise.all([
    import("node:readline/promises"),
    import("./youtrack"),
    import("./userDefaults"),
  ]);
  // A prompt per question, closed right after, so commands that read the terminal get it to
  // themselves (glab and security ask their own questions).
  const question = async (text: string) => {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await prompt.question(text)).trim();
    } finally {
      prompt.close();
    }
  };
  return {
    say: (line) => process.stdout.write(`${line}\n`),
    confirm: async (text) => /^y(es)?$/i.test(await question(`${text} [y/N] `)),
    youTrackUrl: async () => {
      const remembered = userDefaults.readUserDefaults().youtrackUrl;
      if (remembered) {
        process.stdout.write(`  YouTrack: ${remembered} (remembered in your flow config)\n`);
        return remembered;
      }
      // A YouTrack MCP the user set up already says which instance is theirs.
      const fromMcp = await rememberYouTrackUrlFromMcp();
      if (fromMcp) {
        process.stdout.write(`  YouTrack: ${fromMcp} (from your Claude YouTrack MCP)\n`);
        return fromMcp;
      }
      for (;;) {
        const answer = (
          await question("  YouTrack URL, like https://youtrack.example.com (empty to stop): ")
        ).replace(/\/+$/, "");
        if (!answer) {
          return undefined;
        }
        if (answer.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)/.test(answer)) {
          userDefaults.saveUserYouTrackUrl(answer);
          return answer;
        }
        process.stdout.write("  Use the https:// address you open YouTrack at.\n");
      }
    },
    openUrl: (url) => {
      Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
        stdout: "ignore",
        stderr: "ignore",
      });
    },
    waitForRecheck: async () =>
      (await question("  Press Enter to check again, or q to stop: ")).toLowerCase() !== "q",
    runInteractive: async (command) => {
      const proc = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      return proc.exited;
    },
    checkYouTrack: (url) => checkYouTrackAccess({ url }),
    hasYouTrackMcpEntry: async () =>
      Bun.spawnSync(["claude", "mcp", "get", "youtrack"], { stdout: "ignore", stderr: "ignore" })
        .exitCode === 0,
    addYouTrackMcp: async (url, replace) => {
      const token = readYouTrackToken(url);
      if (!token) {
        return { ok: false, output: "No YouTrack token is stored yet." };
      }
      if (replace) {
        Bun.spawnSync(["claude", "mcp", "remove", "youtrack", "-s", "user"], {
          stdout: "ignore",
          stderr: "ignore",
        });
      }
      const added = Bun.spawnSync(
        [
          "claude",
          "mcp",
          "add",
          "--transport",
          "http",
          "-s",
          "user",
          "youtrack",
          `${url}/mcp`,
          "--header",
          `Authorization: Bearer ${token}`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      // claude may echo the header back; the token never reaches the screen.
      const output =
        `${added.stdout.toString()}${added.stderr.toString()}`
          .replaceAll(token, "••••")
          .trim()
          .split("\n")[0] ?? "";
      return { ok: added.exitCode === 0, output };
    },
  };
}

/** Run `bun install` in the checkout flow runs from; a no-op when nothing changed. */
function installFlowDependencies() {
  const checkout = dirname(dirname(dirname(resolveBundledCommentsFixSkillPath())));
  if (!existsSync(join(checkout, ".git")) || !existsSync(join(checkout, "package.json"))) {
    return;
  }
  const result = Bun.spawnSync(["bun", "install"], {
    cwd: checkout,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new FlowUserError("`bun install` failed in flow's checkout.", [
      result.stderr.toString().trim(),
    ]);
  }
  process.stdout.write("✓ flow's dependencies are up to date\n");
}

/** Parse and run `flow setup`. */
async function parseSetupCommand(flags: string[]): Promise<HelpCommandInput> {
  if (flags.includes("--help") || flags.includes("-h")) {
    return { kind: "help", text: renderSetupHelp() };
  }
  const unknown = flags.filter((flag) => flag !== "--dry-run" && flag !== "--uninstall");
  if (unknown.length > 0) {
    throw new FlowUserError(`Unknown option \`${unknown[0]}\` for \`flow setup\`.`);
  }
  const dryRun = flags.includes("--dry-run");
  const uninstall = flags.includes("--uninstall");

  // After a `git pull`, new dependencies must land before anything else runs flow's code.
  if (!dryRun && !uninstall) {
    installFlowDependencies();
  }

  const [
    { applyClaudeSetup, resolveClaudeDir },
    { createSetupCheckDeps, runSetupChecks },
    { resolveMissingDependencies },
  ] = await Promise.all([
    import("./claudeSetup"),
    import("./setupChecks"),
    import("./setupRemedies"),
  ]);
  const claudeDir = resolveClaudeDir();
  const flowBin = resolveInstalledFlowBin();
  const install = (preview: boolean) =>
    applyClaudeSetup({
      claudeDir,
      flowBin,
      skills: BUNDLED_SKILLS.map((name) => ({
        name,
        markdown: readFileSync(resolveBundledSkillPath(name), "utf8"),
      })),
      dryRun: preview,
      uninstall,
    });
  const describeChanges = (heading: string, changes: ReturnType<typeof install>) => [
    `${heading} Claude Code in ${displayPath(claudeDir)} (flow: ${displayPath(flowBin)})`,
    ...changes.map(({ action, target: what }) => `  ${action.padEnd(10)} ${what}`),
  ];

  if (uninstall) {
    const lines = describeChanges(dryRun ? "Would remove from" : "Removed from", install(dryRun));
    return { kind: "help", text: `${lines.join("\n")}\n` };
  }

  // flow needs every dependency, so they are checked before anything is installed. In a terminal,
  // setup offers to fix each missing one, always showing what it would run and asking first.
  const checkDeps = createSetupCheckDeps();
  const runChecks = () => runSetupChecks(checkDeps);
  process.stdout.write("Checking what flow needs…\n");
  const checks =
    process.stdin.isTTY && !dryRun
      ? await resolveMissingDependencies(runChecks, await createTerminalRemedyIo())
      : await runChecks();
  const checkLines = [
    "Checks",
    ...checks.map(
      (check) =>
        `  ${check.status === "ok" ? "✓" : "✗"} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
    ),
  ];
  const ready = checks.every((check) => check.status === "ok");
  if (ready && !dryRun) {
    await rememberYouTrackUrlFromMcp();
  }
  if (!ready && !dryRun) {
    throw new FlowUserError(
      "Setup stopped before installing anything: flow needs every item below.",
      [...checkLines, "", "Fix the ✗ items (or let setup do it) and run `flow setup` again."],
    );
  }

  const lines = [
    ...checkLines,
    "",
    ...describeChanges(dryRun ? "Would change" : "Set up", install(dryRun)),
  ];
  if (dryRun && !ready) {
    lines.push("", "Setup would stop here: fix the ✗ items first.");
  }
  if (!dryRun) {
    lines.push("", "Open a new Claude Code session to pick up the changes.");
  }
  return { kind: "help", text: `${lines.join("\n")}\n` };
}

/** Parse and run `flow init`, asking in the terminal for what the repository's config lacks. */
async function parseInitCommand(tokens: string[]): Promise<HelpCommandInput> {
  if (tokens.includes("--help") || tokens.includes("-h")) {
    return {
      kind: "help",
      text: [
        "Usage: flow init",
        "",
        "Connect this repository to flow: ask for your YouTrack URL and merged state, your squad's",
        "GitLab review label, and its Slack review channel, check them, write .flow/config.toml",
        "with a comment on every option, and add .flow/ to .git/info/exclude.",
        "",
        "Only missing sections are asked for, so it is safe to run again.",
        "",
      ].join("\n"),
    };
  }
  if (tokens.length > 0) {
    throw new FlowUserError("`flow init` takes no arguments.");
  }
  if (!process.stdin.isTTY) {
    throw new FlowUserError("`flow init` asks questions, so run it in a terminal.");
  }
  const [
    { runRepoInit },
    { checkYouTrackAccess, isYouTrackProject, isYouTrackState },
    { findRepoRoot },
    readline,
    { readUserDefaults },
  ] = await Promise.all([
    import("./repoInit"),
    import("./youtrack"),
    import("./config"),
    import("node:readline/promises"),
    import("./userDefaults"),
  ]);
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new FlowUserError("Not inside a git repository.", [
      "Run `flow init` from the repository you want to connect.",
    ]);
  }

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    await runRepoInit(repoRoot, {
      ask: async (question, defaultValue) => {
        const answer = await prompt.question(
          `${question}${defaultValue ? ` [${defaultValue}]` : ""}: `,
        );
        return answer.trim() || defaultValue || "";
      },
      say: (line) => process.stdout.write(`${line}\n`),
      checkYouTrack: (url) => checkYouTrackAccess({ url }),
      defaultYouTrackUrl: readUserDefaults().youtrackUrl,
      isYouTrackState: (url, state) => isYouTrackState(state, { url }),
      isYouTrackProject: (url, projectKey) => isYouTrackProject(projectKey, { url }),
      hasGitLabLabel: async (label) => {
        const result = Bun.spawnSync(
          ["glab", "api", `projects/:id/labels?search=${encodeURIComponent(label)}&per_page=100`],
          { cwd: repoRoot, stdout: "pipe", stderr: "ignore" },
        );
        if (result.exitCode !== 0) {
          return undefined;
        }
        try {
          const labels: unknown = JSON.parse(result.stdout.toString());
          return Array.isArray(labels)
            ? labels.some(
                (entry) =>
                  typeof entry === "object" &&
                  entry !== null &&
                  "name" in entry &&
                  entry.name === label,
              )
            : undefined;
        } catch {
          return undefined;
        }
      },
      git: (args) => {
        const result = Bun.spawnSync(["git", ...args], {
          cwd: repoRoot,
          stdout: "pipe",
          stderr: "ignore",
        });
        return { exitCode: result.exitCode, stdout: result.stdout.toString() };
      },
    });
  } finally {
    prompt.close();
  }
  return { kind: "help", text: "" };
}

/** Parse and run `flow hook session-start --bin <flow>`, the SessionStart hook setup installs. */
async function parseHookCommand(tokens: string[]): Promise<HelpCommandInput> {
  const [event, ...rest] = tokens;
  if (event !== "session-start") {
    throw new FlowUserError("Only `flow hook session-start` exists; `flow setup` installs it.");
  }
  const binIndex = rest.indexOf("--bin");
  const flowBin = binIndex >= 0 ? rest[binIndex + 1] : undefined;
  if (!flowBin) {
    throw new FlowUserError("`flow hook session-start` needs `--bin <path to flow>`.");
  }
  const [{ renderSessionStartOutput }, { findRepoRoot }] = await Promise.all([
    import("./claudeSetup"),
    import("./config"),
  ]);
  // Outside a git repository there is nothing to watch, so the hook says nothing.
  const repoRoot = findRepoRoot(process.cwd());
  return { kind: "help", text: repoRoot ? renderSessionStartOutput(repoRoot, flowBin) : "" };
}

/** Parse `flow stash show ...` for stash entry review. */
async function parseStashCommand(tokens: string[], argv: string[]): Promise<ParsedCliInput> {
  const [subcommand, ...rest] = tokens;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    return {
      kind: "help",
      text:
        [
          "Usage: flow stash show [ref] [options]",
          "",
          "Review a stash entry as a full flow changeset.",
          "",
          "Examples:",
          "  flow stash show",
          "  flow stash show stash@{1}",
        ].join("\n") + "\n",
    };
  }

  if (subcommand !== "show") {
    throw new Error("Only `flow stash show` is supported.");
  }

  const command = applyWatchOption(
    createCommand("stash show", "review a stash entry as a full flow changeset"),
  ).argument("[ref]");

  let parsedRef: string | undefined;
  let parsedOptions: Record<string, unknown> = {};

  command.action((ref: string | undefined, options: Record<string, unknown>) => {
    parsedRef = ref;
    parsedOptions = options;
  });

  if (rest.includes("--help") || rest.includes("-h")) {
    return { kind: "help", text: `${command.helpInformation().trimEnd()}\n` };
  }

  await parseStandaloneCommand(command, rest);

  return {
    kind: "stash-show",
    ref: parsedRef,
    options: buildCommonOptions(parsedOptions, argv),
  };
}

/** Parse CLI arguments into one normalized input shape for the app loader layer. */
export async function parseCli(argv: string[]): Promise<ParsedCliInput> {
  const args = argv.slice(2);
  const [commandName, ...rest] = args;

  // Plain `flow` in a repository, at a terminal, opens the workspace; anywhere else it explains itself.
  if (!commandName && process.stdin.isTTY && process.stdout.isTTY) {
    const { findRepoRoot } = await import("./config");
    if (findRepoRoot(process.cwd())) {
      return parseDiffCommand([], argv);
    }
  }
  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    return { kind: "help", text: renderCliHelp() };
  }

  if (commandName === "--version" || commandName === "-v" || commandName === "version") {
    return { kind: "help", text: renderCliVersion() };
  }

  switch (commandName) {
    case "diff":
      return parseDiffCommand(rest, argv);
    case "show":
      return parseShowCommand(rest, argv);
    case "patch":
      return parsePatchCommand(rest, argv);
    case "pager":
      return parsePagerCommand(rest, argv);
    case "difftool":
      return parseDifftoolCommand(rest, argv);
    case "stash":
      return parseStashCommand(rest, argv);
    case "skill":
      return parseSkillCommand(rest);
    case "comments":
      return parseCommentsCommand(rest);
    case "focus":
      return parseFocusCommand(rest);
    case "overview":
      return parseOverviewCommand(rest);
    case "setup":
      return parseSetupCommand(rest);
    case "init":
      return parseInitCommand(rest);
    case "hook":
      return parseHookCommand(rest);
    case "watch":
      if (rest.length > 0) {
        throw new FlowUserError("`flow watch` does not accept arguments.");
      }
      return { kind: "agent-watch" };
    default:
      throw new Error(`Unknown command: ${commandName}`);
  }
}
