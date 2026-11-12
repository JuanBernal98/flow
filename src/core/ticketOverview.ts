/**
 * Ticket overviews: what the coding agent understood about a ticket after loading its context,
 * written once per ticket to `.flow/overviews/<ID>.json` and shown in flow's Overview pane.
 *
 * Every overview has the same sections in the same order, so a reader always knows where to
 * look. Live facts (YouTrack state, branch, MR, line counts) are not stored here; flow adds them
 * when rendering, so an overview never goes stale on them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FLOW_DIR } from "./flowPaths";

const OVERVIEWS_DIRNAME = "overviews";
// Also guards the file name: an id can never climb out of the overviews directory.
const TICKET_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

const NonEmptyText = z.string().trim().min(1);
const Bullets = z.array(NonEmptyText);

/** The sections the agent writes, in display order. */
export const TicketOverviewSchema = z
  .object({
    /** One sentence: what has to be achieved, and for whom. */
    summary: NonEmptyText,
    /** What is wrong or missing today. */
    why: Bullets.min(1),
    /** Concrete requirements: the real scope. */
    todo: Bullets.min(1),
    /** Verifiable checks that say the ticket is done. */
    acceptance: Bullets.min(1),
    /** Where in the repo the work happens, one line each. */
    code: z.array(z.object({ path: NonEmptyText, note: NonEmptyText }).strict()),
    /** What the agent is unsure about, and what it assumed instead. */
    questions: Bullets,
    /** 3-5 steps, the first one concrete. */
    plan: Bullets.min(1),
  })
  .strict();

export type TicketOverview = z.infer<typeof TicketOverviewSchema>;

const OverviewFileSchema = z.object({
  schema: z.literal(1),
  ticket: z.string(),
  writtenAt: z.string(),
  /** HEAD when it was written, so flow can say how far the branch moved since. */
  commit: z.string().optional(),
  overview: TicketOverviewSchema,
});

export type StoredTicketOverview = z.infer<typeof OverviewFileSchema>;

/** Whether a string is a ticket id flow can store an overview for. */
export function isTicketId(value: string) {
  return TICKET_ID_PATTERN.test(value);
}

/** Path of one ticket's overview file. */
function overviewPath(repoRoot: string, ticketId: string) {
  return join(repoRoot, FLOW_DIR, OVERVIEWS_DIRNAME, `${ticketId}.json`);
}

/** Turn schema issues into lines an agent can act on, like `plan: Required`. */
export function describeOverviewIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/** Validate and store a ticket's overview, replacing any earlier one. */
export function writeTicketOverview(
  repoRoot: string,
  ticketId: string,
  overview: TicketOverview,
  { now = new Date(), commit }: { now?: Date; commit?: string } = {},
) {
  if (!isTicketId(ticketId)) {
    throw new Error(`Not a ticket id: ${ticketId}`);
  }
  const stored: StoredTicketOverview = {
    schema: 1,
    ticket: ticketId,
    writtenAt: now.toISOString(),
    ...(commit ? { commit } : {}),
    overview: TicketOverviewSchema.parse(overview),
  };
  const path = overviewPath(repoRoot, ticketId);
  const dir = join(repoRoot, FLOW_DIR, OVERVIEWS_DIRNAME);
  mkdirSync(dir, { recursive: true });
  // Same-directory temp file plus rename, so the pane never reads a half-written overview.
  const tempPath = join(dir, `.${ticketId}.${process.pid}.${now.getTime()}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
  return stored;
}

/** Read a ticket's overview, or null when it has none or the file is unreadable. */
export function readTicketOverview(
  repoRoot: string,
  ticketId: string,
): StoredTicketOverview | null {
  if (!isTicketId(ticketId)) {
    return null;
  }
  const path = overviewPath(repoRoot, ticketId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = OverviewFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
