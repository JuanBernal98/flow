import { describe, expect, mock, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { BoxRenderable } from "@opentui/core";
import { act } from "react";
import type { AppBootstrap, LayoutMode } from "../core/types";
import { createTestVcsAppBootstrap } from "../../test/helpers/app-bootstrap";
import { createTestDiffFile } from "../../test/helpers/diff-helpers";

const { AppHost } = await import("./AppHost");

test("workspace uses the base background while the adjoining tree and diff retain a resizable edge", async () => {
  const setup = await testRender(<AppHost bootstrap={createBootstrap()} />, {
    width: 280,
    height: 24,
  });
  try {
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.mockInput.typeText("s");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    const workspace = setup.renderer.root.findDescendantById("workspace-pane");
    const tree = setup.renderer.root.findDescendantById("file-tree-pane");
    const diff = setup.renderer.root.findDescendantById("diff-pane");
    const tasks = setup.renderer.root.findDescendantById("workspace-section-Tasks");
    const reviews = setup.renderer.root.findDescendantById("workspace-section-Reviews");
    if (
      !(workspace instanceof BoxRenderable) ||
      !(tree instanceof BoxRenderable) ||
      !(diff instanceof BoxRenderable) ||
      !(tasks instanceof BoxRenderable) ||
      !(reviews instanceof BoxRenderable)
    ) {
      throw new Error("Missing review surface");
    }
    expect(tree.x - workspace.x - workspace.width).toBe(2);
    expect(diff.x - tree.x - tree.width).toBe(0);
    expect(reviews.y - tasks.y - tasks.height).toBe(1);
    expect(tasks.backgroundColor).toEqual(workspace.backgroundColor);
    expect(reviews.backgroundColor).toEqual(workspace.backgroundColor);
    expect(tasks.backgroundColor).not.toEqual(tree.backgroundColor);
    expect(setup.captureCharFrame()).not.toContain("│");
    expect(setup.captureCharFrame()).not.toContain("───");
    const initialTreeWidth = tree.width;
    const initialDiffWidth = diff.width;
    const gutterX = tree.x + tree.width;
    await act(async () => {
      await setup.mockMouse.pressDown(gutterX, 5);
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.mockMouse.emitMouseEvent("drag", gutterX + 6, 5);
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.mockMouse.release(gutterX + 6, 5);
    });
    await act(async () => {
      await setup.renderOnce();
    });
    expect(tree.width).toBe(initialTreeWidth + 6);
    expect(diff.width).toBe(initialDiffWidth - 6);
    expect(diff.x - tree.x - tree.width).toBe(0);
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

test("workspace yields space on narrow terminals and stays out of pager mode", async () => {
  expect(await captureFrameForBootstrap(createBootstrap(), 280)).toContain("Tasks");
  expect(await captureFrameForBootstrap(createBootstrap(), 100)).not.toContain("Tasks");
  expect(await captureFrameForBootstrap(createBootstrap("auto", true), 280)).not.toContain("Tasks");
});

test("workspace starts open and hidden workspace releases keyboard focus", async () => {
  const setup = await testRender(<AppHost bootstrap={createBootstrap()} />, {
    width: 160,
    height: 24,
  });
  try {
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).not.toContain("Tasks");
    await act(async () => {
      await setup.mockInput.typeText("S");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).toContain("Tasks");
    await act(async () => {
      setup.resize(79, 24);
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).not.toContain("Tasks");
    await act(async () => {
      await setup.mockInput.pressTab();
    });
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.mockInput.typeText("beta");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).not.toContain("alpha.ts");
    await act(async () => {
      setup.resize(280, 24);
      await setup.renderOnce();
    });
    expect(setup.captureCharFrame()).toContain("Tasks");
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
});

function createBootstrap(initialMode: LayoutMode = "auto", pager = false): AppBootstrap {
  return createTestVcsAppBootstrap({
    changesetId: "changeset:responsive",
    files: [
      createTestDiffFile({
        after: "export const alpha = 2;\nexport const add = true;\n",
        before: "export const alpha = 1;\n",
        context: 3,
        id: "alpha",
        path: "alpha.ts",
      }),
      createTestDiffFile({
        after: "export const betaValue = 1;\n",
        before: "export const beta = 1;\n",
        context: 3,
        id: "beta",
        path: "beta.ts",
      }),
    ],
    initialMode,
    pager,
    summary: "Patch summary",
  });
}

async function captureFrameForBootstrap(bootstrap: AppBootstrap, width: number, height = 24) {
  const setup = await testRender(<AppHost bootstrap={bootstrap} />, { width, height });

  try {
    await act(async () => {
      await setup.renderOnce();
    });

    return setup.captureCharFrame();
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
}

async function captureResponsiveFrames() {
  const setup = await testRender(<AppHost bootstrap={createBootstrap()} />, {
    width: 280,
    height: 24,
  });

  try {
    await act(async () => {
      await setup.renderOnce();
    });
    await act(async () => {
      await setup.mockInput.typeText("s");
    });
    await act(async () => {
      await setup.renderOnce();
    });
    const ultraWide = setup.captureCharFrame();

    await act(async () => {
      setup.resize(220, 24);
      await setup.renderOnce();
    });
    const full = setup.captureCharFrame();

    await act(async () => {
      setup.resize(160, 24);
      await setup.renderOnce();
    });
    const medium = setup.captureCharFrame();

    await act(async () => {
      setup.resize(159, 24);
      await setup.renderOnce();
    });
    const tight = setup.captureCharFrame();

    return { ultraWide, full, medium, tight };
  } finally {
    await act(async () => {
      setup.renderer.destroy();
    });
  }
}

describe("responsive app", () => {
  test("App adjusts the visible panes and diff layout on live resize", async () => {
    const { ultraWide, full, medium, tight } = await captureResponsiveFrames();

    expect((ultraWide.match(/alpha\.ts/g) ?? []).length).toBe(2);
    expect(ultraWide).not.toContain("Changeset summary");

    expect((full.match(/alpha\.ts/g) ?? []).length).toBe(2);
    expect(full).not.toContain("Changeset summary");
    expect(full).toMatch(/▌.*▌/);

    expect(medium).not.toContain("Files");
    expect(medium).not.toContain("Changeset summary");
    expect(medium).toMatch(/▌.*▌/);

    expect(tight).not.toContain("Files");
    expect(tight).not.toContain("Changeset summary");
    expect(tight).not.toMatch(/▌.*▌/);
  });

  test("sidebar shortcut opens the hidden sidebar on medium viewport", async () => {
    const setup = await testRender(<AppHost bootstrap={createBootstrap("auto")} />, {
      width: 180,
      height: 24,
    });

    try {
      await act(async () => {
        await setup.renderOnce();
      });

      let frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(1);

      await act(async () => {
        await setup.mockInput.typeText("s");
      });
      await act(async () => {
        await setup.renderOnce();
      });

      frame = setup.captureCharFrame();
      expect((frame.match(/alpha\.ts/g) ?? []).length).toBe(2);
    } finally {
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });

  test("explicit split and stack modes override responsive auto switching", async () => {
    const forcedSplit = await captureFrameForBootstrap(createBootstrap("split"), 140);
    const forcedStack = await captureFrameForBootstrap(createBootstrap("stack"), 240);

    expect(forcedSplit).not.toContain("Files");
    expect(forcedSplit).not.toContain("Changeset summary");
    expect(forcedSplit).toMatch(/▌.*▌/);

    expect((forcedStack.match(/alpha\.ts/g) ?? []).length).toBe(1);
    expect(forcedStack).not.toContain("Changeset summary");
    expect(forcedStack).not.toMatch(/▌.*▌/);
  });

  test("pager mode stays responsive while hiding app chrome", async () => {
    const wide = await captureFrameForBootstrap(createBootstrap("auto", true), 220);
    const narrow = await captureFrameForBootstrap(createBootstrap("auto", true), 150);

    expect((wide.match(/alpha\.ts/g) ?? []).length).toBe(1);
    expect(wide).toMatch(/▌.*▌/);

    expect((narrow.match(/alpha\.ts/g) ?? []).length).toBe(1);
    expect(narrow).not.toMatch(/▌.*▌/);
  });

  test("filter focus suppresses global shortcut keys like quit", async () => {
    const originalExit = process.exit;
    const exitMock = mock(() => undefined as never);
    (process as typeof process & { exit: typeof exitMock }).exit = exitMock;

    const setup = await testRender(<AppHost bootstrap={createBootstrap()} />, {
      width: 240,
      height: 24,
    });

    try {
      await act(async () => {
        await setup.renderOnce();
        await setup.mockInput.pressTab();
        await setup.renderOnce();
      });

      await act(async () => {
        await setup.mockInput.typeText("q");
        await setup.renderOnce();
      });

      const frame = setup.captureCharFrame();
      expect(exitMock).not.toHaveBeenCalled();
      expect(frame).toContain("filter:");
      expect(frame).toContain("q");
    } finally {
      (process as typeof process & { exit: typeof originalExit }).exit = originalExit;
      await act(async () => {
        setup.renderer.destroy();
      });
    }
  });
});
