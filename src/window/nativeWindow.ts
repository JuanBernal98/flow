/** The native window process: a system webview (WebKit on macOS) showing the flow window UI. */
import { SizeHint, Webview } from "webview-bun";

const url = process.argv[2];
if (!url) {
  throw new Error("Usage: nativeWindow.ts <url>");
}
const webview = new Webview();
webview.title = "flow";
webview.size = { width: 1480, height: 920, hint: SizeHint.NONE };
webview.navigate(url);
webview.run();
