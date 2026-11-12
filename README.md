# flow

![flow: your tickets and reviews, the agent's overview of the ticket, the live diff of your branch, and its file tree](assets/flow-screenshot.png)

**Tickets, merge requests, and code in one terminal app, built around working with Claude Code.**

The slow part of coding with an AI is not the coding: it is handing it the context. Opening the ticket, its Notion page and comments, finding the branch, writing the commit, opening the MR, pinging the team, moving the ticket. flow closes that gap. It shows your YouTrack tickets and your squad's GitLab reviews beside a live diff of your branch, and every chore around a ticket is one key that asks Claude to do it.

The code itself stays a human–AI loop: you and Claude write it and review it together, in the diff.

## What makes it nice

- **Context in one key.** Switch to a ticket and Claude reads it all: the ticket, its parent, linked Notion pages, every comment.
- **An overview to check Claude got it.** What Claude understood, as goal, acceptance criteria, where in the code, and plan. It tells you whether Claude understood the task, and gives you a second reading of it — but the source of truth is still the ticket, its Notion pages, and the official docs: rely on those.
- **Review is ticket vs. code.** `R` checks the branch against the ticket's acceptance criteria, flags what it does beyond them, then bugs. It works on teammates' MRs too.
- **Inline comments, both ways.** Comment a hunk and Claude fixes it and replies under your comment.
- **Commits and MRs you only confirm.** `C` proposes commits in your repo's format, `P` pushes, opens the MR, and pings your squad's Slack.
- **Tickets that move themselves.** Approved MRs show as Ready to merge; once merged, the ticket moves to Done.

## Quick start

```bash
git clone https://github.com/JuanBernal98/flow.git
cd flow && ./install.sh     # first install only: flow plus Claude Code, asking before each step

cd ~/code/your-repo
flow init                   # connect the repo: YouTrack, your squad's GitLab label and Slack channel
flow diff                   # open flow, and run `claude` in another terminal in the same repo
```

You need macOS or Linux, Git, [bun](https://bun.sh), and [Claude Code](https://claude.com/claude-code). If your company puts GitLab behind an access proxy such as Cloudflare Access, set that up first.

## A ticket, start to finish

```text
S  j/k  Enter   # pick a ticket: its branch is checked out, your work stashed, and Claude reads the ticket
x               # read the overview: did Claude understand the task?
                # ...build it with Claude in its terminal; flow's diff updates live
a               # comment a hunk: Claude fixes it and replies inline (d closes the comment)
R               # Claude reviews the branch against the ticket
C               # Claude proposes the commits; you confirm
P               # Claude pushes and opens the MR; the ticket moves to Review
```

To review a teammate's MR: pick it under **Reviews**, `Enter` to check it out, `R` to review it against its ticket, `g` to open it in GitLab.

## Main keys

| Key       | Does                                         |
| --------- | -------------------------------------------- |
| `S`       | focus the ticket list (`/` filters it)       |
| `Enter`   | switch to the ticket's branch                |
| `x` / `X` | show the overview / ask Claude to rewrite it |
| `a`       | comment the hunk under the cursor            |
| `R`       | review the code against the ticket           |
| `C`       | commit, after you confirm the messages       |
| `P`       | push and open the merge request              |
| `h` / `g` | open the ticket / the MR in the browser      |
| `r`       | reload everything                            |
| `?`       | all keys                                     |

Keys that ask Claude for something are uppercase, so they are hard to press by accident.

## Good to know

- **Each squad configures its own repo.** `flow init` writes a local `.flow/config.toml` with your YouTrack, GitLab label, and Slack channel, so flow itself carries no company details.
- **Nothing leaves without you.** Claude asks before committing, pushing, posting to Slack, or moving a ticket; setup asks before installing anything.
- **Two terminals, no glue.** flow and Claude talk through files in `.flow/`; the session hook keeps Claude listening, and it costs no tokens while idle.
- **Update** with `flow update`: it pulls the newest flow and refreshes Claude Code. `./install.sh` is only for the first install.

flow is a fork of [dunk](https://github.com/amix/dunk), which provides the diff viewer (`diff`, `show`, `patch`, layouts, pager); see its README for those. Development notes live in [`AGENTS.md`](AGENTS.md). [MIT](LICENSE).
