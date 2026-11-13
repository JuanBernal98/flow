/** @jsxImportSource react */
/**
 * The flow window: workspace sidebar, ticket overview, and the branch's diff rendered by Pierre's
 * web components. Everything works from the keyboard with the terminal UI's keys; `?` lists them.
 */
import { PatchDiff, type DiffLineAnnotation, type PatchDiffProps } from "@pierre/diffs/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { registerClaudeCodeThemes } from "../ui/diff/claudeCodeThemes";
import type { PersistedComment } from "../core/comments";
import type { StoredTicketOverview } from "../core/ticketOverview";
import type { WorkspaceItem, WorkspaceSectionId } from "../ui/lib/workspace";
import type { WindowDiffFile, WindowTheme, WindowThemes, WindowWorkspace } from "./data";
import { hunkHoldsLine, listWindowHunks, stepFile, type WindowHunk } from "./review";
import { reviewGutterWidth } from "./reviewLayout";
import { FilesPane } from "./FilesPane";
import { FileAccordion, revealFileAccordion, toggleFileAccordions } from "./FileAccordion";
import { DiffToolbar } from "./DiffToolbar";

const SECTIONS: { id: WorkspaceSectionId; title: string }[] = [
  { id: "todo", title: "To do" },
  { id: "approval", title: "Needs approval" },
  { id: "readyToMerge", title: "Ready to merge" },
  { id: "reviews", title: "Reviews" },
];

// The Claude Code themes highlight by name, so Pierre must know them before any diff renders.
registerClaudeCodeThemes();

