/** One shared gutter for the review stream, sized for every visible line number on either side. */
export function reviewGutterWidth(files: readonly { patch: string }[]): string {
  let highest = 1;
  for (const file of files) {
    for (const match of file.patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const [, oldStart, oldCount = "1", newStart, newCount = "1"] = match;
      highest = Math.max(
        highest,
        Number(oldStart) + Math.max(0, Number(oldCount) - 1),
        Number(newStart) + Math.max(0, Number(newCount) - 1),
      );
    }
  }
  return `${Math.max(3, String(highest).length) + 1.5}ch`;
}
