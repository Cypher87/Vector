# Vector ADS-B Radar

Vector is a modern frontend for [readsb](https://github.com/wiedehopf/readsb) and tar1090 data. The application displays live aircraft on a MapLibre map and uses the receiver's existing JSON and `globe_history` output; readsb itself does not need to be modified.

## Features

- Live aircraft map with heading, type-specific tar1090 icons, and altitude-based colors.
- Searchable, sortable, and filterable aircraft list.
- Detail panel with flight information, route, full airport names, and an aircraft photo.
- Altitude-colored leg traces for the selected aircraft.
- History replay with a timeline, playback speed controls, and an option to return to live data.
- Configurable labels and unit systems: metric, aeronautical, or imperial.
- External server configuration for readsb, the site name, and receiver title.
- Responsive interface for desktop and smaller screens.

## Raspberry Pi and Debian 13

### Requirements

- A Raspberry Pi running 64-bit Debian 13 (`arm64`); Debian 13 `amd64` is also supported.
- An existing readsb/tar1090 installation that is reachable locally.
- `systemd` and internet access during installation.
- Approximately 1 GB of free disk space for the source code, dependencies, and build.

The [Debian 13 package](https://packages.debian.org/trixie/nodejs) provides Node.js 20.19.2, while the Vinext version used by Vector requires Node.js 22. The installation script therefore leaves the system version unchanged. It installs the [official Node.js 22.23.2 ARM64 build](https://nodejs.org/en/blog/release/v22.23.2/) in isolation under `/opt/vector/runtime`, verifies the pinned SHA-256 checksum, and activates pnpm 11.19.0 through [Corepack](https://nodejs.org/download/release/latest-v22.x/docs/api/corepack.html). This avoids conflicts with readsb or other software on the Pi.

### Installation

Download the script, review it if desired, and run it as root:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
less /tmp/vector-install.sh
sudo bash /tmp/vector-install.sh
```

The script is idempotent and:

- Installs Vector under `/opt/vector`.
- Creates a single non-login `vector` system user.
- Stores local configuration in `/etc/vector/vector.env`.
- Builds a standalone Vinext server bundle.
- Installs and enables `vector.service`.
- Listens on `0.0.0.0:3000` by default and restarts after failures.

An existing `/etc/vector/vector.env` is preserved during installation and updates. The script stops when the checkout under `/opt/vector/app` contains local changes, preventing them from being overwritten silently.

### Configuration

Edit the local configuration, then restart the service:

```bash
sudoedit /etc/vector/vector.env
sudo systemctl restart vector
```

The safe default configuration for tar1090 running on the same Pi is:

```ini
READSB_LIVE_URL=http://127.0.0.1/tar1090/data/
READSB_HISTORY_URL=http://127.0.0.1/tar1090/globe_history/
VECTOR_SITE_NAME=Vector
VECTOR_RECEIVER_TITLE="Local readsb receiver"
VECTOR_UNIT_SYSTEM=metric
VECTOR_MAP_STYLE_URL=/map-style.json
# Optional: configure both values together when receiver.json has no position
# VECTOR_RECEIVER_LATITUDE=52.000000
# VECTOR_RECEIVER_LONGITUDE=5.000000
HOST=0.0.0.0
PORT=3000
```

`VECTOR_UNIT_SYSTEM` accepts `metric`, `aeronautical`, or `imperial`; the default is `metric`. `READSB_LIVE_URL` points to the directory containing at least `receiver.json`, `aircraft.json`, and optionally `traces/`. `READSB_HISTORY_URL` points to the `globe_history` directory written by readsb, containing replay files such as `YYYY/MM/DD/heatmap/NN.bin.ttf`.

Set `VECTOR_RECEIVER_LATITUDE` and `VECTOR_RECEIVER_LONGITUDE` to the receiver position in decimal degrees when you want to configure the radar location explicitly. Both variables must be set together. Environment coordinates take precedence over `receiver.json`; when they are omitted, Vector uses the position reported by `receiver.json`.

The upstream URLs remain on the server. The browser only receives relative proxy resources and cannot direct the proxy to another host. HTTP redirects, credentials in upstream URLs, path traversal, and unknown files are rejected.

Vector does not use `public/config.json`. The server generates `/api/config` exclusively from the environment configuration and safe defaults. For local development, use a `.env.local` file that is ignored by Git; the Pi installation uses only `/etc/vector/vector.env`.

### Accessing Vector

Open Vector from a device on the same network:

```text
http://<pi-address>:3000
```

Replace `<pi-address>` with the Raspberry Pi's LAN address. Port 3000 must be allowed through any active firewall. Setting `HOST=127.0.0.1` restricts Vector to local access; use your own reverse proxy in that configuration.

### Managing the service

```bash
sudo systemctl start vector
sudo systemctl stop vector
sudo systemctl restart vector
systemctl status vector --no-pager
```

View live logs:

```bash
journalctl -u vector -f
```

View the latest one hundred log lines:

```bash
journalctl -u vector -n 100 --no-pager
```

### Updating

Run the current installation script again. This updates the Git checkout, dependencies, production build, and service while preserving `/etc/vector/vector.env`.

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
sudo VECTOR_REF=main bash /tmp/vector-install.sh
```

Set `VECTOR_REF` to install a specific release, branch, or commit:

```bash
sudo VECTOR_REF=v1.2.3 bash /tmp/vector-install.sh
```

### Uninstalling

Download the installation script again first if necessary. The `--purge` option also removes the configuration, state directory, and system user. Back up the configuration beforehand if it needs to be preserved.

```bash
sudo bash /tmp/vector-install.sh --uninstall --purge
```

Without `--purge`, `/etc/vector/vector.env`, `/var/lib/vector`, and the service account are preserved:

```bash
sudo bash /tmp/vector-install.sh --uninstall
```

## Local development

Development requires Node.js 22.13 or newer and pnpm 11.19.0. Create an ignored `.env.local` file with the same variables as `/etc/vector/vector.env`, then start the development server:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Quality checks:

```bash
pnpm lint
pnpm test
pnpm build
```

## Production runtime

Vector is **not a static build**. The `/api/config` and `/api/readsb` routes must remain active to load external configuration securely and retrieve live data, traces, and history replay. Therefore, `pnpm build` creates a standalone Vinext Node.js server in `dist/standalone/`; the systemd service starts `dist/standalone/server.js`.

To run the production server manually:

```bash
pnpm build
HOST=0.0.0.0 PORT=3000 pnpm start
```

The included map style uses online map tiles. Route and photo data are also retrieved from external services when that information is available.

## Architecture

The technical design and planned areas for extension are documented in [`docs/ARCHITECTUUR.md`](docs/ARCHITECTUUR.md).

## Licenses and data sources

Vector uses aircraft shapes and type mappings derived from tar1090. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the included GPL license text for the required attribution.
