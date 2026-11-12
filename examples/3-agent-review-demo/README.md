# 3-agent-review-demo

A flagship flow demo: a small command-palette refactor to practice the agent review loop on.

## Run

```bash
flow patch examples/3-agent-review-demo/change.patch
```

Press `a` on a hunk to leave a comment; an agent picks it up with `flow comments list`.

## What to look for

- query normalization extracted into its own helper
- ranking logic that prefers strong matches over loose substring hits
- the kind of hunks where you would drop a comment on the agent so it can address it via `flow comments`
