/** @jsxImportSource react */
import type { CommitProposal } from "../core/commitProposal";
import type { WindowDiffFile } from "./data";
import { FileRow } from "./FileRow";
import { CommitActionButton } from "./CommitActionButton";
import { useEffect, useState } from "react";
import type { CommitActivity } from "./useCommitProposal";

interface CommitProposalPanelProps {
  proposal: CommitProposal | null;
  pending: boolean;
  error: string | null;
  onApprove: (commits: readonly number[]) => void;
  files?: readonly WindowDiffFile[];
  onOpenFile?: (path: string) => void;
  onPropose?: () => void;
  activity?: CommitActivity;
}

/** A focused review of the exact messages and file groups the user is about to commit. */
export function CommitProposalPanel({
  proposal,
  pending,
  error,
  onApprove,
  files = [],
  onOpenFile,
  onPropose,
  activity,
}: CommitProposalPanelProps) {
  const status = proposal?.status;
  const waiting =
    activity === "proposing" || (!status && pending && !error) || status === "preparing";
  const running = activity === "committing" || status === "approved" || status === "executing";
  const commits = proposal?.plan?.commits ?? [];
  const [selectedCommits, setSelectedCommits] = useState<ReadonlySet<number>>(
    () => new Set(proposal?.approvedCommits ?? commits.map((_, index) => index)),
  );
  useEffect(() => {
    setSelectedCommits(
      new Set(proposal?.approvedCommits ?? proposal?.plan?.commits.map((_, index) => index) ?? []),
    );
  }, [proposal?.id, proposal?.plan, proposal?.approvedCommits]);
  return (
    <section
      className="commit-panel"
      role="tabpanel"
      id="commit-panel"
      aria-labelledby="commit-tab"
    >
      <div className="commit-panel-body">
        {(!proposal && !pending && !error) || status === "cancelled" || status === "completed" ? (
          <div className="commit-empty" role="status">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v8m-4-4h8" />
            </svg>
            <h3>
              {status === "cancelled" || status === "completed"
                ? "Ready to propose"
                : "No proposal yet"}
            </h3>
            <p>Select files in Changes, then choose Propose.</p>
          </div>
        ) : null}
        {waiting ? (
          <div className="commit-wait" role="status">
            <span className="commit-spinner" aria-hidden="true" />
            <h3>{proposal?.claimedBy ? "Preparing proposal" : "Waiting for your agent"}</h3>
            <p>
              {proposal?.claimedBy
                ? `Grouping ${proposal.snapshot.files.length} files into focused commits.`
                : "Your proposal will appear here when the agent picks up the request."}
            </p>
          </div>
        ) : null}
        {running ? (
          <p className="commit-description" role="status">
            {status === "approved"
              ? "Starting local commits…"
              : `${proposal?.completed ?? 0} of ${proposal?.approvedCommits?.length ?? commits.length} commits created…`}
          </p>
        ) : null}
        {commits.length && !waiting && status !== "cancelled" && status !== "completed" ? (
          <ol className="commit-plan">
            {commits.map((commit, index) => {
              const [subject] = commit.message.split("\n");
              return (
                <li key={`${proposal?.id}:${index}`}>
                  <section
                    className="file-group commit-group"
                    id={`commit-${proposal?.id}-${index}`}
                  >
                    <label className="file-group-heading commit-group-heading">
                      <span className="commit-group-message" title={subject}>
                        {subject}
                      </span>
                      <input
                        className="file-select"
                        type="checkbox"
                        aria-label={`Select ${subject ?? "Commit"}`}
                        checked={selectedCommits.has(index)}
                        disabled={status !== "ready" || pending}
                        onChange={(event) =>
                          setSelectedCommits((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(index);
                            else next.delete(index);
                            return next;
                          })
                        }
                      />
                    </label>
                    <ul className="commit-file-list">
                      {commit.files.map((path) => {
                        const file = files.find((candidate) => candidate.path === path);
                        return (
                          <li key={path}>
                            <FileRow
                              file={file ?? { path }}
                              onOpen={onOpenFile ? () => onOpenFile(path) : undefined}
                            />
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </li>
              );
            })}
          </ol>
        ) : null}
        {error || proposal?.error ? (
          <div className="commit-error" role="alert">
            {error ?? proposal?.error}
            {proposal?.completed ? (
              <p>
                {proposal.completed} commits were created before execution stopped. They have been
                kept.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <footer className="commit-panel-footer">
        <CommitActionButton
          phase={!waiting && (status === "ready" || running) ? "commit" : "propose"}
          label={
            waiting
              ? "Proposing…"
              : pending
                ? status === "ready" || running
                  ? "Committing…"
                  : "Sending…"
                : status === "ready"
                  ? "Commit"
                  : running
                    ? "Committing…"
                    : "Propose"
          }
          loading={waiting || running || (pending && status === "ready")}
          disabled={pending || (status === "ready" && selectedCommits.size === 0)}
          onClick={
            status === "ready"
              ? () => onApprove([...selectedCommits].sort((left, right) => left - right))
              : onPropose
          }
        />
      </footer>
    </section>
  );
}
