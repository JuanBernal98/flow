/**
 * Line totals for each ticket's branch, measured against where it forked from the ticket base.
 * The checked-out ticket also counts uncommitted edits, matching what `diff --branch` shows.
 */
import { belongsToTicket, findTicketBranch, NEW_TICKET_BASE, type GitRun } from "./ticketSwitch";

export interface LineStats {
  additions: number;
  deletions: number;
}

/** Read `git diff --shortstat` output; an empty diff reads as zero lines. */
export function parseShortstat(output: string): LineStats {
  return {
    additions: Number(/(\d+) insertions?\(\+\)/.exec(output)?.[1] ?? 0),
    deletions: Number(/(\d+) deletions?\(-\)/.exec(output)?.[1] ?? 0),
  };
}

/** Total lines changed on one ticket's branch, or undefined when it has no single branch. */
async function loadTicketStats(
  git: GitRun,
  ticketId: string,
  currentBranch: string,
  preferredBranch: string | undefined,
): Promise<LineStats | undefined> {
  if (currentBranch && belongsToTicket(currentBranch, ticketId)) {
    const mergeBase = (await git(["merge-base", NEW_TICKET_BASE, "HEAD"])).stdout;
    if (!mergeBase) {
      return undefined;
    }
    // Working tree against the fork point: committed, staged, and unstaged edits together.
    const diff = await git(["diff", "--shortstat", mergeBase]);
    return diff.ok ? parseShortstat(diff.stdout) : undefined;
  }

  const branch = await findTicketBranch(git, ticketId, preferredBranch);
  if (branch.kind !== "found") {
    return undefined;
  }
  const ref = branch.location === "local" ? branch.name : `origin/${branch.name}`;
  const diff = await git(["diff", "--shortstat", `${NEW_TICKET_BASE}...${ref}`]);
  return diff.ok ? parseShortstat(diff.stdout) : undefined;
}

/**
 * Line totals per ticket id; tickets without a branch are simply absent. `preferredBranches` picks
 * which branch counts for a ticket split over several, as switching to it would.
 */
export async function loadTicketLineStats(
  git: GitRun,
  ticketIds: string[],
  preferredBranches: ReadonlyMap<string, string> = new Map(),
) {
  const currentBranch = (await git(["branch", "--show-current"])).stdout;
  const entries = await Promise.all(
    ticketIds.map(
      async (id) =>
        [id, await loadTicketStats(git, id, currentBranch, preferredBranches.get(id))] as const,
    ),
  );
  return new Map(
    entries.filter((entry): entry is readonly [string, LineStats] => entry[1] !== undefined),
  );
}
