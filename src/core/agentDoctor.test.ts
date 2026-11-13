import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectAgentCommunication } from "./agentDoctor";
import { writeReviewRequest } from "./agentRequests";
import { claimAgentRequest } from "./agentRequestStore";
import { recordAgentCheckpoint } from "./agentSession";
import { runAgentRequestsCommand, runAgentDoctorCommand } from "./cliAgentRequests";

test("diagnosis distinguishes missing hooks, unclaimed work and a stale owning session", () => {
  const root = mkdtempSync(join(tmpdir(), "flow-agent-doctor-"));
  try {
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/test\n");
    const options = {
      codexDir: join(root, "codex"),
      claudeDir: join(root, "claude"),
      now: new Date("2026-11-13T12:10:00Z"),
    };
    const requestedAt = new Date("2026-11-13T12:00:00Z");
    const request = writeReviewRequest(root, "PROJ-1", undefined, requestedAt);
    const unclaimed = inspectAgentCommunication(root, options);
    expect(unclaimed.pending[0]).toMatchObject({ status: "queued", stale: true, ageSeconds: 600 });
    expect(unclaimed.issues.some((issue) => issue.includes("No Flow lifecycle hooks"))).toBe(true);
    recordAgentCheckpoint(root, "owner-a", "Codex", "PostToolUse", requestedAt);
    claimAgentRequest(root, request.id, "Codex", requestedAt);
    const claimed = inspectAgentCommunication(root, options);
    expect(claimed.pending[0]).toMatchObject({
      status: "claimed",
      claimedBy: "Codex",
      stale: true,
    });
    recordAgentCheckpoint(root, "owner-a", "Codex", "PostToolUse", options.now);
    expect(inspectAgentCommunication(root, options).pending[0]?.stale).toBe(false);
    expect(runAgentDoctorCommand(["--json"], root)).toContain("lastCheckpointAt");
    expect(runAgentRequestsCommand(["done", request.id, "--author", "Codex"], root)).toContain(
      "completed",
    );
    expect(runAgentRequestsCommand(["list", "--json"], root)).toContain('"completed"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
