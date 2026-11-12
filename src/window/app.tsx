/** @jsxImportSource react */
/**
 * The flow window: workspace sidebar, ticket overview, and the branch's diff rendered by Pierre's
 * web components. Keys mirror the terminal UI: j/k or arrows move, Enter shows that ticket's
 * overview, x toggles the overview, r reloads.
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
    const onKey = (event: KeyboardEvent) => {
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
      <div
        className="panes"
        style={{ gridTemplateColumns: paneColumns(workspaceOpen, overviewOpen, filesOpen) }}
      >
        {workspaceOpen ? (
          <aside className="sidebar">
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
                    </div>
                  </section>
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
    /** Bound by the native window on macOS: drag or zoom it from the title bar strip. */
    flowDragWindow?: () => Promise<void>;
    flowZoomWindow?: () => Promise<void>;
  }
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
  return [workspace ? "280px" : "", body, files ? "240px" : ""].filter(Boolean).join(" ");
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
            className={`file-row ${file.status}`}
            title={`${file.path} (${file.status})`}
            onClick={() =>
              document
                .getElementById(fileAnchor(file.path))
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            <FileIcon path={file.path} />
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

/** Language colors for file icons, by extension; anything else gets the muted file color. */
const FILE_COLORS: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#3178c6",
  mts: "#3178c6",
  js: "#e8c547",
  jsx: "#e8c547",
  mjs: "#e8c547",
  json: "#cbcb41",
  md: "#519aba",
  css: "#a86fd9",
  scss: "#cd6799",
  html: "#e34c26",
  rs: "#dea584",
  py: "#4b8bbe",
  go: "#00add8",
  java: "#e76f00",
  kt: "#a97bff",
  rb: "#cc342d",
  sh: "#89e051",
  toml: "#9c4221",
  yml: "#cb171e",
  yaml: "#cb171e",
  sql: "#e38c00",
};

/** A small document icon tinted with the file's language color. */
function FileIcon({ path }: { path: string }) {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const color = FILE_COLORS[extension] ?? "var(--faint)";
  return (
    <svg className="file-icon" width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z"
        fill="none"
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5h3.5" fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
      <rect x="5.5" y="8" width="5" height="1.4" rx=".7" fill={color} />
      <rect x="5.5" y="10.8" width="3.5" height="1.4" rx=".7" fill={color} />
    </svg>
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
        diffIndicators: "none",
        hunkSeparators: "simple",
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

/** Digits in the highest line number a patch shows, on either side. */
function widestLineNumber(patch: string) {
  let highest = 1;
  for (const match of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [, oldStart, oldCount = "1", newStart, newCount = "1"] = match;
    highest = Math.max(
      highest,
      Number(oldStart) + Number(oldCount),
      Number(newStart) + Number(newCount),
    );
  }
  return String(highest).length;
}

const DiffFile = memo(function DiffFile({
  file,
  options,
}: {
  file: WindowDiffFile;
  options: React.ComponentProps<typeof PatchDiff>["options"];
}) {
  // The gutter fits this file's widest line number exactly, so the margin left of the numbers
  // never depends on how many digits they have.
  const gutter = useMemo(
    () => ({ "--gutter-width": `${widestLineNumber(file.patch) + 1.5}ch` }),
    [file.patch],
  );
  return (
    <div className="file" id={fileAnchor(file.path)} style={gutter as React.CSSProperties}>
      <div className="file-header">
        <span>
          <span className="gutter-spacer" aria-hidden="true" />
          <FileIcon path={file.path} />
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
  position: relative;
}
[data-gutter] [data-separator="simple"]::after {
  content: "⋯";
  position: absolute;
  inset: 0 1ch 0 0;
  text-align: right;
  color: var(--faint);
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
  event.clientY < TITLE_BAR_HEIGHT &&
  event.target instanceof Element &&
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
