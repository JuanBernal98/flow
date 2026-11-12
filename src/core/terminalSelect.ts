/**
 * A one-question picker for setup: ↑/↓ (or k/j) move, Enter picks, Ctrl-C or Esc gives up.
 * Key handling is a pure step so it can be tested without a terminal.
 */

export type SelectStep =
  | { kind: "move"; index: number }
  | { kind: "pick"; index: number }
  | { kind: "cancel" }
  | { kind: "ignore" };

/** What one key press does to a selection at `index` among `count` options. */
export function stepSelection(index: number, key: string, count: number): SelectStep {
  if (key === "\x1b[A" || key === "k") return { kind: "move", index: (index - 1 + count) % count };
  if (key === "\x1b[B" || key === "j") return { kind: "move", index: (index + 1) % count };
  if (key === "\r" || key === "\n") return { kind: "pick", index };
  if (key === "\x03" || key === "\x1b") return { kind: "cancel" };
  return { kind: "ignore" };
}

/** Ask `question` with arrow-key choices; resolves to the picked index, or undefined if cancelled. */
export function selectInTerminal(question: string, options: readonly string[], initial = 0) {
  const { stdin, stdout } = process;
  let index = initial;
  const draw = (redraw: boolean) => {
    if (redraw) stdout.write(`\x1b[${options.length}A`);
    for (const [position, option] of options.entries()) {
      const marker = position === index ? "\x1b[36m❯ " : "  ";
      stdout.write(`\x1b[2K  ${marker}${option}\x1b[0m\n`);
    }
  };
  stdout.write(`${question} \x1b[2m(↑/↓, Enter)\x1b[0m\n\x1b[?25l`);
  draw(false);

  return new Promise<number | undefined>((resolve) => {
    const finish = (picked: number | undefined) => {
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      // Collapse the list to one answer line so the rest of setup reads cleanly.
      stdout.write(`\x1b[${options.length + 1}A\x1b[J\x1b[?25h`);
      stdout.write(`${question} ${picked === undefined ? "—" : options[picked]}\n`);
      resolve(picked);
    };
    const onKey = (data: Buffer) => {
      const step = stepSelection(index, data.toString(), options.length);
      if (step.kind === "move") {
        index = step.index;
        draw(true);
      } else if (step.kind === "pick") {
        finish(step.index);
      } else if (step.kind === "cancel") {
        finish(undefined);
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onKey);
  });
}
