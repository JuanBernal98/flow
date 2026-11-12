# flow

![flow: your tickets and reviews, the agent's overview of the ticket, the live diff of your branch, and its file tree](assets/flow-screenshot.png)

**Everything you need to work, in one place, with zero-prompt context for Claude.** Your tickets, your squad's reviews, the code, and Claude, side by side in one terminal: no more jumping between YouTrack, GitLab, Notion, and Slack.

**flow** minimizes distractions and leaves only what matters: review, iteration, and judgment, in a human–AI loop. Claude starts every ticket already knowing it, and everything around the code runs itself:

```text
                         writes · fixes · reviews vs. the ticket
                          ┌───────────────────────────────────┐
                          │                                   ▼
zero-prompt context ──▶ Claude                               you ──▶ shipped
                          ▲                                   │
                          └───────────────────────────────────┘
                              reviews · comments · decides
```

## How it works

- **Zero-prompt context.** Claude already knows the ticket. You never paste context again.
- **Overview.** See what Claude understood, before a single line is written.
- **Ticket-vs-code review.** Not just "does it work?", but "is it what the ticket asked?"
- **Inline loop.** Talk to Claude right on the code. Every round, better.
- **Native Claude.** Claude Code runs in its own terminal, as always. One session, full context, no gaps.
- **Delivery, built in.** Commits, merge requests, team updates. All from one place.

## Quick start

```bash
git clone https://github.com/JuanBernal98/flow.git
cd flow && ./install.sh     # first install: flow + Claude Code, asking before each step
cd ~/code/your-repo
flow init                   # connect the repo to your YouTrack, GitLab, and Slack
flow diff                   # open flow; run `claude` in another terminal
```

Needs macOS or Linux, Git, [bun](https://bun.sh), and [Claude Code](https://claude.com/claude-code). To update, `git pull` in the flow folder; flow tells you if you need to run `flow setup`.

## A ticket, start to finish

```text
S  Enter   # pick a ticket: branch ready, Claude reads the ticket
x          # check what Claude understood
           # build it with Claude; the diff updates live
a          # comment a hunk: Claude fixes it inline
R          # review the code against the ticket
C          # commit (you confirm the messages)
P          # push, open the MR, ping your squad
```

Reviewing a teammate's MR works the same: pick it under **Reviews**, `Enter`, `R`. Press `?` for every key.

## Good to know

- **Nothing leaves without you.** Commits, pushes, MRs, and Slack posts wait for your yes.
- **No company details in flow.** Each squad's YouTrack, GitLab label, and Slack channel live in a local `.flow/config.toml`.
- **Idle costs nothing.** **flow** and Claude talk through files in `.flow/`; no daemon, no tokens while you work.

Built on [dunk](https://github.com/amix/dunk)'s diff viewer. Development notes in [`AGENTS.md`](AGENTS.md). [MIT](LICENSE).
