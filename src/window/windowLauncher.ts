/** Start the desktop host independently of the shell that invoked `flow open`. */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { join } from "node:path";

type HostSpawner = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => Pick<ChildProcess, "once" | "unref">;

/** Detach every console handle and release the launcher once the host process starts. */
export function launchWindowHost(repoRoot: string, spawnHost: HostSpawner = spawn): Promise<void> {
  return new Promise((resolve, reject) => {
    const host = spawnHost(
      process.execPath,
      ["run", join(import.meta.dir, "windowHost.ts"), repoRoot],
      { cwd: repoRoot, detached: true, stdio: "ignore", windowsHide: true },
    );
    host.once("error", reject);
    host.once("spawn", () => {
      host.unref();
      resolve();
    });
  });
}
