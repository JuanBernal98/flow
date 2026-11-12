import {
  MouseButton,
  type MouseEvent as TuiMouseEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  commentsForHunkRange,
  computeAnchorForFile,
  mutateCommentsFile,
  withAddedComment,
  withRemovedComment,
  type CommentsFile,
  type PersistedComment,
} from "../core/comments";
import {
  writeCommitRequest,
  writeMergeRequestOpenRequest,
  writeReviewRequest,
  writeTicketContextRequest,
} from "../core/agentRequests";
import { openInBrowser } from "../core/browser";
import { readFocusRequest, resolveFocusTarget, type FocusRequest } from "../core/focusRequests";
import { copyToClipboard } from "../core/clipboard";
import { DEFAULT_VIEW_PREFERENCES, findRepoRoot } from "../core/config";
import { resolveEditorLaunch, runEditorLaunch } from "../core/editor";
import { hunkFingerprint } from "../core/hunkFingerprint";
import { hunkLineRange } from "../core/hunkRange";
import { WORKTREE_BASE_REF } from "../core/git";
import type { AppBootstrap, CliInput, LayoutMode, VcsCommandInput } from "../core/types";
import {
  createGitRun,
  describeTicketSwitch,
  switchToReviewBranch,
  switchToTicket,
  type GitRun,
} from "../core/ticketSwitch";
import { loadTicketLineStats, type LineStats } from "../core/ticketStats";
import {
  linkTicketMergeRequests,
  type MergeRequest,
  type WorkspaceReviewsResult,
} from "../core/gitlab";
import type { MergedTicketResult } from "../core/youtrack";
import { canReloadInput, computeWatchSignature } from "../core/watch";
import { createWatchSignatureProbe } from "../core/watchProbe";
import { DriftedCommentsBanner } from "./components/chrome/DriftedCommentsBanner";
import { StatusBar } from "./components/chrome/StatusBar";
import { DiffPane } from "./components/panes/DiffPane";
import { SidebarPane } from "./components/panes/SidebarPane";
import { TicketOverviewPane } from "./components/panes/TicketOverviewPane";
import { useTicketOverview } from "./hooks/useTicketOverview";
import { readTicketOverview, type StoredTicketOverview } from "../core/ticketOverview";
import { WorkspaceSidebar } from "./components/panes/WorkspaceSidebar";
import { PaneDivider } from "./components/panes/PaneDivider";
import {
  findMaxLineNumber,
  maxFileCodeLineWidth,
  resolveCodeViewportWidth,
  resolveLineNumberDigits,
} from "./diff/codeColumns";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useFocusRequests } from "./hooks/useFocusRequests";
import { useReviewController } from "./hooks/useReviewController";
import { fileRowId } from "./lib/ids";
import { resolveResponsiveLayout, resolveWorkspaceWidth, WORKSPACE_WIDTH } from "./lib/responsive";
import { resizeSidebarWidth } from "./lib/sidebar";
import {
  buildWorkspaceItems,
  filterWorkspaceItems,
  itemOwnsBranch,
  mergedTicketIds,
  moveApprovedToReadyToMerge,
  type WorkspaceReviewsState,
  type WorkspaceTasksState,
} from "./lib/workspace";
import { resolveTheme, THEMES } from "./themes";

// A stable empty default, so the workspace memo does not rebuild on every render.
const NO_PROJECT_KEYS: readonly string[] = [];

type FocusArea = "files" | "filter" | "workspace" | "workspaceFilter" | "tree";

const FAST_CODE_HORIZONTAL_SCROLL_COLUMNS = 8;
// How often watch mode checks for changes. Each check runs git off the UI thread and never overlaps
// the previous one, so slow repos simply check less often.
const WATCH_POLL_INTERVAL_MS = 1_000;

const LazyHelpDialog = lazy(async () => ({
  default: (await import("./components/chrome/HelpDialog")).HelpDialog,
}));
const LazyCommentEditor = lazy(async () => ({
  default: (await import("./components/chrome/CommentEditor")).CommentEditor,
}));
const LazyConfirmDialog = lazy(async () => ({
  default: (await import("./components/chrome/ConfirmDialog")).ConfirmDialog,
}));

/** Clamp a value into an inclusive range. */
function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Preserve the active app view settings when rebuilding the current input. */
function withCurrentViewOptions(
  input: CliInput,
  view: {
    layoutMode: LayoutMode;
    themeId: string;
    showHunkHeaders: boolean;
    showLineNumbers: boolean;
    wrapLines: boolean;
  },
): CliInput {
  return {
    ...input,
    options: {
      ...input.options,
      mode: view.layoutMode,
      theme: view.themeId,
      hunkHeaders: view.showHunkHeaders,
      lineNumbers: view.showLineNumbers,
      wrapLines: view.wrapLines,
    },
  };
}

/** Whether `B` can switch this review between the whole branch and uncommitted changes only. */
function canToggleBranchReview(input: CliInput): input is VcsCommandInput {
  return (
    input.kind === "vcs" &&
    !input.staged &&
    (input.branchReview !== undefined || input.range === WORKTREE_BASE_REF)
  );
}

