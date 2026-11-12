import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { BoxRenderable } from "@opentui/core";
import { act } from "react";
import type { AppBootstrap, LayoutMode } from "../core/types";
import type { FocusRequest } from "../core/focusRequests";
import type { GitRun } from "../core/ticketSwitch";
import type { WorkspaceTasksResult } from "../core/youtrack";
import { createTestVcsAppBootstrap } from "../../test/helpers/app-bootstrap";
import { createTestDiffFile as buildTestDiffFile, lines } from "../../test/helpers/diff-helpers";

const { loadAppBootstrap } = await import("../core/loaders");
const { AppHost } = await import("./AppHost");

const PAGE_UP_SEQUENCE = "\x1B[5~";

test("the flat file list selects files with keyboard and mouse while preserving the full review", async () => {
  const onQuit = mock(() => {});
  const bootstrap = createTestVcsAppBootstrap({
    changesetId: "changeset:tree",
    files: [
      createTestDiffFile("alpha", "src/ui/alpha.ts", "const alpha = 1;\n", "const alpha = 2;\n"),
      createTestDiffFile("beta", "src/core/beta.ts", "const beta = 1;\n", "const beta = 2;\n"),
    ],
  });
  const setup = await testRender(<AppHost bootstrap={bootstrap} onQuit={onQuit} />, {
    width: 240,
    height: 24,
  });
  try {
    await flush(setup);
    expect(setup.renderer.root.findDescendantById("file-tree-pane")).toBeUndefined();
    await act(async () => {
      await setup.mockInput.typeText("F");
    });
    await flush(setup);
    const tree = setup.renderer.root.findDescendantById("file-tree-pane");
    if (!(tree instanceof BoxRenderable)) throw new Error("Missing file list");
    let frame = setup.captureCharFrame();
    // Filenames only: no folder headings and no folding.
    expect(frame).toContain("○ alpha.ts");
    expect(frame).toContain("○ beta.ts");
    expect(frame).not.toContain("src/ui/ ");
    expect(frame).not.toContain("▸");
    expect(frame).toContain("2 Changes");
    expect(frame).toContain("+2 −2");

    // Keyboard: End then Enter selects the last file; the review still shows every file.
    await act(async () => {
      await setup.mockInput.pressKey("END");
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    await flush(setup);
    frame = setup.captureCharFrame();
    expect(frame).toContain("const alpha = 2;");
    expect(frame).toContain("const beta = 2;");

    // Escape from the focused list returns to the review instead of quitting.
    await act(async () => {
      await setup.mockInput.typeText("F");
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.pressEscape();
      await Bun.sleep(40);
    });
    await flush(setup);
    expect(onQuit).not.toHaveBeenCalled();
    await act(async () => {
      await setup.mockInput.typeText("/");
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.typeText("alpha");
    });
    await flush(setup);
    frame = setup.captureCharFrame();
    expect(frame).toContain("○ alpha.ts");
    expect(frame).toContain("1 Changes");
    expect(frame).not.toContain("const beta = 2;");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("workspace mouse and keyboard selection preserve the active review", async () => {
  let loads = 0;
  const loadTestWorkspaceTasks = async (): Promise<WorkspaceTasksResult> => {
    loads += 1;
    return {
      kind: "ready",
      tasks: [
        {
          id: "PROJ-101",
          summary: "Workspace sidebar",
          state: "In Progress",
          url: "https://youtrack.example.test/issue/PROJ-101",
        },
        {
          id: "PROJ-102",
          summary: "Review navigation",
          state: "Open",
          url: "https://youtrack.example.test/issue/PROJ-102",
        },
        {
          id: "PROJ-103",
          summary: "Badge overlay",
          state: "Review",
          url: "https://youtrack.example.test/issue/PROJ-103",
        },
      ],
    };
  };
  const openedUrls: string[] = [];
  const ticketGit = createTestTicketGit("");
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={loadTestWorkspaceTasks}
      onOpenUrl={(url) => openedUrls.push(url)}
      createTicketGit={() => ticketGit.git}
      requestTicketContext={(_root, ticketId) => ticketGit.contextRequests.push(ticketId)}
      loadMergeRequests={async () => [
        {
          iid: 3601,
          state: "opened",
          sourceBranch: "PROJ-101-workspace",
          url: "https://gitlab.example.test/mr/3601",
          updatedAt: "2026-11-10T10:00:00Z",
          approved: false,
        },
      ]}
    />,
    { width: 160, height: 24 },
  );
  try {
    await flush(setup);
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("PROJ-101 · !3601");
    expect(setup.captureCharFrame()).toContain("◐ Workspace sidebar");
    expect(setup.captureCharFrame()).toContain("○ Review navigation");
    expect(setup.captureCharFrame()).toContain("Reviews are not connected");
    expect(setup.captureCharFrame()).toContain("◇ Badge overlay");
    const approval = setup.renderer.root.findDescendantById("workspace-section-approval");
    expect(approval?.findDescendantById("workspace-2")).toBeDefined();
    expect(setup.renderer.root.findDescendantById("workspace-heading-todo")?.height).toBe(3);
    expect(setup.renderer.root.findDescendantById("workspace-heading-reviews")?.height).toBe(3);
    const unfocusedColor = findWorkspaceRow(setup, 0).backgroundColor;
    // The pane starts open but unfocused: the first S focuses it and marks the selection.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("To do");
    expect(findWorkspaceRow(setup, 0).backgroundColor).not.toEqual(unfocusedColor);
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).not.toContain("To do");
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    const firstItem = findWorkspaceRow(setup, 0);
    const selectedColor = firstItem.backgroundColor;
    expect(selectedColor).not.toEqual(unfocusedColor);
    await act(async () => {
      await setup.mockInput.typeText("j");
    });
    await flush(setup);
    expect(firstItem.backgroundColor).not.toEqual(selectedColor);
    await act(async () => {
      await setup.mockMouse.click(8, 4);
    });
    await flush(setup);
    expect(firstItem.backgroundColor).toEqual(selectedColor);
    await act(async () => {
      await setup.mockInput.typeText("r");
    });
    await flush(setup);
    await flush(setup);
    expect(loads).toBe(2);
    await act(async () => {
      await setup.mockInput.typeText("h");
    });
    expect(openedUrls).toEqual(["https://youtrack.example.test/issue/PROJ-101"]);
    await act(async () => {
      await setup.mockInput.typeText("g");
    });
    expect(openedUrls).toEqual([
      "https://youtrack.example.test/issue/PROJ-101",
      "https://gitlab.example.test/mr/3601",
    ]);
    expect(setup.captureCharFrame()).toContain("◐ Workspace sidebar");
    expect(setup.captureCharFrame()).toContain("alpha.ts");

    // r reloads the workspace from the diff too, and the loaded tickets stay up meanwhile.
    await act(async () => {
      await setup.mockInput.pressEscape();
      await Bun.sleep(40);
    });
    await act(async () => {
      await setup.mockInput.typeText("r");
    });
    expect(setup.captureCharFrame()).not.toContain("Loading tasks");
    await flush(setup);
    await flush(setup);
    expect(loads).toBe(3);
    expect(setup.captureCharFrame()).toContain("◐ Workspace sidebar");
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    expect(setup.captureCharFrame()).toContain("beta.ts");
    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    await flush(setup);
    expect(await waitForFrame(setup, (frame) => frame.includes("On PROJ-101"))).toContain(
      "On PROJ-101 · new branch",
    );
    expect(ticketGit.calls).toContainEqual([
      "switch",
      "--no-track",
      "-c",
      "PROJ-101",
      "origin/main",
    ]);
    // Enter hands focus back to the review, so S focuses the workspace before it can hide it.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).not.toContain("To do");
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("To do");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("Reviews list squad MRs, and Enter checks one out like a ticket, parking my work", async () => {
  const reviewGit = createTestTicketGit(" M src/app.ts");
  const baseGit = reviewGit.git;
  // origin has the review branch; there is no local copy yet.
  const git: GitRun = async (args) => {
    if (args.join(" ") === "rev-parse --verify --quiet refs/heads/PROJ-55-their-fix") {
      return { ok: false, stdout: "", stderr: "" };
    }
    return baseGit(args);
  };
  const openedUrls: string[] = [];
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({ kind: "ready", tasks: [] })}
      onOpenUrl={(url) => openedUrls.push(url)}
      createTicketGit={() => git}
      requestTicketContext={(_root, ticketId) => reviewGit.contextRequests.push(ticketId)}
      issueUrl={(ticketId) => `https://youtrack.example.test/issue/${ticketId}`}
      loadReviews={async () => ({
        kind: "ready",
        reviews: [
          {
            iid: 4100,
            title: "Fix the feeder selector",
            author: "teammate",
            sourceBranch: "PROJ-55-their-fix",
            targetBranch: "PROJ-54-base",
            url: "https://gitlab.example.test/mr/4100",
          },
          {
            iid: 4101,
            title: "PROJ-77 Close the busbar gap",
            author: "teammate",
            sourceBranch: "busbar-gap",
            targetBranch: "main",
            url: "https://gitlab.example.test/mr/4101",
          },
        ],
      })}
    />,
    { width: 160, height: 24 },
  );
  try {
    const frame = await waitForFrame(setup, (current) => current.includes("Fix the feeder"));
    expect(frame).toContain("◇ Fix the feeder selector");
    // Each review names its ticket beside the MR: from the branch, else from the title.
    expect(frame).toContain("!4100 · PROJ-55 · teammate");
    expect(frame).toContain("!4101 · PROJ-77 · teammate");
    expect(frame).toContain("Nothing to do");

    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    // `h` is always the ticket (read from the review's branch) and `g` always the MR.
    await act(async () => {
      await setup.mockInput.typeText("h");
    });
    await act(async () => {
      await setup.mockInput.typeText("g");
    });
    expect(openedUrls).toEqual([
      "https://youtrack.example.test/issue/PROJ-55",
      "https://gitlab.example.test/mr/4100",
    ]);

    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    expect(await waitForFrame(setup, (current) => current.includes("On PROJ-55"))).toContain(
      "On PROJ-55-their-fix · tracking origin · main changes stashed",
    );
    expect(reviewGit.calls).toContainEqual([
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "flow:main",
    ]);
    expect(reviewGit.calls).toContainEqual([
      "switch",
      "--track",
      "-C",
      "PROJ-55-their-fix",
      "origin/PROJ-55-their-fix",
    ]);
    // The diff compares against the MR's target, not origin/main.
    expect(reviewGit.calls).toContainEqual([
      "config",
      "branch.PROJ-55-their-fix.flowBase",
      "origin/PROJ-54-base",
    ]);
    // Reviews are read in flow; only my own tickets ask the agent for context.
    expect(reviewGit.contextRequests).toEqual([]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("Enter on a ticket with uncommitted changes stashes them without asking", async () => {
  const ticketGit = createTestTicketGit(" M src/app.ts");
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          {
            id: "PROJ-7",
            summary: "Parked work",
            state: "Open",
            url: "https://youtrack.example.test/issue/PROJ-7",
          },
        ],
      })}
      createTicketGit={() => ticketGit.git}
      requestTicketContext={(_root, ticketId) => ticketGit.contextRequests.push(ticketId)}
    />,
    { width: 160, height: 24 },
  );
  try {
    await flush(setup);
    await flush(setup);
    await act(async () => {
      await setup.mockMouse.click(8, 4);
    });
    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    expect(await waitForFrame(setup, (frame) => frame.includes("On PROJ-7"))).toContain(
      "On PROJ-7 · new branch · main changes stashed",
    );
    expect(ticketGit.calls).toContainEqual([
      "stash",
      "push",
      "--include-untracked",
      "-m",
      "flow:main",
    ]);
    expect(ticketGit.calls).toContainEqual(["switch", "--no-track", "-c", "PROJ-7", "origin/main"]);
    expect(ticketGit.contextRequests).toEqual(["PROJ-7"]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("switching to a ticket that already has an overview does not ask the agent again", async () => {
  const ticketGit = createTestTicketGit("");
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          {
            id: "PROJ-7",
            summary: "Known ticket",
            state: "Open",
            url: "https://youtrack.example.test/issue/PROJ-7",
          },
        ],
      })}
      createTicketGit={() => ticketGit.git}
      requestTicketContext={(_root, ticketId) => ticketGit.contextRequests.push(ticketId)}
      readOverview={(_root, ticketId) => ({
        schema: 1,
        ticket: ticketId,
        writtenAt: new Date().toISOString(),
        overview: {
          summary: "Already understood.",
          why: [],
          todo: [],
          acceptance: [],
          code: [],
          questions: [],
          plan: [],
        },
      })}
    />,
    { width: 160, height: 24 },
  );
  try {
    await flush(setup);
    await flush(setup);
    await act(async () => {
      await setup.mockMouse.click(8, 4);
    });
    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    await waitForFrame(setup, (frame) => frame.includes("On PROJ-7"));
    expect(ticketGit.calls).toContainEqual(["switch", "--no-track", "-c", "PROJ-7", "origin/main"]);
    // The overview is already there, so the switch costs the agent nothing; X still asks.
    expect(ticketGit.contextRequests).toEqual([]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("the checked-out ticket keeps the rail while the cursor moves and the pane loses focus", async () => {
  const branchGit: GitRun = async (args) => ({
    ok: true,
    stdout: args.join(" ") === "branch --show-current" ? "PROJ-102-work" : "",
    stderr: "",
  });
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          { id: "PROJ-101", summary: "First", state: "Open", url: "https://example.test/PROJ-101" },
          {
            id: "PROJ-102",
            summary: "Current",
            state: "Open",
            url: "https://example.test/PROJ-102",
          },
        ],
      })}
      createTicketGit={() => branchGit}
      requestTicketContext={() => {}}
    />,
    { width: 160, height: 24 },
  );
  try {
    const railColor = (index: number) => {
      const rail = setup.renderer.root.findDescendantById(`workspace-rail-${index}`);
      if (!(rail instanceof BoxRenderable)) throw new Error(`Missing rail ${index}`);
      return rail.backgroundColor;
    };
    await waitForFrame(setup, (frame) => frame.includes("PROJ-102"));
    await flush(setup);
    await flush(setup);
    // The pane is unfocused, yet the current branch's ticket keeps its rail and the first
    // ticket, where selection would otherwise start, stays unmarked.
    expect(railColor(0)).toEqual(findWorkspaceRow(setup, 0).backgroundColor);
    expect(railColor(1)).not.toEqual(railColor(0));
    expect(findWorkspaceRow(setup, 1).backgroundColor).toEqual(
      findWorkspaceRow(setup, 0).backgroundColor,
    );
    const activeRail = railColor(1);
    const plainRow = findWorkspaceRow(setup, 0).backgroundColor;

    // Moving the cursor to another ticket only tints that row; the rail stays on the branch.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.typeText("k");
    });
    await flush(setup);
    expect(railColor(1)).toEqual(activeRail);
    expect(railColor(0)).not.toEqual(activeRail);
    expect(findWorkspaceRow(setup, 0).backgroundColor).not.toEqual(plainRow);
    expect(findWorkspaceRow(setup, 1).backgroundColor).toEqual(plainRow);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("ticket cards show their branch line totals at the right edge", async () => {
  const statsGit: GitRun = async (args) => {
    const joined = args.join(" ");
    const reply = (stdout: string) => ({ ok: true, stdout, stderr: "" });
    if (joined === "branch --show-current") return reply("main");
    if (joined.startsWith("for-each-ref") && args.includes("refs/heads/PROJ-101")) {
      return reply("refs/heads/PROJ-101-work");
    }
    if (joined.startsWith("for-each-ref") && args.includes("refs/heads/PROJ-102")) {
      return reply("refs/heads/PROJ-102");
    }
    if (joined === "diff --shortstat origin/main...PROJ-101-work") {
      return reply(" 2 files changed, 5 insertions(+), 2 deletions(-)");
    }
    if (joined === "diff --shortstat origin/main...PROJ-102") {
      return reply(" 1 file changed, 3 insertions(+)");
    }
    return reply("");
  };
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          { id: "PROJ-101", summary: "First", state: "Open", url: "https://example.test/PROJ-101" },
          {
            id: "PROJ-102",
            summary: "Second",
            state: "Open",
            url: "https://example.test/PROJ-102",
          },
          {
            id: "PROJ-103",
            summary: "No branch",
            state: "Open",
            url: "https://example.test/PROJ-103",
          },
        ],
      })}
      createTicketGit={() => statsGit}
      requestTicketContext={() => {}}
    />,
    { width: 160, height: 30 },
  );
  try {
    const frame = await waitForFrame(setup, (text) => text.includes("+5 −2"));
    // Each card pushes its totals to the right edge, away from the id.
    expect(frame).toMatch(/PROJ-101 {6,}\+5 −2/);
    expect(frame).toMatch(/PROJ-102 {6,}\+3 −0/);
    expect(frame).not.toMatch(/PROJ-103 +\+/);
    // Section headings keep only their ticket count.
    expect(frame).toMatch(/To do {6,}3/);
    expect(frame).not.toContain("+8 −2");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("an agent focus request jumps the review to that file and says so", async () => {
  const bootstrap = createTestVcsAppBootstrap({
    changesetId: "changeset:focus",
    files: [
      createTestDiffFile("alpha", "src/alpha.ts", "const alpha = 1;\n", "const alpha = 2;\n"),
      createTestDiffFile("beta", "src/beta.ts", "const beta = 1;\n", "const beta = 2;\n"),
    ],
  });
  let pending: FocusRequest | null = null;
  const setup = await testRender(
    <AppHost bootstrap={bootstrap} readAgentFocusRequest={() => pending} />,
    { width: 120, height: 20 },
  );
  try {
    await flush(setup);
    pending = { id: "focus-1", file: "src/beta.ts", line: 1 };
    const frame = await waitForFrame(
      setup,
      (text) => text.includes("Agent: look at src/beta.ts:1"),
      40,
    );
    expect(frame).toContain("Agent: look at src/beta.ts:1");

    pending = { id: "focus-2", file: "src/gone.ts" };
    expect(await waitForFrame(setup, (text) => text.includes("not in this review"), 40)).toContain(
      "Agent pointed at src/gone.ts, which is not in this review",
    );
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

/** Find one rendered workspace row by its selection index. */
function findWorkspaceRow(setup: Awaited<ReturnType<typeof testRender>>, index: number) {
  const row = setup.renderer.root.findDescendantById(`workspace-row-${index}`);
  if (!(row instanceof BoxRenderable)) throw new Error(`Missing workspace row ${index}`);
  return row;
}

/** Fake git that reports `main` with the given porcelain status and records every call. */
function createTestTicketGit(porcelainStatus: string) {
  const calls: string[][] = [];
  const contextRequests: string[] = [];
  const git: GitRun = async (args) => {
    calls.push(args);
    const joined = args.join(" ");
    if (joined === "branch --show-current") return { ok: true, stdout: "main", stderr: "" };
    if (joined === "status --porcelain") return { ok: true, stdout: porcelainStatus, stderr: "" };
    return { ok: true, stdout: "", stderr: "" };
  };
  return { calls, contextRequests, git };
}

test("h and g open the checked-out ticket and its MR without workspace focus, and gg still jumps", async () => {
  const branchGit: GitRun = async (args) => ({
    ok: true,
    stdout: args.join(" ") === "branch --show-current" ? "PROJ-102-work" : "",
    stderr: "",
  });
  const openedUrls: string[] = [];
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          { id: "PROJ-101", summary: "First", state: "Open", url: "https://example.test/PROJ-101" },
          {
            id: "PROJ-102",
            summary: "Current",
            state: "Open",
            url: "https://example.test/PROJ-102",
          },
        ],
      })}
      onOpenUrl={(url) => openedUrls.push(url)}
      createTicketGit={() => branchGit}
      requestTicketContext={() => {}}
      loadMergeRequests={async () => [
        {
          iid: 3602,
          state: "opened",
          sourceBranch: "PROJ-102-work",
          url: "https://gitlab.example.test/mr/3602",
          updatedAt: "2026-11-10T10:00:00Z",
          approved: false,
        },
      ]}
    />,
    { width: 160, height: 24 },
  );
  try {
    await waitForFrame(setup, (frame) => frame.includes("PROJ-102 · !3602"));
    await flush(setup);
    await act(async () => {
      await setup.mockInput.typeText("h");
    });
    expect(openedUrls).toEqual(["https://example.test/PROJ-102"]);

    // `gg` completes the hunk chord, so it must not open the MR as well.
    await act(async () => {
      await setup.mockInput.typeText("gg");
      await Bun.sleep(700);
    });
    expect(openedUrls).toEqual(["https://example.test/PROJ-102"]);

    await act(async () => {
      await setup.mockInput.typeText("g");
      await Bun.sleep(700);
    });
    expect(openedUrls).toEqual([
      "https://example.test/PROJ-102",
      "https://gitlab.example.test/mr/3602",
    ]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("g asks GitLab again when the ticket has no MR yet, and opens the one opened since", async () => {
  const branchGit: GitRun = async (args) => ({
    ok: true,
    stdout: args.join(" ") === "branch --show-current" ? "PROJ-102-work" : "",
    stderr: "",
  });
  const openedUrls: string[] = [];
  let mergeRequestLoads = 0;
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          {
            id: "PROJ-102",
            summary: "Current",
            state: "In Progress",
            url: "https://example.test/PROJ-102",
          },
        ],
      })}
      onOpenUrl={(url) => openedUrls.push(url)}
      createTicketGit={() => branchGit}
      requestTicketContext={() => {}}
      // The MR is pushed after flow started: the first load finds nothing.
      loadMergeRequests={async () =>
        ++mergeRequestLoads === 1
          ? []
          : [
              {
                iid: 3602,
                state: "opened",
                sourceBranch: "PROJ-102-work",
                url: "https://gitlab.example.test/mr/3602",
                updatedAt: "2026-11-10T10:00:00Z",
                approved: false,
              },
            ]
      }
    />,
    { width: 160, height: 24 },
  );
  try {
    await waitForFrame(setup, (frame) => frame.includes("PROJ-102"));
    await flush(setup);
    expect(mergeRequestLoads).toBe(1);

    await act(async () => {
      await setup.mockInput.typeText("g");
      await Bun.sleep(700);
    });
    expect(openedUrls).toEqual(["https://gitlab.example.test/mr/3602"]);
    // The card picks the MR up too.
    expect(await waitForFrame(setup, (frame) => frame.includes("PROJ-102 · !3602"))).toContain(
      "!3602",
    );
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("a ticket in review moves to Ready to merge with a check once someone approves its MR", async () => {
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          {
            id: "PROJ-201",
            summary: "Still waiting",
            state: "Review",
            url: "https://example.test/1",
          },
          {
            id: "PROJ-202",
            summary: "Approved one",
            state: "Review",
            url: "https://example.test/2",
          },
        ],
      })}
      createTicketGit={() => createTestTicketGit("").git}
      requestTicketContext={() => {}}
      loadMergeRequests={async () => [
        {
          iid: 501,
          state: "opened",
          sourceBranch: "PROJ-201-wait",
          url: "https://gitlab.example.test/mr/501",
          updatedAt: "2026-11-10T10:00:00Z",
          approved: false,
        },
        {
          iid: 502,
          state: "opened",
          sourceBranch: "PROJ-202-done",
          url: "https://gitlab.example.test/mr/502",
          updatedAt: "2026-11-10T10:00:00Z",
          approved: true,
        },
      ]}
    />,
    { width: 160, height: 30 },
  );
  try {
    const frame = await waitForFrame(setup, (current) => current.includes("Ready to merge"));
    const lines = frame.split("\n");
    const row = (text: string) => lines.findIndex((line) => line.includes(text));
    // Needs approval keeps the waiting one; the approved one sits under Ready to merge.
    expect(row("Needs approval")).toBeLessThan(row("Still waiting"));
    expect(row("Still waiting")).toBeLessThan(row("Ready to merge"));
    expect(row("Ready to merge")).toBeLessThan(row("Approved one"));
    expect(lines[row("Approved one")]).toContain("✓ Approved one");
    expect(frame).toContain("PROJ-202 · !502");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("a ticket in review whose MR was merged moves on once per session, with a status note", async () => {
  const closed: string[] = [];
  let taskLoads = 0;
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => {
        taskLoads += 1;
        return {
          kind: "ready",
          tasks: [
            {
              id: "PROJ-301",
              summary: "Merged work",
              state: "Review",
              url: "https://example.test/1",
            },
            {
              id: "PROJ-302",
              summary: "Still open",
              state: "Review",
              url: "https://example.test/2",
            },
          ],
        };
      }}
      createTicketGit={() => createTestTicketGit("").git}
      requestTicketContext={() => {}}
      loadMergeRequests={async () => [
        {
          iid: 601,
          state: "merged",
          sourceBranch: "PROJ-301-done",
          url: "https://gitlab.example.test/mr/601",
          updatedAt: "2026-11-10T10:00:00Z",
          approved: false,
        },
        {
          iid: 602,
          state: "opened",
          sourceBranch: "PROJ-302-wip",
          url: "https://gitlab.example.test/mr/602",
          updatedAt: "2026-11-10T10:00:00Z",
          approved: false,
        },
      ]}
      closeMergedTicket={async (ticketId) => {
        closed.push(ticketId);
        return { kind: "moved", state: "Done" };
      }}
    />,
    { width: 160, height: 24 },
  );
  try {
    expect(
      await waitForFrame(setup, (frame) => frame.includes("MR merged: PROJ-301 → Done")),
    ).toContain("MR merged: PROJ-301 → Done");
    expect(closed).toEqual(["PROJ-301"]);
    // Moving it reloads the tasks; the fixture still lists it, but it is not tried again.
    await flush(setup);
    expect(taskLoads).toBeGreaterThan(1);
    await act(async () => {
      await setup.mockInput.typeText("r");
    });
    await flush(setup);
    await flush(setup);
    expect(closed).toEqual(["PROJ-301"]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("C and P ask the agent to commit and open the MR for the checked-out ticket", async () => {
  const branchGit: GitRun = async (args) => ({
    ok: true,
    stdout: args.join(" ") === "branch --show-current" ? "PROJ-102-work" : "",
    stderr: "",
  });
  const commitRequests: (string | undefined)[] = [];
  const mergeRequestRequests: (string | undefined)[] = [];
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          { id: "PROJ-101", summary: "Other", state: "Open", url: "https://example.test/1" },
          {
            id: "PROJ-102",
            summary: "Current",
            state: "In Progress",
            url: "https://example.test/2",
          },
        ],
      })}
      createTicketGit={() => branchGit}
      requestTicketContext={() => {}}
      requestCommit={(_root, ticketId) => commitRequests.push(ticketId)}
      requestMergeRequestOpen={(_root, ticketId) => mergeRequestRequests.push(ticketId)}
    />,
    { width: 160, height: 24 },
  );
  try {
    await waitForFrame(setup, (frame) => frame.includes("PROJ-102"));
    await flush(setup);
    // The cursor sits on another ticket; both still act on the checked-out branch.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await act(async () => {
      await setup.mockInput.typeText("k");
    });
    await act(async () => {
      await setup.mockInput.typeText("C");
    });
    expect(commitRequests).toEqual(["PROJ-102"]);
    expect(
      await waitForFrame(setup, (frame) => frame.includes("Asked the agent to propose commits")),
    ).toContain("Asked the agent to propose commits");
    await act(async () => {
      await setup.mockInput.typeText("P");
    });
    expect(mergeRequestRequests).toEqual(["PROJ-102"]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("x opens the checked-out ticket's overview and X asks the agent to write one", async () => {
  const branchGit: GitRun = async (args) => ({
    ok: true,
    stdout: args.join(" ") === "branch --show-current" ? "PROJ-102-work" : "",
    stderr: "",
  });
  const contextRequests: string[] = [];
  const reviewRequests: [string, number | undefined][] = [];
  const overviewReads: string[] = [];
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          { id: "PROJ-101", summary: "First", state: "Open", url: "https://example.test/PROJ-101" },
          {
            id: "PROJ-102",
            summary: "Current",
            state: "In Progress",
            url: "https://example.test/PROJ-102",
          },
        ],
      })}
      createTicketGit={() => branchGit}
      requestTicketContext={(_root, ticketId) => contextRequests.push(ticketId)}
      requestReview={(_root, ticketId, mergeRequestIid) =>
        reviewRequests.push([ticketId, mergeRequestIid])
      }
      readOverview={(_root, ticketId) => {
        overviewReads.push(ticketId);
        return ticketId === "PROJ-102"
          ? {
              schema: 1,
              ticket: "PROJ-102",
              writtenAt: new Date().toISOString(),
              overview: {
                summary: "Keep the badge on one line for planners.",
                why: ["It wraps today"],
                todo: ["Clamp the badge width"],
                acceptance: ["Badge never wraps"],
                code: [{ path: "src/badge.tsx", note: "renders the badge" }],
                questions: ["Assumed only the map view"],
                plan: ["Measure the badge"],
              },
            }
          : null;
      }}
    />,
    { width: 180, height: 50 },
  );
  try {
    await waitForFrame(setup, (frame) => frame.includes("PROJ-102"));
    await flush(setup);
    expect(setup.captureCharFrame()).not.toContain("In one sentence");
    // Closed, the pane reads nothing from disk.
    expect(overviewReads).toEqual([]);

    await act(async () => {
      await setup.mockInput.typeText("x");
    });
    const frame = await waitForFrame(setup, (current) => current.includes("In one sentence"));
    expect(frame).toContain("PROJ-102 · In Progress");
    expect(frame).toContain("Keep the badge on one line for planners.");
    expect(frame).toContain("Acceptance criteria");
    expect(frame).toContain("src/badge.tsx");
    expect(frame).toContain("? Assumed only the map view");
    expect(frame).toContain("1. Measure the badge");

    // Moving the cursor never replaces the checked-out ticket's overview, and X still asks for it.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await act(async () => {
      await setup.mockInput.typeText("k");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("Keep the badge on one line for planners.");
    await act(async () => {
      await setup.mockInput.typeText("X");
    });
    expect(contextRequests).toEqual(["PROJ-102"]);
    // R acts on the cursor's card, and reviews my own ticket too; with no MR the agent reads its branch.
    await act(async () => {
      await setup.mockInput.typeText("R");
    });
    expect(reviewRequests).toEqual([["PROJ-101", undefined]]);

    await act(async () => {
      await setup.mockInput.typeText("x");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).not.toContain("In one sentence");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("a checked-out review shows the overview of the ticket it names, whatever the cursor does", async () => {
  const contextRequests: string[] = [];
  const reviewRequests: [string, number | undefined][] = [];
  const setup = await testRender(
    <AppHost
      bootstrap={{ ...createSidebarBootstrap(), initialShowOverview: true }}
      workspaceTasksLoader={async () => ({ kind: "ready", tasks: [] })}
      // The review's branch is checked out, so the Overview shows its ticket.
      createTicketGit={() => async (args) => ({
        ok: true,
        stdout: args.join(" ") === "branch --show-current" ? "PROJ-55-their-fix" : "",
        stderr: "",
      })}
      requestTicketContext={(_root, ticketId) => contextRequests.push(ticketId)}
      requestReview={(_root, ticketId, mergeRequestIid) =>
        reviewRequests.push([ticketId, mergeRequestIid])
      }
      readOverview={(_root, ticketId) =>
        ticketId === "PROJ-55"
          ? {
              schema: 1,
              ticket: "PROJ-55",
              writtenAt: new Date().toISOString(),
              overview: {
                summary: "Close the feeder selector to the supplied busbar.",
                why: [],
                todo: [],
                acceptance: ["The selector closes onto the supplied busbar."],
                code: [{ path: "src/feeder.ts", note: "Selector logic." }],
                questions: [],
                plan: ["Patch the selector."],
              },
            }
          : null
      }
      loadReviews={async () => ({
        kind: "ready",
        reviews: [
          {
            iid: 4100,
            title: "Fix the feeder selector",
            author: "teammate",
            sourceBranch: "PROJ-55-their-fix",
            targetBranch: "main",
            url: "https://gitlab.example.test/mr/4100",
          },
          {
            iid: 4101,
            title: "chore: bump deps",
            author: "teammate",
            sourceBranch: "bump-deps",
            targetBranch: "main",
            url: "https://gitlab.example.test/mr/4101",
          },
        ],
      })}
    />,
    { width: 180, height: 40 },
  );
  try {
    await waitForFrame(setup, (frame) => frame.includes("Fix the feeder"));
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    const frame = await waitForFrame(setup, (current) => current.includes("In one sentence"));
    expect(frame).toContain("!4100 · PROJ-55");
    expect(frame).toContain("Close the feeder selector to the supplied busbar.");
    // A review is judged against the ticket's goal, not how this checkout would build it.
    expect(frame).toContain("Acceptance criteria");
    expect(frame).not.toContain("Where in the code");
    expect(frame).not.toContain("Plan");

    await act(async () => {
      await setup.mockInput.typeText("X");
    });
    expect(contextRequests).toEqual(["PROJ-55"]);
    // R asks for a review of this MR, measured against the ticket it names.
    await act(async () => {
      await setup.mockInput.typeText("R");
    });
    expect(reviewRequests).toEqual([["PROJ-55", 4100]]);

    // The cursor moves to a review without a ticket; the Overview keeps the checked-out one.
    await act(async () => {
      await setup.mockInput.typeText("j");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("Close the feeder selector to the supplied busbar.");
    // Without a ticket there is nothing to review against.
    await act(async () => {
      await setup.mockInput.typeText("R");
    });
    expect(reviewRequests).toEqual([["PROJ-55", 4100]]);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("/ in the workspace narrows the cards, and Enter ends the search on the chosen card without switching", async () => {
  const openedUrls: string[] = [];
  const ticketGit = createTestTicketGit("");
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      onOpenUrl={(url) => openedUrls.push(url)}
      createTicketGit={() => ticketGit.git}
      issueUrl={(ticketId) => `https://youtrack.example.test/issue/${ticketId}`}
      workspaceTasksLoader={async () => ({
        kind: "ready",
        tasks: [
          {
            id: "PROJ-101",
            summary: "Clamp the badge",
            state: "Open",
            url: "https://example.test/PROJ-101",
          },
        ],
      })}
      loadReviews={async () => ({
        kind: "ready",
        reviews: [
          {
            iid: 4100,
            title: "Fix the feeder selector",
            author: "teammate",
            sourceBranch: "PROJ-55-their-fix",
            targetBranch: "main",
            url: "https://gitlab.example.test/mr/4100",
          },
          {
            iid: 4200,
            title: "OPS-12 Close the busbar gap",
            author: "other",
            sourceBranch: "busbar-gap",
            targetBranch: "main",
            url: "https://gitlab.example.test/mr/4200",
          },
        ],
      })}
    />,
    { width: 160, height: 30 },
  );
  try {
    await waitForFrame(setup, (frame) => frame.includes("!4200 · OPS-12"));
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await act(async () => {
      await setup.mockInput.typeText("/");
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.typeText("ops");
    });
    let frame = await waitForFrame(setup, (current) => !current.includes("Clamp the badge"));
    expect(frame).toContain("!4200 · OPS-12 · other");
    expect(frame).not.toContain("Fix the feeder selector");
    expect(frame).toContain("No matches");

    // Enter ends the search: every card comes back, the cursor stays on the match, and no switch.
    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    frame = await waitForFrame(setup, (current) => current.includes("Clamp the badge"));
    expect(frame).toContain("Fix the feeder selector");
    expect(frame).not.toContain("filter=ops");
    await act(async () => {
      await setup.mockInput.typeText("h");
    });
    expect(openedUrls).toEqual(["https://youtrack.example.test/issue/OPS-12"]);
    expect(ticketGit.calls.some((args) => args[0] === "switch")).toBe(false);

    // The next Enter switches to it like any other card.
    await act(async () => {
      await setup.mockInput.pressEnter();
    });
    await waitForFrame(setup, () => ticketGit.calls.some((args) => args.includes("busbar-gap")));
    expect(ticketGit.calls.some((args) => args.includes("busbar-gap"))).toBe(true);

    // Arrows pick among several matches while typing, and Escape keeps the cursor on the pick.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await act(async () => {
      await setup.mockInput.typeText("/");
    });
    await flush(setup);
    await act(async () => {
      // Every title has "the": the badge task, then both reviews.
      await setup.mockInput.typeText("the");
    });
    await act(async () => {
      await setup.mockInput.pressArrow("down");
    });
    await act(async () => {
      await setup.mockInput.pressEscape();
      await Bun.sleep(40);
    });
    await act(async () => {
      await setup.mockInput.pressEscape();
      await Bun.sleep(40);
    });
    await flush(setup);
    await act(async () => {
      await setup.mockInput.typeText("h");
    });
    expect(openedUrls.at(-1)).toBe("https://youtrack.example.test/issue/PROJ-55");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("a repository without integrations opens with the workspace and Overview closed", async () => {
  const setup = await testRender(
    <AppHost
      bootstrap={{ ...createSidebarBootstrap(), initialShowOverview: true }}
      workspaceConnected={false}
    />,
    { width: 220, height: 24 },
  );
  try {
    await flush(setup);
    expect(setup.renderer.root.findDescendantById("workspace-pane")).toBeUndefined();
    expect(setup.renderer.root.findDescendantById("overview-pane")).toBeUndefined();
    expect(setup.captureCharFrame()).toContain("alpha.ts");

    // Closed by default, not gone: S still opens the workspace.
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("To do");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("workspace explains why tasks are missing instead of showing an empty list", async () => {
  const setup = await testRender(
    <AppHost
      bootstrap={createSidebarBootstrap()}
      workspaceTasksLoader={async () => ({
        kind: "unconfigured",
        message: "Set youtrack.url in config",
      })}
    />,
    { width: 160, height: 24 },
  );
  try {
    await flush(setup);
    await flush(setup);
    expect(setup.captureCharFrame()).toContain("Set youtrack.url in config");
    expect(setup.captureCharFrame()).toContain("Reviews are not connected");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

function createTestDiffFile(
  id: string,
  path: string,
  before: string,
  after: string,
  withAgent = false,
) {
  return buildTestDiffFile({
    after,
    annotations: withAgent,
    before,
    context: 3,
    id,
    path,
  });
}

function createNumberedAssignmentLines(start: number, count: number, valueOffset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const lineNumber = start + index;
    return `export const line${String(lineNumber).padStart(2, "0")} = ${lineNumber + valueOffset};`;
  });
}

function createBootstrap(initialMode: LayoutMode = "split", pager = false): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:app-interactions",
    files: [
      createTestDiffFile(
        "alpha",
        "alpha.ts",
        "export const alpha = 1;\n",
        "export const alpha = 2;\nexport const add = true;\n",
        true,
      ),
      createTestDiffFile(
        "beta",
        "beta.ts",
        "export const beta = 1;\n",
        "export const betaValue = 1;\n",
      ),
    ],
    initialMode,
    pager,
  });
}

/** Sidebar-focused bootstrap without an annotation on alpha so `/alpha\.ts/g` counts stay stable. */
function createSidebarBootstrap(initialMode: LayoutMode = "split", pager = false): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:sidebar",
    files: [
      createTestDiffFile(
        "alpha",
        "alpha.ts",
        "export const alpha = 1;\n",
        "export const alpha = 2;\nexport const add = true;\n",
      ),
      createTestDiffFile(
        "beta",
        "beta.ts",
        "export const beta = 1;\n",
        "export const betaValue = 1;\n",
      ),
    ],
    initialMode,
    pager,
  });
}

function createSingleFileBootstrap(): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:app-single-file",
    files: [
      createTestDiffFile(
        "alpha",
        "alpha.ts",
        "export const alpha = 1;\n",
        "export const alpha = 2;\nexport const add = true;\n",
        true,
      ),
    ],
  });
}

/** Build a single-file fixture with one long changed line for wrap toggle interaction tests. */
function createWrapBootstrap(pager = false): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:app-wrap-interactions",
    files: [
      createTestDiffFile(
        "wrap",
        "wrap.ts",
        "export const message = 'short';\n",
        "export const message = 'this is a very long wrapped line for app interaction coverage';\n",
        true,
      ),
    ],
    pager,
  });
}

