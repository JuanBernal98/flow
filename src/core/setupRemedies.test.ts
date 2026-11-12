import { describe, expect, test } from "bun:test";
import type { SetupCheck } from "./setupChecks";
import { resolveMissingDependencies, type RemedyIo } from "./setupRemedies";

const OK = (name: string): SetupCheck => ({ status: "ok", name });

/** Checks that return each scripted round in turn, repeating the last one. */
function createTestChecks(rounds: SetupCheck[][]) {
  let round = 0;
  return async () => rounds[Math.min(round++, rounds.length - 1)]!;
}

/** IO that answers from scripts and records everything said and run. */
function createTestRemedyIo(overrides: Partial<RemedyIo> = {}) {
  const said: string[] = [];
  const ran: string[][] = [];
  const io: RemedyIo = {
    say: (line) => said.push(line),
    confirm: async () => true,
    ask: async () => "https://yt.test/",
    waitForRecheck: async () => true,
    runInteractive: async (command) => {
      ran.push(command);
      return 0;
    },
    checkYouTrack: async () => ({ ok: true, login: "me" }),
    hasYouTrackMcpEntry: async () => false,
    addYouTrackMcp: async () => ({ ok: true, output: "Added HTTP MCP server youtrack" }),
    ...overrides,
  };
  return { io, said, ran };
}

const GLAB_MISSING: SetupCheck = {
  status: "fail",
  name: "glab",
  detail: "not installed",
  remedy: { kind: "run", command: ["brew", "install", "glab"] },
};

describe("resolveMissingDependencies", () => {
  test("asks nothing when everything is already there", async () => {
    const { io, said, ran } = createTestRemedyIo({
      confirm: async () => {
        throw new Error("should not ask");
      },
    });
    const checks = await resolveMissingDependencies(
      createTestChecks([[OK("bun"), OK("glab")]]),
      io,
    );
    expect(checks.every((check) => check.status === "ok")).toBe(true);
    expect(said).toEqual([]);
    expect(ran).toEqual([]);
  });

  test("shows the exact command, runs it only after a yes, and checks again", async () => {
    const { io, said, ran } = createTestRemedyIo();
    const checks = await resolveMissingDependencies(
      createTestChecks([[GLAB_MISSING], [OK("glab")]]),
      io,
    );
    expect(said).toContain("  flow can fix this by running: brew install glab");
    expect(ran).toEqual([["brew", "install", "glab"]]);
    expect(checks).toEqual([OK("glab")]);
  });

  test("a no stops right there and runs nothing", async () => {
    const { io, ran } = createTestRemedyIo({ confirm: async () => false });
    const checks = await resolveMissingDependencies(createTestChecks([[GLAB_MISSING]]), io);
    expect(ran).toEqual([]);
    expect(checks[0]?.status).toBe("fail");
  });

  test("manual steps wait for the user, and q stops", async () => {
    const notion: SetupCheck = {
      status: "fail",
      name: "Notion connector",
      remedy: { kind: "manual", steps: "In Claude Code, run /mcp." },
    };
    const done = createTestRemedyIo();
    expect(
      await resolveMissingDependencies(
        createTestChecks([[notion], [OK("Notion connector")]]),
        done.io,
      ),
    ).toEqual([OK("Notion connector")]);
    expect(done.said).toContain("  In Claude Code, run /mcp.");

    const stopped = createTestRemedyIo({ waitForRecheck: async () => false });
    expect(
      (await resolveMissingDependencies(createTestChecks([[notion]]), stopped.io))[0]?.status,
    ).toBe("fail");
  });

  test("connects the YouTrack MCP from the URL, showing the command with the token hidden", async () => {
    const added: [string, boolean][] = [];
    const { io, said } = createTestRemedyIo({
      hasYouTrackMcpEntry: async () => true,
      addYouTrackMcp: async (url, replace) => {
        added.push([url, replace]);
        return { ok: true, output: "Added" };
      },
    });
    const mcp: SetupCheck = {
      status: "fail",
      name: "YouTrack MCP",
      remedy: { kind: "youtrack-mcp" },
    };
    await resolveMissingDependencies(createTestChecks([[mcp], [OK("YouTrack MCP")]]), io);
    expect(added).toEqual([["https://yt.test", true]]);
    expect(said).toContain("    claude mcp remove youtrack -s user");
    expect(said).toContain(
      '    claude mcp add --transport http -s user youtrack https://yt.test/mcp --header "Authorization: Bearer ••••"',
    );
  });
});
