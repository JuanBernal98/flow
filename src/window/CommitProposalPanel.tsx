/** @jsxImportSource react */
import type { CommitProposal } from "../core/commitProposal";
import type { WindowDiffFile } from "./data";
import { FileAccordion } from "./FileAccordion";
import { FileRow } from "./FileRow";
import { CommitActionButton } from "./CommitActionButton";
import { useEffect, useState } from "react";

interface CommitProposalPanelProps {
  proposal: CommitProposal | null;
  pending: boolean;
  error: string | null;
  onApprove: (commits: readonly number[]) => void;
  files?: readonly WindowDiffFile[];
  onOpenFile?: (path: string) => void;
  onPropose?: () => void;
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
}: CommitProposalPanelProps) {
  const status = proposal?.status;
  const waiting = (!status && pending && !error) || status === "preparing";
  const running = status === "approved" || status === "executing";
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
        {(!proposal && !pending && !error) || status === "cancelled" ? (
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
            <h3>{status === "cancelled" ? "Ready to propose" : "No proposal yet"}</h3>
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
            <p className="commit-hint">You can keep reviewing in Changes.</p>
          </div>
        ) : null}
        {running ? (
          <p className="commit-description" role="status">
            {status === "approved"
              ? "Approved. Waiting for your agent to start…"
              : `${proposal?.completed ?? 0} of ${proposal?.approvedCommits?.length ?? commits.length} commits created…`}
          </p>
        ) : null}
        {status === "completed" ? (
          <p className="commit-description" role="status">
            Changes committed
          </p>
        ) : null}
        {commits.length && status !== "cancelled" ? (
          <ol className="commit-plan">
            {commits.map((commit, index) => {
              const [subject, ...body] = commit.message.split("\n");
              return (
                <li key={`${proposal?.id}:${index}`}>
                  <FileAccordion
                    id={`commit-${proposal?.id}-${index}`}
                    path={subject ?? "Commit"}
                    selected={selectedCommits.has(index)}
                    selectionDisabled={status !== "ready" || pending}
                    onSelectionChange={(checked) =>
                      setSelectedCommits((current) => {
                        const next = new Set(current);
                        if (checked) next.add(index);
                        else next.delete(index);
                        return next;
                      })
                    }
                    header={
                      <>
                        <span className="file-header-label" title={subject}>
                          {subject}
                        </span>
                        {commit.kind === "fixup" ? (
                          <span className="commit-kind">Fixup</span>
                        ) : null}
                        <span className="commit-group-count">
                          {commit.files.length} {commit.files.length === 1 ? "file" : "files"}
                        </span>
                      </>
                    }
                  >
                    {body.join("\n").trim() ? (
                      <p className="commit-message-body">{body.join("\n").trim()}</p>
                    ) : null}
                    {commit.kind === "fixup" ? (
                      <p className="commit-target">
                        Fold into {commit.target.slice(0, 8)} · rewrites local history
                      </p>
                    ) : null}
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
                  </FileAccordion>
                </li>
              );
            })}
          </ol>
        ) : null}
        {status === "completed" && proposal?.result ? (
          <pre className="commit-result">{proposal.result}</pre>
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
          phase={status === "ready" || running ? "commit" : "propose"}
          label={
            pending
              ? "Sending…"
              : waiting
                ? "Proposing…"
                : status === "ready"
                  ? "Commit"
                  : running
                    ? "Committing…"
                    : "Propose"
          }
          loading={waiting || running}
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
