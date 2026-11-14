import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const browser = process.env.FLOW_TEST_BROWSER;

test.skipIf(!browser)(
  "desktop data refreshes preserve files and serialize slow comment reads",
  async () => {
    const bundle = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../../test/helpers/window-data-browser.tsx")],
      target: "browser",
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const script = await bundle.outputs[0]!.text();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/fixture.js")
          return new Response(script, { headers: { "content-type": "text/javascript" } });
        // The fixture controls refreshes through scope changes and exercises stream reconnection.
        if (path === "/api/diff/events") return new Response(null, { status: 503 });
        return new Response(
          '<div id="root"></div><script type="module" src="/fixture.js"></script>',
          {
            headers: { "content-type": "text/html" },
          },
        );
      },
    });
    const profile = mkdtempSync(join(tmpdir(), "flow-data-browser-"));
    if (
      !resolve(profile).startsWith(resolve(tmpdir()) + "/") &&
      !resolve(profile).startsWith(resolve(tmpdir()) + "\\")
    )
      throw new Error("Browser profile must remain inside the temporary directory.");
    try {
      const child = Bun.spawn(
        [
          browser!,
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          `--user-data-dir=${profile}`,
          "--virtual-time-budget=3000",
          "--dump-dom",
          `http://127.0.0.1:${server.port}`,
        ],
        {
          windowsHide: true,
          stdout: "pipe",
          stderr: "pipe",
          timeout: 25_000,
        },
      );
      const [output, errors, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit, errors).toBe(0);
      const result = /<pre id="data-result">([^<]+)<\/pre>/.exec(output)?.[1];
      expect(result, output.slice(-1500)).toBeDefined();
      expect(
        z
          .object({
            identical: z.boolean(),
            independent: z.boolean(),
            maxReads: z.number(),
            reads: z.number(),
            comments: z.number(),
            errors: z.array(z.string()),
            workspace: z.string(),
            acceptedWorkspaces: z.array(z.string()),
          })
          .parse(JSON.parse(result!)),
      ).toEqual({
        identical: true,
        independent: true,
        maxReads: 1,
        reads: 2,
        comments: 1,
        errors: ["Temporary read failure"],
        workspace: "fresh",
        acceptedWorkspaces: ["fresh"],
      });
      const overview = z
        .object({ latestWon: z.boolean(), deselected: z.boolean(), errors: z.array(z.string()) })
        .parse(
          JSON.parse(/<pre id="overview-race-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"),
        );
      expect(overview).toEqual({ latestWon: true, deselected: true, errors: [] });
    } finally {
      await server.stop(true);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  30_000,
);
