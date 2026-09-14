# Vector ADS-B Radar

Vector is a modern frontend for [readsb](https://github.com/wiedehopf/readsb) and tar1090 data. The application displays live aircraft on a MapLibre map and uses the receiver's existing JSON and `globe_history` output; readsb itself does not need to be modified.

## Features

- Live aircraft map with heading, type-specific tar1090 icons, and altitude-based colors.
- Searchable, sortable, and filterable aircraft list with synchronized favorites.
- Detail panel with flight information, route, full airport names, and an aircraft photo.
- Altitude-colored leg traces for the selected aircraft.
- History replay with a timeline, playback speed controls, and an option to return to live data.
- Configurable map layers with labels, actual range outline, solid distance rings, and adjustable leg-trace periods.
- Receiver dashboard with connection, message, source, position, version, and history information.
- Configurable unit systems: metric, aeronautical, or imperial.
- Optional accounts that synchronize preferences and favorites across devices, with local, Google, and Apple sign-in.
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
# Optional when tar1090 is not the parent directory of READSB_LIVE_URL:
# READSB_TAR1090_URL=http://127.0.0.1/tar1090/
VECTOR_SITE_NAME=Vector
VECTOR_RECEIVER_TITLE="Local readsb receiver"
VECTOR_UNIT_SYSTEM=metric
VECTOR_MAP_STYLE_URL=/map-style.json
VECTOR_ACCOUNT_STORE=/var/lib/vector/accounts.json
VECTOR_LOCAL_REGISTRATION=first-user
# Optional: configure both values together when receiver.json has no position
# VECTOR_RECEIVER_LATITUDE=52.000000
# VECTOR_RECEIVER_LONGITUDE=5.000000
HOST=0.0.0.0
PORT=3000
```

`VECTOR_UNIT_SYSTEM` accepts `metric`, `aeronautical`, or `imperial`; the default is `metric`. `READSB_LIVE_URL` points to the directory containing at least `receiver.json`, `aircraft.json`, and optionally `traces/`. `READSB_HISTORY_URL` points to the `globe_history` directory written by readsb, containing replay files such as `YYYY/MM/DD/heatmap/NN.bin.ttf`. Vector derives the tar1090 application URL from `READSB_LIVE_URL` to obtain aircraft types during replay. Set `READSB_TAR1090_URL` only when that derived location is not correct.

Set `VECTOR_RECEIVER_LATITUDE` and `VECTOR_RECEIVER_LONGITUDE` to the receiver position in decimal degrees when you want to configure the radar location explicitly. Both variables must be set together. Environment coordinates take precedence over `receiver.json`; when they are omitted, Vector uses the position reported by `receiver.json`.

The upstream URLs remain on the server. The browser only receives relative proxy resources and cannot direct the proxy to another host. HTTP redirects, credentials in upstream URLs, path traversal, and unknown files are rejected.

Vector does not use `public/config.json`. The server generates `/api/config` exclusively from the environment configuration and safe defaults. For local development, use a `.env.local` file that is ignored by Git; the Pi installation uses only `/etc/vector/vector.env`.

### Accounts and preference synchronization

Accounts are optional. Without signing in, Vector continues to store preferences in the current browser. After signing in, the server synchronizes the unit system, language, detail-panel behavior, map layers, leg-trace period, aircraft filters and sorting, and favorite aircraft. The existing browser preferences initialize a newly created account; an existing account's saved preferences take precedence on another device.

Local accounts work directly at `http://<pi-address>:3000`. Passwords are never stored in plain text: Vector uses a salted `scrypt` hash. Sessions use random HTTP-only, same-site cookies. Account records, password hashes, sessions, preferences, and favorites are stored in `/var/lib/vector/accounts.json`, outside the Git checkout. The file is created with mode `0600` and is preserved by normal updates and uninstallations without `--purge`.

The default `VECTOR_LOCAL_REGISTRATION=first-user` lets the first local account be created from the account menu and then closes registration. Use `always` to allow additional local accounts, or `disabled` to prevent new local registrations:

```ini
VECTOR_ACCOUNT_STORE=/var/lib/vector/accounts.json
VECTOR_LOCAL_REGISTRATION=first-user
```

Back up the account database as sensitive data:

```bash
sudo systemctl stop vector
sudo cp --preserve=mode,ownership /var/lib/vector/accounts.json /secure/backup/location/
sudo systemctl start vector
```

#### Google sign-in

Google sign-in requires an OAuth 2.0 Web application and a public HTTPS URL. `http://localhost` is supported for development, but a private IP address is not suitable for production OAuth. Register this exact authorized redirect URI in Google Cloud:

```text
https://radar.example.com/api/auth/oauth/google/callback
```

Then configure:

```ini
VECTOR_PUBLIC_URL=https://radar.example.com
VECTOR_GOOGLE_CLIENT_ID=your-client-id
VECTOR_GOOGLE_CLIENT_SECRET=your-client-secret
```

#### Sign in with Apple

Apple requires Apple Developer Program membership, a Sign in with Apple-enabled primary App ID, a Services ID, a registered domain and return URL, and a private key. Apple explicitly does not accept an IP address or `localhost` as a web return URL. Register:

```text
https://radar.example.com/api/auth/oauth/apple/callback
```

Install the downloaded `.p8` key so only root and the Vector service group can read it:

```bash
sudo install -o root -g vector -m 0640 AuthKey_KEYID.p8 /etc/vector/apple-private-key.p8
```

Then configure:

```ini
VECTOR_PUBLIC_URL=https://radar.example.com
VECTOR_APPLE_CLIENT_ID=com.example.vector.web
VECTOR_APPLE_TEAM_ID=YOURTEAMID
VECTOR_APPLE_KEY_ID=YOURKEYID
VECTOR_APPLE_PRIVATE_KEY_FILE=/etc/vector/apple-private-key.p8
```

Restart Vector after changing provider configuration. Provider secrets and Apple private keys remain server-side and are never included in `/api/config` or browser responses.

Google and Apple identities are currently stored as separate Vector accounts. Sign in with the same provider on each device to retrieve the same preferences. Account linking, password recovery, and email delivery are deliberately not part of the local single-receiver deployment.

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

During local development, account data defaults to the ignored `.vector/accounts.json` file. Set `VECTOR_ACCOUNT_STORE` in `.env.local` when a different development location is required. Never reuse or commit the production account database.

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
