import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingConfigSections, runRepoInit, type RepoInitDeps } from "./repoInit";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway git repository. */
function createTestGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "flow-init-"));
  testRoots.push(root);
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  return root;
}

/** Deps that answer from a script, accept what the tests say, and run real git in `root`. */
function createTestInitDeps(
  root: string,
  answers: string[],
  overrides: Partial<RepoInitDeps> = {},
): RepoInitDeps & { questions: string[]; lines: string[] } {
  const questions: string[] = [];
  const lines: string[] = [];
  return {
    questions,
    lines,
    ask: async (question, defaultValue) => {
      questions.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`Unexpected question: ${question}`);
      return answer || defaultValue || "";
    },
    say: (line) => lines.push(line),
    checkYouTrack: async () => ({ ok: true, login: "me" }),
    isYouTrackState: async () => true,
    isYouTrackProject: async () => true,
    hasGitLabLabel: async () => true,
    git: (args) => {
      // The throwaway repo has no remote: every origin branch a test names counts as existing.
      if (args[0] === "rev-parse" && args.includes("--verify")) return { exitCode: 0, stdout: "" };
      const result = Bun.spawnSync(["git", ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "ignore",
      });
      return { exitCode: result.exitCode, stdout: result.stdout.toString() };
    },
    ...overrides,
  };
}

const FULL_ANSWERS = ["https://yt.test", "", "", "", "my-team", "#team-reviews", ""];

describe("missingConfigSections", () => {
  test("lists the sections a config does not declare", () => {
    expect(missingConfigSections(undefined)).toEqual(["youtrack", "gitlab", "slack", "git"]);
    expect(missingConfigSections('theme = "zed"\n[gitlab]\nreview_label = "x"\n')).toEqual([
      "youtrack",
      "slack",
      "git",
    ]);
  });
});

describe("runRepoInit", () => {
  test("writes a commented config from the answers and keeps .flow/ out of Git", async () => {
    const root = createTestGitRepo();
    const deps = createTestInitDeps(root, [...FULL_ANSWERS]);
    await runRepoInit(root, deps);

    const config = readFileSync(join(root, ".flow", "config.toml"), "utf8");
    const parsed = Bun.TOML.parse(config);
    expect(parsed).toEqual({
      youtrack: { url: "https://yt.test", merged_state: "Done", review_state: "Review" },
      gitlab: { review_label: "my-team" },
      slack: { review_channel: "#team-reviews" },
      git: { base_branch: "main" },
    });
    expect(config).toContain("# Your tickets still in Review move to this state");
    expect(readFileSync(join(root, ".git", "info", "exclude"), "utf8")).toContain(".flow/\n");
    expect(deps.lines.at(-1)).toContain("run `flow`");
  });

  test("asks again, saying why, until an answer checks out", async () => {
    const root = createTestGitRepo();
    let youTrackTries = 0;
    const deps = createTestInitDeps(
      root,
      [
        "https://wrong.test",
        "https://yt.test",
        "Finished",
        "Done",
        "",
        "proj",
        "NOPE",
        "PROJ, OPS",
        "nope",
        "my-team",
        "team",
        "#team",
        "",
      ],
      {
        checkYouTrack: async () =>
          ++youTrackTries === 1
            ? { ok: false, message: "YouTrack is unreachable" }
            : { ok: true, login: "me" },
        isYouTrackState: async (_url, state) => state === "Done" || state === "Review",
        isYouTrackProject: async (_url, key) => key !== "NOPE",
        hasGitLabLabel: async (label) => label === "my-team",
      },
    );
    await runRepoInit(root, deps);
    expect(deps.lines).toContain("  YouTrack is unreachable; try again.");
    expect(deps.lines).toContain('  "Finished" is not a State on this YouTrack; try again.');
    expect(deps.lines).toContain('  "proj" is not a project key like PROJ; try again.');
    expect(deps.lines).toContain('  there is no "NOPE" project on this YouTrack; try again.');
    expect(deps.lines).toContain('  the project has no "nope" label; try again.');
    expect(Bun.TOML.parse(readFileSync(join(root, ".flow", "config.toml"), "utf8"))).toMatchObject({
      youtrack: { project_keys: ["PROJ", "OPS"] },
    });
    expect(deps.lines).toContain("  start the channel name with #; try again.");
  });

  test("offers the YouTrack URL setup remembered, so Enter is enough", async () => {
    const root = createTestGitRepo();
    const deps = createTestInitDeps(root, ["", "", "", "", "my-team", "#team-reviews", ""], {
      defaultYouTrackUrl: "https://remembered.test",
    });
    await runRepoInit(root, deps);
    expect(Bun.TOML.parse(readFileSync(join(root, ".flow", "config.toml"), "utf8"))).toMatchObject({
      youtrack: { url: "https://remembered.test" },
    });
  });

  test("only asks for the missing sections and keeps what the config already says", async () => {
    const root = createTestGitRepo();
    mkdirSync(join(root, ".flow"));
    writeFileSync(
      join(root, ".flow", "config.toml"),
      'theme = "claude"\n\n[youtrack]\nurl = "https://yt.test"\n',
    );
    const deps = createTestInitDeps(root, ["my-team", "#team-reviews", ""]);
    await runRepoInit(root, deps);

    expect(deps.questions).toEqual([
      "GitLab label of your squad's MRs",
      "Slack review channel",
      "Base branch for tickets and MRs",
    ]);
    const parsed = Bun.TOML.parse(readFileSync(join(root, ".flow", "config.toml"), "utf8"));
    expect(parsed).toMatchObject({
      theme: "claude",
      youtrack: { url: "https://yt.test" },
      gitlab: { review_label: "my-team" },
    });
  });

  test("a connected repository asks nothing, and an ignored .flow/ is left alone", async () => {
    const root = createTestGitRepo();
    writeFileSync(join(root, ".gitignore"), ".flow/\n");
    const first = createTestInitDeps(root, [...FULL_ANSWERS]);
    await runRepoInit(root, first);
    expect(first.lines.some((line) => line.includes(".git/info/exclude"))).toBe(false);

    const again = createTestInitDeps(root, []);
    await runRepoInit(root, again);
    expect(again.questions).toEqual([]);
    expect(again.lines).toEqual(["This repository is already connected (.flow/config.toml)."]);
  });
});
