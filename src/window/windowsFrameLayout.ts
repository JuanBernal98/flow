/** Convert monitor screen coordinates into the native maximized window's position and size. */
export function maximizedWindowBounds(
  monitor: { left: number; top: number },
  work: { left: number; top: number; right: number; bottom: number },
) {
  return {
    x: work.left - monitor.left,
    y: work.top - monitor.top,
    width: work.right - work.left,
    height: work.bottom - work.top,
  };
}
