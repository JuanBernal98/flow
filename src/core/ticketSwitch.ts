/**
 * Switch the repository to a ticket's branch, mirroring `/flow-ticket-switch`'s branch rules, and park
 * uncommitted work per branch so it comes back when you return to that ticket.
 *
 * Parked work is a regular `git stash` entry named `flow:<branch>`, so it stays visible and
 * recoverable with plain git even if flow is not around.
 */

import { GIT_ENV } from "./git";

/** Outcome of one git invocation; failures are values so callers decide what is fatal. */
export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type GitRun = (args: string[]) => Promise<GitRunResult>;

export type TicketSwitchResult =
  | {
      kind: "switched";
      branch: string;
      origin: "local" | "remote" | "created";
      /** Branch whose uncommitted work was stashed on the way out, if any. */
      stashedFrom?: string;
      /** Work stashed earlier for the target: `conflict` means applying it failed and it was kept. */
      restore: "none" | "restored" | "conflict";
      fetchFailed: boolean;
    }
  | { kind: "already-on"; branch: string }
  | { kind: "failed"; message: string };

// Same base `/flow-ticket-switch` branches new tickets from.
export const DEFAULT_TICKET_BASE = "origin/main";
const STASH_PREFIX = "flow:";

/** Build an async git runner bound to one repository. */
export function createGitRun(cwd: string): GitRun {
  return async (args) => {
    try {
      const proc = Bun.spawn(["git", ...args], {
        cwd,
        env: GIT_ENV,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      return {
        ok: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : "git failed",
      };
    }
  };
}

/**
 * Git config key holding the ref a branch is reviewed against. flow sets it when it checks out a
 * merge request, so `diff --branch` compares against the MR's target instead of origin/main.
 */
export function branchBaseConfigKey(branch: string) {
  return `branch.${branch}.flowBase`;
}

/** A branch belongs to a ticket when it is the id itself or starts with `<id>-`. */
export function belongsToTicket(branch: string, ticketId: string) {
  return branch === ticketId || branch.startsWith(`${ticketId}-`);
}

/** List branch names under one ref namespace that belong to the ticket, newest commit first. */
async function listTicketBranches(git: GitRun, ticketId: string, namespace: string) {
  const result = await git([
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname)",
    `${namespace}${ticketId}`,
    `${namespace}${ticketId}-*`,
  ]);
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((ref) => ref.slice(namespace.length));
}

/** Where a ticket's branch lives, following `/flow-ticket-switch`'s rules: local first, then origin. */
export type TicketBranch =
  | { kind: "none" }
  | { kind: "found"; name: string; location: "local" | "remote" };

/**
 * Find the branch to use for a ticket. A ticket split over several branches resolves to the
 * preferred one (the branch of the MR its card shows) when it exists, otherwise to the branch
 * with the newest commit, local branches before origin's.
 */
export async function findTicketBranch(
  git: GitRun,
  ticketId: string,
  preferredBranch?: string,
): Promise<TicketBranch> {
  const localBranches = await listTicketBranches(git, ticketId, "refs/heads/");
  if (preferredBranch && localBranches.includes(preferredBranch)) {
    return { kind: "found", name: preferredBranch, location: "local" };
  }
  const remoteBranches =
    preferredBranch || localBranches.length === 0
      ? await listTicketBranches(git, ticketId, "refs/remotes/origin/")
      : [];
  if (preferredBranch && remoteBranches.includes(preferredBranch)) {
    return { kind: "found", name: preferredBranch, location: "remote" };
  }
  const [newestLocal] = localBranches;
  if (newestLocal) {
    return { kind: "found", name: newestLocal, location: "local" };
  }
  const [newestRemote] = remoteBranches;
  return newestRemote
    ? { kind: "found", name: newestRemote, location: "remote" }
    : { kind: "none" };
}

const INDEX_LOCK_RETRIES = 3;
const INDEX_LOCK_RETRY_DELAY_MS = 200;

/**
 * Run a git command that writes the index, retrying briefly while another process (an editor, a
 * terminal, a status poll) holds `index.lock`. Such locks last milliseconds, so a short wait
 * usually clears them; any other failure returns at once.
 */
async function runRetryingIndexLock(git: GitRun, args: string[]) {
  let result = await git(args);
  for (let attempt = 1; attempt <= INDEX_LOCK_RETRIES && !result.ok; attempt += 1) {
    if (!/index\.lock|could not write index/i.test(result.stderr)) {
      break;
    }
    await Bun.sleep(INDEX_LOCK_RETRY_DELAY_MS);
    result = await git(args);
  }
  return result;
}

/** First line of git's complaint, which is the part worth showing in a status bar. */
function firstLine(text: string, fallback: string) {
  return text.split("\n").find((line) => line.trim().length > 0) ?? fallback;
}

/** Find the newest `flow:<branch>` stash entry, if any. */
async function findParkedStash(git: GitRun, branch: string) {
  const list = await git(["stash", "list", "--format=%gd%x09%gs"]);
  const suffix = `: ${STASH_PREFIX}${branch}`;
  for (const line of list.stdout.split("\n")) {
    const [ref, subject] = line.split("\t");
    if (ref && subject?.endsWith(suffix)) {
      return ref;
    }
  }
  return undefined;
}

/** The branch to land on and how to get there; resolved after the fetch so origin is fresh. */
type SwitchTarget =
  | { kind: "target"; branch: string; origin: "local" | "remote" | "created"; switchArgs: string[] }
  | { kind: "failed"; message: string };

/**
 * Switch branches without losing work. Uncommitted work is always stashed under the current
 * branch's name first, and work stashed earlier for the target branch is restored after the switch.
 */
async function switchParkingWork(
  git: GitRun,
  isCurrent: (branch: string) => boolean,
  resolveTarget: () => Promise<SwitchTarget>,
): Promise<TicketSwitchResult> {
  const current = (await git(["branch", "--show-current"])).stdout;
  if (current && isCurrent(current)) {
    return { kind: "already-on", branch: current };
  }
  // Includes untracked files, which `stash --include-untracked` parks along with edits.
  const dirty = (await git(["status", "--porcelain"])).stdout.length > 0;
  if (dirty && !current) {
    // A detached HEAD has no branch to name the stash after, so it could never come back.
    return { kind: "failed", message: "Detached HEAD with changes; commit or stash them first" };
  }
  const fetchFailed = !(await git(["fetch", "origin", "--prune"])).ok;

  const target = await resolveTarget();
  if (target.kind === "failed") {
    return target;
  }
  const { branch, origin, switchArgs } = target;

  const stashedFrom = dirty ? current : undefined;
  if (stashedFrom) {
    const stash = await git([
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `${STASH_PREFIX}${stashedFrom}`,
    ]);
    if (!stash.ok) {
      return { kind: "failed", message: firstLine(stash.stderr, "Could not stash changes") };
    }
  }

  const switched = await runRetryingIndexLock(git, switchArgs);
  if (!switched.ok) {
    // Put the tree back exactly as it was so a failed switch never strands stashed work.
    if (stashedFrom) {
      await git(["stash", "pop"]);
    }
    return { kind: "failed", message: firstLine(switched.stderr, `Could not switch to ${branch}`) };
  }

  // The tree is clean here: it was clean already, or its changes were just stashed.
  const parked = await findParkedStash(git, branch);
  let restore: "none" | "restored" | "conflict" = "none";
  if (parked) {
    restore = (await git(["stash", "apply", parked])).ok ? "restored" : "conflict";
    if (restore === "restored") {
      await git(["stash", "drop", parked]);
    }
  }

  return { kind: "switched", branch, origin, stashedFrom, restore, fetchFailed };
}

/**
 * Switch to the ticket's branch, creating it from origin/main when it has none yet. Already being
 * on any of the ticket's branches counts as done, so Enter never hops between them.
 */
export async function switchToTicket(
  git: GitRun,
  ticketId: string,
  preferredBranch?: string,
  base = DEFAULT_TICKET_BASE,
): Promise<TicketSwitchResult> {
  return switchParkingWork(
    git,
    (branch) => belongsToTicket(branch, ticketId),
    async () => {
      const ticketBranch = await findTicketBranch(git, ticketId, preferredBranch);
      if (ticketBranch.kind === "none") {
        return {
          kind: "target",
          branch: ticketId,
          origin: "created",
          switchArgs: ["switch", "--no-track", "-c", ticketId, base],
        };
      }
      const { name, location } = ticketBranch;
      return {
        kind: "target",
        branch: name,
        origin: location,
        switchArgs:
          location === "local" ? ["switch", name] : ["switch", "--track", `origin/${name}`],
      };
    },
  );
}

/**
 * Switch to someone else's merge request branch to review it locally. An existing local copy is
 * fast-forwarded to origin's tip so it shows the latest push, unless it holds commits of its own.
 * The MR's target is recorded as the branch's review base, also when already on it, since a
 * stacked MR is retargeted once the one below it merges.
 */
export async function switchToReviewBranch(
  git: GitRun,
  branch: string,
  targetBranch: string,
): Promise<TicketSwitchResult> {
  const result = await switchParkingWork(
    git,
    (current) => current === branch,
    async () => {
      const onOrigin = (await git(["rev-parse", "--verify", "--quiet", `origin/${branch}`])).ok;
      if (!onOrigin) {
        return { kind: "failed", message: `${branch} is not on origin` };
      }
      const local = (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
      const fastForwards =
        !local ||
        (await git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, `origin/${branch}`])).ok;
      return {
        kind: "target",
        branch,
        origin: local ? "local" : "remote",
        // `-C` (re)points the branch at origin's tip; only safe when that loses no local commits.
        switchArgs: fastForwards
          ? ["switch", "--track", "-C", branch, `origin/${branch}`]
          : ["switch", branch],
      };
    },
  );
  if (result.kind !== "failed") {
    await git(["config", branchBaseConfigKey(branch), `origin/${targetBranch}`]);
  }
  return result;
}

/** One status-bar line describing what happened. */
export function describeTicketSwitch(result: TicketSwitchResult) {
  if (result.kind === "failed") {
    return result.message;
  }
  if (result.kind === "already-on") {
    return `Already on ${result.branch}`;
  }
  const parts = [`On ${result.branch}`];
  if (result.origin === "created") parts.push("new branch");
  if (result.origin === "remote") parts.push("tracking origin");
  if (result.stashedFrom) parts.push(`${result.stashedFrom} changes stashed`);
  if (result.restore === "restored") parts.push("changes restored");
  if (result.restore === "conflict") parts.push("restore conflicted, stash kept");
  if (result.fetchFailed) parts.push("fetch failed");
  return parts.join(" · ");
}
