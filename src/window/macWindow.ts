/**
 * macOS window chrome through the Objective-C runtime: a unified title bar (transparent, title
 * hidden, content running underneath the traffic lights) so the page draws its own top bar, plus
 * the native drag and zoom the page asks for from that bar.
 */
import { dlopen, FFIType, ptr, type Pointer } from "bun:ffi";

const LIBOBJC = "/usr/lib/libobjc.A.dylib";
const FULL_SIZE_CONTENT_VIEW = 1n << 15n;
const TITLE_HIDDEN = 1n;

const runtime = dlopen(LIBOBJC, {
  objc_getClass: { args: [FFIType.ptr], returns: FFIType.ptr },
  sel_registerName: { args: [FFIType.ptr], returns: FFIType.ptr },
}).symbols;
// objc_msgSend takes each method's own signature, so it is bound once per shape used here.
const sendForPointer = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
}).symbols.objc_msgSend;
const sendForU64 = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
}).symbols.objc_msgSend;
const sendU64 = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.void },
}).symbols.objc_msgSend;
const sendBool = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.bool], returns: FFIType.void },
}).symbols.objc_msgSend;
const sendPointer = dlopen(LIBOBJC, {
  objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.void },
}).symbols.objc_msgSend;

/** A C string the runtime can read. */
function cString(text: string) {
  return ptr(Buffer.from(`${text}\0`));
}

function selector(name: string) {
  return runtime.sel_registerName(cString(name)) as Pointer;
}

/** Hide the title bar's background and title and let the page fill the whole window. */
export function unifyTitleBar(window: Pointer) {
  const styleMask = BigInt(sendForU64(window, selector("styleMask")));
  sendU64(window, selector("setStyleMask:"), styleMask | FULL_SIZE_CONTENT_VIEW);
  sendBool(window, selector("setTitlebarAppearsTransparent:"), true);
  sendU64(window, selector("setTitleVisibility:"), TITLE_HIDDEN);
}

/** Move the window with the mouse press the page just reported, as a title bar drag would. */
export function dragWindow(window: Pointer) {
  const application = sendForPointer(
    runtime.objc_getClass(cString("NSApplication")) as Pointer,
    selector("sharedApplication"),
  ) as Pointer;
  const event = sendForPointer(application, selector("currentEvent"));
  if (event) {
    sendPointer(window, selector("performWindowDragWithEvent:"), event);
  }
}

/** Zoom the window, as a double click on a title bar does. */
export function zoomWindow(window: Pointer) {
  sendPointer(window, selector("zoom:"), null);
}

/** Toggle the native macOS fullscreen space, preserving the previous window size. */
export function toggleFullscreenWindow(window: Pointer) {
  sendPointer(window, selector("toggleFullScreen:"), null);
}
