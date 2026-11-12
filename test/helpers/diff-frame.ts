/**
 * Whether a captured frame shows a split-view row: one terminal line holding two code cells, each
 * led by its own line number (`12   code`). The right cell's code may be cut off by a narrow pane,
 * leaving just its number at the end of the line. Stack view gives every line a single number.
 */
export function hasSplitDiffRowTest(frame: string) {
  return frame.split("\n").some((line) => /(^|\s)\d+ {3}\S.*\s\d+( {3}\S|\s*$)/.test(line));
}
