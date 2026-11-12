import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FLOW_CONFIG_RELATIVE_PATH } from "./flowPaths";
import { resolveGlobalConfigPath } from "./paths";
import type { CliInput, CommonOptions, LayoutMode, PersistedViewPreferences } from "./types";

export const DEFAULT_VIEW_PREFERENCES: PersistedViewPreferences = {
  mode: "stack",
  // Line numbers sit in the margin left of each file card and carry the active-hunk emphasis.
  showLineNumbers: true,
  wrapLines: true,
  // Hunk ranges are metadata; file cards separate hunks visually, so `m` shows them on demand.
  showHunkHeaders: false,
  // The file tree and the ticket Overview frame the review from the start.
  showFileTree: true,
  showOverview: true,
  selectionAutoCopy: true,
};

interface ConfigResolutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

interface FlowConfigResolution {
  input: CliInput;
  globalConfigPath?: string;
  repoConfigPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accept only the layout names flow already supports. */
function normalizeLayoutMode(value: unknown): LayoutMode | undefined {
  return value === "auto" || value === "split" || value === "stack" ? value : undefined;
}

/** Accept only plain booleans from config files. */
function normalizeBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

/** Accept only plain strings from config files. */
function normalizeString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Read the view preferences stored at one TOML object level. */
function readConfigPreferences(source: Record<string, unknown>): CommonOptions {
  const branchReviewSection = source.branch_review;
  const branchReviewBase = isRecord(branchReviewSection)
    ? normalizeString(branchReviewSection.base)
    : undefined;

  return {
    mode: normalizeLayoutMode(source.mode),
    theme: normalizeString(source.theme),
    watch: normalizeBoolean(source.watch),
    excludeUntracked: normalizeBoolean(source.exclude_untracked),
    lineNumbers: normalizeBoolean(source.line_numbers),
    wrapLines: normalizeBoolean(source.wrap_lines),
    hunkHeaders: normalizeBoolean(source.hunk_headers),
    fileTree: normalizeBoolean(source.file_tree),
    overview: normalizeBoolean(source.overview),
    selectionAutoCopy: normalizeBoolean(source.selection_auto_copy),
    branchReviewBase,
  };
}

/** Merge partial preference layers with right-hand overrides taking precedence. */
function mergeOptions(base: CommonOptions, overrides: CommonOptions): CommonOptions {
  return {
    ...base,
    mode: overrides.mode ?? base.mode,
    theme: overrides.theme ?? base.theme,
    pager: overrides.pager ?? base.pager,
    watch: overrides.watch ?? base.watch,
    excludeUntracked: overrides.excludeUntracked ?? base.excludeUntracked,
    lineNumbers: overrides.lineNumbers ?? base.lineNumbers,
    wrapLines: overrides.wrapLines ?? base.wrapLines,
    hunkHeaders: overrides.hunkHeaders ?? base.hunkHeaders,
    fileTree: overrides.fileTree ?? base.fileTree,
    overview: overrides.overview ?? base.overview,
    selectionAutoCopy: overrides.selectionAutoCopy ?? base.selectionAutoCopy,
    branchReviewBase: overrides.branchReviewBase ?? base.branchReviewBase,
  };
}

/** Apply one parsed config object, including command/pager sections, to the current invocation. */
function resolveConfigLayer(source: Record<string, unknown>, input: CliInput): CommonOptions {
  let resolved = readConfigPreferences(source);

  const commandSection = source[input.kind];
  if (isRecord(commandSection)) {
    resolved = mergeOptions(resolved, readConfigPreferences(commandSection));
  }

  const pagerSection = source.pager;
  if (input.options.pager && isRecord(pagerSection)) {
    resolved = mergeOptions(resolved, readConfigPreferences(pagerSection));
  }

  return resolved;
}

/** Return the first parent that looks like a repository root. */
export function findRepoRoot(cwd = process.cwd()) {
  let current = resolve(cwd);

  for (;;) {
    if (fs.existsSync(join(current, ".git"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

/** Parse one TOML config file into a plain object. */
function readTomlRecord(path: string) {
  if (!fs.existsSync(path)) {
    return {};
  }

  const parsed = Bun.TOML.parse(fs.readFileSync(path, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`Expected ${path} to contain a TOML object.`);
  }

  return parsed;
}

/** Resolve CLI input against global and repo-local config files. */
export function resolveConfiguredCliInput(
  input: CliInput,
  { cwd = process.cwd(), env = process.env }: ConfigResolutionOptions = {},
): FlowConfigResolution {
  const repoRoot = findRepoRoot(cwd);
  const repoConfigPath = repoRoot ? join(repoRoot, FLOW_CONFIG_RELATIVE_PATH) : undefined;
  const userConfigPath = resolveGlobalConfigPath(env);

  let resolvedOptions: CommonOptions = {
    mode: DEFAULT_VIEW_PREFERENCES.mode,
    // Keep the built-in theme default explicit so stdin-backed startup paths do not depend on
    // renderer theme-mode detection for their initial palette.
    theme: "zed",
    pager: input.options.pager ?? false,
    // Reviews follow the code by default; `--no-watch` or `watch = false` keeps them still.
    watch: input.options.watch ?? true,
    excludeUntracked: false,
    lineNumbers: DEFAULT_VIEW_PREFERENCES.showLineNumbers,
    wrapLines: DEFAULT_VIEW_PREFERENCES.wrapLines,
    hunkHeaders: DEFAULT_VIEW_PREFERENCES.showHunkHeaders,
    fileTree: DEFAULT_VIEW_PREFERENCES.showFileTree,
    overview: DEFAULT_VIEW_PREFERENCES.showOverview,
    selectionAutoCopy: DEFAULT_VIEW_PREFERENCES.selectionAutoCopy,
  };

  if (userConfigPath) {
    resolvedOptions = mergeOptions(
      resolvedOptions,
      resolveConfigLayer(readTomlRecord(userConfigPath), input),
    );
  }

  if (repoConfigPath) {
    resolvedOptions = mergeOptions(
      resolvedOptions,
      resolveConfigLayer(readTomlRecord(repoConfigPath), input),
    );
  }

  resolvedOptions = mergeOptions(resolvedOptions, input.options);
  resolvedOptions = {
    ...resolvedOptions,
    // Per-invocation flags always win — they come from CLI args, not config layers.
    pager: input.options.pager ?? false,
    watch: input.options.watch ?? resolvedOptions.watch ?? true,
    excludeUntracked: resolvedOptions.excludeUntracked ?? false,
  };

  return {
    input: {
      ...input,
      options: resolvedOptions,
    },
    globalConfigPath: userConfigPath,
    repoConfigPath,
  };
}
