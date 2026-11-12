# Changelog

All notable user-visible changes to `flow` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`flow` is a hard fork of [`dunk`](https://github.com/amix/dunk), which was hard-forked from [`hunk`](https://github.com/modem-dev/hunk) at version `0.11.0`. Entries before the rename below still say `dunk`; pre-fork history is preserved upstream.

## [Unreleased]

### Added

- `[youtrack] project_keys` (asked by `flow init`, checked against YouTrack) limits which ids count as a review's ticket, so `UTF-8` in an MR title or another squad's ticket is never taken for yours. Without it any `KEY-123` counts, as before.

- `./install.sh` installs flow from a fresh clone in one go: dependencies, the `flow` command, and `flow setup claude`. Setup now offers to fix each missing dependency instead of only listing it — `brew install glab`, `glab auth login`, storing the YouTrack token in the Keychain, and adding the YouTrack MCP with that token — always showing the exact command and running it only after a yes; a no stops setup before anything is installed. Notion and Slack, which need the browser, are explained and checked again. Anything already set up is left alone.

- `flow init` connects a repository: it asks for the YouTrack URL and merged state, the squad's GitLab review label, and its Slack review channel and ID, checks them against YouTrack and GitLab, writes a commented `.flow/config.toml`, and adds `.flow/` to `.git/info/exclude`. Re-running it only asks for missing sections.

- `C` asks the coding agent to commit your uncommitted work: the new `flow-commit-create` skill groups the changes by feature, lists the commit messages in the repo's own format for you to confirm, folds fixes into the branch commit they belong to, and never pushes. `P` asks it to open the merge request with `flow-mr-open`, which still asks before every outside action. Both act on the checked-out branch, and the controls help now groups the workspace keys under **Workspace**, `h`/`g` under **Browser**, and everything you ask the agent for (`X`, `R`, `C`, `P`, all uppercase so they are not pressed by accident) under **Agent actions**.

- `flow setup` installs flow's skills and SessionStart hook into Claude Code from your checkout, removes stubs for skills flow no longer ships, after checking the dependencies, all required: bun, `glab` login, the YouTrack token, and the YouTrack, Notion, and Slack connectors. While one is missing it installs nothing and exits with an error; `flow-ticket-context` and `flow-mr-open` likewise stop without Notion or Slack (and `[slack]` in the config). `--dry-run` previews, `--uninstall` removes. The hook runs `flow hook session-start`, so its text is versioned with flow.

- `[youtrack] merged_state` (e.g. `"Done"`) moves your tickets still in `Review` to that state once their MR is merged, on every load, so a merge done in GitLab never leaves the ticket behind. Each ticket is read again first and only moved while it is still assigned to you and in `Review`; tickets with an MR still open are left alone. Off unless set.

- **Ready to merge** section in the workspace, after Needs approval: your tickets in `Review` whose MR someone besides you approved move there with a `✓`. It only appears while it has tickets.

- `B` switches a `flow diff` review between the whole branch and uncommitted changes only, in place; the status bar always says which (`Diff mode: Branch vs origin/main` / `Diff mode: Uncommitted`).

- `claude` theme: an iTerm profile's background, text, and ANSI palette with Claude Code's accents (Claude orange, lavender, its diff greens and reds). It follows the terminal's light or dark mode; `claude-dark` and `claude-light` pin one.

- The `claude` themes highlight code exactly like Claude Code (its "Monokai Extended" palette in dark, "GitHub" in light) and color diff rows with the near-transparent green and red tints Claude Code's diff highlighter uses, plus its word and sign colors. Themes can now pick their own syntax theme (`codeTheme`) instead of Pierre's default.

- Added the `zed` theme, adapted from Zed's official One Dark palette. Select it with `--theme zed`, config, or the theme cycle shortcut.

- File list beside the review with keyboard navigation (`F` to focus, arrows or `j`/`k` to move, Enter to open, Escape to return to review).

- Workspace beside the file tree, open by default, with Tasks and Reviews, minimal section headings with counts, status symbols, task line-change counts, mouse selection, and keyboard navigation (`S` to toggle). Hides automatically on narrow terminals.

- Workspace tickets link to your GitLab merge request through their branch name (read with `glab`), show its `!iid` on the card, and `g` opens it in the browser. `h` and `g` work from anywhere: on the cursor's ticket in the workspace, otherwise on the checked-out one (`gg` still jumps to the first hunk).

- Workspace Reviews list the open GitLab merge requests labelled `[gitlab] review_label` (e.g. `my-team`) that still wait on a first review: open, not drafts, written by someone else, approved by nobody but their author, and changed in the last 14 days, with the ones asking you for review first. Each review card shows its YouTrack ticket beside the `!iid` (read from the branch, else the MR title), and `h` opens it. Enter checks the MR's branch out locally exactly like a ticket switch: your uncommitted work is parked as `flow:<branch>` and comes back when you return.

- Overview pane (`x`), wider than the workspace, showing what the coding agent understood about the ticket: one-sentence goal, why, what to do, acceptance criteria, where in the code, questions and assumptions, and a plan, under live state, MR, and line totals. The agent stores it with `flow overview write <ticket>` (JSON on stdin, validated) in `.flow/overviews/`; `X` asks the agent to write it for the ticket shown. It always shows the checked-out ticket or review, so moving the workspace cursor never replaces it. On a review card it shows the overview of the ticket the MR names, without "Where in the code" and "Plan", since a review is judged against the ticket's goal.

- `R` asks the coding agent to review a ticket's code against the ticket: a teammate's MR from Reviews, or your own branch (and its MR, if any) from To do. The agent gets `flow request: review <ID> [!<iid>]` and runs the bundled read-only `review` skill, which treats the ticket as the source of truth and reports which acceptance criteria the code meets, misses, or goes beyond, plus a few obvious simplifications.

- The `ticket-context` skill reads every comment on the ticket and its parent (not just the latest 10) and the open comments on linked Notion pages, since decisions often live there; the newest one wins when a comment contradicts the description.

- `/` in the workspace filters its cards by ticket (including the one a review names, e.g. `OPS-12`), MR number (`4100` or `!4100`), title, or author. ↑/↓ pick among the matches while typing. Enter (or Escape) ends the search and shows every card again with the cursor still on the chosen one, without switching branches; the next Enter switches to it. Outside the workspace, `/` still filters files.

- The `ticket`, `ticket-context`, and `mr` agent skills now ship in `skills/` next to `flow-review`; `flow skill show <name>` and `flow skill path <name>` print any of them.

### Changed

- **Security:** the YouTrack token is bound to its server. The Keychain item is now `flow-youtrack:<host>`, and on Linux `FLOW_YOUTRACK_TOKEN` counts only for the host in `FLOW_YOUTRACK_URL`; a repository whose config points anywhere else finds no token, so nothing is sent there. Requests never follow redirects. The skills that read tickets, Notion, or MRs now treat that content as data, never as instructions.

- `flow setup claude` is now `flow setup`, and it also runs `bun install` in flow's checkout. Updating flow is `git pull`: skills and the session hook are read live, and when a pull adds or retires a skill, flow says at launch to run `flow setup`.

- Setup asks for the YouTrack URL once and remembers it (`[defaults] youtrack_url` in the user config, also taken from an existing YouTrack MCP), so `flow init` offers it in every repository; before storing the token it offers to open YouTrack's token page in the browser. `flow init` no longer asks for the Slack channel ID: `flow-mr-open` looks the channel up by name (`review_channel_id` still wins when set). `./install.sh` offers to add `~/.local/bin` to your shell profile, showing the line and asking first.

- Agent skills are renamed with the category first so they group and never clash with other skills: `flow-review` → `flow-comments-fix`, `ticket` → `flow-ticket-switch`, `ticket-context` → `flow-ticket-context`, `review` → `flow-review`, `mr` → `flow-mr-open`. Run `flow setup claude` to move your stubs and SessionStart hook to the new names; `flow skill show` without a name now prints `flow-comments-fix`. The watcher's event lines are unchanged.

- Switching to a ticket that already has an overview no longer asks the agent for its context again, to save tokens. Press `X` to refresh it.

- `r` reloads everything from anywhere: the diff and the workspace's tickets, reviews, and MRs, whatever has focus. Loaded tickets and reviews stay on screen while they reload instead of blanking the workspace.

- A bare `flow diff` reviews the whole branch against its base and reloads as code changes, as if run with `--branch --watch`. `--no-branch` and `--no-watch` (or `watch = false`) opt out; a repository with no base to compare against reviews uncommitted changes.

- flow no longer checks npm for updates at startup: it made a network request on every launch, and after the rename it would have asked about an unrelated `flow` package.

- YouTrack and GitLab are configured per repository, in its `.flow/config.toml` (`[youtrack] url`, `[gitlab]` with an optional `review_label`), no longer in the global config or `FLOW_YOUTRACK_URL`. A repository without them makes no YouTrack or GitLab calls and opens with the workspace and Overview closed; `S` and `x` still open them.

- Renamed the fork from `dunk` to `flow` everywhere: the `flow` command, the `.flow/` folder in each repo (comments, overviews, agent requests, config), `~/.config/flow/config.toml`, `FLOW_*` environment variables, the `flow` package, and the `flow-review` agent skill.

- The file tree leaves a blank column between the selection rail and each file's icon, like the workspace's ticket rows.

- Lines skipped between two hunks show `...` in the line-number column instead of a rule across the code, so a jump like 25 → 27 reads as skipped lines.

- The file tree now sits at the far right, after the diff; drag its left edge to resize it.

- On a review, `h` opens the YouTrack ticket named in its branch or title (like `PROJ-20805`) and `g` the MR, matching tickets.

- A ticket split over several branches no longer refuses to switch: Enter goes to the branch of the MR shown on its card, otherwise to the branch with the newest commit.

- Start with the file tree and the ticket Overview open; `s` and `x` toggle them, `F` focuses the tree, and `file_tree` / `overview` in config (or `--no-file-tree` / `--no-overview`) start them closed.

- Start in stack layout by default; config, CLI, and layout shortcuts still override it.

- Keep Tasks and Reviews on the main background, separated from navigation by an empty gutter. The file list's edge supports drag resizing.

- Refined diff presentation with emphasized filenames, muted directory paths, tighter header stats, neutral line numbers, and quieter file separators.

- Move per-file line-change counts into the file tree's `N Changes` heading to leave more room for filenames.

- Use Zed One Dark as the default theme unless overridden by config or CLI.
- Add a Changes heading and file count above the file tree, matching the workspace section headings.

- Diff rows no longer draw a colored rail on their left edge. The lead column takes each row's own background, so the diff reads without a border; this also applies to the static pager output. The active hunk now stands out by keeping full-color `+`/`−` signs and line numbers, while other hunks fade theirs.

- Stack view with line numbers (`l`) shows one number column instead of two: the new-file number, or the old one for deleted lines. The narrower gutter leaves more room for code, and the static pager matches.

- In split view, each side lists its lines back to back within a hunk, so a deleted line no longer leaves a gap on the right (and an added line none on the left). The shorter side pads only at the bottom of the hunk, on the plain pane background.

- Each file in the review is drawn as a card. File headers lead with the filename and follow with its folder, starting where the card's code block starts; hunks inside a file are separated by a quiet rule; files are separated by blank rows; and the review starts one row down, level with the side panes' headings.

- Diff rows no longer show `+`/`-` signs; the row tint marks additions and deletions. Line numbers are on by default and sit outside the card, in a margin of fixed width (at least four digits) that stays reserved when they are hidden, so code never shifts when toggling them.

- Hunk `@@` ranges are hidden by default (`m` shows them), and folds at the very top or bottom of a file no longer take rows.

- The file list is flat: filenames only, in review order, with no folder headings or indentation. A file's folder appears, muted, only when another changed file shares its name. States read by shape and color (`○` modified, `+` added, `−` deleted, `→` renamed, `◌` untracked), and the list sits on the same base surface as the workspace, with the same gap before the diff.

- The file tree opens at the same width as the tasks workspace, so both columns line up; it can still be resized by dragging its edge.

- `flow focus <file>[:line]` lets an agent make the open review jump to a file and line, through `.flow/focus.json`; the status bar says where it was sent.

- Comment cards read like a chat on a purple surface in every theme: `Yo:` with your comment in a softer color, then `Agente:` with each agent reply in the normal text color. The accent bar is gone.

- Comments record who wrote them (`author`: `user` or `agent`). `flow comments add <file> <start-end> <text>` lets an agent leave its own comment, anchored automatically; it renders as `Agente:`, shows as `(agent)` in `flow comments list`, and `flow watch` does not announce it back to the agent.

- Agents can answer review comments with `flow comments reply <id> <text>`. Replies show under the comment, marked `↳` in `flow comments list`/`show`; the comment stays open until you close it.

- `flow skill show` prints the bundled review skill, so an agent's skill can point at the installed version instead of a copy that drifts. The skill now covers the watcher events and asks for fixes to stay uncommitted unless the user asks to commit.

- `flow watch` streams review events for a coding agent's terminal: new comments and flow requests, each printed once. A newer watcher for the same repo replaces the previous one, and delivered requests are not replayed.

- After switching to a ticket, flow writes a `ticket-context` request to `.flow/requests.json`, keeping only the newest one, so a coding agent watching the file can load that ticket's context in its own terminal.

- Workspace ticket cards with a branch show, at their right edge, the lines it changes against `origin/main`; the checked-out ticket also counts uncommitted edits.

- `S` focuses the workspace when it is open but unfocused, and hides it when it is already focused. The ticket of the checked-out branch keeps a solid rail, one column away from its icon, wherever the cursor moves and even when the pane is unfocused; the cursor itself is a faint background shown only while the pane is focused, and it starts on that ticket when tickets load.

- `bun run install:bin` installs the local source as `flow` instead of `flow`, so it can live next to a released `flow`.

- The workspace lists real YouTrack tickets: unresolved tickets assigned to you under **To do**, and those in the `Review` state under **Needs approval**. With the workspace focused, press `h` to open the selected ticket in the browser or `r` to reload. `Enter` switches to the ticket's branch (creating it from `origin/main` if needed). Uncommitted changes are stashed per branch on the way out and restored automatically when you return to that ticket. Set the instance under `[youtrack] url` and the token in the Keychain item `flow-youtrack`; see the README.

### Fixed

- Moving merged tickets to `merged_state` failed with "YouTrack responded 400": the command wrapped the state in braces (`State {Done}`), which YouTrack rejects. It now sends `State Done`, and YouTrack errors show its reason instead of only the status code.

- `g` on a ticket whose MR was opened after flow started now asks GitLab again and opens it, instead of doing nothing until the tasks were reloaded.

- Clicking into the diff no longer makes arrow keys scroll it while you move through the workspace's tickets: panes no longer take keyboard focus on click.

- Rewritten lines no longer show as a solid block of the strong word-diff color: words are only emphasized when part of a line changed, so mostly-new lines keep the softer row tint.

- Reviews of stacked MRs only show the MR's own changes: checking one out records its target branch as the branch's review base (`branch.<name>.flowBase`), which `diff --branch` uses instead of `origin/main`.

- Adding a comment no longer scrolls the review: the status bar confirms it, and the view stays put.

- Switching tickets no longer fails with "could not write index" while the review is open: flow's git reads skip optional index locks, and a switch briefly retries when another process holds `index.lock`.

- `--watch` no longer freezes the UI in large repos: change checks run their git processes in a worker thread, once a second and never overlapping, instead of blocking rendering and input four times a second.

- Keep file tree rows at a consistent height and calculate filename space from the pane width without stacking padding deductions.

## [0.16.0] - 2026-11-10

### Changed

- Updated the diff engine (`@pierre/diffs` 1.6) and terminal UI framework (OpenTUI 0.1.101). Syntax colors are remapped so headings and similar tokens still stay clear of the add/remove diff colors.
- Removed the `dunkdiff/opentui` `DunkDiffView` component and its docs. They were documented, but the published `dunkdiff` package never shipped the export, so nothing could import it.

### Fixed

- `--watch` now reloads when a tracked file that is already modified is edited again. Previously only the first edit to a file registered, so a coding agent's follow-up edits to the same file never showed up until you pressed `r`.
- `dunk diff --branch --watch` now reloads when branch history changes under a clean working tree (commit, reset, rebase, checkout). A base ref that moves, e.g. after `git fetch`, still needs `r`.
- `watch = true` in config no longer breaks `dunk pager` and `dunk patch -`. With `core.pager = "dunk pager"`, every `git diff` used to fail with "`--watch` requires a file- or Git-backed input"; stdin input now just opens unwatched. Passing `--watch` explicitly with stdin is still an error.
- `dunk pager` no longer re-launches itself when `$PAGER` points back at `dunk pager` and the input isn't a diff; it falls back to `less -R`.
- `dunk skill path` finds the bundled skill when the prebuilt binary runs straight from a flat `node_modules` install. It was looking for a `dunk` package instead of `dunkdiff`.

## [0.15.1] - 2026-05-19

### Changed

- `.dunk/comments.json` is now deleted when the last comment is resolved instead of leaving an empty `{ "comments": [] }` file. Reads already treat a missing file as "no comments", so an empty review leaves no artifact for a coding agent or human reviewer to reason about.

## [0.15.0] - 2026-05-19

### Changed

- `dunk diff` now reviews staged **and** unstaged changes together (working tree vs `HEAD`), so a quick `dunk diff` shows everything you've touched since the last commit, including changes you've already `git add`ed. Untracked files are still included. Use `dunk diff --staged` (or `--cached`) for index-vs-`HEAD` only, and the new `dunk diff --unstaged` for working-tree-vs-index only. In a repo with no commits, `dunk diff` diffs against the empty tree so staged-but-uncommitted files still show.

## [0.14.0] - 2026-05-16

### Added

- `watch = true` in `.dunk/config.toml` (or `~/.config/dunk/config.toml`) now enables watch mode without passing `--watch` every time. The `--watch`/absence of it on the command line still overrides the config value.
- Ctrl-Z suspends `dunk` as a normal shell job (the terminal is restored, the process group gets SIGTSTP, and `fg` resumes the renderer). Previously Ctrl-Z was swallowed in raw mode and `dunk` could not be suspended. No-op on Windows.
- `,` and `.` jump to the previous / next file in the review stream (clamped at the ends), so you can skip whole files without stepping through every hunk. Shown in `?` help.
- Captured pager hosts (LazyGit, `git -c core.pager="dunk pager" log -p`, anything that pipes a custom pager into its own panel with `TERM=dumb`) now get a static, colored ANSI diff instead of a broken alt-screen attempt. Other non-TTY / dumb-terminal pipes echo the raw patch verbatim so the pager pipeline keeps working.

### Removed

- Jujutsu support. `dunk` now targets Git only — there's no more `vcs` config key, jj workspace auto-detection, or jj revset handling for `dunk diff`/`dunk show`. Use a colocated Git checkout if you work in jj.

### Fixed

- `}`/`{` (next/previous comment) now jump to the nearest comment relative to your position in the review stream. Pressing them from a hunk that has no comment of its own previously snapped to the first or last comment in the whole review instead of the closest one.
- Ctrl-C now exits through `dunk`'s ordered shutdown (renderer torn down, terminal screen restored) instead of OpenTUI's hard exit. `dunk` also shuts down cleanly on SIGINT/SIGTERM.

## [0.13.0] - 2026-05-14

### Added

- `dunk diff --branch[=base]` reviews everything that differs between the current branch and its base — committed, staged, unstaged, and untracked — in one pass. Resolution order: explicit `--branch=<base>`, then `[branch_review] base` in `.dunk/config.toml`, then `origin/HEAD`, then `origin/main`/`main`/`origin/master`/`master`/`origin/trunk`/`trunk`. The resolved base shows up in the status bar so auto-detection is visible. Works in both Git and Jujutsu (uses `fork_point(@ | "<base>")` for jj).

## [0.12.2] - 2026-05-11

### Fixed

- Preserve scroll position when a comment is added, edited, or deleted (and when `.dunk/comments.json` reloads externally). The review pane re-anchors on a surviving diff row so inserting or removing inline comment cards no longer pushes the code you were reading out from under the viewport.

## [0.12.1] - 2026-05-11

### Fixed

- Prebuilt npm release pipeline. `scripts/build-prebuilt-artifact.ts` was still looking for the binary at the pre-rename path (`dist/dunkdiff`) while `scripts/build-bin.sh` writes to `dist/dunk`, so every release run since the rename failed at the host-build step and nothing reached npm. `npm i -g dunkdiff` now resolves once this version publishes.

## [0.12.0] - 2026-05-11

First `dunkdiff` release after the hard-fork rename. Bundles the agent-facing CLI, on-disk comments model, startup perf work, and a polished comment UI.

### Added

- `dunk comments {list,show,resolve}` — first-class CLI for coding agents to inspect and resolve review comments without entering the TUI or hand-editing `.dunk/comments.json`. `show <id>` prints the comment plus 10 lines of post-image context (configurable via `--context <N>`); `resolve <id>...` is atomic and refuses partial success when an id is missing. `--json` on `list`/`show` returns a stable shape with drift state.
- Transient startup notice when a newer `dunkdiff` is published to npm — shows `dunk X.Y.Z is out — npm i -g dunkdiff to update` in the status bar a moment after launch. Network failures are silent; pager mode opts out.
- Inline review comments backed by a single committed `.dunk/comments.json` per repo, with anchor-based drift detection so comments survive small edits.
- Watch-mode integration: edits to `.dunk/comments.json` (e.g., from a coding agent fixing comments) refresh the diff in real time.
- Sample `skills/dunk-review/SKILL.md` describing the read/fix/prune loop for Claude Code / Codex agents.
- New keybindings: `a` to add a comment on the focused hunk, `d` to delete the focused comment, `D` to clear all drifted comments (with confirm — anchored review comments are left alone), `e` to open the focused file in `$EDITOR`, `J`/`K` (also `[`/`]`) to jump between hunks, `gg`/`G` to jump to the first/last hunk, `?` for help.
- Auto-copy on selection (configurable via `selection_auto_copy`, default on).

### Changed

- Renamed binary, npm package, and config directory from `hunk` / `hunkdiff` / `.hunk/` to `dunk` / `dunkdiff` / `.dunk/`.
- Default view preferences: word wrap on, line numbers off. Comments now render unconditionally — the `c` toggle, `--comments`/`--no-comments` flags, and `comments` config key are gone.
- Startup is ~4-5× faster on cold paths (`--help`, `--version`, `dunk comments {list,show,resolve}`, `dunk skill path`): ~120 ms → ~25 ms via `bun run`, ~480 ms → ~50 ms on the prebuilt npm binary. Heavy modules (OpenTUI, React, `@pierre/diffs`) are dynamic-imported only after the CLI parser decides we're launching the TUI.
- Inline comments and drifted-comment entries now share one body-first card design (`#id` metadata header, accent bar, wrapped prose). Drifted comments dock as their own section above the diff and accept click-to-select.
- Stripped the top menu bar in favor of a minimal status row with a `?` hint.
- File header now uses an accent background to anchor the eye while scrolling.
- Local install (`scripts/install-bin.sh`) uses a tiny shell wrapper around `bun run` instead of `bun build --compile`, cutting startup time roughly 6×.

### Removed

- Daemon, broker, and MCP session subsystems. Agent integration now flows through the on-disk comments file.
- Update-notice prompts.
- `--agent-context` CLI flag and the `AgentContext` sidecar JSON model.
- Dead `AgentCard` floating-popover surface — the inline `CommentCard` has been the canonical surface for a while.

[Unreleased]: https://github.com/amix/dunk/compare/v0.16.0...HEAD
[0.16.0]: https://github.com/amix/dunk/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/amix/dunk/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/amix/dunk/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/amix/dunk/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/amix/dunk/compare/v0.12.2...v0.13.0
[0.12.2]: https://github.com/amix/dunk/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/amix/dunk/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/amix/dunk/releases/tag/v0.12.0
