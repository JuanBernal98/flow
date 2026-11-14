/** @jsxImportSource react */
import { createRoot } from "react-dom/client";
import { DiffPane } from "../../src/window/DiffPane";
import { groupWindowHunks, listWindowHunks } from "../../src/window/review";
import type { WindowTheme } from "../../src/window/data";
import { CommitProposalPanel } from "../../src/window/CommitProposalPanel";
import type { CommitProposal } from "../../src/core/commitProposal";
import { FilesPane } from "../../src/window/FilesPane";
import { useCommitProposal } from "../../src/window/useCommitProposal";
import { TestInlineComments } from "./window-comments-browser";
import { TestSidebarSwitching } from "./window-sidebar-browser";
import { TestReviewNavigation } from "./window-navigation-browser";
import {
  TestCommentNotifications,
  TestSharedProposalActivity,
} from "./window-notifications-browser";

let testApprovedCommits: readonly number[] = [];
let testPollCalls = 0;
let testEmptyPollCalls = 0;
let testPollRenders = 0;
const testProposal: CommitProposal = {
  schema: 1,
  id: "poll-test",
  status: "preparing",
  completed: 0,
  snapshot: { branch: "test", head: "test", fingerprint: "test", files: ["test.ts"] },
};

/** Return fresh JSON objects like the real server, including unchanged waiting responses. */
async function callTestProposalAPI<T>(): Promise<T> {
  testPollCalls += 1;
  return JSON.parse(
    JSON.stringify({ ...testProposal, status: testPollCalls < 3 ? "preparing" : "ready" }),
  ) as T;
}
/** A repository without a pending request should be read once and then remain idle. */
async function callTestEmptyProposalAPI<T>(): Promise<T> {
  testEmptyPollCalls += 1;
  return null as T;
}
/** Stable callbacks isolate hook polling from unrelated rerenders in the fixture. */
function onTestProposalCompleted() {}

/** Count actual React renders across multiple polling intervals, including an identical response. */
function TestProposalPolling() {
  const flow = useCommitProposal(callTestProposalAPI, onTestProposalCompleted);
  testPollRenders += 1;
  return <div id="poll-status">{flow.proposal?.status}</div>;
}
/** Mount an idle repository next to the active request to verify polling is phase-scoped. */
function TestEmptyProposalPolling() {
  useCommitProposal(callTestEmptyProposalAPI, onTestProposalCompleted);
  return null;
}

const cases = [
  { id: "split-wide", style: "split", width: 1200, long: false },
  { id: "split-narrow-long", style: "split", width: 480, long: true },
  { id: "stack-wide", style: "unified", width: 1200, long: false },
] as const;

const testTheme: WindowTheme = {
  id: "test",
  label: "Test",
  appearance: "light",
  codeTheme: "pierre-light",
  colors: {
    background: "#fff",
    panel: "#fff",
    panelAlt: "#fafafa",
    border: "#ddd",
    accent: "#06c",
    accentMuted: "#def",
    text: "#111",
    muted: "#666",
    faint: "#999",
    added: "#080",
    removed: "#c00",
    modified: "#960",
    addedRow: "#efe",
    removedRow: "#fee",
    addedWord: "#cfc",
    removedWord: "#fcc",
  },
};