function createLineScrollBootstrap(pager = false): AppBootstrap {
  const before = lines(...createNumberedAssignmentLines(1, 18));
  const after = lines(...createNumberedAssignmentLines(1, 18, 100));

  return createTestVcsAppBootstrap({
    changesetId: "changeset:app-line-scroll",
    files: [createTestDiffFile("scroll", "scroll.ts", before, after, true)],
    pager,
  });
}

/** Build a two-hunk fixture with a deep inline note for CLI comment-navigation scroll tests. */
function createWrapScrollBootstrap(): AppBootstrap {
  const before = lines(...createNumberedAssignmentLines(1, 18));
  const after = lines(
    ...createNumberedAssignmentLines(1, 18, 100).map(
      (line) => `${line} // this is intentionally long wrap coverage for viewport anchoring`,
    ),
  );

  return createTestVcsAppBootstrap({
    changesetId: "changeset:app-wrap-scroll",
    files: [createTestDiffFile("wrap-scroll", "wrap-scroll.ts", before, after, true)],
  });
}

function createTwoFileHunkBootstrap(): AppBootstrap {
  const firstBeforeLines = createNumberedAssignmentLines(1, 16);
  const secondBeforeLines = createNumberedAssignmentLines(17, 16);

  return createTestVcsAppBootstrap({
    changesetId: "changeset:two-file-hunks",
    files: [
      createTestDiffFile(
        "first",
        "first.ts",
        lines(...firstBeforeLines),
        lines(...createNumberedAssignmentLines(1, 16, 100)),
        true,
      ),
      createTestDiffFile(
        "second",
        "second.ts",
        lines(...secondBeforeLines),
        lines(...createNumberedAssignmentLines(17, 16, 100)),
        true,
      ),
    ],
  });
}

