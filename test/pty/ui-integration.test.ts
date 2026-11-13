import { join } from "node:path";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { hasSplitDiffRowTest } from "../helpers/diff-frame";
import { createPtyHarness, ptyTimeouts } from "./harness";
import { runCommentsAdd, runCommentsReply } from "../../src/core/cliComments";

const harness = createPtyHarness();
const ptyDescribe = process.env.FLOW_RUN_PTY_TESTS === "1" ? describe : describe.skip;

/**
 * Locally we want fast feedback when something is wrong; in CI we want enough
 * headroom that flakes don't trip the suite. `ptyTimeouts` resolves both
 * windows from a single env-aware source so individual tests stay tight.
 */
setDefaultTimeout(ptyTimeouts.suite);

afterEach(() => {
  harness.cleanup();
});

ptyDescribe("live UI integration", () => {
  test("a review thread keeps each agent's identity visible", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    runCommentsAdd("alpha.ts", [1, 1], "check this", { cwd: fixture.dir, agentName: "Codex" });
    runCommentsReply(1, "checked", { cwd: fixture.dir, agentName: "Claude" });
    runCommentsReply(1, "confirmed", { cwd: fixture.dir, agentName: "Other agent" });
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "stack"],
      cwd: fixture.dir,
      cols: 160,
      rows: 35,
    });
    try {
      const text = await session.waitForText(/Other agent: confirmed/);
      expect(text).toContain("Codex: check this");
      expect(text).toContain("Claude: checked");
    } finally {
      session.close();
    }
  });

  test("the borderless pane edge keeps resizing available in a real PTY", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff"],
      cwd: fixture.dir,
      cols: 240,
      rows: 24,
    });
    try {
      await session.waitForText(/Press \? for help/);
      await session.press("s");
      const initial = await session.waitForText(/\d+ Changes/);
      // The file tree sits at the right edge; its heading starts one column inside the tree, and
      // the drag target is the gap just before it.
      const headingColumn = (text: string) =>
        text
          .split("\n")
          .find((line) => /\d+ Changes/.test(line))
          ?.search(/\d+ Changes/) ?? -1;
      const initialColumn = headingColumn(initial);
      if (initialColumn < 0) throw new Error("Missing file list heading");
      // SGR mouse columns are 1-based: this is the gap column right before the tree.
      const startColumn = initialColumn - 1;
      session.writeRaw(`\x1b[<0;${startColumn};6M`);
      await session.waitIdle();
      session.writeRaw(`\x1b[<32;${startColumn - 8};6M`);
      await session.waitIdle();
      session.writeRaw(`\x1b[<0;${startColumn - 8};6m`);
      // Dragging the edge left widens the tree, so its heading moves left by the same amount.
      const resized = await harness.waitForSnapshot(
        session,
        (text) => headingColumn(text) === initialColumn - 8,
      );
      expect(resized).toContain("beta.ts");
      expect(resized).not.toContain("│");
      session.resize({ cols: 100, rows: 24 });
      const narrow = await harness.waitForSnapshot(session, (text) => !text.includes("To do"));
      expect(narrow).toContain("alpha.ts");
    } finally {
      session.close();
    }
  });

  test("the flat file list shows filenames only and opens files from the keyboard", async () => {
    const fixture = harness.createTreeRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff"],
      cwd: fixture.dir,
      cols: 240,
      rows: 24,
    });
    try {
      await session.waitForText(/Press \? for help/);
      await session.press(["shift", "f"]);
      const list = await session.waitForText(/2 Changes/);
      expect(list).toContain("○ alpha.ts");
      expect(list).toContain("○ beta.ts");
      // No folder headings and no folding.
      expect(list).not.toContain("src/ui/ ");
      expect(list).not.toContain("▸");
      await session.press("end");
      await session.press("enter");
      const opened = await session.waitForText(/const alpha = 2;|const beta = 2;/);
      expect(opened).toContain("const alpha = 2;");
      expect(opened).toContain("const beta = 2;");
    } finally {
      session.close();
    }
  });

  test("workspace loads YouTrack tasks and selects them with the zed theme without replacing the diff", async () => {
    const fixture = harness.createLongWrapFilePair();
    const youtrack = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json([
          {
            idReadable: "PROJ-101",
            summary: "Workspace sidebar",
            customFields: [{ name: "State", value: { name: "In Progress" } }],
          },
          {
            idReadable: "PROJ-102",
            summary: "Review navigation",
            customFields: [{ name: "State", value: { name: "Open" } }],
          },
        ]),
    });
    // The repository connects to the fake YouTrack through its own `.flow/config.toml`.
    const repo = harness.createConnectedRepoFixture(
      `[youtrack]\nurl = "http://127.0.0.1:${youtrack.port}"\n`,
    );
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--theme", "zed"],
      cwd: repo.dir,
      cols: 160,
      rows: 24,
      env: {
        FLOW_YOUTRACK_URL: `http://127.0.0.1:${youtrack.port}`,
        FLOW_YOUTRACK_TOKEN: "pty-test-token",
      },
    });
    try {
      await session.waitForText(/Press \? for help/);
      await session.waitForText(/PROJ-101/);
      // The workspace starts open but unfocused; S focuses it.
      await session.press(["shift", "s"]);
      await session.waitForText(/To do/);
      await session.press("j");
      const selected = await session.waitForText(/PROJ-102/);
      expect(selected).toContain("after.ts");
      session.resize({ cols: 100, rows: 24 });
      await harness.waitForSnapshot(
        session,
        (text) => !text.includes("To do"),
        ptyTimeouts.waitForSnapshot,
      );
      session.resize({ cols: 160, rows: 24 });
      await session.waitForText(/To do/);
      // Focus returned to the review while it was hidden, so focus it again, then hide it.
      await session.press(["shift", "s"]);
      await session.press(["shift", "s"]);
      await harness.waitForSnapshot(
        session,
        (text) => !text.includes("To do"),
        ptyTimeouts.waitForSnapshot,
      );
    } finally {
      session.close();
      youtrack.stop(true);
    }
  });

  test("slash in the workspace filters its cards and Enter brings them all back", async () => {
    const fixture = harness.createLongWrapFilePair();
    const youtrack = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () =>
        Response.json([
          {
            idReadable: "PROJ-101",
            summary: "Workspace sidebar",
            customFields: [{ name: "State", value: { name: "In Progress" } }],
          },
          {
            idReadable: "PROJ-102",
            summary: "Review navigation",
            customFields: [{ name: "State", value: { name: "Open" } }],
          },
        ]),
    });
    const repo = harness.createConnectedRepoFixture(
      `[youtrack]\nurl = "http://127.0.0.1:${youtrack.port}"\n`,
    );
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after],
      cwd: repo.dir,
      cols: 160,
      rows: 24,
      env: {
        FLOW_YOUTRACK_URL: `http://127.0.0.1:${youtrack.port}`,
        FLOW_YOUTRACK_TOKEN: "pty-test-token",
      },
    });
    try {
      await session.waitForText(/PROJ-102/);
      await session.press(["shift", "s"]);
      await session.type("/");
      await harness.waitForSnapshot(
        session,
        (text) => text.includes("filter: type to filter tickets and reviews"),
        ptyTimeouts.waitForSnapshot,
      );
      await session.type("navig");
      const filtered = await harness.waitForSnapshot(
        session,
        (text) => text.includes("Review navigation") && !text.includes("Workspace sidebar"),
        ptyTimeouts.waitForSnapshot,
      );
      // The file filter is untouched: the diff still shows its file.
      expect(filtered).toContain("after.ts");

      // Enter ends the search on the match: every card comes back, which once left the card
      // reinserted before it unpainted in a real terminal.
      await session.press("enter");
      await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("Workspace sidebar") &&
          text.includes("Review navigation") &&
          !text.includes("filter:"),
        ptyTimeouts.waitForSnapshot,
      );
    } finally {
      session.close();
      youtrack.stop(true);
    }
  });

  test("plain `flow` in a repository opens the review", async () => {
    const fixture = harness.createSidebarJumpRepoFixture();
    // The harness adds layout flags to `launchFlow`, so run the entrypoint with no arguments at all.
    const entrypoint = join(import.meta.dir, "..", "..", "src", "main.tsx");
    const session = await harness.launchShellCommand({
      command: `bun run ${JSON.stringify(entrypoint)}`,
      cwd: fixture.dir,
      cols: 160,
      rows: 20,
    });
    try {
      const frame = await session.waitForText(/Press \? for help/);
      expect(frame).not.toContain("Usage: flow");
    } finally {
      session.close();
    }
  });

  test("real PTY sessions can toggle wrapped lines on and off", async () => {
    const fixture = harness.createLongWrapFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 102,
      rows: 20,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("before.ts");
      expect(initial).toContain("after.ts");
      expect(initial).toContain("this is a");
      expect(initial).not.toContain("ge';");

      await session.press("w");
      const wrapped = await harness.waitForSnapshot(
        session,
        (text) => text.includes("ge';"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(wrapped).toContain("ge';");

      await session.press("w");
      const unwrapped = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("ge';"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(unwrapped).not.toContain("ge';");
    } finally {
      session.close();
    }
  });

  test("real hunk navigation jumps to later hunks in the review stream", async () => {
    const fixture = harness.createMultiHunkFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 104,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("line1 = 100");
      expect(initial).not.toContain("line60 = 6000");

      await session.press("]");
      const secondHunk = await harness.waitForSnapshot(
        session,
        (text) => text.includes("line60 = 6000"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(secondHunk).toContain("line60 = 6000");
      expect(secondHunk).not.toContain("line1 = 100");
    } finally {
      session.close();
    }
  });

  test("comma and period jump between files in a real PTY", async () => {
    const fixture = harness.createPinnedHeaderRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("first.ts");
      expect(initial).toContain("line01 = 101");

      // `.` moves to the next file (second.ts) and pins its header to the top.
      await session.press(".");
      const onSecond = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("second.ts") &&
          text.includes("line17 = 117") &&
          !text.includes("line01 = 101"),
        ptyTimeouts.waitForSnapshot,
      );
      expect(onSecond).toContain("line17 = 117");
      expect(onSecond).not.toContain("line01 = 101");

      // `,` moves back to the previous file (first.ts).
      await session.press(",");
      const backOnFirst = await harness.waitForSnapshot(
        session,
        (text) => text.includes("first.ts") && text.includes("line01 = 101"),
        ptyTimeouts.waitForSnapshot,
      );
      expect(backOnFirst).toContain("line01 = 101");
    } finally {
      session.close();
    }
  });

  test("comma and period are inert while the filter is focused", async () => {
    const fixture = harness.createPinnedHeaderRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      expect(initial).toContain("line01 = 101");

      await session.type("/");
      await harness.waitForSnapshot(
        session,
        (text) => text.includes("filter: type to filter files"),
        ptyTimeouts.waitForSnapshot,
      );

      // `.` is a printable key with a nav meaning; while the filter owns the
      // keyboard it must land in the filter query, not jump files. "." is a
      // substring of both file names so the stream stays visible.
      await session.type(".");
      const filtered = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("filter: .") &&
          text.includes("line01 = 101") &&
          !text.includes("line17 = 117"),
        ptyTimeouts.waitForSnapshot,
      );
      expect(filtered).toContain("filter: .");
      expect(filtered).not.toContain("line17 = 117");
    } finally {
      session.close();
    }
  });

  test("backward cross-file hunk navigation reveals the target hunk in a real PTY", async () => {
    const fixture = harness.createCrossFileHunkNavigationRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 120,
      rows: 16,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      for (let index = 0; index < 19; index += 1) {
        await session.press("]");
        await session.waitIdle({ timeout: 40 });
      }

      await harness.waitForSnapshot(
        session,
        (text) => text.includes("export const mid = 4;"),
        ptyTimeouts.waitForSnapshot,
      );

      await session.press("[");
      await session.waitIdle({ timeout: 80 });
      await session.press("[");
      const backward = await harness.waitForSnapshot(
        session,
        (text) => text.includes("line 341 changed") || text.includes("line 002 changed"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(backward).toContain("line 341 changed");
      expect(backward).not.toContain("line 002 changed");
    } finally {
      session.close();
    }
  });

  test("PTY sessions can navigate forward and backward between distant hunks in one large file", async () => {
    const fixture = harness.createMultiHunkFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 104,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("line1 = 100");
      expect(initial).not.toContain("line60 = 6000");

      await session.press("]");
      const secondHunk = await harness.waitForSnapshot(
        session,
        (text) => text.includes("line60 = 6000") && !text.includes("line1 = 100"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(secondHunk).toContain("line60 = 6000");
      expect(secondHunk).not.toContain("line1 = 100");

      await session.press("[");
      const firstHunk = await harness.waitForSnapshot(
        session,
        (text) => text.includes("line1 = 100") && !text.includes("line60 = 6000"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(firstHunk).toContain("line1 = 100");
      expect(firstHunk).not.toContain("line60 = 6000");
    } finally {
      session.close();
    }
  });

  // Blocked by mouse-wheel/pager viewport tracking.
  test.skip("a short last file does not trap upward scrolling at the bottom edge", async () => {
    const fixture = harness.createBottomClampedRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      await session.press("]");
      const bottomAligned = await harness.waitForSnapshot(
        session,
        (text) => text.includes("shortLine1 = 10;"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(bottomAligned).not.toContain("line30 = 130");

      for (let iteration = 0; iteration < 4; iteration += 1) {
        await session.press("up");
        await session.waitIdle({ timeout: 200 });
      }

      const movedUp = await harness.waitForSnapshot(
        session,
        (text) => text.includes("line30 = 130"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(movedUp).toContain("line30 = 130");
    } finally {
      session.close();
    }
  });

  test("auto layout responds to live terminal resize in a real PTY", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "auto"],
      cwd: fixture.dir,
      cols: 220,
      rows: 24,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      await session.press("s");
      const wide = await session.text();

      expect(harness.countMatches(wide, /alpha\.ts/g)).toBeGreaterThanOrEqual(2);
      expect(hasSplitDiffRowTest(wide)).toBe(true);

      session.resize({ cols: 150, rows: 24 });
      const tight = await harness.waitForSnapshot(
        session,
        (text) => !hasSplitDiffRowTest(text),
        ptyTimeouts.waitForSnapshot,
      );

      expect(harness.countMatches(tight, /alpha\.ts/g)).toBeLessThan(
        harness.countMatches(wide, /alpha\.ts/g),
      );
      expect(hasSplitDiffRowTest(tight)).toBe(false);
    } finally {
      session.close();
    }
  });

  test("B switches between the whole branch and uncommitted changes in place", async () => {
    const fixture = harness.createBranchRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff"],
      cwd: fixture.dir,
      cols: 160,
      rows: 20,
    });

    try {
      // The harness starts PTY sessions with `--no-branch`: only the uncommitted edit shows.
      const workingTree = await session.waitForText(/dirty\.ts/, {
        timeout: ptyTimeouts.waitForText,
      });
      expect(workingTree).not.toContain("committed.ts");
      expect(workingTree).toContain("Diff mode: Uncommitted");

      await session.press(["shift", "b"]);
      const branch = await harness.waitForSnapshot(
        session,
        (text) => text.includes("committed.ts") && text.includes("dirty.ts"),
        ptyTimeouts.waitForSnapshot,
      );
      expect(branch).toContain("committedOnBranch");
      expect(await session.waitForText(/Diff mode: Branch vs main/)).toContain(
        "Diff mode: Branch vs main",
      );

      await session.press(["shift", "b"]);
      const back = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("committed.ts") && text.includes("dirty.ts"),
        ptyTimeouts.waitForSnapshot,
      );
      expect(back).toContain("dirty = 2");
      expect(await session.waitForText(/Diff mode: Uncommitted/)).toContain(
        "Diff mode: Uncommitted",
      );
    } finally {
      session.close();
    }
  });

  test("arrows on the workspace never scroll the diff, even after clicking into it", async () => {
    const fixture = harness.createSidebarJumpRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      expect(initial).toContain("alphaOnly = true");

      // A click used to give the diff's scroll box OpenTUI's focus, so it took arrow keys too.
      await session.click(/alphaOnly = true/);
      await session.press(["shift", "s"]);
      for (let index = 0; index < 4; index += 1) {
        await session.press("down");
      }
      await session.waitIdle();

      expect(await session.text()).toContain("alphaOnly = true");
    } finally {
      session.close();
    }
  });

  test("sidebar selection jumps the main pane without collapsing the review stream", async () => {
    const fixture = harness.createSidebarJumpRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 12,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      await session.press("s");
      const initial = await session.text();

      expect(initial).toContain("alphaOnly = true");
      expect(initial).toContain("betaValue = 2");
      expect(initial).not.toContain("deltaOnly = true");

      await session.click(/○ delta\.ts/);
      const jumped = await harness.waitForSnapshot(
        session,
        (text) => text.includes("deltaOnly = true") && !text.includes("alphaOnly = true"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(jumped).toContain("deltaValue = 2");
      expect(jumped).toContain("deltaOnly = true");
      expect(jumped).not.toContain("alphaOnly = true");
      expect(harness.countMatches(jumped, /epsilon\.ts/g)).toBeGreaterThanOrEqual(2);
    } finally {
      session.close();
    }
  });

  test("clicking a sidebar file pins that file header to the top in a real PTY", async () => {
    const fixture = harness.createPinnedHeaderRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      await session.press("s");
      const initial = await session.text();

      expect(initial).toContain("first.ts");
      expect(initial).toContain("second.ts");

      for (let index = 0; index < 8; index += 1) {
        await session.press("down");
      }

      // With both side panes open the right half is clipped, so read the old side's lines.
      const scrolled = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("line09 = 9;") &&
          !text.includes("line01 = 1;") &&
          text.includes("first.ts"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(scrolled).toContain("first.ts");

      await session.click(/○ second\.ts/);
      const pinned = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("second.ts") &&
          text.includes("line17 = 17;") &&
          !text.includes("line09 = 9;"),
        ptyTimeouts.waitForSnapshot,
      );

      // The second file now owns the review: its first line shows and the first file's body is gone.
      expect(pinned).toContain("line17 = 17;");
      // first.ts stays listed in the file list only.
      expect(harness.countMatches(pinned, /first\.ts/g)).toBe(1);
    } finally {
      session.close();
    }
  });

  test("mouse wheel scrolling preserves the divider and header handoff in a real PTY", async () => {
    const fixture = harness.createPinnedHeaderRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    /** Scroll one wheel step at a time until a snapshot matches; real PTY wheel steps vary. */
    async function scrollUntil(predicate: (text: string) => boolean) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await session.scrollDown(1);
        try {
          return await harness.waitForSnapshot(session, predicate, 400);
        } catch {
          // Keep scrolling a little farther before declaring the handoff broken.
        }
      }
      return null;
    }

    try {
      await session.waitForText(/Press \? for help/, { timeout: ptyTimeouts.waitForText });
      // Open the file list so each filename shows once there, plus wherever its header is.
      await session.press("s");
      await harness.waitForSnapshot(
        session,
        (text) => text.includes("○ first.ts") && text.includes("○ second.ts"),
        ptyTimeouts.waitForSnapshot,
      );

      // Near the boundary both headers are on screen: first.ts pinned, second.ts in the stream.
      const boundary = await scrollUntil(
        (text) =>
          harness.countMatches(text, /first\.ts/g) === 2 &&
          harness.countMatches(text, /second\.ts/g) === 2 &&
          text.includes("line17 = 17;"),
      );
      expect(boundary).not.toBeNull();

      // Past it, second.ts takes over the pinned header and first.ts remains only in the list.
      const handedOff = await scrollUntil(
        (text) =>
          harness.countMatches(text, /first\.ts/g) === 1 &&
          harness.countMatches(text, /second\.ts/g) === 2 &&
          !text.includes("line16 = 16;"),
      );
      expect(handedOff).not.toBeNull();
      expect(harness.countMatches(handedOff!, /first\.ts/g)).toBe(1);
      expect(harness.countMatches(handedOff!, /second\.ts/g)).toBe(2);
    } finally {
      session.close();
    }
    // Wheel steps are retried one by one, which needs more than the suite's default budget.
  }, 20_000);

  test("adding a comment keeps the review where it was", async () => {
    const fixture = harness.createPinnedHeaderRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "stack"],
      cwd: fixture.dir,
      cols: 120,
      rows: 14,
    });

    /** First code row on screen, which pins the vertical scroll position. */
    const firstCodeRow = (text: string) =>
      text.split("\n").find((line) => /\d+ {3}export const line/.test(line)) ?? "";

    try {
      await session.waitForText(/Press \? for help/, { timeout: ptyTimeouts.waitForText });
      for (let index = 0; index < 5; index += 1) {
        await session.press("down");
      }
      const scrolled = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("line01 = 1;"),
        ptyTimeouts.waitForSnapshot,
      );
      const before = firstCodeRow(scrolled);
      expect(before).not.toBe("");

      await session.press("a");
      await session.waitForText(/Add comment/);
      await session.type("revisa esto");
      await session.press("enter");
      const after = await harness.waitForSnapshot(
        session,
        (text) => text.includes("Comment added"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(firstCodeRow(after)).toBe(before);
    } finally {
      session.close();
    }
  });

  test("explicit split mode stays split after a live resize", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 24,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      // The file list starts closed; open it so the wide layout shows it beside the review.
      await session.press("s");
      const wide = await harness.waitForSnapshot(
        session,
        (text) => harness.countMatches(text, /alpha\.ts/g) >= 2,
        ptyTimeouts.waitForSnapshot,
      );

      expect(hasSplitDiffRowTest(wide)).toBe(true);

      session.resize({ cols: 140, rows: 24 });
      const tight = await harness.waitForSnapshot(
        session,
        // Right after a resize the terminal can still show the wide layout clipped, with the file
        // tree cut off on the right; wait for the re-laid-out frame, which fits the new side.
        (text) =>
          hasSplitDiffRowTest(text) &&
          harness.countMatches(text, /alpha\.ts/g) === 1 &&
          text.includes("betaValue = 1"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(tight).toContain("betaValue = 1");
    } finally {
      session.close();
    }
  });

  test("explicit stack mode stays stacked after a live resize", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "stack"],
      cwd: fixture.dir,
      cols: 140,
      rows: 24,
    });

    try {
      const narrow = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(harness.countMatches(narrow, /alpha\.ts/g)).toBe(1);
      expect(hasSplitDiffRowTest(narrow)).toBe(false);

      // The file list starts closed; ask for it so the wide layout can show it.
      await session.press("s");
      session.resize({ cols: 220, rows: 24 });
      const wide = await harness.waitForSnapshot(
        session,
        (text) => !hasSplitDiffRowTest(text) && harness.countMatches(text, /alpha\.ts/g) >= 2,
        ptyTimeouts.waitForSnapshot,
      );

      expect(wide).toContain("1   export const alpha = 1;");
    } finally {
      session.close();
    }
  });

  test("filter focus narrows the visible review stream in the live app", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 24,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("add = true");
      expect(initial).toContain("betaValue");

      await session.press("tab");
      await session.type("beta");
      const filtered = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("betaValue") && !text.includes("alpha.ts") && !text.includes("add = true"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(filtered.toLowerCase()).toContain("filter");
      expect(filtered).toContain("beta");
      expect(filtered).toContain("betaValue");
      expect(filtered).not.toContain("add = true");
    } finally {
      session.close();
    }
  });

  test("slash focuses the filter and narrows the visible review stream", async () => {
    const fixture = harness.createSidebarJumpRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("alphaOnly = true");
      expect(initial).toContain("betaValue = 2");

      await session.type("/");
      await harness.waitForSnapshot(
        session,
        (text) => text.includes("filter: type to filter files"),
        ptyTimeouts.waitForSnapshot,
      );

      await session.type("delta");
      const filtered = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("filter: delta") &&
          text.includes("deltaOnly = true") &&
          !text.includes("alphaOnly = true"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(filtered.toLowerCase()).toContain("filter");
      expect(filtered).toContain("delta");
      expect(filtered).toContain("deltaOnly = true");
      expect(filtered).not.toContain("alphaOnly = true");
    } finally {
      session.close();
    }
  });

  test("pager mode hides chrome and pages forward on space", async () => {
    const fixture = harness.createPagerPatchFixture();
    const session = await harness.launchFlow({
      args: ["patch", fixture.patchFile, "--pager"],
      cols: 120,
      rows: 20,
    });

    try {
      const initial = await session.waitForText(/scroll\.ts/, { timeout: ptyTimeouts.waitForText });

      expect(initial).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(initial).toContain("before_01");
      expect(initial).not.toContain("before_23");

      // CI can surface the pager header before the first page is fully ready to consume keys.
      await session.waitIdle({ timeout: 200 });
      await session.press("space");
      const paged = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_23") || text.includes("after_06"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(paged).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(paged).toContain("before_23");
    } finally {
      session.close();
    }
  });

  // Blocked by mouse-wheel/pager viewport tracking.
  test.skip("pager mode handles half-page, page-up, and content-jump keyboard navigation", async () => {
    const fixture = harness.createPagerPatchFixture(60);
    const session = await harness.launchFlow({
      args: ["patch", fixture.patchFile, "--pager"],
      cols: 120,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/scroll\.ts/, { timeout: ptyTimeouts.waitForText });

      expect(initial).toContain("before_01");
      expect(initial).not.toContain("before_12");

      await session.press("d");
      const halfPaged = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("before_01"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(halfPaged).not.toContain("before_01");

      await session.press("u");
      const halfPageRestored = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_01"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(halfPageRestored).toContain("before_01");

      await session.press("space");
      const paged = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_18") || text.includes("after_02"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(paged.includes("before_18") || paged.includes("after_02")).toBe(true);

      await session.press("b");
      const pageRestored = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_01") && !text.includes("after_02"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(pageRestored).toContain("before_01");
      expect(pageRestored).not.toContain("after_02");

      await session.press("end");
      const bottom = await harness.waitForSnapshot(
        session,
        (text) => text.includes("after_60"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(bottom).toContain("after_60");

      await session.press("home");
      const top = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_01") && !text.includes("after_60"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(top).toContain("before_01");
      expect(top).not.toContain("after_60");
    } finally {
      session.close();
    }
  });

  test("stdin patch mode enables mouse wheel scrolling in pager UI", async () => {
    const fixture = harness.createPagerPatchFixture(60);
    const session = await harness.launchFlowWithFileBackedStdin({
      stdinFile: fixture.patchFile,
      args: ["patch", "-"],
      cols: 120,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/scroll\.ts/, { timeout: ptyTimeouts.waitForText });

      expect(initial).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(initial).toContain("before_01");
      expect(initial).not.toContain("before_12");

      await session.waitIdle({ timeout: 200 });
      await session.scrollDown(10);
      const scrolled = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("before_01") && text.includes("before_12"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(scrolled).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(scrolled).not.toContain("before_01");
      expect(scrolled).toContain("before_12");

      await session.scrollUp(10);
      const restored = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_01") && !text.includes("before_12"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(restored).toContain("before_01");
      expect(restored).not.toContain("before_12");
    } finally {
      session.close();
    }
  });

  test("general pager mode enables mouse wheel scrolling for diff-like stdin", async () => {
    const fixture = harness.createPagerPatchFixture(60);
    const session = await harness.launchFlowWithFileBackedStdin({
      stdinFile: fixture.patchFile,
      args: ["pager"],
      cols: 120,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/scroll\.ts/, { timeout: ptyTimeouts.waitForText });

      expect(initial).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(initial).toContain("before_01");
      expect(initial).not.toContain("before_12");

      await session.waitIdle({ timeout: 200 });
      await session.scrollDown(10);
      const scrolled = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("before_01") && text.includes("before_12"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(scrolled).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(scrolled).not.toContain("before_01");
      expect(scrolled).toContain("before_12");

      await session.scrollUp(10);
      const restored = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_01") && !text.includes("before_12"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(restored).toContain("before_01");
      expect(restored).not.toContain("before_12");
    } finally {
      session.close();
    }
  });

  test("general pager mode can display the sidebar file tree", async () => {
    const fixture = harness.createPagerPatchFixture();
    const session = await harness.launchFlowWithFileBackedStdin({
      stdinFile: fixture.patchFile,
      args: ["pager"],
      cols: 120,
      rows: 14,
    });

    try {
      const initial = await session.waitForText(/scroll\.ts/, { timeout: ptyTimeouts.waitForText });

      expect(initial).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(harness.countMatches(initial, /scroll\.ts/g)).toBe(1);

      await session.press("s");
      const sidebarRow = /○ scroll\.ts/;
      const withSidebar = await harness.waitForSnapshot(
        session,
        (text) => sidebarRow.test(text),
        ptyTimeouts.waitForSnapshot,
      );

      expect(withSidebar).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(withSidebar).toMatch(sidebarRow);
    } finally {
      session.close();
    }
  });

  test("explicit pager mode still supports mouse wheel scrolling on a TTY", async () => {
    const fixture = harness.createPagerPatchFixture(60);
    const session = await harness.launchFlow({
      args: ["patch", fixture.patchFile, "--pager"],
      cols: 120,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/scroll\.ts/, { timeout: ptyTimeouts.waitForText });

      expect(initial).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(initial).toContain("before_01");
      expect(initial).not.toContain("before_12");

      await session.waitIdle({ timeout: 200 });
      await session.scrollDown(10);
      const scrolled = await harness.waitForSnapshot(
        session,
        (text) => !text.includes("before_01") && text.includes("before_12"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(scrolled).not.toContain("View  Navigate  Theme  Agent  Help");
      expect(scrolled).not.toContain("before_01");
      expect(scrolled).toContain("before_12");

      await session.scrollUp(10);
      const restored = await harness.waitForSnapshot(
        session,
        (text) => text.includes("before_01") && !text.includes("before_12"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(restored).toContain("before_01");
      expect(restored).not.toContain("before_12");
    } finally {
      session.close();
    }
  });

  test("keyboard help can open with ? in a real PTY", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 24,
    });

    try {
      await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      await session.press("?");
      const help = await harness.waitForSnapshot(
        session,
        (text) =>
          (text.includes("Keyboard help") || text.includes("Controls help")) &&
          text.includes("move line-by-line"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(help.includes("Keyboard help") || help.includes("Controls help")).toBe(true);
      expect(help).toContain("move line-by-line");
    } finally {
      session.close();
    }
  });

  test("direct layout hotkeys can switch between split, stack, and auto in a real PTY", async () => {
    const fixture = harness.createTwoFileRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "stack"],
      cwd: fixture.dir,
      cols: 220,
      rows: 24,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(hasSplitDiffRowTest(initial)).toBe(false);
      expect(initial).toContain("1   export const alpha = 1;");

      // The file list starts closed; open it so wide layouts show it beside the review.
      await session.press("s");
      await harness.waitForSnapshot(
        session,
        (text) => harness.countMatches(text, /alpha\.ts/g) >= 2,
        ptyTimeouts.waitForSnapshot,
      );

      await session.press("1");
      const split = await harness.waitForSnapshot(
        session,
        (text) => hasSplitDiffRowTest(text) && harness.countMatches(text, /alpha\.ts/g) >= 2,
        ptyTimeouts.waitForSnapshot,
      );

      expect(hasSplitDiffRowTest(split)).toBe(true);

      await session.press("2");
      const stack = await harness.waitForSnapshot(
        session,
        (text) => !hasSplitDiffRowTest(text) && text.includes("1   export const alpha = 1;"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(hasSplitDiffRowTest(stack)).toBe(false);
      expect(stack).toContain("1   export const alpha = 1;");

      await session.press("0");
      const auto = await harness.waitForSnapshot(
        session,
        (text) => hasSplitDiffRowTest(text) && harness.countMatches(text, /alpha\.ts/g) >= 2,
        ptyTimeouts.waitForSnapshot,
      );

      expect(hasSplitDiffRowTest(auto)).toBe(true);
    } finally {
      session.close();
    }
  });

  // Blocked by mouse-wheel/pager viewport tracking.
  test.skip("layout hotkeys preserve the current review position in a real PTY", async () => {
    const fixture = harness.createScrollableFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 220,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("line01 = 101");
      expect(initial).not.toContain("line08 = 108");

      let anchored = initial;
      for (let index = 0; index < 24; index += 1) {
        await session.press("down");
        await session.waitIdle({ timeout: 200 });
        anchored = await session.text({ immediate: true });
        if (anchored.includes("line08 = 108") && !anchored.includes("line01 = 101")) {
          break;
        }
      }

      const anchoredLineNumber = anchored.match(/line(\d{2}) =/)?.[1];

      expect(anchored).toContain("line08 = 108");
      expect(anchored).not.toContain("line01 = 101");
      expect(anchoredLineNumber).toBeDefined();

      await session.press("2");
      const stacked = await harness.waitForSnapshot(
        session,
        (text) => !hasSplitDiffRowTest(text) && text.includes(`line${anchoredLineNumber} =`),
        ptyTimeouts.waitForSnapshot,
      );

      expect(stacked).toContain(`line${anchoredLineNumber} =`);

      await session.press("1");
      const split = await harness.waitForSnapshot(
        session,
        (text) => hasSplitDiffRowTest(text) && text.includes(`line${anchoredLineNumber} =`),
        ptyTimeouts.waitForSnapshot,
      );

      expect(split).toContain(`line${anchoredLineNumber} =`);
    } finally {
      session.close();
    }
  });

  // Blocked by mouse-wheel/pager viewport tracking.
  test.skip("mouse wheel scrolling moves the review pane", async () => {
    const fixture = harness.createScrollableFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 220,
      rows: 12,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("line01 = 101");
      expect(initial).not.toContain("line08 = 108");

      // Give slower CI PTYs one extra settle point so the first wheel event is not dropped.
      await session.waitIdle({ timeout: 200 });
      await session.scrollDown(12);
      const scrolled = await harness.waitForSnapshot(
        session,
        (text) =>
          !text.includes("line01 = 101") &&
          (text.includes("line11 = 111") || text.includes("line12 = 112")),
        ptyTimeouts.waitForSnapshot,
      );

      expect(scrolled).not.toContain("line01 = 101");
      expect(scrolled.includes("line11 = 111") || scrolled.includes("line12 = 112")).toBe(true);

      await session.scrollUp(12);
      const restored = await harness.waitForSnapshot(
        session,
        (text) => text.includes("line01 = 101"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(restored).toContain("line01 = 101");
    } finally {
      session.close();
    }
  });

  test("arrow-key horizontal scrolling reveals hidden code columns in a real PTY", async () => {
    const fixture = harness.createLongWrapFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 102,
      rows: 20,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("this is a");
      expect(initial).not.toContain("ge';");

      let shifted = initial;
      for (let index = 0; index < 96; index += 1) {
        await session.press("right");
        shifted = await session.text();
        if (shifted.includes("ge';")) {
          break;
        }
      }

      expect(shifted).toContain("ge';");
      expect(shifted).not.toContain("this is a");

      let restored = shifted;
      for (let index = 0; index < 96; index += 1) {
        await session.press("left");
        restored = await session.text();
        if (restored.includes("this is a") && !restored.includes("ge';")) {
          break;
        }
      }

      expect(restored).toContain("this is a");
      expect(restored).not.toContain("ge';");
    } finally {
      session.close();
    }
  });

  test("wrap toggles reset horizontal code scrolling in a real PTY", async () => {
    const fixture = harness.createLongWrapFilePair();
    const session = await harness.launchFlow({
      args: ["diff", fixture.before, fixture.after, "--mode", "split"],
      cols: 102,
      rows: 20,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("this is a");
      expect(initial).not.toContain("ge';");

      let shifted = initial;
      for (let index = 0; index < 96; index += 1) {
        await session.press("right");
        shifted = await session.text();
        if (shifted.includes("ge';")) {
          break;
        }
      }

      expect(shifted).toContain("ge';");
      expect(shifted).not.toContain("this is a");

      await session.press("w");
      const wrapped = await harness.waitForSnapshot(
        session,
        (text) => text.includes("ge';"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(wrapped).toContain("this is a");
      expect(wrapped).toContain("ge';");

      await session.press("w");
      const reset = await harness.waitForSnapshot(
        session,
        (text) => text.includes("this is a") && !text.includes("ge';"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(reset).toContain("this is a");
      expect(reset).not.toContain("ge';");
    } finally {
      session.close();
    }
  });

  // Blocked by mouse-wheel/pager viewport tracking.
  test.skip("the first mouse-wheel step still advances content under the always-pinned file header above a collapsed gap", async () => {
    const fixture = harness.createCollapsedTopRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });

      expect(initial).toContain("aaa-collapsed.ts");
      expect(initial).toContain("··· 362 unchanged lines ···");
      expect(initial).not.toContain("366   export const line366 = 366;");

      await session.scrollDown(1);
      const advanced = await harness.waitForSnapshot(
        session,
        (text) => text.includes("366   export const line366 = 366;"),
        ptyTimeouts.waitForSnapshot,
      );

      expect(advanced).toContain("366   export const line366 = 366;");
    } finally {
      session.close();
    }
  });

  // Blocked by mouse-wheel/pager viewport tracking.
  test.skip("one mouse-wheel step down then up restores the collapsed-gap view beneath the pinned file header", async () => {
    const fixture = harness.createCollapsedTopRepoFixture();
    const session = await harness.launchFlow({
      args: ["diff", "--mode", "split"],
      cwd: fixture.dir,
      cols: 220,
      rows: 10,
    });

    try {
      const initial = await session.waitForText(/Press \? for help/, {
        timeout: ptyTimeouts.waitForText,
      });
      const initialHeaderCount = harness.countMatches(initial, /aaa-collapsed\.ts/g);

      await session.scrollDown(1);
      await harness.waitForSnapshot(
        session,
        (text) => text.includes("366   export const line366 = 366;"),
        ptyTimeouts.waitForSnapshot,
      );

      await session.scrollUp(1);
      const restored = await harness.waitForSnapshot(
        session,
        (text) =>
          text.includes("··· 362 unchanged lines ···") &&
          harness.countMatches(text, /aaa-collapsed\.ts/g) === initialHeaderCount,
        ptyTimeouts.waitForSnapshot,
      );

      expect(restored).toContain("··· 362 unchanged lines ···");
      expect(restored).not.toContain("366   export const line366 = 366;");
      expect(harness.countMatches(restored, /aaa-collapsed\.ts/g)).toBe(initialHeaderCount);
    } finally {
      session.close();
    }
  });
});
