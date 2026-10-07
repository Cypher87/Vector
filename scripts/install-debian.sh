#!/usr/bin/env bash
set -Eeuo pipefail

readonly VECTOR_USER='vector'
readonly VECTOR_GROUP='vector'
readonly VECTOR_ROOT='/opt/vector'
readonly VECTOR_APP='/opt/vector/app'
readonly VECTOR_RUNTIME='/opt/vector/runtime'
readonly VECTOR_RELEASES='/opt/vector/releases'
readonly VECTOR_RECOVERY='/usr/local/lib/vector-installer'
readonly VECTOR_STATE='/var/lib/vector'
readonly VECTOR_CONFIG_DIR='/etc/vector'
readonly VECTOR_CONFIG='/etc/vector/vector.env'
readonly VECTOR_SERVICE='/etc/systemd/system/vector.service'
readonly VECTOR_REPOSITORY_DEFAULT='https://github.com/Cypher87/Vector.git'
readonly NODE_VERSION='22.23.2'
readonly PNPM_VERSION='11.19.0'
readonly SYSTEM_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

export PATH="$SYSTEM_PATH"

VECTOR_REPOSITORY="${VECTOR_REPOSITORY:-$VECTOR_REPOSITORY_DEFAULT}"
VECTOR_REF="${VECTOR_REF:-main}"
ACTION='install'
PURGE=false
MIGRATION_ARGS=()

log() {
  printf '[Vector] %s\n' "$*"
}

fail() {
  printf '[Vector] Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install-debian.sh [--yes] [--keep-source] [--rollback] [--uninstall] [--purge]

Without arguments, installs or updates Vector. Set VECTOR_REF to a branch,
tag or commit and VECTOR_REPOSITORY to another Git repository when required.

  --yes          Accept safe defaults, including a necessary readsb restart.
  --keep-source  Retain a local/Vector source (not a legacy HTTP source).
  --rollback     Restore the previous app, runtime, configuration and services.
  --uninstall  Stop Vector and remove the service and /opt/vector.
  --purge      With --uninstall, also remove /etc/vector, state and the user.
EOF
}

while (($# > 0)); do
  case "$1" in
    --uninstall) ACTION='uninstall' ;;
    --purge) PURGE=true ;;
    --yes|--keep-source) MIGRATION_ARGS+=("$1") ;;
    --rollback) ACTION='rollback' ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
  shift
done

if [[ ${EUID} -ne 0 ]]; then
  fail 'Run this script as root, for example with sudo.'
fi

command -v flock >/dev/null || fail 'flock (util-linux) is required.'
exec 9>/run/lock/vector-install.lock
flock -n 9 || fail 'Another Vector installation or migration is already running.'

if [[ "$ACTION" == 'rollback' ]]; then
  if [[ -x "$VECTOR_RECOVERY/current/recover-install.sh" ]]; then
    exec "$VECTOR_RECOVERY/current/recover-install.sh" --rollback
  fi
  [[ -f /usr/local/lib/vector/migrate-install.mjs ]] || fail 'No guided migration is installed to restore.'
  exec "$VECTOR_RUNTIME/node/bin/node" /usr/local/lib/vector/migrate-install.mjs --rollback
fi

