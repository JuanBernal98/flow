import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo, gitTest } from "../../test/helpers/git-repo";
import { loadTicketLineStats, parseShortstat } from "./ticketStats";

afterEach(cleanupTestTicketRepos);

describe("parseShortstat", () => {
  test("reads insertions and deletions, including singular and missing parts", () => {
    expect(parseShortstat(" 2 files changed, 10 insertions(+), 3 deletions(-)")).toEqual({
      additions: 10,
      deletions: 3,
    });
    expect(parseShortstat(" 1 file changed, 1 insertion(+)")).toEqual({
      additions: 1,
      deletions: 0,
    });
    expect(parseShortstat("")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("loadTicketLineStats", () => {
  test("measures other tickets' branches by commits and the current one with uncommitted edits", async () => {
    const { work, git } = createTestTicketRepo();
    // PROJ-1: one committed line change on a local branch.
    gitTest(work, ["switch", "--quiet", "-c", "PROJ-1-work"]);
    writeFileSync(join(work, "app.ts"), "export const value = 2;\nexport const more = 3;\n");
    gitTest(work, ["commit", "--quiet", "-am", "work"]);
    // PROJ-2: checked out, with one committed and one uncommitted addition.
    gitTest(work, ["switch", "--quiet", "-c", "PROJ-2", "origin/main"]);
    writeFileSync(join(work, "app.ts"), "export const value = 1;\nexport const a = 1;\n");
    gitTest(work, ["commit", "--quiet", "-am", "a"]);
    writeFileSync(
      join(work, "app.ts"),
      "export const value = 1;\nexport const a = 1;\nexport const b = 2;\n",
    );

    const stats = await loadTicketLineStats(git, ["PROJ-1", "PROJ-2", "PROJ-3"]);

    expect(stats.get("PROJ-1")).toEqual({ additions: 2, deletions: 1 });
    expect(stats.get("PROJ-2")).toEqual({ additions: 2, deletions: 0 });
    expect(stats.has("PROJ-3")).toBe(false);
  }, 20_000);

  test("reads a branch that only exists on origin", async () => {
    const { work, git } = createTestTicketRepo();
    gitTest(work, ["switch", "--quiet", "-c", "tmp"]);
    writeFileSync(join(work, "app.ts"), "export const value = 1;\nexport const remote = true;\n");
    gitTest(work, ["commit", "--quiet", "-am", "remote"]);
    gitTest(work, ["push", "--quiet", "origin", "tmp:PROJ-4-remote"]);
    gitTest(work, ["switch", "--quiet", "main"]);
    gitTest(work, ["branch", "--quiet", "-D", "tmp"]);
    gitTest(work, ["fetch", "--quiet", "origin"]);

    const stats = await loadTicketLineStats(git, ["PROJ-4"]);

    expect(stats.get("PROJ-4")).toEqual({ additions: 1, deletions: 0 });
  }, 20_000);
});
