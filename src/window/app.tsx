/** @jsxImportSource react */
/**
 * The flow window: workspace sidebar, ticket overview, and the branch's diff rendered by Pierre's
 * web components. Everything works from the keyboard with the terminal UI's keys; `?` lists them.
 */
import { type DiffLineAnnotation } from "@pierre/diffs/react";
import type React from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { registerClaudeCodeThemes } from "../ui/diff/claudeCodeThemes";
import type { PersistedComment } from "../core/comments";
import type { StoredTicketOverview } from "../core/ticketOverview";
import type { WorkspaceItem, WorkspaceSectionId } from "../ui/lib/workspace";
import type {
  WindowDiffFile,
  WindowDiffScope,
  WindowTheme,
  WindowThemes,
  WindowWorkspace,
} from "./data";
import { hunkHoldsLine, listWindowHunks, stepFile, type WindowHunk } from "./review";
import { reviewGutterWidth } from "./reviewLayout";
import { REVIEW_DIFF_CSS } from "./reviewStyles";
import { DESKTOP_KEYS, HELP_SECTIONS } from "./shortcuts";
import { applyIndentGuides } from "./indentGuides";
import { observeStickyFileHeaders } from "./stickyFileHeaders";
import { FilesPane } from "./FilesPane";
import { toggleFileAccordions } from "./FileAccordion";
import { DiffToolbar } from "./DiffToolbar";
import { windowThemeStyles } from "./windowTheme";
import { SettingsPanel, SettingsIcon } from "./SettingsPanel";
import { CommitProposalPanel } from "./CommitProposalPanel";
import { activateVisibleCommitAction } from "./CommitActionButton";
import { useCommitProposal } from "./useCommitProposal";
import { CommentThread } from "./CommentThread";
import { CommentEditor } from "./CommentEditor";
import { DiffFile, type DiffNote } from "./DiffFile";
import { EMPTY_FILE_COMMENTS, groupFileComments } from "./fileComments";
import { hasUnreadCommentReply } from "../core/commentThread";
import { navigateReview, type ReviewNavigation } from "./reviewNavigation";
import { normalizeWindowPreferences, type WindowPreferences } from "./preferences";
import type { WindowBootstrap } from "./windowBootstrap";

const SECTIONS: { id: WorkspaceSectionId; title: string }[] = [
  { id: "todo", title: "To do" },
  { id: "approval", title: "Needs approval" },
  { id: "readyToMerge", title: "Ready to merge" },
  { id: "reviews", title: "Reviews" },
];

// The Claude Code themes highlight by name, so Pierre must know them before any diff renders.
registerClaudeCodeThemes();

const startedAt = performance.now();
const initialBootstrap = window.flowBootstrap;
const secret = location.hash.slice(1);
// WebView2 injects init scripts before documentElement exists; modules run once the DOM is ready.
if (window.flowNativePlatform) {
  document.documentElement.classList.add(`native-${window.flowNativePlatform}`);
}

/** Call one API route with the launch secret; JSON in and out. */
async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? "GET",
    headers: { "x-flow-secret": secret, "content-type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) throw new Error((await response.text()) || `${path}: ${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
}

/** Where the keyboard acts: the diff (hunks and comments) or the tickets sidebar. */
type FocusZone = "review" | "workspace";