/** Orchestrate global app state, layout, navigation, and pane coordination. */
export function App({
  bootstrap,
  onQuit = () => process.exit(0),
  onReloadSession,
  workspaceTasks,
  onRefreshWorkspaceTasks = () => {},
  onOpenUrl = openInBrowser,
  createTicketGit = createGitRun,
  requestTicketContext = writeTicketContextRequest,
  requestReview = writeReviewRequest,
  requestCommit = writeCommitRequest,
  requestMergeRequestOpen = writeMergeRequestOpenRequest,
  readAgentFocusRequest = readFocusRequest,
  loadMergeRequests,
  loadReviews,
  closeMergedTicket,
  readOverview = readTicketOverview,
  issueUrl,
  projectKeys = NO_PROJECT_KEYS,
  workspaceConnected = true,
}: {
  bootstrap: AppBootstrap;
  workspaceTasks: WorkspaceTasksState;
  onRefreshWorkspaceTasks?: () => void;
  onOpenUrl?: (url: string) => void;
  createTicketGit?: (cwd: string) => GitRun;
  /** Leave a request for the agent to load a ticket's context after flow switches to it. */
  requestTicketContext?: (repoRoot: string, ticketId: string) => void;
  /** Ask the agent to review a ticket's code against the ticket, through `.flow/requests.json`. */
  requestReview?: (repoRoot: string, ticketId: string, mergeRequestIid: number | undefined) => void;
  /** Ask the agent to propose and make commits for the checked-out branch's uncommitted work. */
  requestCommit?: (repoRoot: string, ticketId: string | undefined) => void;
  /** Ask the agent to open the checked-out branch's merge request. */
  requestMergeRequestOpen?: (repoRoot: string, ticketId: string | undefined) => void;
  /** Read the coding agent's newest request to show a file and line. */
  readAgentFocusRequest?: (repoRoot: string) => FocusRequest | null;
  /** Load my GitLab merge requests for the repository; absent means tickets show no MR. */
  loadMergeRequests?: (repoRoot: string) => Promise<MergeRequest[]>;
  /** Load the squad merge requests listed under Reviews; absent means Reviews is not connected. */
  loadReviews?: (repoRoot: string) => Promise<WorkspaceReviewsResult>;
  /**
   * Move one of my tickets on from Review once its MR is merged (`[youtrack] merged_state`);
   * absent means tickets are never moved.
   */
  closeMergedTicket?: (ticketId: string) => Promise<MergedTicketResult>;
  /** Read a ticket's overview from `.flow/overviews/`; tests swap in a fixture. */
  readOverview?: (repoRoot: string, ticketId: string) => StoredTicketOverview | null;
  /** Link to a ticket by id, so `h` on a review opens the ticket it works on. */
  issueUrl?: (ticketId: string) => string | undefined;
  /** Projects whose ids count as tickets in MR branches and titles (`[youtrack] project_keys`). */
  projectKeys?: readonly string[];
  /** Whether this repository connects to YouTrack or GitLab; without either, the workspace and
   * the Overview start closed, as there is nothing to list. `S` and `x` still open them. */
  workspaceConnected?: boolean;
  onQuit?: () => void;
  onReloadSession: (
    nextInput: CliInput,
    options?: { resetApp?: boolean; sourcePath?: string },
  ) => Promise<void>;
}) {
  const SIDEBAR_MIN_WIDTH = 22;
  const DIFF_MIN_WIDTH = 48;
  const BODY_PADDING = 2;
  // Blank columns between side panes and the diff, on the base background.
  const PANE_GAP = 2;

  const pagerMode = Boolean(bootstrap.input.options.pager);
  const renderer = useRenderer();
  const terminal = useTerminalDimensions();
  // Repo root is invariant for one App mount; resolving it once avoids walking the
  // filesystem on every hunk-action keystroke.
  const repoRoot = useMemo(() => findRepoRoot() ?? null, []);
  const sidebarScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const diffScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const wrapToggleScrollTopRef = useRef<number | null>(null);
  const layoutToggleScrollTopRef = useRef<number | null>(null);
  const [layoutToggleRequestId, setLayoutToggleRequestId] = useState(0);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(bootstrap.initialMode);
  const [themeId, setThemeId] = useState(
    () => resolveTheme(bootstrap.initialTheme, renderer.themeMode).id,
  );
  const [showLineNumbers, setShowLineNumbers] = useState(bootstrap.initialShowLineNumbers ?? true);
  const [wrapLines, setWrapLines] = useState(bootstrap.initialWrapLines ?? false);
  const [codeHorizontalOffset, setCodeHorizontalOffset] = useState(0);
  const [showHunkHeaders, setShowHunkHeaders] = useState(
    bootstrap.initialShowHunkHeaders ?? DEFAULT_VIEW_PREFERENCES.showHunkHeaders,
  );
  const [sidebarVisible, setSidebarVisible] = useState(
    bootstrap.initialShowFileTree ?? DEFAULT_VIEW_PREFERENCES.showFileTree,
  );
  const [workspaceVisible, setWorkspaceVisible] = useState(workspaceConnected);
  const [overviewVisible, setOverviewVisible] = useState(
    workspaceConnected && (bootstrap.initialShowOverview ?? DEFAULT_VIEW_PREFERENCES.showOverview),
  );
  const [workspaceIndex, setWorkspaceIndex] = useState(0);
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const workspaceFilterRef = useRef(workspaceFilter);
  workspaceFilterRef.current = workspaceFilter;
  const [workspaceReviews, setWorkspaceReviews] = useState<WorkspaceReviewsState>(
    loadReviews
      ? { kind: "loading" }
      : { kind: "unconfigured", message: "Reviews are not connected" },
  );
  // Cards as YouTrack and the Reviews load sort them, before MR approvals move any.
  const loadedWorkspaceItems = useMemo(
    () => buildWorkspaceItems(workspaceTasks, workspaceReviews, issueUrl, projectKeys),
    [workspaceTasks, workspaceReviews, issueUrl, projectKeys],
  );

  // The checked-out branch; its ticket or review keeps the workspace rail wherever the cursor is.
  const [checkedOutBranch, setCheckedOutBranch] = useState<string | null>(null);
  const activeTicketId = useMemo(
    () =>
      checkedOutBranch
        ? (loadedWorkspaceItems.find((item) => itemOwnsBranch(item, checkedOutBranch))?.id ?? null)
        : null,
    [loadedWorkspaceItems, checkedOutBranch],
  );

  const [mergeRequests, setMergeRequests] = useState<MergeRequest[]>([]);
  const ticketMergeRequests = useMemo(
    () =>
      linkTicketMergeRequests(
        mergeRequests,
        loadedWorkspaceItems.filter((item) => item.section !== "reviews").map((item) => item.id),
        checkedOutBranch ?? undefined,
      ),
    [mergeRequests, loadedWorkspaceItems, checkedOutBranch],
  );
  const workspaceItems = useMemo(
    () =>
      moveApprovedToReadyToMerge(
        loadedWorkspaceItems,
        (item) => ticketMergeRequests.get(item.id)?.approved === true,
      ),
    [loadedWorkspaceItems, ticketMergeRequests],
  );
  // The cards `/` leaves in the workspace; the cursor, Enter, and the keys acting on the
  // cursor's card all walk this list, while the rail and branch links keep the full one.
  const visibleWorkspaceItems = useMemo(
    () =>
      filterWorkspaceItems(
        workspaceItems,
        workspaceFilter,
        (item) => item.mergeRequestIid ?? ticketMergeRequests.get(item.id)?.iid,
      ),
    [workspaceItems, workspaceFilter, ticketMergeRequests],
  );
  // Tasks arrive asynchronously, so keep the selection inside whatever list is loaded now.
  const selectedWorkspaceIndex = clamp(
    workspaceIndex,
    0,
    Math.max(0, visibleWorkspaceItems.length - 1),
  );
  // For a ticket split over several branches, the branch of the MR its card shows wins.
  const preferredTicketBranches = useMemo(
    () => new Map([...ticketMergeRequests].map(([ticketId, mr]) => [ticketId, mr.sourceBranch])),
    [ticketMergeRequests],
  );

  const [ticketStats, setTicketStats] = useState<ReadonlyMap<string, LineStats>>(() => new Map());

  // Reload line totals whenever tickets load or the checked-out branch changes.
  useEffect(() => {
    if (workspaceTasks.kind !== "ready" || !repoRoot) {
      return;
    }
    let cancelled = false;
    const ticketIds = workspaceItems
      .filter((item) => item.section !== "reviews")
      .map((item) => item.id);
    void loadTicketLineStats(createTicketGit(repoRoot), ticketIds, preferredTicketBranches).then(
      (stats) => {
        if (!cancelled) {
          setTicketStats(stats);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    workspaceTasks,
    workspaceItems,
    checkedOutBranch,
    preferredTicketBranches,
    repoRoot,
    createTicketGit,
  ]);

  // Refetch merge requests with every tickets (re)load, so `r` also picks up a freshly opened MR.
  useEffect(() => {
    if (workspaceTasks.kind !== "ready" || !repoRoot || !loadMergeRequests) {
      return;
    }
    let cancelled = false;
    void loadMergeRequests(repoRoot).then((loaded) => {
      if (!cancelled) {
        setMergeRequests(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceTasks, repoRoot, loadMergeRequests]);

  // Reload Reviews alongside tasks, so `r` refreshes both; they do not need YouTrack to work.
  useEffect(() => {
    if (workspaceTasks.kind === "loading" || !repoRoot || !loadReviews) {
      return;
    }
    let cancelled = false;
    // Like tasks, loaded reviews stay on screen until the new ones land.
    setWorkspaceReviews((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    void loadReviews(repoRoot)
      .catch((): WorkspaceReviewsResult => ({ kind: "error", message: "Could not load reviews" }))
      .then((result) => {
        if (!cancelled) {
          setWorkspaceReviews(result);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceTasks, repoRoot, loadReviews]);

  // Whenever tickets or reviews (re)load, find the checked-out branch's item and start the
  // cursor there.
  useEffect(() => {
    if (workspaceItems.length === 0 || !repoRoot) {
      return;
    }
    let cancelled = false;
    void createTicketGit(repoRoot)(["branch", "--show-current"]).then(({ stdout: branch }) => {
      const index = branch ? workspaceItems.findIndex((item) => itemOwnsBranch(item, branch)) : -1;
      if (cancelled) {
        return;
      }
      setCheckedOutBranch(branch || null);
      // The index is into the full list, so it only applies while no filter narrows it.
      if (index >= 0 && !workspaceFilterRef.current) {
        setWorkspaceIndex(index);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceItems, repoRoot, createTicketGit]);
  const [forceSidebarOpen, setForceSidebarOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  // When non-null, hunk navigation (J/K) and the `d` delete key target the
  // drifted-comments banner pinned at the top of the diff instead of a real
  // hunk. Pressing K from the first hunk enters drift focus; J past the last
  // drifted entry exits back into the review stream.
  const [selectedDriftIndex, setSelectedDriftIndex] = useState<number | null>(null);
  const [commentEditorTarget, setCommentEditorTarget] = useState<{
    repoRoot: string;
    filePath: string;
    fileId: string;
    line: number;
    range: [number, number];
    anchor: string;
    /**
     * Transient identity hash of the hunk the user pressed `a` on. At save
     * time we re-hash whatever hunk currently owns the resolved line; if
     * the fingerprint changed, the diff churned out from under us and the
     * write is rejected rather than silently anchoring the comment against
     * a different hunk that happens to share line numbers.
     */
    hunkFingerprint: string;
  } | null>(null);
  // Hoist the draft body so a reload/remount of the comment editor cannot
  // silently drop in-flight typing. Reset to "" only on open and on cancel/
  // submit; everything else is a pass-through.
  const [commentDraftBody, setCommentDraftBody] = useState("");
  const [confirmPrompt, setConfirmPrompt] = useState<{
    message: string;
    title?: string;
    onConfirm: () => void;
  } | null>(null);
  const ticketSwitchBusyRef = useRef(false);
  const [focusArea, setFocusArea] = useState<FocusArea>("files");
  const [sidebarWidth, setSidebarWidth] = useState(WORKSPACE_WIDTH);
  const [resizeDragOriginX, setResizeDragOriginX] = useState<number | null>(null);
  const [resizeStartWidth, setResizeStartWidth] = useState<number | null>(null);
  const [transientStatus, setTransientStatus] = useState<string | null>(null);
  const transientStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionAutoCopy = bootstrap.initialSelectionAutoCopy ?? true;

  const activeTheme = resolveTheme(themeId, renderer.themeMode);
  const review = useReviewController({ files: bootstrap.changeset.files });
  const filteredFiles = review.visibleFiles;
  const selectedFile = review.selectedFile;
  const selectedHunkIndex = review.selectedHunkIndex;
  const moveToAnnotatedHunk = review.moveToAnnotatedHunk;
  const driftedCount = bootstrap.driftedComments?.length ?? 0;

  /**
   * Wrap hunk navigation so drifted comments are addressable just like real
   * hunks. K from the first hunk drops focus into the drifted banner; J past
   * the last drifted entry hands focus back to the first real hunk.
   */
  const moveToHunkWithDrift = useCallback(
    (delta: number) => {
      if (selectedDriftIndex !== null) {
        const next = selectedDriftIndex + delta;
        if (next < 0) {
          setSelectedDriftIndex(0);
          return;
        }
        if (next >= driftedCount) {
          setSelectedDriftIndex(null);
          review.moveToHunk(0);
          return;
        }
        setSelectedDriftIndex(next);
        return;
      }

      // K (delta = -1) from the very first hunk drops into the drifted list.
      if (delta < 0 && driftedCount > 0 && review.selectedHunkIndex === 0) {
        const firstFile = review.visibleFiles[0];
        if (firstFile && review.selectedFile?.id === firstFile.id) {
          setSelectedDriftIndex(driftedCount - 1);
          return;
        }
      }

      review.moveToHunk(delta);
    },
    [driftedCount, review, selectedDriftIndex],
  );

  const jumpToFile = useCallback(
    (fileId: string, nextHunkIndex = 0, options?: { alignFileHeaderTop?: boolean }) => {
      review.selectFile(fileId, nextHunkIndex, {
        alignFileHeaderTop: options?.alignFileHeaderTop,
      });
    },
    [review.selectFile],
  );

  // The coding agent can point the review at a file and line through `.flow/focus.json`.
  useFocusRequests(
    pagerMode ? null : repoRoot,
    (request) => {
      const where = request.line === undefined ? request.file : `${request.file}:${request.line}`;
      const target = resolveFocusTarget(bootstrap.changeset.files, request);
      if (!target) {
        flashStatus(`Agent pointed at ${where}, which is not in this review`, 4_000);
        return;
      }
      jumpToFile(target.fileId, target.hunkIndex);
      flashStatus(`Agent: look at ${where}`, 4_000);
    },
    readAgentFocusRequest,
  );

  const bodyPadding = pagerMode ? 0 : BODY_PADDING;
  const bodyWidth = Math.max(0, terminal.width - bodyPadding);
  const workspaceWidth = pagerMode ? 0 : resolveWorkspaceWidth(terminal.width, workspaceVisible);
  const workspaceExpanded = workspaceWidth > 0;
  const workspaceGap = workspaceExpanded ? PANE_GAP : 0;
  // The Overview is the widest pane, but never at the cost of leaving the diff unreadable.
  const overviewCandidateWidth = clamp(Math.round(bodyWidth * 0.32), 52, 80);
  const overviewWidth =
    !pagerMode &&
    overviewVisible &&
    bodyWidth - workspaceWidth - workspaceGap - overviewCandidateWidth - PANE_GAP >= DIFF_MIN_WIDTH
      ? overviewCandidateWidth
      : 0;
  const overviewGap = overviewWidth > 0 ? PANE_GAP : 0;
  const centerWidth = Math.max(
    0,
    bodyWidth - workspaceWidth - workspaceGap - overviewWidth - overviewGap,
  );
  const responsiveLayout = resolveResponsiveLayout(layoutMode, terminal.width);
  const canForceShowSidebar = centerWidth >= SIDEBAR_MIN_WIDTH + DIFF_MIN_WIDTH;
  const renderSidebar =
    sidebarVisible && (responsiveLayout.showSidebar || (forceSidebarOpen && canForceShowSidebar));
  const resolvedLayout = responsiveLayout.layout;
  const availableCenterWidth = centerWidth;
  const sidebarGap = renderSidebar ? PANE_GAP : 0;
  const maxSidebarWidth = renderSidebar
    ? Math.max(SIDEBAR_MIN_WIDTH, availableCenterWidth - DIFF_MIN_WIDTH - sidebarGap)
    : SIDEBAR_MIN_WIDTH;
  const clampedSidebarWidth = renderSidebar
    ? clamp(sidebarWidth, SIDEBAR_MIN_WIDTH, maxSidebarWidth)
    : 0;
  const diffPaneWidth = renderSidebar
    ? Math.max(DIFF_MIN_WIDTH, availableCenterWidth - clampedSidebarWidth - sidebarGap)
    : Math.max(0, availableCenterWidth);
  const diffContentWidth = Math.max(12, diffPaneWidth - 2);
  const maxVisibleLineNumber = useMemo(
    () =>
      filteredFiles.reduce(
        (maxLineNumber, file) => Math.max(maxLineNumber, findMaxLineNumber(file)),
        1,
      ),
    [filteredFiles],
  );
  const maxLineNumberDigits = resolveLineNumberDigits(maxVisibleLineNumber);
  const codeViewportWidth = useMemo(
    () => resolveCodeViewportWidth(resolvedLayout, diffContentWidth, maxLineNumberDigits),
    [diffContentWidth, maxLineNumberDigits, resolvedLayout],
  );
  const isResizingSidebar = resizeDragOriginX !== null && resizeStartWidth !== null;
  // The file tree is the rightmost pane, so its resize edge is the gap before it. The hit area
  // spans that gap plus one column on each side, keeping clear of the tree's file icons.
  const dividerHitLeft = Math.max(1, 1 + bodyWidth - clampedSidebarWidth - PANE_GAP - 1);

  useEffect(() => {
    if (!workspaceExpanded && (focusArea === "workspace" || focusArea === "workspaceFilter")) {
      setFocusArea("files");
    }
  }, [workspaceExpanded, focusArea]);

  useEffect(() => {
    if (!renderSidebar && focusArea === "tree") setFocusArea("files");
  }, [renderSidebar, focusArea]);

  useEffect(() => {
    if (!renderSidebar) {
      setResizeDragOriginX(null);
      setResizeStartWidth(null);
      return;
    }

    setSidebarWidth((current) => clamp(current, SIDEBAR_MIN_WIDTH, maxSidebarWidth));
  }, [maxSidebarWidth, renderSidebar]);

  /** Show a transient status-line message that auto-clears after a short delay. */
  const flashStatus = useCallback((text: string, durationMs = 2000) => {
    if (transientStatusTimeoutRef.current) {
      clearTimeout(transientStatusTimeoutRef.current);
    }

    setTransientStatus(text);
    transientStatusTimeoutRef.current = setTimeout(() => {
      setTransientStatus(null);
      transientStatusTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (transientStatusTimeoutRef.current) {
        clearTimeout(transientStatusTimeoutRef.current);
      }
    };
  }, []);

  // After every load, my tickets still in Review whose MR is merged move on by themselves. Each is
  // tried once per session, so a failure is reported once instead of retried on every reload.
  const closeAttemptedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!closeMergedTicket) {
      return;
    }
    const ticketIds = mergedTicketIds(
      loadedWorkspaceItems,
      (item) => ticketMergeRequests.get(item.id)?.state,
    ).filter((ticketId) => !closeAttemptedRef.current.has(ticketId));
    if (ticketIds.length === 0) {
      return;
    }
    for (const ticketId of ticketIds) {
      closeAttemptedRef.current.add(ticketId);
    }
    void Promise.all(
      ticketIds.map(async (ticketId) => ({ ticketId, result: await closeMergedTicket(ticketId) })),
    ).then((outcomes) => {
      const moved = outcomes.flatMap(({ ticketId, result }) =>
        result.kind === "moved" ? [`${ticketId} → ${result.state}`] : [],
      );
      const failed = outcomes.flatMap(({ ticketId, result }) =>
        result.kind === "error" ? [`${ticketId}: ${result.message}`] : [],
      );
      if (moved.length > 0) {
        flashStatus(`MR merged: ${moved.join(", ")}`, 6_000);
        // Resolved tickets drop out of the assigned list, so reload it.
        onRefreshWorkspaceTasks();
      } else if (failed.length > 0) {
        flashStatus(`Could not move ${failed.join(", ")}`, 6_000);
      }
    });
  }, [
    closeMergedTicket,
    loadedWorkspaceItems,
    ticketMergeRequests,
    flashStatus,
    onRefreshWorkspaceTasks,
  ]);

  useEffect(() => {
    if (!selectionAutoCopy) {
      return;
    }

    const handleSelection = (selection: { getSelectedText?: () => string } | null) => {
      // Skip the copy when a modal or filter input owns the keyboard — the user
      // is typing into a prompt, not selecting code to share.
      if (
        commentEditorTarget ||
        confirmPrompt ||
        focusArea === "filter" ||
        focusArea === "workspaceFilter"
      ) {
        return;
      }

      const text = selection?.getSelectedText?.().trim();
      if (!text) {
        return;
      }

      void copyToClipboard(text).then((copied) => {
        // Surface both success and failure so the user can tell whether the
        // OS helper (pbcopy / wl-copy / xclip) actually accepted the
        // selection.
        flashStatus(copied ? "copied to clipboard" : "clipboard copy failed");
      });
    };

    const unknownRenderer = renderer as unknown as {
      on?: (event: string, handler: (selection: unknown) => void) => void;
      off?: (event: string, handler: (selection: unknown) => void) => void;
    };
    unknownRenderer.on?.("selection", handleSelection as (selection: unknown) => void);
    return () => {
      unknownRenderer.off?.("selection", handleSelection as (selection: unknown) => void);
    };
  }, [commentEditorTarget, confirmPrompt, flashStatus, focusArea, renderer, selectionAutoCopy]);

  useEffect(() => {
    // Force an intermediate redraw when app geometry or row-wrapping changes so pane relayout
    // feels immediate after toggling split/stack or line wrapping.
    renderer.intermediateRender();
  }, [renderer, renderSidebar, resolvedLayout, terminal.height, terminal.width, wrapLines]);

  useEffect(() => {
    if (!selectedFile) {
      return;
    }

    sidebarScrollRef.current?.scrollChildIntoView(fileRowId(selectedFile.id));
  }, [selectedFile]);

  /** Scroll the main review pane by line steps, viewport fractions, or whole-content jumps. */
  const scrollDiff = (
    delta: number,
    unit: "step" | "viewport" | "content" | "half" = "viewport",
  ) => {
    if (unit === "half") {
      const scrollBox = diffScrollRef.current;
      if (!scrollBox) return;

      // Calculate half the viewport height
      const viewportHeight = scrollBox.viewport?.height ?? 20;
      const scrollAmount = Math.floor(viewportHeight / 2);

      // Use scrollTo with current position + delta * amount
      const currentScroll = scrollBox.scrollTop;
      scrollBox.scrollTo(currentScroll + delta * scrollAmount);
      return;
    }
    diffScrollRef.current?.scrollBy(delta, unit);
  };

  const maxCodeHorizontalOffset = useMemo(
    () =>
      Math.max(
        0,
        filteredFiles.reduce(
          (maxWidth, file) => Math.max(maxWidth, maxFileCodeLineWidth(file)),
          0,
        ) - codeViewportWidth,
      ),
    [codeViewportWidth, filteredFiles],
  );

  useEffect(() => {
    setCodeHorizontalOffset((current) => clamp(current, 0, maxCodeHorizontalOffset));
  }, [maxCodeHorizontalOffset]);

  /** Shift the visible code columns horizontally without moving gutters or headers. */
  const scrollCodeHorizontally = useCallback(
    (delta: number) => {
      if (wrapLines || delta === 0 || maxCodeHorizontalOffset <= 0) {
        return;
      }

      setCodeHorizontalOffset((current) => clamp(current + delta, 0, maxCodeHorizontalOffset));
    },
    [maxCodeHorizontalOffset, wrapLines],
  );

  /** Preserve the current review position before changing the active diff layout. */
  const selectLayoutMode = useCallback((mode: LayoutMode) => {
    layoutToggleScrollTopRef.current = diffScrollRef.current?.scrollTop ?? 0;
    setLayoutToggleRequestId((current) => current + 1);
    setLayoutMode(mode);
  }, []);

  /** Toggle line-number gutters without changing the diff content itself. */
  const toggleLineNumbers = () => {
    setShowLineNumbers((current) => !current);
  };

  /** Toggle whether diff code rows wrap instead of truncating to one terminal row. */
  const toggleLineWrap = () => {
    // Capture the pre-toggle viewport position synchronously so DiffPane can restore the same
    // top-most source row after wrapped row heights change.
    wrapToggleScrollTopRef.current = diffScrollRef.current?.scrollTop ?? 0;
    setCodeHorizontalOffset(0);
    setWrapLines((current) => !current);
  };

  /** Toggle the sidebar, forcing it open on narrower layouts when the app can still fit both panes. */
  const toggleSidebar = () => {
    if (sidebarVisible && (responsiveLayout.showSidebar || forceSidebarOpen)) {
      setSidebarVisible(false);
      setForceSidebarOpen(false);
      return;
    }

    if (sidebarVisible && !responsiveLayout.showSidebar) {
      if (canForceShowSidebar) {
        setForceSidebarOpen(true);
      }
      return;
    }

    setSidebarVisible(true);
    setForceSidebarOpen(!responsiveLayout.showSidebar && canForceShowSidebar);
  };

  /** Toggle visibility of hunk metadata rows without changing the actual diff lines. */
  const toggleHunkHeaders = () => {
    setShowHunkHeaders((current) => !current);
  };

  const canRefreshCurrentInput = canReloadInput(bootstrap.input);
  const watchEnabled = Boolean(bootstrap.input.options.watch && canRefreshCurrentInput);

  /** Rebuild the current diff source while preserving the active app view options. */
  const refreshCurrentInput = useCallback(async () => {
    if (!canRefreshCurrentInput) {
      return;
    }

    const nextInput = withCurrentViewOptions(bootstrap.input, {
      layoutMode,
      themeId,
      showHunkHeaders,
      showLineNumbers,
      wrapLines,
    });

    await onReloadSession(nextInput, {
      resetApp: false,
      sourcePath:
        bootstrap.input.kind === "vcs" ||
        bootstrap.input.kind === "show" ||
        bootstrap.input.kind === "stash-show"
          ? bootstrap.changeset.sourceLabel
          : undefined,
    });
  }, [
    bootstrap.changeset.sourceLabel,
    bootstrap.input,
    canRefreshCurrentInput,
    layoutMode,
    onReloadSession,
    showHunkHeaders,
    showLineNumbers,
    themeId,
    wrapLines,
  ]);

  const triggerRefreshCurrentInput = useCallback(() => {
    void refreshCurrentInput().catch((error) => {
      console.error("Failed to reload the current diff.", error);
    });
  }, [refreshCurrentInput]);

  /** `B`: switch a `flow diff` review between the whole branch and uncommitted changes only. */
  const toggleBranchReview = async () => {
    const input = bootstrap.input;
    if (!canToggleBranchReview(input)) {
      flashStatus("B switches branch review only in `flow diff`", 3_000);
      return;
    }
    const toBranch = input.branchReview === undefined;
    const nextInput: VcsCommandInput = toBranch
      ? { ...input, range: undefined, branchReview: {} }
      : { ...input, range: WORKTREE_BASE_REF, branchReview: undefined };
    try {
      await onReloadSession(
        withCurrentViewOptions(nextInput, {
          layoutMode,
          themeId,
          showHunkHeaders,
          showLineNumbers,
          wrapLines,
        }),
        { resetApp: false, sourcePath: bootstrap.changeset.sourceLabel },
      );
      flashStatus(toBranch ? "Reviewing the whole branch" : "Reviewing uncommitted changes", 3_000);
    } catch (error) {
      flashStatus(error instanceof Error ? error.message : "Could not switch the review", 5_000);
    }
  };

  /** Resolve the active hunk's repo-root, file path, post-image range, and identity fingerprint. */
  const focusedHunkTarget = useCallback(() => {
    const selected = review.selectedFile;
    const hunk = review.selectedHunk;
    if (!selected || !hunk || !repoRoot) {
      return null;
    }

    const range = hunkLineRange(hunk).newRange;
    return {
      repoRoot,
      filePath: selected.path,
      fileId: selected.id,
      range,
      hunkFingerprint: hunkFingerprint(selected.metadata, hunk),
    };
  }, [repoRoot, review.selectedFile, review.selectedHunk]);

  /** Apply one mutation to the comments anchored on the focused hunk. */
  const mutateFocusedHunkComments = useCallback(
    (reduce: (file: CommentsFile, matching: PersistedComment[]) => CommentsFile | null) => {
      const target = focusedHunkTarget();
      if (!target) {
        return;
      }

      try {
        mutateCommentsFile(target.repoRoot, (current) => {
          const matching = commentsForHunkRange(current.comments, target.filePath, target.range);
          const next = matching.length === 0 ? current : reduce(current, matching);
          return next ?? current;
        });
      } catch (error) {
        console.error("Failed to mutate flow comments.", error);
        return;
      }

      triggerRefreshCurrentInput();
    },
    [focusedHunkTarget, triggerRefreshCurrentInput],
  );

  const driftedComments = bootstrap.driftedComments ?? [];

  // Keep the drift selection valid as the bootstrap changes underneath us
  // (a watch-mode reload can resolve drifted comments, shrinking the list).
  useEffect(() => {
    if (selectedDriftIndex === null) {
      return;
    }
    if (driftedComments.length === 0) {
      setSelectedDriftIndex(null);
      return;
    }
    if (selectedDriftIndex >= driftedComments.length) {
      setSelectedDriftIndex(driftedComments.length - 1);
    }
  }, [driftedComments.length, selectedDriftIndex]);

  const deleteFocusedComment = useCallback(() => {
    // Drift focus takes precedence: when J/K has cycled into the drifted
    // banner, `d` removes that specific drifted comment by id rather than
    // the oldest comment on a real hunk.
    if (selectedDriftIndex !== null && repoRoot) {
      const target = driftedComments[selectedDriftIndex];
      if (!target) {
        return;
      }
      try {
        mutateCommentsFile(repoRoot, (current) => withRemovedComment(current, target.id));
      } catch (error) {
        console.error("Failed to delete drifted comment.", error);
        return;
      }
      // Clamp the selection to the remaining drifted list so the focus stays
      // in the banner while there are still entries to address.
      const nextLength = driftedComments.length - 1;
      setSelectedDriftIndex(nextLength > 0 ? Math.min(selectedDriftIndex, nextLength - 1) : null);
      triggerRefreshCurrentInput();
      return;
    }

    mutateFocusedHunkComments((current, matching) => {
      const oldest = matching.reduce((a, b) => (a.id < b.id ? a : b));
      return withRemovedComment(current, oldest.id);
    });
  }, [
    driftedComments,
    mutateFocusedHunkComments,
    repoRoot,
    selectedDriftIndex,
    triggerRefreshCurrentInput,
  ]);

  /**
   * Delete every comment currently surfaced in the drift banner, after a
   * confirm. Anchored comments are intentional review items — they're not
   * what users want to mass-clear. The pile that actually accumulates and
   * needs sweeping is drift: comments whose anchor stopped matching the
   * diff. `D` is the one-keystroke way to clean that pile.
   */
  const deleteAllDriftedComments = useCallback(() => {
    if (!repoRoot) {
      return;
    }

    const driftedIds = (bootstrap.driftedComments ?? []).map((entry) => entry.id);
    if (driftedIds.length === 0) {
      flashStatus("no drifted comments to clear");
      return;
    }

    setConfirmPrompt({
      title: "Clear drifted comments",
      message: `Delete ${driftedIds.length} drifted comment${driftedIds.length === 1 ? "" : "s"}?`,
      onConfirm: () => {
        setConfirmPrompt(null);
        // Re-read the drift ids at confirm time so a watch reload during the
        // dialog can't leave us targeting a stale set. Anchored comments that
        // share an id with a since-resolved drift entry are untouched because
        // ids are stable per .flow/comments.json entry.
        const finalIds = new Set((bootstrap.driftedComments ?? []).map((entry) => entry.id));
        if (finalIds.size === 0) {
          return;
        }

        try {
          mutateCommentsFile(repoRoot, (current) => ({
            ...current,
            comments: current.comments.filter((comment) => !finalIds.has(comment.id)),
          }));
        } catch (error) {
          console.error("Failed to delete drifted comments.", error);
          return;
        }

        setSelectedDriftIndex(null);
        triggerRefreshCurrentInput();
      },
    });
  }, [bootstrap.driftedComments, flashStatus, repoRoot, triggerRefreshCurrentInput]);

  /** Open the comment-authoring modal for the bottom line of the focused hunk. */
  const openCommentEditor = useCallback(() => {
    const target = focusedHunkTarget();
    if (!target) {
      return;
    }

    const line = target.range[1];
    const anchor = computeAnchorForFile(target.repoRoot, target.filePath, line);
    if (!anchor) {
      // The post-image was unreadable or the line is out of range — skip rather than fail loudly.
      return;
    }

    setCommentDraftBody("");
    setCommentEditorTarget({
      repoRoot: target.repoRoot,
      filePath: target.filePath,
      fileId: target.fileId,
      line,
      range: target.range,
      anchor,
      hunkFingerprint: target.hunkFingerprint,
    });
  }, [focusedHunkTarget]);

  const closeCommentEditor = useCallback(() => {
    setCommentEditorTarget(null);
    setCommentDraftBody("");
  }, []);

  /** Open the focused hunk in the user's editor at the bottom of its post-image range. */
  const openInEditor = useCallback(() => {
    const target = focusedHunkTarget();
    if (!target) {
      return;
    }

    const line = target.range[1];
    const plan = resolveEditorLaunch(target.filePath, line);
    if (!plan) {
      flashStatus("set $EDITOR or $VISUAL to use e");
      return;
    }

    void runEditorLaunch(plan, { cwd: target.repoRoot })
      .then(() => {
        // Detached GUI editors return immediately — chaining a reload then would
        // race the user's typing. Watch mode's poll picks those changes up instead.
        if (plan.needsTty) {
          triggerRefreshCurrentInput();
        }
      })
      .catch((error) => {
        // Common macOS failure: $EDITOR=zed/cursor/code but the CLI helper is
        // not on PATH (the GUI app installs without a shell shim). Surface a
        // user-facing hint instead of dropping the error into the void.
        const message = error instanceof Error ? error.message : String(error);
        const programName = plan.command[0] ?? "editor";
        flashStatus(`could not launch ${programName}: ${message}`, 4000);
      });
  }, [flashStatus, focusedHunkTarget, triggerRefreshCurrentInput]);

  /**
   * Persist the entered body, validating that the hunk the user pressed `a`
   * on still owns the resolved line. The diff stream can churn between
   * modal-open and submit (watch mode, agent file edits, manual reloads);
   * without this guard, the comment can silently anchor against a different
   * hunk that happens to occupy the same line numbers in the new diff.
   *
   * Three outcomes:
   * - Owning hunk fingerprint matches → write using the *current* hunk's
   *   range so the persisted entry stays aligned with the live diff.
   * - Fingerprint mismatches (or no current hunk owns the line) → reject
   *   with a transient status; the modal closes but the draft is kept so
   *   the user can re-author intentionally.
   * - mutateCommentsFile throws → log and clear state.
   */
  const saveComment = useCallback(
    (body: string) => {
      if (!commentEditorTarget) {
        return;
      }

      const {
        repoRoot,
        filePath,
        fileId,
        line,
        anchor,
        hunkFingerprint: openFingerprint,
      } = commentEditorTarget;

      // Re-derive the current owning hunk from the live changeset. `file.id`
      // embeds the file's array index so a sidebar reorder could invalidate
      // it; fall back to the path (and the rename's previousPath) before
      // declaring the file gone.
      const currentFile =
        bootstrap.changeset.files.find((file) => file.id === fileId) ??
        bootstrap.changeset.files.find(
          (file) => file.path === filePath || file.previousPath === filePath,
        );
      if (!currentFile) {
        // Validation rejection preserves the draft body so the user doesn't
        // lose what they typed; only successful saves and explicit cancels
        // clear it.
        flashStatus("Diff changed — the file is gone. Re-open to retry; draft preserved.", 4000);
        setCommentEditorTarget(null);
        return;
      }

      const owningHunk = currentFile.metadata.hunks.find((hunk) => {
        const { newRange } = hunkLineRange(hunk);
        return line >= newRange[0] && line <= newRange[1];
      });
      if (!owningHunk) {
        flashStatus(
          "Diff changed — no hunk owns this line now. Re-open to retry; draft preserved.",
          4000,
        );
        setCommentEditorTarget(null);
        return;
      }

      const currentFingerprint = hunkFingerprint(currentFile.metadata, owningHunk);
      if (currentFingerprint !== openFingerprint) {
        flashStatus("Diff changed under the modal. Re-open to retry; draft preserved.", 4000);
        setCommentEditorTarget(null);
        return;
      }

      const currentRange = hunkLineRange(owningHunk).newRange;
      let savedCommentId: number | null = null;
      try {
        mutateCommentsFile(repoRoot, (current) => {
          const result = withAddedComment(current, {
            file: filePath,
            line,
            range: currentRange,
            anchor,
            body,
            author: "user",
          });
          savedCommentId = result.comment.id;
          return result.file;
        });
      } catch (error) {
        console.error("Failed to save comment.", error);
        setCommentEditorTarget(null);
        setCommentDraftBody("");
        return;
      }

      if (savedCommentId !== null) {
        pendingPostSaveRevealRef.current = savedCommentId;
      }
      setCommentEditorTarget(null);
      setCommentDraftBody("");
      triggerRefreshCurrentInput();
    },
    [bootstrap.changeset.files, commentEditorTarget, flashStatus, triggerRefreshCurrentInput],
  );

  // Hold the current refresher in a ref so view-only state changes (theme,
  // layout, wrap, …) don't tear down and re-arm the watch poll. A
  // restart resets `lastSignature`, which would silently swallow any source
  // change that landed during the toggle.
  const refreshCurrentInputRef = useRef(refreshCurrentInput);
  useEffect(() => {
    refreshCurrentInputRef.current = refreshCurrentInput;
  }, [refreshCurrentInput]);

  // Mirror "is the comment modal open" into a ref so the watch poll can read
  // it without re-arming. While set, reload-fires are coalesced into a single
  // pending flush that runs when the modal closes.
  const commentAuthoringRef = useRef(false);
  const pendingPostAuthoringReloadRef = useRef(false);
  // Records the id of a just-saved comment so the next bootstrap can flash a
  // "Comment added" confirmation. Cleared once the next reload's
  // annotations/drift list have been inspected, win or lose.
  const pendingPostSaveRevealRef = useRef<number | null>(null);
  useEffect(() => {
    const wasAuthoring = commentAuthoringRef.current;
    const isAuthoring = commentEditorTarget !== null;
    commentAuthoringRef.current = isAuthoring;
    if (wasAuthoring && !isAuthoring && pendingPostAuthoringReloadRef.current) {
      pendingPostAuthoringReloadRef.current = false;
      void refreshCurrentInputRef.current().catch((error) => {
        console.error("Failed to flush post-authoring reload.", error);
      });
    }
  }, [commentEditorTarget]);

  // After a successful `saveComment`, the next bootstrap carries either the
  // anchored annotation (success path) or a drift entry (partial-success
  // path). Confirm the outcome in the status bar without moving the view:
  // the comment lands on the hunk the user is already looking at, so
  // re-selecting it would only scroll to fit the taller hunk.
  useEffect(() => {
    const pendingId = pendingPostSaveRevealRef.current;
    if (pendingId === null) {
      return;
    }

    const annotationId = `flow-comment:${pendingId}`;
    let targetRange: [number, number] | null = null;
    let targetPath = "";
    outer: for (let fileIndex = 0; fileIndex < bootstrap.changeset.files.length; fileIndex += 1) {
      const file = bootstrap.changeset.files[fileIndex]!;
      for (const annotation of file.annotations) {
        if (annotation.id !== annotationId) {
          continue;
        }
        const line = annotation.newRange?.[0] ?? 0;
        for (let hunkIndex = 0; hunkIndex < file.metadata.hunks.length; hunkIndex += 1) {
          const [start, end] = hunkLineRange(file.metadata.hunks[hunkIndex]!).newRange;
          if (line >= start && line <= end) {
            targetRange = [start, end];
            targetPath = file.path;
            break outer;
          }
        }
      }
    }

    if (targetRange) {
      flashStatus(`Comment added — ${targetPath}:${targetRange[0]}-${targetRange[1]}`);
      pendingPostSaveRevealRef.current = null;
      return;
    }

    const driftEntry = bootstrap.driftedComments?.find((entry) => entry.id === pendingId);
    if (driftEntry) {
      flashStatus(
        `Comment added but drifted (${driftEntry.reason}) — see the banner at the top.`,
        5000,
      );
      pendingPostSaveRevealRef.current = null;
    }
    // Otherwise leave the ref armed; the next reload may carry the comment.
  }, [bootstrap.changeset.files, bootstrap.driftedComments, flashStatus]);

  useEffect(() => {
    if (!watchEnabled) {
      return;
    }

    let cancelled = false;
    let polling = false;
    let refreshing = false;
    let lastSignature: string;
    try {
      // The baseline is taken in-thread, once, so a change made while the worker starts up is
      // still seen as a change rather than folded into the baseline.
      lastSignature = computeWatchSignature(bootstrap.input);
    } catch (error) {
      console.error("Failed to initialize watch mode.", error);
      return;
    }
    // Every later check runs git off the UI thread, so a slow repo delays reloads, never typing.
    const probe = createWatchSignatureProbe();

    const pollForChanges = async () => {
      if (cancelled || polling || refreshing) {
        return;
      }

      polling = true;

      try {
        const nextSignature = await probe.signature(bootstrap.input);
        if (cancelled) {
          return;
        }
        if (nextSignature !== lastSignature) {
          lastSignature = nextSignature;
          // Comment authoring is foreground work — a moment of stale
          // diff is preferable to dropping the in-flight body when the
          // agent (or anything else) edits the working tree mid-typing.
          // The signature gets updated either way so the poller doesn't
          // loop on the same change; the next save/cancel flushes one
          // refresh to bring the diff back in sync.
          if (commentAuthoringRef.current) {
            pendingPostAuthoringReloadRef.current = true;
          } else {
            refreshing = true;
            void refreshCurrentInputRef
              .current()
              .catch((error) => {
                console.error("Failed to auto-reload the current diff.", error);
              })
              .finally(() => {
                refreshing = false;
              });
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to poll watch mode input.", error);
        }
      } finally {
        polling = false;
      }
    };

    const interval = setInterval(() => void pollForChanges(), WATCH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      probe.dispose();
    };
  }, [bootstrap.input, watchEnabled]);

  /** Leave the app through the shared shutdown path. */
  const requestQuit = useCallback(() => {
    onQuit();
  }, [onQuit]);

  /** Close the modal keyboard help overlay. */
  const closeHelp = useCallback(() => {
    setShowHelp(false);
  }, []);

  /** Toggle the modal keyboard help overlay. */
  const toggleHelp = useCallback(() => {
    setShowHelp((current) => !current);
  }, []);

  /** Focus the file list/sidebar navigation area. */
  const focusFiles = useCallback(() => {
    setFocusArea("files");
  }, []);

  /** Focus the file filter input in the status bar. */
  const focusFilter = useCallback(() => {
    setFocusArea("filter");
  }, []);

  /** Toggle keyboard focus between the file list and the file filter. */
  const toggleFocusArea = useCallback(() => {
    setFocusArea((current) => (current === "files" ? "filter" : "files"));
  }, []);

  /** Cycle through the available built-in themes. */
  const cycleTheme = useCallback(() => {
    const currentIndex = THEMES.findIndex((theme) => theme.id === activeTheme.id);
    const nextIndex = (currentIndex + 1) % THEMES.length;
    setThemeId(THEMES[nextIndex]!.id);
  }, [activeTheme.id]);

  /** Focus an open but unfocused workspace; otherwise toggle it, returning focus when it closes. */
  const toggleWorkspace = () => {
    if (workspaceExpanded && focusArea !== "workspace") {
      setFocusArea("workspace");
      return;
    }
    setWorkspaceVisible(!workspaceExpanded);
    setFocusArea(!workspaceExpanded && terminal.width >= 110 ? "workspace" : "files");
  };

  /** Show every card again with the cursor still on the card it was on in the filtered list. */
  const clearWorkspaceFilterKeepingCursor = () => {
    const item = visibleWorkspaceItems[selectedWorkspaceIndex];
    setWorkspaceFilter("");
    setWorkspaceIndex(item ? workspaceItems.indexOf(item) : 0);
  };

  /**
   * Enter on a ticket or review: switch to its branch, parking uncommitted work the same way for
   * both, then reload the review so it shows that branch.
   */
  const activateWorkspaceItem = async () => {
    // While filtered, Enter only ends the search on this card; the next Enter switches to it.
    if (workspaceFilter) {
      clearWorkspaceFilterKeepingCursor();
      return;
    }
    const item = visibleWorkspaceItems[selectedWorkspaceIndex];
    focusFiles();
    if (!item || ticketSwitchBusyRef.current) {
      return;
    }
    if (!repoRoot) {
      flashStatus("Not inside a git repository");
      return;
    }
    ticketSwitchBusyRef.current = true;
    flashStatus(`Switching to ${item.id}…`, 30_000);
    try {
      const git = createTicketGit(repoRoot);
      const result = item.branch
        ? await switchToReviewBranch(git, item.branch, item.baseBranch ?? "main")
        : await switchToTicket(git, item.id, preferredTicketBranches.get(item.id));
      flashStatus(describeTicketSwitch(result), 5_000);
      if (result.kind === "switched" || result.kind === "already-on") {
        setCheckedOutBranch(result.branch);
      }
      // Enter on the review already checked out still reloads: its recorded base may have moved.
      if (result.kind === "already-on" && item.section === "reviews") {
        triggerRefreshCurrentInput();
      }
      if (result.kind === "switched") {
        triggerRefreshCurrentInput();
        // Context is for my own tickets; a review is read in flow, not handed to the agent. A
        // ticket that already has an overview keeps it: X refreshes it on demand, which spares
        // the agent's tokens on every switch.
        if (item.section === "reviews" || readOverview(repoRoot, item.id)) {
          return;
        }
        try {
          requestTicketContext(repoRoot, item.id);
        } catch {
          flashStatus(`On ${result.branch} · could not ask the agent for context`, 5_000);
        }
      }
    } finally {
      ticketSwitchBusyRef.current = false;
    }
  };

  // The checked-out branch's ticket or review (the one with the rail). The Overview shows only
  // this one, so moving the cursor through the workspace never replaces the ticket at hand.
  const checkedOutItem = workspaceItems.find((item) => item.id === activeTicketId);
  // `h`, `g`, and `R` act on the card under the cursor while the workspace owns the keyboard, and
  // on the checked-out one from anywhere else.
  const linkTargetItem =
    focusArea === "workspace" ? visibleWorkspaceItems[selectedWorkspaceIndex] : checkedOutItem;

  const overviewTicketId = overviewWidth > 0 ? (checkedOutItem?.ticketId ?? null) : null;
  const ticketOverview = useTicketOverview(repoRoot ?? null, overviewTicketId, readOverview);
  const [commitsSinceOverview, setCommitsSinceOverview] = useState<number | undefined>();
  // How far the checked-out branch moved since its overview was written.
  useEffect(() => {
    setCommitsSinceOverview(undefined);
    const commit = ticketOverview?.commit;
    if (!repoRoot || !commit) {
      return;
    }
    let cancelled = false;
    void createTicketGit(repoRoot)(["rev-list", "--count", `${commit}..HEAD`]).then((result) => {
      if (!cancelled && result.ok) {
        setCommitsSinceOverview(Number(result.stdout));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ticketOverview, repoRoot, createTicketGit]);

  useAppKeyboardShortcuts({
    focusTree: () => {
      if (renderSidebar) setFocusArea("tree");
      else {
        setSidebarVisible(true);
        setForceSidebarOpen(true);
        if (canForceShowSidebar) setFocusArea("tree");
      }
    },
    toggleWorkspace,
    leaveWorkspace: focusFiles,
    moveWorkspace: (delta) =>
      setWorkspaceIndex(clamp(selectedWorkspaceIndex + delta, 0, visibleWorkspaceItems.length - 1)),
    focusWorkspaceFilter: () => setFocusArea("workspaceFilter"),
    clearWorkspaceFilter: () => {
      if (!workspaceFilter) {
        return false;
      }
      clearWorkspaceFilterKeepingCursor();
      return true;
    },
    refreshWorkspace: onRefreshWorkspaceTasks,
    activateWorkspaceItem: () => void activateWorkspaceItem(),
    openWorkspaceItem: () => {
      const url = linkTargetItem?.url;
      if (url) onOpenUrl(url);
    },
    toggleOverview: () => setOverviewVisible((visible) => !visible),
    toggleBranchReview: () => void toggleBranchReview(),
    // X fills the Overview, so it asks for the ticket the pane shows.
    requestOverview: () => {
      const ticketId = checkedOutItem?.ticketId;
      if (!repoRoot || !ticketId) {
        return;
      }
      try {
        requestTicketContext(repoRoot, ticketId);
        flashStatus(`Asked the agent for ${ticketId}'s context`, 4_000);
      } catch {
        flashStatus("Could not ask the agent for context", 4_000);
      }
    },
    // C and P always act on the checked-out branch: that is where the commits and the MR live.
    requestCommit: () => {
      if (!repoRoot) {
        return;
      }
      try {
        requestCommit(repoRoot, checkedOutItem?.ticketId);
        flashStatus("Asked the agent to propose commits", 4_000);
      } catch {
        flashStatus("Could not ask the agent to commit", 4_000);
      }
    },
    requestMergeRequestOpen: () => {
      if (!repoRoot) {
        return;
      }
      const ticketId = checkedOutItem?.ticketId;
      try {
        requestMergeRequestOpen(repoRoot, ticketId);
        flashStatus(`Asked the agent to open the MR${ticketId ? ` for ${ticketId}` : ""}`, 4_000);
      } catch {
        flashStatus("Could not ask the agent to open the MR", 4_000);
      }
    },
    requestReview: () => {
      const ticketId = linkTargetItem?.ticketId;
      if (!repoRoot || !linkTargetItem) {
        return;
      }
      // The ticket is what the code is judged against, so a review without one has nothing to measure.
      if (!ticketId) {
        flashStatus("This review names no ticket to review it against", 4_000);
        return;
      }
      const mergeRequestIid =
        linkTargetItem.mergeRequestIid ?? ticketMergeRequests.get(linkTargetItem.id)?.iid;
      try {
        requestReview(repoRoot, ticketId, mergeRequestIid);
        flashStatus(
          `Asked the agent to review ${mergeRequestIid ? `!${mergeRequestIid}` : ticketId} against ${ticketId}`,
          4_000,
        );
      } catch {
        flashStatus("Could not ask the agent for a review", 4_000);
      }
    },
    openWorkspaceMergeRequest: () => {
      const item = linkTargetItem;
      const url = item?.mergeRequestUrl ?? (item && ticketMergeRequests.get(item.id)?.url);
      if (url) {
        onOpenUrl(url);
        return;
      }
      // MRs load with the tickets, so one opened since then is unknown: ask GitLab again.
      if (!item || item.section === "reviews" || !repoRoot || !loadMergeRequests) {
        return;
      }
      flashStatus(`Looking for ${item.id}'s MR…`, 4_000);
      void loadMergeRequests(repoRoot).then((loaded) => {
        setMergeRequests(loaded);
        const found = linkTicketMergeRequests(loaded, [item.id], checkedOutBranch ?? undefined).get(
          item.id,
        );
        if (found) {
          onOpenUrl(found.url);
        } else {
          flashStatus(`No MR for ${item.id} yet`, 4_000);
        }
      });
    },
    canRefreshCurrentInput,
    closeHelp,
    commentEditorActive: Boolean(commentEditorTarget),
    confirmActive: Boolean(confirmPrompt),
    cycleTheme,
    deleteAllDriftedComments,
    deleteFocusedComment,
    focusArea,
    focusFilter,
    moveToAnnotatedHunk,
    moveToFile: review.moveToFile,
    moveToHunk: moveToHunkWithDrift,
    openCommentEditor,
    openInEditor,
    pagerMode,
    requestQuit,
    scrollCodeHorizontally,
    scrollDiff,
    selectFirstHunk: review.selectFirstHunk,
    selectLastHunk: review.selectLastHunk,
    selectLayoutMode,
    showHelp,
    toggleFocusArea,
    toggleHelp,
    toggleHunkHeaders,
    toggleLineNumbers,
    toggleLineWrap,
    toggleSidebar,
    triggerRefreshCurrentInput,
  });

  /** Start a mouse drag resize for the optional sidebar. */
  const beginSidebarResize = (event: TuiMouseEvent) => {
    if (event.button !== MouseButton.LEFT) {
      return;
    }

    setResizeDragOriginX(event.x);
    setResizeStartWidth(clampedSidebarWidth);
    event.preventDefault();
    event.stopPropagation();
  };

  /** Update the sidebar width while a drag resize is active. */
  const updateSidebarResize = (event: TuiMouseEvent) => {
    if (!isResizingSidebar || resizeDragOriginX === null || resizeStartWidth === null) {
      return;
    }

    // The tree grows leftward from the right edge, so dragging left widens it.
    setSidebarWidth(
      resizeSidebarWidth(
        resizeStartWidth,
        event.x,
        resizeDragOriginX,
        SIDEBAR_MIN_WIDTH,
        maxSidebarWidth,
      ),
    );
    event.preventDefault();
    event.stopPropagation();
  };

  /** End the current sidebar resize interaction. */
  const endSidebarResize = (event?: TuiMouseEvent) => {
    if (!isResizingSidebar) {
      return;
    }

    setResizeDragOriginX(null);
    setResizeStartWidth(null);
    event?.preventDefault();
    event?.stopPropagation();
  };

  const diffHeaderStatsWidth = Math.min(24, Math.max(16, Math.floor(diffContentWidth / 3)));
  const diffHeaderLabelWidth = Math.max(8, diffContentWidth - diffHeaderStatsWidth - 1);

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: activeTheme.background,
      }}
    >
      {!pagerMode && bootstrap.driftedComments && bootstrap.driftedComments.length > 0 ? (
        <DriftedCommentsBanner
          drifted={bootstrap.driftedComments}
          selectedIndex={selectedDriftIndex}
          terminalWidth={terminal.width}
          theme={activeTheme}
          onSelect={setSelectedDriftIndex}
        />
      ) : null}

      <box
        style={{
          flexGrow: 1,
          flexDirection: "row",
          gap: 0,
          paddingLeft: bodyPadding / 2,
          paddingRight: bodyPadding / 2,
          paddingTop: 0,
          paddingBottom: 0,
          position: "relative",
        }}
        onMouseDrag={updateSidebarResize}
        onMouseDragEnd={endSidebarResize}
        onMouseUp={(event) => {
          endSidebarResize(event);
        }}
      >
        {workspaceWidth > 0 ? (
          <WorkspaceSidebar
            items={visibleWorkspaceItems}
            filter={workspaceFilter}
            tasks={workspaceTasks}
            reviews={workspaceReviews}
            activeItemId={activeTicketId}
            ticketStats={ticketStats}
            ticketMergeRequests={ticketMergeRequests}
            width={workspaceWidth}
            expanded={workspaceExpanded}
            focused={focusArea === "workspace" || focusArea === "workspaceFilter"}
            selectedIndex={selectedWorkspaceIndex}
            theme={activeTheme}
            onSelect={(index) => {
              setWorkspaceIndex(index);
              setFocusArea("workspace");
            }}
          />
        ) : null}
        {workspaceGap > 0 ? (
          <box width={workspaceGap} flexShrink={0} backgroundColor={activeTheme.background} />
        ) : null}
        {overviewWidth > 0 ? (
          <>
            <TicketOverviewPane
              item={checkedOutItem}
              overview={ticketOverview}
              mergeRequest={
                overviewTicketId ? ticketMergeRequests.get(overviewTicketId) : undefined
              }
              stats={overviewTicketId ? ticketStats.get(overviewTicketId) : undefined}
              commitsSinceWritten={commitsSinceOverview}
              width={overviewWidth}
              theme={activeTheme}
            />
            <box width={overviewGap} flexShrink={0} backgroundColor={activeTheme.background} />
          </>
        ) : null}
        <DiffPane
          codeHorizontalOffset={codeHorizontalOffset}
          diffContentWidth={diffContentWidth}
          files={filteredFiles}
          pagerMode={pagerMode}
          headerLabelWidth={diffHeaderLabelWidth}
          headerStatsWidth={diffHeaderStatsWidth}
          layout={resolvedLayout}
          scrollRef={diffScrollRef}
          selectedFileId={selectedFile?.id}
          selectedHunkIndex={selectedHunkIndex}
          // Mute the active-hunk emphasis when drift focus owns navigation so
          // the user only sees one selection at a time. The underlying index
          // stays accurate so the reveal effect does not re-fire (and visibly
          // snap) when drift focus releases back to the hunk.
          muteHunkSelectionHighlight={selectedDriftIndex !== null}
          scrollToNote={review.scrollToNote}
          showLineNumbers={showLineNumbers}
          showHunkHeaders={showHunkHeaders}
          wrapLines={wrapLines}
          wrapToggleScrollTop={wrapToggleScrollTopRef.current}
          layoutToggleScrollTop={layoutToggleScrollTopRef.current}
          layoutToggleRequestId={layoutToggleRequestId}
          selectedFileTopAlignRequestId={review.selectedFileTopAlignRequestId}
          selectedHunkRevealRequestId={review.selectedHunkRevealRequestId}
          theme={activeTheme}
          width={diffPaneWidth}
          onScrollCodeHorizontally={(delta) => {
            scrollCodeHorizontally(delta * FAST_CODE_HORIZONTAL_SCROLL_COLUMNS);
          }}
          onSelectFile={jumpToFile}
          onSelectHunk={(fileId, hunkIndex) =>
            review.selectHunk(fileId, hunkIndex, { preserveViewport: true })
          }
        />

        {renderSidebar ? (
          <>
            {/* The file tree sits at the far right, so its divider is its left edge. */}
            <PaneDivider
              dividerHitLeft={dividerHitLeft}
              dividerHitWidth={PANE_GAP + 2}
              onMouseDown={beginSidebarResize}
              onMouseDrag={updateSidebarResize}
              onMouseDragEnd={endSidebarResize}
              onMouseUp={endSidebarResize}
            />

            <box width={sidebarGap} flexShrink={0} backgroundColor={activeTheme.background} />

            <SidebarPane
              entries={review.sidebarEntries}
              keyboardActive={
                !pagerMode &&
                focusArea === "tree" &&
                !showHelp &&
                !commentEditorTarget &&
                !confirmPrompt
              }
              scrollRef={sidebarScrollRef}
              selectedFileId={selectedFile?.id}
              theme={activeTheme}
              width={clampedSidebarWidth}
              onSelectFile={(fileId) => {
                focusFiles();
                jumpToFile(fileId, 0, { alignFileHeaderTop: true });
              }}
            />
          </>
        ) : null}
      </box>

      {!pagerMode ? (
        <StatusBar
          filter={focusArea === "workspaceFilter" ? workspaceFilter : review.filter}
          filterFocused={focusArea === "filter" || focusArea === "workspaceFilter"}
          filterPlaceholder={
            focusArea === "workspaceFilter" ? "type to filter tickets and reviews" : undefined
          }
          noticeText={transientStatus ?? undefined}
          reviewMode={
            canToggleBranchReview(bootstrap.input)
              ? bootstrap.branchBase
                ? `Branch vs ${bootstrap.branchBase}`
                : "Uncommitted"
              : undefined
          }
          terminalWidth={terminal.width}
          theme={activeTheme}
          onFilterInput={(value) => {
            if (focusArea !== "workspaceFilter") {
              review.setFilter(value);
              return;
            }
            if (!value) {
              clearWorkspaceFilterKeepingCursor();
              return;
            }
            // Each keystroke narrows the list, so start again from its first card.
            setWorkspaceFilter(value);
            setWorkspaceIndex(0);
          }}
          onFilterSubmit={() => {
            if (focusArea !== "workspaceFilter") {
              focusFiles();
              return;
            }
            // Enter ends the search on the chosen card; the next Enter switches to it.
            clearWorkspaceFilterKeepingCursor();
            setFocusArea("workspace");
          }}
        />
      ) : null}

      {!pagerMode && commentEditorTarget ? (
        <Suspense fallback={null}>
          <LazyCommentEditor
            filePath={commentEditorTarget.filePath}
            line={commentEditorTarget.line}
            terminalHeight={terminal.height}
            terminalWidth={terminal.width}
            theme={activeTheme}
            value={commentDraftBody}
            onChange={setCommentDraftBody}
            onCancel={closeCommentEditor}
            onSubmit={saveComment}
          />
        </Suspense>
      ) : null}

      {!pagerMode && confirmPrompt ? (
        <Suspense fallback={null}>
          <LazyConfirmDialog
            message={confirmPrompt.message}
            terminalHeight={terminal.height}
            terminalWidth={terminal.width}
            theme={activeTheme}
            title={confirmPrompt.title}
            onCancel={() => setConfirmPrompt(null)}
            onConfirm={confirmPrompt.onConfirm}
          />
        </Suspense>
      ) : null}

      {!pagerMode && showHelp ? (
        <Suspense fallback={null}>
          <LazyHelpDialog
            terminalHeight={terminal.height}
            terminalWidth={terminal.width}
            theme={activeTheme}
            onClose={closeHelp}
          />
        </Suspense>
      ) : null}
    </box>
  );
}
