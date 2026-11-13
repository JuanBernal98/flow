/** @jsxImportSource react */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CommentThread } from "./CommentThread";
import { CommentEditor } from "./CommentEditor";
import { groupFileComments } from "./fileComments";
import type { PersistedComment } from "../core/comments";

const comment: PersistedComment = {
  id: 1,
  file: "a.ts",
  line: 2,
  range: [1, 2],
  anchor: "0000000000000000",
  body: "Review this",
};

test("comment bubbles show names and saved dates without avatars or action labels", () => {
  const html = renderToStaticMarkup(
    <CommentThread
      userName="Alex"
      editor={
        <CommentEditor active={false} onSave={() => {}} onCancel={() => {}} onActivate={() => {}} />
      }
      comments={[
        {
          ...comment,
          replies: [
            {
              author: "agent",
              agentName: "Codex",
              body: "Fixed",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ]}
    />,
  );
  expect(html).toContain("Alex");
  expect(html).toContain("Codex");
  expect(html).toContain("Just now");
  expect(html.match(/<time /g)).toHaveLength(1);
  expect(html).not.toContain("thread-header");
  expect(html).not.toContain('class="avatar"');
  expect(html).not.toContain("thread-action");
  expect(html).toContain("Leave a comment…");
});

test("reply updates preserve unrelated file groups, while removing a thread clears its group", () => {
  const other = { ...comment, id: 2, file: "b.ts" };
  const previous = groupFileComments([comment, other], new Map());
  const next = groupFileComments(
    [{ ...comment, replies: [{ author: "agent", body: "Fixed" }] }, { ...other }],
    previous,
  );
  expect(next.get("b.ts")).toBe(previous.get("b.ts"));
  expect(next.get("a.ts")).not.toBe(previous.get("a.ts"));
  expect(groupFileComments([other], next).has("a.ts")).toBe(false);
});