/** Exercise the actual desktop renderer and its production CSS at wide and narrow widths. */
function renderTestWindowDiffs() {
  const diffs = cases.map((scenario) => {
    const suffix = scenario.long ? "x".repeat(300) : "short";
    const patch = `diff --git a/test.ts b/test.ts\n--- a/test.ts\n+++ b/test.ts\n@@ -1,2 +1,2 @@\n-export const value = '${suffix}';\n+export const value = 'new';\n export const kept = true;\n@@ -20,2 +20,2 @@\n-export const later = 1;\n+export const later = 2;\n export const last = true;\n`;
    const files = [
      { path: "test.ts", patch, status: "modified" as const, additions: 2, deletions: 2 },
    ];
    const hunks = listWindowHunks(files);
    return (
      <section id={scenario.id} key={scenario.id} style={{ width: scenario.width }}>
        <DiffPane
          navigation={null}
          files={files}
          selectedPaths={new Set()}
          onSelectFile={onTestProposalCompleted}
          diffStyle={scenario.style}
          scope="pending"
          theme={testTheme}
          hunks={hunks}
          hunksByFile={groupWindowHunks(hunks)}
          focusedHunk={null}
          comments={[]}
          editing={false}
          replyingTo={null}
          onSaveComment={onTestProposalCompleted}
          onCancelComment={onTestProposalCompleted}
          onStartComment={onTestProposalCompleted}
          onReplyComment={onTestProposalCompleted}
          onReadComment={onTestProposalCompleted}
          onFocusHunk={onTestProposalCompleted}
          userName="Test"
        />
      </section>
    );
  });
  const proposal: CommitProposal = {
    schema: 1,
    id: "test",
    status: "ready",
    completed: 0,
    snapshot: {
      branch: "FLOW-42-review",
      head: "test",
      fingerprint: "test",
      files: ["src/review.ts", "src/layout.ts"],
    },
    plan: {
      agentName: "Codex",
      commits: [
        {
          kind: "commit",
          message: "fix: keep long commit messages readable while the review remains visible",
          files: ["src/review.ts"],
        },
        {
          kind: "commit",
          message: "feat: show the proposal in the Changes sidebar",
          files: ["src/layout.ts"],
        },
      ],
    },
  };
  return (
    <>
      <section style={{ display: "flex", gap: 24 }}>
        {(["pending", "branch"] as const).map((scope) => (
          <div
            key={scope}
            id={`empty-${scope}`}
            style={{ width: scope === "pending" ? 760 : 260, height: 320, display: "grid" }}
          >
            <DiffPane
              navigation={null}
              files={[]}
              selectedPaths={new Set()}
              onSelectFile={onTestProposalCompleted}
              diffStyle="unified"
              scope={scope}
              theme={testTheme}
              hunks={[]}
              hunksByFile={new Map()}
              focusedHunk={null}
              comments={[]}
              editing={false}
              replyingTo={null}
              onSaveComment={onTestProposalCompleted}
              onCancelComment={onTestProposalCompleted}
              onStartComment={onTestProposalCompleted}
              onReplyComment={onTestProposalCompleted}
              onReadComment={onTestProposalCompleted}
              onFocusHunk={onTestProposalCompleted}
              userName="Test"
            />
          </div>
        ))}
      </section>
      {diffs}
      {(["ready", "preparing"] as const).map((status) => (
        <div
          key={status}
          id={`panel-${status}`}
          style={{ width: 320, height: 600, display: "grid" }}
        >
          <FilesPane
            files={[]}
            activePath={null}
            selectedPaths={new Set()}
            onSelectionChange={() => {}}
            onOpen={() => {}}
            proposal={
              <CommitProposalPanel
                proposal={status === "ready" ? proposal : { ...proposal, status, plan: undefined }}
                pending={false}
                error={null}
                onApprove={(commits) => {
                  testApprovedCommits = commits;
                }}
              />
            }
          />
        </div>
      ))}
      <TestProposalPolling />
      <TestEmptyProposalPolling />
      <TestInlineComments />
      <TestSidebarSwitching />
      <TestReviewNavigation />
      <TestCommentNotifications />
      <TestSharedProposalActivity />
    </>
  );
}

createRoot(document.getElementById("root")!).render(renderTestWindowDiffs());