/** Build a cross-file hunk-navigation fixture with adjacent long and short files. */
function createCrossFileHunkNavigationBootstrap(): AppBootstrap {
  const longBeforeLines = Array.from(
    { length: 342 },
    (_, index) => `line ${String(index + 1).padStart(3, "0")}`,
  );
  const longAfterLines = [...longBeforeLines];
  for (const lineNumber of [
    2, 21, 41, 61, 81, 101, 121, 141, 161, 181, 201, 221, 241, 261, 281, 301, 321, 341,
  ]) {
    longAfterLines[lineNumber - 1] = `line ${String(lineNumber).padStart(3, "0")} changed`;
  }

  const shortBeforeLines = [
    "// hunk 0   at the very top of the file",
    "export const top = 1;",
    "",
    "",
    ...Array.from({ length: 25 }, (_, index) => `// filler ${index + 1}`),
    "// hunk 1   mid-file",
    "export const mid = 3;",
    ...Array.from({ length: 25 }, (_, index) => `// tail filler ${index + 1}`),
    "// hunk 2   keeps the file tall enough to own the pane once its hunk rows are compact",
    "export const end = 5;",
  ];
  const shortAfterLines = [...shortBeforeLines];
  shortAfterLines[1] = "export const top = 2;";
  shortAfterLines[30] = "export const mid = 4;";
  shortAfterLines[57] = "export const end = 6;";

  return createTestVcsAppBootstrap({
    changesetId: "changeset:cross-file-hunk-navigation",
    files: [
      createTestDiffFile(
        "long-file",
        "long-file.txt",
        lines(...longBeforeLines),
        lines(...longAfterLines),
      ),
      createTestDiffFile(
        "short-file",
        "short-file.ts",
        lines(...shortBeforeLines),
        lines(...shortAfterLines),
      ),
    ],
  });
}

