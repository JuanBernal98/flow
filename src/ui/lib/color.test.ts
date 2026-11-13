import { expect, test } from "bun:test";
import { contrastingTextColor } from "./color";

test("solid theme actions use readable text on dark and light backgrounds", () => {
  expect(contrastingTextColor("#a1c181")).toBe("#111111");
  expect(contrastingTextColor("#248a3d")).toBe("#ffffff");
  expect(contrastingTextColor("#ffffff")).toBe("#111111");
  expect(contrastingTextColor("#000000")).toBe("#ffffff");
});
