/**
 * Requests flow leaves for the coding agent in the user's own Claude terminal. The agent's
 * watcher picks them up from `.flow/requests.json`; flow never talks to the agent directly.
 *
 * Independent requests remain queued until the agent explicitly acknowledges them.
 */
import { enqueueAgentRequest, type AgentRequest } from "./agentRequestStore";
export type { AgentRequest, AgentRequestType } from "./agentRequestStore";

/**
 * What flow asks the agent for: a ticket's context, a review of its code against the ticket,
 * commits for the uncommitted work, or the branch's merge request.
 */

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
  return enqueueAgentRequest(repoRoot, body, now);
}
