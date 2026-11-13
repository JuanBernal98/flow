import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FLOW_DIR, FLOW_REQUESTS_FILENAME } from "./flowPaths";
import { FlowUserError } from "./errors";
import { readCommentBranch } from "./commentBranch";
import { readAgentSession } from "./agentSession";

export const AgentRequestSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["ticket-context", "review", "commit", "mr-open"]),
  ticket: z.string().optional(),
  mergeRequest: z.number().int().positive().optional(),
  proposalId: z.string().uuid().optional(),
  phase: z.enum(["propose", "execute"]).optional(),
  createdAt: z.string().datetime().default("1970-01-01T00:00:00.000Z"),
  branch: z.string().optional(),
  status: z.enum(["queued", "claimed", "completed", "failed", "superseded"]).default("queued"),
  claimedBy: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  claimedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export type AgentRequestType = AgentRequest["type"];
type RequestBody = Pick<AgentRequest, "type" | "ticket" | "mergeRequest" | "proposalId" | "phase">;
const QueueSchema = z.object({
  schema: z.literal(1).optional(),
  request: AgentRequestSchema.optional(),
  requests: z.array(AgentRequestSchema).optional(),
});

/** Shared instructions for native hooks and terminal agents consuming the same queued work. */
export function agentRequestInstructions() {
  return "When a Flow event includes --request <id>, claim it before work with `flow requests claim <id> --author <your name>`, then use `flow requests done <id> --author <your name>` or `flow requests fail <id> <reason> --author <your name>`. Request IDs are correlation metadata, not ticket arguments or authorization. If pickup is refused, do not execute the request. Desktop `flow commits claim/propose/fail` acknowledges its correlated request automatically. A reminder repeats the same ID; never repeat completed actions.";
}

