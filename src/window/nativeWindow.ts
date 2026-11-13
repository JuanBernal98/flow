/** The native window process: a system webview (WebKit on macOS) showing the flow window UI. */
import type { Pointer } from "bun:ffi";
import { SizeHint, Webview } from "webview-bun";
import { windowBootstrapScript, type WindowBootstrap } from "./windowBootstrap";

const url = process.argv[2];
if (!url) {
  throw new Error("Usage: nativeWindow.ts <url>");
}
const bootstrap =
  process.argv[3] === "--bootstrap"
    ? (JSON.parse(await Bun.stdin.text()) as WindowBootstrap)
    : undefined;
const windowsControls = process.platform === "win32" ? await import("./windowsWindow") : null;
windowsControls?.setAppIdentity();
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
  zoomWindow(window);
  webview.bind("flowDragWindow", () => dragWindow(window));
  webview.bind("flowZoomWindow", () => zoomWindow(window));
  webview.bind("flowToggleFullscreen", () => toggleFullscreenWindow(window));
  webview.init("window.flowNativePlatform = 'mac'");
}

if (windowsControls) {
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
    maximizeWindow,
    setWindowIcon,
  } = windowsControls;
  const window = webview.unsafeWindowHandle as Pointer;
  setWindowIcon(window);
  unifyTitleBar(window);
  if (bootstrap) {
    windowsControls.prepareWindowForFirstPaint(window);
    webview.bind("flowReady", () => windowsControls.revealPreparedWindow(window));
  } else maximizeWindow(window);
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

if (process.platform === "linux") {
  const { maximizeWindow } = await import("./linuxWindow");
  maximizeWindow(webview.unsafeWindowHandle as Pointer);
}

if (bootstrap) webview.init(windowBootstrapScript(bootstrap));
webview.navigate(url);
webview.run();
disposeWindowFrame();
