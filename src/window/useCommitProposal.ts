import { useCallback, useEffect, useRef, useState } from "react";
import type { CommitProposal } from "../core/commitProposal";

type CommitApi = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>;

/** Keep the proposal sidebar in sync with agent replies without overlapping polls. */
export function useCommitProposal(api: CommitApi, onCompleted: () => void) {
  const [proposal, setProposal] = useState<CommitProposal | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previous = useRef<CommitProposal | null>(null);
  const previousJSON = useRef("null");
  const mutating = useRef(false);
  const revision = useRef(0);
  const accept = useCallback(
    (next: CommitProposal | null) => {
      const json = JSON.stringify(next);
      if (json === previousJSON.current) return;
      previousJSON.current = json;
      const before = previous.current;
      previous.current = next;
      setProposal(next);
      if (next && (next.id !== before?.id || next.status !== before.status)) {
        if (!before && ["preparing", "ready", "approved", "executing"].includes(next.status))
          setOpen(true);
        if (next.status === "completed") onCompleted();
      }
    },
    [onCompleted],
  );

  useEffect(() => {
    const status = proposal?.status;
    if (
      status !== undefined &&
      status !== "preparing" &&
      status !== "approved" &&
      status !== "executing"
    )
      return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    /** Read the newest state; discard reads overtaken by a local approval or cancellation. */
    async function poll() {
      const currentRevision = revision.current;
      try {
        if (!mutating.current) {
          const next = await api<CommitProposal | null>("/api/commits");
          if (!disposed && currentRevision === revision.current) accept(next);
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        const currentStatus = previous.current?.status;
        if (
          !disposed &&
          (currentStatus === "preparing" ||
            currentStatus === "approved" ||
            currentStatus === "executing")
        )
          timer = setTimeout(poll, 1500);
      }
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, accept, proposal?.status]);

  /** Apply one user action and immediately display its acknowledged state. */
  async function action(path: string, body?: unknown) {
    if (mutating.current) return;
    mutating.current = true;
    revision.current += 1;
    setPending(true);
    setError(null);
    try {
      accept(await api<CommitProposal>(path, { method: "POST", body }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      mutating.current = false;
      setPending(false);
    }
  }

  return {
    proposal,
    open,
    pending,
    error,
    request: (files: readonly string[] = []) => {
      setOpen(true);
      return action("/api/commits", { files, replace: true });
    },
    approve: (commits: readonly number[]) =>
      proposal && action(`/api/commits/${proposal.id}/approve`, { commits }),
    show: () => setOpen(true),
    close: () => setOpen(false),
  };
}
