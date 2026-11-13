import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveCodexSetupPaths } from "./codexSetup";
import { readCommentBranch } from "./commentBranch";
import { readAgentRequests } from "./agentRequestStore";
import { readAgentSession } from "./agentSession";

const HooksSchema = z.object({
  hooks: z
    .record(
      z.string(),
      z.array(
        z.object({
          hooks: z
            .array(
              z.object({ command: z.string().optional(), commandWindows: z.string().optional() }),
            )
            .optional(),
        }),
      ),
    )
    .optional(),
});

/** Check installed hook coverage without printing commands that may contain private environment data. */
function inspectHooks(path: string, events: readonly string[], marker: string) {
  try {
    const settings = HooksSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    const installed = events.filter((event) =>
      settings.hooks?.[event]?.some((group) =>
        group.hooks?.some(
          (hook) => hook.command?.includes(marker) || hook.commandWindows?.includes(marker),
        ),
      ),
    );
    return {
      path,
      installed,
      missing: events.filter((event) => !installed.includes(event)),
      error: null,
    };
  } catch (error) {
    return {
      path,
      installed: [] as string[],
      missing: [...events],
      error:
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? null
          : "Hook settings are invalid or unreadable.",
    };
  }
}

/** Diagnose delivery, acknowledgements and actual lifecycle activity without changing any files. */
export function inspectAgentCommunication(
  repoRoot: string,
  options: { codexDir?: string; claudeDir?: string; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const codex = inspectHooks(
    join(options.codexDir ?? resolveCodexSetupPaths().codexDir, "hooks.json"),
    ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"],
    "hook codex",
  );
  const claude = inspectHooks(
    join(options.claudeDir ?? join(homedir(), ".claude"), "settings.json"),
    ["SessionStart"],
    "hook session-start",
  );
  const issues: string[] = [];
  let session: ReturnType<typeof readAgentSession> = null;
  let requests: ReturnType<typeof readAgentRequests> = [];
  try {
    session = readAgentSession(repoRoot);
  } catch {
    issues.push("The last agent checkpoint is unreadable.");
  }
  try {
    requests = readAgentRequests(repoRoot);
  } catch {
    issues.push("The request queue is invalid; repair it before sending more work.");
  }
  const branch = readCommentBranch(repoRoot) ?? null;
  const pending = requests
    .filter(
      (request) =>
        (!request.branch || request.branch === branch) &&
        (request.status === "queued" || request.status === "claimed"),
    )
    .map((request) => {
      const ageSeconds = Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(request.claimedAt ?? request.createdAt)) / 1000),
      );
      const matchingSession =
        request.sessionId && request.sessionId === session?.owner ? session : null;
      const lastActivityAt =
        matchingSession?.lastCheckpointAt ?? request.claimedAt ?? request.createdAt;
      const stale =
        now.getTime() - Date.parse(lastActivityAt) >
        (request.status === "queued" ? 60_000 : 300_000);
      if (stale)
        issues.push(
          request.status === "queued"
            ? `Request ${request.id} has not been picked up (${ageSeconds}s).`
            : `Request ${request.id} has no recent checkpoint from its owning session.`,
        );
      return { ...request, ageSeconds, lastActivityAt, stale };
    });
  if (!codex.installed.length && !claude.installed.length)
    issues.push("No Flow lifecycle hooks found. Run flow setup codex or flow setup claude.");
  if (codex.installed.length && codex.missing.length)
    issues.push(`Codex hooks are missing: ${codex.missing.join(", ")}. Run flow setup codex.`);
  if (codex.error) issues.push(codex.error);
  if (claude.error) issues.push(claude.error);
  if (!session) issues.push("No agent checkpoint has been observed in this repository.");
  return { branch, session, hooks: { codex, claude }, pending, issues };
}

/** Render observable facts rather than an inferred online badge. */
export function renderAgentDoctor(report: ReturnType<typeof inspectAgentCommunication>) {
  return [
    `Flow communication · ${report.branch ?? "unknown branch"}`,
    report.session
      ? `Last checkpoint: ${report.session.agent} · ${report.session.event} · ${report.session.lastCheckpointAt}`
      : "Last checkpoint: none observed",
    `Hooks: Codex ${report.hooks.codex.installed.length}/4 · Claude ${report.hooks.claude.installed.length}/1`,
    `Pending requests: ${report.pending.length}`,
    ...report.pending.map(
      (request) =>
        `  ${request.id} · ${request.type} · ${request.status}${request.claimedBy ? ` by ${request.claimedBy}` : ""} · ${request.ageSeconds}s${request.stale ? " · no recent activity" : ""}`,
    ),
    ...report.issues.map((issue) => `! ${issue}`),
    "",
  ].join("\n");
}
