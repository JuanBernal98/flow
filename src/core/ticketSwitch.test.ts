import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo, gitTest } from "../../test/helpers/git-repo";
import { runGitText } from "./git";
import {
  describeTicketSwitch,
  switchToReviewBranch,
  switchToTicket,
  type GitRun,
} from "./ticketSwitch";
import type { VcsCommandInput } from "./types";

/** Any working-tree input; `runGitText` only uses it to word errors. */
const TEST_GIT_INPUT: VcsCommandInput = { kind: "vcs", staged: false, options: {} };

afterEach(cleanupTestTicketRepos);

describe("switchToTicket", () => {
  test("creates the ticket branch from origin/main without tracking it", async () => {
    const { work, git } = createTestTicketRepo();

    const result = await switchToTicket(git, "PROJ-1");

    expect(result).toMatchObject({ kind: "switched", branch: "PROJ-1", origin: "created" });
    expect(gitTest(work, ["branch", "--show-current"])).toBe("PROJ-1");
    const upstream = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "@{upstream}"], {
      cwd: work,
      stderr: "ignore",
    });
    expect(upstream.exitCode).not.toBe(0);
  }, 15_000);

  test("tracks a branch that only exists on origin", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["push", "--quiet", "origin", "main:PROJ-2-remote-work"]);

    const result = await switchToTicket(git, "PROJ-2");

    expect(result).toMatchObject({ branch: "PROJ-2-remote-work", origin: "remote" });
    expect(gitTest(work, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe(
      "origin/PROJ-2-remote-work",
    );
  }, 15_000);

  test("parks work per branch and restores it on return", async () => {
    const { work, git } = createTestTicketRepo();
    await switchToTicket(git, "PROJ-1");
    writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
    writeFileSync(join(work, "new.ts"), "export const fresh = true;\n");

    const away = await switchToTicket(git, "PROJ-2");
    expect(away).toMatchObject({ branch: "PROJ-2", stashedFrom: "PROJ-1", restore: "none" });
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 1;\n");
    expect(existsSync(join(work, "new.ts"))).toBe(false);

    const back = await switchToTicket(git, "PROJ-1");
    expect(back).toMatchObject({ branch: "PROJ-1", origin: "local", restore: "restored" });
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 2;\n");
    expect(existsSync(join(work, "new.ts"))).toBe(true);
    expect(gitTest(work, ["stash", "list"])).toBe("");
    expect(describeTicketSwitch(back)).toBe("On PROJ-1 · changes restored");
  }, 20_000);

  test("picks the preferred branch among several, else the one with the newest commit", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["branch", "PROJ-3-a"]);
    gitTest(work, ["switch", "--quiet", "-c", "PROJ-3-b"]);
    writeFileSync(join(work, "app.ts"), "export const value = 3;\n");
    // A later committer date makes PROJ-3-b the newest regardless of how fast the test runs.
    Bun.spawnSync(["git", "commit", "--quiet", "-am", "newer"], {
      cwd: work,
      env: { ...process.env, GIT_COMMITTER_DATE: "2030-01-01T00:00:00Z" },
    });
    gitTest(work, ["switch", "--quiet", "main"]);

    expect(await switchToTicket(git, "PROJ-3")).toMatchObject({ branch: "PROJ-3-b" });
    // Being on any of the ticket's branches already counts as being on the ticket.
    expect(await switchToTicket(git, "PROJ-3", "PROJ-3-a")).toEqual({
      kind: "already-on",
      branch: "PROJ-3-b",
    });
    gitTest(work, ["switch", "--quiet", "main"]);
    expect(await switchToTicket(git, "PROJ-3", "PROJ-3-a")).toMatchObject({
      branch: "PROJ-3-a",
      origin: "local",
    });
  }, 15_000);

  test("prefers an MR branch that only exists on origin over a local sibling", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["branch", "PROJ-4-local"]);
    gitTest(work, ["push", "--quiet", "origin", "main:PROJ-4-from-mr"]);

    expect(await switchToTicket(git, "PROJ-4", "PROJ-4-from-mr")).toMatchObject({
      branch: "PROJ-4-from-mr",
      origin: "remote",
    });
  }, 15_000);

  test("does not treat a longer ticket id as a match", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["branch", "PROJ-10-other"]);

    const result = await switchToTicket(git, "PROJ-1");

    expect(result).toMatchObject({ branch: "PROJ-1", origin: "created" });
  }, 15_000);

  test("puts parked work back when the switch itself fails", async () => {
    const calls: string[][] = [];
    const fakeGit: GitRun = async (args) => {
      calls.push(args);
      const joined = args.join(" ");
      if (joined === "branch --show-current") return { ok: true, stdout: "PROJ-1", stderr: "" };
      if (joined === "status --porcelain") return { ok: true, stdout: " M app.ts", stderr: "" };
      if (args[0] === "switch") {
        return { ok: false, stdout: "", stderr: "fatal: invalid reference: origin/main\nmore" };
      }
      return { ok: true, stdout: "", stderr: "" };
    };

    const result = await switchToTicket(fakeGit, "PROJ-2");

    expect(result).toEqual({ kind: "failed", message: "fatal: invalid reference: origin/main" });
    expect(calls.at(-1)).toEqual(["stash", "pop"]);
  });
});

