/** @jsxImportSource react */
/**
 * The flow window: workspace sidebar, ticket overview, and the branch's diff rendered by Pierre's
 * web components. Keys mirror the terminal UI: j/k or arrows move, Enter shows that ticket's
 * overview, x toggles the overview, / filters, r reloads.
 */
import { PatchDiff } from "@pierre/diffs/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { StoredTicketOverview } from "../core/ticketOverview";
import type { WorkspaceItem, WorkspaceSectionId } from "../ui/lib/workspace";
import type { WindowDiffFile, WindowWorkspace } from "./data";

const SECTIONS: { id: WorkspaceSectionId; title: string }[] = [
  { id: "todo", title: "To do" },
  { id: "approval", title: "Needs approval" },
  { id: "readyToMerge", title: "Ready to merge" },
  { id: "reviews", title: "Reviews" },
];

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
  const [overviewOpen, setOverviewOpen] = useState(true);
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
      } else if (event.key === "/") {
        event.preventDefault();
        filterRef.current?.focus();
      } else if (event.key === "r") {
        reload();
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visibleItems, cursor, reload]);

  return (
    <div className={`shell${overviewOpen ? "" : " no-overview"}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
          </div>
          flow
        </div>
        <input
          ref={filterRef}
          className="filter"
          placeholder="Filter  /"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setCursor(0);
          }}
        />
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
        <div className="status-bar" title={workspace?.notice}>
          {workspace?.notice ? "⚠︎ " : ""}
          {[workspace?.branch ? `on ${workspace.branch}` : "", timing].filter(Boolean).join(" · ")}
        </div>
      </aside>
      <OverviewPane item={selected} />
      <DiffPane files={diff} />
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

const DIFF_OPTIONS = {
  theme: { dark: "pierre-dark", light: "pierre-light" },
  themeType: "system",
  diffStyle: "split",
  overflow: "scroll",
  disableFileHeader: true,
} as const;

function DiffPane({ files }: { files: WindowDiffFile[] | null }) {
  if (files === null) {
    return <main className="diff" />;
  }
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <main className="diff">
      <div className="diff-header">
        <strong>Changes</strong>
        <span className="stat">
          {files.length} files <span className="add">+{additions}</span>{" "}
          <span className="del">-{deletions}</span>
        </span>
      </div>
      {files.length === 0 ? <p className="empty">No changes on this branch yet.</p> : null}
      {files.map((file) => (
        <DiffFile key={file.path} file={file} />
      ))}
    </main>
  );
}

const DiffFile = memo(function DiffFile({ file }: { file: WindowDiffFile }) {
  return (
    <div className="file">
      <div className="file-header">
        <span>{file.path}</span>
        <span className="stat">
          <span className="add">+{file.additions}</span>{" "}
          <span className="del">-{file.deletions}</span>
        </span>
      </div>
      <PatchDiff patch={file.patch} options={DIFF_OPTIONS} />
    </div>
  );
});

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
