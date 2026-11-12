import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRun } from "../../src/core/ticketSwitch";

const testRepoRoots: string[] = [];

/** Remove every repo created by `createTestTicketRepo`; call from `afterEach`. */
export function cleanupTestTicketRepos() {
  for (const dir of testRepoRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run git synchronously in a test repo and fail loudly on errors. */
export function gitTest(cwd: string, args: string[]) {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
}

/** Create a throwaway clone with a bare `origin` whose `main` has one commit. */
export function createTestTicketRepo() {
  const root = mkdtempSync(join(tmpdir(), "ticket-repo-"));
  testRepoRoots.push(root);
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  gitTest(root, ["init", "--quiet", "--bare", "--initial-branch=main", origin]);
  gitTest(root, ["clone", "--quiet", origin, work]);
  for (const [key, value] of [
    ["user.email", "test@example.test"],
    ["user.name", "Test"],
    ["commit.gpgsign", "false"],
  ] as const) {
    gitTest(work, ["config", key, value]);
  }
  writeFileSync(join(work, "app.ts"), "export const value = 1;\n");
  gitTest(work, ["add", "."]);
  gitTest(work, ["commit", "--quiet", "-m", "init"]);
  gitTest(work, ["push", "--quiet", "origin", "main"]);
  return { work, git: createGitRun(work) };
}