/** Wait for Pierre's shadow roots, then record real browser geometry for the test process. */
function measureTestColumns() {
  const measurements = cases.map((scenario) => {
    const pre = document
      .getElementById(scenario.id)
      ?.querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-diff]");
    if (!pre) return null;
    const columns = [...pre.querySelectorAll<HTMLElement>("[data-code]")];
    if (
      columns.length !== (scenario.style === "split" ? 2 : 1) ||
      !pre.querySelector("[data-line]")
    )
      return null;
    const bounds = pre.getBoundingClientRect();
    return {
      id: scenario.id,
      display: getComputedStyle(pre).display,
      width: bounds.width,
      separatorMarker: getComputedStyle(
        pre.querySelector('[data-gutter] [data-separator="simple"]')!,
        "::after",
      ).content,
      separatorLine: getComputedStyle(
        pre.querySelector('[data-content] [data-separator="simple"]')!,
      ).backgroundImage,
      additionAccent: getComputedStyle(
        pre.querySelector<HTMLElement>('[data-line][data-line-type="change-addition"]')!,
      ).boxShadow,
      deletionAccent: getComputedStyle(
        pre.querySelector<HTMLElement>('[data-line][data-line-type="change-deletion"]')!,
      ).boxShadow,
      contextAccent: getComputedStyle(
        pre.querySelector<HTMLElement>('[data-line][data-line-type="context"]')!,
      ).boxShadow,
      columns: columns.map((column) => {
        const box = column.getBoundingClientRect();
        return { left: box.left - bounds.left, top: box.top - bounds.top, width: box.width };
      }),
    };
  });
  if (measurements.some((measurement) => measurement === null)) {
    setTimeout(measureTestColumns, 50);
    return;
  }
  document.getElementById("browser-result")!.textContent = JSON.stringify(measurements);
  const emptyStates = (["pending", "branch"] as const).map((scope) => {
    const pane = document.querySelector<HTMLElement>(`#empty-${scope} .diff`)!;
    const content = pane.querySelector<HTMLElement>(".diff-empty")!;
    const bounds = pane.getBoundingClientRect();
    const status = content.getBoundingClientRect();
    return {
      scope,
      title: content.querySelector("h2")?.textContent,
      centered:
        Math.abs(status.left + status.width / 2 - bounds.left - bounds.width / 2) < 1 &&
        Math.abs(status.top + status.height / 2 - bounds.top - bounds.height / 2) < 1,
      fits: pane.scrollWidth === pane.clientWidth && pane.scrollHeight === pane.clientHeight,
    };
  });
  const emptyResult = document.createElement("pre");
  emptyResult.id = "empty-result";
  emptyResult.textContent = JSON.stringify(emptyStates);
  document.body.append(emptyResult);
  const panels = (["ready", "preparing"] as const).map((status) => {
    const panel = document.querySelector<HTMLElement>(`#panel-${status} .commit-panel`)!;
    const body = panel.querySelector<HTMLElement>(".commit-panel-body")!;
    const footer = panel.querySelector<HTMLElement>(".commit-panel-footer")!;
    const groups = [...panel.querySelectorAll<HTMLElement>(".commit-group")];
    return {
      status,
      width: panel.getBoundingClientRect().width,
      sidebarBorder: getComputedStyle(panel.closest(".files")!).borderLeftWidth,
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
      footerBottom: footer.getBoundingClientRect().bottom - panel.getBoundingClientRect().top,
      height: panel.getBoundingClientRect().height,

      groups: groups.length,
      modal: document.querySelector("dialog") !== null,
    };
  });
  document.getElementById("panel-result")!.textContent = JSON.stringify(panels);
  const checkboxes = [
    ...document.querySelectorAll<HTMLInputElement>(
      '#panel-ready .commit-group-heading input[type="checkbox"]',
    ),
  ];
  const allChecked = checkboxes.every((checkbox) => checkbox.checked);
  checkboxes[1]?.click();
  setTimeout(() => {
    const button = document.querySelector<HTMLButtonElement>(
      "#panel-ready .commit-panel-footer button",
    )!;
    button.click();
    checkboxes[0]?.click();
    setTimeout(() => {
      document.getElementById("selection-result")!.textContent = JSON.stringify({
        allChecked,
        approved: testApprovedCommits,
        disabledWhenEmpty: button.disabled,
        headerUnchanged: document.querySelector("#panel-ready .files-tabs")?.textContent,
        footerButton: button.textContent,
        footerButtons: document.querySelectorAll("#panel-ready .commit-panel-footer button").length,
      });
    }, 0);
  }, 0);
}
setTimeout(measureTestColumns, 100);
setTimeout(() => {
  document.getElementById("poll-result")!.textContent = JSON.stringify({
    calls: testPollCalls,
    emptyCalls: testEmptyPollCalls,
    renders: testPollRenders,
    status: document.getElementById("poll-status")?.textContent,
  });
}, 4500);
