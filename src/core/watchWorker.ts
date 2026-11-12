/**
 * Worker that computes watch-mode change signatures off the UI thread. The signature runs several
 * synchronous git processes (`diff --raw`, untracked listing, `rev-parse`), which would otherwise
 * freeze rendering and input on every poll in large repos.
 */
import type { CliInput } from "./types";
import { computeWatchSignature } from "./watch";

declare const self: Worker;

/** One signature request from the UI thread, matched to its reply by id. */
export interface WatchSignatureRequest {
  id: number;
  input: CliInput;
}

export type WatchSignatureReply = { id: number; signature: string } | { id: number; error: string };

self.onmessage = (event: MessageEvent<WatchSignatureRequest>) => {
  const { id, input } = event.data;
  let reply: WatchSignatureReply;
  try {
    reply = { id, signature: computeWatchSignature(input) };
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
};
