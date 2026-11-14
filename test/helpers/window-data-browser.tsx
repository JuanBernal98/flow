/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWindowData } from "../../src/window/useWindowData";
import type { WindowBootstrap } from "../../src/window/windowBootstrap";
import type { WindowDiffScope, WindowWorkspace } from "../../src/window/data";
import type { PersistedComment } from "../../src/core/comments";
import { OverviewPane } from "../../src/window/OverviewPane";
import type { WorkspaceItem } from "../../src/ui/lib/workspace";
import type { StoredTicketOverview } from "../../src/core/ticketOverview";

const testFiles = ["a.ts", "b.ts"].map((path) => ({
  path,
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  status: "modified" as const,
  additions: 1,
  deletions: 1,
  pending: true,
}));
const testWorkspace = { ticketsEnabled: false, items: [], branch: "test", checkedOutId: null };
const testBootstrap: WindowBootstrap = {
  files: testFiles,
  comments: [],
  workspace: testWorkspace,
  userName: "Test",
  preferences: { diffFontSize: 16, sidebarWidth: 320 },
  themes: { themes: [], configured: "zed" },
};
let testActiveReads = 0;
let testMaxReads = 0;
let testCommentReads = 0;
let testVersion = 0;
const testErrors: string[] = [];
let testWorkspaceReads = 0;
const testWorkspaceAccepted: string[] = [];
/** Simulate a slow comment read and fresh JSON for both identical and changed diffs. */
async function callTestWindowAPI<T>(path: string): Promise<T> {
  if (path === "/api/comments") {
    testActiveReads++;
    testMaxReads = Math.max(testMaxReads, testActiveReads);
    const read = ++testCommentReads;
    await new Promise<void>((resolve) => setTimeout(resolve, read === 1 ? 2300 : 50));
    testActiveReads--;
    if (read === 1) throw new Error("Temporary read failure");
    return [
      {
        id: 1,
        file: "a.ts",
        line: 1,
        body: "Fresh reply",
        author: "agent",
      } satisfies Partial<PersistedComment>,
    ] as T;
  }
  if (path === "/api/workspace") {
    const read = ++testWorkspaceReads;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, read === 1 ? 1100 : read === 2 ? 700 : 50),
    );
    if (read === 2) throw new Error("Superseded workspace failure");
    return { ...testWorkspace, branch: read === 1 ? "old" : "fresh" } as T;
  }
  const files = testFiles.map((file, index) => ({
    ...file,
    patch: index === 0 && testVersion ? "@@ -1 +20 @@\n-old\n+changed\n" : file.patch,
  }));
  return files as T;
}
/** Stable callbacks match the production hook's orchestration boundary. */
function onTestDataLoaded() {}
function onTestDataError(message: string) {
  testErrors.push(message);
}
/** Track accepted workspace responses independently of hook state. */
function onTestWorkspaceLoaded(workspace: WindowWorkspace) {
  testWorkspaceAccepted.push(workspace.branch ?? "");
}

/** Verify serialization, queued post-mutation reads, and per-file identity through actual React effects. */
function TestWindowData() {
  const [scope, setScope] = useState<WindowDiffScope>("pending");
  const data = useWindowData({
    api: callTestWindowAPI,
    secret: "test",
    bootstrap: testBootstrap,
    scope,
    editing: false,
    onDiffLoaded: onTestDataLoaded,
    onWorkspaceLoaded: onTestWorkspaceLoaded,
    onError: onTestDataError,
  });
  const latest = useRef(data);
  latest.current = data;
  useEffect(() => {
    const initial = latest.current;
    let identical = false;
    let independent = false;
    const timers = [
      setTimeout(() => {
        void latest.current.loadComments();
        latest.current.reload();
      }, 100),
      setTimeout(() => {
        setScope("branch");
        latest.current.reload();
      }, 200),
      setTimeout(() => {
        identical = latest.current.diff === initial.diff && latest.current.hunks === initial.hunks;
        testVersion = 1;
        setScope("pending");
      }, 500),
      setTimeout(() => {
        const next = latest.current;
        independent =
          next.diff?.[0] !== initial.diff?.[0] &&
          next.diff?.[1] === initial.diff?.[1] &&
          next.hunksByFile.get("b.ts") === initial.hunksByFile.get("b.ts") &&
          next.hunks[0]?.newRange[0] === 20;
      }, 900),
      setTimeout(() => {
        const result = document.createElement("pre");
        result.id = "data-result";
        result.textContent = JSON.stringify({
          identical,
          independent,
          maxReads: testMaxReads,
          reads: testCommentReads,
          comments: latest.current.comments.length,
          errors: testErrors,
          workspace: latest.current.workspace?.branch,
          acceptedWorkspaces: testWorkspaceAccepted,
        });
        document.body.append(result);
      }, 2700),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <p>{data.comments.length} comments</p>;
}

const testOverviewErrors: string[] = [];
/** Build complete ticket and overview records without reaching any external integrations. */
function createTestOverviewItem(ticketId: string): WorkspaceItem {
  return { id: ticketId, ticketId, title: ticketId, section: "todo", status: "pending" };
}
/** Deliberately resolve A after B and reject C after it has been deselected. */
async function callTestOverviewAPI<T>(path: string): Promise<T> {
  const ticket = path.split("/").at(-1)!;
  await new Promise<void>((resolve) =>
    setTimeout(
      resolve,
      ticket === "TEST-1" ? 700 : ticket === "TEST-3" || ticket === "TEST-5" ? 300 : 50,
    ),
  );
  if (ticket === "TEST-3" || ticket === "TEST-5") throw new Error("Stale overview failure");
  return {
    schema: 1,
    ticket,
    writtenAt: "2026-01-01T00:00:00Z",
    overview: {
      summary: `Summary for ${ticket}`,
      why: [],
      todo: [],
      acceptance: [],
      code: [],
      questions: [],
      plan: [],
    },
  } satisfies StoredTicketOverview as T;
}
/** Collect only errors which the actual pane considers current. */
function onTestOverviewError(message: string) {
  testOverviewErrors.push(message);
}

/** Drive the real overview pane through rapid selection changes, deselection and unmount. */
function TestOverviewRace() {
  const [item, setItem] = useState<WorkspaceItem | null>(createTestOverviewItem("TEST-1"));
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    let latestWon = false;
    let deselected = false;
    const timers = [
      setTimeout(() => setItem(createTestOverviewItem("TEST-2")), 100),
      setTimeout(() => {
        latestWon =
          document.querySelector("#overview-race .summary")?.textContent === "Summary for TEST-2";
      }, 900),
      setTimeout(() => setItem(createTestOverviewItem("TEST-3")), 1000),
      setTimeout(() => setItem(createTestOverviewItem("TEST-4")), 1100),
      setTimeout(() => setItem(null), 1400),
      setTimeout(() => {
        deselected = !document.querySelector("#overview-race .summary");
        setItem(createTestOverviewItem("TEST-5"));
      }, 1500),
      setTimeout(() => setMounted(false), 1600),
      setTimeout(() => {
        const result = document.createElement("pre");
        result.id = "overview-race-result";
        result.textContent = JSON.stringify({ latestWon, deselected, errors: testOverviewErrors });
        document.body.append(result);
      }, 2000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div id="overview-race">
      {mounted ? (
        <OverviewPane item={item} api={callTestOverviewAPI} onError={onTestOverviewError} />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <>
    <TestWindowData />
    <TestOverviewRace />
  </>,
);