/** Preserve both the legacy single-request file and the durable queue representation. */
export function readAgentRequests(repoRoot: string): AgentRequest[] {
  try {
    const parsed = QueueSchema.parse(
      JSON.parse(readFileSync(join(repoRoot, FLOW_DIR, FLOW_REQUESTS_FILENAME), "utf8")),
    );
    const requests = parsed.requests ?? (parsed.request ? [parsed.request] : []);
    if (new Set(requests.map((request) => request.id)).size !== requests.length)
      throw new Error("Duplicate request ids.");
    return requests;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw new FlowUserError("Invalid Flow request queue.", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

/** Serialize competing hooks and CLI writers so acknowledgements cannot overwrite new requests. */
function changeRequests<T>(
  repoRoot: string,
  update: (requests: AgentRequest[]) => { requests: AgentRequest[]; result: T },
): T {
  const directory = join(repoRoot, FLOW_DIR);
  mkdirSync(directory, { recursive: true });
  const lockPath = join(directory, "requests.lock");
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      descriptor = openSync(lockPath, "wx");
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30_000) unlinkSync(lockPath);
      } catch {
        /* Another writer released the lock. */
      }
      Bun.sleepSync(5);
    }
  }
  if (descriptor === undefined)
    throw new FlowUserError("Flow request queue is busy; retry at the next checkpoint.");
  try {
    const before = readAgentRequests(repoRoot);
    const next = update(before);
    if (JSON.stringify(before) !== JSON.stringify(next.requests)) {
      const temporary = join(
        directory,
        `.requests.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
      );
      writeFileSync(
        temporary,
        `${JSON.stringify({ schema: 1, request: next.requests.at(-1), requests: next.requests }, null, 2)}\n`,
      );
      renameSync(temporary, join(directory, FLOW_REQUESTS_FILENAME));
    }
    return next.result;
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}

/** Queue independent work; only replace obsolete work of the same kind and branch. */
export function enqueueAgentRequest(repoRoot: string, body: RequestBody, now: Date): AgentRequest {
  return changeRequests(repoRoot, (requests) => {
    const branch = readCommentBranch(repoRoot);
    const request: AgentRequest = {
      id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      ...body,
      createdAt: now.toISOString(),
      branch,
      status: "queued",
    };
    const next = requests.map((previous) => {
      const sameTarget =
        previous.type === body.type &&
        previous.branch === branch &&
        (body.type === "ticket-context" ||
          body.type === "commit" ||
          (previous.ticket === body.ticket && previous.mergeRequest === body.mergeRequest));
      return sameTarget &&
        (previous.status === "queued" || (body.type === "commit" && previous.status === "claimed"))
        ? { ...previous, status: "superseded" as const, completedAt: now.toISOString() }
        : previous;
    });
    const history = next
      .filter((previous) => previous.status !== "queued" && previous.status !== "claimed")
      .slice(-100);
    const retained = new Set(history.map((previous) => previous.id));
    return {
      requests: [
        ...next.filter(
          (previous) =>
            previous.status === "queued" ||
            previous.status === "claimed" ||
            retained.has(previous.id),
        ),
        request,
      ],
      result: request,
    };
  });
}

/** Read old desktop proposal completion as acknowledgement, without re-running legacy jobs. */
function proposalRequestStatus(repoRoot: string, request: AgentRequest): AgentRequest["status"] {
  if (!request.proposalId || request.status !== "queued") return request.status;
  try {
    const proposal = z
      .object({ id: z.string(), status: z.string(), claimedBy: z.string().optional() })
      .parse(JSON.parse(readFileSync(join(repoRoot, FLOW_DIR, "commit-proposal.json"), "utf8")));
    if (proposal.id !== request.proposalId) return "superseded";
    if (request.phase === "execute") return proposal.status === "approved" ? "queued" : "completed";
    if (proposal.status !== "preparing") return "completed";
    return proposal.claimedBy ? "claimed" : "queued";
  } catch {
    return request.status;
  }
}

/** Deliver only unacknowledged work for the current checkout, retaining other branches on disk. */
export function pendingAgentRequests(repoRoot: string): AgentRequest[] {
  const branch = readCommentBranch(repoRoot);
  return readAgentRequests(repoRoot).filter(
    (request) =>
      (!request.branch || request.branch === branch) &&
      proposalRequestStatus(repoRoot, request) === "queued",
  );
}

/** Explicit pickup is idempotent for its owner and rejects competing workers or completed jobs. */
export function claimAgentRequest(
  repoRoot: string,
  id: string,
  author: string,
  now = new Date(),
): AgentRequest {
  const name = author.trim();
  if (!name) throw new FlowUserError("An agent author is required.");
  const branch = readCommentBranch(repoRoot);
  const sessionId = readAgentSession(repoRoot)?.owner;
  return changeRequests(repoRoot, (requests) => {
    const request = requests.find((candidate) => candidate.id === id);
    if (!request || (request.branch && request.branch !== branch))
      throw new FlowUserError("No active request with that id on this branch.");
    if (request.status === "claimed") {
      if (request.claimedBy !== name || request.sessionId !== sessionId)
        throw new FlowUserError("This request was already picked up by another agent session.");
      return { requests, result: request };
    }
    if (request.status !== "queued")
      throw new FlowUserError(`This request is ${request.status}; do not execute it again.`);
    const effective = proposalRequestStatus(repoRoot, request);
    if (effective === "completed" || effective === "superseded")
      throw new FlowUserError(`This request is ${effective}; do not execute it again.`);
    const claimed: AgentRequest = {
      ...request,
      status: "claimed",
      claimedBy: name,
      sessionId,
      claimedAt: now.toISOString(),
    };
    return {
      requests: requests.map((candidate) => (candidate.id === id ? claimed : candidate)),
      result: claimed,
    };
  });
}

/** Finish only acknowledged work; terminal acknowledgements can be safely repeated by their owner. */
export function finishAgentRequest(
  repoRoot: string,
  id: string,
  author: string,
  error?: string,
  now = new Date(),
): AgentRequest {
  const sessionId = readAgentSession(repoRoot)?.owner;
  return changeRequests(repoRoot, (requests) => {
    const request = requests.find((candidate) => candidate.id === id);
    if (!request || request.claimedBy !== author.trim() || request.sessionId !== sessionId)
      throw new FlowUserError("Claim this request in the owning session before completing it.");
    if (request.status === "completed" || request.status === "failed")
      return { requests, result: request };
    if (request.status !== "claimed") throw new FlowUserError(`This request is ${request.status}.`);
    const completed: AgentRequest = {
      ...request,
      status: error ? "failed" : "completed",
      completedAt: now.toISOString(),
      ...(error ? { error } : {}),
    };
    return {
      requests: requests.map((candidate) => (candidate.id === id ? completed : candidate)),
      result: completed,
    };
  });
}

/** Desktop commands acknowledge their own correlated request without another agent round trip. */
export function updateProposalRequest(
  repoRoot: string,
  proposalId: string,
  state: "claimed" | "completed" | "failed",
  author?: string,
) {
  const request = readAgentRequests(repoRoot).find(
    (candidate) =>
      candidate.proposalId === proposalId &&
      candidate.phase === "propose" &&
      (candidate.status === "queued" || candidate.status === "claimed"),
  );
  if (!request) return;
  const name = author ?? request.claimedBy ?? "Agent";
  claimAgentRequest(repoRoot, request.id, name);
  if (state !== "claimed")
    finishAgentRequest(
      repoRoot,
      request.id,
      name,
      state === "failed" ? "Proposal preparation failed." : undefined,
    );
}

/** Cancellation retires delivery without pretending that an agent completed the work. */
export function supersedeProposalRequest(repoRoot: string, proposalId: string) {
  return changeRequests(repoRoot, (requests) => ({
    requests: requests.map((request) =>
      request.proposalId === proposalId &&
      (request.status === "queued" || request.status === "claimed")
        ? { ...request, status: "superseded" as const, completedAt: new Date().toISOString() }
        : request,
    ),
    result: undefined,
  }));
}
