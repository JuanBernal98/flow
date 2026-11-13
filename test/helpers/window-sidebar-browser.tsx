/** @jsxImportSource react */
import { useEffect } from "react";
import { FilesPane } from "../../src/window/FilesPane";
import { CommitProposalPanel } from "../../src/window/CommitProposalPanel";
import { activateVisibleCommitAction } from "../../src/window/CommitActionButton";
import { useCommitProposal } from "../../src/window/useCommitProposal";
import type { CommitProposal } from "../../src/core/commitProposal";

const testFiles = Array.from({ length: 20 }, (_, index) => ({
  path: `src/file-${index}.ts`,
  patch: "",
  status: "modified" as const,
  additions: 1,
  deletions: 0,
}));
const testSelection = new Set<string>();
const testProposal: CommitProposal = {
  schema: 1,
  id: "switch-test",
  status: "ready",
  completed: 0,
  snapshot: {
    branch: "test",
    head: "test",
    fingerprint: "test",
    files: testFiles.map((file) => file.path),
  },
  plan: {
    agentName: "Codex",
    commits: [
      {
        kind: "commit",
        message: "fix: first group",
        files: testFiles.slice(0, 10).map((file) => file.path),
      },
      {
        kind: "commit",
        message: "fix: second group",
        files: testFiles.slice(10).map((file) => file.path),
      },
    ],
  },
};
let testCalls = 0;
let testAction = "";
let testSavedWidth = 0;
let testResizeCalls = 0;
/** Return the ready proposal once; tab switches should not fetch it again. */
async function callTestSidebarAPI<T>(): Promise<T> {
  testCalls += 1;
  return structuredClone(testProposal) as T;
}
/** Stable callbacks avoid unrelated fixture updates. */
function onTestSidebarAction() {}

/** Switch the real sidebar and verify that its state and action routing survive. */
export function TestSidebarSwitching() {
  const flow = useCommitProposal(callTestSidebarAPI, onTestSidebarAction);
  useEffect(() => {
    let original: HTMLElement | null = null;
    let body: HTMLElement | null = null;
    let scrollTop = 0;
    let changesVisible = false;
    let resizeHeight = 0;
    let duringHeight = 0;
    let duringVisibility = "";
    let inheritedWidth = "";
    let persistedDuringDrag = 0;
    const timers = [
      setTimeout(() => {
        document
          .querySelector<HTMLInputElement>(
            "#sidebar-switch #commit-panel .commit-group-heading input",
          )!
          .click();
      }, 600),
      setTimeout(() => {
        original = document.querySelector<HTMLElement>(
          "#sidebar-switch #commit-panel .commit-group",
        )!;
        body = document.querySelector<HTMLElement>("#sidebar-switch .commit-panel-body")!;
        body.scrollTop = 30;
        scrollTop = body.scrollTop;
        document.querySelector<HTMLButtonElement>("#sidebar-switch #changes-tab")!.click();
      }, 900),
      setTimeout(() => {
        changesVisible =
          document.querySelector<HTMLElement>("#sidebar-switch .files-body")!.getClientRects()
            .length > 0;
        document.querySelector<HTMLButtonElement>("#sidebar-switch #commit-tab")!.click();
      }, 1200),
      setTimeout(() => {
        const sidebar = document.getElementById("sidebar-switch")!;
        const checkbox = sidebar.querySelector<HTMLInputElement>(
          "#commit-panel .commit-group-heading input",
        )!;
        activateVisibleCommitAction(sidebar);
        const handle = sidebar.querySelector<HTMLElement>(".sidebar-resizer")!;
        // Synthetic pointer events need a capture stub; trusted mouse drags use browser capture.
        handle.setPointerCapture = () => {};
        for (const [type, clientX] of [
          ["pointerdown", 600],
          ["pointermove", 530],
          ["pointerup", 530],
        ] as const) {
          handle.dispatchEvent(
            new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX }),
          );
        }
        const result = document.createElement("pre");
        result.id = "sidebar-result";
        result.textContent = JSON.stringify({
          calls: testCalls,
          changesVisible,
          sameNode: original === sidebar.querySelector("#commit-panel .commit-group"),
          stillUnchecked: !checkbox.checked,
          sameScroll: body?.scrollTop === scrollTop,
          action: testAction,
          width: sidebar.querySelector(".files")!.getBoundingClientRect().width,
          savedWidth: testSavedWidth,
          resizeCalls: testResizeCalls,
        });
        document.body.append(result);
      }, 1600),
      setTimeout(() => {
        const panes = document.getElementById("sidebar-switch")!;
        const review = panes.querySelector<HTMLElement>(".diff")!;
        const handle = panes.querySelector<HTMLElement>(".sidebar-resizer")!;
        resizeHeight = review.scrollHeight;
        handle.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 2, clientX: 600 }),
        );
        // Exercise the same CSS width update as the frame callback, without relying on headless RAF timing.
        panes.style.setProperty("--files-sidebar-width", "460px");
        duringHeight = review.scrollHeight;
        duringVisibility = getComputedStyle(review.querySelector(".code-block")!).contentVisibility;
        inheritedWidth = getComputedStyle(review).getPropertyValue("--files-sidebar-width");
        persistedDuringDrag = testResizeCalls;
        handle.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 2 }));
      }, 2000),
      setTimeout(() => {
        const panes = document.getElementById("sidebar-switch")!;
        const review = panes.querySelector<HTMLElement>(".diff")!;
        const result = document.createElement("pre");
        result.id = "resize-result";
        result.textContent = JSON.stringify({
          stableHeight: resizeHeight === duringHeight && review.scrollHeight === resizeHeight,
          duringVisibility,
          inheritedWidth,
          persistedDuringDrag,
          savesAfterCancel: testResizeCalls,
          widthAfterCancel: panes.querySelector(".files")!.getBoundingClientRect().width,
          restored: [...review.querySelectorAll<HTMLElement>(".code-block")].every(
            (block) => block.style.containIntrinsicBlockSize === "",
          ),
          visibilityAfterCancel: getComputedStyle(review.querySelector(".code-block")!)
            .contentVisibility,
        });
        document.body.append(result);
      }, 2300),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div
      id="sidebar-switch"
      className="panes"
      style={{
        width: 900,
        height: 280,
        gridTemplateColumns: "minmax(0, 1fr) var(--files-sidebar-width, 320px)",
      }}
    >
      <main className="diff" style={{ minHeight: 0 }}>
        {Array.from({ length: 30 }, (_, index) => (
          <div className="code-block" key={index}>
            <div style={{ height: 100 + index * 20 }}>Diff block {index}</div>
          </div>
        ))}
      </main>
      <FilesPane
        files={testFiles}
        activePath={null}
        selectedPaths={testSelection}
        onSelectionChange={onTestSidebarAction}
        onOpen={onTestSidebarAction}
        onCommit={() => {
          testAction = "propose";
        }}
        onChanges={flow.close}
        onCommitTab={flow.show}
        onResize={(width) => {
          testSavedWidth = width;
          testResizeCalls += 1;
        }}
        proposalOpen={flow.open}
        proposal={
          <CommitProposalPanel
            proposal={flow.proposal}
            pending={false}
            error={null}
            files={testFiles}
            onApprove={() => {
              testAction = "commit";
            }}
          />
        }
      />
    </div>
  );
}
