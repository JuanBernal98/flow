import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeOverviewIssues,
  readTicketOverview,
  TicketOverviewSchema,
  writeTicketOverview,
  type TicketOverview,
} from "./ticketOverview";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway directory standing in for a repository root. */
function createTestRepoRoot() {
  const root = mkdtempSync(join(tmpdir(), "overview-"));
  testRoots.push(root);
  return root;
}

const TEST_OVERVIEW: TicketOverview = {
  summary: "Keep the badge on one line.",
  why: ["It wraps"],
  todo: ["Clamp it"],
  acceptance: ["Never wraps"],
  code: [{ path: "src/badge.tsx", note: "the badge" }],
  questions: [],
  plan: ["Measure"],
};

describe("ticket overviews", () => {
  test("round-trip through .flow/overviews with when and where they were written", () => {
    const root = createTestRepoRoot();
    const now = new Date("2026-11-11T10:00:00Z");
    writeTicketOverview(root, "PROJ-7", TEST_OVERVIEW, { now, commit: "abc123" });

    expect(readTicketOverview(root, "PROJ-7")).toEqual({
      schema: 1,
      ticket: "PROJ-7",
      writtenAt: "2026-11-11T10:00:00.000Z",
      commit: "abc123",
      overview: TEST_OVERVIEW,
    });
    expect(readTicketOverview(root, "PROJ-8")).toBeNull();
  });

  test("never reads or writes outside the overviews directory", () => {
    const root = createTestRepoRoot();
    expect(() => writeTicketOverview(root, "../escape", TEST_OVERVIEW)).toThrow();
    expect(readTicketOverview(root, "../escape")).toBeNull();
  });

  test("treats a garbled file as no overview", () => {
    const root = createTestRepoRoot();
    writeTicketOverview(root, "PROJ-7", TEST_OVERVIEW);
    writeFileSync(join(root, ".flow", "overviews", "PROJ-7.json"), "{ nope");
    expect(readTicketOverview(root, "PROJ-7")).toBeNull();
  });

  test("names each missing or unknown section so the agent can fix it", () => {
    const parsed = TicketOverviewSchema.safeParse({ ...TEST_OVERVIEW, plan: [], outOfScope: [] });
    if (parsed.success) throw new Error("Expected the overview to be rejected");
    const issues = describeOverviewIssues(parsed.error).join("\n");
    expect(issues).toContain("plan:");
    expect(issues).toContain("outOfScope");
  });
});
