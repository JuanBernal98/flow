#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="${repo_root}/dist"
outfile="${dist_dir}/flow"

mkdir -p "${dist_dir}"

BUN_TMPDIR="${repo_root}/.bun-tmp" \
BUN_INSTALL="${repo_root}/.bun-install" \
# Watch mode computes change signatures in a worker; standalone executables only bundle workers
# that are passed as extra entrypoints.
bun build --compile "${repo_root}/src/main.tsx" "${repo_root}/src/core/watchWorker.ts" --outfile "${outfile}"

printf 'Built %s\n' "${outfile}"