describe("switchToReviewBranch", () => {
  /** Push a commit to `branch` on origin that the local repo has not fetched yet. */
  function pushTestReviewCommit(work: string, branch: string, value: number) {
    gitTest(work, ["switch", "--quiet", "-c", "scratch", `origin/${branch}`]);
    writeFileSync(join(work, "app.ts"), `export const value = ${value};\n`);
    gitTest(work, ["commit", "--quiet", "-am", `value ${value}`]);
    gitTest(work, ["push", "--quiet", "origin", `scratch:${branch}`]);
    gitTest(work, ["switch", "--quiet", "main"]);
    gitTest(work, ["branch", "--quiet", "-D", "scratch"]);
  }

  test("parks my work, checks out the MR branch, and brings the work back on return", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["push", "--quiet", "origin", "main:PROJ-9-their-work"]);
    writeFileSync(join(work, "app.ts"), "export const value = 2;\n");

    const review = await switchToReviewBranch(git, "PROJ-9-their-work", "main");
    expect(review).toMatchObject({
      kind: "switched",
      branch: "PROJ-9-their-work",
      origin: "remote",
      stashedFrom: "main",
    });
    expect(gitTest(work, ["rev-parse", "--abbrev-ref", "@{upstream}"])).toBe(
      "origin/PROJ-9-their-work",
    );
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 1;\n");

    expect(await switchToReviewBranch(git, "PROJ-9-their-work", "main")).toEqual({
      kind: "already-on",
      branch: "PROJ-9-their-work",
    });
    gitTest(work, ["switch", "--quiet", "main"]);
    gitTest(work, ["stash", "pop", "--quiet"]);
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 2;\n");
  }, 20_000);

  test("fast-forwards a stale local copy but keeps one with commits of its own", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["push", "--quiet", "origin", "main:review-me"]);
    await switchToReviewBranch(git, "review-me", "main");
    gitTest(work, ["switch", "--quiet", "main"]);
    pushTestReviewCommit(work, "review-me", 3);

    expect(await switchToReviewBranch(git, "review-me", "main")).toMatchObject({ origin: "local" });
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 3;\n");

    writeFileSync(join(work, "app.ts"), "export const value = 4;\n");
    gitTest(work, ["commit", "--quiet", "-am", "my local fixup"]);
    gitTest(work, ["switch", "--quiet", "main"]);
    pushTestReviewCommit(work, "review-me", 5);

    await switchToReviewBranch(git, "review-me", "main");
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 4;\n");
  }, 20_000);

  test("fails without touching the tree when origin has no such branch", async () => {
    const { work, git } = createTestTicketRepo();
    writeFileSync(join(work, "app.ts"), "export const value = 2;\n");

    expect(await switchToReviewBranch(git, "gone", "main")).toEqual({
      kind: "failed",
      message: "gone is not on origin",
    });
    expect(gitTest(work, ["stash", "list"])).toBe("");
    expect(readFileSync(join(work, "app.ts"), "utf8")).toBe("export const value = 2;\n");
  }, 15_000);
});

describe("switchToTicket guards", () => {
  test("does nothing when already on the ticket's branch", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["switch", "--quiet", "-c", "PROJ-1-work"]);
    writeFileSync(join(work, "app.ts"), "export const value = 9;\n");

    expect(await switchToTicket(git, "PROJ-1")).toEqual({
      kind: "already-on",
      branch: "PROJ-1-work",
    });
    expect(gitTest(work, ["stash", "list"])).toBe("");
  }, 15_000);

  test("refuses to stash on a detached HEAD where it could never be restored", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["switch", "--quiet", "--detach"]);
    writeFileSync(join(work, "app.ts"), "export const value = 9;\n");

    const result = await switchToTicket(git, "PROJ-1");

    expect(result.kind).toBe("failed");
    expect(gitTest(work, ["stash", "list"])).toBe("");
  }, 15_000);
});

describe("switchToTicket index lock", () => {
  /** Fake git on `main` with a clean tree whose `switch` replies come from the given list. */
  function createTestLockedGit(switchReplies: { ok: boolean; stderr: string }[]) {
    const switchCalls: string[][] = [];
    const git: GitRun = async (args) => {
      if (args[0] === "switch") {
        switchCalls.push(args);
        const reply = switchReplies.shift() ?? { ok: true, stderr: "" };
        return { ok: reply.ok, stdout: "", stderr: reply.stderr };
      }
      return {
        ok: true,
        stdout: args.join(" ") === "branch --show-current" ? "main" : "",
        stderr: "",
      };
    };
    return { git, switchCalls };
  }

  test("retries while another process holds index.lock", async () => {
    const { git, switchCalls } = createTestLockedGit([
      { ok: false, stderr: "fatal: Unable to create '/repo/.git/index.lock': File exists." },
      { ok: false, stderr: "error: could not write index" },
    ]);

    const result = await switchToTicket(git, "PROJ-1");

    expect(result).toMatchObject({ kind: "switched", branch: "PROJ-1" });
    expect(switchCalls).toHaveLength(3);
  });

  test("does not retry other failures", async () => {
    const { git, switchCalls } = createTestLockedGit([
      { ok: false, stderr: "fatal: invalid reference: origin/main" },
    ]);

    const result = await switchToTicket(git, "PROJ-1");

    expect(result).toEqual({ kind: "failed", message: "fatal: invalid reference: origin/main" });
    expect(switchCalls).toHaveLength(1);
  });
});

describe("git environment", () => {
  test("every git process flow starts skips optional index locks", async () => {
    const { work, git } = createTestTicketRepo();
    // A shell alias prints the environment git itself received.
    const printLocks = ["-c", "alias.printlocks=!echo $GIT_OPTIONAL_LOCKS", "printlocks"];

    expect((await git(printLocks)).stdout).toBe("0");
    expect(runGitText({ input: TEST_GIT_INPUT, args: printLocks, cwd: work }).trim()).toBe("0");
  }, 15_000);
});
