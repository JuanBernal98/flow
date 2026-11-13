import { expect, test } from "bun:test";
import { parseCli } from "./cli";

test("Codex and ChatGPT setup aliases expose preview, removal, and idle-delivery limits", async () => {
  for (const name of ["codex", "chatgpt"]) {
    const result = await parseCli(["bun", "flow", "setup", name, "--help"]);
    expect(result.kind).toBe("help");
    if (result.kind !== "help") throw new Error("Expected setup help");
    expect(result.text).toContain("--dry-run");
    expect(result.text).toContain("--uninstall");
    expect(result.text).toContain("idle");
  }
});

test("Codex setup rejects unsupported flags before writing configuration", async () => {
  await expect(parseCli(["bun", "flow", "setup", "codex", "--trust-all"])).rejects.toThrow(
    "Unknown option",
  );
});
