import { spawn } from "node:child_process";

/**
 * Open an http(s) URL in the default browser. Best-effort and fire-and-forget: the opener is
 * detached so the TUI never waits on it, and a missing opener is silently ignored.
 */
export function openInBrowser(url: string) {
  const protocol = URL.parse(url)?.protocol;
  if (protocol !== "https:" && protocol !== "http:") {
    return;
  }
  const program = process.platform === "darwin" ? "open" : "xdg-open";
  try {
    const child = spawn(program, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No opener on this system; nothing useful to report from a key press.
  }
}
