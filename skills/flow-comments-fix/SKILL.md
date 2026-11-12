---
name: flow-comments-fix
description: Read and address the user's flow review comments (`flow comments`, `.flow/comments.json`), resolving each one as it is fixed. Use when the user says "flow", "lee flow", "flow comments", "resuelve los comentarios", or a watcher event reports new flow comments.
---

# Flow review

flow is a terminal diff viewer where the user leaves inline review comments. The TUI is for the user: never run `flow diff`, `flow show`, or other interactive commands. Comments live in `.flow/comments.json` at the repo root (local and gitignored; deleted when the last comment is resolved). Drive them through `flow comments`; edit the JSON by hand only when the binary is missing.

## Workflow

1. `flow comments list`. If it says "No pending comments.", tell the user and stop. Skip comments marked `(agent)` (you wrote them) and comments that already carry your `↳` reply: they are waiting for the user to read them and close them.
2. For each remaining comment, in id order:
   - `flow comments show <id>` for the comment plus surrounding code. The comment covers the whole hunk `range`, not one line. Comments are often in Spanish and terse; read the intent.
   - Fix the underlying issue (Read/Edit). If the comment is a question rather than a request, answer it instead.
   - Right after that comment is handled, reply to it with `flow comments reply <id> "<text>"`, in the comment's language. Do not resolve it; the user closes comments in the TUI once they agree. Resolve only when the user asks you to.
     - Short answers go in the reply itself: one line saying what changed, or a direct answer with its reason.
     - Long answers go in chat: explanations, options to choose from, multi-step reasoning, anything past a line or two. Reply only with a pointer, e.g. `respondido en la terminal`, so the user knows where to look.
   - When an answer is about specific code, show it in the user's open review with `flow focus <file>:<line>`; the review jumps there. Use it once per point, not on every comment.
3. Leave the fixes uncommitted. Never commit, fixup or rebase unless the user asks; instead say which branch commit each fix would belong to. Only when a comment explicitly asks to commit (e.g. "comitea donde toque"), fold the fixes into their commits as described below.
4. Run the checks the repo requires for the changed files (see the project's CLAUDE.md).
5. Report one short paragraph in chat: what changed per comment, cited as `file:line`, no code snippets. Mention when history was rewritten, since that requires a force push.

`show` usually carries enough context; read the whole file only when the change spans far outside the hunk.

## Triggered by the watcher

`flow watch` (or `flow watch`) prints one line per event. Neither is a user message, and neither may derail current work: if you are mid-task, finish the current step, handle the event, then resume the task where it left off. If idle, handle it right away.

- `new flow comments: <ids>` — run this workflow.
- `flow request: ticket-context <ID>` — the user switched to that ticket in flow and its branch is already checked out. Load and summarize its context (the `flow-ticket-context` skill, if available). Do not switch branches, stash, or start other skills for it.
- `flow request: commit [<ID>]` — the user pressed `C`: propose and make the commits with the `flow-commit-create` skill, if available; it waits for approval.
- `flow request: mr-open [<ID>]` — the user pressed `P`: open the MR with the `flow-mr-open` skill, if available; it asks before every outside action.
- `flow request: review <ID> [!<iid>]` — the user pressed `R`: review that ticket's code (the MR, else its branch) against the ticket with the `flow-review` skill, if available. Read-only: do not switch branches, stash, or post anything to GitLab or YouTrack.

## Folding fixes into existing commits (only when asked to commit)

When the user asks to commit, they prefer fixes in the commit where the code belongs, not new "address review" commits.

- Find the owning commit: `git log --oneline main..HEAD -- <file>`, and `git log -L` or `git show` to confirm which commit added the lines.
- One commit per owning commit: `git add <files>` then `git commit --fixup=<sha>`.
- Squash non-interactively: `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main`.
- If the fix spans lines from several commits, split it by commit. If no branch commit owns the lines (code from main), make a normal commit following the user's commit style.
- Never add a Co-Authored-By trailer.

## Rules

- Don't renumber or edit comments, and never touch the user's text. Besides fixes, your writes are replies and, to flag something in the review, your own comments: `flow comments add <file> <start-end> "<text>"` (anchored for you; shows as `Agente:`). Keep those for points worth reading beside the code; everything else goes in chat.
- A `drifted: ...` comment is still real (the anchor no longer matches: file removed, line out of range, or content moved). Re-read the surrounding code, address the intent, then resolve. Don't resolve just to make it disappear.
- `resolve` (only when asked) is all-or-nothing across the ids passed.
- No raw snippets in messages back to the user; cite `file:line`.

## CLI surface

```text
flow comments [list] [--json]            # pending comments + drift status
flow comments show <id> [--context N] [--json]   # one comment plus the hunk lines
flow comments reply <id> <text>          # answer a comment; it stays open for the user
flow comments add <file> <start-end> <text>   # leave your own comment, anchored automatically
flow comments resolve <id> [<id>...]     # atomically remove entries (only when asked)
flow focus <file>[:line]                 # make the open review jump to a file and line
flow watch                               # stream events for the agent's terminal
flow skill show                          # print these instructions for the installed version
```

- `list` prints `#<id>  <file>:<start-end>` and the indented body; drifted entries show `drifted: missing-file | out-of-range | anchor-mismatch`.
- `--json` on `list` returns `{ schema, comments: [{ id, file, line, range, anchor, body, author?, replies?, state, reason? }] }` (`author` is `"user"` or `"agent"`; absent means the user), where `replies` is `[{ author: "agent", body }]`; on `show` it adds `context: { window, total, lines: [{ number, text, inRange }] }`.
- Missing ids in `show`/`resolve` exit non-zero and write nothing.

## Fallback: editing `.flow/comments.json` directly

Only when the binary is unavailable: to reply, append `{ "author": "agent", "body": "…" }` to the comment's `replies` array (create it if missing); to resolve, drop the matching entry from `comments`, keep the other ids as they are, and write the file back as one JSON document with a trailing newline. `line` and `anchor` are internal drift-detection data; don't navigate by them.
