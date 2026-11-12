import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "./cli";
import { resolveCliVersion } from "./version";

const tempDirs: string[] = [];

function createTempDir(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("parseCli", () => {
  test("prints help when no subcommand is passed", async () => {
    const parsed = await parseCli(["bun", "flow"]);

    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected top-level help output.");
    }

    expect(parsed.text).toContain("Usage:");
    expect(parsed.text).toContain("flow diff");
    expect(parsed.text).toContain("flow show");
    expect(parsed.text).toContain("flow skill <path|show>");
    expect(parsed.text).toContain("flow comments");
    expect(parsed.text).toContain("Global options:");
    expect(parsed.text).toContain("Common review options:");
    expect(parsed.text).toContain("auto-reload when the current diff input changes");
    expect(parsed.text).toContain("Git diff options:");
    expect(parsed.text).toContain("Notes:");
    expect(parsed.text).toContain(
      "Run `flow <command> --help` for command-specific syntax and options.",
    );
    expect(parsed.text).not.toContain("Config:");
    expect(parsed.text).not.toContain("Examples:");
  });

  test("prints the same top-level help for --help", async () => {
    const bare = await parseCli(["bun", "flow"]);
    const explicit = await parseCli(["bun", "flow", "--help"]);

    expect(explicit).toEqual(bare);
  });

  test("resolves the package version metadata", () => {
    expect(resolveCliVersion()).toBe(require("../../package.json").version);
  });

  test("prints the package version for --version and version", async () => {
    const expectedVersion = require("../../package.json").version;
    const flag = await parseCli(["bun", "flow", "--version"]);
    const command = await parseCli(["bun", "flow", "version"]);

    expect(flag).toEqual({ kind: "help", text: `${expectedVersion}\n` });
    expect(command).toEqual(flag);
  });

  test("parses git-style diff mode with shared options", async () => {
    const parsed = await parseCli([
      "bun",
      "flow",
      "diff",
      "main...feature",
      "--mode",
      "split",
      "--theme",
      "paper",
      "--no-line-numbers",
      "--wrap",
      "--no-hunk-headers",
      "--watch",
    ]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "main...feature",
      staged: false,
      options: {
        mode: "split",
        theme: "paper",
        watch: true,
        lineNumbers: false,
        wrapLines: true,
        hunkHeaders: false,
      },
    });
  });

  test("parses staged git-style diff aliases", async () => {
    const staged = await parseCli(["bun", "flow", "diff", "--staged"]);
    const cached = await parseCli(["bun", "flow", "diff", "--cached"]);

    expect(staged).toMatchObject({ kind: "vcs", staged: true });
    expect(cached).toMatchObject({ kind: "vcs", staged: true });
  });

  test("defaults bare `flow diff` to a branch review, and `--no-branch` to a HEAD review", async () => {
    const parsed = await parseCli(["bun", "flow", "diff"]);
    expect(parsed).toMatchObject({ kind: "vcs", staged: false, branchReview: { implicit: true } });
    expect(parsed).not.toHaveProperty("range");
    // Only a bare diff defaults to the branch; scopes and targets keep their meaning.
    expect(await parseCli(["bun", "flow", "diff", "--staged"])).not.toHaveProperty("branchReview");

    const plain = await parseCli(["bun", "flow", "diff", "--no-branch"]);

    expect(plain).toMatchObject({ kind: "vcs", staged: false, range: "HEAD" });
    expect(plain).not.toHaveProperty("branchReview");
  });

  test("parses --unstaged as an index-vs-working-tree review", async () => {
    const parsed = await parseCli(["bun", "flow", "diff", "--unstaged"]);

    expect(parsed).toMatchObject({ kind: "vcs", staged: false });
    if (parsed.kind === "vcs") {
      expect(parsed.range).toBeUndefined();
    }
  });

  test("rejects --staged combined with --unstaged", async () => {
    await expect(parseCli(["bun", "flow", "diff", "--staged", "--unstaged"])).rejects.toThrow(
      /--staged.*--unstaged/,
    );
  });

  test("rejects --branch combined with --unstaged", async () => {
    await expect(parseCli(["bun", "flow", "diff", "--branch", "--unstaged"])).rejects.toThrow(
      /--branch.*--staged.*--unstaged/,
    );
  });

  test("parses untracked file toggles for git diff", async () => {
    const excluded = await parseCli(["bun", "flow", "diff", "--exclude-untracked"]);
    const included = await parseCli(["bun", "flow", "diff", "--no-exclude-untracked"]);

    expect(excluded).toMatchObject({
      kind: "vcs",
      staged: false,
      options: {
        excludeUntracked: true,
      },
    });
    expect(included).toMatchObject({
      kind: "vcs",
      staged: false,
      options: {
        excludeUntracked: false,
      },
    });
  });

  test("keeps two concrete file paths as file-pair diff mode", async () => {
    const dir = createTempDir("flow-cli-files-");
    const left = join(dir, "before.ts");
    const right = join(dir, "after.ts");
    writeFileSync(left, "before\n");
    writeFileSync(right, "after\n");

    const parsed = await parseCli(["bun", "flow", "diff", left, right, "--mode", "stack"]);

    expect(parsed).toMatchObject({
      kind: "diff",
      left,
      right,
      options: {
        mode: "stack",
      },
    });
  });

  test("parses --branch with no value as a base-auto request", async () => {
    const parsed = await parseCli(["bun", "flow", "diff", "--branch"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      staged: false,
      branchReview: {},
    });
    if (parsed.kind === "vcs") {
      expect(parsed.branchReview?.explicitBase).toBeUndefined();
      expect(parsed.range).toBeUndefined();
    }
  });

  test("parses --branch=base as an explicit base override", async () => {
    const parsed = await parseCli(["bun", "flow", "diff", "--branch=origin/main"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      branchReview: { explicitBase: "origin/main" },
    });
  });

  test("--branch composes with pathspecs after `--`", async () => {
    const parsed = await parseCli(["bun", "flow", "diff", "--branch=main", "--", "src/app.ts"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      branchReview: { explicitBase: "main" },
      pathspecs: ["src/app.ts"],
    });
  });

  test("rejects --branch combined with --staged", async () => {
    await expect(parseCli(["bun", "flow", "diff", "--branch", "--staged"])).rejects.toThrow(
      /--branch.*--staged/,
    );
  });

  test("rejects --branch=base combined with positional revision args", async () => {
    await expect(parseCli(["bun", "flow", "diff", "--branch=main", "HEAD~3"])).rejects.toThrow(
      /positional revision arguments/,
    );
  });

  test("parses pathspec-limited git diffs", async () => {
    const parsed = await parseCli([
      "bun",
      "flow",
      "diff",
      "main",
      "--",
      "src/app.ts",
      "test/app.test.ts",
    ]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "main",
      pathspecs: ["src/app.ts", "test/app.test.ts"],
    });
  });

  test("parses target followed by pathspecs without a separator", async () => {
    const parsed = await parseCli(["bun", "flow", "diff", "trunk()..@", ".github"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      range: "trunk()..@",
      pathspecs: [".github"],
    });
  });

  test("parses show mode with optional ref and pathspecs", async () => {
    const parsed = await parseCli(["bun", "flow", "show", "HEAD~1", "--", "src/app.ts"]);

    expect(parsed).toMatchObject({
      kind: "show",
      ref: "HEAD~1",
      pathspecs: ["src/app.ts"],
    });
  });

  test("treats post-`--` flag-shaped tokens as pathspecs, not view options", async () => {
    const parsed = await parseCli(["bun", "flow", "diff", "--", "--no-wrap"]);

    expect(parsed).toMatchObject({
      kind: "vcs",
      pathspecs: ["--no-wrap"],
    });
    if (parsed.kind === "vcs") {
      expect(parsed.options.wrapLines).toBeUndefined();
    }
  });

  test("parses general pager mode", async () => {
    const parsed = await parseCli(["bun", "flow", "pager", "--theme", "paper"]);

    expect(parsed).toMatchObject({
      kind: "pager",
      options: {
        theme: "paper",
      },
    });
  });

  test("prints the bundled skill path for flow skill path", async () => {
    const parsed = await parseCli(["bun", "flow", "skill", "path"]);

    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected bundled skill path output.");
    }

    expect(parsed.text).toEndWith(`${join("skills", "flow-comments-fix", "SKILL.md")}\n`);
  });

  test("prints skill help for flow skill --help", async () => {
    const parsed = await parseCli(["bun", "flow", "skill", "--help"]);

    expect(parsed).toEqual({
      kind: "help",
      text: [
        "Usage: flow skill <path|show> [name]",
        "",
        "  path   print a bundled skill's path",
        "  show   print a bundled skill",
        "",
        "Skills: flow-comments-fix, flow-ticket-switch, flow-ticket-context, flow-review, flow-commit-create, flow-mr-open (default: flow-comments-fix).",
        "",
        "Point your agent's skill at `flow skill show <name>` so its instructions always match the",
        "installed flow, instead of a copied file that drifts across upgrades.",
        "",
      ].join("\n"),
    });
  });

  test("prints a named bundled skill and rejects unknown names", async () => {
    const parsed = await parseCli(["bun", "flow", "skill", "show", "flow-ticket-context"]);
    if (parsed.kind !== "help") {
      throw new Error("Expected the skill text.");
    }
    expect(parsed.text).toContain("name: flow-ticket-context");
    expect(parsed.text).toContain("overview write");

    const path = await parseCli(["bun", "flow", "skill", "path", "flow-mr-open"]);
    if (path.kind !== "help") {
      throw new Error("Expected the skill path.");
    }
    expect(path.text).toEndWith(`${join("skills", "flow-mr-open", "SKILL.md")}\n`);

    await expect(parseCli(["bun", "flow", "skill", "show", "nope"])).rejects.toThrow(
      "Unknown skill `nope`",
    );
  });

  test("parses stash show mode", async () => {
    const parsed = await parseCli(["bun", "flow", "stash", "show", "stash@{1}"]);

    expect(parsed).toMatchObject({
      kind: "stash-show",
      ref: "stash@{1}",
    });
  });

  test("prints comments help for flow comments --help", async () => {
    const parsed = await parseCli(["bun", "flow", "comments", "--help"]);
    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") {
      throw new Error("Expected comments help output.");
    }
    expect(parsed.text).toContain("Usage: flow comments");
    expect(parsed.text).toContain("list");
    expect(parsed.text).toContain("show");
    expect(parsed.text).toContain("resolve");
  });

  test("rejects unknown comments subcommands", async () => {
    await expect(parseCli(["bun", "flow", "comments", "wat"])).rejects.toThrow(
      /Unknown `flow comments` subcommand/,
    );
  });

  test("rejects non-integer ids for flow comments resolve", async () => {
    await expect(parseCli(["bun", "flow", "comments", "resolve", "abc"])).rejects.toThrow(
      /positive integer ids/,
    );
  });

  test("rejects removed legacy git alias", async () => {
    await expect(parseCli(["bun", "flow", "git"])).rejects.toThrow("Unknown command: git");
  });

  test("parses patch mode from a file", async () => {
    const parsed = await parseCli(["bun", "flow", "patch", "changes.patch", "--pager"]);

    expect(parsed).toMatchObject({
      kind: "patch",
      file: "changes.patch",
      options: {
        pager: true,
      },
    });
    if (parsed.kind !== "patch") {
      throw new Error("Expected patch command input.");
    }

    expect(parsed.options.mode).toBeUndefined();
  });

  test("parses difftool mode with display path", async () => {
    const parsed = await parseCli([
      "bun",
      "flow",
      "difftool",
      "left.ts",
      "right.ts",
      "src/example.ts",
      "--mode",
      "stack",
    ]);

    expect(parsed).toMatchObject({
      kind: "difftool",
      left: "left.ts",
      right: "right.ts",
      path: "src/example.ts",
      options: {
        mode: "stack",
      },
    });
    if (parsed.kind !== "difftool") {
      throw new Error("Expected difftool command input.");
    }

    expect(parsed.options.pager).toBeUndefined();
  });
});

describe("watch command", () => {
  test("parses `watch` into the agent watch stream", async () => {
    expect(await parseCli(["bun", "flow", "watch"])).toEqual({ kind: "agent-watch" });
  });

  test("rejects extra arguments", async () => {
    await expect(parseCli(["bun", "flow", "watch", "now"])).rejects.toThrow(
      "`flow watch` does not accept arguments.",
    );
  });
});

describe("skill show", () => {
  test("prints the bundled review skill text", async () => {
    const parsed = await parseCli(["bun", "flow", "skill", "show"]);
    expect(parsed.kind).toBe("help");
    if (parsed.kind !== "help") return;
    expect(parsed.text).toStartWith("---\nname: flow-comments-fix\n");
    expect(parsed.text).toContain("flow comments resolve <id>");
    expect(parsed.text).toContain("flow request: ticket-context <ID>");
    expect(parsed.text.endsWith("\n")).toBe(true);
  });
});

describe("focus command", () => {
  test("rejects missing targets and bad line numbers", async () => {
    await expect(parseCli(["bun", "flow", "focus"])).rejects.toThrow("Usage: flow focus");
    await expect(parseCli(["bun", "flow", "focus", "src/a.ts", "0"])).rejects.toThrow(
      "positive line number",
    );
  });
});
