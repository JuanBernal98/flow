/**
 * `flow open`: serve the window UI on a private localhost port and show it in a native window.
 * The window runs in its own process because the webview's run loop blocks the event loop that
 * the server needs. Every request must carry a per-launch secret, so other local pages cannot read
 * the workspace.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { z } from "zod";
import { findRepoRoot } from "../core/config";
import { FlowUserError } from "../core/errors";
import {
  addWindowComment,
  loadWindowComments,
  loadWindowDiff,
  loadWindowOverview,
  loadWindowThemes,
  loadWindowUserName,
  loadWindowWorkspace,
  loadWindowLocalWorkspace,
  removeWindowComment,
} from "./data";
import page from "./index.html";
import { readWindowPreferences, saveWindowPreferences } from "./preferenceStore";
import { MIN_DIFF_FONT_SIZE, MAX_DIFF_FONT_SIZE } from "./preferences";
import { launchWindowHost } from "./windowLauncher";
import {
  approveCommitProposal,
  cancelCommitProposal,
  readCommitProposal,
  requestCommitProposal,
} from "../core/commitProposal";
import type { WindowBootstrap } from "./windowBootstrap";

const WindowPreferencesSchema = z.object({
  diffFontSize: z.number().min(MIN_DIFF_FONT_SIZE).max(MAX_DIFF_FONT_SIZE).multipleOf(0.5),
});

/** What the window sends to add a comment. */
const NewCommentSchema = z.object({
  file: z.string().min(1),
  range: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  body: z.string(),
});

/** Serve the window UI for one repository on a random localhost port; the URL carries the secret. */
export function startWindowServer(repoRoot: string) {
  const secret = randomBytes(16).toString("hex");
  const authorized = (request: Request) => request.headers.get("x-flow-secret") === secret;
  const forbidden = () => new Response("forbidden", { status: 403 });
  const themes = loadWindowThemes(repoRoot);

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    development: false,
    routes: {
      "/": page,
      "/api/preferences": {
        GET: (request) =>
          authorized(request) ? Response.json(readWindowPreferences()) : forbidden(),
        PUT: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            const preferences = WindowPreferencesSchema.parse(await request.json());
            return Response.json(saveWindowPreferences(preferences));
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
      },
      "/api/workspace": async (request) =>
        authorized(request) ? Response.json(await loadWindowWorkspace(repoRoot)) : forbidden(),
      "/api/themes": async (request) =>
        authorized(request) ? Response.json(await themes) : forbidden(),
      "/api/me": (request) =>
        authorized(request) ? Response.json({ name: loadWindowUserName(repoRoot) }) : forbidden(),
      "/api/commits": {
        GET: (request) => {
          if (!authorized(request)) return forbidden();
          try {
            return Response.json(readCommitProposal(repoRoot));
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
        POST: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            const input = z
              .object({ files: z.array(z.string()).optional(), replace: z.boolean().optional() })
              .strict()
              .parse(await request.json());
            return Response.json(requestCommitProposal(repoRoot, input.files, input.replace));
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
      },
      "/api/commits/:id/:action": {
        POST: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            if (request.params.action === "approve") {
              const body = await request.text();
              const input = z
                .object({ commits: z.array(z.number().int().nonnegative()).optional() })
                .strict()
                .parse(body ? JSON.parse(body) : {});
              return Response.json(
                approveCommitProposal(repoRoot, request.params.id, input.commits),
              );
            }
            if (request.params.action === "cancel")
              return Response.json(cancelCommitProposal(repoRoot, request.params.id));
            return new Response("Unknown commit action.", { status: 404 });
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
      },
      "/api/comments": {
        GET: (request) =>
          authorized(request) ? Response.json(loadWindowComments(repoRoot)) : forbidden(),
        POST: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            return Response.json(
              addWindowComment(repoRoot, NewCommentSchema.parse(await request.json())),
            );
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
      },
      "/api/comments/:id": {
        DELETE: (request) => {
          if (!authorized(request)) return forbidden();
          removeWindowComment(repoRoot, Number(request.params.id));
          return new Response(null, { status: 204 });
        },
      },
      "/api/diff": (request) => {
        if (!authorized(request)) return forbidden();
        const scope = z
          .enum(["pending", "branch"])
          .safeParse(new URL(request.url).searchParams.get("scope") ?? "pending");
        return scope.success
          ? Response.json(loadWindowDiff(repoRoot, scope.data))
          : new Response("Unknown diff scope.", { status: 400 });
      },
      "/api/overview/:id": (request) =>
        authorized(request)
          ? Response.json(loadWindowOverview(repoRoot, request.params.id))
          : forbidden(),
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}/#${secret}`, themes };
}

/** Return the terminal immediately after launching an independent desktop host. */
export async function openFlowWindow(cwd: string) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot)
    throw new FlowUserError("Not inside a git repository.", [
      "`flow open` shows the repository you run it from.",
    ]);
  await launchWindowHost(repoRoot);
  process.stdout.write(`flow window open on ${repoRoot}\n`);
}

/** Keep the private server alive only for the lifetime of its native window. */
export async function runFlowWindow(cwd: string) {
  const repoRoot = findRepoRoot(cwd);
  if (!repoRoot) {
    throw new FlowUserError("Not inside a git repository.", [
      "`flow open` shows the repository you run it from.",
    ]);
  }
  const { server, url, themes: themesReady } = startWindowServer(repoRoot);
  try {
    // Compile the HTML bundle and prepare local data before a native surface becomes visible.
    const [themes, html] = await Promise.all([themesReady, fetch(new URL("/", url))]);
    if (!html.ok) throw new Error("The desktop interface could not be prepared.");
    await html.text();
    const bootstrap: WindowBootstrap = {
      themes,
      preferences: readWindowPreferences(),
      files: loadWindowDiff(repoRoot),
      comments: loadWindowComments(repoRoot),
      workspace: loadWindowLocalWorkspace(repoRoot),
      userName: loadWindowUserName(repoRoot),
    };
    // On macOS the window runs inside Flow.app, so the Dock shows Flow and its icon, not Bun.
    const runtime =
      process.platform === "darwin"
        ? (await import("./appBundle")).ensureFlowAppBundle()
        : process.execPath;
    const window = spawn(
      runtime,
      ["run", join(import.meta.dir, "nativeWindow.ts"), url, "--bootstrap"],
      {
        stdio: ["pipe", "ignore", "ignore"],
        windowsHide: true,
      },
    );
    window.stdin.end(JSON.stringify(bootstrap));
    const stopWindow = () => {
      window.kill();
    };
    process.once("SIGTERM", stopWindow);
    process.once("SIGINT", stopWindow);
    try {
      const [code] = await once(window, "exit");
      if (code !== 0 && code !== null)
        throw new Error(`The Flow window exited with code ${String(code)}.`);
    } finally {
      process.removeListener("SIGTERM", stopWindow);
      process.removeListener("SIGINT", stopWindow);
      window.kill();
    }
  } finally {
    await server.stop(true);
  }
}
