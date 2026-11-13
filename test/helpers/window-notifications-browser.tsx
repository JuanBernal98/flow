/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import type { PersistedComment } from "../../src/core/comments";
import { FilesPane } from "../../src/window/FilesPane";
import { CommentThread } from "../../src/window/CommentThread";
import { useCommitProposal } from "../../src/window/useCommitProposal";
import { CommitProposalPanel } from "../../src/window/CommitProposalPanel";
import type { CommitProposal } from "../../src/core/commitProposal";

const testFiles = [
  { path: "notify.ts", patch: "", status: "modified" as const, additions: 1, deletions: 0 },
];
const testSelection = new Set<string>();
/** Notifications need no editing or file selection in this fixture. */
function onTestNotificationAction() {}

/** Exercise the real badge, discussion visibility observer, and a second incoming reply. */
export function TestCommentNotifications() {
  const [comments, setComments] = useState<PersistedComment[]>([
    {
      id: 1,
      file: "notify.ts",
      line: 1,
      range: [1, 1],
      anchor: "0123456789abcdef",
      body: "Review this",
      replies: [{ author: "agent", body: "Fixed", agentName: "Codex" }],
    },
  ]);
  const review = useRef<HTMLDivElement>(null);
  const [opens, setOpens] = useState(0);
  useEffect(() => {
    let firstUnread = false;
    let readAfterOpening = false;
    const timers = [
      setTimeout(() => {
        const badge = document.querySelector<HTMLButtonElement>(
          "#notification-review .file-comment-badge",
        )!;
        firstUnread = badge.dataset.unread === "true";
        const pane = document.getElementById("notification-review")!;
        pane.style.position = "fixed";
        pane.style.inset = "0 auto auto 0";
        pane.style.zIndex = "1000";
        badge.scrollIntoView({ block: "center" });
        badge.click();
      }, 500),
      setTimeout(() => {
        readAfterOpening =
          document.querySelector<HTMLElement>("#notification-review .file-comment-badge")!.dataset
            .unread === "false";
        const pane = document.getElementById("notification-review")!;
        pane.style.position = "";
        pane.style.inset = "";
        pane.style.zIndex = "";
        review.current!.scrollTop = 0;
        setComments((current) =>
          current.map((comment) => ({
            ...comment,
            replies: [
              ...(comment.replies ?? []),
              { author: "agent", body: "Another detail", agentName: "Codex" },
            ],
          })),
        );
      }, 1100),
      setTimeout(() => {
        const badge = document.querySelector<HTMLButtonElement>(
          "#notification-review .file-comment-badge",
        )!;
        const result = document.createElement("pre");
        result.id = "notification-result";
        result.textContent = JSON.stringify({
          firstUnread,
          readAfterOpening,
          unreadAgain: badge.dataset.unread === "true",
          count: badge.textContent?.trim(),
          sameCountSize:
            getComputedStyle(badge.parentElement!.querySelector(".stat")!).fontSize ===
            getComputedStyle(badge.parentElement!.querySelector(".file-name")!).fontSize,
          label: badge.getAttribute("aria-label"),
        });
        document.body.append(result);
      }, 1700),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div
      id="notification-review"
      className="panes"
      data-opens={opens}
      style={{
        width: 900,
        height: 260,
        gridTemplateColumns: "minmax(0,1fr) var(--files-sidebar-width)",
      }}
    >
      <div ref={review} className="diff" style={{ minHeight: 0 }}>
        <div style={{ height: 600 }} />
        <CommentThread
          comments={comments}
          userName="Alex"
          editor={null}
          onRead={(shown) =>
            setComments((current) =>
              current.map((comment) => ({
                ...comment,
                replies: comment.replies?.map((reply, index) =>
                  index < (shown.replies?.length ?? 0)
                    ? { ...reply, readAt: new Date().toISOString() }
                    : reply,
                ),
              })),
            )
          }
        />
      </div>
      <FilesPane
        files={testFiles}
        activePath={null}
        selectedPaths={testSelection}
        onSelectionChange={onTestNotificationAction}
        onOpen={onTestNotificationAction}
        comments={comments}
        onOpenComments={() => {
          setOpens((count) => count + 1);
          review.current!.scrollTop = review.current!.scrollHeight;
        }}
      />
    </div>
  );
}

let testPosts = 0;
let testReady = false;
const testActivityProposal: CommitProposal = {
  schema: 1,
  id: "activity",
  status: "preparing",
  completed: 0,
  snapshot: { branch: "test", head: "test", fingerprint: "test", files: ["notify.ts"] },
};
/** Delay the request response so the user can change tabs while it is in flight. */
async function callTestActivityAPI<T>(
  _path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  if (init?.method === "POST") {
    testPosts++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!testPosts) return null as T;
  return structuredClone(
    testReady
      ? {
          ...testActivityProposal,
          status: "ready",
          plan: {
            agentName: "Codex",
            commits: [{ kind: "commit", message: "fix: example", files: ["notify.ts"] }],
          },
        }
      : testActivityProposal,
  ) as T;
}

/** Both sidebar tabs must observe the same proposal request and remain where the user chose. */
export function TestSharedProposalActivity() {
  const flow = useCommitProposal(callTestActivityAPI, onTestNotificationAction);
  useEffect(() => {
    let pendingLabel = "";
    let pendingDisabled = false;
    let preparingLabel = "";
    let stayedInChanges = false;
    const timers = [
      setTimeout(
        () =>
          document
            .querySelector<HTMLButtonElement>("#shared-activity .files-footer button")!
            .click(),
        400,
      ),
      setTimeout(
        () => document.querySelector<HTMLButtonElement>("#shared-activity #changes-tab")!.click(),
        600,
      ),
      setTimeout(() => {
        const button = document.querySelector<HTMLButtonElement>(
          "#shared-activity .files-footer button",
        )!;
        pendingLabel = button.textContent ?? "";
        pendingDisabled = button.disabled;
        button.click();
      }, 700),
      setTimeout(() => {
        preparingLabel =
          document.querySelector("#shared-activity .files-footer button")!.textContent ?? "";
        stayedInChanges =
          document.querySelector("#shared-activity #changes-tab")!.getAttribute("aria-selected") ===
          "true";
      }, 1300),
      setTimeout(() => {
        testReady = true;
      }, 1800),
      setTimeout(() => {
        const button = document.querySelector<HTMLButtonElement>(
          "#shared-activity .files-footer button",
        )!;
        const result = document.createElement("pre");
        result.id = "shared-activity-result";
        result.textContent = JSON.stringify({
          pendingLabel,
          pendingDisabled,
          preparingLabel,
          stayedInChanges,
          posts: testPosts,
          finished: !button.disabled,
        });
        document.body.append(result);
      }, 3800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <div
      id="shared-activity"
      className="panes"
      style={{
        width: 900,
        height: 260,
        gridTemplateColumns: "minmax(0,1fr) var(--files-sidebar-width)",
      }}
    >
      <div />
      <FilesPane
        files={testFiles}
        activePath={null}
        selectedPaths={testSelection}
        onSelectionChange={onTestNotificationAction}
        onOpen={onTestNotificationAction}
        commitActivity={flow.activity}
        onCommit={() => void flow.request()}
        onChanges={flow.close}
        onCommitTab={flow.show}
        proposalOpen={flow.open}
        proposal={
          <CommitProposalPanel
            proposal={flow.proposal}
            pending={flow.pending}
            activity={flow.activity}
            error={flow.error}
            onApprove={onTestNotificationAction}
          />
        }
      />
    </div>
  );
}
