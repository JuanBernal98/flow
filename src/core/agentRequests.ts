/**
 * Requests flow leaves for the coding agent in the user's own Claude terminal. The agent's
 * watcher picks them up from `.flow/requests.json`; flow never talks to the agent directly.
 *
 * Only the newest request is kept: when tickets change quickly, context for a ticket you already
 * left is useless, so each write replaces the previous one.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FLOW_DIR, FLOW_REQUESTS_FILENAME } from "./flowPaths";

/**
 * What flow asks the agent for: a ticket's context, a review of its code against the ticket,
 * commits for the uncommitted work, or the branch's merge request.
 */
export type AgentRequestType = "ticket-context" | "review" | "commit" | "mr-open";

export interface AgentRequest {
  /** Unique per write, so the watcher can tell a repeat switch from one it already handled. */
  id: string;
  type: AgentRequestType;
  /** The ticket it is about; commits and MRs on a branch without a ticket carry none. */
  ticket?: string;
  /** Merge request a review reads; absent for context, or for a branch that has no MR yet. */
  mergeRequest?: number;
  /** Desktop commit flow: correlate the proposal and its explicit approval. */
  proposalId?: string;
  phase?: "propose" | "execute";
  createdAt: string;
}

/** Ask the agent to load a ticket's context, replacing any earlier request. */
export function writeTicketContextRequest(repoRoot: string, ticketId: string, now = new Date()) {
  return writeAgentRequest(repoRoot, { type: "ticket-context", ticket: ticketId }, now);
}

/** Ask the agent to review a ticket's code (its MR, else its branch) against the ticket. */
export function writeReviewRequest(
  repoRoot: string,
  ticketId: string,
  mergeRequestIid: number | undefined,
  now = new Date(),
) {
  return writeAgentRequest(
    repoRoot,
    { type: "review", ticket: ticketId, mergeRequest: mergeRequestIid },
    now,
  );
}

/** Ask the agent to propose and make the commits for the checked-out branch's uncommitted work. */
export function writeCommitRequest(
  repoRoot: string,
  ticketId: string | undefined,
  now = new Date(),
) {
  return writeAgentRequest(repoRoot, { type: "commit", ticket: ticketId }, now);
}

/** Ask the same commit skill to prepare or execute a desktop proposal. */
export function writeCommitProposalRequest(
  repoRoot: string,
  proposalId: string,
  phase: "propose" | "execute",
  ticket?: string,
) {
  return writeAgentRequest(repoRoot, { type: "commit", proposalId, phase, ticket }, new Date());
}

/** Ask the agent to open the checked-out branch's merge request. */
export function writeMergeRequestOpenRequest(
  repoRoot: string,
  ticketId: string | undefined,
  now = new Date(),
) {
  return writeAgentRequest(repoRoot, { type: "mr-open", ticket: ticketId }, now);
}

/** Replace `.flow/requests.json` with one fresh request. */
function writeAgentRequest(
  repoRoot: string,
  body: Pick<AgentRequest, "type" | "ticket" | "mergeRequest" | "proposalId" | "phase">,
  now: Date,
) {
  const dir = join(repoRoot, FLOW_DIR);
  mkdirSync(dir, { recursive: true });
  const request: AgentRequest = {
    id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...body,
    createdAt: now.toISOString(),
  };
  // Same-directory temp file plus rename, so the watcher never reads a half-written request.
  const tempPath = join(dir, `.${FLOW_REQUESTS_FILENAME}.${process.pid}.${request.id}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify({ schema: 1, request }, null, 2)}\n`, "utf8");
  renameSync(tempPath, join(dir, FLOW_REQUESTS_FILENAME));
  return request;
}
