import fs from "node:fs";
import { dirname, join, resolve } from "node:path";

const COMMENTS_FIX_SKILL_RELATIVE_PATH = join("skills", "flow-comments-fix", "SKILL.md");

/** Resolve the base config directory flow should use for user-scoped files. */
function resolveUserConfigDir(env: NodeJS.ProcessEnv = process.env) {
  if (env.XDG_CONFIG_HOME) {
    return env.XDG_CONFIG_HOME;
  }

  if (env.HOME) {
    return join(env.HOME, ".config");
  }

  return undefined;
}

/** Resolve the global flow config file path from the current environment. */
export function resolveGlobalConfigPath(env: NodeJS.ProcessEnv = process.env) {
  const configDir = resolveUserConfigDir(env);
  return configDir ? join(configDir, "flow", "config.toml") : undefined;
}

/** Search one path and its parents for one relative child path. */
function findRelativePathFromAncestors(startPath: string, relativePath: string) {
  let current = resolve(startPath);

  try {
    if (fs.statSync(current).isFile()) {
      current = dirname(current);
    }
  } catch {
    // Treat non-existent paths as directories so ancestor walking still works in tests.
  }

  for (;;) {
    const candidate = join(current, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

/** Resolve the bundled comments skill path from source, npm, or prebuilt package layouts. */
export function resolveBundledCommentsFixSkillPath(searchRoots?: string[]) {
  const roots = searchRoots ?? [import.meta.dir, process.execPath];
  const relativeCandidates = [
    COMMENTS_FIX_SKILL_RELATIVE_PATH,
    join("flow", COMMENTS_FIX_SKILL_RELATIVE_PATH),
    join("node_modules", "flow", COMMENTS_FIX_SKILL_RELATIVE_PATH),
  ];

  for (const root of roots) {
    for (const relativePath of relativeCandidates) {
      const resolvedPath = findRelativePathFromAncestors(root, relativePath);
      if (resolvedPath) {
        return resolvedPath;
      }
    }
  }

  throw new Error("Could not locate the bundled flow-comments-fix skill.");
}
