import type { WindowDiffFile } from "./data";

/** Reuse unchanged files and the existing stream so live refreshes only redraw actual changes. */
export function reconcileDiffFiles(previous: WindowDiffFile[] | null, next: WindowDiffFile[]) {
  if (!previous) return next;
  const byPath = new Map(previous.map((file) => [file.path, file]));
  const files = next.map((file) => {
    const before = byPath.get(file.path);
    return before &&
      (Object.keys(file) as (keyof WindowDiffFile)[]).every((key) => before[key] === file[key]) &&
      (Object.keys(before) as (keyof WindowDiffFile)[]).every((key) => before[key] === file[key])
      ? before
      : file;
  });
  return files.length === previous.length && files.every((file, index) => file === previous[index])
    ? previous
    : files;
}

/** Listen to the authenticated local change stream and reconnect after a server interruption. */
export function subscribeToDiffChanges(secret: string, onChange: () => void) {
  const controller = new AbortController();
  let timer = 0;
  /** Reconnection also refreshes once so edits made during a disconnect are not missed. */
  async function listen() {
    while (!controller.signal.aborted) {
      try {
        const response = await fetch("/api/diff/events", {
          headers: { "x-flow-secret": secret },
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error("The diff update stream is unavailable.");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        try {
          while (!controller.signal.aborted) {
            const result = await reader.read();
            if (result.done) break;
            pending += decoder.decode(result.value, { stream: true });
            let boundary = pending.indexOf("\n\n");
            while (boundary >= 0) {
              const event = pending.slice(0, boundary);
              pending = pending.slice(boundary + 2);
              if (event.startsWith("event: ready") || event.startsWith("event: change")) onChange();
              boundary = pending.indexOf("\n\n");
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch {
        /* Retry a dropped connection while this window is still mounted. */
      }
      if (!controller.signal.aborted)
        await new Promise<void>((resolve) => {
          const interrupted = () => {
            clearTimeout(timer);
            resolve();
          };
          controller.signal.addEventListener("abort", interrupted, { once: true });
          timer = window.setTimeout(() => {
            controller.signal.removeEventListener("abort", interrupted);
            resolve();
          }, 1500);
        });
    }
  }
  void listen();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
