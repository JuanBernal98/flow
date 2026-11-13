import type { createLiveDiffWatch } from "./liveDiffWatch";

/** Stream filesystem invalidations with authentication handled by the existing localhost server. */
export function createDiffEvents(
  watcher: ReturnType<typeof createLiveDiffWatch>,
  signal: AbortSignal,
) {
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const encoder = new TextEncoder();
      const subscription = watcher.subscribe((revision) => send("change", revision));
      /** Both browser disconnects and failed initialization release the native filesystem watches. */
      const close = () => {
        if (closed) return;
        closed = true;
        subscription.unsubscribe();
        signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {
          /* The browser may already have cancelled its reader. */
        }
      };
      /** No workspace contents or credentials need to travel in an invalidation event. */
      function send(event: string, revision: number) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${revision}\n\n`));
        } catch {
          close();
        }
      }
      dispose = close;
      signal.addEventListener("abort", close, { once: true });
      if (signal.aborted) close();
      void subscription.ready.then(() => send("ready", watcher.revision)).catch(close);
    },
    cancel() {
      dispose();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
