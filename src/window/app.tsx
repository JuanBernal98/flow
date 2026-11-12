/** @jsxImportSource react */
/**
 * The flow window: workspace sidebar, ticket overview, and the branch's diff rendered by Pierre's
 * web components. Keys mirror the terminal UI: j/k or arrows move, Enter shows that ticket's
 * overview, x toggles the overview, / filters, r reloads.
 */
import { PatchDiff } from "@pierre/diffs/react";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { registerClaudeCodeThemes } from "../ui/diff/claudeCodeThemes";
import type { StoredTicketOverview } from "../core/ticketOverview";
import type { WorkspaceItem, WorkspaceSectionId } from "../ui/lib/workspace";
import type { WindowDiffFile, WindowTheme, WindowThemes, WindowWorkspace } from "./data";

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

/** Fetch one API route with the launch secret. */
async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { "x-flow-secret": secret } });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return (await response.json()) as T;
}

function App() {
  const [workspace, setWorkspace] = useState<WindowWorkspace | null>(null);
  const [diff, setDiff] = useState<WindowDiffFile[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [overviewOpen, setOverviewOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("split");
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
  const [filter, setFilter] = useState("");
  const [timing, setTiming] = useState<string>("");
  const filterRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    // The diff is local and fast; the workspace waits on YouTrack and GitLab, so neither blocks the other.
    void api<WindowDiffFile[]>("/api/diff").then((files) => {
      setDiff(files);
      requestAnimationFrame(() =>
        setTiming((current) => current || `diff ${Math.round(performance.now() - startedAt)} ms`),
      );
    });
    void api<WindowWorkspace>("/api/workspace").then((loaded) => {
      setWorkspace(loaded);
      setSelectedId((current) => current ?? loaded.checkedOutId);
      setTiming((current) =>
        [current, `workspace ${Math.round(performance.now() - startedAt)} ms`]
          .filter(Boolean)
          .join(" · "),
      );
    });
  }, []);

  useEffect(reload, [reload]);

  const visibleItems = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const items = workspace?.items ?? [];
    return query
      ? items.filter((item) => `${item.ticketId ?? ""} ${item.title}`.toLowerCase().includes(query))
      : items;
  }, [workspace, filter]);

  const selected = workspace?.items.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target === filterRef.current) {
        if (event.key === "Escape" || event.key === "Enter") filterRef.current?.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        setCursor((index) => Math.min(index + 1, visibleItems.length - 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        setCursor((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        const item = visibleItems[cursor];
        if (item) setSelectedId(item.id);
      } else if (event.key === "x") {
        setOverviewOpen((open) => !open);
      } else if (event.key === "S") {
        setWorkspaceOpen((open) => !open);
      } else if (event.key === "s") {
        setFilesOpen((open) => !open);
      } else if (event.key === "1") {
        setDiffStyle("split");
      } else if (event.key === "2") {
        setDiffStyle("unified");
      } else if (event.key === "/") {
        event.preventDefault();
        setWorkspaceOpen(true);
        filterRef.current?.focus();
      } else if (event.key === "r") {
        reload();
      } else if (event.key === "t" && themes) {
        setThemeId((current) => nextThemeId(themes.themes, theme?.id ?? current));
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleItems, cursor, reload, themes, theme]);

  return (
    <div className="window">
      <TopBar>
        <label className="search">
          <SearchIcon />
          <input
            ref={filterRef}
            placeholder="Filter tickets and reviews"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setCursor(0);
              setWorkspaceOpen(true);
            }}
          />
          {filter ? null : <kbd>/</kbd>}
        </label>
      </TopBar>
      <div
        className="panes"
        style={{ gridTemplateColumns: paneColumns(workspaceOpen, overviewOpen, filesOpen) }}
      >
        {workspaceOpen ? (
          <aside className="sidebar">
            <div className="sections">
              {workspace === null ? <div className="section-title">Loading…</div> : null}
              {SECTIONS.map((section) => {
                const items = visibleItems.filter((item) => item.section === section.id);
                return (
                  <div key={section.id}>
                    <div className="section-title">
                      <span>{section.title}</span>
                      <span>{items.length}</span>
                    </div>
                    {items.map((item) => {
                      const index = visibleItems.indexOf(item);
                      return (
                        <SidebarItem
                          key={item.id}
                          item={item}
                          active={index === cursor}
                          checkedOut={item.id === workspace?.checkedOutId}
                          onSelect={() => {
                            setCursor(index);
                            setSelectedId(item.id);
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </aside>
        ) : null}
        {overviewOpen ? <OverviewPane item={selected} /> : null}
        <DiffPane files={diff} diffStyle={diffStyle} theme={theme} />
        {filesOpen ? <FilesPane files={diff} /> : null}
      </div>
      <StatusBar
        workspace={workspace}
        files={diff}
        timing={timing}
        panels={{ workspace: workspaceOpen, overview: overviewOpen, files: filesOpen }}
        diffStyle={diffStyle}
        onToggleWorkspace={() => setWorkspaceOpen((open) => !open)}
        onToggleOverview={() => setOverviewOpen((open) => !open)}
        onToggleFiles={() => setFilesOpen((open) => !open)}
        onDiffStyle={setDiffStyle}
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
    /** Bound by the native window on macOS: drag or zoom it from the page's own top bar. */
    flowDragWindow?: () => Promise<void>;
    flowZoomWindow?: () => Promise<void>;
  }
}

/**
 * The top bar, drawn under the macOS traffic lights. Pressing its empty space drags the window and
 * a double click zooms it, like a native title bar; controls inside it keep their own clicks.
 */
function TopBar({ children }: { children: React.ReactNode }) {
  const isBackground = (target: EventTarget) =>
    target instanceof HTMLElement && target.closest("input, button, label") === null;
  return (
    <header
      className="topbar"
      onMouseDown={(event) => {
        if (event.button === 0 && event.detail === 1 && isBackground(event.target)) {
          void window.flowDragWindow?.();
        }
      }}
      onDoubleClick={(event) => {
        if (isBackground(event.target)) void window.flowZoomWindow?.();
      }}
    >
      {children}
    </header>
  );
}

function SearchIcon() {
  return (
    <svg {...ICON} width={13} height={13}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" strokeLinecap="round" />
    </svg>
  );
}

/** Grid columns for the open panes; the diff always takes the rest. */
function paneColumns(workspace: boolean, overview: boolean, files: boolean) {
  return [workspace ? "280px" : "", overview ? "380px" : "", "minmax(0, 1fr)", files ? "240px" : ""]
    .filter(Boolean)
    .join(" ");
}

/** The bottom bar: panel toggles on the edges, the branch and change totals in between. */
function StatusBar({
  workspace,
  files,
  timing,
  panels,
  diffStyle,
  onToggleWorkspace,
  onToggleOverview,
  onToggleFiles,
  onDiffStyle,
  themes,
  themeId,
  onTheme,
}: {
  workspace: WindowWorkspace | null;
  files: WindowDiffFile[] | null;
  timing: string;
  panels: { workspace: boolean; overview: boolean; files: boolean };
  diffStyle: DiffStyle;
  onToggleWorkspace: () => void;
  onToggleOverview: () => void;
  onToggleFiles: () => void;
  onDiffStyle: (style: DiffStyle) => void;
  themes: WindowTheme[];
  themeId: string | null;
  onTheme: (id: string) => void;
}) {
  const additions = files?.reduce((sum, file) => sum + file.additions, 0) ?? 0;
  const deletions = files?.reduce((sum, file) => sum + file.deletions, 0) ?? 0;
  return (
    <footer className="statusbar">
      <div className="statusbar-group">
        <IconButton
          label="Workspace"
          shortcut="S"
          active={panels.workspace}
          onClick={onToggleWorkspace}
        >
          <SidebarLeftIcon />
        </IconButton>
        <IconButton
          label="Overview"
          shortcut="x"
          active={panels.overview}
          onClick={onToggleOverview}
        >
          <DocumentIcon />
        </IconButton>
        {workspace?.branch ? (
          <span className="statusbar-item">
            <BranchIcon />
            {workspace.branch}
          </span>
        ) : null}
        {workspace?.notice ? (
          <span className="statusbar-item warning" title={workspace.notice}>
            ⚠︎ {workspace.notice}
          </span>
        ) : null}
      </div>
      <div className="statusbar-group">
        {timing ? <span className="statusbar-item faint">{timing}</span> : null}
        {files ? (
          <span className="statusbar-item stat">
            {files.length} files <span className="add">+{additions}</span>{" "}
            <span className="del">-{deletions}</span>
          </span>
        ) : null}
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
        <div className="segmented" role="group" aria-label="Diff layout">
          <button
            type="button"
            className={diffStyle === "split" ? "on" : ""}
            title="Split (1)"
            onClick={() => onDiffStyle("split")}
          >
            <SplitIcon />
          </button>
          <button
            type="button"
            className={diffStyle === "unified" ? "on" : ""}
            title="Stacked (2)"
            onClick={() => onDiffStyle("unified")}
          >
            <StackIcon />
          </button>
        </div>
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

function SplitIcon() {
  return (
    <svg {...ICON} width={14} height={14}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M8 2.5v11" />
    </svg>
  );
}

function StackIcon() {
  return (
    <svg {...ICON} width={14} height={14}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M1.5 8h13" />
    </svg>
  );
}

/** The changed files; clicking one scrolls the diff to it. */
function FilesPane({ files }: { files: WindowDiffFile[] | null }) {
  return (
    <nav className="files">
      <div className="pane-title">Changes</div>
      {(files ?? []).map((file) => {
        const slash = file.path.lastIndexOf("/");
        return (
          <button
            type="button"
            key={file.path}
            className="file-row"
            title={file.path}
            onClick={() =>
              document
                .getElementById(fileAnchor(file.path))
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <span className="file-name">
              {file.path.slice(slash + 1)}
              <span className="file-dir">{slash > 0 ? file.path.slice(0, slash) : ""}</span>
            </span>
            <span className="stat">
              <span className="add">+{file.additions}</span>{" "}
              <span className="del">-{file.deletions}</span>
            </span>
          </button>
        );
      })}
    </nav>
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
  return (
    <div ref={ref} className={`item${active ? " selected" : ""}`} onClick={onSelect}>
      <span className={`dot ${item.status}`} />
      <div style={{ minWidth: 0 }}>
        <div className="item-title">{item.title}</div>
        <div className="item-meta">
          {item.ticketId ? <span>{item.ticketId}</span> : null}
          {item.mergeRequestIid ? <span>!{item.mergeRequestIid}</span> : null}
          {checkedOut ? <span className="checked-out">● checked out</span> : null}
        </div>
      </div>
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

function DiffPane({
  files,
  diffStyle,
  theme,
}: {
  files: WindowDiffFile[] | null;
  diffStyle: DiffStyle;
  theme: WindowTheme | null;
}) {
  const codeTheme = theme?.codeTheme;
  const appearance = theme?.appearance;
  const options = useMemo(
    () =>
      ({
        theme: codeTheme ?? { dark: "pierre-dark", light: "pierre-light" },
        themeType: appearance ?? "system",
        diffStyle,
        overflow: "scroll",
        disableFileHeader: true,
        unsafeCSS: DIFF_CSS,
      }) as const,
    [diffStyle, codeTheme, appearance],
  );
  // Wait for the theme so code is not highlighted twice on launch.
  if (files === null || theme === null) {
    return <main className="diff" />;
  }
  return (
    <main className="diff">
      {files.length === 0 ? <p className="empty">No changes on this branch yet.</p> : null}
      {files.map((file) => (
        <DiffFile key={file.path} file={file} options={options} />
      ))}
    </main>
  );
}

const DiffFile = memo(function DiffFile({
  file,
  options,
}: {
  file: WindowDiffFile;
  options: React.ComponentProps<typeof PatchDiff>["options"];
}) {
  return (
    <div className="file" id={fileAnchor(file.path)}>
      <div className="file-header">
        <span>{file.path}</span>
        <span className="stat">
          <span className="add">+{file.additions}</span>{" "}
          <span className="del">-{file.deletions}</span>
        </span>
      </div>
      <div className="code-block">
        <PatchDiff patch={file.patch} options={options} />
      </div>
    </div>
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
      ? `color-mix(in srgb, ${colors.background} 72%, black)`
      : `color-mix(in srgb, ${colors.background} 96%, black)`,
  );
  style.setProperty("--diffs-bg-context-override", "var(--code-bg)");
  style.setProperty("--diffs-bg-context-gutter-override", colors.background);
  style.setProperty("--diffs-bg-addition-override", colors.addedLine);
  style.setProperty("--diffs-bg-deletion-override", colors.removedLine);
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
  --diffs-bg: var(--code-bg);
  background-color: var(--bg);
  --diffs-font-family: ui-monospace, "SF Mono", Menlo, monospace;
  --diffs-font-size: 12.5px;
}
/* Line numbers sit outside the code block, on the window background. */
[data-column-number] {
  --diffs-bg: var(--bg);
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

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
