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

# Without the install directory on PATH, `flow` is "command not found" in the next terminal.
# Offer to add it to the shell's profile, showing the exact line and asking first.
install_dir="${FLOW_INSTALL_DIR:-${HOME}/.local/bin}"
case ":${PATH}:" in
  *":${install_dir}:"*) ;;
  *)
    case "${SHELL##*/}" in
      zsh) profile="${HOME}/.zshrc" ;;
      bash) profile="${HOME}/.bashrc"; [ "$(uname)" = "Darwin" ] && profile="${HOME}/.bash_profile" ;;
      *) profile="" ;;
    esac
    line="export PATH=\"${install_dir}:\$PATH\""
    printf '\n%s is not on your PATH yet, so new terminals will not find `flow`.\n' "${install_dir}"
    if [ -n "${profile}" ] && [ -t 0 ]; then
      printf 'flow can add this line to %s:\n  %s\nAdd it now? [y/N] ' "${profile}" "${line}"
      read -r answer
      case "${answer}" in
        [yY] | [yY][eE][sS])
          printf '\n# flow\n%s\n' "${line}" >>"${profile}"
          printf 'Added. New terminals will find `flow`.\n'
          ;;
        *) printf 'Skipped. Add it to your shell profile yourself:\n  %s\n' "${line}" ;;
      esac
    else
      printf 'Add this to your shell profile:\n  %s\n' "${line}"
    fi
    export PATH="${install_dir}:${PATH}"
    ;;
esac

printf '\n→ Setting up Claude Code\n'
"${install_dir}/flow" setup claude

printf '\nNext: cd into a repository and run `flow init` to connect it.\n'