/** Build the issue #233 stress fixture: many files, separated hunks, and visible notes. */
function createRapidViewportLoopBootstrap(): AppBootstrap {
  const files = Array.from({ length: 10 }, (_, index) => {
    const fileIndex = index + 1;
    const start = fileIndex * 100 + 1;
    const beforeLines = createNumberedAssignmentLines(start, 90);
    const afterLines = [...beforeLines];

    afterLines[0] = `export const line${String(start).padStart(2, "0")} = ${start + 1000};`;
    afterLines[30] = `export const line${String(start + 30).padStart(2, "0")} = ${start + 3000};`;
    afterLines[60] = `export const line${String(start + 60).padStart(2, "0")} = ${start + 6000};`;

    const file = buildTestDiffFile({
      id: `rapid-${fileIndex}`,
      path: `rapid-${fileIndex}.ts`,
      before: lines(...beforeLines),
      after: lines(...afterLines),
      context: 3,
    });
    file.annotations = [
      { newRange: [start, start], summary: `note start ${fileIndex}` },
      { newRange: [start + 30, start + 30], summary: `note middle ${fileIndex}` },
      { newRange: [start + 60, start + 60], summary: `note late ${fileIndex}` },
    ];
    return file;
  });

  return createTestVcsAppBootstrap({
    changesetId: "changeset:rapid-viewport",
    files,
    vcsOptions: { mode: "stack" },
    initialMode: "stack",
  });
}

