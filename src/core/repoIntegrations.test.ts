import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasWorkspaceIntegrations, readRepoIntegrations } from "./repoIntegrations";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repository root, with `.flow/config.toml` when given. */
function createTestRepoRoot(config?: string) {
  const root = mkdtempSync(join(tmpdir(), "flow-integrations-"));
  testRoots.push(root);
  if (config !== undefined) {
    mkdirSync(join(root, ".flow"), { recursive: true });
    writeFileSync(join(root, ".flow", "config.toml"), config);
  }
  return root;
}

describe("readRepoIntegrations", () => {
  test("reads YouTrack and GitLab from the repository's own config", () => {
    const root = createTestRepoRoot(
      [
        'theme = "claude"',
        "[youtrack]",
        'url = "https://yt.test"',
        "[gitlab]",
        'review_label = "my-team"',
      ].join("\n"),
    );
    const integrations = readRepoIntegrations(root);
    expect(integrations).toMatchObject({
      youtrackUrl: "https://yt.test",
      gitlab: true,
      reviewLabel: "my-team",
      projectKeys: [],
    });
    expect(hasWorkspaceIntegrations(integrations)).toBe(true);
  });

  test("merged_state turns on moving my merged tickets, and leaving it out keeps it off", () => {
    expect(
      readRepoIntegrations(
        createTestRepoRoot('[youtrack]\nurl = "https://yt.test"\nmerged_state = "Done"\n'),
      ).mergedState,
    ).toBe("Done");
    expect(
      readRepoIntegrations(createTestRepoRoot('[youtrack]\nurl = "https://yt.test"\n')).mergedState,
    ).toBeUndefined();
  });

  test("project_keys narrows which ticket ids count, and a malformed key keeps the config out", () => {
    expect(
      readRepoIntegrations(
        createTestRepoRoot('[youtrack]\nurl = "https://yt.test"\nproject_keys = ["PROJ", "OPS"]\n'),
      ).projectKeys,
    ).toEqual(["PROJ", "OPS"]);
    expect(
      readRepoIntegrations(createTestRepoRoot('[youtrack]\nproject_keys = ["proj"]\n')).projectKeys,
    ).toEqual([]);
  });

  test("the squad's workflow comes from the config, with Review and main by default", () => {
    expect(readRepoIntegrations(createTestRepoRoot("[gitlab]\n")).workflow).toEqual({
      reviewState: "Review",
      inProgressStates: [],
      baseBranch: "main",
    });
    const custom = readRepoIntegrations(
      createTestRepoRoot(
        '[youtrack]\nreview_state = "Code Review"\nin_progress_states = ["Doing"]\n[git]\nbase_branch = "develop"\n',
      ),
    );
    expect(custom.workflow).toEqual({
      reviewState: "Code Review",
      inProgressStates: ["Doing"],
      baseBranch: "develop",
    });
  });

  test("a broken config connects to nothing but says why", () => {
    expect(readRepoIntegrations(createTestRepoRoot("[youtrack\nbroken")).error).toContain(
      "TOML Parse error",
    );
    expect(
      readRepoIntegrations(createTestRepoRoot('[youtrack]\nproject_keys = ["proj"]\n')).error,
    ).toContain("youtrack.project_keys.0");
    expect(readRepoIntegrations(createTestRepoRoot('theme = "zed"\n')).error).toBeUndefined();
  });

  test("an empty [gitlab] section turns GitLab on without a review label", () => {
    expect(readRepoIntegrations(createTestRepoRoot("[gitlab]\n"))).toMatchObject({
      youtrackUrl: undefined,
      gitlab: true,
      reviewLabel: undefined,
      projectKeys: [],
    });
  });

  test("a repository without sections, config, or root connects to nothing", () => {
    for (const root of [createTestRepoRoot('theme = "zed"\n'), createTestRepoRoot(), null]) {
      const integrations = readRepoIntegrations(root);
      expect(integrations).toMatchObject({ gitlab: false, projectKeys: [] });
      expect(hasWorkspaceIntegrations(integrations)).toBe(false);
    }
    expect(readRepoIntegrations(createTestRepoRoot("[youtrack\nbroken"))).toMatchObject({
      gitlab: false,
      projectKeys: [],
    });
  });
});
