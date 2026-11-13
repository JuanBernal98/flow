/** @jsxImportSource react */
import type { WindowDiffFile } from "./data";
import { FileRow } from "./FileRow";
import type { ReactNode } from "react";
import { CommitActionButton } from "./CommitActionButton";
import { SidebarResizer } from "./SidebarResizer";
import type { PersistedComment } from "../core/comments";
import { hasUnreadCommentReply } from "../core/commentThread";
import { useMemo } from "react";
import { groupFileComments } from "./fileComments";
import type { CommitActivity } from "./useCommitProposal";

interface FilesPaneProps {
  files: readonly WindowDiffFile[] | null;
  activePath: string | null;
  selectedPaths: ReadonlySet<string>;
  onSelectionChange: (paths: ReadonlySet<string>) => void;
  onOpen: (path: string) => void;
  onCommit?: () => void;
  proposal?: ReactNode;
  proposalOpen?: boolean;
  onChanges?: () => void;
  onCommitTab?: () => void;
  onResize?: (width: number) => void;
  comments?: readonly PersistedComment[];
  onOpenComments?: (path: string) => void;
  commitActivity?: CommitActivity;
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
  proposalOpen = Boolean(proposal),
  onChanges,
  onCommitTab,
  onResize,
  comments,
  onOpenComments,
  commitActivity = "idle",
}: FilesPaneProps) {
  const fileComments = useMemo(() => groupFileComments(comments ?? [], new Map()), [comments]);
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
      {onResize ? <SidebarResizer onResize={onResize} /> : null}
      <div className="files-tabs" role="tablist" aria-label="Repository views">
        <button
          className="files-tab"
          type="button"
          role="tab"
          id="changes-tab"
          aria-selected={!proposalOpen}
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
          aria-selected={proposalOpen}
          aria-controls="commit-panel"
          onClick={onCommitTab}
        >
          Commit
        </button>
      </div>
      <div className="files-view" hidden={proposalOpen}>
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
                      commentCount={fileComments.get(file.path)?.length}
                      unreadComments={fileComments.get(file.path)?.some(hasUnreadCommentReply)}
                      onOpenComments={onOpenComments ? () => onOpenComments(file.path) : undefined}
                      onOpen={() => onOpen(file.path)}
                      onSelectionChange={(checked) => select([file.path], checked)}
                    />
                  ))}
                </section>
              );
            })}
        </div>
        <footer className="files-footer">
          <CommitActionButton
            label={
              commitActivity === "proposing"
                ? "Proposing…"
                : commitActivity === "committing"
                  ? "Committing…"
                  : "Propose"
            }
            phase={commitActivity === "committing" ? "commit" : "propose"}
            loading={commitActivity !== "idle"}
            onClick={onCommit}
          />
        </footer>
      </div>
      {proposal ? (
        <div className="files-view" hidden={!proposalOpen}>
          {proposal}
        </div>
      ) : null}
    </nav>
  );
}
