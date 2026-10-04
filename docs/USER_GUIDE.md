# Vector user guide

For installation, configuration, and updates, see the [README](../README.md).

## Aircraft and map labels

Aircraft colors represent reported altitude and match the legend and trace colors. Contacts without an identifiable type or category use a small filled circle with the same altitude color and thin dark outline, without a projected shadow. Known categories keep their silhouettes even without an exact type code; newly received metadata updates the icon automatically. Aircraft without a reported position can appear in the list but cannot be placed on the map.

Labels avoid other labels and map controls. Selected, keyboard-focused/hovered, and favorite aircraft take priority. Ordinary labels show only the callsign below zoom level 7 and disappear below level 5; aircraft icons remain visible. The **Aircraft labels** layer switch hides all labels. Label placement never changes an aircraft's map position.

## Filters and saved views

**Favorites only** is directly accessible in the filter menu. Other controls are grouped into **Aircraft category**, **Altitude and speed** (including flight status), **Distance**, and **Advanced**. Advanced filters cover data source, position availability, exact ICAO type codes such as `B738, A320`, and emergency/squawk values.

Groups show active choices in their headings. Opening one closes the previous group without changing filters or unfinished edits. The menu floats above the map and closes when you click outside or press Escape. Active filter chips below search can be removed individually; saved views retain all filter groups and sorting.

Filter rules:

- Choices within a category or type-code group use **OR**; different groups use **AND**.
- Search and filters apply to both map and list, in live and history modes. Selection does not bypass filters; the selected aircraft's details remain available.
- Numeric bounds are inclusive; empty bounds mean no limit. Missing measurements never count as zero. Invalid edits leave the previous valid filter in effect.
- Distance uses the configured/reported receiver position, not the fallback map center. If that position is unknown, an active distance filter returns no matches.
- Altitude is not height above terrain. Climbing/descending requires a known vertical rate of at least ±128 ft/min (about ±0.65 m/s); ground state comes from the receiver.
- Categories use the marker classification. **Light & small** includes small jets and ultralights; **Other / unknown** includes types outside the named groups and aircraft without type information.
- Changing display units does not change the physical range being filtered. Older four-toggle filters and saved views migrate automatically.

Paired devices synchronize filters. Independent groups merge separately; simultaneous changes to the same group use the last server-processed change.

## Traces, flight profiles, and replay

Expand **Flight profile** in the detail panel to plot reported altitude and ground speed from the same trace as the map. Hover, tap, or use the keyboard-accessible time slider to inspect a measurement and highlight its map position. Collapsing the profile clears that highlight, not the leg trace. Values follow the selected unit system.

The period selector controls both the profile and leg trace: **30 minutes** by default, with options up to **8 hours** or the full available trace. Live traces combine the receiver's full/recent trace files, refreshed every 30 seconds while selected, with fresh locally received positions.

Coverage depends on what the receiver recorded. A longer period cannot recover missing data, and gaps or stale measurements are not drawn as continuous measurements. A ground flag without an altitude does not imply zero elevation.

History replay uses readsb's `globe_history` files, read directly or through a configured HTTP source; tar1090 is not required. Recording must be enabled in readsb. In history mode, the profile uses only snapshots from the loaded replay window, never the current live trace. With insufficient points, it shows an unavailable-data state instead of an invented graph.

## Appearance and layers

Settings offers five interface themes: **Vector**, **Midnight**, **Radar**, **Amber**, and **Daylight**. Each has a matching altitude palette shared by the legend, aircraft, and traces.

The independent **Map style** setting offers **Default**, **Original**, **Light**, **Dark**, and **High contrast**. Default is brighter and softly desaturated in Daylight, and muted in dark interface themes. Explicit map-style choices remain independent of the interface theme; they do not change aircraft colors or move/reload the map.

These styles adjust the raster layer named `openstreetmap` in the style configured by `VECTOR_MAP_STYLE_URL`. Custom styles without that layer remain unchanged. All included variants use the same online OpenStreetMap tiles.

