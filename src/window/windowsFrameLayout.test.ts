import { describe, expect, test } from "bun:test";
import { maximizedWindowBounds } from "./windowsFrameLayout";

describe("native maximized window bounds", () => {
  test("leaves the bottom taskbar outside the entire window, without an empty client strip", () => {
    expect(
      maximizedWindowBounds({ left: 0, top: 0 }, { left: 0, top: 0, right: 1920, bottom: 1040 }),
    ).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  test("respects a left taskbar on a monitor to the left of the primary screen", () => {
    expect(
      maximizedWindowBounds(
        { left: -1920, top: -200 },
        { left: -1872, top: -200, right: 0, bottom: 880 },
      ),
    ).toEqual({ x: 48, y: 0, width: 1872, height: 1080 });
  });

  test("respects a top taskbar on a secondary monitor", () => {
    expect(
      maximizedWindowBounds(
        { left: 1920, top: 100 },
        { left: 1920, top: 148, right: 4480, bottom: 1540 },
      ),
    ).toEqual({ x: 0, y: 48, width: 2560, height: 1392 });
  });
});
