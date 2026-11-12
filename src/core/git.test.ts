import { describe, expect, test } from "bun:test";
import { WORKTREE_BASE_REF, buildGitStashShowArgs, formatGitCommandLabel, runGitText } from "./git";

describe("git command helpers", () => {
  test("disables external diff tools for stash patches", () => {
    const args = buildGitStashShowArgs({
      kind: "stash-show",
      options: { mode: "auto" },
    });

    expect(args).toContain("--no-ext-diff");
  });

  test("reports a friendly error when git is not installed or not on PATH", () => {
    expect(() =>
      runGitText({
        input: {
          kind: "vcs",
          staged: false,
          range: WORKTREE_BASE_REF,
          options: { mode: "auto" },
        },
        args: ["status"],
        gitExecutable: "definitely-not-a-real-git-binary",
      }),
    ).toThrow(
      "Git is required for `flow diff`, but `definitely-not-a-real-git-binary` was not found in PATH.",
    );
  });

  test("labels working-tree review scope from the comparison base", () => {
    const common = { kind: "vcs", options: { mode: "auto" } } as const;

    expect(formatGitCommandLabel({ ...common, staged: false, range: WORKTREE_BASE_REF })).toBe(
      "flow diff",
    );
    expect(formatGitCommandLabel({ ...common, staged: true })).toBe("flow diff --staged");
    expect(formatGitCommandLabel({ ...common, staged: false })).toBe("flow diff --unstaged");
    expect(formatGitCommandLabel({ ...common, staged: false, range: "main..feature" })).toBe(
      "flow diff main..feature",
    );
  });
});
