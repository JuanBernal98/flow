import { useEffect, useState } from "react";
import { readTicketOverview, type StoredTicketOverview } from "../../core/ticketOverview";

const POLL_INTERVAL_MS = 1_000;

/**
 * Follow one ticket's overview on disk, so the pane updates as soon as the agent writes it. Only
 * polls while the pane is open on a ticket.
 */
export function useTicketOverview(
  repoRoot: string | null,
  ticketId: string | null,
  readOverview: (
    repoRoot: string,
    ticketId: string,
  ) => StoredTicketOverview | null = readTicketOverview,
) {
  const [overview, setOverview] = useState<StoredTicketOverview | null>(null);

  useEffect(() => {
    if (!repoRoot || !ticketId) {
      setOverview(null);
      return;
    }
    // Undefined until the first read, so a ticket without an overview still clears the last one.
    let shownWrittenAt: string | null | undefined;
    const load = () => {
      const next = readOverview(repoRoot, ticketId);
      // `writtenAt` changes with every write, so it is enough to tell a rewrite apart.
      if ((next?.writtenAt ?? null) !== shownWrittenAt) {
        shownWrittenAt = next?.writtenAt ?? null;
        setOverview(next);
      }
    };
    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [repoRoot, ticketId, readOverview]);

  return overview;
}
