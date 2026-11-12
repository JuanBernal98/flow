#!/usr/bin/env bash
# Install flow from this checkout in one go: dependencies, the `flow` command, and Claude Code.
# `flow setup claude` checks everything else flow needs and offers to fix what is missing, always
# showing the command and asking first. Re-run this after `git pull`.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  printf 'flow runs on bun, which is not installed yet.\n' >&2
  printf 'Install it from https://bun.sh, open a new terminal, and run ./install.sh again.\n' >&2
  exit 1
fi

printf '→ Installing dependencies (bun install)\n'
(cd "${repo_root}" && bun install)

printf '\n→ Installing the flow command\n'
bash "${repo_root}/scripts/install-bin.sh"

printf '\n→ Setting up Claude Code\n'
"${FLOW_INSTALL_DIR:-${HOME}/.local/bin}/flow" setup claude
