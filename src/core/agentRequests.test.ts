import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeCommitRequest, writeTicketContextRequest } from "./agentRequests";
import { readAgentRequests } from "./agentRequestStore";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each ticket switch replaces the request with a fresh id and leaves no temp files", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-requests-"));
  roots.push(root);

  const first = writeTicketContextRequest(root, "PROJ-1", new Date("2026-11-11T10:00:00Z"));
  const second = writeTicketContextRequest(root, "PROJ-2", new Date("2026-11-11T10:00:01Z"));

  const saved = JSON.parse(readFileSync(join(root, ".flow", "requests.json"), "utf8"));
  expect(saved.request).toEqual(second);
  expect(readAgentRequests(root).map((request) => request.status)).toEqual([
    "superseded",
    "queued",
  ]);
  expect(saved.request).toMatchObject({ type: "ticket-context", ticket: "PROJ-2" });
  expect(second.id).not.toBe(first.id);
  expect(readdirSync(join(root, ".flow"))).toEqual(["requests.json"]);
});

test("a commit request on a branch without a ticket carries none", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-requests-"));
  roots.push(root);
  writeCommitRequest(root, undefined);
  const saved = JSON.parse(readFileSync(join(root, ".flow", "requests.json"), "utf8"));
  expect(saved.request.type).toBe("commit");
  expect("ticket" in saved.request).toBe(false);
});
