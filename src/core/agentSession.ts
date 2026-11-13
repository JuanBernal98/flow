import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readCommentBranch } from "./commentBranch";
import { FLOW_DIR } from "./flowPaths";

const SessionSchema = z.object({
  owner: z.string().min(1),
  agent: z.string().min(1),
  branch: z.string().optional(),
  event: z.string().min(1),
  lastCheckpointAt: z.string().datetime(),
});
export type AgentSession = z.infer<typeof SessionSchema>;

/** Inspect the last observed lifecycle checkpoint, without treating an idle session as connected. */
export function readAgentSession(repoRoot: string): AgentSession | null {
  try {
    return SessionSchema.parse(
      JSON.parse(readFileSync(join(repoRoot, FLOW_DIR, "agent-session.json"), "utf8")),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

/** Record actual hook activity without running a background heartbeat or changing app state. */
export function recordAgentCheckpoint(
  repoRoot: string,
  owner: string,
  agent: string,
  event: string,
  now = new Date(),
) {
  const directory = join(repoRoot, FLOW_DIR);
  mkdirSync(directory, { recursive: true });
  const session: AgentSession = {
    owner,
    agent,
    event,
    branch: readCommentBranch(repoRoot),
    lastCheckpointAt: now.toISOString(),
  };
  const temporary = join(
    directory,
    `.agent-session.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`);
  renameSync(temporary, join(directory, "agent-session.json"));
}
