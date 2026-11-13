import type { PersistedComment } from "./comments";

/** Derive discussion progress from its latest message and agent claim. */
export function commentThreadState(
  comment: PersistedComment,
): "pending" | "in-progress" | "answered" {
  if ((comment.replies?.at(-1)?.author ?? comment.author ?? "user") === "agent") return "answered";
  return comment.claimedBy ? "in-progress" : "pending";
}

/** Whether the reviewer has not yet seen an agent message in this discussion. */
export function hasUnreadCommentReply(comment: PersistedComment) {
  return (
    (comment.author === "agent" && !comment.readAt) ||
    Boolean(comment.replies?.some((reply) => reply.author === "agent" && !reply.readAt))
  );
}

/** Stable discussion target shared by sidebar navigation and inline messages. */
export function commentAnchor(comment: PersistedComment) {
  return `comment-${comment.threadId ?? comment.id}`;
}

/** Prefer the first unseen agent message when opening a discussion notification. */
export function unreadCommentAnchor(comment: PersistedComment) {
  if (comment.author === "agent" && !comment.readAt) return commentAnchor(comment);
  const index =
    comment.replies?.findIndex((reply) => reply.author === "agent" && !reply.readAt) ?? -1;
  return index < 0 ? commentAnchor(comment) : `${commentAnchor(comment)}-reply-${index}`;
}
