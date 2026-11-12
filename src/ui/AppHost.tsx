import { useCallback, useState } from "react";
import { resolveConfiguredCliInput } from "../core/config";
import { loadAppBootstrap } from "../core/loaders";
import { resolveRuntimeCliInput } from "../core/terminal";
import type { AppBootstrap, CliInput } from "../core/types";
import type { FocusRequest } from "../core/focusRequests";
import type { GitRun } from "../core/ticketSwitch";
import type { MergeRequest, WorkspaceReviewsResult } from "../core/gitlab";
import type { StoredTicketOverview } from "../core/ticketOverview";
import type { MergedTicketResult, WorkspaceTasksResult } from "../core/youtrack";
import { App } from "./App";
import { useWorkspaceTasks } from "./hooks/useWorkspaceTasks";

/** Keep one live flow app mounted while supporting fs-driven reloads. */
export function AppHost({
  bootstrap,
  onQuit = () => process.exit(0),
  workspaceTasksLoader,
  onOpenUrl,
  createTicketGit,
  requestTicketContext,
  requestReview,
  requestCommit,
  requestMergeRequestOpen,
  readAgentFocusRequest,
  loadMergeRequests,
  loadReviews,
  closeMergedTicket,
  readOverview,
  issueUrl,
  projectKeys,
  startupNotice,
  workspaceConnected,
}: {
  bootstrap: AppBootstrap;
  onQuit?: () => void;
  workspaceTasksLoader?: () => Promise<WorkspaceTasksResult>;
  onOpenUrl?: (url: string) => void;
  createTicketGit?: (cwd: string) => GitRun;
  requestTicketContext?: (repoRoot: string, ticketId: string) => void;
  requestReview?: (repoRoot: string, ticketId: string, mergeRequestIid: number | undefined) => void;
  requestCommit?: (repoRoot: string, ticketId: string | undefined) => void;
  requestMergeRequestOpen?: (repoRoot: string, ticketId: string | undefined) => void;
  readAgentFocusRequest?: (repoRoot: string) => FocusRequest | null;
  loadMergeRequests?: (repoRoot: string) => Promise<MergeRequest[]>;
  loadReviews?: (repoRoot: string) => Promise<WorkspaceReviewsResult>;
  closeMergedTicket?: (ticketId: string) => Promise<MergedTicketResult>;
  readOverview?: (repoRoot: string, ticketId: string) => StoredTicketOverview | null;
  issueUrl?: (ticketId: string) => string | undefined;
  projectKeys?: readonly string[];
  startupNotice?: string;
  workspaceConnected?: boolean;
}) {
  const [activeBootstrap, setActiveBootstrap] = useState(bootstrap);
  const [appVersion, setAppVersion] = useState(0);
  // Tasks live above the remount key so a full review reload does not refetch YouTrack.
  const workspaceTasks = useWorkspaceTasks(workspaceTasksLoader);

  const reloadSession = useCallback(
    async (nextInput: CliInput, options?: { resetApp?: boolean; sourcePath?: string }) => {
      // Re-run the same startup normalization pipeline used on first launch so reloads honor
      // runtime defaults and config layering instead of assuming `nextInput` is already final.
      const runtimeInput = resolveRuntimeCliInput(nextInput);
      const configuredInput = resolveConfiguredCliInput(runtimeInput, {
        cwd: options?.sourcePath,
      }).input;
      const nextBootstrap = await loadAppBootstrap(configuredInput, {
        cwd: options?.sourcePath,
      });

      setActiveBootstrap(nextBootstrap);
      if (options?.resetApp !== false) {
        // Bumping the key forces a full App remount. Callers that pass `resetApp: false` get a
        // soft reload that preserves in-memory UI state like selection, filter text, and pane size.
        setAppVersion((current) => current + 1);
      }
    },
    [],
  );

  return (
    <App
      key={appVersion}
      bootstrap={activeBootstrap}
      onQuit={onQuit}
      onReloadSession={reloadSession}
      workspaceTasks={workspaceTasks.tasks}
      onRefreshWorkspaceTasks={workspaceTasks.refresh}
      onOpenUrl={onOpenUrl}
      createTicketGit={createTicketGit}
      requestTicketContext={requestTicketContext}
      requestReview={requestReview}
      requestCommit={requestCommit}
      requestMergeRequestOpen={requestMergeRequestOpen}
      readAgentFocusRequest={readAgentFocusRequest}
      loadMergeRequests={loadMergeRequests}
      loadReviews={loadReviews}
      closeMergedTicket={closeMergedTicket}
      readOverview={readOverview}
      issueUrl={issueUrl}
      projectKeys={projectKeys}
      startupNotice={startupNotice}
      workspaceConnected={workspaceConnected}
    />
  );
}
