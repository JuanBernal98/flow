import { findRepoRoot } from "./config";
import { FlowUserError } from "./errors";
import { claimAgentRequest, finishAgentRequest, readAgentRequests } from "./agentRequestStore";
import { readCommentBranch } from "./commentBranch";
import { inspectAgentCommunication, renderAgentDoctor } from "./agentDoctor";

const HELP = `Usage:
  flow requests [list] [--json]
  flow requests claim <id> --author <name>
  flow requests done <id> --author <name>
  flow requests fail <id> <reason> --author <name>

Delivery does not acknowledge work. Claim once before acting, then record completion or failure.
Repeated announcements use the same id. Completed work must not be executed again.
`;

/** Request commands always refer to the repository of the external agent's terminal. */
function requireRequestRepo(cwd?: string) {
  const root = findRepoRoot(cwd ?? process.cwd());
  if (!root) throw new FlowUserError("Not inside a git repository.");
  return root;
}

/** Inspect or acknowledge queued work without starting a watcher or controlling the agent. */
export function runAgentRequestsCommand(tokens: string[], cwd?: string) {
  if (tokens.includes("--help") || tokens.includes("-h")) return HELP;
  const root = requireRequestRepo(cwd);
  const [command = "list", ...rest] = tokens;
  if (command === "list") {
    if (rest.some((token) => token !== "--json")) throw new FlowUserError(HELP);
    const branch = readCommentBranch(root);
    const requests = readAgentRequests(root).filter(
      (request) => !request.branch || request.branch === branch,
    );
    if (rest.includes("--json"))
      return `${JSON.stringify({ schema: 1, branch, requests }, null, 2)}\n`;
    return requests.length
      ? `${requests.map((request) => `${request.id}  ${request.type}  ${request.status}${request.claimedBy ? `  ${request.claimedBy}` : ""}  ${request.claimedAt ?? request.createdAt}`).join("\n")}\n`
      : "No requests on this branch.\n";
  }
  const authorIndex = rest.indexOf("--author");
  const author = authorIndex < 0 ? undefined : rest[authorIndex + 1];
  const args =
    authorIndex < 0
      ? rest
      : rest.filter((_, index) => index !== authorIndex && index !== authorIndex + 1);
  const [id, ...reason] = args;
  if (
    !id ||
    !author?.trim() ||
    args.some((arg) => arg.startsWith("--")) ||
    !["claim", "done", "fail"].includes(command) ||
    (command !== "fail" && reason.length) ||
    (command === "fail" && !reason.join(" ").trim())
  )
    throw new FlowUserError(HELP);
  const request =
    command === "claim"
      ? claimAgentRequest(root, id, author)
      : finishAgentRequest(root, id, author, command === "fail" ? reason.join(" ") : undefined);
  return `Request ${request.id}: ${request.status}.\n`;
}

/** Inspect installation and pending delivery without changing settings or launching anything. */
export function runAgentDoctorCommand(tokens: string[], cwd?: string) {
  if (tokens.includes("--help") || tokens.includes("-h"))
    return "Usage: flow doctor [--json]\nInspect agent hooks, last activity and pending requests.\n";
  if (tokens.some((token) => token !== "--json"))
    throw new FlowUserError("Usage: flow doctor [--json]");
  const report = inspectAgentCommunication(requireRequestRepo(cwd));
  return tokens.includes("--json")
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderAgentDoctor(report);
}
