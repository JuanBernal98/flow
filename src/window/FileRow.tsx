/** @jsxImportSource react */
import type { WindowDiffFile } from "./data";
import { getFileStateIcon } from "../ui/lib/fileState";

type FileRowData = Pick<WindowDiffFile, "path"> &
  Partial<Pick<WindowDiffFile, "status" | "untracked" | "additions" | "deletions" | "pending">>;

/** The same filename, status, counts and selection row in Changes and commit proposals. */
export function FileRow({
  file,
  active,
  selected,
  onOpen,
  onSelectionChange,
  commentCount = 0,
  unreadComments = false,
  onOpenComments,
}: {
  file: FileRowData;
  active?: boolean;
  selected?: boolean;
  onOpen?: () => void;
  onSelectionChange?: (checked: boolean) => void;
  commentCount?: number;
  unreadComments?: boolean;
  onOpenComments?: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  const content = (
    <>
      {file.status ? <FileStatusIcon status={file.status} untracked={file.untracked} /> : null}
      <span className="file-name">{file.path.slice(slash + 1)}</span>
    </>
  );
  return (
    <div className={`file-row ${file.status ?? ""}`} data-active={active} data-selected={selected}>
      {onOpen ? (
        <button
          className="file-open"
          type="button"
          title={`${file.path}${file.untracked ? " (untracked)" : file.status ? ` (${file.status})` : ""}`}
          aria-current={active ? "location" : undefined}
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div className="file-open" title={file.path}>
          {content}
        </div>
      )}
      <span className="file-dir">{slash > 0 ? file.path.slice(0, slash) : ""}</span>
      {commentCount > 0 && onOpenComments ? (
        <button
          type="button"
          className="file-comment-badge"
          data-unread={unreadComments}
          onClick={onOpenComments}
          aria-label={`${commentCount} comment threads in ${file.path}${unreadComments ? ", new replies" : ""}`}
          title={unreadComments ? "Open new reply" : "Open comments"}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path d="M3 2.5h10v8H7l-4 3z" />
          </svg>
          {commentCount}
        </button>
      ) : null}
      {!file.untracked && file.additions !== undefined && file.deletions !== undefined ? (
        <span className="stat">
          <span className="add">+{file.additions}</span>{" "}
          <span className="del">−{file.deletions}</span>
        </span>
      ) : null}
      {onSelectionChange ? (
        <input
          className="file-select"
          type="checkbox"
          aria-label={`Select ${file.path}`}
          checked={selected ?? false}
          disabled={file.pending === false}
          title={file.pending === false ? "Already committed on this branch" : undefined}
          onChange={(event) => onSelectionChange(event.target.checked)}
        />
      ) : null}
    </div>
  );
}

/** Square vector geometry keeps status symbols independent of the active font. */
function FileStatusIcon({
  status,
  untracked = false,
}: {
  status: WindowDiffFile["status"];
  untracked?: boolean;
}) {
  const labels = { added: "Added", deleted: "Deleted", renamed: "Renamed", modified: "Modified" };
  const changeTypes = {
    added: "new",
    deleted: "deleted",
    renamed: "rename-changed",
    modified: "change",
  } as const;
  const { color } = getFileStateIcon(
    { changeType: changeTypes[status], isUntracked: untracked },
    {
      fileUntracked: "var(--muted)",
      fileNew: "var(--add)",
      fileDeleted: "var(--del)",
      fileRenamed: "var(--accent)",
      fileModified: "var(--modified)",
      text: "var(--text)",
    },
  );
  return (
    <svg
      className={`file-status ${status}`}
      role="img"
      aria-label={untracked ? "Untracked" : labels[status]}
      style={{ color }}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {untracked || status === "modified" ? (
        <circle cx="8" cy="8" r="5" />
      ) : status === "added" ? (
        <path d="M8 3v10M3 8h10" />
      ) : status === "deleted" ? (
        <path d="M3 8h10" />
      ) : (
        <path d="M3 8h10M9 4l4 4-4 4" />
      )}
    </svg>
  );
}