function createCollapsedTopBootstrap(): AppBootstrap {
  const beforeLines = Array.from(
    { length: 400 },
    (_, index) => `export const line${String(index + 1).padStart(3, "0")} = ${index + 1};`,
  );
  const afterLines = [...beforeLines];
  afterLines[365] = "export const line366 = 9999;";

  return createTestVcsAppBootstrap({
    changesetId: "changeset:collapsed-top",
    files: [
      createTestDiffFile(
        "late",
        "src/ui/components/panes/DiffPane.tsx",
        lines(...beforeLines),
        lines(...afterLines),
      ),
      createTestDiffFile(
        "second",
        "other.ts",
        lines("export const other = 1;"),
        lines("export const other = 2;"),
      ),
    ],
  });
}

async function flush(setup: Awaited<ReturnType<typeof testRender>>) {
  await act(async () => {
    await setup.renderOnce();
    await Bun.sleep(0);
    await setup.renderOnce();
  });
}

/** Let wrap-toggle renders and follow-up layout retries settle before asserting on the frame. */
async function settleWrapToggle(setup: Awaited<ReturnType<typeof testRender>>) {
  await flush(setup);
  await act(async () => {
    await Bun.sleep(80);
    await setup.renderOnce();
  });
}

/** Poll rendered frames until async repaints satisfy one assertion. */
async function waitForFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (frame: string) => boolean,
  attempts = 8,
) {
  let frame = setup.captureCharFrame();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate(frame)) {
      return frame;
    }

    await act(async () => {
      await Bun.sleep(30);
      await setup.renderOnce();
    });
    frame = setup.captureCharFrame();
  }

  return frame;
}

async function pressHunkNavigationKey(
  setup: Awaited<ReturnType<typeof testRender>>,
  key: "J" | "K",
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      await setup.mockInput.typeText(key);
    });
    await flush(setup);
  }
}

function firstCrossFileHunkNavigationHeader(frame: string) {
  return (
    frame
      .split("\n")
      .map((line) => line.slice(34).trim())
      .find((line) => line.includes("long-file.txt") || line.includes("short-file.ts")) ?? ""
  );
}

