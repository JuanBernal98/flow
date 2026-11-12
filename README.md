# flow

![flow: your tickets and reviews, the agent's overview of the ticket, the live diff of your branch, and its file tree](assets/flow-screenshot.png)

Work your tickets with a coding agent from one terminal: your YouTrack tickets and your squad's GitLab reviews beside a live diff of your branch, what the agent understood about each ticket, and Claude Code skills that load a ticket's context, review code against the ticket, fix your review comments, and open the merge request.

`flow` is a hard fork of [dunk](https://github.com/amix/dunk) (itself a fork of [hunk](https://github.com/modem-dev/hunk)). The diff viewer comes from dunk: `diff`/`show`/`patch`/`pager`/`difftool`, split and stack layouts, hunk comments with `a`, drifted comments, the Git pager setup, and the general config. **See [dunk's README](https://github.com/amix/dunk#readme) for those.** This README covers what flow adds.

## Install

Clone the repository and install it with [bun](https://bun.sh), so you always run (and can change) the code on `main`:

```bash
git clone https://github.com/JuanBernal98/flow.git
cd flow && ./install.sh     # dependencies, the `flow` command, and Claude Code setup

cd ~/code/your-repo
flow init                   # connect a repository: YouTrack, GitLab, and Slack for your squad
```

You need macOS or Linux, Git, [bun](https://bun.sh), and [Claude Code](https://claude.com/claude-code). Everything else flow needs, setup checks and helps with: [`glab`](https://gitlab.com/gitlab-org/cli) and its login, your YouTrack token, and the YouTrack, Notion, and Slack connectors in Claude Code. If your company puts GitLab behind an access proxy such as Cloudflare Access, set that up first, following your company's guide: `glab` cannot reach GitLab without it. For each missing item setup says what it is for and shows the exact command it would run, and only runs it if you answer yes; answering no stops setup before anything is installed. What it cannot do for you, like authorizing Notion and Slack in the browser, it explains and then checks again. Anything already there is left as it is.

To update, pull and run the installer again; it only rewrites flow's own entries:

```bash
git pull && ./install.sh
```

## Set up Claude Code

`flow setup claude` installs everything Claude Code needs to work with flow, straight from your checkout:

- **Skills**: a stub per bundled skill in `~/.claude/skills/`. Each keeps the skill's name and description and tells Claude to print the real instructions with `flow skill show`, so they always match the flow you have.
- **Session hook**: a SessionStart hook in `~/.claude/settings.json` running `flow hook session-start`. In every git repository it asks Claude to keep `flow watch` running and says which skill handles each event (see [Events](#events)).
- **Cleanup**: re-running setup removes stubs for skills flow no longer ships. Skills and hooks that are not flow's are never touched.

Before installing anything it checks what flow and the skills need. **All of them are required**: while one is missing, setup installs nothing, lists what to fix, and exits with an error.

| Check             | Needed for                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| `bun`             | flow itself                                                                |
| `glab`, logged in | MR links, Reviews, `flow-mr-open`, `flow-review`                           |
| YouTrack token    | workspace tickets, `merged_state`                                          |
| YouTrack MCP      | `flow-ticket-switch`, `flow-ticket-context`, `flow-review`, `flow-mr-open` |
| Notion connector  | `flow-ticket-context` reading linked pages                                 |
| Slack connector   | `flow-mr-open` posting the review request                                  |
| `claude` on PATH  | checking the connectors above                                              |

Connectors are read from `claude mcp list`; connect a missing one with `/mcp` in Claude Code. The skills check them too, and stop instead of working with half the context.

```bash
flow setup claude --dry-run     # show what would change, write nothing
flow setup claude --uninstall   # remove flow's skills and hook
```

Setup uses `$CLAUDE_CONFIG_DIR` instead of `~/.claude` when it is set. Open a new Claude Code session afterwards to pick up the changes.

## Connect a repository

Integrations are per repository and live in its own `.flow/config.toml`, so each squad sets its own. A repository without these sections connects to nothing and flow opens there as a plain diff viewer.

Run `flow init` inside the repository. It asks for your YouTrack URL, the state merged tickets move to, and optionally your squad's ticket prefixes (so `UTF-8` in an MR title or another squad's ticket is never taken for yours), your squad's GitLab review label, and its Slack review channel and channel ID, and checks each answer where it can: the URL must answer with your token, the state and the projects must exist in YouTrack, and `glab` must find the label. It writes the config with a comment on every option and adds `.flow/` to `.git/info/exclude`, since `.flow/` also holds your review comments, the agent's requests, and ticket overviews. Run it again any time: it only asks for the sections the config is missing.

The result looks like this, and you can edit it by hand:

```toml
# <repo>/.flow/config.toml
[youtrack]
url = "https://youtrack.example.com"   # your tickets in the workspace
merged_state = "Done"                  # optional: move my merged tickets out of Review
project_keys = ["PROJ"]                # optional: only these projects' ids count as tickets in MRs

[gitlab]                               # MR links on tickets, through `glab`'s login
review_label = "my-team"               # optional: list this label's MRs under Reviews

[slack]                                # required by the `flow-mr-open` skill; flow itself never reads it
review_channel = "#team-reviews"
review_channel_id = "C0000000000"
```

Team details stay in this local file, so the skills in `skills/` carry no company-specific names, URLs, or channel IDs.

**GitLab** goes through the `glab` CLI: log in with `glab auth login` and flow resolves the project from the repository's remote.

**YouTrack** needs a permanent token (profile → Account Security → Tokens, scope YouTrack). `flow setup claude` offers to store it for you. By hand, on macOS it goes in the Keychain; `-w` with no value prompts for it hidden, so it never lands in your shell history (`-U` replaces an old one):

```bash
security add-generic-password -a "$USER" -s flow-youtrack -w
```

On macOS nothing needs exporting. Linux has no Keychain, so there you set `FLOW_YOUTRACK_TOKEN` in your shell profile instead (it also overrides the Keychain for one-off runs). The token is only sent to the configured URL over HTTPS and never written to `.flow/` or logs; the instance URL only ever comes from the repository's config.

**YouTrack MCP.** The skills read tickets through YouTrack's own MCP server, which Claude Code connects to separately from flow. `flow setup claude` offers to add it, asking only for the URL and reusing the token you stored for flow (it is read from the Keychain and never shown). By hand, add it once for every project:

```bash
claude mcp add --transport http -s user youtrack https://youtrack.example.com/mcp \
  --header "Authorization: Bearer <your token>"
```

Check it with `claude mcp get youtrack` (it should say `Connected`). The token ends up in Claude Code's user config, so treat that file like the Keychain item: never paste its contents anywhere.

**Notion and Slack** are claude.ai connectors: connect them with `/mcp` inside Claude Code, with the account that can see your team's Notion pages and review channel.

## Workspace

In a connected repository the workspace and the ticket Overview open beside the review:

- **To do**: unresolved tickets assigned to you.
- **Needs approval**: your tickets in the `Review` state.
- **Ready to merge** (`✓`): tickets in `Review` whose MR someone besides you approved. Shown only while it has tickets.
- **Reviews**: your squad's MRs (labelled `review_label`) that still wait on a first review, written by someone else, touched in the last 14 days. Ones that ask you for review come first.

Cards show the ticket's MR (`!iid`) and the lines its branch changes; review cards show the ticket their MR names, read from the branch or the title.

| Key       | Action                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `S`       | focus the workspace; again to hide it                                                                      |
| `j` / `k` | move the cursor                                                                                            |
| `/`       | filter cards by ticket, MR number, title, or author (↑/↓ pick a match, Enter or Esc ends the search on it) |
| `Enter`   | switch to the card's branch                                                                                |
| `h` / `g` | open the ticket in YouTrack / its MR in GitLab (`g` asks GitLab again for an MR opened since)              |
| `x` / `X` | toggle the Overview / ask the agent to (re)write it                                                        |
| `R`       | ask the agent to review the code against the ticket                                                        |
| `C`       | ask the agent to propose commits for your uncommitted work, then make them once you confirm                |
| `P`       | ask the agent to open the merge request                                                                    |
| `r`       | reload everything: the diff, tickets, reviews, and MRs                                                     |
| `B`       | review the whole branch or only uncommitted changes                                                        |

Outside the workspace, `h`, `g`, and `R` act on the checked-out ticket; `C` and `P` always do, since commits and the MR belong to the branch you are on.

### Switch to a ticket

`Enter` checks out the card's branch and reloads the review on it:

- a local `ID` or `ID-…` branch is switched to;
- a branch that only exists on `origin` is checked out tracking it;
- otherwise a new `ID` branch is created from `origin/main` (not tracking it);
- a review checks out the MR's source branch and diffs it against the MR's target.

If several branches match, flow picks the branch of the MR shown on the card, else the one with the newest commit.

Uncommitted changes, untracked files included, are stashed as `flow:<branch>` before the switch and restored when you come back to that branch from flow. If restoring conflicts, the stash is kept and the status bar says so. They are ordinary `git stash` entries.

### Merged tickets move on by themselves

With `merged_state` set, every load (start, `r`) moves your tickets still in `Review` whose MR is merged to that state, and the status bar says which. Before moving one, flow reads it again and only moves it if it is still assigned to you and still in `Review`; a ticket with an MR still open is left alone, and each ticket is tried once per session. Remove the line to turn it off.

## Overview

The Overview pane (`x`) shows what the coding agent understood about the checked-out ticket: the goal in one sentence, why, what to do, acceptance criteria, where in the code, questions and assumptions, and a plan. flow adds the live facts on top (state, MR, line totals, how old the overview is and how many commits came since), so they never go stale.

The agent writes it with `flow overview write <ticket>` (JSON on stdin, validated) into `.flow/overviews/<ticket>.json`. Switching to a ticket without an overview asks the agent for one; a ticket that has one keeps it, and `X` refreshes it. On a review, the Overview shows the ticket the MR names, without "Where in the code" and "Plan", since a review is judged against the ticket's goal.

## Review the whole branch

`flow diff` reviews everything on the current branch against its base, live: commits, staged and unstaged edits, and untracked files. `B` switches to uncommitted changes only and back, and the status bar always says which (`Diff mode: Branch vs origin/main` / `Diff mode: Uncommitted`). The base is `--branch=<ref>`, else `[branch_review] base` in `.flow/config.toml`, else `origin/HEAD`, else the first of `origin/main`, `main`, `origin/master`, `master`, `origin/trunk`, `trunk`.

## Work with Claude Code

### Skills

| Skill                 | What it does                                                                                                                                                                                    | Runs                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `flow-ticket-switch`  | lists your tickets, switches to the chosen one's branch, loads its context                                                                                                                      | `/flow-ticket-switch [ID]`                     |
| `flow-ticket-context` | reads the ticket, its parent, linked Notion pages, every comment, and `AGENTS.md`, writes the Overview, and summarizes                                                                          | on a ticket switch without an overview, or `X` |
| `flow-review`         | reviews a branch or MR against the ticket's scope: acceptance criteria met or missed, what it does beyond the ticket, then bugs and obvious simplifications                                     | `R`                                            |
| `flow-comments-fix`   | fixes your review comments, replies on each, and resolves them                                                                                                                                  | when you leave comments                        |
| `flow-commit-create`  | groups your uncommitted changes by feature, shows the commit messages in the repo's format for you to confirm, then commits them (fixes go into the branch commit they belong to); never pushes | `C`                                            |
| `flow-mr-open`        | creates the MR, posts the review request to `[slack]`, and moves the ticket to `Review`, each only after you approve it                                                                         | `P`, or `/flow-mr-open`                        |

`flow-ticket-context` and `flow-review` are read-only and run in a forked context, so what they read never fills your conversation. Only `flow-ticket-switch` (branches), `flow-commit-create` (commits), and `flow-mr-open` (GitLab, Slack, YouTrack) change anything, and the last two only after you confirm.

The skills live in `skills/` and print with `flow skill show <name>`. To use them with another agent, point its skills at that command rather than copying them, and pass the arguments along: the skills call them `<argumentos>`.

### Events

`flow watch` prints one line per event; the session hook keeps it running in Claude Code, which runs the matching skill:

```text
new flow comments: 3 4                 # you left comments           → flow-comments-fix
flow request: ticket-context PROJ-123  # you switched ticket, or X    → flow-ticket-context
flow request: review PROJ-123 !4100    # you pressed R               → flow-review
flow request: commit PROJ-123          # you pressed C               → flow-commit-create
flow request: mr-open PROJ-123         # you pressed P               → flow-mr-open
```

Each event is printed once. Starting another `watch` for the same repo stops the previous one, so re-arming never doubles events. The watcher costs no tokens while nothing happens; Claude only spends them on an event and when it re-arms the watch every 30 minutes.

### Comments both ways

On top of dunk's hunk comments, the agent answers in the review: `flow comments reply <id> "…"` shows its reply under your comment, chat-style, and the agent can leave its own comments for you. `flow focus src/app.ts:42` makes your open review jump to that line, so the agent can show you the code it means.

## Development

```bash
bun run src/main.tsx -- diff   # run from source
bun test                       # unit + CLI tests
bun run test:integration       # PTY tests (never reach a real YouTrack)
```

`flow` runs the source directly, so code changes apply on the next launch. See [`AGENTS.md`](AGENTS.md) for architecture and conventions.

## License

[MIT](LICENSE), same as upstream dunk and hunk.
