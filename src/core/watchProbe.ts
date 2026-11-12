/**
 * UI-side client for the watch signature worker: `signature(input)` resolves without blocking the
 * render loop, however long the git processes behind it take.
 */
import type { CliInput } from "./types";
import type { WatchSignatureReply, WatchSignatureRequest } from "./watchWorker";

export interface WatchSignatureProbe {
  signature: (input: CliInput) => Promise<string>;
  dispose: () => void;
}

/** Start one worker for a watch session; call `dispose` when the session ends. */
export function createWatchSignatureProbe(): WatchSignatureProbe {
  const worker = new Worker(new URL("./watchWorker.ts", import.meta.url).href);
  const pending = new Map<
    number,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >();
  let nextId = 0;
  let disposed = false;

  worker.onmessage = (event: MessageEvent<WatchSignatureReply>) => {
    const reply = event.data;
    const waiter = pending.get(reply.id);
    pending.delete(reply.id);
    if (!waiter) {
      return;
    }
    if ("error" in reply) {
      waiter.reject(new Error(reply.error));
    } else {
      waiter.resolve(reply.signature);
    }
  };

  return {
    signature: (input) =>
      new Promise((resolve, reject) => {
        // A terminated worker never answers, so fail fast instead of hanging the caller.
        if (disposed) {
          reject(new Error("Watch session ended."));
          return;
        }
        const id = (nextId += 1);
        pending.set(id, { resolve, reject });
        const request: WatchSignatureRequest = { id, input };
        worker.postMessage(request);
      }),
    dispose: () => {
      disposed = true;
      for (const waiter of pending.values()) {
        waiter.reject(new Error("Watch session ended."));
      }
      pending.clear();
      worker.terminate();
    },
  };
}
