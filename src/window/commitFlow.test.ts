import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanupTestTicketRepos, createTestTicketRepo, gitTest } from "../../test/helpers/git-repo";
import { startWindowServer } from "./open";
import type { CommitProposal } from "../core/commitProposal";

afterEach(cleanupTestTicketRepos);

test("desktop HTTP and agent CLI exchange a proposal, reject stale approval and execute the approved request", async () => {
  const { work } = createTestTicketRepo();
  gitTest(work, ["switch", "-c", "PROJ-42-window"]);
  writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
  const { server, url } = startWindowServer(work);
  const address = new URL(url);
  const headers = { "x-flow-secret": address.hash.slice(1) };
  /** Use the exact public command contract in a separate agent process. */
  function agent(args: string[], input?: string) {
    return Bun.spawnSync(
      [process.execPath, "run", resolve(import.meta.dir, "../main.tsx"), "--", "commits", ...args],
      {
        cwd: work,
        windowsHide: true,
        stdin: input ? Buffer.from(input) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  }
  try {
    expect((await fetch(`${address.origin}/api/commits`, { method: "POST" })).status).toBe(403);
    const response = await fetch(`${address.origin}/api/commits`, {
      method: "POST",
      headers,
      body: JSON.stringify({ files: ["app.ts"] }),
    });
    expect(response.status).toBe(200);
    const proposal = (await response.json()) as CommitProposal;
    expect(proposal.status).toBe("preparing");
    expect(agent(["execute", proposal.id]).exitCode).not.toBe(0);
    expect(agent(["claim", proposal.id, "Test agent"]).exitCode).toBe(0);
    const publish = agent(
      ["propose", proposal.id],
      JSON.stringify({
        agentName: "Test agent",
        commits: [
          { kind: "commit", message: "fix: retain the corrected value", files: ["app.ts"] },
        ],
      }),
    );
    expect(publish.stderr.toString()).toBe("");
    expect(publish.exitCode).toBe(0);
    const current = (await (
      await fetch(`${address.origin}/api/commits`, { headers })
    ).json()) as CommitProposal;
    expect(current.status).toBe("ready");
    expect(current.claimedBy).toBe("Test agent");
    writeFileSync(join(work, "app.ts"), "export const value = 3;\n");
    const stale = await fetch(`${address.origin}/api/commits/${proposal.id}/approve`, {
      method: "POST",
      headers,
    });
    expect(stale.status).toBe(400);
    expect(await stale.text()).toContain("repository changed");
    writeFileSync(join(work, "app.ts"), "export const value = 2;\n");
    expect(
      (
        await fetch(`${address.origin}/api/commits/${proposal.id}/approve`, {
          method: "POST",
          headers,
          body: JSON.stringify({ commits: [0] }),
        })
      ).status,
    ).toBe(200);
    const executed = agent(["execute", proposal.id]);
    expect(executed.stderr.toString()).toBe("");
    expect(executed.exitCode).toBe(0);
    const completed = (await (
      await fetch(`${address.origin}/api/commits`, { headers })
    ).json()) as CommitProposal;
    expect(completed).toMatchObject({ status: "completed", completed: 1 });
    expect(completed.result).toContain("fix: retain the corrected value");
    expect(agent(["execute", proposal.id]).exitCode).not.toBe(0);
  } finally {
    await server.stop(true);
  }
}, 30_000);
