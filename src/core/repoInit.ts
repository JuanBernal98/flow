/**
 * `flow init`: connect one repository to flow by writing its `.flow/config.toml`.
 *
 * It asks only for the sections the config is missing, checks each answer against YouTrack and
 * GitLab where it can, and keeps `.flow/` out of Git. Prompts and checks are injected, so tests run
 * without a terminal or network.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { FLOW_CONFIG_RELATIVE_PATH, FLOW_DIR } from "./flowPaths";

/** The config sections `flow init` fills, in file order. */
export const REPO_CONFIG_SECTIONS = ["youtrack", "gitlab", "slack"] as const;
export type RepoConfigSection = (typeof REPO_CONFIG_SECTIONS)[number];

export interface RepoConfigValues {
  youtrackUrl: string;
  mergedState: string;
  /** Ticket prefixes of the squad's projects; empty means any. */
  projectKeys: string[];
  reviewLabel: string;
  slackChannel: string;
}

export interface RepoInitDeps {
  /** Ask one question; an empty answer takes `defaultValue` when there is one. */
  ask: (question: string, defaultValue?: string) => Promise<string>;
  /** Print one line for the user. */
  say: (line: string) => void;
  /** The YouTrack URL `flow setup` remembered, offered as the default answer. */
  defaultYouTrackUrl?: string;
  checkYouTrack: (
    url: string,
  ) => Promise<{ ok: true; login: string } | { ok: false; message: string }>;
  /** Whether a State value exists on the instance; undefined when it cannot be told. */
  isYouTrackState: (url: string, state: string) => Promise<boolean | undefined>;
  /** Whether a project key exists on the instance; undefined when it cannot be told. */
  isYouTrackProject: (url: string, projectKey: string) => Promise<boolean | undefined>;
  /** Whether the repository's GitLab project has the label; undefined when it cannot be told. */
  hasGitLabLabel: (label: string) => Promise<boolean | undefined>;
  /** Run git in the repository. */
  git: (args: string[]) => { exitCode: number; stdout: string };
}

