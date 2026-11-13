import { writeReviewRequest } from "../../src/core/agentRequests";
import { claimAgentRequest } from "../../src/core/agentRequestStore";

/** Run one competing writer against an isolated test repository. */
function runTestRequestWorker() {
  const [root, operation, author, id] = process.argv.slice(2);
  if (!root || !operation || !author) throw new Error("Missing test worker arguments.");
  if (operation === "enqueue") writeReviewRequest(root, author, undefined);
  else if (operation === "claim" && id) claimAgentRequest(root, id, author);
  else throw new Error("Unknown test worker operation.");
}
runTestRequestWorker();
