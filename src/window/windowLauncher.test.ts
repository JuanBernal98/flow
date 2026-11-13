import { expect, test } from "bun:test";
import { ChildProcess, type SpawnOptions } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { launchWindowHost } from "./windowLauncher";

test("desktop launches detach from the terminal and release the launcher", async () => {
  const child = new ChildProcess();
  let unreferenced = false;
  child.unref = () => {
    unreferenced = true;
  };
  let options: SpawnOptions | undefined;
  let argumentsPassed: string[] = [];
  const root = join(tmpdir(), "flow-launch-test");
  await launchWindowHost(root, (_command, args, opts) => {
    argumentsPassed = args;
    options = opts;
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  expect(options).toMatchObject({ cwd: root, detached: true, stdio: "ignore", windowsHide: true });
  expect(argumentsPassed.at(-1)).toBe(root);
  expect(unreferenced).toBe(true);
});

test("a failed host launch rejects instead of reporting that the app opened", async () => {
  const child = new ChildProcess();
  await expect(
    launchWindowHost(tmpdir(), () => {
      queueMicrotask(() => child.emit("error", new Error("Runtime unavailable")));
      return child;
    }),
  ).rejects.toThrow("Runtime unavailable");
});
