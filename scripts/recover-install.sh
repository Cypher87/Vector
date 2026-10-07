#!/usr/bin/env bash
set -Eeuo pipefail
runner_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
runtime="$(<"$runner_directory/runtime-path")"
[[ "$runtime" =~ ^/opt/vector/runtime/node-v[0-9.]+-linux-(arm64|x64)/bin/node$ && -x "$runtime" ]] \
  || { printf '[Vector] Recovery runtime is missing or invalid.\n' >&2; exit 1; }
exec "$runtime" "$runner_directory/migrate-install.mjs" "$@"
