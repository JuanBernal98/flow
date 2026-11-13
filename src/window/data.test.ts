import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo, gitTest } from "../../test/helpers/git-repo";
import { loadWindowDiff, parseWindowDiff } from "./data";

afterEach(cleanupTestTicketRepos);

test("window patch preserves empty-file names and untracked membership without line headers", () => {
  const files = parseWindowDiff(
    "diff --git a/empty.txt b/empty.txt\nnew file mode 100644\nindex 0000000..e69de29\n",
    new Set(["empty.txt"]),
  );
  expect(files).toMatchObject([
    { path: "empty.txt", status: "added", untracked: true, additions: 0, deletions: 0 },
  ]);
});

test("window patch preserves rename destinations without text changes", () => {
  const files = parseWindowDiff(
    "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n",
  );
  expect(files).toMatchObject([{ path: "new.txt", status: "renamed", additions: 0, deletions: 0 }]);
});

test("window diff distinguishes tracked additions from untracked files for change groups", () => {
  const { work } = createTestTicketRepo();
  writeFileSync(join(work, "staged.ts"), "export const staged = true;\n");
  gitTest(work, ["add", "staged.ts"]);
  writeFileSync(join(work, "new file.ts"), "export const untracked = true;\n");
  const files = loadWindowDiff(work);
  expect(files.find((file) => file.path === "staged.ts")).toMatchObject({
    status: "added",
    untracked: false,
  });
  expect(files.find((file) => file.path === "new file.ts")).toMatchObject({
    status: "added",
    untracked: true,
  });
});