Map layers include aircraft labels, altitude shadows, actual range outline, and distance rings. Settings also controls position animation, unit system, language, and detail-panel behavior.

## Connection status

Vector retries failed configuration, receiver, and live-data requests automatically. Requests time out after 10 seconds, with retry delays increasing to a maximum of 15 seconds. After three failures, configuration and receiver metadata are reloaded too. Returning to the tab or regaining network connectivity triggers an immediate retry when no request is already running.

The live indicator checks the receiver's timestamp, not just HTTP success. Data older than 15 seconds, or a receiver clock more than 30 seconds ahead, is treated as outdated. Missing or invalid timestamps are rejected. Keep the receiver and viewing device clocks synchronized.

During an outage, aircraft remain at their last known positions, the footer shows data age, and motion/local trace recording pause until fresh data returns. Duplicate snapshots do not restart animation or add history samples. Visible aircraft during an outage are not live positions.

## Device synchronization

Synchronization is optional. Without it, preferences stay in the current browser. It needs no account, email, password, public domain, or Google/Apple configuration.

1. Choose **Start synchronization** on the first device to save its preferences on this Vector server.
2. Choose **Connect a new device** on a connected device.
3. Enter the six-character code on another device using the same server. The code expires after ten minutes and works only once.

Themes, map style, units, language, detail-panel behavior, map layers, trace period, filters, sorting, event preferences, and favorites synchronize live, normally within a second. Independent settings and favorite additions/removals merge separately; conflicting changes to the same setting use the last server-processed update.

The event log and read state remain local and can be cleared in the event center. It keeps the latest notification per aircraft/event type and one receiver-status row, for up to 24 hours and 100 entries. Existing duplicates are consolidated automatically. Repeats update the row instead of adding another; a read notification only becomes unread again after a 30-minute quiet period.

Favorites already present on startup, reconnection, returning after sleep, or when you add a favorite do not trigger arrival alerts. Brief reception gaps are ignored: a previously seen favorite must be absent from fresh live data for five minutes before its return counts again. New emergency squawks are detected immediately from fresh data, including on startup and in background tabs; different emergency codes remain separate alerts. An emergency takes precedence over a simultaneous favorite arrival.

Receiver notifications require at least 30 seconds continuously offline after an established live connection, with the tab visible. Short delays and browser sleep do not generate recovery-only messages. Recovery updates the outage row without adding another unread notification. Notifications for aircraft no longer in the live view remain readable but are not clickable.

### Manage devices

The panel lists each device's class, browser, operating system, presence, and last activity. **Active now** means an open synchronization connection, not merely a recent timestamp. Custom names are limited to 40 characters; clearing one restores the automatic name. Device names, presence, and list changes synchronize live.

You can disconnect another device individually, invalidating its session immediately. **Disconnect this device** removes only the current browser. **Delete all synchronization data** removes the profile and invalidates every device.

**There is no account recovery.** Keep at least one device connected and generate a new pairing code before replacing or clearing another browser.

### Privacy and backups

Pairing codes are temporary, rate-limited keys. Browsers receive long random tokens in HTTP-only, same-site cookies. Codes and tokens are stored only as hashes in `/var/lib/vector/sync.json`, outside the Git checkout, with file mode `0600`. Device metadata contains only a reduced browser/OS/device-class description and optional name, not the full user-agent string. Older version 1 and 2 synchronization files migrate automatically.

Pairing works over `http://<pi-address>:3000` on a trusted LAN. Use HTTPS when exposing Vector beyond that network. Treat the synchronization database as sensitive; never commit it or reuse production data in development.

To back up, replace `/secure/backup/location/` with an existing protected directory:

```bash
sudo systemctl stop vector
sudo cp --preserve=mode,ownership /var/lib/vector/sync.json /secure/backup/location/
sudo systemctl start vector
```

Versions before anonymous pairing used `/var/lib/vector/accounts.json`. That legacy file is no longer read. After verifying the new synchronization works and old account data is no longer needed, it can be removed manually with `sudo rm -- /var/lib/vector/accounts.json`.
