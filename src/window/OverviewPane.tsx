/** @jsxImportSource react */
import { useEffect, useState } from "react";
import type { StoredTicketOverview } from "../core/ticketOverview";
import type { WorkspaceItem } from "../ui/lib/workspace";

/** Load only the selected ticket's overview; superseded responses cannot update the pane or its notice. */
export function OverviewPane({
  item,
  api,
  onError,
}: {
  item: WorkspaceItem | null;
  api: <T>(path: string) => Promise<T>;
  onError: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState<{
    ticketId: string;
    value: StoredTicketOverview | null;
  } | null>(null);
  const ticketId = item?.ticketId;
  useEffect(() => {
    setLoaded(null);
    if (!ticketId) return;
    let active = true;
    void api<StoredTicketOverview | null>(`/api/overview/${ticketId}`)
      .then((value) => {
        if (active) setLoaded({ ticketId, value });
      })
      .catch((error: unknown) => {
        if (active) onError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [api, ticketId, onError]);
  const stored = loaded?.ticketId === ticketId ? loaded?.value : undefined;

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
