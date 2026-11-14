import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const GeometrySchema = z.array(
  z.object({
    id: z.string(),
    display: z.string(),
    width: z.number(),
    separatorMarker: z.string(),
    separatorLine: z.string(),
    additionAccent: z.string(),
    deletionAccent: z.string(),
    contextAccent: z.string(),
    columns: z.array(z.object({ left: z.number(), top: z.number(), width: z.number() })),
  }),
);
const browser = process.env.FLOW_TEST_BROWSER;
const PanelGeometrySchema = z.array(
  z.object({
    status: z.string(),
    width: z.number(),
    sidebarBorder: z.string(),
    scrollWidth: z.number(),
    clientWidth: z.number(),
    footerBottom: z.number(),
    height: z.number(),
    groups: z.number(),
    modal: z.boolean(),
  }),
);

test.skipIf(!browser)(
  "desktop split columns stay aligned and the proposal fits its sidebar with working disclosures",
  async () => {
    const bundle = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../../test/helpers/window-diff-browser.tsx")],
      target: "browser",
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    const script = await bundle.outputs[0]!.text();
    const windowStyles = await Bun.file(resolve(import.meta.dir, "app.css")).text();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/fixture.js")
          return new Response(script, { headers: { "content-type": "text/javascript" } });
        return new Response(
          `<!doctype html><html><head><style>${windowStyles}\n:root { --bg:#fff; --code-bg:#fafafa; --gutter-width:4.5ch; --line:#ddd; --diff-font-size:16px; --diff-line-height:26px; } #root > section { margin-bottom:30px; }</style></head><body><div id="root"></div><pre id="browser-result"></pre><pre id="panel-result"></pre><pre id="selection-result"></pre><pre id="poll-result"></pre><script type="module" src="/fixture.js"></script></body></html>`,
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    const profile = mkdtempSync(join(tmpdir(), "flow-browser-test-"));
    try {
      const process = Bun.spawn(
        [
          browser!,
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          `--user-data-dir=${profile}`,
          "--virtual-time-budget=5000",
          "--dump-dom",
          `http://127.0.0.1:${server.port}`,
        ],
        { windowsHide: true, stdout: "pipe", stderr: "pipe", timeout: 25_000 },
      );
      const [output, errors, exit] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      expect(exit, errors).toBe(0);
      const result = /<pre id="browser-result">([^<]+)<\/pre>/.exec(output)?.[1];
      expect(result, output.slice(-1500)).toBeDefined();
      const measurements = GeometrySchema.parse(JSON.parse(result!));
      const emptyStates = z
        .array(
          z.object({
            scope: z.string(),
            title: z.string(),
            centered: z.boolean(),
            fits: z.boolean(),
          }),
        )
        .parse(JSON.parse(/<pre id="empty-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"));
      expect(emptyStates).toEqual([
        { scope: "pending", title: "No pending changes", centered: true, fits: true },
        { scope: "branch", title: "No changes on this branch yet", centered: true, fits: true },
      ]);
      for (const geometry of measurements) {
        expect(geometry.separatorMarker).toBe('"…"');
        expect(geometry.separatorLine).toContain("linear-gradient");
        expect(geometry.additionAccent).toContain("inset");
        expect(geometry.deletionAccent).toContain("inset");
        expect(geometry.additionAccent).toContain("3px 0px");
        expect(geometry.deletionAccent).toContain("3px 0px");
        expect(geometry.additionAccent).not.toBe(geometry.deletionAccent);
        expect(geometry.contextAccent).toContain("rgba(0, 0, 0, 0)");
        const [left, right] = geometry.columns;
        expect(left).toBeDefined();
        if (geometry.id.startsWith("split")) {
          expect(geometry.display).toBe("grid");
          expect(right).toBeDefined();
          expect(Math.abs(left!.width - geometry.width / 2)).toBeLessThan(2);
          expect(Math.abs(right!.width - geometry.width / 2)).toBeLessThan(2);
          expect(Math.abs(right!.left - left!.width)).toBeLessThan(2);
          expect(Math.abs(right!.top - left!.top)).toBeLessThan(1);
        } else {
          expect(geometry.columns).toHaveLength(1);
          expect(Math.abs(left!.width - geometry.width)).toBeLessThan(2);
        }
      }
      const panelResult = /<pre id="panel-result">([^<]+)<\/pre>/.exec(output)?.[1];
      expect(panelResult).toBeDefined();
      for (const panel of PanelGeometrySchema.parse(JSON.parse(panelResult!))) {
        expect(panel.width).toBe(319);
        expect(panel.sidebarBorder).toBe("1px");
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
        expect(Math.abs(panel.footerBottom - panel.height)).toBeLessThan(1);
        expect(panel.modal).toBe(false);
        if (panel.status === "ready") expect(panel.groups).toBe(2);
      }
      const selection = z
        .object({
          allChecked: z.boolean(),
          approved: z.array(z.number()),
          disabledWhenEmpty: z.boolean(),
          headerUnchanged: z.string(),
          footerButton: z.string(),
          footerButtons: z.number(),
        })
        .parse(JSON.parse(/<pre id="selection-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"));
      expect(selection).toMatchObject({
        allChecked: true,
        approved: [0],
        disabledWhenEmpty: true,
        footerButtons: 1,
      });
      expect(selection.headerUnchanged).toContain("Changes (0)Commit");
      expect(selection.footerButton).toBe("Commit");
      const polling = z
        .object({
          calls: z.number(),
          emptyCalls: z.number(),
          renders: z.number(),
          status: z.string(),
        })
        .parse(JSON.parse(/<pre id="poll-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"));
      expect(polling.calls).toBe(3);
      expect(polling.emptyCalls).toBe(1);
      expect(polling.renders).toBeLessThanOrEqual(4);
      expect(polling.status).toBe("ready");
      const comments = z
        .object({
          focused: z.boolean(),
          visible: z.boolean(),
          sameField: z.boolean(),
          unrelatedRenders: z.number(),
          margin: z.string(),
          border: z.string(),
          gutterMatches: z.boolean(),
          codeMatches: z.boolean(),
          bodySize: z.string(),
          metaSize: z.string(),
          separator: z.string(),
          matchingBorders: z.boolean(),
          placeholder: z.boolean(),
          noAvatars: z.boolean(),
          sameBackground: z.boolean(),
          radius: z.string(),
          dates: z.number(),
          insideCode: z.boolean(),
        })
        .parse(JSON.parse(/<pre id="comment-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"));
      expect(comments).toMatchObject({
        focused: true,
        visible: true,
        sameField: true,
        unrelatedRenders: 0,
        border: "1px",
        matchingBorders: true,
        placeholder: true,
        gutterMatches: true,
        codeMatches: true,
        bodySize: "16px",
        metaSize: "13px",
        separator: "1px",
        radius: "10px",
        noAvatars: true,
        sameBackground: true,
        dates: 2,
        insideCode: true,
      });
      expect(comments.margin).not.toBe("0px");
      const conversation = z
        .object({
          replyId: z.number(),
          users: z.number(),
          agents: z.number(),
          pending: z.boolean(),
          sameField: z.boolean(),
        })
        .parse(
          JSON.parse(/<pre id="conversation-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"),
        );
      expect(conversation).toEqual({
        replyId: 1,
        users: 2,
        agents: 1,
        pending: false,
        sameField: true,
      });
      const sidebar = z
        .object({
          calls: z.number(),
          changesVisible: z.boolean(),
          sameNode: z.boolean(),
          stillUnchecked: z.boolean(),
          sameScroll: z.boolean(),
          action: z.string(),
          width: z.number(),
          savedWidth: z.number(),
          resizeCalls: z.number(),
        })
        .parse(JSON.parse(/<pre id="sidebar-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"));
      expect(sidebar).toEqual({
        calls: 1,
        changesVisible: true,
        sameNode: true,
        stillUnchecked: true,
        sameScroll: true,
        action: "commit",
        width: 390,
        savedWidth: 390,
        resizeCalls: 1,
      });
      const notifications = z
        .object({
          firstUnread: z.boolean(),
          readAfterOpening: z.boolean(),
          unreadAgain: z.boolean(),
          count: z.string(),
          label: z.string(),
          sameCountSize: z.boolean(),
        })
        .parse(
          JSON.parse(/<pre id="notification-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"),
        );
      expect(notifications).toMatchObject({
        firstUnread: true,
        readAfterOpening: true,
        unreadAgain: true,
        count: "1",
        sameCountSize: true,
      });
      expect(notifications.label).toContain("new replies");
      const navigation = z
        .object({
          first: z.boolean(),
          repeated: z.boolean(),
          folded: z.boolean(),
          latest: z.boolean(),
        })
        .parse(
          JSON.parse(/<pre id="navigation-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"),
        );
      expect(navigation).toEqual({ first: true, repeated: true, folded: true, latest: true });
      const activity = z
        .object({
          pendingLabel: z.string(),
          pendingDisabled: z.boolean(),
          preparingLabel: z.string(),
          stayedInChanges: z.boolean(),
          posts: z.number(),
          finished: z.boolean(),
        })
        .parse(
          JSON.parse(/<pre id="shared-activity-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"),
        );
      expect(activity).toEqual({
        pendingLabel: "Proposing…",
        pendingDisabled: true,
        preparingLabel: "Proposing…",
        stayedInChanges: true,
        posts: 1,
        finished: true,
      });
      const resize = z
        .object({
          stableHeight: z.boolean(),
          duringVisibility: z.string(),
          inheritedWidth: z.string(),
          persistedDuringDrag: z.number(),
          savesAfterCancel: z.number(),
          widthAfterCancel: z.number(),
          restored: z.boolean(),
          visibilityAfterCancel: z.string(),
        })
        .parse(JSON.parse(/<pre id="resize-result">([^<]+)<\/pre>/.exec(output)?.[1] ?? "null"));
      expect(resize).toEqual({
        stableHeight: true,
        duringVisibility: "auto",
        inheritedWidth: "320px",
        persistedDuringDrag: 1,
        savesAfterCancel: 1,
        widthAfterCancel: 390,
        restored: true,
        visibilityAfterCancel: "visible",
      });
    } finally {
      await server.stop(true);
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
  30_000,
);