uninstall_vector() {
  if [[ -f /etc/vector/readsb-access.json ]]; then
    "$VECTOR_RUNTIME/node/bin/node" /usr/local/lib/vector/migrate-install.mjs --detach \
      || fail 'Receiver integration could not be removed safely; Vector has not been deleted.'
  fi
  log 'Stopping and disabling the service.'
  systemctl disable --now vector-updater.service 2>/dev/null || true
  rm -f -- /etc/systemd/system/vector-updater.service
  systemctl disable --now vector-aircraft-db.timer 2>/dev/null || true
  systemctl stop vector-aircraft-db.service 2>/dev/null || true
  rm -f -- /etc/systemd/system/vector-aircraft-db.timer /etc/systemd/system/vector-aircraft-db.service
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
    rm -rf -- /usr/local/lib/vector /usr/local/lib/vector-installer /var/lib/vector-installer /usr/local/lib/vector-updater /var/lib/vector-updater
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

if [[ -x "$VECTOR_RECOVERY/current/recover-install.sh" ]]; then
  "$VECTOR_RECOVERY/current/recover-install.sh" --recover-pending
elif [[ -f /usr/local/lib/vector/migrate-install.mjs && -x "$VECTOR_RUNTIME/node/bin/node" ]]; then
  "$VECTOR_RUNTIME/node/bin/node" /usr/local/lib/vector/migrate-install.mjs --recover-pending
fi

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
apt-get install -y --no-install-recommends ca-certificates curl git xz-utils acl

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

install -d -o root -g root -m 0755 "$VECTOR_ROOT"
install -d -o root -g root -m 0755 "$VECTOR_RELEASES"
install -d -o root -g root -m 0755 "$VECTOR_RUNTIME"
install -d -o "$VECTOR_USER" -g "$VECTOR_GROUP" -m 0750 "$VECTOR_STATE"
install -d -o root -g "$VECTOR_GROUP" -m 0750 "$VECTOR_CONFIG_DIR"

run_as_vector() {
  local working_directory="$1"
  shift
  runuser -u "$VECTOR_USER" -- env \
    --chdir="$working_directory" \
    HOME="$VECTOR_STATE" \
    XDG_CACHE_HOME="$VECTOR_STATE/.cache" \
    PATH="${node_directory:-$VECTOR_RUNTIME/node}/bin:/usr/bin:/bin" \
    COREPACK_HOME="$VECTOR_RUNTIME/corepack" \
    VECTOR_BUILD_REVISION="${target_revision:-}" \
    "$@"
}

if [[ -L "$VECTOR_APP" ]]; then
  active_release="$(readlink -f "$VECTOR_APP")"
  [[ "$(dirname "$active_release")" == "$VECTOR_RELEASES" && -d "$active_release" ]] \
    || fail 'The active app link does not point to a managed release.'
fi
if [[ -d "$VECTOR_APP/.git" ]]; then
  # Even read-only Git checks can invoke configured helpers; run them unprivileged.
  active_release="$(readlink -f "$VECTOR_APP")"
  checkout_changes="$(run_as_vector "$VECTOR_ROOT" git -c safe.directory="$active_release" -C "$VECTOR_APP" status --porcelain)" \
    || fail 'The active checkout could not be checked; update aborted.'
  [[ -z "$checkout_changes" ]] \
    || fail "$VECTOR_APP contains local changes; update aborted without overwriting them."
  current_remote="$(run_as_vector "$VECTOR_ROOT" git -c safe.directory="$active_release" -C "$VECTOR_APP" remote get-url origin)"
  [[ "$current_remote" == "$VECTOR_REPOSITORY" ]] \
    || fail "Existing checkout uses a different origin: $current_remote"
elif [[ -e "$VECTOR_APP" ]]; then
  fail "$VECTOR_APP exists and is not a Git checkout; it has not been changed."
fi

available_kib="$(df --output=avail "$VECTOR_RELEASES" | tail -n 1 | tr -d ' ')"
[[ "$available_kib" =~ ^[0-9]+$ && "$available_kib" -ge 2097152 ]] \
  || fail 'At least 2 GiB of free space is required to prepare an update without replacing the running app.'
release_directory="$(mktemp -d "$VECTOR_RELEASES/build-XXXXXXXX")"
source_directory=''
activation_started=false
temporary_directory=''
cleanup_build() {
  local status=$?
  if [[ -n "$temporary_directory" && "$temporary_directory" == /tmp/tmp.* && -d "$temporary_directory" ]]; then
    rm -rf -- "$temporary_directory"
  fi
  if [[ -n "$source_directory" && "$(dirname "$source_directory")" == "$VECTOR_ROOT" && "$(basename "$source_directory")" == .source-* && ! -L "$source_directory" ]]; then
    rm -rf -- "$source_directory"
  fi
  if [[ "$status" -ne 0 && "$activation_started" == false && "$(dirname "$release_directory")" == "$VECTOR_RELEASES" && "$(basename "$release_directory")" == build-* && ! -L "$release_directory" ]]; then
    rm -rf -- "$release_directory"
    log 'Preparation failed. The active app has not been replaced; the incomplete build was removed.'
  fi
}
trap cleanup_build EXIT
log 'Preparing a separate release. The running application remains available during the build.'
# Never execute privileged helpers or install systemd units from a build owned by
# the webapp user. Keep an independent, root-only checkout of the approved source.
source_directory="$(mktemp -d "$VECTOR_ROOT/.source-XXXXXXXX")"
git clone --filter=blob:none --no-checkout "$VECTOR_REPOSITORY" "$source_directory"
log "Selecting Vector revision $VECTOR_REF."
if target_revision="$(git -C "$source_directory" rev-parse --verify --quiet "origin/$VECTOR_REF^{commit}")"; then
  :
elif target_revision="$(git -C "$source_directory" rev-parse --verify --quiet "$VECTOR_REF^{commit}")"; then
  :
else
  fail "Cannot resolve VECTOR_REF=$VECTOR_REF."
fi
git -C "$source_directory" checkout --detach "$target_revision"
chmod 0700 "$source_directory"
[[ -f "$source_directory/scripts/lib/release-switch.mjs" && -f "$source_directory/scripts/recover-install.sh" ]] \
  || fail 'This revision predates the release installer. Select an installer-compatible 0.9 revision.'
# Copy objects, never hard-link them to the protected checkout.
git clone --local --no-hardlinks --no-checkout "$source_directory" "$release_directory"
git -C "$release_directory" remote set-url origin "$VECTOR_REPOSITORY"
git -C "$release_directory" checkout --detach "$target_revision"
chown -R "$VECTOR_USER:$VECTOR_GROUP" "$release_directory"
chmod 0755 "$release_directory"

node_archive="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
node_directory="$VECTOR_RUNTIME/node-v${NODE_VERSION}-linux-${NODE_ARCH}"
if [[ ! -x "$node_directory/bin/node" ]]; then
  log "Installing isolated Node.js v$NODE_VERSION for $NODE_ARCH."
  temporary_directory="$(mktemp -d /tmp/tmp.XXXXXXXXXX)"
  curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$temporary_directory/$node_archive" \
    "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}"
  printf '%s  %s\n' "$NODE_SHA256" "$temporary_directory/$node_archive" | sha256sum --check --status \
    || fail 'The downloaded Node.js archive failed SHA-256 verification.'
  tar -xJf "$temporary_directory/$node_archive" -C "$temporary_directory"
  rm -rf -- "$node_directory"
  mv "$temporary_directory/node-v${NODE_VERSION}-linux-${NODE_ARCH}" "$node_directory"
  chown -R root:root "$node_directory"
  rm -rf -- "$temporary_directory"
  temporary_directory=''
