/** Noninteractive commands used by the commit skill to exchange desktop proposals. */
import { findRepoRoot } from "./config";
import {
  executeCommitProposal,
  claimCommitProposal,
  failCommitProposal,
  publishCommitProposal,
  readCommitProposal,
} from "./commitProposal";
import { FlowUserError } from "./errors";

const HELP = `Usage:
  flow commits show <request-id>
  flow commits claim <request-id> <agent-name>
  flow commits propose <request-id> < proposal.json
  flow commits execute <request-id>
  flow commits fail <request-id> <reason>

Proposal JSON: {"agentName":"Codex","commits":[{"kind":"commit","message":"feat: explain why","files":["src/file.ts"]}]}
For a fixup use kind "fixup", a full target SHA, its exact "fixup! <subject>" message, and files.
Only flow open can approve a proposal. execute requires that approval and an unchanged checkout.
`;

/** Validate command arguments before reading stdin or changing proposal state. */
export async function runCommitsCommand(tokens: string[]) {
  if (!tokens.length || tokens.includes("--help") || tokens.includes("-h")) return HELP;
  const [command, id, ...rest] = tokens;
  if (
    !id ||
    !["show", "claim", "propose", "execute", "fail"].includes(command!) ||
    (command !== "fail" && command !== "claim" && rest.length) ||
    ((command === "fail" || command === "claim") && !rest.length)
  )
    throw new FlowUserError(HELP);
  const root = findRepoRoot(process.cwd());
  if (!root) throw new FlowUserError("Not inside a git repository.");
  if (command === "show") {
    const proposal = readCommitProposal(root);
    if (!proposal || proposal.id !== id)
      throw new FlowUserError("No proposal with that request id.");
    return `${JSON.stringify(proposal, null, 2)}\n`;
  }
  if (command === "propose") {
    let input: unknown;
    try {
      input = JSON.parse(await Bun.stdin.text());
    } catch {
      throw new FlowUserError("Pass the proposal JSON on stdin.");
    }
    publishCommitProposal(root, id, input);
    return "Proposal published. Wait for approval in flow open; do not commit yet.\n";
  }
  if (command === "claim") {
    claimCommitProposal(root, id, rest.join(" "));
    return "Proposal request picked up.\n";
  }
  if (command === "fail") {
    failCommitProposal(root, id, rest.join(" "));
    return "Planning failure reported.\n";
  }
  const result = executeCommitProposal(root, id);
  if (result.status === "failed")
    throw new FlowUserError(result.error ?? "Commit execution failed.");
  return `${result.result || "Approved changes committed."}\n`;
}
