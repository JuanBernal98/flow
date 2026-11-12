import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliInput } from "./types";
import { computeWatchSignature } from "./watch";
import { createWatchSignatureProbe } from "./watchProbe";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the worker computes the same signature as the in-thread check, and rejects after dispose", async () => {
  const root = mkdtempSync(join(tmpdir(), "watch-probe-"));
  roots.push(root);
  const left = join(root, "before.ts");
  const right = join(root, "after.ts");
  writeFileSync(left, "export const answer = 41;\n");
  writeFileSync(right, "export const answer = 42;\n");
  const input: CliInput = { kind: "diff", left, right, options: {} };

  const probe = createWatchSignatureProbe();
  try {
    expect(await probe.signature(input)).toBe(computeWatchSignature(input));

    writeFileSync(right, "export const answer = 43;\nexport const added = true;\n");
    expect(await probe.signature(input)).toBe(computeWatchSignature(input));
  } finally {
    probe.dispose();
  }
  await expect(probe.signature(input)).rejects.toThrow();
});
