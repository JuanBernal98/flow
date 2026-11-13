/** Detached owner of one window and its private HTTP server. */
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFlowWindow } from "./open";

try {
  await runFlowWindow(process.argv[2] ?? process.cwd());
} catch (error) {
  appendFileSync(
    join(tmpdir(), "flow-window.log"),
    `${new Date().toISOString()} ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
