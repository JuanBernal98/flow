/**
 * Walk the user through what `flow setup` found missing, one item at a time. Nothing is run
 * without showing the exact command and asking first; the default answer is no, and declining stops
 * setup before it installs anything. What only the user can do (connecting claude.ai connectors) is
 * explained, and setup checks again when they say they are done.
 */
import type { SetupCheck } from "./setupChecks";
import { youTrackKeychainService } from "./youtrack";

export interface RemedyIo {
  say: (line: string) => void;
  /** Ask a yes/no question; anything but yes is no. */
  confirm: (question: string) => Promise<boolean>;
  /** Wait for Enter (check again) or `q` (stop). */
  waitForRecheck: () => Promise<boolean>;
  /** Run a command in the user's terminal, output and prompts included; returns its exit code. */
  runInteractive: (command: string[]) => Promise<number>;
  /**
   * The YouTrack URL: the remembered one, else asked once and remembered for `flow init`.
   * Undefined when the user stops instead of answering.
   */
  youTrackUrl: () => Promise<string | undefined>;
  /** Open a page in the user's browser. */
  openUrl: (url: string) => void;
  checkYouTrack: (
    url: string,
  ) => Promise<{ ok: true; login: string } | { ok: false; message: string }>;
  /** Whether Claude Code already has an MCP server named `youtrack`, connected or not. */
  hasYouTrackMcpEntry: () => Promise<boolean>;
  /** Add (replacing any old entry) the YouTrack MCP with the stored token; the token is never shown. */
  addYouTrackMcp: (url: string, replace: boolean) => Promise<{ ok: boolean; output: string }>;
}

/** Fix the first failing check with the user's consent, re-check, and repeat until done or stopped. */
export async function resolveMissingDependencies(
  runChecks: () => Promise<SetupCheck[]>,
  io: RemedyIo,
): Promise<SetupCheck[]> {
  let checks = await runChecks();
  for (;;) {
    const failing = checks.find((check) => check.status === "fail");
    if (!failing?.remedy) {
      return checks;
    }
    io.say("");
    io.say(`✗ ${failing.name}${failing.detail ? ` — ${failing.detail}` : ""}`);
    const remedy = failing.remedy;

    if (remedy.kind === "run") {
      io.say(`  flow can fix this by running: ${remedy.command.join(" ")}`);
      if (!(await io.confirm("  Run it now?"))) {
        return checks;
      }
      const exitCode = await io.runInteractive(remedy.command);
      if (exitCode !== 0) {
        io.say(`  That exited with code ${exitCode}; checking again.`);
      }
    } else if (remedy.kind === "manual") {
      io.say(`  ${remedy.steps}`);
      if (!(await io.waitForRecheck())) {
        return checks;
      }
    } else if (remedy.kind === "youtrack-token") {
      const url = await io.youTrackUrl();
      if (!url) {
        return checks;
      }
      const tokenPage = `${url}/users/me?tab=account-security`;
      io.say(
        `  Create a permanent token with the YouTrack scope on your profile page: ${tokenPage}`,
      );
      io.say("  (Profile → Account Security → Tokens → New token.)");
      if (await io.confirm("  Open that page in your browser?")) {
        io.openUrl(tokenPage);
      }
      if (!remedy.keychainAccount) {
        io.say(
          `  Then export FLOW_YOUTRACK_URL=${url} and FLOW_YOUTRACK_TOKEN=<token> in your shell profile, and open a new terminal.`,
        );
        if (!(await io.waitForRecheck())) {
          return checks;
        }
      } else {
        // Stored under its server, the token can never be handed to any other host.
        const store = [
          "security",
          "add-generic-password",
          "-U",
          "-a",
          remedy.keychainAccount,
          "-s",
          youTrackKeychainService(new URL(url).host),
          "-w",
        ];
        io.say(`  flow can store it by running: ${store.join(" ")}`);
        io.say(
          "  It asks for the token without showing it and keeps it in your Keychain, for this server only.",
        );
        if (!(await io.confirm("  Run it now?"))) {
          return checks;
        }
        const exitCode = await io.runInteractive(store);
        if (exitCode !== 0) {
          io.say(`  That exited with code ${exitCode}; checking again.`);
        }
      }
    } else {
      io.say(
        "  flow can add YouTrack's MCP server to Claude Code, using the token you stored for flow.",
      );
      const url = await io.youTrackUrl();
      if (!url) {
        return checks;
      }
      const access = await io.checkYouTrack(url);
      if (!access.ok) {
        io.say(`  ${access.message}; checking again.`);
        checks = await runChecks();
        continue;
      }
      const replace = await io.hasYouTrackMcpEntry();
      const commands = [
        ...(replace ? ["claude mcp remove youtrack -s user"] : []),
        `claude mcp add --transport http -s user youtrack ${url}/mcp --header "Authorization: Bearer ••••"`,
      ];
      io.say(`  It will run (the token is read from your Keychain and never shown):`);
      for (const command of commands) io.say(`    ${command}`);
      if (!(await io.confirm("  Run it now?"))) {
        return checks;
      }
      const added = await io.addYouTrackMcp(url, replace);
      if (added.output) io.say(`  ${added.output}`);
    }
    checks = await runChecks();
  }
}
