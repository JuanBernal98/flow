# Desktop review rules

- Keep the desktop review-first and follow the terminal's interaction model and architectural rules.
- Every primary action must work with both mouse and keyboard. Route hotkeys through the same action as the visible control; respect disabled and busy states and text editors.
- Document every desktop shortcut in `?`, including panel navigation, commit actions, view scope, settings, and native window actions. Keep help and visible key hints aligned through shared shortcut definitions.
- Keep UI updates local to the pane that changed. Poll only while awaiting an agent response or execution; identical responses must not redraw the review stream.
- Render the final theme on the first paint. Prepare local review data ahead of remote integrations and avoid flashing placeholder layouts during startup.
- Verify desktop rendering and interaction in a real browser, including narrow panes, split diffs, long lines, and keyboard/mouse parity. Preserve the terminal implementation when changing desktop code.
