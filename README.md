# Vector ADS-B Radar

A standalone aircraft radar for your [readsb](https://github.com/wiedehopf/readsb) receiver. Built with React, Vinext, and MapLibre, with original Vector aircraft icons. **No tar1090 application or web server is needed or used.** The separate `tar1090-db` dataset remains the aircraft metadata source; Vector downloads and updates it independently.

**Current version: 0.9.7.** Vector remains pre-1.0. Find the installed version and short build revision at the bottom of **Settings**, or the version in the desktop footer; the receiver dashboard separately shows the readsb version.

## Features

- Live map with original aircraft-family icons, altitude colors, smooth motion, and collision-aware labels.
- Search, advanced filters, saved views, and favorites.
- Aircraft details with photos, routes, technical data, and interactive flight profiles.
- Altitude-colored traces, receiver history replay, distance rings, and range outline.
- Receiver dashboard and events for favorite arrivals, emergencies, and connection changes.
- Persistent receiver logbook with search, recent sightings, favorites, and live aircraft selection.
- Desktop and mobile layouts, Dutch/English, coordinated dark/light/automatic appearance, and three unit systems.
- Optional live synchronization between devices, without accounts or passwords.
- Optional administrator-protected browser updates, with staged builds and recovery.

The star next to the aircraft filters opens all saved favorites, including aircraft not currently received. Search by registration, callsign, type or ICAO, remove favorites with confirmation, or open a live aircraft. On mobile, open the aircraft list first.

## Install on Raspberry Pi

**Requirements:** Debian 13 (`arm64` or `amd64`), systemd, a running compatible readsb installation (or another Vector receiver), internet access, and at least **2 GiB free** to build a release alongside the existing installation, plus space for recorded history.

Install or migrate with the same command:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh &&
sudo bash /tmp/vector-install.sh
```

Vector is installed under `/opt/vector` and runs as the unprivileged `vector` user. The `vector.service` systemd service starts at boot, restarts after failures, and listens on `0.0.0.0:3000`.

The installer detects readsb and its data directories, configures read access, migrates local tar1090 URLs, and downloads the aircraft database. It preserves your labels, location, preferences, and recordings. Missing readsb recording options are added after asking about the required brief receiver restart. SDR and feeder settings stay unchanged. tar1090 is not removed.

No `.env` editing is needed for a standard installation. Questions appear only when a choice is necessary, such as multiple receivers or an intentional external source. Updates build separately while the current app keeps running, then switch over and verify fresh receiver data. Failed activation restores the previous app, runtime, configuration and service state. See [installation details and recovery](docs/STANDALONE.md).

Open **`http://<pi-address>:3000`** from your local network. Allow port 3000 through your firewall if necessary. Use HTTPS through a reverse proxy before exposing Vector beyond a trusted network; set `HOST=127.0.0.1` if only that local proxy should reach it.

The installer uses a checksum-verified Node.js **22.23.2** runtime and pnpm **11.19.0** via Corepack, isolated under `/opt/vector/runtime`. It leaves the system Node.js installation unchanged.

## Configuration

On the Pi, configuration lives outside the repository in `/etc/vector/vector.env`. Edit it and restart:

```bash
sudoedit /etc/vector/vector.env
sudo systemctl restart vector
```

The installer fills in the detected paths. A typical local configuration is:

```ini
READSB_SOURCE=local
READSB_LIVE_DIR=/run/readsb
READSB_HISTORY_DIR=/var/globe_history
VECTOR_AIRCRAFT_DATABASE=/var/lib/vector/aircraft-db/aircraft.csv.gz
VECTOR_SITE_NAME=Vector
VECTOR_RECEIVER_TITLE="Local readsb receiver"
VECTOR_UNIT_SYSTEM=metric
HOST=0.0.0.0
PORT=3000
```

The live directory contains `aircraft.json`, `receiver.json`, and optional `outline.json` and `traces/`. The history directory contains readsb replay files such as `YYYY/MM/DD/heatmap/NN.bin.ttf`. Traces, replay, and range outlines require the corresponding readsb output; Vector does not invent missing recordings.

For another Vector server, use `READSB_SOURCE=vector` and `READSB_REMOTE_URL=http://receiver.local:3000/`. Only `local` and `vector` sources are supported. **Upgrading an old HTTP installation:** rerun the installer without `--keep-source`. It migrates a local receiver automatically; for an external receiver, it asks for a Vector server URL or a switch to local readsb. It never guesses a new server address. Old `READSB_LIVE_URL`, `READSB_HISTORY_URL`, and `READSB_TAR1090_URL` settings are removed from the migrated configuration, not used as fallbacks.

| Optional setting | Purpose / default |
| --- | --- |
| `VECTOR_RECEIVER_LATITUDE`, `VECTOR_RECEIVER_LONGITUDE` | Set both in decimal degrees to override the position from `receiver.json`. |
| `VECTOR_MAP_STYLE_URL` | MapLibre style; defaults to `/map-style.json`. |
| `VECTOR_SYNC_STORE` | Synchronization database; the installer sets `/var/lib/vector/sync.json`. |
| `VECTOR_LOGBOOK_DAYS` | Logbook retention; `90` days by default (1–365). Set `VECTOR_LOGBOOK_ENABLED=false` to disable recording and access. |
| `VECTOR_UPDATES_ENABLED` | Enables the browser update menu; `false` by default. Requires a separate administrator password. |

Units accept `metric`, `aeronautical`, or `imperial`. See the [complete configuration example](packaging/vector.env.example).

There is no `public/config.json`: `/api/config` reads server environment settings. Upstream URLs and local paths stay server-side; the data API rejects arbitrary client URLs, redirects, credentials, traversal, unsupported files, and symlinks below configured directories. Never commit local configuration or synchronization data.

## Manage your installation

### Service and logs

```bash
sudo systemctl start vector
sudo systemctl stop vector
sudo systemctl restart vector
systemctl status vector --no-pager
sudo journalctl -u vector -f                 # Follow logs
sudo journalctl -u vector -n 100 --no-pager  # Recent logs
systemctl list-timers vector-aircraft-db.timer
sudo systemctl start vector-aircraft-db     # Refresh aircraft metadata now
sudo journalctl -u vector-aircraft-db -n 30 --no-pager
```

### Update

Download a fresh installer for each terminal update. Reusing an older downloaded script can miss helper files required by newer application code:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh &&
sudo bash /tmp/vector-install.sh
```

Updates preserve synchronization data, the last valid aircraft database, and settings unrelated to the data-source migration. Local source changes in `/opt/vector/app` stop the update rather than being overwritten. During 0.9 development the default source remains `main`; set `VECTOR_REF` to an existing tag or commit for a pinned revision. Use `--keep-source` to retain the current data source without detection.

To undo the last installation/update, including the app and runtime:

```bash
sudo bash /tmp/vector-install.sh --rollback
```

The installer also recovers interrupted updates when run again. Rollback does not delete receiver recordings, synchronized preferences or downloaded metadata.

### Browser updates (optional)

First run the current installer once on your Pi to install the separate update service. Then set an administrator password (12–128 characters; hidden input, stored as a salted hash):

```bash
sudo /opt/vector/runtime/node/bin/node /usr/local/lib/vector-updater/set-update-password.mjs
```

Set `VECTOR_UPDATES_ENABLED=true` in `/etc/vector/vector.env`, run `sudo systemctl restart vector`, and refresh the browser. **Updates** then appears at the bottom of **Settings**. Setting a password alone does not enable the menu. Use the same password command to change it later.

Unlock **Settings → Updates**, choose **Check for updates**, then confirm the proposed build. **Checks and installation are manual**: Vector does not check at startup or on a schedule. Closing the browser does not cancel an accepted update.

During the app and updater restarts, the interface reconnects automatically. Once the new build is ready and both services are reachable, the page refreshes once. Temporary disconnects are not reported as installation failures; a longer interruption shows an explicit connection warning, while actual installer failures remain visible.

Update progress, results and errors are shown only while the administrator session is unlocked. Other visitors see the installed version and, when available, the administrator login form.

Browser updates apply to the Vector server you opened, not a remote receiver or local development server. Pairing codes do not grant administrator access. Use HTTPS outside a trusted LAN. See [setup, security and troubleshooting](docs/STANDALONE.md#browser-updates).

### Remove

Use the downloaded installer (download it again if `/tmp/vector-install.sh` is missing):

```bash
sudo bash /tmp/vector-install.sh --uninstall
```

This removes the application, its services (including the browser updater), and the database-update timer but keeps configuration, state, and the service account. To remove **all Vector data**, including the aircraft database, synchronized preferences, and device sessions, back up anything needed first, then run:

```bash
sudo bash /tmp/vector-install.sh --uninstall --purge
```

Neither command removes readsb, tar1090, or readsb's recordings. Receiver recording options and the retention job for installer-created history remain operational without Vector. Purge also removes Vector's migration backups; save anything needed first.

## Receiver logbook

Open the book icon in the top bar to search observed aircraft by callsign, registration, type or ICAO, with 10 results per page. Each entry shows when it was first/last seen and its number of sightings within the selected period. Expand it for recent sightings and their duration, add a favorite, or select the aircraft on the live map when available. Duration runs from a sighting’s first to last recorded signal. A new sighting means reception resumed after at least 30 minutes; it is not a confirmed flight.

The receiver records in the background while Vector runs, even with no browser open. Recording starts with this feature; older readsb history is not imported. By default, observations remain for 90 days. The logbook belongs to the receiver, not an individual synchronization profile, and is readable by everyone who can access Vector. With a remote Vector source, its server must also support this feature. See [storage and limits](docs/STANDALONE.md#receiver-logbook).

## Synchronize devices

Open **Synchronization → Start synchronization** to save preferences and favorites on your Vector server. Choose **Connect a new device** and enter the six-character code on another device using the same server. Codes work once and expire after ten minutes; changes then synchronize live.

You can name or disconnect individual devices. Keep at least one device connected: there is no account recovery. See the [user guide](docs/USER_GUIDE.md#device-synchronization) for storage, privacy, and backup details.

## Development

Use Node.js **22.13+** and pnpm **11.19.0**. Clone and install:

```bash
git clone https://github.com/Cypher87/Vector.git
cd Vector
corepack enable
pnpm install --frozen-lockfile
```

For development on a PC, create an ignored `.env.local` pointing to Vector on your receiver:

```ini
READSB_SOURCE=vector
READSB_REMOTE_URL=http://receiver.local:3000/
```

Run `pnpm dev` and open [localhost:3000](http://localhost:3000). Replace old HTTP settings in `.env.local` with the Vector settings above. Development synchronization defaults to `.vector/sync.json`; do not copy the Pi's `VECTOR_SYNC_STORE` value into development. A remote Vector source provides metadata as well as live data and history, so no local database download is necessary.

### Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:standalone
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests start the production build on port **3100**; leave that port free. They use synthetic data on desktop/mobile Chromium, without accessing your Pi or external providers. Standalone integration tests also start the production build, using temporary readsb files and metadata with unavailable tar1090 URLs. On Linux, permission tests need `acl` (`sudo apt-get install acl`); install browser dependencies with `pnpm exec playwright install --with-deps chromium`. Test output is ignored by Git; real-device Safari testing remains separate.

GitHub Actions runs these checks on Ubuntu 24.04 for pull requests and pushes to `main`, uploading browser diagnostics on failure. CI uses one browser worker to avoid competing software-rendered WebGL maps; local tests use two. To enforce passing checks before merging, require the `quality` job in branch protection.

### Production runtime

Vector is **not a static site**: configuration, proxy, synchronization and logbook APIs require a running Node.js server. `pnpm build` produces `dist/standalone/server.js`; `scripts/start-vector.mjs` starts that server together with the background logbook recorder. Both `pnpm start` and the packaged systemd service use this launcher. For a manual checkout, configure its environment and run:

```bash
pnpm build
HOST=0.0.0.0 PORT=3000 pnpm start
```

## Further reading

- [User guide](docs/USER_GUIDE.md): filters, map layers, traces, replay, connection status, and synchronization.
- [Guided installation](docs/STANDALONE.md): automatic migration, recovery, metadata updates, and advanced configuration.
- [Architecture](docs/ARCHITECTUUR.md) (Dutch): technical design and extension points.
- [Licenses and attribution](THIRD_PARTY_NOTICES.md): original aircraft icons and downloaded metadata sources.

The included map styles use online OpenStreetMap tiles. Aircraft photos and route information depend on external services and may be unavailable.
