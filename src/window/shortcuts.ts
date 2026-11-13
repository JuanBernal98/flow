export const DESKTOP_KEYS = { scope: "B", commitTab: "c", commitAction: "C" } as const;

/** Every key, grouped like the terminal's help dialog. */
export const HELP_SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Review",
    keys: [
      ["j / k", "next / previous hunk (also J / K, ] / [)"],
      [". / ,", "next / previous file"],
      ["gg / G", "first / last hunk"],
      ["r", "reload"],
      [DESKTOP_KEYS.scope, "pending / branch changes"],
    ],
  },
  {
    title: "Commits",
    keys: [
      [DESKTOP_KEYS.commitTab, "Changes / Commit sidebar"],
      [DESKTOP_KEYS.commitAction, "Propose / commit checked groups"],
      ["Space", "toggle the focused file or proposal checkbox"],
    ],
  },
  {
    title: "Comments",
    keys: [
      ["a", "add a comment on this hunk"],
      ["Enter", "save · Shift+Enter new line · Esc cancel"],
      ["} / {", "next / previous commented hunk"],
      ["d", "delete a comment on this hunk"],
    ],
  },
  {
    title: "Workspace",
    keys: [
      ["S", "focus the tickets; again to hide them"],
      ["j / k", "select a ticket"],
      ["Enter", "show its overview"],
      ["Esc", "back to the diff"],
    ],
  },
  {
    title: "View",
    keys: [
      ["F11", "toggle fullscreen"],
      ["Ctrl+, / Cmd+,", "open settings"],
      ["Tab / Shift+Tab", "next / previous control; Enter activates"],
      ["x", "show / hide the overview"],
      ["s", "show / hide the changed files"],
      ["1 / 2", "split / stacked diff"],
      ["t", "next theme"],
      ["?", "this help"],
    ],
  },
];
