#!/usr/bin/env bash
set -Eeuo pipefail

readonly VECTOR_USER='vector'
readonly VECTOR_GROUP='vector'
readonly VECTOR_ROOT='/opt/vector'
readonly VECTOR_APP='/opt/vector/app'
readonly VECTOR_RUNTIME='/opt/vector/runtime'
readonly VECTOR_STATE='/var/lib/vector'
readonly VECTOR_CONFIG_DIR='/etc/vector'
readonly VECTOR_CONFIG='/etc/vector/vector.env'
readonly VECTOR_SERVICE='/etc/systemd/system/vector.service'
readonly VECTOR_REPOSITORY_DEFAULT='https://github.com/Cypher87/Vector.git'
readonly NODE_VERSION='22.23.2'
readonly PNPM_VERSION='11.19.0'

VECTOR_REPOSITORY="${VECTOR_REPOSITORY:-$VECTOR_REPOSITORY_DEFAULT}"
VECTOR_REF="${VECTOR_REF:-main}"
ACTION='install'
PURGE=false

log() {
  printf '[Vector] %s\n' "$*"
}

fail() {
  printf '[Vector] Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install-debian.sh [--uninstall] [--purge]

Without arguments, installs or updates Vector. Set VECTOR_REF to a branch,
tag or commit and VECTOR_REPOSITORY to another Git repository when required.

  --uninstall  Stop Vector and remove the service and /opt/vector.
  --purge      With --uninstall, also remove /etc/vector, state and the user.
EOF
}

while (($# > 0)); do
  case "$1" in
    --uninstall) ACTION='uninstall' ;;
    --purge) PURGE=true ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
  shift
done

if [[ ${EUID} -ne 0 ]]; then
  fail 'Run this script as root, for example with sudo.'
fi

uninstall_vector() {
  log 'Stopping and disabling the service.'
  systemctl disable --now vector.service 2>/dev/null || true
  rm -f -- "$VECTOR_SERVICE"
  systemctl daemon-reload
  systemctl reset-failed vector.service 2>/dev/null || true

  [[ "$VECTOR_ROOT" == '/opt/vector' ]] || fail 'Unexpected installation path; refusing removal.'
  rm -rf -- "$VECTOR_ROOT"

  if [[ "$PURGE" == true ]]; then
    log 'Purging configuration, state and the service account.'
    [[ "$VECTOR_CONFIG_DIR" == '/etc/vector' ]] || fail 'Unexpected configuration path; refusing removal.'
    [[ "$VECTOR_STATE" == '/var/lib/vector' ]] || fail 'Unexpected state path; refusing removal.'
    rm -rf -- "$VECTOR_CONFIG_DIR" "$VECTOR_STATE"
    userdel "$VECTOR_USER" 2>/dev/null || true
    groupdel "$VECTOR_GROUP" 2>/dev/null || true
  else
    log "Configuration remains in $VECTOR_CONFIG (use --uninstall --purge to remove it)."
  fi
  log 'Vector has been removed.'
}

if [[ "$ACTION" == 'uninstall' ]]; then
  uninstall_vector
  exit 0
fi

[[ "$PURGE" == false ]] || fail '--purge can only be used together with --uninstall.'

[[ -r /etc/os-release ]] || fail 'Cannot identify the operating system.'
# shellcheck source=/etc/os-release
source /etc/os-release
[[ "${ID:-}" == 'debian' && "${VERSION_ID:-}" == '13' ]] \
  || fail 'This installer supports Debian 13 only.'
command -v systemctl >/dev/null || fail 'systemd is required.'
command -v dpkg >/dev/null || fail 'dpkg is required.'

case "$(dpkg --print-architecture)" in
  arm64)
    NODE_ARCH='arm64'
    NODE_SHA256='fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8'
    ;;
  amd64)
    NODE_ARCH='x64'
    NODE_SHA256='d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307'
    ;;
  *) fail 'Only Debian 13 arm64 and amd64 are supported.' ;;
esac

log 'Installing operating-system prerequisites.'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git xz-utils

if ! getent group "$VECTOR_GROUP" >/dev/null; then
  groupadd --system "$VECTOR_GROUP"
fi
if ! id -u "$VECTOR_USER" >/dev/null 2>&1; then
  useradd \
    --system \
    --gid "$VECTOR_GROUP" \
    --home-dir "$VECTOR_STATE" \
    --create-home \
    --shell /usr/sbin/nologin \
    "$VECTOR_USER"
fi

install -d -o "$VECTOR_USER" -g "$VECTOR_GROUP" -m 0755 "$VECTOR_ROOT" "$VECTOR_APP"
install -d -o root -g root -m 0755 "$VECTOR_RUNTIME"
install -d -o "$VECTOR_USER" -g "$VECTOR_GROUP" -m 0750 "$VECTOR_STATE"
install -d -o root -g "$VECTOR_GROUP" -m 0750 "$VECTOR_CONFIG_DIR"

