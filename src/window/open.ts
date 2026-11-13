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
  replyToWindowComment,
  markWindowCommentRead,
} from "./data";
import page from "./index.html";
import { readWindowPreferences, saveWindowPreferences } from "./preferenceStore";
import {
  MIN_DIFF_FONT_SIZE,
  MAX_DIFF_FONT_SIZE,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from "./preferences";
import { launchWindowHost } from "./windowLauncher";
import {
  approveCommitProposal,
  cancelCommitProposal,
  readCommitProposal,
  readCommitProposalAsync,
  requestCommitProposal,
  readCurrentCommitProposal,
  refreshCommitProposal,
  StaleCommitProposalError,
} from "../core/commitProposal";
import type { WindowBootstrap } from "./windowBootstrap";
import { createLiveDiffWatch } from "./liveDiffWatch";
import { createDiffEvents } from "./diffEvents";

const WindowPreferencesSchema = z.object({
  diffFontSize: z.number().min(MIN_DIFF_FONT_SIZE).max(MAX_DIFF_FONT_SIZE).multipleOf(0.5),
  sidebarWidth: z.number().int().min(MIN_SIDEBAR_WIDTH).max(MAX_SIDEBAR_WIDTH).optional(),
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
  const diffWatch = createLiveDiffWatch(repoRoot);

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
      "/api/me": async (request) =>
        authorized(request)
          ? Response.json({ name: await loadWindowUserName(repoRoot) })
          : forbidden(),
      "/api/commits": {
        GET: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            return Response.json(
              readCurrentCommitProposal(repoRoot, await readCommitProposalAsync(repoRoot)),
            );
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
              const approved = approveCommitProposal(repoRoot, request.params.id, input.commits);
              // Git hooks run in a child process so the server can still serve the review UI.
              const execution = Bun.spawn(
                [
                  process.execPath,
                  "run",
                  join(import.meta.dir, "commitExecution.ts"),
                  repoRoot,
                  approved.id,
                ],
                {
                  cwd: repoRoot,
                  windowsHide: true,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "pipe",
                },
              );
              const [errors, exitCode] = await Promise.all([
                new Response(execution.stderr).text(),
                execution.exited,
              ]);
              if (exitCode !== 0)
                throw new Error(errors.trim() || "Local commit execution failed.");
              return Response.json(readCommitProposal(repoRoot));
            }
            if (request.params.action === "cancel")
              return Response.json(cancelCommitProposal(repoRoot, request.params.id));
            return new Response("Unknown commit action.", { status: 404 });
          } catch (error) {
            if (error instanceof StaleCommitProposalError)
              return Response.json(refreshCommitProposal(repoRoot, error.proposalId));
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
        POST: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            const id = z.coerce.number().int().positive().parse(request.params.id);
            const { body } = z
              .object({ body: z.string().trim().min(1) })
              .strict()
              .parse(await request.json());
            replyToWindowComment(repoRoot, id, body);
            return Response.json(loadWindowComments(repoRoot));
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
        DELETE: (request) => {
          if (!authorized(request)) return forbidden();
          removeWindowComment(repoRoot, Number(request.params.id));
          return new Response(null, { status: 204 });
        },
      },
      "/api/comments/:id/read": {
        POST: async (request) => {
          if (!authorized(request)) return forbidden();
          try {
            const id = z.coerce.number().int().positive().parse(request.params.id);
            const { replyCount } = z
              .object({ replyCount: z.number().int().nonnegative() })
              .strict()
              .parse(await request.json());
            markWindowCommentRead(repoRoot, id, replyCount);
            return Response.json(loadWindowComments(repoRoot));
          } catch (error) {
            return new Response(error instanceof Error ? error.message : String(error), {
              status: 400,
            });
          }
        },
      },
      "/api/diff/events": (request) => {
        if (!authorized(request)) return forbidden();
        server.timeout(request, 0);
        return createDiffEvents(diffWatch, request.signal);
      },
      "/api/diff": async (request) => {
        if (!authorized(request)) return forbidden();
        const scope = z
          .enum(["pending", "branch"])
          .safeParse(new URL(request.url).searchParams.get("scope") ?? "pending");
        return scope.success
          ? Response.json(await loadWindowDiff(repoRoot, scope.data))
          : new Response("Unknown diff scope.", { status: 400 });
      },
      "/api/overview/:id": (request) =>
        authorized(request)
          ? Response.json(loadWindowOverview(repoRoot, request.params.id))
          : forbidden(),
    },
  });
  return {
    server,
    url: `http://127.0.0.1:${server.port}/#${secret}`,
    themes,
    closeDiffWatch: () => diffWatch.close(),
  };
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
  const { server, url, themes: themesReady, closeDiffWatch } = startWindowServer(repoRoot);
  try {
    // Compile the HTML bundle and prepare local data before a native surface becomes visible.
    const [themes, html, files, workspace, userName] = await Promise.all([
      themesReady,
      fetch(new URL("/", url)),
      loadWindowDiff(repoRoot),
      loadWindowLocalWorkspace(repoRoot),
      loadWindowUserName(repoRoot),
    ]);
    if (!html.ok) throw new Error("The desktop interface could not be prepared.");
    await html.text();
    const bootstrap: WindowBootstrap = {
      themes,
      preferences: readWindowPreferences(),
      files,
      comments: loadWindowComments(repoRoot),
      workspace,
      userName,
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
    closeDiffWatch();
    await server.stop(true);
  }
}
