/**
 * `flow open`: serve the window UI on a private localhost port and show it in a native window.
 * The window runs in its own process because the webview's run loop blocks the event loop that
 * the server needs. Every request must carry a per-launch secret, so other local pages cannot read
 * the workspace.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { findRepoRoot } from "../core/config";
import { FlowUserError } from "../core/errors";
import { loadWindowDiff, loadWindowOverview, loadWindowThemes, loadWindowWorkspace } from "./data";
import page from "./index.html";

/** Serve the window UI for one repository on a random localhost port; the URL carries the secret. */
export function startWindowServer(repoRoot: string) {
  const secret = randomBytes(16).toString("hex");
  const authorized = (request: Request) => request.headers.get("x-flow-secret") === secret;
  const forbidden = () => new Response("forbidden", { status: 403 });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    development: false,
    routes: {
      "/": page,
      "/api/workspace": async (request) =>
        authorized(request) ? Response.json(await loadWindowWorkspace(repoRoot)) : forbidden(),
      "/api/themes": async (request) =>
        authorized(request) ? Response.json(await loadWindowThemes(repoRoot)) : forbidden(),
      "/api/diff": (request) =>
        authorized(request) ? Response.json(loadWindowDiff(repoRoot)) : forbidden(),
      "/api/overview/:id": (request) =>
        authorized(request)
          ? Response.json(loadWindowOverview(repoRoot, request.params.id))
          : forbidden(),
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}/#${secret}` };
}

/** Start the server, open the window, and stop the server once the window closes. */
export async function openFlowWindow(cwd: string) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new FlowUserError("Not inside a git repository.", [
      "`flow open` shows the repository you run it from.",
    ]);
  }
  const { server, url } = startWindowServer(repoRoot);
  const window = Bun.spawn(["bun", "run", join(import.meta.dir, "nativeWindow.ts"), url], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.stdout.write(`flow window open on ${repoRoot}\n`);
  await window.exited;
  await server.stop(true);
}