function App() {
  const [workspace, setWorkspace] = useState<WindowWorkspace | null>(
    initialBootstrap?.workspace ?? null,
  );
  const [diff, setDiff] = useState<WindowDiffFile[] | null>(initialBootstrap?.files ?? null);
  const [cursor, setCursor] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const ticketsEnabled = workspace?.ticketsEnabled === true;
  const showWorkspace = ticketsEnabled && workspaceOpen;
  const showOverview = ticketsEnabled && overviewOpen;
  const [filesOpen, setFilesOpen] = useState(true);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
  const [diffScope, setDiffScope] = useState<WindowDiffScope>("pending");
  const diffLoad = useRef(0);
  const [themes, setThemes] = useState<WindowThemes | null>(initialBootstrap?.themes ?? null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const systemAppearance = useSystemAppearance();
  const theme = themes
    ? resolveWindowTheme(themes.themes, themeId ?? themes.configured, systemAppearance)
    : null;
  useLayoutEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    if (initialBootstrap) return;
    void api<WindowThemes>("/api/themes").then(setThemes);
  }, []);
  useEffect(() => {
    void window.flowReady?.();
  }, []);
  const [timing, setTiming] = useState<string>("");
  const [zone, setZone] = useState<FocusZone>("review");
  const [hunkIndex, setHunkIndex] = useState(0);
  const [reviewNavigation, setReviewNavigation] = useState<ReviewNavigation | null>(null);
  const [editing, setEditing] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(() =>
    normalizeWindowPreferences(initialBootstrap?.preferences),
  );
  const [preferencesLoaded, setPreferencesLoaded] = useState(Boolean(initialBootstrap));
  const lastSavedPreferences = useRef(
    initialBootstrap
      ? JSON.stringify(normalizeWindowPreferences(initialBootstrap.preferences))
      : null,
  );
  const preferenceSave = useRef(Promise.resolve());
  const [comments, setComments] = useState<PersistedComment[]>(initialBootstrap?.comments ?? []);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (initialBootstrap) return;
    void api<WindowPreferences>("/api/preferences")
      .then((saved) => {
        setPreferences(normalizeWindowPreferences(saved));
        setPreferencesLoaded(true);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  }, []);
  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty("--diff-font-size", `${preferences.diffFontSize}px`);
    style.setProperty("--diff-line-height", `${Math.round(preferences.diffFontSize * 1.6)}px`);
    const serialized = JSON.stringify(preferences);
    if (!preferencesLoaded || lastSavedPreferences.current === serialized) return;
    const timer = window.setTimeout(() => {
      preferenceSave.current = preferenceSave.current
        .then(() => api("/api/preferences", { method: "PUT", body: preferences }))
        .then(() => {
          lastSavedPreferences.current = serialized;
        })
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : String(error)),
        );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [preferences, preferencesLoaded]);
  const pendingG = useRef(0);
  const [userName, setUserName] = useState(initialBootstrap?.userName ?? "You");
  useEffect(() => {
    if (initialBootstrap) return;
    void api<{ name: string }>("/api/me").then((me) => setUserName(me.name));
  }, []);

  const reloadDiff = useCallback(() => {
    const requestId = ++diffLoad.current;
    // The diff is local and fast; the workspace waits on YouTrack and GitLab, so neither blocks the other.
    void api<WindowDiffFile[]>(`/api/diff?scope=${diffScope}`).then((files) => {
      if (requestId !== diffLoad.current) return;
      setDiff(files);
      setSelectedPaths((current) => {
        const paths = new Set(
          files.filter((file) => file.pending !== false).map((file) => file.path),
        );
        return new Set([...current].filter((path) => paths.has(path)));
      });
      requestAnimationFrame(() =>
        setTiming((current) => current || `diff ${Math.round(performance.now() - startedAt)} ms`),
      );
    });
  }, [diffScope]);
  const reloadWorkspace = useCallback(() => {
    void api<WindowWorkspace>("/api/workspace").then((loaded) => {
      setWorkspace(loaded);
      if (!loaded.ticketsEnabled) setZone("review");
      setSelectedId((current) => current ?? loaded.checkedOutId);
      setTiming((current) =>
        [current, `workspace ${Math.round(performance.now() - startedAt)} ms`]
          .filter(Boolean)
          .join(" · "),
      );
    });
  }, []);

  const reload = useCallback(() => {
    reloadDiff();
    reloadWorkspace();
  }, [reloadDiff, reloadWorkspace]);
  const initialDiffLoaded = useRef(Boolean(initialBootstrap));
  useEffect(() => {
    if (initialDiffLoaded.current) {
      initialDiffLoaded.current = false;
      return;
    }
    reloadDiff();
  }, [reloadDiff]);
  useEffect(reloadWorkspace, [reloadWorkspace]);
  const selectReviewFile = useCallback((path: string, checked: boolean) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);
  const focusReviewHunk = useCallback((index: number) => {
    setZone("review");
    setHunkIndex(index);
    setReviewNavigation({ kind: "hunk", index });
  }, []);
  const cancelComment = useCallback(() => {
    setEditing(false);
    setReplyingTo(null);
  }, []);
  const startComment = useCallback((index: number) => {
    setZone("review");
    setHunkIndex(index);
    setReplyingTo(null);
    setEditing(true);
    setReviewNavigation(null);
  }, []);
  const replyToComment = useCallback(
    (comment: PersistedComment) => {
      const index = listWindowHunks(diff ?? []).find((hunk) =>
        hunkHoldsLine(hunk, comment.file, comment.line),
      )?.index;
      if (index === undefined) return;
      setZone("review");
      setHunkIndex(index);
      setReplyingTo(comment.id);
      setEditing(true);
      setReviewNavigation(null);
    },
    [diff],
  );
  const commitFlow = useCommitProposal(api, reload);

  // Comments change on disk when the agent replies or resolves them, so they are re-read often.
  const loadComments = useCallback(() => {
    void api<PersistedComment[]>("/api/comments").then((next) =>
      setComments((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next)),
    );
  }, []);
  useEffect(() => {
    loadComments();
    const timer = window.setInterval(loadComments, 2000);
    return () => window.clearInterval(timer);
  }, [loadComments]);

  const hunks = useMemo(() => listWindowHunks(diff ?? []), [diff]);
  const reviewComments = useMemo(
    () =>
      comments.filter((comment) =>
        hunks.some((hunk) => hunkHoldsLine(hunk, comment.file, comment.line)),
      ),
    [comments, hunks],
  );
  const readingComments = useRef(new Set<string>());
  const markCommentRead = useCallback(
    (comment: PersistedComment) => {
      const key = `${comment.threadId ?? comment.id}:${comment.replies?.length ?? 0}`;
      if (readingComments.current.has(key)) return;
      readingComments.current.add(key);
      void api(`/api/comments/${comment.id}/read`, {
        method: "POST",
        body: { replyCount: comment.replies?.length ?? 0 },
      })
        .then(loadComments)
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : String(error)),
        )
        .finally(() => readingComments.current.delete(key));
    },
    [loadComments],
  );
  const openFileComments = useCallback(
    (path: string) => {
      const threads = reviewComments.filter((comment) => comment.file === path);
      const comment = threads.find(hasUnreadCommentReply) ?? threads[0];
      if (!comment) return;
      const hunk = hunks.find((candidate) => hunkHoldsLine(candidate, path, comment.line));
      if (hunk) setHunkIndex(hunk.index);
      setZone("review");
      setEditing(false);
      setReviewNavigation({ kind: "comment", comment });
    },
    [reviewComments, hunks],
  );
  const openReviewFile = useCallback(
    (path: string) => {
      const hunk = hunks.find((candidate) => candidate.path === path);
      if (hunk) setHunkIndex(hunk.index);
      setZone("review");
      setEditing(false);
      setReviewNavigation({ kind: "file", path });
    },
    [hunks],
  );
  const focusedHunk = hunks[Math.min(hunkIndex, hunks.length - 1)] ?? null;
  const commentsOn = useCallback(
    (hunk: WindowHunk) =>
      reviewComments.filter((comment) => hunkHoldsLine(hunk, comment.file, comment.line)),
    [reviewComments],
  );

  const saveComment = useCallback(
    async (body: string) => {
      if (!focusedHunk) return;
      try {
        await api(replyingTo === null ? "/api/comments" : `/api/comments/${replyingTo}`, {
          method: "POST",
          body:
            replyingTo === null
              ? { file: focusedHunk.path, range: focusedHunk.newRange, body }
              : { body },
        });
        setEditing(false);
        setReplyingTo(null);
        loadComments();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [focusedHunk, loadComments, replyingTo],
  );

  const [collapsed, setCollapsed] = useState<ReadonlySet<WorkspaceSectionId>>(new Set());
  const allItems = useMemo(() => workspace?.items ?? [], [workspace]);
  // The items the keyboard walks: folded sections are skipped.
  const visibleItems = useMemo(
    () => allItems.filter((item) => !collapsed.has(item.section)),
    [allItems, collapsed],
  );
  const toggleSection = useCallback((id: WorkspaceSectionId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setCursor(0);
  }, []);

  const selected = workspace?.items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    const moveHunk = (next: number) => {
      const index = Math.max(0, Math.min(next, hunks.length - 1));
      setHunkIndex(index);
      setReviewNavigation({ kind: "hunk", index });
      setEditing(false);
    };
    const current = focusedHunk?.index ?? 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "," && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (event.key === "F11" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        if (!event.repeat) {
          const toggle = window.flowToggleFullscreen
            ? window.flowToggleFullscreen().then((fullscreen) => {
                if (typeof fullscreen === "boolean")
                  document.documentElement.classList.toggle("fullscreen", fullscreen);
              })
            : document.fullscreenElement
              ? document.exitFullscreen()
              : document.documentElement.requestFullscreen();
          void toggle.catch((error: unknown) =>
            setNotice(error instanceof Error ? error.message : String(error)),
          );
        }
        return;
      }
      // Typing in the comment editor or the theme menu keeps its own keys.
      if (settingsOpen) return;
      if (
        event.target instanceof Element &&
        event.target.closest('textarea, input:not([type="checkbox"]), select')
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (
        key === "Tab" ||
        ((key === "Enter" || key === " ") &&
          event.target instanceof Element &&
          event.target.closest('button, input[type="checkbox"]'))
      )
        return;
      if (helpOpen) {
        if (key === "Escape" || key === "?") setHelpOpen(false);
        event.preventDefault();
        return;
      }
      if (key === "?") {
        setHelpOpen(true);
      } else if (key === DESKTOP_KEYS.scope) {
        setDiffScope((scope) => (scope === "pending" ? "branch" : "pending"));
      } else if (key === DESKTOP_KEYS.commitTab) {
        setFilesOpen(true);
        if (commitFlow.open) commitFlow.close();
        else commitFlow.show();
      } else if (key === DESKTOP_KEYS.commitAction) {
        if (!activateVisibleCommitAction(document.querySelector(".files")) && !filesOpen)
          setFilesOpen(true);
      } else if (key === "Escape") {
        setZone("review");
        setEditing(false);
      } else if (key === "S") {
        if (!ticketsEnabled) return;
        // Like the terminal: S focuses the tickets, and again hides them.
        if (!workspaceOpen) {
          setWorkspaceOpen(true);
          setZone("workspace");
        } else if (zone === "workspace") {
          setWorkspaceOpen(false);
          setZone("review");
        } else {
          setZone("workspace");
        }
      } else if (zone === "workspace" && (key === "j" || key === "ArrowDown")) {
        setCursor((index) => Math.min(index + 1, visibleItems.length - 1));
      } else if (zone === "workspace" && (key === "k" || key === "ArrowUp")) {
        setCursor((index) => Math.max(index - 1, 0));
      } else if (zone === "workspace" && key === "Enter") {
        const item = visibleItems[cursor];
        if (item) setSelectedId(item.id);
      } else if (key === "j" || key === "J" || key === "]") {
        moveHunk(current + 1);
      } else if (key === "k" || key === "K" || key === "[") {
        moveHunk(current - 1);
      } else if (key === "." || key === ",") {
        moveHunk(stepFile(hunks, current, key === "." ? 1 : -1));
      } else if (key === "G") {
        moveHunk(hunks.length - 1);
      } else if (key === "g") {
        // gg: two presses in a row jump to the first hunk.
        if (Date.now() - pendingG.current < 600) moveHunk(0);
        pendingG.current = Date.now();
      } else if (key === "}" || key === "{") {
        const step = key === "}" ? 1 : -1;
        for (let index = current + step; index >= 0 && index < hunks.length; index += step) {
          const hunk = hunks[index];
          if (hunk && commentsOn(hunk).length > 0) {
            moveHunk(index);
            break;
          }
        }
      } else if (key === "a" && focusedHunk) {
        startComment(focusedHunk.index);
      } else if (key === "d" && focusedHunk) {
        const [comment] = commentsOn(focusedHunk);
        if (comment) {
          void api(`/api/comments/${comment.id}`, { method: "DELETE" }).then(loadComments);
        }
      } else if (key === "x") {
        if (!ticketsEnabled) return;
        setOverviewOpen((open) => !open);
      } else if (key === "s") {
        setFilesOpen((open) => !open);
      } else if (key === "1") {
        setDiffStyle("split");
      } else if (key === "2") {
        setDiffStyle("unified");
      } else if (key === "r") {
        reload();
        loadComments();
      } else if (key === "t" && themes) {
        setThemeId((currentTheme) => nextThemeId(themes.themes, theme?.id ?? currentTheme));
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    visibleItems,
    cursor,
    reload,
    themes,
    theme,
    hunks,
    focusedHunk,
    commentsOn,
    helpOpen,
    settingsOpen,
    zone,
    workspaceOpen,
    ticketsEnabled,
    loadComments,
    startComment,
    commitFlow.open,
    filesOpen,
  ]);

  return (
    <div className="window">
      <WindowTitleBar>
        <DiffToolbar
          files={diff}
          diffStyle={diffStyle}
          onDiffStyle={setDiffStyle}
          scope={diffScope}
          onToggleScope={() =>
            setDiffScope((scope) => (scope === "pending" ? "branch" : "pending"))
          }
          onToggleFold={() => toggleFileAccordions(document.querySelector<HTMLElement>(".diff"))}
        />
      </WindowTitleBar>
      <div
        className="panes"
        style={
          {
            gridTemplateColumns: paneColumns(showWorkspace, showOverview, filesOpen),
            "--files-sidebar-width": `${preferences.sidebarWidth ?? 320}px`,
          } as React.CSSProperties
        }
      >
        {showWorkspace ? (
          <aside className={`sidebar${zone === "workspace" ? " focused" : ""}`}>
            <div className="sections">
              {workspace === null ? <div className="section-title">Loading…</div> : null}
              {SECTIONS.map((section) => {
                const items = allItems.filter((item) => item.section === section.id);
                const open = !collapsed.has(section.id);
                return (
                  <section key={section.id} className={`section${open ? " open" : ""}`}>
                    <button
                      type="button"
                      className="row section-title"
                      aria-expanded={open}
                      onClick={() => toggleSection(section.id)}
                    >
                      <ChevronIcon />
                      <span className="row-label">{section.title}</span>
                      <span className="row-meta">{items.length}</span>
                    </button>
                    <div className="section-body">
                      <div className="section-items">
                        {items.map((item) => {
                          const index = visibleItems.indexOf(item);
                          return (
                            <SidebarItem
                              key={item.id}
                              item={item}
                              active={
                                zone === "workspace" ? index === cursor : item.id === selectedId
                              }
                              checkedOut={item.id === workspace?.checkedOutId}
                              onSelect={() => {
                                setCursor(index);
                                setSelectedId(item.id);
                                setZone("workspace");
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </aside>
        ) : null}
        {showOverview ? <OverviewPane item={selected} /> : null}
        <DiffPane
          navigation={reviewNavigation}
          files={diff}
          selectedPaths={selectedPaths}
          onSelectFile={selectReviewFile}
          diffStyle={diffStyle}
          scope={diffScope}
          theme={theme}
          focusedHunk={zone === "review" ? focusedHunk : null}
          comments={reviewComments}
          editing={editing && zone === "review"}
          replyingTo={replyingTo}
          onSaveComment={saveComment}
          onCancelComment={cancelComment}
          onStartComment={startComment}
          onReplyComment={replyToComment}
          onReadComment={markCommentRead}
          userName={userName}
          onFocusHunk={focusReviewHunk}
          hunks={hunks}
        />
        {filesOpen ? (
          <FilesPane
            commitActivity={commitFlow.activity}
            comments={reviewComments}
            onOpenComments={openFileComments}
            files={diff}
            activePath={focusedHunk?.path ?? null}
            selectedPaths={selectedPaths}
            onSelectionChange={setSelectedPaths}
            onCommit={() => void commitFlow.request([...selectedPaths])}
            onChanges={commitFlow.close}
            onCommitTab={commitFlow.show}
            onOpen={openReviewFile}
            onResize={(sidebarWidth) => setPreferences((current) => ({ ...current, sidebarWidth }))}
            proposalOpen={commitFlow.open}
            proposal={
              <CommitProposalPanel
                activity={commitFlow.activity}
                proposal={commitFlow.proposal}
                files={diff ?? []}
                onOpenFile={openReviewFile}
                pending={commitFlow.pending}
                error={commitFlow.error}
                onApprove={(commits) => void commitFlow.approve(commits)}
                onPropose={() => void commitFlow.request([...selectedPaths])}
              />
            }
          />
        ) : null}
      </div>
      {helpOpen ? (
        <HelpOverlay ticketsEnabled={ticketsEnabled} onClose={() => setHelpOpen(false)} />
      ) : null}
      {settingsOpen ? (
        <SettingsPanel
          fontSize={preferences.diffFontSize}
          onFontSize={(diffFontSize) => setPreferences((current) => ({ ...current, diffFontSize }))}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      <StatusBar
        zone={zone}
        notice={notice}
        workspace={workspace}
        files={diff}
        timing={timing}
        panels={{ workspace: showWorkspace, overview: showOverview, files: filesOpen }}
        onToggleWorkspace={() => setWorkspaceOpen((open) => !open)}
        onToggleOverview={() => setOverviewOpen((open) => !open)}
        onToggleFiles={() => setFilesOpen((open) => !open)}
        themes={themes?.themes ?? []}
        themeId={theme?.id ?? null}
        onTheme={setThemeId}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
      />
    </div>
  );
}

type DiffStyle = "split" | "unified";

declare global {
  interface Window {
    flowBootstrap?: WindowBootstrap;
    flowReady?: () => Promise<void>;
    flowNativePlatform?: "mac" | "windows";
    flowSetFrameTheme?: (dark: boolean) => Promise<void>;
    /** Bound by the native window: drag or zoom it from the title bar strip. */
    flowDragWindow?: () => Promise<void>;
    flowZoomWindow?: () => Promise<void | boolean>;
    flowToggleFullscreen?: () => Promise<void | boolean>;
    flowMinimizeWindow?: () => Promise<void>;
    flowCloseWindow?: () => Promise<void>;
    flowIsWindowMaximized?: () => Promise<boolean>;
    flowResizeWindow?: (edge: number) => Promise<void>;
  }
}

/** Review controls share the window's drag strip with the native caption buttons. */
function WindowTitleBar({ children }: { children: React.ReactNode }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const update = () => void window.flowIsWindowMaximized?.().then(setMaximized);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return (
    <header className="window-titlebar" data-maximized={maximized}>
      {window.flowNativePlatform === "windows"
        ? Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="window-resize"
              data-edge={index + 1}
              aria-hidden="true"
              onMouseDown={(event) => {
                if (event.button !== 0 || maximized) return;
                event.preventDefault();
                event.stopPropagation();
                void window.flowResizeWindow?.(index + 1);
              }}
            />
          ))
        : null}
      <span className="window-title">flow</span>
      {children}
      <div className="window-controls">
        <button
          type="button"
          aria-label="Minimize"
          onClick={() => void window.flowMinimizeWindow?.()}
        >
          <svg {...ICON}>
            <path d="M3 8h10" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => void window.flowZoomWindow?.()}
        >
          <svg {...ICON}>
            {maximized ? (
              <path d="M5 3h8v8M3 5h8v8H3z" />
            ) : (
              <rect x="3.5" y="3.5" width="9" height="9" />
            )}
          </svg>
        </button>
        <button
          type="button"
          className="window-close"
          aria-label="Close"
          onClick={() => void window.flowCloseWindow?.()}
        >
          <svg {...ICON}>
            <path d="m3.5 3.5 9 9m0-9-9 9" />
          </svg>
        </button>
      </div>
    </header>
  );
}

function ChevronIcon() {
  return (
    <svg {...ICON} width={10} height={10} className="chevron">
      <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} />
    </svg>
  );
}

/** Grid columns for the open panes: the overview and the diff split what the sidebars leave. */
function paneColumns(workspace: boolean, overview: boolean, files: boolean) {
  const body = overview ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)";
  return [workspace ? "280px" : "", body, files ? "var(--files-sidebar-width, 320px)" : ""]
    .filter(Boolean)
    .join(" ");
}

/** The bottom bar: panel toggles on the edges, the branch and change totals in between. */
function StatusBar({
  zone,
  notice,
  workspace,
  files,
  timing,
  panels,
  onToggleWorkspace,
  onToggleOverview,
  onToggleFiles,
  themes,
  themeId,
  onTheme,
  settingsOpen,
  onToggleSettings,
}: {
  zone: FocusZone;
  notice: string | null;
  workspace: WindowWorkspace | null;
  files: WindowDiffFile[] | null;
  timing: string;
  panels: { workspace: boolean; overview: boolean; files: boolean };
  onToggleWorkspace: () => void;
  onToggleOverview: () => void;
  onToggleFiles: () => void;
  themes: WindowTheme[];
  themeId: string | null;
  onTheme: (id: string) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        {workspace?.ticketsEnabled ? (
          <IconButton
            label="Workspace"
            shortcut="S"
            active={panels.workspace}
            onClick={onToggleWorkspace}
          >
            <SidebarLeftIcon />
          </IconButton>
        ) : null}
        {workspace?.ticketsEnabled ? (
          <IconButton
            label="Overview"
            shortcut="x"
            active={panels.overview}
            onClick={onToggleOverview}
          >
            <DocumentIcon />
          </IconButton>
        ) : null}
        {workspace?.branch ? (
          <span className="statusbar-item">
            <BranchIcon />
            {workspace.branch}
          </span>
        ) : null}
        {(notice ?? workspace?.notice) ? (
          <span className="statusbar-item warning" title={notice ?? workspace?.notice}>
            ⚠︎ {notice ?? workspace?.notice}
          </span>
        ) : null}
      </div>
      <div className="statusbar-group">
        <span className="statusbar-item faint">
          {zone === "workspace" ? "Tickets" : "Review"} · ? for keys
        </span>
        {timing ? <span className="statusbar-item faint">{timing}</span> : null}
        {files ? <span className="statusbar-item stat">{files.length} files</span> : null}
        {themes.length > 0 ? (
          <label className="theme-picker" title="Theme (t)">
            <PaletteIcon />
            <select value={themeId ?? ""} onChange={(event) => onTheme(event.target.value)}>
              {themes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <IconButton label="Files" shortcut="s" active={panels.files} onClick={onToggleFiles}>
          <SidebarRightIcon />
        </IconButton>
        <button
          type="button"
          className={`icon-button${settingsOpen ? " on" : ""}`}
          title="Settings (Ctrl+, / Cmd+,)"
          aria-label="Settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          <SettingsIcon />
        </button>
      </div>
    </footer>
  );
}

function IconButton({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`icon-button${active ? " on" : ""}`}
      title={`${active ? "Hide" : "Show"} ${label} (${shortcut})`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
} as const;

function SidebarLeftIcon() {
  return (
    <svg {...ICON}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M6 2.5v11" />
      <path d="M3 5h1.5M3 7h1.5" strokeLinecap="round" />
    </svg>
  );
}

function SidebarRightIcon() {
  return (
    <svg {...ICON}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M10 2.5v11" />
      <path d="M11.5 5H13M11.5 7H13" strokeLinecap="round" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg {...ICON}>
      <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" strokeLinejoin="round" />
      <path d="M6 7.5h4.5M6 10h4.5M6 5h2" strokeLinecap="round" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg {...ICON} width={13} height={13}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-7 4" />
    </svg>
  );
}

function HelpOverlay({
  ticketsEnabled,
  onClose,
}: {
  ticketsEnabled: boolean;
  onClose: () => void;
}) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        {HELP_SECTIONS.filter((section) => ticketsEnabled || section.title !== "Workspace").map(
          (section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.keys
                .filter(([keys]) => ticketsEnabled || keys !== "x")
                .map(([keys, action]) => (
                  <div key={keys + action} className="help-row">
                    <kbd>{keys}</kbd>
                    <span>{action}</span>
                  </div>
                ))}
            </section>
          ),
        )}
      </div>
    </div>
  );
}

const SidebarItem = memo(function SidebarItem({
  item,
  active,
  checkedOut,
  onSelect,
}: {
  item: WorkspaceItem;
  active: boolean;
  checkedOut: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // One line like every sidebar row: status, title, then the ticket or MR id in the margin.
  const id = item.ticketId ?? (item.mergeRequestIid ? `!${item.mergeRequestIid}` : "");
  const tooltip = [
    item.title,
    item.ticketId,
    item.mergeRequestIid ? `!${item.mergeRequestIid}` : "",
    checkedOut ? "checked out" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      ref={ref}
      className={`row item${active ? " selected" : ""}${checkedOut ? " checked-out" : ""}`}
      title={tooltip}
      onClick={onSelect}
    >
      <span className={`dot ${item.status}`} />
      <span className="row-label">{item.title}</span>
      {id ? <span className="row-meta">{id}</span> : null}
    </div>
  );
});

function OverviewPane({ item }: { item: WorkspaceItem | null }) {
  const [stored, setStored] = useState<StoredTicketOverview | null | undefined>(undefined);
  const ticketId = item?.ticketId;
  useEffect(() => {
    setStored(undefined);
    if (!ticketId) return;
    void api<StoredTicketOverview | null>(`/api/overview/${ticketId}`).then(setStored);
  }, [ticketId]);

  if (!item) {
    return (
      <section className="overview">
        <p className="empty">Pick a ticket with ↑↓ and Enter.</p>
      </section>
    );
  }
  const overview = stored?.overview;
  return (
    <section className="overview">
      <div className="eyebrow">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.ticketId}
          </a>
        ) : (
          <span>{item.ticketId}</span>
        )}
        {item.state ? <span>{item.state}</span> : null}
        {item.mergeRequestUrl ? (
          <a href={item.mergeRequestUrl} target="_blank" rel="noreferrer">
            !{item.mergeRequestIid}
          </a>
        ) : null}
      </div>
      <h1>{item.title}</h1>
      {stored === undefined && ticketId ? <p className="empty">Loading…</p> : null}
      {stored === null || !ticketId ? (
        <p className="empty">No overview yet. Switch to the ticket and Claude writes one.</p>
      ) : null}
      {overview ? (
        <>
          <p className="summary">{overview.summary}</p>
          <Bullets title="Why" items={overview.why} />
          <Bullets title="What to do" items={overview.todo} />
          <Bullets title="Acceptance criteria" items={overview.acceptance} />
          {overview.code.length > 0 ? (
            <>
              <h2>Where in the code</h2>
              <ul>
                {overview.code.map((entry) => (
                  <li key={entry.path}>
                    <code>{entry.path}</code> {entry.note}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <Bullets title="Questions & assumptions" items={overview.questions} />
          <Bullets title="Plan" items={overview.plan} ordered />
        </>
      ) : null}
    </section>
  );
}

function Bullets({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <>
      <h2>{title}</h2>
      <List>
        {items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </List>
    </>
  );
}

/** Coordinate the review stream while each file owns its diff rendering and inline discussions. */
const DiffPane = memo(function DiffPane({
  navigation,
  files,
  selectedPaths,
  onSelectFile,
  diffStyle,
  scope,
  theme,
  hunks,
  focusedHunk,
  comments,
  editing,
  replyingTo,
  onSaveComment,
  onCancelComment,
  onStartComment,
  onReplyComment,
  onReadComment,
  onFocusHunk,
  userName,
}: {
  navigation: ReviewNavigation | null;
  files: WindowDiffFile[] | null;
  selectedPaths: ReadonlySet<string>;
  onSelectFile: (path: string, checked: boolean) => void;
  diffStyle: DiffStyle;
  scope: WindowDiffScope;
  theme: WindowTheme | null;
  hunks: WindowHunk[];
  focusedHunk: WindowHunk | null;
  comments: PersistedComment[];
  editing: boolean;
  replyingTo: number | null;
  onSaveComment: (body: string) => void;
  onCancelComment: () => void;
  onStartComment: (index: number) => void;
  onReplyComment: (comment: PersistedComment) => void;
  onReadComment: (comment: PersistedComment) => void;
  onFocusHunk: (index: number) => void;
  userName: string;
}) {
  const codeTheme = theme?.codeTheme;
  const previousComments = useRef(new Map<string, PersistedComment[]>());
  const fileComments = useMemo(() => {
    const grouped = groupFileComments(comments, previousComments.current);
    previousComments.current = grouped;
    return grouped;
  }, [comments]);
  const appearance = theme?.appearance;
  useEffect(
    () => observeStickyFileHeaders(document.querySelector<HTMLElement>(".diff")),
    [files, codeTheme],
  );
  const gutter = useMemo(
    () => ({ "--gutter-width": reviewGutterWidth(files ?? []) }) as React.CSSProperties,
    [files],
  );
  const options = useMemo(
    () =>
      ({
        theme: codeTheme ?? { dark: "pierre-dark", light: "pierre-light" },
        themeType: appearance ?? "system",
        diffStyle,
        overflow: "scroll",
        disableFileHeader: true,
        diffIndicators: "none",
        hunkSeparators: "simple",
        unsafeCSS: REVIEW_DIFF_CSS,
        onPostRender: applyIndentGuides,
      }) as const,
    [diffStyle, codeTheme, appearance],
  );

  useLayoutEffect(
    () => navigateReview(document.querySelector<HTMLElement>(".diff"), navigation, hunks),
    [navigation, hunks],
  );

  const renderNote = useCallback(
    (annotation: DiffLineAnnotation<DiffNote>) => {
      const note = annotation.metadata;
      const path = note.comments[0]?.file;
      return (
        <CommentThread
          comments={note.comments}
          userName={userName}
          onRead={onReadComment}
          editor={
            <CommentEditor
              active={note.editing}
              onSave={onSaveComment}
              onCancel={onCancelComment}
              onActivate={() => {
                const comment = note.comments.at(-1);
                if (comment) {
                  onReplyComment(comment);
                  return;
                }
                const hunk = hunks.find((candidate) =>
                  hunkHoldsLine(candidate, path ?? "", annotation.lineNumber),
                );
                if (hunk) onStartComment(hunk.index);
              }}
            />
          }
        />
      );
    },
    [
      onSaveComment,
      onCancelComment,
      onStartComment,
      onReplyComment,
      onReadComment,
      hunks,
      userName,
    ],
  );

  // Wait for the theme so code is not highlighted twice on launch.
  if (files === null || theme === null) {
    return <main className="diff" />;
  }
  return (
    <main className="diff" style={gutter}>
      {files.length === 0 ? (
        <p className="empty">
          {scope === "pending" ? "No pending changes." : "No changes on this branch yet."}
        </p>
      ) : null}
      {files.map((file) => {
        const focused = focusedHunk?.path === file.path ? focusedHunk : null;
        return (
          <DiffFile
            key={file.path}
            file={file}
            selected={selectedPaths.has(file.path)}
            onSelectFile={onSelectFile}
            options={options}
            focused={focused}
            comments={fileComments.get(file.path) ?? EMPTY_FILE_COMMENTS}
            editing={editing && focused !== null}
            replyingTo={editing && focused !== null ? replyingTo : null}
            renderNote={renderNote}
            hunks={hunks}
            onFocusHunk={onFocusHunk}
          />
        );
      })}
    </main>
  );
});

/** Follow macOS light and dark mode, for the `claude` theme that tracks it. */
function useSystemAppearance() {
  const query = useMemo(() => window.matchMedia("(prefers-color-scheme: dark)"), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = () => setDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [query]);
  return dark ? "dark" : "light";
}

/** The theme to paint: `claude` picks its light or dark variant like the terminal does. */
function resolveWindowTheme(themes: WindowTheme[], id: string, system: "light" | "dark") {
  const resolvedId = id === "claude" ? `claude-${system}` : id;
  return (
    themes.find((theme) => theme.id === resolvedId) ??
    themes.find((theme) => theme.id === "zed") ??
    themes[0] ??
    null
  );
}

function nextThemeId(themes: WindowTheme[], current: string | null) {
  const index = themes.findIndex((theme) => theme.id === current);
  return themes[(index + 1) % themes.length]?.id ?? current;
}

/** Apply the same colors used before the native window first becomes visible. */
function applyTheme(theme: WindowTheme) {
  void window.flowSetFrameTheme?.(theme.appearance === "dark");
  for (const [name, value] of Object.entries(windowThemeStyles(theme)))
    document.documentElement.style.setProperty(name, value);
}
function PaletteIcon() {
  return (
    <svg {...ICON} width={13} height={13}>
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.6 1.5-1.3 0-1-.9-1.2-.9-2 0-.7.6-1.2 1.3-1.2h1.6a3 3 0 0 0 3-3C14.5 4 11.6 1.5 8 1.5Z" />
      <circle cx="5" cy="7" r=".8" fill="currentColor" />
      <circle cx="7.5" cy="4.6" r=".8" fill="currentColor" />
      <circle cx="10.6" cy="5.4" r=".8" fill="currentColor" />
    </svg>
  );
}

// WebKit does not repaint a native scrollbar when its style changes, so panes hide theirs and
// get an overlay thumb instead: shown while the pane scrolls, faded out shortly after it stops.
const scrollThumbs = new WeakMap<Element, { thumb: HTMLDivElement; timer: number }>();

/** Place a pane's overlay thumb over its right edge, sized and offset by its scroll position. */
function showScrollThumb(pane: HTMLElement) {
  let entry = scrollThumbs.get(pane);
  if (!entry) {
    const thumb = document.createElement("div");
    thumb.className = "scroll-thumb";
    document.body.append(thumb);
    entry = { thumb, timer: 0 };
    scrollThumbs.set(pane, entry);
  }
  const { thumb } = entry;
  const bounds = pane.getBoundingClientRect();
  const visible = pane.clientHeight / pane.scrollHeight;
  if (visible >= 1) return;
  const height = Math.max(24, pane.clientHeight * visible);
  const travel = pane.clientHeight - height;
  const progress = pane.scrollTop / (pane.scrollHeight - pane.clientHeight);
  thumb.style.height = `${height}px`;
  thumb.style.transform = `translate(${bounds.right - 9}px, ${bounds.top + travel * progress}px)`;
  thumb.classList.add("visible");
  window.clearTimeout(entry.timer);
  entry.timer = window.setTimeout(() => thumb.classList.remove("visible"), 700);
}

document.addEventListener(
  "wheel",
  (event) => {
    // Cancel the webview's page zoom before it changes the review's scale.
    if (event.ctrlKey) event.preventDefault();
  },
  { capture: true, passive: false },
);

document.addEventListener(
  "scroll",
  (event) => {
    if (event.target instanceof HTMLElement) showScrollThumb(event.target);
  },
  { capture: true, passive: true },
);

// No title bar is drawn, so the strip under the traffic lights acts as one across the window:
// pressing its empty space drags the window and a double click zooms it.
const TITLE_BAR_HEIGHT = 28;
const isTitleBarPress = (event: MouseEvent) =>
  event.target instanceof Element &&
  (event.target.closest(".window-titlebar") !== null ||
    (document.documentElement.classList.contains("native-mac") &&
      event.clientY < TITLE_BAR_HEIGHT)) &&
  event.target.closest("button, a, input, select, label") === null;
document.addEventListener("mousedown", (event) => {
  if (event.button === 0 && event.detail === 1 && isTitleBarPress(event))
    void window.flowDragWindow?.();
});
document.addEventListener("dblclick", (event) => {
  if (isTitleBarPress(event)) void window.flowZoomWindow?.();
});

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
