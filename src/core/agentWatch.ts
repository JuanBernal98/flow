/**
 * `flow watch`: the event stream a coding agent's terminal follows. It prints one line per new
 * review comment batch and per new flow request, and keeps running until another watcher for the
 * same repo takes over. Everything goes through `.flow/` files; flow never talks to the agent.
 *
 * The line formats are the contract the agent's instructions match on:
 * - `new flow comments: <id> <id>…`
 * - `flow request: ticket-context <ID>`
 * - `flow request: review <ID>` or `flow request: review <ID> !<iid>`
 * - `flow request: commit [<ID>]`
 * - `flow request: mr-open [<ID>]`
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAgentComment, readCommentsFile } from "./comments";
import { pendingAgentRequests, type AgentRequest } from "./agentRequestStore";
import { commentThreadState } from "./commentThread";
import { recordAgentCheckpoint } from "./agentSession";

const POLL_INTERVAL_MS = 1_000;

type WatchedRequest = Pick<
  AgentRequest,
  "id" | "type" | "ticket" | "mergeRequest" | "proposalId" | "phase"
>;
export const AGENT_REMINDER_INTERVAL_MS = 60_000;

/** What the watcher has already announced, so each event is printed once. */
export interface AgentWatchState {
  /** Content keys of pending comments seen on the previous poll. */
  seenCommentKeys: ReadonlySet<string>;
  /** Id of the newest request already announced, persisted across re-arms. */
  handledRequestId: string | null;
  /** Last announcement time, independent from durable acknowledgement by the agent. */
  notifications?: ReadonlyMap<string, number>;
}

/** One poll's view of `.flow/`. */
export interface AgentWatchSnapshot {
  comments: { id: number; key: string }[];
  request: WatchedRequest | null;
  requests?: WatchedRequest[];
}

/** The event line for one request; a review names its MR when it has one. */
function describeRequest(request: WatchedRequest) {
  return [
    `flow request: ${request.type}`,
    request.ticket,
    request.mergeRequest && `!${request.mergeRequest}`,
    request.proposalId && `--proposal ${request.proposalId}`,
    request.phase && `--phase ${request.phase}`,
    `--request ${request.id}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Turn one snapshot into the lines to print and the next state. Comments are keyed by content,
 * not id, because ids are reused after a resolve; line and range are left out because they move
 * whenever the commented code does.
 */
export function nextAgentWatchEvents(
  state: AgentWatchState,
  snapshot: AgentWatchSnapshot,
  now = Date.now(),
) {
  const lines: string[] = [];
  const notifications = new Map(state.notifications);
  const activeKeys = new Set([
    ...snapshot.comments.map((comment) => `comment:${comment.key}`),
    ...(snapshot.requests ?? (snapshot.request ? [snapshot.request] : [])).map(
      (request) => `request:${request.id}`,
    ),
  ]);
  for (const key of notifications.keys()) if (!activeKeys.has(key)) notifications.delete(key);
  const announce = (key: string, seen: boolean) => {
    const last = notifications.get(key);
    if (last === undefined && seen) {
      notifications.set(key, now);
      return false;
    }
    if (last !== undefined && now - last < AGENT_REMINDER_INTERVAL_MS) return false;
    notifications.set(key, now);
    return true;
  };
  const newIds = snapshot.comments
    .filter((comment) => announce(`comment:${comment.key}`, state.seenCommentKeys.has(comment.key)))
    .map((comment) => comment.id);
  if (newIds.length > 0) {
    lines.push(`new flow comments: ${newIds.join(" ")}`);
  }

  let handledRequestId = state.handledRequestId;
  for (const request of snapshot.requests ?? (snapshot.request ? [snapshot.request] : [])) {
    if (!announce(`request:${request.id}`, request.id === handledRequestId)) continue;
    handledRequestId = request.id;
    lines.push(describeRequest(request));
  }

  return {
    lines,
    state: {
      seenCommentKeys: new Set(snapshot.comments.map((comment) => comment.key)),
      handledRequestId,
      notifications,
    },
  };
}

/** Read the comments and the newest request from disk; unreadable files read as empty. */
export function readAgentWatchSnapshot(repoRoot: string): AgentWatchSnapshot {
  let comments: AgentWatchSnapshot["comments"] = [];
  try {
    // The agent's own comments are not news to it.
    comments = readCommentsFile(repoRoot)
      .comments.filter(
        (comment) =>
          (!isAgentComment(comment) || comment.replies?.some((reply) => reply.author === "user")) &&
          commentThreadState(comment) === "pending",
      )
      .map((comment) => ({
        id: comment.id,
        key: JSON.stringify([
          comment.threadId,
          comment.branch,
          comment.file,
          comment.anchor,
          comment.body,
          comment.replies?.filter((reply) => reply.author === "user") ?? [],
        ]),
      }));
  } catch {
    // A half-written or invalid file is retried on the next poll.
  }

  let requests: WatchedRequest[] = [];
  try {
    requests = pendingAgentRequests(repoRoot).map(
      ({ id, type, ticket, mergeRequest, proposalId, phase }) => ({
        id,
        type,
        ...(ticket ? { ticket } : {}),
        ...(mergeRequest ? { mergeRequest } : {}),
        ...(proposalId ? { proposalId } : {}),
        ...(phase ? { phase } : {}),
      }),
    );
  } catch {
    /* Leave invalid queue data intact for diagnosis and retry at a later checkpoint. */
  }
  return { comments, request: requests.at(-1) ?? null, requests };
}

/** Per-repo files in the temp dir: who owns the watch, and the last request it announced. */
export function resolveWatchFiles(repoRoot: string, channel: "agent" | "stream" = "agent") {
  const key = createHash("sha1").update(repoRoot).digest("hex").slice(0, 12);
  const base = join(tmpdir(), `flow-watch-${key}${channel === "stream" ? "-stream" : ""}`);
  return { ownerFile: `${base}.pid`, handledRequestFile: `${base}.request` };
}

/**
 * Print agent events for one repo until another watcher for it starts. Starting a new watcher
 * makes the previous one exit, so re-arming never doubles events.
 */
export async function runAgentWatch(
  repoRoot: string,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
) {
  const { ownerFile, handledRequestFile } = resolveWatchFiles(repoRoot, "stream");
  const ownerId = `${process.pid}-${Date.now()}`;
  writeFileSync(ownerFile, ownerId);
  recordAgentCheckpoint(repoRoot, `stream:${ownerId}`, "External agent", "watch-start");
  const ownsWatch = () => {
    try {
      return readFileSync(ownerFile, "utf8") === ownerId;
    } catch {
      return false;
    }
  };

  let state: AgentWatchState = {
    // Pending comments are announced on start, so a fresh session picks up existing work.
    seenCommentKeys: new Set(),
    handledRequestId: existsSync(handledRequestFile)
      ? readFileSync(handledRequestFile, "utf8").trim() || null
      : null,
  };

  while (ownsWatch()) {
    const next = nextAgentWatchEvents(state, readAgentWatchSnapshot(repoRoot));
    if (next.state.handledRequestId !== state.handledRequestId && next.state.handledRequestId) {
      writeFileSync(handledRequestFile, next.state.handledRequestId);
    }
    state = next.state;
    if (next.lines.length)
      recordAgentCheckpoint(repoRoot, `stream:${ownerId}`, "External agent", "watch-delivery");
    for (const line of next.lines) {
      write(line);
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
}
