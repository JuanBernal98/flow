import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo } from "../../test/helpers/git-repo";
import { startWindowServer } from "./open";
import { readCommentsFile, mutateCommentsFile, withCommentReply } from "../core/comments";
import { loadWindowComments } from "./data";

afterEach(cleanupTestTicketRepos);

test("desktop follow-ups persist in their original discussion and preserve agent messages", async () => {
  const { work } = createTestTicketRepo();
  writeFileSync(join(work, "a.ts"), "export const a = 1;\n");
  const { server, url } = startWindowServer(work);
  const address = new URL(url);
  const headers = { "x-flow-secret": address.hash.slice(1) };
  try {
    const added = await fetch(`${address.origin}/api/comments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ file: "a.ts", range: [1, 1], body: "Simplify?" }),
    });
    expect(added.status).toBe(200);
    const original = readCommentsFile(work).comments[0]!;
    mutateCommentsFile(work, (file) => withCommentReply(file, original.id, "Done", "Codex"));
    const path = `${address.origin}/api/comments/${original.id}`;
    expect(
      (await fetch(path, { method: "POST", body: JSON.stringify({ body: "More?" }) })).status,
    ).toBe(403);
    expect(
      (await fetch(path, { method: "POST", headers, body: JSON.stringify({ body: "  " }) })).status,
    ).toBe(400);
    expect(
      (await fetch(path, { method: "POST", headers, body: JSON.stringify({ body: "More?" }) }))
        .status,
    ).toBe(200);
    const saved = readCommentsFile(work);
    expect(saved.comments).toHaveLength(1);
    expect(saved.comments[0]).toMatchObject({
      id: original.id,
      threadId: original.threadId,
      anchor: original.anchor,
      replies: [
        { author: "agent", body: "Done" },
        { author: "user", body: "More?" },
      ],
    });
    const receipt = await fetch(`${path}/read`, {
      method: "POST",
      headers,
      body: JSON.stringify({ replyCount: 1 }),
    });
    expect(receipt.status).toBe(200);
    expect(readCommentsFile(work).comments[0]!.replies?.[0]?.readAt).toBeDefined();
    writeFileSync(join(work, "a.ts"), "export const completelyChanged = true;\n");
    expect(loadWindowComments(work)).toEqual([]);
    expect(readCommentsFile(work).comments).toHaveLength(1);
    expect(
      (
        await fetch(`${address.origin}/api/comments/999`, {
          method: "POST",
          headers,
          body: JSON.stringify({ body: "More?" }),
        })
      ).status,
    ).toBe(400);
  } finally {
    await server.stop(true);
  }
});