/** Split a comma-separated answer into project keys. */
function splitProjectKeys(answer: string) {
  return answer
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

/** Sections a config text does not declare yet; every one when there is no config. */
export function missingConfigSections(configText: string | undefined): RepoConfigSection[] {
  return REPO_CONFIG_SECTIONS.filter(
    (section) => !configText || !new RegExp(`^\\[${section}\\]`, "m").test(configText),
  );
}

/** Render the given sections as commented TOML, so the file explains itself when edited later. */
export function renderConfigSections(sections: RepoConfigSection[], values: RepoConfigValues) {
  const blocks: Record<RepoConfigSection, string[]> = {
    youtrack: [
      "[youtrack]",
      "# Your tickets in the workspace; the token lives in the Keychain or FLOW_YOUTRACK_TOKEN.",
      `url = ${JSON.stringify(values.youtrackUrl)}`,
      "# Your tickets still in Review move to this state once their MR is merged.",
      `merged_state = ${JSON.stringify(values.mergedState)}`,
      ...(values.projectKeys.length > 0
        ? [
            "# Only these projects' ids count as tickets in MR branches and titles.",
            `project_keys = ${JSON.stringify(values.projectKeys)}`,
          ]
        : []),
    ],
    gitlab: [
      "[gitlab]",
      "# MRs on ticket cards come through `glab`; Reviews lists the open MRs with this label.",
      `review_label = ${JSON.stringify(values.reviewLabel)}`,
    ],
    slack: [
      "[slack]",
      "# Where the flow-mr-open skill posts the review request; it looks the channel up by name.",
      `review_channel = ${JSON.stringify(values.slackChannel)}`,
    ],
  };
  return `${sections.map((section) => blocks[section].join("\n")).join("\n\n")}\n`;
}

/** Ask until `accept` takes the answer, explaining each rejection. Only `optional` takes no answer. */
async function askUntil(
  deps: RepoInitDeps,
  question: string,
  defaultValue: string | undefined,
  accept: (answer: string) => Promise<string | undefined>,
  optional = false,
) {
  for (;;) {
    const answer = (await deps.ask(question, defaultValue)).trim();
    if (!answer && optional) {
      return answer;
    }
    const problem = answer ? await accept(answer) : "an answer is required";
    if (!problem) {
      return answer;
    }
    deps.say(`  ${problem}; try again.`);
  }
}

/** Make sure Git ignores `.flow/`, adding it to `.git/info/exclude` when nothing ignores it yet. */
export function ensureFlowDirIgnored(repoRoot: string, git: RepoInitDeps["git"]) {
  if (git(["check-ignore", "-q", FLOW_CONFIG_RELATIVE_PATH]).exitCode === 0) {
    return false;
  }
  const excludePath = git(["rev-parse", "--git-path", "info/exclude"]).stdout.trim();
  const absolute = isAbsolute(excludePath) ? excludePath : join(repoRoot, excludePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  appendFileSync(absolute, `${existing && !existing.endsWith("\n") ? "\n" : ""}${FLOW_DIR}/\n`);
  return true;
}

/** Ask for what the repository's config is missing, check it, write it, and keep `.flow/` local. */
export async function runRepoInit(repoRoot: string, deps: RepoInitDeps) {
  const configPath = join(repoRoot, FLOW_CONFIG_RELATIVE_PATH);
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  const missing = missingConfigSections(existing);
  if (missing.length === 0) {
    deps.say(`This repository is already connected (${FLOW_CONFIG_RELATIVE_PATH}).`);
    return;
  }
  if (existing) {
    deps.say(
      `${FLOW_CONFIG_RELATIVE_PATH} exists; adding the missing sections: ${missing.join(", ")}.`,
    );
  }

  const values: RepoConfigValues = {
    youtrackUrl: "",
    mergedState: "",
    projectKeys: [],
    reviewLabel: "",
    slackChannel: "",
  };

  if (missing.includes("youtrack")) {
    values.youtrackUrl = await askUntil(
      deps,
      "YouTrack URL",
      deps.defaultYouTrackUrl,
      async (url) => {
        const access = await deps.checkYouTrack(url);
        if (!access.ok) return access.message;
        deps.say(`  ✓ connected as ${access.login}`);
        return undefined;
      },
    );
    values.mergedState = await askUntil(deps, "State for merged tickets", "Done", async (state) => {
      const known = await deps.isYouTrackState(values.youtrackUrl, state);
      if (known === false) return `"${state}" is not a State on this YouTrack`;
      deps.say(
        known ? "  ✓ state exists" : "  · could not check the state (no tickets assigned yet)",
      );
      return undefined;
    });
    const keys = await askUntil(
      deps,
      "Ticket prefixes of your squad, comma-separated (empty: any)",
      undefined,
      async (answer) => {
        for (const key of splitProjectKeys(answer)) {
          if (!/^[A-Z][A-Z0-9]+$/.test(key)) return `"${key}" is not a project key like PROJ`;
          if ((await deps.isYouTrackProject(values.youtrackUrl, key)) === false) {
            return `there is no "${key}" project on this YouTrack`;
          }
        }
        deps.say("  ✓ projects exist");
        return undefined;
      },
      true,
    );
    values.projectKeys = splitProjectKeys(keys);
  }

  if (missing.includes("gitlab")) {
    values.reviewLabel = await askUntil(
      deps,
      "GitLab label of your squad's MRs",
      undefined,
      async (label) => {
        const known = await deps.hasGitLabLabel(label);
        if (known === false) return `the project has no "${label}" label`;
        deps.say(known ? "  ✓ label exists" : "  · could not check the label with glab");
        return undefined;
      },
    );
  }

  if (missing.includes("slack")) {
    values.slackChannel = await askUntil(deps, "Slack review channel", undefined, async (channel) =>
      channel.startsWith("#") ? undefined : "start the channel name with #",
    );
  }

  mkdirSync(join(repoRoot, FLOW_DIR), { recursive: true });
  const added = renderConfigSections(missing, values);
  writeFileSync(configPath, existing ? `${existing.trimEnd()}\n\n${added}` : added);
  deps.say(`Wrote ${FLOW_CONFIG_RELATIVE_PATH}.`);
  if (ensureFlowDirIgnored(repoRoot, deps.git)) {
    deps.say("Added .flow/ to .git/info/exclude, so your comments and overviews stay local.");
  }
  deps.say("Next: open a new Claude Code session here, then run `flow diff`.");
}
