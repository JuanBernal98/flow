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
let disposeWindowFrame = () => {};

if (process.platform === "darwin") {
  // The page draws the top bar itself, so it asks the window to drag and zoom from there.
  const { dragWindow, unifyTitleBar, zoomWindow, toggleFullscreenWindow } =
    await import("./macWindow");
  const window = webview.unsafeWindowHandle as Pointer;
  unifyTitleBar(window);
  webview.bind("flowDragWindow", () => dragWindow(window));
  webview.bind("flowZoomWindow", () => zoomWindow(window));
  webview.bind("flowToggleFullscreen", () => toggleFullscreenWindow(window));
  webview.init("window.flowNativePlatform = 'mac'");
}

if (process.platform === "win32") {
  const {
    dragWindow,
    unifyTitleBar,
    zoomWindow,
    minimizeWindow,
    closeWindow,
    isWindowMaximized,
    setFrameTheme,
    disposeFrame,
    resizeWindow,
    toggleFullscreenWindow,
  } = await import("./windowsWindow");
  const window = webview.unsafeWindowHandle as Pointer;
  unifyTitleBar(window);
  disposeWindowFrame = () => disposeFrame(window);
  webview.bind("flowDragWindow", () => dragWindow(window));
  webview.bind("flowZoomWindow", () => zoomWindow(window));
  webview.bind("flowToggleFullscreen", () => toggleFullscreenWindow(window));
  webview.bind("flowMinimizeWindow", () => minimizeWindow(window));
  webview.bind("flowCloseWindow", () => closeWindow(window));
  webview.bind("flowIsWindowMaximized", () => isWindowMaximized(window));
  webview.bind("flowResizeWindow", (edge: number) => resizeWindow(window, edge));
  webview.bind("flowSetFrameTheme", (dark: boolean) => setFrameTheme(window, dark));
  webview.init("window.flowNativePlatform = 'windows'");
}

webview.navigate(url);
webview.run();
disposeWindowFrame();