const startedAt = performance.now();
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
  const [workspace, setWorkspace] = useState<WindowWorkspace | null>(null);
  const [diff, setDiff] = useState<WindowDiffFile[] | null>(null);
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
  const [themes, setThemes] = useState<WindowThemes | null>(null);
  const [themeId, setThemeId] = useState<string | null>(null);
  const systemAppearance = useSystemAppearance();
  const theme = themes
    ? resolveWindowTheme(themes.themes, themeId ?? themes.configured, systemAppearance)
    : null;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    void api<WindowThemes>("/api/themes").then(setThemes);
  }, []);
  const [timing, setTiming] = useState<string>("");
  const [zone, setZone] = useState<FocusZone>("review");
  const [hunkIndex, setHunkIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [comments, setComments] = useState<PersistedComment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingG = useRef(0);
  const [userName, setUserName] = useState("You");
  useEffect(() => {
    void api<{ name: string }>("/api/me").then((me) => setUserName(me.name));
  }, []);

  const reload = useCallback(() => {
    // The diff is local and fast; the workspace waits on YouTrack and GitLab, so neither blocks the other.
    void api<WindowDiffFile[]>("/api/diff").then((files) => {
      setDiff(files);
      setSelectedPaths((current) => {
        const paths = new Set(files.map((file) => file.path));
        return new Set([...current].filter((path) => paths.has(path)));
      });
      requestAnimationFrame(() =>
        setTiming((current) => current || `diff ${Math.round(performance.now() - startedAt)} ms`),
      );
    });
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

  useEffect(reload, [reload]);

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
  const focusedHunk = hunks[Math.min(hunkIndex, hunks.length - 1)] ?? null;
  const commentsOn = useCallback(
    (hunk: WindowHunk) =>
      comments.filter((comment) => hunkHoldsLine(hunk, comment.file, comment.line)),
    [comments],
  );

  const saveComment = useCallback(
    async (body: string) => {
      if (!focusedHunk) return;
      try {
        await api("/api/comments", {
          method: "POST",
          body: { file: focusedHunk.path, range: focusedHunk.newRange, body },
        });
        setEditing(false);
        loadComments();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [focusedHunk, loadComments],
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
      setHunkIndex(Math.max(0, Math.min(next, hunks.length - 1)));
      setEditing(false);
    };
    const current = focusedHunk?.index ?? 0;
    const onKey = (event: KeyboardEvent) => {
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
      if (event.target instanceof Element && event.target.closest("textarea, input, select"))
        return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (helpOpen) {
        if (key === "Escape" || key === "?") setHelpOpen(false);
        event.preventDefault();
        return;
      }
      if (key === "?") {
        setHelpOpen(true);
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
        setZone("review");
        setEditing(true);
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
    zone,
    workspaceOpen,
    ticketsEnabled,
    loadComments,
  ]);

  return (
    <div className="window">
      <WindowTitleBar>
        <DiffToolbar
          files={diff}
          diffStyle={diffStyle}
          onDiffStyle={setDiffStyle}
          onToggleFold={() => toggleFileAccordions(document.querySelector<HTMLElement>(".diff"))}
        />
      </WindowTitleBar>
      <div
        className="panes"
        style={{ gridTemplateColumns: paneColumns(showWorkspace, showOverview, filesOpen) }}
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
          files={diff}
          selectedPaths={selectedPaths}
          onSelectFile={(path, checked) =>
            setSelectedPaths((current) => {
              const next = new Set(current);
              if (checked) next.add(path);
              else next.delete(path);
              return next;
            })
          }
          diffStyle={diffStyle}
          theme={theme}
          focusedHunk={zone === "review" ? focusedHunk : null}
          comments={comments}
          editing={editing && zone === "review"}
          onSaveComment={saveComment}
          onCancelComment={() => setEditing(false)}
          userName={userName}
          onFocusHunk={(index) => {
            setZone("review");
            setHunkIndex(index);
          }}
          hunks={hunks}
        />
        {filesOpen ? (
          <FilesPane
            files={diff}
            activePath={focusedHunk?.path ?? null}
            selectedPaths={selectedPaths}
            onSelectionChange={setSelectedPaths}
            onOpen={(path) => {
              const element = document.getElementById(fileAnchor(path));
              revealFileAccordion(element);
              const hunk = hunks.find((candidate) => candidate.path === path);
              if (hunk) setHunkIndex(hunk.index);
              element?.scrollIntoView({ behavior: "instant", block: "start" });
            }}
          />
        ) : null}
      </div>
      {helpOpen ? (
        <HelpOverlay ticketsEnabled={ticketsEnabled} onClose={() => setHelpOpen(false)} />
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
      />
    </div>
  );
}

type DiffStyle = "split" | "unified";

declare global {
  interface Window {
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
  return [workspace ? "280px" : "", body, files ? "320px" : ""].filter(Boolean).join(" ");
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

/** Two initials from a name: "Juan Bernal" → "JB", "juan" → "J". */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** One message in a thread, chat style: avatar, author and action, then the text. */
function ThreadMessage({
  author,
  userName,
  action,
  body,
}: {
  author: "user" | "agent";
  userName: string;
  action: string;
  body: string;
}) {
  const agent = author === "agent";
  return (
    <div className={`thread-message ${author}`}>
      <div className="thread-meta">
        <span className="avatar" aria-hidden="true">
          {agent ? "✻" : initials(userName)}
        </span>
        <span className="thread-author">{agent ? "Claude" : userName}</span>
        <span className="thread-action">{action}</span>
      </div>
      <div className="thread-body">{body}</div>
    </div>
  );
}

/** Every comment on one line and its replies in a single box, a row per message. */
function CommentThread({
  comments,
  userName,
  editor,
}: {
  comments: PersistedComment[];
  userName: string;
  editor: React.ReactNode;
}) {
  const first = comments[0];
  const messages = comments.reduce(
    (count, comment) => count + 1 + (comment.replies?.length ?? 0),
    0,
  );
  return (
    <div className={`thread${editor ? " editing" : ""}`}>
      {first ? (
        <div className="thread-header">
          <span>
            {first.range[0] === first.range[1]
              ? `Line ${first.range[0]}`
              : `Lines ${first.range[0]}–${first.range[1]}`}
          </span>
          <span>
            {messages} {messages === 1 ? "message" : "messages"}
          </span>
        </div>
      ) : null}
      {comments.flatMap((comment) => [
        <ThreadMessage
          key={`${comment.id}`}
          author={comment.author === "agent" ? "agent" : "user"}
          userName={userName}
          action="commented"
          body={comment.body}
        />,
        ...(comment.replies ?? []).map((reply, index) => (
          <ThreadMessage
            key={`${comment.id}-${index}`}
            author="agent"
            userName={userName}
            action="replied"
            body={reply.body}
          />
        )),
      ])}
      {editor}
    </div>
  );
}

/** The editor `a` opens: Enter saves, Shift+Enter adds a line, Esc cancels. */
function CommentEditor({
  onSave,
  onCancel,
}: {
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  return (
    <div className="thread-editor">
      <textarea
        autoFocus
        rows={2}
        value={body}
        placeholder="Comment for Claude on this hunk…  Enter saves · Shift+Enter new line · Esc cancels"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (body.trim()) onSave(body);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}

/** Every key, grouped like the terminal's help dialog. */
const HELP_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Review",
    keys: [
      ["j / k", "next / previous hunk (also J / K, ] / [)"],
      [". / ,", "next / previous file"],
      ["gg / G", "first / last hunk"],
      ["r", "reload"],
    ],
  },
  {
    title: "Comments",
    keys: [
      ["a", "add a comment on this hunk"],
      ["Enter", "save · Shift+Enter new line · Esc cancel"],
      ["} / {", "next / previous commented hunk"],
      ["d", "delete a comment on this hunk"],
    ],
  },
  {
    title: "Workspace",
    keys: [
      ["S", "focus the tickets; again to hide them"],
      ["j / k", "select a ticket"],
      ["Enter", "show its overview"],
      ["Esc", "back to the diff"],
    ],
  },
  {
    title: "View",
    keys: [
      ["F11", "toggle fullscreen"],
      ["x", "show / hide the overview"],
      ["s", "show / hide the changed files"],
      ["1 / 2", "split / stacked diff"],
      ["t", "next theme"],
      ["?", "this help"],
    ],
  },
];

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

function fileAnchor(path: string) {
  return `file-${path}`;
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

/** What an inline row in the diff holds: a saved comment, or the editor for a new one. */
/**
 * One discussion under a line, like a GitLab thread: every comment on that line with its replies,
 * plus the editor when `a` opens there.
 */
interface DiffNote {
  comments: PersistedComment[];
  editing: boolean;
}

function DiffPane({
  files,
  selectedPaths,
  onSelectFile,
  diffStyle,
  theme,
  hunks,
  focusedHunk,
  comments,
  editing,
  onSaveComment,
  onCancelComment,
  onFocusHunk,
  userName,
}: {
  files: WindowDiffFile[] | null;
  selectedPaths: ReadonlySet<string>;
  onSelectFile: (path: string, checked: boolean) => void;
  diffStyle: DiffStyle;
  theme: WindowTheme | null;
  hunks: WindowHunk[];
  focusedHunk: WindowHunk | null;
  comments: PersistedComment[];
  editing: boolean;
  onSaveComment: (body: string) => void;
  onCancelComment: () => void;
  onFocusHunk: (index: number) => void;
  userName: string;
}) {
  const codeTheme = theme?.codeTheme;
  const appearance = theme?.appearance;
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
        unsafeCSS: DIFF_CSS,
      }) as const,
    [diffStyle, codeTheme, appearance],
  );

  // Keep the focused hunk on screen, once Pierre has drawn its highlighted rows.
  useEffect(() => {
    if (!focusedHunk) return;
    revealFileAccordion(document.getElementById(fileAnchor(focusedHunk.path)));
    let frames = 0;
    let handle = 0;
    const reveal = () => {
      const host = document
        .getElementById(fileAnchor(focusedHunk.path))
        ?.querySelector("diffs-container");
      const row = host?.shadowRoot?.querySelector("[data-selected-line]");
      if (row) {
        row.scrollIntoView({ block: "nearest", behavior: "instant" });
      } else if (frames++ < 30) {
        handle = requestAnimationFrame(reveal);
      }
    };
    handle = requestAnimationFrame(reveal);
    return () => cancelAnimationFrame(handle);
  }, [focusedHunk]);

  const renderNote = useCallback(
    (annotation: DiffLineAnnotation<DiffNote>) => {
      const note = annotation.metadata;
      return (
        <CommentThread
          comments={note.comments}
          userName={userName}
          editor={
            note.editing ? (
              <CommentEditor onSave={onSaveComment} onCancel={onCancelComment} />
            ) : null
          }
        />
      );
    },
    [onSaveComment, onCancelComment, userName],
  );

  // Wait for the theme so code is not highlighted twice on launch.
  if (files === null || theme === null) {
    return <main className="diff" />;
  }
  return (
    <main className="diff" style={gutter}>
      {files.length === 0 ? <p className="empty">No changes on this branch yet.</p> : null}
      {files.map((file) => {
        const focused = focusedHunk?.path === file.path ? focusedHunk : null;
        return (
          <DiffFile
            key={file.path}
            file={file}
            selected={selectedPaths.has(file.path)}
            onSelectionChange={(checked) => onSelectFile(file.path, checked)}
            options={options}
            focused={focused}
            comments={comments}
            editing={editing && focused !== null}
            renderNote={renderNote}
            onClickHunk={(line) => {
              const hunk = hunks.find((candidate) => hunkHoldsLine(candidate, file.path, line));
              if (hunk) onFocusHunk(hunk.index);
            }}
          />
        );
      })}
    </main>
  );
}

const DiffFile = memo(function DiffFile({
  file,
  selected,
  onSelectionChange,
  options,
  focused,
  comments,
  editing,
  renderNote,
  onClickHunk,
}: {
  file: WindowDiffFile;
  selected: boolean;
  onSelectionChange: (checked: boolean) => void;
  options: PatchDiffProps<DiffNote, undefined>["options"];
  focused: WindowHunk | null;
  comments: PersistedComment[];
  editing: boolean;
  renderNote: (annotation: DiffLineAnnotation<DiffNote>) => React.ReactNode;
  onClickHunk: (line: number) => void;
}) {
  // The focused hunk shows as Pierre's line selection, on the new side like the terminal.
  const selectedLines = useMemo(
    () =>
      focused
        ? { start: focused.newRange[0], end: focused.newRange[1], side: "additions" as const }
        : null,
    [focused],
  );
  // One thread per commented line; the editor joins the thread on the focused hunk's last line.
  const notes = useMemo(() => {
    const threads = new Map<number, DiffNote>();
    for (const comment of comments) {
      if (comment.file !== file.path) continue;
      const thread = threads.get(comment.line) ?? { comments: [], editing: false };
      thread.comments.push(comment);
      threads.set(comment.line, thread);
    }
    if (editing && focused) {
      const line = focused.newRange[1];
      threads.set(line, { comments: threads.get(line)?.comments ?? [], editing: true });
    }
    return [...threads].map(([lineNumber, metadata]): DiffLineAnnotation<DiffNote> => ({
      side: "additions",
      lineNumber,
      metadata,
    }));
  }, [comments, file.path, editing, focused]);
  return (
    <FileAccordion
      id={fileAnchor(file.path)}
      path={file.path}
      selected={selected}
      onSelectionChange={onSelectionChange}
      expandable={/^@@ /m.test(file.patch)}
      emptyLabel={
        file.status === "added" || file.status === "deleted" ? "Empty file" : "No text changes"
      }
      header={
        <>
          <span className="file-header-label">
            <span className={`file-header-name ${file.status}`}>
              {file.path.slice(file.path.lastIndexOf("/") + 1)}
            </span>
            <span className="file-header-dir">
              {file.path.slice(0, file.path.lastIndexOf("/") + 1)}
            </span>
          </span>
          <span className="stat">
            <span className="add">+{file.additions}</span>{" "}
            <span className="del">-{file.deletions}</span>
          </span>
        </>
      }
    >
      <div className="code-block">
        <PatchDiff<DiffNote>
          patch={file.patch}
          options={{
            ...options,
            onLineClick: (props: { lineNumber: number }) => onClickHunk(props.lineNumber),
          }}
          selectedLines={selectedLines}
          lineAnnotations={notes}
          renderAnnotation={renderNote}
        />
      </div>
    </FileAccordion>
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

/** Paint the window chrome with a terminal theme's colors. */
function applyTheme(theme: WindowTheme) {
  const { colors } = theme;
  const dark = theme.appearance === "dark";
  void window.flowSetFrameTheme?.(dark);
  const style = document.documentElement.style;
  style.colorScheme = theme.appearance;
  style.setProperty("--bg", colors.background);
  style.setProperty("--sidebar", colors.panel);
  style.setProperty("--panel", colors.panelAlt);
  style.setProperty("--text", colors.text);
  style.setProperty("--muted", colors.muted);
  style.setProperty("--faint", colors.faint);
  // One hairline color for every divider, softer than the theme's border like the terminal's rules.
  style.setProperty("--line", `color-mix(in srgb, ${colors.border} 55%, transparent)`);
  style.setProperty("--accent", colors.accent);
  style.setProperty("--selected", `color-mix(in srgb, ${colors.accent} 18%, transparent)`);
  style.setProperty("--hover", dark ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.04)");
  style.setProperty("--chip", dark ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.05)");
  style.setProperty("--add", colors.added);
  style.setProperty("--del", colors.removed);
  // Pierre reads these through its shadow DOM, so hunks use the terminal's diff colors.
  // Code sits in a slightly darker block; line numbers stay outside it, on the window background.
  style.setProperty(
    "--code-bg",
    dark
      ? `color-mix(in srgb, ${colors.background} 86%, black)`
      : `color-mix(in srgb, ${colors.background} 97.5%, black)`,
  );
  style.setProperty("--diffs-bg-context-override", "var(--code-bg)");
  style.setProperty("--diffs-bg-context-gutter-override", colors.background);
  // Same scheme as the terminal: rows get the faint tint, changed words the stronger one.
  style.setProperty("--diffs-bg-addition-override", colors.addedRow);
  style.setProperty("--diffs-bg-deletion-override", colors.removedRow);
  style.setProperty("--diffs-bg-addition-emphasis-override", colors.addedWord);
  style.setProperty("--diffs-bg-deletion-emphasis-override", colors.removedWord);
  style.setProperty("--diffs-bg-addition-number-override", colors.background);
  style.setProperty("--diffs-bg-deletion-number-override", colors.background);
  style.setProperty("--diffs-bg-separator-override", colors.panel);
  style.setProperty("--diffs-bg-buffer-override", "var(--code-bg)");
  style.setProperty("--diffs-fg-number-override", colors.faint);
  style.setProperty("--diffs-addition-color-override", colors.added);
  style.setProperty("--diffs-deletion-color-override", colors.removed);
}

// Pierre paints code with its syntax theme's background in its "theme" layer; this CSS sits in
// its later "unsafe" layer, so the window's background wins without !important (which would flip
// the layer order and lose).
const DIFF_CSS = `
:host,
pre,
code {
  --diffs-bg: var(--bg);
  background-color: var(--bg);
  --diffs-font-family: ui-monospace, "SF Mono", Menlo, monospace;
  --diffs-font-size: 12.5px;
}
/* Every box spans the pane, however short its lines. */
:host,
pre,
[data-diff],
[data-code] {
  display: block;
  width: 100%;
}
[data-code] {
  display: grid;
}
/* A fixed number column, so the file title above can line up with the code box. */
[data-code] {
  --diffs-code-grid: var(--gutter-width) minmax(0, 1fr);
  grid-template-columns: var(--gutter-width) minmax(0, 1fr);
  /* No reserved scrollbar lane or outer padding, so the box spans exactly under its title. */
  --diffs-scrollbar-gutter-override: 0px;
  scrollbar-gutter: auto;
  padding-block: 0;
  --diffs-min-number-column-width: 0;
}
/* Like Zed: line numbers on the window background, the code in a framed, slightly darker box. */
[data-content] {
  --diffs-bg: var(--code-bg);
  background-color: var(--code-bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
}
/* Skipped lines between hunks: the box runs on unbroken and the gutter shows an ellipsis. */
[data-separator="simple"] {
  min-height: 1lh;
}
[data-content] [data-separator="simple"] {
  background-color: var(--code-bg);
}
[data-gutter] [data-separator="simple"] {
  background-color: var(--bg);
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding-inline: 0 1.5ch;
}
[data-gutter] [data-separator="simple"]::after {
  content: "⋯";
  color: var(--faint);
}
[data-gutter-buffer] {
  padding-inline: 0 1.5ch;
}
/* The focused hunk, like the terminal: no tint of its own, only its line numbers at full strength
   while every other hunk's numbers fade. */
[data-selected-line] {
  --diffs-computed-selected-line-bg: var(--diffs-computed-diff-line-bg);
}
[data-column-number] {
  color: color-mix(in srgb, var(--faint) 50%, var(--bg));
}
[data-column-number][data-selected-line] {
  --diffs-selection-number-fg: var(--muted);
  color: var(--muted);
}
/* Pierre mixes each row's tint with the background; the terminal paints the tint as is. */
[data-line],
[data-column-number],
[data-gutter-buffer],
[data-no-newline] {
  --mix-light: 0%;
  --mix-dark: 0%;
}
/* Breathing room inside the box: the first and last rows grow, so the room takes their color (green
   on a new line) and the gutter rows grow alike, keeping numbers on their lines. */
[data-content] > :first-child,
[data-gutter] > :first-child {
  padding-top: 6px;
}
[data-content] > :last-child,
[data-gutter] > :last-child {
  padding-bottom: 6px;
}
[data-column-number] {
  border-right: 0;
  padding-left: 0;
  padding-right: 1.5ch;
  --diffs-min-number-column-width: 0;
  --diffs-fg-number-addition-override: var(--faint);
  --diffs-fg-number-deletion-override: var(--faint);
}
`;

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
