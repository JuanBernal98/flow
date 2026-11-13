/** @jsxImportSource react */
import type React from "react";
import { useEffect, useRef } from "react";
import type { PersistedComment } from "../core/comments";
import { commentAnchor } from "../core/commentThread";
import { CommentTime } from "./CommentTime";
/** One message with quiet author metadata above its text. */
function ThreadMessage({
  author,
  agentName,
  userName,
  body,
  createdAt,
  id,
  onRead,
}: {
  author: "user" | "agent";
  agentName?: string;
  userName: string;
  body: string;
  createdAt?: string;
  id?: string;
  onRead?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !onRead) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      onRead();
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onRead]);
  const agent = author === "agent";
  return (
    <div className={`thread-message ${author}`} id={id} ref={ref}>
      <div className="thread-meta">
        <span className="thread-author">{agent ? (agentName ?? "Agent") : userName}</span>
        {createdAt ? <CommentTime createdAt={createdAt} /> : null}
      </div>
      <div className="thread-body">{body}</div>
    </div>
  );
}

/** One bubble per annotated line, with consistent message rows and a shared editor. */
export function CommentThread({
  comments,
  userName,
  editor,
  onRead,
}: {
  comments: PersistedComment[];
  userName: string;
  editor: React.ReactNode;
  onRead?: (comment: PersistedComment) => void;
}) {
  return (
    <div className="thread">
      {comments.flatMap((comment) => [
        <ThreadMessage
          key={`${comment.id}`}
          id={commentAnchor(comment)}
          author={comment.author === "agent" ? "agent" : "user"}
          agentName={comment.agentName}
          userName={userName}
          createdAt={comment.createdAt}
          body={comment.body}
          onRead={
            onRead && comment.author === "agent" && !comment.readAt
              ? () => onRead({ ...comment, replies: [] })
              : undefined
          }
        />,
        ...(comment.replies ?? []).map((reply, index) => (
          <ThreadMessage
            key={`${comment.id}-${index}`}
            id={`${commentAnchor(comment)}-reply-${index}`}
            author={reply.author}
            agentName={reply.agentName}
            userName={userName}
            createdAt={reply.createdAt}
            body={reply.body}
            onRead={
              onRead && reply.author === "agent" && !reply.readAt
                ? () => onRead({ ...comment, replies: comment.replies?.slice(0, index + 1) })
                : undefined
            }
          />
        )),
      ])}
      {editor}
    </div>
  );
}
