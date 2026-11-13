/** @jsxImportSource react */
import type { WindowDiffFile } from "./data";
import { FileRow } from "./FileRow";
import type { ReactNode } from "react";
import { CommitActionButton } from "./CommitActionButton";

interface FilesPaneProps {
  files: readonly WindowDiffFile[] | null;
  activePath: string | null;
  selectedPaths: ReadonlySet<string>;
  onSelectionChange: (paths: ReadonlySet<string>) => void;
  onOpen: (path: string) => void;
  onCommit?: () => void;
  proposal?: ReactNode;
  onChanges?: () => void;
  onCommitTab?: () => void;
}

/** Compact change navigation with an independent selection for future file actions. */
export function FilesPane({
  files,
  activePath,
  selectedPaths,
  onSelectionChange,
  onOpen,
  onCommit,
  proposal,
  onChanges,
  onCommitTab,
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
      <div className="files-tabs" role="tablist" aria-label="Repository views">
        <button
          className="files-tab"
          type="button"
          role="tab"
          id="changes-tab"
          aria-selected={!proposal}
          aria-controls="changes-panel"
          onClick={onChanges}
        >
          {files === null ? "Changes" : `Changes (${files.length})`}
        </button>
        <button
          className="files-tab"
          type="button"
          role="tab"
          id="commit-tab"
          aria-selected={Boolean(proposal)}
          aria-controls="commit-panel"
          onClick={onCommitTab}
        >
          Commit
        </button>
      </div>
      {proposal ?? (
        <>
          <div
            className="files-body"
            role="tabpanel"
            id="changes-panel"
            aria-labelledby="changes-tab"
          >
            {files === null ? <p className="files-empty">Loading changes…</p> : null}
            {files?.length === 0 ? <p className="files-empty">No changes</p> : null}
            {groups
              .filter((group) => group.files.length > 0)
              .map((group) => {
                const selectedCount = group.files.filter(
                  (file) => file.pending !== false && selectedPaths.has(file.path),
                ).length;
                const pendingFiles = group.files.filter((file) => file.pending !== false);
                return (
                  <section className="file-group" aria-label={group.title} key={group.title}>
                    <label className="file-group-heading">
                      <span>{group.title}</span>
                      <input
                        className="file-select"
                        type="checkbox"
                        aria-label={`Select all ${group.title.toLowerCase()} files`}
                        checked={pendingFiles.length > 0 && selectedCount === pendingFiles.length}
                        disabled={pendingFiles.length === 0}
                        ref={(input) => {
                          if (input)
                            input.indeterminate =
                              selectedCount > 0 && selectedCount < pendingFiles.length;
                        }}
                        onChange={(event) =>
                          select(
                            pendingFiles.map((file) => file.path),
                            event.target.checked,
                          )
                        }
                      />
                    </label>
                    {group.files.map((file) => (
                      <FileRow
                        key={file.path}
                        file={file}
                        active={activePath === file.path}
                        selected={selectedPaths.has(file.path)}
                        onOpen={() => onOpen(file.path)}
                        onSelectionChange={(checked) => select([file.path], checked)}
                      />
                    ))}
                  </section>
                );
              })}
          </div>
          <footer className="files-footer">
            <CommitActionButton label="Propose" phase="propose" onClick={onCommit} />
          </footer>
        </>
      )}
    </nav>
  );
}
