/** @jsxImportSource react */
import type { WindowDiffFile } from "./data";

interface FilesPaneProps {
  files: readonly WindowDiffFile[] | null;
  activePath: string | null;
  selectedPaths: ReadonlySet<string>;
  onSelectionChange: (paths: ReadonlySet<string>) => void;
  onOpen: (path: string) => void;
}

/** Compact change navigation with an independent selection for future file actions. */
export function FilesPane({
  files,
  activePath,
  selectedPaths,
  onSelectionChange,
  onOpen,
}: FilesPaneProps) {
  const groups = [
    { title: "Tracked", files: (files ?? []).filter((file) => !file.untracked) },
    { title: "Untracked", files: (files ?? []).filter((file) => file.untracked) },
  ];

  /** Update only the requested files, preserving selection in the other group. */
  function select(paths: readonly string[], checked: boolean) {
    const next = new Set(selectedPaths);
    for (const path of paths) {
      if (checked) next.add(path);
      else next.delete(path);
    }
    onSelectionChange(next);
  }

  return (
    <nav className="files" aria-label="Changes">
      <h2 className="files-title">Changes</h2>
      <div className="files-body">
        {files === null ? <p className="files-empty">Loading changes…</p> : null}
        {files?.length === 0 ? <p className="files-empty">No changes</p> : null}
        {groups
          .filter((group) => group.files.length > 0)
          .map((group) => {
            const selectedCount = group.files.filter((file) => selectedPaths.has(file.path)).length;
            return (
              <section className="file-group" aria-label={group.title} key={group.title}>
                <div className="file-group-heading">
                  <span>{group.title}</span>
                  <input
                    className="file-select"
                    type="checkbox"
                    aria-label={`Select all ${group.title.toLowerCase()} files`}
                    checked={selectedCount === group.files.length}
                    ref={(input) => {
                      if (input)
                        input.indeterminate =
                          selectedCount > 0 && selectedCount < group.files.length;
                    }}
                    onChange={(event) =>
                      select(
                        group.files.map((file) => file.path),
                        event.target.checked,
                      )
                    }
                  />
                </div>
                {group.files.map((file) => {
                  const slash = file.path.lastIndexOf("/");
                  return (
                    <div
                      className={`file-row ${file.status}`}
                      data-active={activePath === file.path}
                      data-selected={selectedPaths.has(file.path)}
                      key={file.path}
                    >
                      <button
                        className="file-open"
                        type="button"
                        title={`${file.path} (${file.untracked ? "untracked" : file.status})`}
                        aria-current={activePath === file.path ? "location" : undefined}
                        onClick={() => onOpen(file.path)}
                      >
                        <FileStatusIcon status={file.status} />
                        <span className="file-name">
                          {file.path.slice(slash + 1)}
                          {slash > 0 ? (
                            <span className="file-dir">{file.path.slice(0, slash)}</span>
                          ) : null}
                        </span>
                        {!file.untracked ? (
                          <span className="stat">
                            <span className="add">+{file.additions}</span>{" "}
                            <span className="del">−{file.deletions}</span>
                          </span>
                        ) : null}
                      </button>
                      <input
                        className="file-select"
                        type="checkbox"
                        aria-label={`Select ${file.path}`}
                        checked={selectedPaths.has(file.path)}
                        onChange={(event) => select([file.path], event.target.checked)}
                      />
                    </div>
                  );
                })}
              </section>
            );
          })}
      </div>
    </nav>
  );
}

/** Git status takes the place of a generic document icon. */
function FileStatusIcon({ status }: { status: WindowDiffFile["status"] }) {
  const labels = { added: "Added", deleted: "Deleted", renamed: "Renamed", modified: "Modified" };
  return (
    <svg
      className={`file-status ${status}`}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      role="img"
      aria-label={labels[status]}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      {status === "added" ? <path d="M5 8h6M8 5v6" /> : null}
      {status === "deleted" ? <path d="M5 8h6" /> : null}
      {status === "renamed" ? <path d="M5 8h6M8 5l3 3-3 3" /> : null}
      {status === "modified" ? (
        <rect x="6.5" y="6.5" width="3" height="3" fill="currentColor" stroke="none" />
      ) : null}
    </svg>
  );
}
