/** GTK window controls for the Linux webview host. */
import { dlopen, FFIType, type Pointer } from "bun:ffi";

const gtk = dlopen("libgtk-3.so.0", {
  gtk_window_maximize: { args: [FFIType.ptr], returns: FFIType.void },
}).symbols;

/** Let the window manager fill the available work area at launch. */
export function maximizeWindow(window: Pointer) {
  gtk.gtk_window_maximize(window);
}
