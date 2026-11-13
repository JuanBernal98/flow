/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useWindowData } from "../../src/window/useWindowData";
import type { WindowBootstrap } from "../../src/window/windowBootstrap";
import type { WindowDiffScope } from "../../src/window/data";
import type { PersistedComment } from "../../src/core/comments";

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
  if (path === "/api/workspace") return testWorkspace as T;
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
    onWorkspaceLoaded: onTestDataLoaded,
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
      }, 100),
      setTimeout(() => setScope("branch"), 200),
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
        });
        document.body.append(result);
      }, 2700),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return <p>{data.comments.length} comments</p>;
}

createRoot(document.getElementById("root")!).render(<TestWindowData />);