function firstVisibleAddedLine(frame: string) {
  return frame.match(/line\d{2} = 1\d{2}/)?.[0] ?? null;
}

function firstVisibleSourceLineNumber(frame: string) {
  return frame.match(/line(\d{2}) =/)?.[1] ?? null;
}

/**
 * Line number of the first numbered row on screen. It lives in the gutter, which horizontal code
 * scrolling never moves, so it pins the vertical position even after shift-scrolling.
 */
function firstVisibleGutterLineNumber(frame: string) {
  return frame.match(/^\s*(\d+) {3}/m)?.[1] ?? null;
}

describe("App interactions", () => {
  test("rapid hunk navigation and wheel scrolling do not recurse through viewport updates", async () => {
    const updateDepthErrors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (args.some((arg) => String(arg).includes("Maximum update depth exceeded"))) {
        updateDepthErrors.push(args.map(String).join(" "));
      }
      originalError(...args);
    };

    const setup = await testRender(<AppHost bootstrap={createRapidViewportLoopBootstrap()} />, {
      width: 220,
      height: 12,
    });

    try {
      await flush(setup);
      await flush(setup);
      await flush(setup);
      await flush(setup);

      // Regression coverage for issue #233 / PR #242. This intentionally combines the inputs
      // that made the old React/OpenTUI feedback loop reproducible: stack layout, many hunks,
      // visible agent notes, repeated next-hunk jumps, and bursty wheel scrolling.
      for (let batch = 0; batch < 2; batch += 1) {
        await act(async () => {
          for (let index = 0; index < 6; index += 1) {
            await setup.mockInput.typeText("]");
          }
        });
        await flush(setup);
        await flush(setup);
      }

      for (let batch = 0; batch < 2; batch += 1) {
        await act(async () => {
          for (let index = 0; index < 4; index += 1) {
            await setup.mockMouse.scroll(120, 7, "down");
          }
        });
        await flush(setup);
        await flush(setup);
      }

      expect(updateDepthErrors).toEqual([]);
    } finally {
      console.error = originalError;
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  }, 20_000);

  test("keyboard shortcuts toggle line numbers and hunk metadata", async () => {
    const bootstrap = createSingleFileBootstrap();
    bootstrap.initialShowLineNumbers = true;

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, {
      width: 240,
      height: 24,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      // Comments are always rendered now; there's no toggle to flip them off.
      expect(frame).toContain("Annotation for alpha.ts");
      expect(frame).toContain("Why alpha.ts changed");
      expect(frame).toContain("1   export const alpha = 1;");

      // `l` hides the numbers but keeps their margin, so the code does not move.
      await act(async () => {
        await setup.mockInput.typeText("l");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect(frame).not.toContain("1   export const alpha = 1;");
      expect(frame).toContain("    export const alpha = 1;");

      await act(async () => {
        await setup.mockInput.typeText("m");
      });
      await flush(setup);

      // Hunk ranges are hidden by default; `m` brings the metadata rows back.
      frame = setup.captureCharFrame();
      expect(frame).toContain("@@ -1,1 +1,2 @@");
      expect(frame).toContain("    export const alpha = 1;");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("keyboard shortcut can wrap long lines in the app", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap()} />, {
      width: 174,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("interaction coverage");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect(frame).toContain("this is a");
      expect(frame).toContain("long wrapped line");
      expect(frame).toContain("coverage");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("pager mode keyboard shortcut can wrap long lines", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap(true)} />, {
      width: 140,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("interaction coverage");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect(frame).toContain("this is a");
      expect(frame).toContain("long wrapped line");
      expect(frame).toContain("coverage");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("keyboard shortcut can toggle line wrapping on, off, and on again", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap()} />, {
      width: 102,
      height: 24,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("coverage';");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await settleWrapToggle(setup);

      frame = await waitForFrame(setup, (nextFrame) => nextFrame.includes("coverage';"));
      // Assert on a suffix fragment that only appears once the long line has actually wrapped;
      // this is more stable than expecting the full sentence to remain on one terminal row.
      expect(frame).toContain("wrapped line");
      expect(frame).toContain("age';");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await settleWrapToggle(setup);

      frame = await waitForFrame(setup, (nextFrame) => !nextFrame.includes("coverage';"));
      expect(frame).not.toContain("coverage';");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await settleWrapToggle(setup);

      frame = await waitForFrame(setup, (nextFrame) => nextFrame.includes("coverage';"));
      expect(frame).toContain("wrapped line");
      expect(frame).toContain("age';");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("left and right arrows can reveal offscreen code columns in nowrap mode", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap()} />, {
      width: 92,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("this is a");
      expect(frame).not.toContain("interaction coverage");

      for (let index = 0; index < 64; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("right");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("interaction coverage")) {
          break;
        }
      }

      expect(frame).toContain("interaction coverage");
      expect(frame).not.toContain("this is a");

      for (let index = 0; index < 64; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("left");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("this is a")) {
          break;
        }
      }

      expect(frame).toContain("this is a");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("shift plus left and right arrows scroll code horizontally faster", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap()} />, {
      width: 92,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("this is a");
      expect(frame).not.toContain("interaction coverage");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("right", { shift: true });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("interaction coverage")) {
          break;
        }
      }

      expect(frame).toContain("interaction coverage");
      expect(frame).not.toContain("this is a");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("left", { shift: true });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("this is a")) {
          break;
        }
      }

      expect(frame).toContain("this is a");
      expect(frame).not.toContain("interaction coverage");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("shift plus mouse wheel scrolls code horizontally", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap()} />, {
      width: 92,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("this is a");
      expect(frame).not.toContain("interaction coverage");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockMouse.scroll(60, 10, "down", { modifiers: { shift: true } });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("interaction coverage")) {
          break;
        }
      }

      expect(frame).toContain("interaction coverage");
      expect(frame).not.toContain("this is a");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockMouse.scroll(60, 10, "up", { modifiers: { shift: true } });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("this is a")) {
          break;
        }
      }

      expect(frame).toContain("this is a");
      expect(frame).not.toContain("interaction coverage");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("shift plus mouse wheel does not move the vertical review position", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapScrollBootstrap()} />, {
      width: 92,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      const initialTopLine = firstVisibleGutterLineNumber(frame);
      expect(initialTopLine).toBeTruthy();
      expect(frame).not.toContain("viewport anchoring");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockMouse.scroll(60, 10, "down", { modifiers: { shift: true } });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("viewport anchoring")) {
          break;
        }
      }

      expect(frame).toContain("viewport anchoring");
      expect(firstVisibleGutterLineNumber(frame)).toBe(initialTopLine);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("shift plus native horizontal wheel events do not move the vertical review position", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapScrollBootstrap()} />, {
      width: 92,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      const initialTopLine = firstVisibleGutterLineNumber(frame);
      expect(initialTopLine).toBeTruthy();
      expect(frame).not.toContain("viewport anchoring");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockMouse.scroll(60, 10, "right", { modifiers: { shift: true } });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("viewport anchoring")) {
          break;
        }
      }

      expect(frame).toContain("viewport anchoring");
      expect(firstVisibleGutterLineNumber(frame)).toBe(initialTopLine);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("wrap toggles reset the horizontal code offset", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapBootstrap()} />, {
      width: 92,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("this is a");

      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("right", { shift: true });
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("interaction coverage")) {
          break;
        }
      }

      expect(frame).toContain("interaction coverage");
      expect(frame).not.toContain("this is a");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await settleWrapToggle(setup);

      frame = await waitForFrame(setup, (nextFrame) => nextFrame.includes("overage';"));
      expect(frame).toContain("this is a");
      expect(frame).toContain("long wrapped line");
      expect(frame).toContain("overage';");

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await settleWrapToggle(setup);

      frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("this is a") && !nextFrame.includes("interaction coverage"),
      );
      expect(frame).toContain("this is a");
      expect(frame).not.toContain("interaction coverage");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("bootstrap preferences initialize the visible view state", async () => {
    const setup = await testRender(
      <AppHost
        bootstrap={{
          input: {
            kind: "vcs",
            staged: false,
            options: {
              mode: "split",
            },
          },
          changeset: {
            id: "changeset:bootstrap-prefs",
            sourceLabel: "repo",
            title: "repo working tree",
            files: [
              createTestDiffFile(
                "prefs",
                "prefs.ts",
                "export const message = 'short';\n",
                "export const message = 'this is a very long wrapped line for bootstrap preference coverage';\nexport const added = true;\n",
                true,
              ),
            ],
          },
          initialMode: "split",
          initialTheme: "paper",
          initialShowLineNumbers: false,
          initialWrapLines: true,
          initialShowHunkHeaders: false,
        }}
      />,
      { width: 140, height: 20 },
    );

    try {
      await flush(setup);

      const frame = setup.captureCharFrame();
      expect(frame).toContain("Annotation");
      expect(frame).toContain("Annotation for prefs.ts");
      expect(frame).toContain("Why prefs.ts changed");
      expect(frame).not.toContain("@@ -1,1 +1,2 @@");
      expect(frame).not.toContain("1   export const message");
      // Notes anchor at the hunk bottom now, so the card sits below the last hunk row.
      expect(frame.indexOf("Annotation")).toBeGreaterThan(
        frame.indexOf("export const added = true;"),
      );
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("reload shortcut reloads the current file diff from disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hunk-reload-"));
    const left = join(dir, "before.ts");
    const right = join(dir, "after.ts");

    writeFileSync(left, "export const answer = 41;\n");
    writeFileSync(right, "export const answer = 42;\n");

    const bootstrap = await loadAppBootstrap({
      kind: "diff",
      left,
      right,
      options: {
        mode: "split",
      },
    });

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, {
      width: 220,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("export const added = true;");

      writeFileSync(right, "export const answer = 42;\nexport const added = true;\n");

      await act(async () => {
        await setup.mockInput.typeText("r");
      });

      let refreshed = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("export const added = true;")) {
          refreshed = true;
          break;
        }
        await Bun.sleep(25);
      }

      expect(refreshed).toBe(true);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("watch mode reloads the current file diff from disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hunk-watch-"));
    const left = join(dir, "before.ts");
    const right = join(dir, "after.ts");

    writeFileSync(left, "export const answer = 41;\n");
    writeFileSync(right, "export const answer = 42;\n");

    const bootstrap = await loadAppBootstrap({
      kind: "diff",
      left,
      right,
      options: {
        mode: "split",
        watch: true,
      },
    });

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, {
      width: 220,
      height: 20,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("export const added = true;");

      writeFileSync(right, "export const answer = 42;\nexport const added = true;\n");

      let refreshed = false;
      // Watch mode checks once a second, off the UI thread; allow a few checks to land.
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("export const added = true;")) {
          refreshed = true;
          break;
        }
        await Bun.sleep(25);
      }

      expect(refreshed).toBe(true);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("comments are visible by default across every visible review file", async () => {
    const bootstrap = createBootstrap();
    bootstrap.changeset.files[1]!.annotations = [
      {
        newRange: [1, 1],
        summary: "Annotation for beta.ts",
        rationale: "Why beta.ts changed",
      },
    ];

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, { width: 240, height: 32 });

    try {
      await flush(setup);

      const frame = setup.captureCharFrame();
      expect(frame).toContain("Annotation for alpha.ts");
      expect(frame).toContain("Why alpha.ts changed");
      expect(frame).toContain("Annotation for beta.ts");
      expect(frame).toContain("Why beta.ts changed");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("arrow keys scroll the review pane line by line", async () => {
    const setup = await testRender(<AppHost bootstrap={createLineScrollBootstrap()} />, {
      width: 220,
      height: 10,
    });

    try {
      await flush(setup);

      const initialFrame = setup.captureCharFrame();
      expect(initialFrame).toContain("line01");
      expect(initialFrame).not.toContain("line08");

      let frame = initialFrame;
      for (let index = 0; index < 24; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("down");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("line08") && !frame.includes("line01")) {
          break;
        }
      }

      expect(frame).toContain("line08");
      expect(frame).not.toContain("line01");

      for (let index = 0; index < 12; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("up");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("line01")) {
          break;
        }
      }

      expect(frame).toContain("line01");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("the first down-arrow step advances content under the always-pinned file header when the file starts mid-way", async () => {
    const setup = await testRender(<AppHost bootstrap={createCollapsedTopBootstrap()} />, {
      width: 220,
      height: 8,
    });

    try {
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      let frame = setup.captureCharFrame();
      expect(frame).toContain("DiffPane.tsx");
      // Folds at a file's top take no rows, so the body starts right under the pinned header.
      const firstBodyRow = frame.split("\n")[2];
      expect(firstBodyRow).toContain("export const line363 = 363;");

      await act(async () => {
        await setup.mockInput.pressArrow("down");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      frame = await waitForFrame(setup, (nextFrame) => nextFrame.split("\n")[2] !== firstBodyRow);
      expect(frame).toContain("DiffPane.tsx");
      expect(frame.split("\n")[2]).toContain("export const line364 = 364;");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("one-line down then up at the top restores the first body row beneath the pinned file header", async () => {
    const setup = await testRender(<AppHost bootstrap={createCollapsedTopBootstrap()} />, {
      width: 220,
      height: 7,
    });

    try {
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      const initialFrame = setup.captureCharFrame();
      const initialHeaderCount = (initialFrame.match(/DiffPane\.tsx/g) ?? []).length;
      const firstBodyRow = initialFrame.split("\n")[2];

      await act(async () => {
        await setup.mockInput.pressArrow("down");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      let frame = await waitForFrame(
        setup,
        (nextFrame) => nextFrame.split("\n")[2] !== firstBodyRow,
      );
      expect(frame.split("\n")[2]).not.toBe(firstBodyRow);

      await act(async () => {
        await setup.mockInput.pressArrow("up");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.split("\n")[2] === firstBodyRow &&
          (nextFrame.match(/DiffPane\.tsx/g) ?? []).length === initialHeaderCount,
      );
      expect(frame.split("\n")[2]).toBe(firstBodyRow);
      expect((frame.match(/DiffPane\.tsx/g) ?? []).length).toBe(initialHeaderCount);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("pager mode arrow keys also scroll line by line", async () => {
    const setup = await testRender(<AppHost bootstrap={createLineScrollBootstrap(true)} />, {
      width: 220,
      height: 8,
    });

    try {
      await flush(setup);

      const initialFrame = setup.captureCharFrame();
      expect(initialFrame).toContain("line01");
      expect(initialFrame).not.toContain("line08");

      let frame = initialFrame;
      for (let index = 0; index < 12; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("down");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("line08")) {
          break;
        }
      }

      expect(frame).toContain("line08");
      expect(frame).not.toContain("line01");

      for (let index = 0; index < 12; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("up");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("line01")) {
          break;
        }
      }

      expect(frame).toContain("line01");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("toggling wrap preserves the current viewport anchor instead of snapping to the top", async () => {
    const setup = await testRender(<AppHost bootstrap={createWrapScrollBootstrap()} />, {
      width: 102,
      height: 10,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("line01 = 101");
      expect(frame).not.toContain("line08 = 108");

      for (let index = 0; index < 24; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("down");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("line08 = 108") && !frame.includes("line01 = 101")) {
          break;
        }
      }

      expect(frame).toContain("line08 = 108");
      expect(frame).not.toContain("line01 = 101");
      const anchoredLine = firstVisibleAddedLine(frame);
      expect(anchoredLine).not.toBeNull();

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      frame = setup.captureCharFrame();
      expect(frame).toContain(anchoredLine!);
      expect(firstVisibleAddedLine(frame)).toBe(anchoredLine);

      await act(async () => {
        await setup.mockInput.typeText("w");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      frame = setup.captureCharFrame();
      expect(frame).toContain(anchoredLine!);
      expect(firstVisibleAddedLine(frame)).toBe(anchoredLine);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("layout toggles preserve the current viewport anchor across split and stack", async () => {
    const setup = await testRender(<AppHost bootstrap={createLineScrollBootstrap()} />, {
      width: 220,
      height: 10,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("line01 = 101");
      expect(frame).not.toContain("line08 = 108");

      for (let index = 0; index < 24; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("down");
        });
        await flush(setup);
        frame = setup.captureCharFrame();
        if (frame.includes("line08 = 108") && !frame.includes("line01 = 101")) {
          break;
        }
      }

      expect(frame).toContain("line08 = 108");
      expect(frame).not.toContain("line01 = 101");
      const anchoredLineNumber = firstVisibleSourceLineNumber(frame);
      expect(anchoredLineNumber).not.toBeNull();

      await act(async () => {
        await setup.mockInput.typeText("2");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      frame = setup.captureCharFrame();
      expect(frame).toContain(`line${anchoredLineNumber} =`);
      expect(firstVisibleSourceLineNumber(frame)).toBe(anchoredLineNumber);

      await act(async () => {
        await setup.mockInput.typeText("1");
      });
      await flush(setup);
      await act(async () => {
        await Bun.sleep(80);
        await setup.renderOnce();
      });

      frame = setup.captureCharFrame();
      expect(frame).toContain(`line${anchoredLineNumber} =`);
      expect(firstVisibleSourceLineNumber(frame)).toBe(anchoredLineNumber);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("Space scrolls down by viewport", async () => {
    // Create a file with many lines so Space has room to scroll
    const before =
      Array.from(
        { length: 50 },
        (_, index) => `export const line${String(index + 1).padStart(2, "0")} = ${index + 1};`,
      ).join("\n") + "\n";
    const after =
      Array.from(
        { length: 50 },
        (_, index) => `export const line${String(index + 1).padStart(2, "0")} = ${index + 1001};`,
      ).join("\n") + "\n";

    const bootstrap: AppBootstrap = {
      input: {
        kind: "vcs",
        staged: false,
        options: {
          mode: "split",
        },
      },
      changeset: {
        id: "changeset:space-scroll",
        sourceLabel: "repo",
        title: "repo working tree",
        files: [createTestDiffFile("space", "space.ts", before, after)],
      },
      initialMode: "split",
      initialTheme: "midnight",
    };

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, {
      width: 220,
      height: 12,
    });

    try {
      await flush(setup);
      setup.captureCharFrame();

      await act(async () => {
        await setup.mockInput.pressKey(" ");
      });
      await flush(setup);

      const frame = setup.captureCharFrame();
      expect(frame).toContain("export const line");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("PageUp scrolls up by viewport", async () => {
    const before =
      Array.from(
        { length: 50 },
        (_, index) => `export const line${String(index + 1).padStart(2, "0")} = ${index + 1};`,
      ).join("\n") + "\n";
    const after =
      Array.from(
        { length: 50 },
        (_, index) => `export const line${String(index + 1).padStart(2, "0")} = ${index + 1001};`,
      ).join("\n") + "\n";

    const bootstrap: AppBootstrap = {
      input: {
        kind: "vcs",
        staged: false,
        options: {
          mode: "split",
        },
      },
      changeset: {
        id: "changeset:pageup-scroll",
        sourceLabel: "repo",
        title: "repo working tree",
        files: [createTestDiffFile("pageup", "pageup.ts", before, after)],
      },
      initialMode: "split",
      initialTheme: "midnight",
    };

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, {
      width: 220,
      height: 12,
    });

    try {
      await flush(setup);

      await act(async () => {
        await setup.mockInput.pressKey(" ");
      });
      await flush(setup);
      setup.captureCharFrame();

      await act(async () => {
        await setup.mockInput.pressKeys([PAGE_UP_SEQUENCE]);
      });
      await flush(setup);

      const frame = setup.captureCharFrame();
      expect(frame).toContain("export const line");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("new shortcuts d, u, f, and Shift+Space are accepted without errors", async () => {
    const before =
      Array.from(
        { length: 50 },
        (_, index) => `export const line${String(index + 1).padStart(2, "0")} = ${index + 1};`,
      ).join("\n") + "\n";
    const after =
      Array.from(
        { length: 50 },
        (_, index) => `export const line${String(index + 1).padStart(2, "0")} = ${index + 1001};`,
      ).join("\n") + "\n";

    const bootstrap: AppBootstrap = {
      input: {
        kind: "vcs",
        staged: false,
        options: {
          mode: "split",
        },
      },
      changeset: {
        id: "changeset:half-scroll",
        sourceLabel: "repo",
        title: "repo working tree",
        files: [createTestDiffFile("half", "half.ts", before, after)],
      },
      initialMode: "split",
      initialTheme: "midnight",
    };

    const setup = await testRender(<AppHost bootstrap={bootstrap} />, {
      width: 220,
      height: 12,
      otherModifiersMode: true,
    });

    try {
      await flush(setup);

      await act(async () => {
        await setup.mockInput.pressKey("d");
      });
      await flush(setup);
      let frame = setup.captureCharFrame();
      expect(frame).toContain("export const line");

      await act(async () => {
        await setup.mockInput.pressKey("u");
      });
      await flush(setup);
      frame = setup.captureCharFrame();
      expect(frame).toContain("export const line");

      await act(async () => {
        await setup.mockInput.pressKey("f");
      });
      await flush(setup);
      frame = setup.captureCharFrame();
      expect(frame).toContain("export const line");

      await act(async () => {
        await setup.mockInput.pressKey(" ", { shift: true });
      });
      await flush(setup);
      frame = setup.captureCharFrame();
      expect(frame).toContain("export const line");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("filter focus accepts typed input and narrows the visible file set", async () => {
    const setup = await testRender(<AppHost bootstrap={createBootstrap()} />, {
      width: 240,
      height: 24,
    });

    try {
      await flush(setup);

      await act(async () => {
        await setup.mockInput.pressTab();
      });
      await flush(setup);
      await act(async () => {
        await setup.mockInput.typeText("zzz");
      });
      await flush(setup);

      const frame = setup.captureCharFrame();
      expect(frame).toContain("filter:");
      expect(frame).toContain("zzz");
      expect(frame).toContain("No files match the current filter.");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("filtering away the selected file reselects the first visible match", async () => {
    const setup = await testRender(<AppHost bootstrap={createBootstrap()} />, {
      width: 240,
      height: 24,
    });

    try {
      await flush(setup);

      await act(async () => {
        await setup.mockInput.pressTab();
      });
      await flush(setup);
      await act(async () => {
        await setup.mockInput.typeText("beta");
      });
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).toContain("filter:");
      expect(frame).toContain("beta");
      expect((frame.match(/beta\.ts/g) ?? []).length).toBeGreaterThanOrEqual(1);
      expect(frame).not.toContain("Annotation for alpha.ts");

      await act(async () => {
        await setup.mockInput.pressTab();
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect(frame).toContain("filter=beta");
      expect(frame).toContain("beta.ts");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("the file tree and the Overview open at startup when the view asks for them", async () => {
    const setup = await testRender(
      <AppHost
        bootstrap={{
          ...createSidebarBootstrap(),
          initialShowFileTree: true,
          initialShowOverview: true,
        }}
      />,
      { width: 240, height: 24 },
    );

    try {
      await flush(setup);
      const frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(2);
      expect(setup.renderer.root.findDescendantById("overview-pane")).toBeDefined();
      expect(frame).toContain("Overview");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("sidebar can start closed and toggle on and back off", async () => {
    const setup = await testRender(<AppHost bootstrap={createSidebarBootstrap()} />, {
      width: 240,
      height: 24,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(2);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("pager mode can toggle the sidebar file tree", async () => {
    const setup = await testRender(<AppHost bootstrap={createSidebarBootstrap("auto", true)} />, {
      width: 220,
      height: 24,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("File  View  Navigate  Theme  Agent  Help");
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect(frame).not.toContain("File  View  Navigate  Theme  Agent  Help");
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(2);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("sidebar shortcut can force the sidebar open when responsive layout hides it", async () => {
    const setup = await testRender(<AppHost bootstrap={createSidebarBootstrap("auto")} />, {
      width: 160,
      height: 24,
    });

    try {
      await flush(setup);

      let frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(2);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("hunk navigation makes the destination file own the top of the review pane", async () => {
    const setup = await testRender(<AppHost bootstrap={createTwoFileHunkBootstrap()} />, {
      width: 220,
      height: 10,
    });

    try {
      await flush(setup);
      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      for (let index = 0; index < 10; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("down");
        });
        await flush(setup);
      }

      let frame = setup.captureCharFrame();
      expect(frame).toContain("first.ts");

      await act(async () => {
        await setup.mockInput.typeText("J");
      });
      await flush(setup);

      frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("second.ts") && (nextFrame.match(/first\.ts/g) ?? []).length === 1,
        24,
      );
      expect(frame).toContain("second.ts");
      expect((frame.match(/first\.ts/g) ?? []).length).toBe(1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("forward cross-file hunk navigation keeps the destination file owning the review pane", async () => {
    const setup = await testRender(
      <AppHost bootstrap={createCrossFileHunkNavigationBootstrap()} />,
      {
        width: 120,
        height: 14,
      },
    );

    try {
      await flush(setup);
      await pressHunkNavigationKey(setup, "J", 18);

      let frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("short-file.ts") && nextFrame.includes("export const top = 2;"),
        24,
      );
      expect(firstCrossFileHunkNavigationHeader(frame)).toContain("short-file.ts");

      await pressHunkNavigationKey(setup, "J", 1);
      frame = await waitForFrame(
        setup,
        (nextFrame) => nextFrame.includes("export const mid = 4;"),
        24,
      );

      expect(firstCrossFileHunkNavigationHeader(frame)).toContain("short-file.ts");
      expect(frame).not.toContain("line 341 changed");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("backward cross-file hunk navigation reveals the target hunk instead of the file top", async () => {
    const setup = await testRender(
      <AppHost bootstrap={createCrossFileHunkNavigationBootstrap()} />,
      {
        width: 120,
        height: 16,
      },
    );

    try {
      await flush(setup);
      await pressHunkNavigationKey(setup, "J", 19);
      await waitForFrame(setup, (nextFrame) => nextFrame.includes("export const mid = 4;"), 24);

      await pressHunkNavigationKey(setup, "K", 2);
      const frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("line 341 changed") || nextFrame.includes("line 002 changed"),
        24,
      );

      expect(frame).toContain("line 341 changed");
      expect(frame).not.toContain("line 002 changed");
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("clicking a sidebar file makes that file own the top of the review pane", async () => {
    const setup = await testRender(<AppHost bootstrap={createTwoFileHunkBootstrap()} />, {
      width: 220,
      height: 9,
    });

    try {
      await flush(setup);
      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await flush(setup);

      // Move partway into the first file so ownership can visibly change on sidebar selection.
      for (let index = 0; index < 8; index += 1) {
        await act(async () => {
          await setup.mockInput.pressArrow("down");
        });
        await flush(setup);
      }

      const tree = setup.renderer.root.findDescendantById("file-tree-pane");
      if (!tree) throw new Error("Missing file tree");
      await act(async () => {
        // Click inside the second file row of the file tree, which sits at the right edge.
        await setup.mockMouse.click(tree.x + 3, 4);
      });
      await flush(setup);

      const frame = await waitForFrame(
        setup,
        (nextFrame) =>
          nextFrame.includes("second.ts") && (nextFrame.match(/first\.ts/g) ?? []).length === 1,
      );
      expect(frame).toContain("second.ts");
      expect((frame.match(/first\.ts/g) ?? []).length).toBe(1);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("quit shortcuts route through the provided onQuit handler in regular and pager modes", async () => {
    const regularQuit = mock(() => undefined);
    const regularSetup = await testRender(
      <AppHost bootstrap={createBootstrap()} onQuit={regularQuit} />,
      { width: 220, height: 24 },
    );

    try {
      await flush(regularSetup);
      await act(async () => {
        await regularSetup.mockInput.typeText("q");
      });
      await flush(regularSetup);

      expect(regularQuit).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        regularSetup.renderer.destroy();
      });
    }

    const pagerQuit = mock(() => undefined);
    const pagerSetup = await testRender(
      <AppHost bootstrap={createBootstrap("auto", true)} onQuit={pagerQuit} />,
      { width: 180, height: 20 },
    );

    try {
      await flush(pagerSetup);
      await act(async () => {
        await pagerSetup.mockInput.typeText("q");
      });
      await flush(pagerSetup);

      expect(pagerQuit).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        pagerSetup.renderer.destroy();
      });
    }
  });
});
