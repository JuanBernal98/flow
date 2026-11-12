# Examples

Ready-to-run demos for flow.

Each folder tells a small review story and includes the exact command to run from the repository root.

## Quick menu

| Example               | Best for                               | Command                                                                              |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `1-hello-diff`        | fastest first run                      | `flow diff examples/1-hello-diff/before.ts examples/1-hello-diff/after.ts`           |
| `2-mini-app-refactor` | realistic multi-file review            | `flow patch examples/2-mini-app-refactor/change.patch`                               |
| `3-agent-review-demo` | small refactor for agent review        | `flow patch examples/3-agent-review-demo/change.patch`                               |
| `4-ui-polish`         | screenshot-friendly TSX diff           | `flow diff examples/4-ui-polish/before.tsx examples/4-ui-polish/after.tsx`           |
| `5-pager-tour`        | line scrolling, paging, and hunk jumps | `flow diff --pager examples/5-pager-tour/before.ts examples/5-pager-tour/after.ts`   |
| `6-readme-screenshot` | README screenshot                      | `flow patch examples/6-readme-screenshot/change.patch --mode split --theme midnight` |

## Notes

- The patch-based examples include checked-in `change.patch` files, so you can open them without creating a temporary repo.
- The pager tour is intentionally taller than a typical terminal viewport so you can try `↑`, `↓`, `PageUp`, `PageDown`, `Home`, `End`, and `[` / `]` right away.