fi

log "Activating pnpm $PNPM_VERSION through Corepack."
export PATH="$node_directory/bin:$SYSTEM_PATH"
export COREPACK_HOME="$VECTOR_RUNTIME/corepack"
"$node_directory/bin/corepack" enable --install-directory "$node_directory/bin"
"$node_directory/bin/corepack" install --global "pnpm@$PNPM_VERSION"
chmod -R a+rX "$VECTOR_RUNTIME"

log 'Installing locked dependencies and creating the production build.'
run_as_vector "$release_directory" pnpm install --frozen-lockfile
run_as_vector "$release_directory" pnpm build
[[ -f "$release_directory/dist/standalone/server.js" ]] \
  || fail 'The Vinext standalone server was not produced.'
release_version="$("$node_directory/bin/node" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).version' "$release_directory/package.json")"
log "Prepared Vector $release_version (${target_revision:0:8})."
# Freeze the candidate. Privileged files still come only from the protected source.
chown -R root:root "$release_directory"
# The updater's 0027 umask leaves files 0640/directories 0750. Once root owns
# them, vector still needs read/traverse access to scripts, dependencies and assets.
# Only the public release is changed; configuration and recovery backups stay private.
chmod -R a+rX,go-w "$release_directory"

if [[ ! -e "$VECTOR_CONFIG" ]]; then
  log "Creating $VECTOR_CONFIG."
  install -o root -g "$VECTOR_GROUP" -m 0640 \
    "$source_directory/packaging/vector.env.example" "$VECTOR_CONFIG"
else
  log "Preserving existing configuration in $VECTOR_CONFIG."
fi

# Keep a recovery runner independent of the app/runtime links being restored.
recovery_directory="$VECTOR_RECOVERY/$(basename "$release_directory")"
install -d -o root -g root -m 0755 "$VECTOR_RECOVERY" "$recovery_directory" "$recovery_directory/lib"
for script in migrate-install.mjs readsb-access.mjs lib/readsb-migration.mjs lib/migration-files.mjs lib/release-switch.mjs; do
  install -o root -g root -m 0644 "$source_directory/scripts/$script" "$recovery_directory/$script"
done
install -o root -g root -m 0755 "$source_directory/scripts/recover-install.sh" "$recovery_directory/recover-install.sh"
printf '%s\n' "$node_directory/bin/node" > "$recovery_directory/runtime-path"
chmod 0644 "$recovery_directory/runtime-path"
ln -s "$recovery_directory" "$VECTOR_RECOVERY/.current-$$"
mv -Tf "$VECTOR_RECOVERY/.current-$$" "$VECTOR_RECOVERY/current"
log 'Detecting the receiver and completing the guided installation.'
activation_started=true
"$VECTOR_RECOVERY/current/recover-install.sh" --release "$release_directory" "$node_directory" --source "$source_directory" "${MIGRATION_ARGS[@]}"
log "Vector $release_version is ready. Use --rollback to restore the previous installation if needed."
if [[ "${VECTOR_WEB_UPDATE:-}" != '1' ]]; then
  systemctl try-restart vector-updater.service
fi
