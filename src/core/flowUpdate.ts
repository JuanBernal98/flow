/**
 * `flow update`: bring the flow checkout this command runs from up to date, then refresh Claude
 * Code. `./install.sh` is the one-time bootstrap; this is everything after it.
 *
 * It only fast-forwards: uncommitted changes in the checkout, a branch without an upstream, or a
 * diverged branch stop it with an explanation instead of a merge.
 */
export interface FlowUpdateDeps {
  /** The flow checkout's root. */
  checkout: string;
  /** Run git in the checkout, quietly. */
  git: (args: string[]) => { exitCode: number; stdout: string };
  /** Run a command in the user's terminal, output included; returns its exit code. */
  runInteractive: (command: string[], cwd: string) => Promise<number>;
  say: (line: string) => void;
}

/** Update the checkout and refresh Claude Code; returns false when it stopped early. */
export async function runFlowUpdate({ checkout, git, runInteractive, say }: FlowUpdateDeps) {
  if (git(["rev-parse", "--is-inside-work-tree"]).exitCode !== 0) {
    say(`flow at ${checkout} is not a git checkout, so there is nothing to pull.`);
    return false;
  }
  const dirty = git(["status", "--porcelain"]).stdout.trim();
  if (dirty) {
    say(`Your flow checkout (${checkout}) has uncommitted changes; commit or stash them first:`);
    say(dirty);
    return false;
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.exitCode !== 0) {
    say(`The branch ${branch} of your flow checkout has no upstream to pull from.`);
    return false;
  }

  say(`→ Checking ${upstream.stdout.trim()} for a newer flow`);
  if (git(["fetch", "--quiet"]).exitCode !== 0) {
    say("Could not reach the remote; check your connection and try again.");
    return false;
  }
  const behind = Number(git(["rev-list", "--count", "HEAD..@{u}"]).stdout.trim()) || 0;
  const ahead = Number(git(["rev-list", "--count", "@{u}..HEAD"]).stdout.trim()) || 0;
  if (behind > 0 && ahead > 0) {
    say(
      `Your ${branch} has ${ahead} commits the remote lacks; update it by hand (rebase or merge).`,
    );
    return false;
  }

  if (behind === 0) {
    say("  Already up to date.");
  } else {
    say(`  ${behind} new commit${behind === 1 ? "" : "s"}:`);
    say(git(["log", "--oneline", "--no-decorate", "-n", "10", "HEAD..@{u}"]).stdout.trimEnd());
    say("\n→ git pull --ff-only");
    if ((await runInteractive(["git", "pull", "--ff-only"], checkout)) !== 0) {
      return false;
    }
    say("\n→ bun install");
    if ((await runInteractive(["bun", "install"], checkout)) !== 0) {
      return false;
    }
  }

  // A fresh process, so setup runs the code just pulled rather than the one already loaded.
  say("\n→ flow setup claude");
  const setup = await runInteractive(
    ["bun", "run", "src/main.tsx", "--", "setup", "claude"],
    checkout,
  );
  return setup === 0;
}
