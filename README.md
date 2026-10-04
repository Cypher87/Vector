# Vector ADS-B Radar

Vector is a modern frontend for [readsb](https://github.com/wiedehopf/readsb) and tar1090 data. The application displays live aircraft on a MapLibre map and uses the receiver's existing JSON and `globe_history` output; readsb itself does not need to be modified.

## Features

- Live aircraft map with heading, type-specific tar1090 icons, optional smooth speed-based motion (enabled by default), animated helicopter rotors, and a continuous altitude-color scale.
- Searchable, sortable, and filterable aircraft list with synchronized favorites.
- Active filters stay visible below the search field and can be removed individually without opening the filter menu.
- Detail panel with current flight metrics, an interactive altitude/ground-speed profile, aircraft photo, and route with full airport names. Unknown routes use a compact note.
- Collision-aware map labels with selection/favorite priority, alternative label positions, and compact callsigns when zoomed out.
- Altitude-colored leg traces for the selected aircraft.
- History replay with a timeline, playback speed controls, and an option to return to live data.
- Configurable map layers with labels, actual range outline, solid distance rings, and adjustable leg-trace periods.
- Five interface themes with matching altitude colors for the legend, aircraft icons, and leg traces.
- Five live-switchable OpenStreetMap display styles: Default, Original, Light, Dark, and High contrast.
- Receiver dashboard with connection, message, source, position, version, and history information.
- Local event center for favorite arrivals, emergency squawks, and receiver offline/recovery events.
- Configurable unit systems: metric, aeronautical, or imperial.
- Optional anonymous synchronization of preferences and favorites between devices using a temporary pairing code.
- External server configuration for readsb, the site name, and receiver title.
- Responsive interface for desktop and smaller screens.

## Map labels and flight profiles

Map labels choose an available position around their aircraft and avoid overlapping other labels or map controls. Selected aircraft, keyboard-focused/hovered aircraft, and favorites take priority. Ordinary labels show only the callsign below zoom level 7, and disappear below level 5; the aircraft icons remain visible. The **Aircraft labels** layer switch still hides all labels. Label placement never changes the aircraft's map position.

Contacts with no identifiable type or category use a small filled circle on the map, in the list, and in the details. It keeps the altitude color and thin dark outline of the other icons, without a question mark or projected shadow, and does not imply an airplane or helicopter. Known categories retain their silhouettes even without an exact type code; newly received metadata updates the icon automatically.

The detail panel keeps current flight metrics, the aircraft photo, and the full route together. The **Flight profile** below them starts collapsed; expand it to plot reported altitude and ground speed from the same trace as the map. Hover or tap the chart, or use its keyboard-accessible time slider, to inspect a measurement and mark its position on the map. Historical values appear in the chart only while inspecting a point, without repeating the current flight metrics. Collapsing the profile clears that highlight, not the aircraft's leg trace. Values follow the selected unit system. The profile's period selector updates the shared leg-trace period (30 minutes by default; up to 8 hours or the full available trace).

Live traces combine the receiver's full/recent trace files (refreshed every 30 seconds while selected) with fresh locally received positions. Available coverage depends on the receiver; choosing a longer period cannot recover measurements that were not recorded. Missing or stale measurements and gaps between flight legs are not drawn as continuous measurements. Reported altitude is not height above terrain; an aircraft marked on the ground without an altitude does not imply zero elevation.

In history mode, the profile uses only snapshots from the loaded replay window, never the current live trace. Without enough recorded points, the panel shows an unavailable-data state instead of an invented graph.

## Aircraft filters

The filter menu keeps **Favorites only** directly accessible and groups other controls into **Aircraft category**, **Altitude and speed** (including flight status), **Distance**, and **Advanced**. Groups start collapsed and show their active choices in the heading; opening one closes the previous group without changing its filters or unfinished edits. Saved views have their own collapsible section. The **Advanced** section adds data source, position availability, exact ICAO type codes (such as `B738, A320`), and emergency/squawk filters. The menu floats above the map without resizing it, keeps the result count visible, and closes when you click outside or press Escape.

- Choices within a category or type-code group are combined with **OR**; different filter groups are combined with **AND**.
- Filters and text search apply equally to the map and list, in live mode and history replay. A selected aircraft does not bypass them; its details remain available.
- Numeric bounds are inclusive. Empty bounds mean no limit. Missing altitude, speed, distance, or vertical-rate values do not count as zero and cannot satisfy a filter requiring that measurement.
- Distances use the configured/reported receiver position, never the fallback map center. When the receiver position is unknown, an active distance filter returns no matches and the menu explains why.
- Height is reported aircraft altitude, not terrain-relative height. Climbing/descending requires a known vertical rate of at least ±128 ft/min (about ±0.65 m/s); ground state comes from the receiver.
- Category filters use the same classification as the map icons. **Light & small** includes small jets and ultralights; **Other / unknown** includes types outside the named groups and aircraft without type information.
- Bounds are displayed in the selected unit system but stored in physical units, so changing units does not change the selected range. Invalid edits leave the previous valid filter in effect.
- Active filter chips show their values and can be cleared individually. Saved views include all filter groups and sorting. Existing four-toggle filters and saved views migrate automatically.
- Paired devices synchronize these filters as well. Independent groups merge separately; simultaneous edits to the same group use the last server-processed change.

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
VECTOR_SYNC_STORE=/var/lib/vector/sync.json
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

### Preference synchronization

Synchronization is optional and does not require an account, email address, password, public domain, Google, or Apple configuration. Without synchronization, Vector continues to store preferences in the current browser.

Open the synchronization button in the top bar and choose **Start synchronization**. Vector stores the current interface theme, OpenStreetMap display style, unit system, language, detail-panel behavior, map layers, leg-trace period, aircraft filters and sorting, and favorite aircraft on this Vector server. To add another browser or device:

1. On an already connected device, choose **Connect a new device**.
2. Enter the displayed six-character code on the new device.
3. The code expires after ten minutes and can be used only once.

Connected browsers receive preference and favorite changes live, normally within a second. Vector sends field-level updates, so simultaneous changes to different settings do not overwrite one another. Favorite additions and removals are merged separately. When two devices change the exact same setting at the same time, the last server-processed change wins.

Event-type preferences are synchronized with the other settings. The event log and its read state remain local to each browser, are limited to the latest one hundred entries, and can be cleared from the event center. Opening Vector does not generate arrival notifications for every favorite that is already in range.

The synchronization panel lists every connected device with its device class, browser, operating system, presence, last activity, and an indication of the current device. **Active now** is based on an open live synchronization connection, not merely a recent timestamp; after that connection closes, Vector shows the recorded last-active time. Devices can be given a custom name, such as `Living room tablet`; clearing that name restores the automatic browser and operating-system label. Any other device can be disconnected individually; its session is invalidated immediately. Names, presence, and device-list changes are synchronized live.

The short code is only a temporary pairing key. Each browser receives a long random device token in an HTTP-only, same-site cookie. Tokens and pairing codes are stored only as hashes in `/var/lib/vector/sync.json`; the file is created with mode `0600` outside the Git checkout. Vector stores only a reduced browser, operating-system and device-class description plus the optional user-chosen device name for the device overview, never the complete user-agent string. Device names are limited to 40 characters. Pairing attempts are rate limited. Existing version 1 and 2 synchronization files are migrated automatically. This works directly through `http://<pi-address>:3000`, although HTTPS is still recommended when exposing Vector beyond a trusted local network.

There is deliberately no account recovery. Keep at least one device connected; generate a fresh code there before replacing or clearing another browser. **Disconnect this device** removes only the current browser, while **Delete all synchronization data** invalidates every connected device and removes the synchronized profile.

Back up the synchronization database as sensitive data:

```bash
sudo systemctl stop vector
sudo cp --preserve=mode,ownership /var/lib/vector/sync.json /secure/backup/location/
sudo systemctl start vector
```

Vector versions that predate anonymous pairing used `/var/lib/vector/accounts.json`. That legacy file is no longer read. After confirming that the new synchronization works and that no old account data is needed, it can be removed manually with `sudo rm -- /var/lib/vector/accounts.json`.

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

The settings menu offers five interface themes: **Vector**, **Midnight**, **Radar**, **Amber**, and **Daylight**. Each theme has its own continuous altitude palette. The altitude legend, aircraft icons, and altitude-colored leg traces always use the same palette, so the legend remains an accurate reference.

The separate **Map style** setting changes the presentation of the included OpenStreetMap raster layer without reloading or moving the map. **Default** uses a brighter, softly desaturated presentation with Daylight and Vector's muted presentation with the dark interface themes. Explicitly choosing **Original**, **Light**, **Dark**, or **High contrast** keeps that map rendering independent of the interface theme. Aircraft, legend, and trace colors are unaffected by this map-style adjustment. The configured `VECTOR_MAP_STYLE_URL` remains the source of the MapLibre style. These display adjustments are applied to the included raster layer named `openstreetmap`; a custom style without that layer remains unchanged.

During local development, synchronization data defaults to the ignored `.vector/sync.json` file. Set `VECTOR_SYNC_STORE` in `.env.local` when a different development location is required. Never reuse or commit the production synchronization database.

Quality checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests run against the **production build**, starting a separate server on `127.0.0.1:3100` and stopping it afterwards. Build first, and leave that port free. The suite exercises desktop and mobile Chromium layouts with synthetic live data, leg traces, and binary receiver replay files. It checks startup recovery, stale data, selection, favorites, following, history playback, themes, and menu visibility. No Pi, external map service, or personal configuration is needed for these tests; browser API requests are intercepted by fixtures. The tests do not create synchronization profiles or modify your local preferences. Screenshots, traces, and the HTML report are saved in ignored test-output directories.

On Linux, install browser system dependencies with `pnpm exec playwright install --with-deps chromium`. The GitHub **Quality checks** workflow runs lint, TypeScript, unit/integration tests, the production build, and desktop/mobile browser tests on pull requests and pushes to `main`. Failed browser runs upload diagnostic artifacts. To prevent merging a failing change, enable a branch protection rule for `main` and require the `quality` job; the workflow alone does not enforce that rule. Mobile Chromium emulation is not a substitute for a real-device Safari check.

### Live connection recovery

Vector retries automatically if configuration, receiver metadata, or live aircraft data cannot be loaded. Requests time out after 10 seconds; consecutive failures use increasing retry delays capped at 15 seconds. After three failures, Vector reloads configuration and receiver metadata as well. Returning to a visible tab or restoring the browser's network connection triggers an immediate retry when no request is already running.

The live indicator uses the receiver's `aircraft.json` timestamp, not just HTTP success. Data older than 15 seconds is marked delayed, even if the server keeps returning the same JSON. A receiver clock more than 30 seconds ahead is also treated as outdated: keep the Pi and viewing device clocks synchronized. Missing or invalid timestamps are rejected. During an outage, the last known aircraft remain visible, the footer shows their data age, and position animation/local trace recording pause until fresh data returns. Duplicate snapshots do not reset position animation or create new history samples. These are last known positions, not live aircraft positions.

## Production runtime

Vector is **not a static build**. The `/api/config` and `/api/readsb` routes must remain active to load external configuration securely and retrieve live data, traces, and history replay. Therefore, `pnpm build` creates a standalone Vinext Node.js server in `dist/standalone/`; the systemd service starts `dist/standalone/server.js`.

To run the production server manually:

```bash
pnpm build
HOST=0.0.0.0 PORT=3000 pnpm start
```

The included map style and all five of its display variants use online OpenStreetMap tiles. Route and photo data are also retrieved from external services when that information is available.

## Architecture

The technical design and planned areas for extension are documented in [`docs/ARCHITECTUUR.md`](docs/ARCHITECTUUR.md).

The live feed lifecycle and retry/freshness policy live in `src/data/aircraft-feed.ts`, independent of React and covered with deterministic clock-based tests. `use-aircraft-feed.ts` connects that lifecycle to browser visibility/network events. The settings UI and MapLibre navigation control are separate modules (`src/components/settings-menu.tsx` and `src/map/map-navigation-control.ts`) so menu behavior can evolve without expanding the page and radar rendering components.

## Licenses and data sources

Vector uses aircraft shapes and type mappings derived from tar1090. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the included GPL license text for the required attribution.
