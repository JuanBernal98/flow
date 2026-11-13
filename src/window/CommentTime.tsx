/** @jsxImportSource react */
import { useEffect, useState } from "react";

/** Keep a message's relative age current without rerendering its file diff. */
export function CommentTime({ createdAt }: { createdAt: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  const age = unit === "minute" ? minutes : Math.floor(minutes / (unit === "hour" ? 60 : 1440));
  const label =
    minutes === 0
      ? "Just now"
      : new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-age, unit);
  return (
    <time className="thread-date" dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
      {label}
    </time>
  );
}
