import { useEffect, useRef } from "react";
import { readFocusRequest, type FocusRequest } from "../../core/focusRequests";

const POLL_INTERVAL_MS = 500;

/**
 * Call `onRequest` once for each new agent focus request in `.flow/focus.json`. A request already
 * on disk when the review opens is treated as old, so reopening never jumps on its own.
 */
export function useFocusRequests(
  repoRoot: string | null,
  onRequest: (request: FocusRequest) => void,
  readRequest: (repoRoot: string) => FocusRequest | null = readFocusRequest,
) {
  // Latest callback without re-arming the poll on every render.
  const onRequestRef = useRef(onRequest);
  useEffect(() => {
    onRequestRef.current = onRequest;
  }, [onRequest]);

  useEffect(() => {
    if (!repoRoot) {
      return;
    }
    let handledId = readRequest(repoRoot)?.id ?? null;
    const timer = setInterval(() => {
      const request = readRequest(repoRoot);
      if (request && request.id !== handledId) {
        handledId = request.id;
        onRequestRef.current(request);
      }
    }, POLL_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }, [repoRoot, readRequest]);
}
