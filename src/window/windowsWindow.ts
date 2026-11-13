/** Windows frame controls for the title bar drawn by the page. */
import { dlopen, FFIType, JSCallback, ptr, toArrayBuffer, type Pointer } from "bun:ffi";
import { maximizedWindowBounds } from "./windowsFrameLayout";

const dwm = dlopen("dwmapi.dll", {
  DwmSetWindowAttribute: {
    args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
    returns: FFIType.i32,
  },
}).symbols;

const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const DWMWA_BORDER_COLOR = 34;
const DWMWA_COLOR_NONE = 0xfffffffe;

/** Match system shadows and window decorations to the page's current appearance. */
export function setFrameTheme(window: Pointer, dark: boolean) {
  const appearance = new Int32Array([Number(dark)]);
  dwm.DwmSetWindowAttribute(
    window,
    DWMWA_USE_IMMERSIVE_DARK_MODE,
    ptr(appearance),
    appearance.byteLength,
  );
}

const user32 = dlopen("user32.dll", {
  GetWindowLongW: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  SetWindowLongW: { args: [FFIType.ptr, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  SetWindowPos: {
    args: [
      FFIType.ptr,
      FFIType.ptr,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.i32,
      FFIType.u32,
    ],
    returns: FFIType.i32,
  },
  ReleaseCapture: { args: [], returns: FFIType.i32 },
  PostMessageW: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i32,
  },
  IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
  ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  MonitorFromWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
  GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  GetWindowPlacement: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  SetWindowPlacement: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
}).symbols;

const comctl32 = dlopen("comctl32.dll", {
  SetWindowSubclass: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.u64],
    returns: FFIType.i32,
  },
  DefSubclassProc: {
    args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64],
    returns: FFIType.i64,
  },
  RemoveWindowSubclass: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.u64],
    returns: FFIType.i32,
  },
}).symbols;

const WM_NCCALCSIZE = 0x0083;
const WM_GETMINMAXINFO = 0x0024;
const MONITOR_DEFAULTTONEAREST = 2;
const FRAME_SUBCLASS_ID = 1;
const WM_SYSCOMMAND = 0x0112;
const SC_SIZE = 0xf000;
// The native window procedure retains this callback until webview.run() finishes.
let frameCallback: JSCallback | null = null;

const GWL_STYLE = -16;
const WS_CAPTION = 0x00c00000;
const SWP_FRAMECHANGED = 0x0020;
const SWP_NOMOVE = 0x0002;
const SWP_NOSIZE = 0x0001;
const SWP_NOZORDER = 0x0004;
const WM_NCLBUTTONDOWN = 0x00a1;
const HTCAPTION = 2;
const WM_CLOSE = 0x0010;
const SW_MINIMIZE = 6;
const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;
const WS_OVERLAPPEDWINDOW = 0x00cf0000;
const fullscreenWindows = new Map<Pointer, { style: number; placement: Int32Array }>();

/** Read both the full monitor and its work area in screen coordinates. */
function monitorInfo(window: Pointer): Int32Array | null {
  const monitor = user32.MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
  const info = new Int32Array(10);
  info[0] = info.byteLength;
  return monitor && user32.GetMonitorInfoW(monitor, ptr(info)) ? info : null;
}

/** Fill the current monitor, restoring the original placement on the next toggle. */
export function toggleFullscreenWindow(window: Pointer): boolean {
  const saved = fullscreenWindows.get(window);
  if (saved) {
    fullscreenWindows.delete(window);
    user32.SetWindowLongW(window, GWL_STYLE, saved.style);
    user32.SetWindowPlacement(window, ptr(saved.placement));
    user32.SetWindowPos(
      window,
      null,
      0,
      0,
      0,
      0,
      SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
    );
    return false;
  }
  const info = monitorInfo(window);
  const placement = new Int32Array(11);
  placement[0] = placement.byteLength;
  if (!info || !user32.GetWindowPlacement(window, ptr(placement))) {
    throw new Error("Unable to read the window placement for fullscreen.");
  }
  const style = user32.GetWindowLongW(window, GWL_STYLE);
  fullscreenWindows.set(window, { style, placement });
  // Leave the maximized work-area constraint before sizing to the full monitor.
  user32.ShowWindow(window, SW_RESTORE);
  user32.SetWindowLongW(window, GWL_STYLE, style & ~WS_OVERLAPPEDWINDOW);
  user32.SetWindowPos(
    window,
    null,
    info[1]!,
    info[2]!,
    info[3]! - info[1]!,
    info[4]! - info[2]!,
    SWP_FRAMECHANGED | SWP_NOZORDER,
  );
  return true;
}

