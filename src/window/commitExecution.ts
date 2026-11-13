/** Run a reviewed plan outside the desktop server's event loop. */
import { executeCommitProposal } from "../core/commitProposal";

const [repoRoot, id] = process.argv.slice(2);
if (!repoRoot || !id) throw new Error("Commit execution requires a repository and proposal id.");
const result = executeCommitProposal(repoRoot, id);
if (result.status === "failed") {
  console.error(result.error ?? "Local commit execution failed.");
  process.exitCode = 1;
}
