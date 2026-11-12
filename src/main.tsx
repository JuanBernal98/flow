#!/usr/bin/env bun

import { formatCliError } from "./core/errors";
import type { JobControlInterruptSupport, JobControlSuspendSupport } from "./core/jobControl";
import { prepareStartupPlan } from "./core/startup";

async function main() {
  const startupPlan = await prepareStartupPlan();

  if (startupPlan.kind === "help") {
    process.stdout.write(startupPlan.text);
    process.exit(0);
  }

  if (startupPlan.kind === "agent-watch") {
    // Long-running but UI-free: keep it off the renderer path like the other agent commands.
    const [{ findRepoRoot }, { runAgentWatch }, { FlowUserError }] = await Promise.all([
      import("./core/config"),
      import("./core/agentWatch"),
      import("./core/errors"),
    ]);
    const repoRoot = findRepoRoot(process.cwd());
    if (!repoRoot) {
      throw new FlowUserError("Not inside a git repository.", [
        "`flow watch` follows `.flow/` at the repo root; run it from inside a checkout.",
      ]);
    }
    await runAgentWatch(repoRoot);
    process.exit(0);
  }

  if (startupPlan.kind === "plain-text-pager") {
    const { pagePlainText } = await import("./core/pager");
    await pagePlainText(startupPlan.text);
    process.exit(0);
  }

  if (startupPlan.kind === "passthrough") {
    // Captured non-TTY pipe we can't usefully render in: echo the patch back
    // verbatim so the host's pager pipeline keeps working. (UTF-8 text — the
    // same assumption as the plain-text pager path.)
    await Bun.write(Bun.stdout, startupPlan.text);
    process.exit(0);
  }

  if (startupPlan.kind === "static-diff-pager") {
    const { renderStaticDiffPager } = await import("./ui/staticDiffPager");
    // Bun.write drains before resolving, so the full diff reaches the host
    // before exit (process.exit would otherwise truncate a large diff).
    await Bun.write(Bun.stdout, renderStaticDiffPager(startupPlan.bootstrap));
    process.exit(0);
  }

  if (startupPlan.kind !== "app") {
    throw new Error("Unreachable startup plan.");
  }

  // Keep app-only modules behind the app startup branch so help, version,
  // and comments commands stay on the cold path.
  // Import @opentui/core before React bindings; those modules read core
  // exports during initialization.
  const { createCliRenderer } = await import("@opentui/core");
  const [
    { createRoot },
    { shutdownSession },
    jobControl,
    { shouldUseMouseForApp },
    { loadYouTrackTasks, moveMergedTicket, youTrackIssueUrl },
    { createGlabRun, loadMyMergeRequests, loadSquadReviews },
    { findRepoRoot },
    { readRepoIntegrations, hasWorkspaceIntegrations },
    { AppHost },
  ] = await Promise.all([
    import("@opentui/react"),
    import("./core/shutdown"),
    import("./core/jobControl"),
    import("./core/terminal"),
    import("./core/youtrack"),
    import("./core/gitlab"),
    import("./core/config"),
    import("./core/repoIntegrations"),
    import("./ui/AppHost"),
  ]);

  const { bootstrap, controllingTerminal } = startupPlan;

  const renderer = await createCliRenderer({
    stdin: controllingTerminal?.stdin,
    stdout: process.stdout,
    useMouse: shouldUseMouseForApp({
      hasControllingTerminal: Boolean(controllingTerminal),
    }),
    screenMode: "alternate-screen",
    // flow routes every key itself and focuses inputs explicitly. OpenTUI's click-to-focus would
    // hand a clicked scroll box the arrow keys too, so the diff scrolled while you moved through
    // tickets after clicking it.
    autoFocus: false,
    // Ctrl-C is routed through the job-control interrupt handler below so it
    // runs flow's ordered shutdown instead of OpenTUI's hard exit.
    exitOnCtrlC: false,
    openConsoleOnError: true,
    onDestroy: () => controllingTerminal?.close(),
  });

  const root = createRoot(renderer);
  const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  let shuttingDown = false;
  let jobControlSuspendSupport: JobControlSuspendSupport = { dispose: () => undefined };
  let jobControlInterruptSupport: JobControlInterruptSupport = { dispose: () => undefined };

  /** Tear down the renderer before exit so the primary terminal screen comes back cleanly. */
  function shutdown() {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const signal of shutdownSignals) {
      process.off(signal, shutdown);
    }
    jobControlInterruptSupport.dispose();
    jobControlSuspendSupport.dispose();
    shutdownSession({ root, renderer });
  }

  for (const signal of shutdownSignals) {
    process.once(signal, shutdown);
  }
  jobControlInterruptSupport = jobControl.installJobControlInterruptSupport(renderer, shutdown);
  jobControlSuspendSupport = jobControl.installJobControlSuspendSupport(renderer);

  // Each repository decides what it connects to in its own `.flow/config.toml`; one without
  // integrations gets no loaders, so flow makes no YouTrack or GitLab calls there.
  const integrations = readRepoIntegrations(findRepoRoot(process.cwd()));
  // After a `git pull` that adds or renames skills, Claude Code's stubs lag behind until setup runs.
  const [{ claudeSetupIsStale, resolveClaudeDir }, { BUNDLED_SKILLS }] = await Promise.all([
    import("./core/claudeSetup"),
    import("./core/cli"),
  ]);
  // A broken repository config is the more urgent note: without it the workspace stays empty.
  const startupNotice = integrations.error
    ? `.flow/config.toml is broken, so flow ignored it: ${integrations.error}`
    : claudeSetupIsStale(resolveClaudeDir(), BUNDLED_SKILLS)
      ? "flow changed: run `flow setup` to refresh Claude Code"
      : undefined;
  const youtrackUrl = integrations.youtrackUrl;
  const mergedState = integrations.mergedState;

  // The app owns the full alternate screen session from this point on.
  root.render(
    <AppHost
      bootstrap={bootstrap}
      onQuit={shutdown}
      workspaceConnected={hasWorkspaceIntegrations(integrations)}
      workspaceTasksLoader={youtrackUrl ? () => loadYouTrackTasks({ url: youtrackUrl }) : undefined}
      issueUrl={youtrackUrl ? (ticketId) => youTrackIssueUrl(youtrackUrl, ticketId) : undefined}
      projectKeys={integrations.projectKeys}
      startupNotice={startupNotice}
      closeMergedTicket={
        youtrackUrl && mergedState
          ? (ticketId) => moveMergedTicket(ticketId, mergedState, { url: youtrackUrl })
          : undefined
      }
      loadMergeRequests={
        integrations.gitlab ? (repoRoot) => loadMyMergeRequests(createGlabRun(repoRoot)) : undefined
      }
      loadReviews={
        integrations.gitlab
          ? (repoRoot) =>
              loadSquadReviews(createGlabRun(repoRoot), { label: integrations.reviewLabel })
          : undefined
      }
    />,
  );
}

await main().catch((error) => {
  process.stderr.write(formatCliError(error));
  process.exit(1);
});