/** Extend the page over the frame and let Windows maximize the outer window to the work area. */
export function unifyTitleBar(window: Pointer) {
  const border = new Uint32Array([DWMWA_COLOR_NONE]);
  dwm.DwmSetWindowAttribute(window, DWMWA_BORDER_COLOR, ptr(border), border.byteLength);
  frameCallback = new JSCallback(
    (handle: Pointer, message: number, wParam: bigint, lParam: bigint) => {
      if (message === WM_NCCALCSIZE) {
        // Client and outer bounds stay identical, including while maximized.
        return 0n;
      }
      if (message === WM_GETMINMAXINFO) {
        const result = comctl32.DefSubclassProc(handle, message, wParam, lParam);
        // MONITORINFO: size, monitor RECT, work RECT, flags. RECT uses signed LONGs.
        const info = monitorInfo(handle);
        if (info) {
          const offset = fullscreenWindows.has(handle) ? 1 : 5;
          const bounds = maximizedWindowBounds(
            { left: info[1]!, top: info[2]! },
            {
              left: info[offset]!,
              top: info[offset + 1]!,
              right: info[offset + 2]!,
              bottom: info[offset + 3]!,
            },
          );
          // MINMAXINFO is five POINTs: reserved, max size, max position, min/max tracking.
          const limits = new Int32Array(toArrayBuffer(Number(lParam) as Pointer, 0, 40));
          limits[2] = bounds.width;
          limits[3] = bounds.height;
          limits[4] = bounds.x;
          limits[5] = bounds.y;
        }
        return result;
      }
      return comctl32.DefSubclassProc(handle, message, wParam, lParam);
    },
    {
      args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.i64, FFIType.u64, FFIType.u64],
      returns: FFIType.i64,
    },
  );
  if (!comctl32.SetWindowSubclass(window, frameCallback.ptr, FRAME_SUBCLASS_ID, 0)) {
    frameCallback.close();
    frameCallback = null;
    throw new Error("Unable to install the custom Windows frame.");
  }
  const style = user32.GetWindowLongW(window, GWL_STYLE);
  user32.SetWindowLongW(window, GWL_STYLE, style & ~WS_CAPTION);
  user32.SetWindowPos(
    window,
    null,
    0,
    0,
    0,
    0,
    SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
  );
}

/** Release the subclass after the native event loop has stopped invoking it. */
export function disposeFrame(window: Pointer) {
  fullscreenWindows.delete(window);
  if (!frameCallback) return;
  comctl32.RemoveWindowSubclass(window, frameCallback.ptr, FRAME_SUBCLASS_ID);
  frameCallback.close();
  frameCallback = null;
}

/** Start native edge resizing while the invisible page handles provide the mouse targets. */
export function resizeWindow(window: Pointer, edge: number) {
  if (
    !Number.isInteger(edge) ||
    edge < 1 ||
    edge > 8 ||
    user32.IsZoomed(window) ||
    fullscreenWindows.has(window)
  )
    return;
  user32.ReleaseCapture();
  user32.PostMessageW(window, WM_SYSCOMMAND, SC_SIZE + edge, 0);
}

/** Start the system move loop without blocking the webview's JavaScript binding callback. */
export function dragWindow(window: Pointer) {
  if (fullscreenWindows.has(window)) return;
  user32.ReleaseCapture();
  user32.PostMessageW(window, WM_NCLBUTTONDOWN, HTCAPTION, 0);
}

/** Toggle the system maximized state and report the new state to the title bar. */
export function zoomWindow(window: Pointer): boolean {
  if (fullscreenWindows.has(window)) return false;
  user32.ShowWindow(window, user32.IsZoomed(window) ? SW_RESTORE : SW_MAXIMIZE);
  return Boolean(user32.IsZoomed(window));
}

/** Read the native state, including changes made through snapping and keyboard shortcuts. */
export function isWindowMaximized(window: Pointer): boolean {
  return Boolean(user32.IsZoomed(window));
}

/** Minimize the window to the taskbar. */
export function minimizeWindow(window: Pointer) {
  user32.ShowWindow(window, SW_MINIMIZE);
}

/** Close through the normal window procedure so the webview and server shut down together. */
export function closeWindow(window: Pointer) {
  user32.PostMessageW(window, WM_CLOSE, 0, 0);
}
