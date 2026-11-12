import { describe, expect, test } from "bun:test";
import { stepSelection } from "./terminalSelect";

describe("stepSelection", () => {
  test("arrows and j/k move, wrapping at both ends", () => {
    expect(stepSelection(0, "\x1b[B", 3)).toEqual({ kind: "move", index: 1 });
    expect(stepSelection(2, "j", 3)).toEqual({ kind: "move", index: 0 });
    expect(stepSelection(0, "\x1b[A", 3)).toEqual({ kind: "move", index: 2 });
    expect(stepSelection(1, "k", 3)).toEqual({ kind: "move", index: 0 });
  });

  test("Enter picks, Ctrl-C and Esc cancel, other keys do nothing", () => {
    expect(stepSelection(1, "\r", 3)).toEqual({ kind: "pick", index: 1 });
    expect(stepSelection(1, "\x03", 3)).toEqual({ kind: "cancel" });
    expect(stepSelection(1, "\x1b", 3)).toEqual({ kind: "cancel" });
    expect(stepSelection(1, "x", 3)).toEqual({ kind: "ignore" });
  });
});
