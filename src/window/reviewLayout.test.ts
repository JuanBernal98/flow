import { describe, expect, test } from "bun:test";
import { reviewGutterWidth } from "./reviewLayout";

describe("review stream gutter", () => {
  test("aligns filenames across files with three and four digit line numbers", () => {
    expect(
      reviewGutterWidth([{ patch: "@@ -120,3 +120,3 @@\n" }, { patch: "@@ -1200,3 +1200,3 @@\n" }]),
    ).toBe("5.5ch");
  });

  test("includes deleted-side numbers and every hunk", () => {
    expect(reviewGutterWidth([{ patch: "@@ -1 +1 @@\n@@ -12345,2 +0,0 @@\n" }])).toBe("6.5ch");
  });

  test("sizes to inclusive line ranges without adding a phantom digit at 999", () => {
    expect(reviewGutterWidth([{ patch: "@@ -990,10 +990,10 @@\n" }])).toBe("4.5ch");
    expect(reviewGutterWidth([{ patch: "@@ -990,11 +990,11 @@\n" }])).toBe("5.5ch");
  });

  test("keeps a stable minimum for short files and an empty stream", () => {
    expect(reviewGutterWidth([])).toBe("4.5ch");
    expect(reviewGutterWidth([{ patch: "@@ -1 +1 @@\n" }])).toBe("4.5ch");
  });
});
