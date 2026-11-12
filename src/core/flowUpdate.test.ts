import { describe, expect, test } from "bun:test";
import { runFlowUpdate, type FlowUpdateDeps } from "./flowUpdate";

/** Deps whose git answers come from a table keyed by the joined args; records what ran. */
function createTestUpdateDeps(answers: Record<string, { exitCode?: number; stdout?: string }>) {
  const ran: string[][] = [];
  const said: string[] = [];
  const deps: FlowUpdateDeps = {
    checkout: "/flow",
    git: (args) => {
      const answer = answers[args.join(" ")] ?? {};
      return { exitCode: answer.exitCode ?? 0, stdout: answer.stdout ?? "" };
    },
    runInteractive: async (command) => {
      ran.push(command);
      return 0;
    },
    say: (line) => said.push(line),
  };
  return { deps, ran, said };
}

const SETUP = ["bun", "run", "src/main.tsx", "--", "setup", "claude"];
const ON_MAIN = {
  "rev-parse --abbrev-ref HEAD": { stdout: "main\n" },
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": { stdout: "origin/main\n" },
};

describe("runFlowUpdate", () => {
  test("pulls new commits fast-forward only, installs, and refreshes Claude Code", async () => {
    const { deps, ran, said } = createTestUpdateDeps({
      ...ON_MAIN,
      "rev-list --count HEAD..@{u}": { stdout: "2\n" },
      "rev-list --count @{u}..HEAD": { stdout: "0\n" },
      "log --oneline --no-decorate -n 10 HEAD..@{u}": { stdout: "abc feat: one\ndef fix: two\n" },
    });
    expect(await runFlowUpdate(deps)).toBe(true);
    expect(ran).toEqual([["git", "pull", "--ff-only"], ["bun", "install"], SETUP]);
    expect(said).toContain("  2 new commits:");
  });

  test("when up to date, only refreshes Claude Code", async () => {
    const { deps, ran, said } = createTestUpdateDeps({
      ...ON_MAIN,
      "rev-list --count HEAD..@{u}": { stdout: "0\n" },
    });
    expect(await runFlowUpdate(deps)).toBe(true);
    expect(ran).toEqual([SETUP]);
    expect(said).toContain("  Already up to date.");
  });

  test("stops on local changes, a missing upstream, or a diverged branch", async () => {
    const dirty = createTestUpdateDeps({ "status --porcelain": { stdout: " M src/app.ts\n" } });
    expect(await runFlowUpdate(dirty.deps)).toBe(false);
    expect(dirty.ran).toEqual([]);

    const noUpstream = createTestUpdateDeps({
      "rev-parse --abbrev-ref HEAD": { stdout: "mine\n" },
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": { exitCode: 1 },
    });
    expect(await runFlowUpdate(noUpstream.deps)).toBe(false);
    expect(noUpstream.said.at(-1)).toContain("no upstream");

    const diverged = createTestUpdateDeps({
      ...ON_MAIN,
      "rev-list --count HEAD..@{u}": { stdout: "1\n" },
      "rev-list --count @{u}..HEAD": { stdout: "3\n" },
    });
    expect(await runFlowUpdate(diverged.deps)).toBe(false);
    expect(diverged.ran).toEqual([]);
  });
});
