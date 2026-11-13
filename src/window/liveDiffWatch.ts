import { watch, statSync, readFileSync, type FSWatcher } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readCommentBranch } from "../core/commentBranch";

/** Run a read-only Git query without blocking the desktop server or taking optional index locks. */
async function readWatchGit(repoRoot: string, args: string[], input?: string) {
  const child = Bun.spawn(["git", ...args], {
    cwd: repoRoot,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "ignore",
  });
  const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (exit > 1) throw new Error(`Git could not refresh the repository watch (${args[0]}).`);
  return output;
}

/** Watch relevant directories and Git metadata; ignored dependency trees never need recursive watches. */
export function createLiveDiffWatch(repoRoot: string) {
  const listeners = new Set<(revision: number) => void>();
  const watchers = new Map<string, FSWatcher>();
  const paths = new Set<string>();
  const extraDirectories = new Set<string>();
  let revision = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let starting: Promise<void> | undefined;
  let gitChanged = false;
  let busy = false;
  let gitDirectories = new Set<string>();

  /** Coalesce editor saves and Git's atomic renames into one refresh. */
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, 180);
  }

  /** Keep one native watch per relevant directory, including folders created after startup. */
  function addDirectory(path: string) {
    if (watchers.has(path)) return;
    try {
      const watcher = watch(path, (event, filename) => {
        if (!listeners.size) return;
        const name = filename?.toString();
        if (gitDirectories.has(path)) {
          if (
            !name ||
            ["HEAD", "index", "packed-refs", "shallow"].includes(name) ||
            path.includes(`${sep}refs${sep}`) ||
            path.endsWith(`${sep}heads`)
          )
            gitChanged = true;
          else return;
        } else {
          if (name === ".flow" || name === ".git") return;
          paths.add(
            relative(repoRoot, name ? join(path, name) : path)
              .split(sep)
              .join("/"),
          );
        }
        if (event === "rename") starting = undefined;
        schedule();
      });
      watcher.on("error", () => {
        watcher.close();
        watchers.delete(path);
        gitChanged = true;
        starting = undefined;
        schedule();
      });
      watchers.set(path, watcher);
    } catch {
      /* Deleted directories are removed by the next watch refresh. */
    }
  }

  /** Discover tracked and non-ignored directories instead of observing dependency and build trees. */
  async function updateDirectories(current: number) {
    const [listing, gitPath] = await Promise.all([
      readWatchGit(repoRoot, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]),
      readWatchGit(repoRoot, ["rev-parse", "--absolute-git-dir"]),
    ]);
    if (generation !== current || !listeners.size) return;
    const gitDir = gitPath.trim();
    let commonDir = gitDir;
    try {
      commonDir = resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim());
    } catch {
      /* Ordinary repositories keep refs in their own Git directory. */
    }
    const branch = readCommentBranch(repoRoot);
    gitDirectories = new Set([gitDir, commonDir, join(commonDir, "refs", "heads")]);
    if (branch && !branch.startsWith("detached:"))
      gitDirectories.add(dirname(join(commonDir, "refs", "heads", branch)));
    for (const directory of extraDirectories) {
      try {
        if (!statSync(directory).isDirectory()) extraDirectories.delete(directory);
      } catch {
        extraDirectories.delete(directory);
      }
    }
    const directories = new Set([repoRoot, ...extraDirectories, ...gitDirectories]);
    for (const file of listing.split("\0").filter(Boolean)) {
      let directory = dirname(join(repoRoot, file));
      while (
        directory !== repoRoot &&
        relative(repoRoot, directory) &&
        !relative(repoRoot, directory).startsWith("..")
      ) {
        directories.add(directory);
        directory = dirname(directory);
      }
    }
    for (const [path, watcher] of watchers)
      if (!directories.has(path)) {
        watcher.close();
        watchers.delete(path);
      }
    for (const directory of directories) addDirectory(directory);
  }

  /** Ignore generated changes before notifying the browser; never recalculate the full diff here. */
  async function flush() {
    if (!listeners.size) return;
    if (busy) {
      schedule();
      return;
    }
    const current = generation;
    busy = true;
    const changed = [...paths];
    paths.clear();
    const metadataChanged = gitChanged;
    gitChanged = false;
    try {
      const ignored = changed.length
        ? new Set(
            (
              await readWatchGit(
                repoRoot,
                ["check-ignore", "--stdin", "-z"],
                `${changed.join("\0")}\0`,
              )
            )
              .split("\0")
              .filter(Boolean),
          )
        : new Set<string>();
      const relevant = changed.filter((path) => !ignored.has(path));
      for (const path of relevant) {
        try {
          if (statSync(join(repoRoot, path)).isDirectory())
            extraDirectories.add(join(repoRoot, path));
        } catch {
          /* A rename may already have removed this path. */
        }
      }
      if (metadataChanged) starting = undefined;
      if (!starting) starting = updateDirectories(current);
      await starting;
      if (current === generation && listeners.size && (metadataChanged || relevant.length)) {
        revision++;
        for (const listener of listeners) listener(revision);
      }
    } catch {
      // A broken or removed repository must not turn filesystem observation into Git polling.
      starting = undefined;
    } finally {
      if (current === generation) busy = false;
    }
  }

  /** Release every watch as soon as the last window disconnects. */
  function stop() {
    generation++;
    clearTimeout(timer);
    timer = undefined;
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    paths.clear();
    extraDirectories.clear();
    gitDirectories.clear();
    starting = undefined;
    gitChanged = false;
    busy = false;
  }

  return {
    subscribe(listener: (revision: number) => void) {
      listeners.add(listener);
      starting ??= updateDirectories(generation);
      return {
        ready: starting,
        unsubscribe: () => {
          listeners.delete(listener);
          if (!listeners.size) stop();
        },
      };
    },
    close() {
      listeners.clear();
      stop();
    },
    get revision() {
      return revision;
    },
  };
}
