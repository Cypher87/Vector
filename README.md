# Vector ADS-B Radar

A live aircraft radar for your existing [readsb](https://github.com/wiedehopf/readsb)/tar1090 receiver. Built with React, Vinext, and MapLibre; no changes to readsb required.

## Features

- Live map with type-specific aircraft icons, altitude colors, smooth motion, and collision-aware labels.
- Search, advanced filters, saved views, and favorites.
- Aircraft details with photos, routes, technical data, and interactive flight profiles.
- Altitude-colored traces, receiver history replay, distance rings, and range outline.
- Receiver dashboard and events for favorite arrivals, emergencies, and connection changes.
- Desktop and mobile layouts, Dutch/English, five interface themes, five map styles, and three unit systems.
- Optional live synchronization between devices, without accounts or passwords.

## Install on Raspberry Pi

**Requirements:** Debian 13 (`arm64` or `amd64`), systemd, an accessible readsb/tar1090 installation, internet access, and approximately 1 GB of free disk space.

Download, review, and run the installer:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
less /tmp/vector-install.sh
sudo bash /tmp/vector-install.sh
```

Vector is installed under `/opt/vector` and runs as the unprivileged `vector` user. The `vector.service` systemd service starts at boot, restarts after failures, and listens on `0.0.0.0:3000`.

Open **`http://<pi-address>:3000`** from your local network. Allow port 3000 through your firewall if necessary. Use HTTPS through a reverse proxy before exposing Vector beyond a trusted network; set `HOST=127.0.0.1` if only that local proxy should reach it.

The installer uses a checksum-verified Node.js **22.23.2** runtime and pnpm **11.19.0** via Corepack, isolated under `/opt/vector/runtime`. It leaves the system Node.js installation unchanged.

## Configuration

On the Pi, configuration lives outside the repository in `/etc/vector/vector.env`. Edit it and restart:

```bash
sudoedit /etc/vector/vector.env
sudo systemctl restart vector
```

Defaults for tar1090 on the same Pi:

```ini
READSB_LIVE_URL=http://127.0.0.1/tar1090/data/
READSB_HISTORY_URL=http://127.0.0.1/tar1090/globe_history/
VECTOR_SITE_NAME=Vector
VECTOR_RECEIVER_TITLE="Local readsb receiver"
VECTOR_UNIT_SYSTEM=metric
HOST=0.0.0.0
PORT=3000
```

The live URL is a **directory** containing `aircraft.json`, `receiver.json`, and optional `traces/`. The history URL points to `globe_history`, containing replay files such as `YYYY/MM/DD/heatmap/NN.bin.ttf`.

| Optional setting | Purpose / default |
| --- | --- |
| `READSB_TAR1090_URL` | Aircraft metadata source; defaults to the parent of the live-data directory. |
| `VECTOR_RECEIVER_LATITUDE`, `VECTOR_RECEIVER_LONGITUDE` | Set both in decimal degrees to override the position from `receiver.json`. |
| `VECTOR_MAP_STYLE_URL` | MapLibre style; defaults to `/map-style.json`. |
| `VECTOR_SYNC_STORE` | Synchronization database; the installer sets `/var/lib/vector/sync.json`. |

Units accept `metric`, `aeronautical`, or `imperial`. See the [complete configuration example](packaging/vector.env.example).

There is no `public/config.json`: `/api/config` reads server environment settings. Upstream URLs stay server-side; the proxy rejects arbitrary client URLs, redirects, credentials, traversal, and unsupported files. Never commit local configuration or synchronization data.

## Manage your installation

### Service and logs

```bash
sudo systemctl start vector
sudo systemctl stop vector
sudo systemctl restart vector
systemctl status vector --no-pager
sudo journalctl -u vector -f                 # Follow logs
sudo journalctl -u vector -n 100 --no-pager  # Recent logs
```

### Update

Download and run the latest installer again:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
sudo VECTOR_REF=main bash /tmp/vector-install.sh
```

Updates preserve `/etc/vector/vector.env` and synchronization data. Local source changes in `/opt/vector/app` cause the update to stop rather than overwrite them. Set `VECTOR_REF` to an existing branch, tag, or commit to install that revision.

### Remove

Use the downloaded installer (download it again if `/tmp/vector-install.sh` is missing):

```bash
sudo bash /tmp/vector-install.sh --uninstall
```

This removes the application and service but keeps configuration, state, and the service account. To remove **everything**, including synchronized preferences and device sessions, back up anything needed first, then run:

```bash
sudo bash /tmp/vector-install.sh --uninstall --purge
```

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

Create an ignored `.env.local` with the configuration above, pointing the upstream URLs to your receiver. Then run `pnpm dev` and open [localhost:3000](http://localhost:3000). Development synchronization defaults to `.vector/sync.json`; do not copy the Pi's `VECTOR_SYNC_STORE` value or production database into development.

### Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests start the production build on port **3100**; leave that port free. They use synthetic data on desktop/mobile Chromium, without accessing your Pi or external providers. On Linux, install browser dependencies with `pnpm exec playwright install --with-deps chromium`. Test output is ignored by Git; real-device Safari testing remains separate.

GitHub Actions runs these checks on Ubuntu 24.04 for pull requests and pushes to `main`, uploading browser diagnostics on failure. CI uses one browser worker to avoid competing software-rendered WebGL maps; local tests use two. To enforce passing checks before merging, require the `quality` job in branch protection.

### Production runtime

Vector is **not a static site**: configuration, proxy, and synchronization APIs require a running Node.js server. `pnpm build` produces `dist/standalone/server.js`, which the systemd service runs. For a manual checkout, configure its environment and run:

```bash
pnpm build
HOST=0.0.0.0 PORT=3000 pnpm start
```

## Further reading

- [User guide](docs/USER_GUIDE.md): filters, map layers, traces, replay, connection status, and synchronization.
- [Architecture](docs/ARCHITECTUUR.md) (Dutch): technical design and extension points.
- [Licenses and attribution](THIRD_PARTY_NOTICES.md): tar1090 aircraft shapes and type mappings.

The included map styles use online OpenStreetMap tiles. Aircraft photos and route information depend on external services and may be unavailable.
