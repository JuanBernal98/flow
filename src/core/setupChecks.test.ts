import { describe, expect, test } from "bun:test";
import { runSetupChecks, type SetupCheckDeps } from "./setupChecks";

const CONNECTED_MCP_LIST = [
  "youtrack: https://yt.example.test/mcp - ✔ Connected",
  "claude.ai Notion: https://mcp.notion.com/mcp - ✔ Connected",
  "claude.ai Slack: https://mcp.slack.com/mcp - ✔ Connected",
].join("\n");

/** Probes for a machine where everything is installed, with overrides per test. */
function createTestCheckDeps(overrides: Partial<SetupCheckDeps> = {}): SetupCheckDeps {
  return {
    which: (command) => `/usr/bin/${command}`,
    run: async (args) =>
      args[0] === "claude"
        ? { exitCode: 0, stdout: CONNECTED_MCP_LIST }
        : { exitCode: 0, stdout: "" },
    hasYouTrackToken: () => true,
    platform: "darwin",
    username: "tester",
    ...overrides,
  };
}

describe("runSetupChecks", () => {
  test("passes everything on a fully set up machine", async () => {
    const checks = await runSetupChecks(createTestCheckDeps());
    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ["bun", "ok"],
      ["glab", "ok"],
      ["YouTrack token", "ok"],
      ["YouTrack MCP", "ok"],
      ["Notion connector", "ok"],
      ["Slack connector", "ok"],
    ]);
  });

  test("fails every missing dependency and says how to fix it", async () => {
    const checks = await runSetupChecks(
      createTestCheckDeps({
        which: (command) => (command === "bun" ? null : `/usr/bin/${command}`),
        run: async (args) =>
          args[0] === "glab"
            ? { exitCode: 1, stdout: "" }
            : {
                exitCode: 0,
                stdout: "claude.ai Notion: https://mcp.notion.com/mcp - ! Needs authentication",
              },
        hasYouTrackToken: () => false,
      }),
    );
    expect(checks.map((check) => check.status)).toEqual([
      "fail",
      "fail",
      "fail",
      "fail",
      "fail",
      "fail",
    ]);
    // Each failure says how to fix it: a command setup may run, or steps for the user.
    expect(checks.find((check) => check.name === "glab")?.remedy).toEqual({
      kind: "run",
      command: ["glab", "auth", "login"],
    });
    expect(checks.find((check) => check.name === "YouTrack token")?.remedy).toEqual({
      kind: "run",
      command: [
        "security",
        "add-generic-password",
        "-U",
        "-a",
        "tester",
        "-s",
        "flow-youtrack",
        "-w",
      ],
    });
    expect(checks.find((check) => check.name === "YouTrack MCP")?.remedy).toEqual({
      kind: "youtrack-mcp",
    });
    expect(checks.find((check) => check.name === "glab")?.detail).toContain("Cloudflare Access");
    expect(checks.find((check) => check.name === "Notion connector")?.remedy?.kind).toBe("manual");
    expect(checks.find((check) => check.name === "Notion connector")?.detail).toContain(
      "not connected",
    );
    expect(checks.find((check) => check.name === "Slack connector")?.detail).toContain(
      "not set up",
    );
  });

  test("offers brew for a missing glab only on macOS with brew, and steps elsewhere", async () => {
    const withoutGlab = (command: string) => (command === "glab" ? null : `/usr/bin/${command}`);
    const mac = await runSetupChecks(createTestCheckDeps({ which: withoutGlab }));
    expect(mac.find((check) => check.name === "glab")?.remedy).toEqual({
      kind: "run",
      command: ["brew", "install", "glab"],
    });
    const linux = await runSetupChecks(
      createTestCheckDeps({ which: withoutGlab, platform: "linux" }),
    );
    expect(linux.find((check) => check.name === "glab")?.remedy?.kind).toBe("manual");
  });

  test("fails when `claude` is missing, since the connectors cannot be checked", async () => {
    const checks = await runSetupChecks(
      createTestCheckDeps({
        which: (command) => (command === "claude" ? null : `/usr/bin/${command}`),
      }),
    );
    expect(checks.at(-1)).toMatchObject({ name: "Claude Code", status: "fail" });
  });
});
