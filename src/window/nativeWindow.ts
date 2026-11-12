/** The native window process: a system webview (WebKit on macOS) showing the flow window UI. */
import type { Pointer } from "bun:ffi";
import { SizeHint, Webview } from "webview-bun";

const url = process.argv[2];
if (!url) {
  throw new Error("Usage: nativeWindow.ts <url>");
}
const webview = new Webview();
webview.title = "flow";
webview.size = { width: 1480, height: 920, hint: SizeHint.NONE };

if (process.platform === "darwin") {
  // The page draws the top bar itself, so it asks the window to drag and zoom from there.
  const { dragWindow, unifyTitleBar, zoomWindow } = await import("./macWindow");
  const window = webview.unsafeWindowHandle as Pointer;
  unifyTitleBar(window);
  webview.bind("flowDragWindow", () => dragWindow(window));
  webview.bind("flowZoomWindow", () => zoomWindow(window));
  webview.init("document.documentElement.classList.add('native-mac')");
}

webview.navigate(url);
webview.run();