run_as_vector() {
  runuser -u "$VECTOR_USER" -- env \
    HOME="$VECTOR_STATE" \
    XDG_CACHE_HOME="$VECTOR_STATE/.cache" \
    PATH="$VECTOR_RUNTIME/node/bin:/usr/bin:/bin" \
    COREPACK_HOME="$VECTOR_RUNTIME/corepack" \
    "$@"
}

if [[ -d "$VECTOR_APP/.git" ]]; then
  [[ -z "$(run_as_vector git -C "$VECTOR_APP" status --porcelain)" ]] \
    || fail "$VECTOR_APP contains local changes; update aborted without overwriting them."
  current_remote="$(run_as_vector git -C "$VECTOR_APP" remote get-url origin)"
  [[ "$current_remote" == "$VECTOR_REPOSITORY" ]] \
    || fail "Existing checkout uses a different origin: $current_remote"
else
  [[ -z "$(find "$VECTOR_APP" -mindepth 1 -maxdepth 1 -print -quit)" ]] \
    || fail "$VECTOR_APP exists and is not an empty Git checkout."
  log 'Cloning Vector.'
  run_as_vector git clone --filter=blob:none "$VECTOR_REPOSITORY" "$VECTOR_APP"
fi

log "Selecting Vector revision $VECTOR_REF."
run_as_vector git -C "$VECTOR_APP" fetch --prune --tags origin
if target_revision="$(run_as_vector git -C "$VECTOR_APP" rev-parse --verify --quiet "origin/$VECTOR_REF^{commit}")"; then
  :
elif target_revision="$(run_as_vector git -C "$VECTOR_APP" rev-parse --verify --quiet "$VECTOR_REF^{commit}")"; then
  :
else
  fail "Cannot resolve VECTOR_REF=$VECTOR_REF."
fi
run_as_vector git -C "$VECTOR_APP" checkout --detach "$target_revision"

if [[ ! -e "$VECTOR_CONFIG" ]]; then
  log "Creating $VECTOR_CONFIG."
  install -o root -g "$VECTOR_GROUP" -m 0640 \
    "$VECTOR_APP/packaging/vector.env.example" "$VECTOR_CONFIG"
else
  log "Preserving existing configuration in $VECTOR_CONFIG."
  chown root:"$VECTOR_GROUP" "$VECTOR_CONFIG"
  chmod 0640 "$VECTOR_CONFIG"
fi

node_archive="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
node_directory="$VECTOR_RUNTIME/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
if [[ ! -x "$node_directory/bin/node" ]]; then
  log "Installing isolated Node.js v$NODE_VERSION for $NODE_ARCH."
  temporary_directory="$(mktemp -d)"
  trap 'rm -rf -- "${temporary_directory:-}"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$temporary_directory/$node_archive" \
    "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"
  printf '%s  %s\n' "$NODE_SHA256" "$temporary_directory/$node_archive" | sha256sum --check --status \
    || fail 'The downloaded Node.js archive failed SHA-256 verification.'
  tar -xJf "$temporary_directory/$node_archive" -C "$temporary_directory"
  rm -rf -- "$node_directory"
  mv "$temporary_directory/node-v${NODE_VERSION}-linux-${NODE_ARCH}" "$node_directory"
  chown -R root:root "$node_directory"
  trap - EXIT
  rm -rf -- "$temporary_directory"
fi
ln -sfn "$(basename "$node_directory")" "$VECTOR_RUNTIME/node"

log "Activating pnpm $PNPM_VERSION through Corepack."
export COREPACK_HOME="$VECTOR_RUNTIME/corepack"
"$node_directory/bin/corepack" enable --install-directory "$node_directory/bin"
"$node_directory/bin/corepack" install --global "pnpm@$PNPM_VERSION"
chmod -R a+rX "$VECTOR_RUNTIME"

log 'Installing locked dependencies and creating the production build.'
run_as_vector pnpm install --frozen-lockfile
run_as_vector pnpm build
[[ -f "$VECTOR_APP/dist/standalone/server.js" ]] \
  || fail 'The Vinext standalone server was not produced.'

install -o root -g root -m 0644 \
  "$VECTOR_APP/packaging/systemd/vector.service" "$VECTOR_SERVICE"
systemd-analyze verify "$VECTOR_SERVICE"
systemctl daemon-reload
systemctl enable vector.service
systemctl restart vector.service

if systemctl is-active --quiet vector.service; then
  log 'Vector is running. Open http://<pi-address>:3000 in a browser.'
else
  fail 'The service did not start. Inspect it with: journalctl -u vector -n 100 --no-pager'
fi
