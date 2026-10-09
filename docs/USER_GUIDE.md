# Vector user guide

For installation, configuration, and updates, see the [README](../README.md).

## Aircraft and map labels

Aircraft colors represent reported altitude and match the legend and trace colors. Contacts without an identifiable type or category use a small filled circle with the same altitude color and thin dark outline, without a projected shadow. Known categories keep their silhouettes even without an exact type code; newly received metadata updates the icon automatically. Aircraft without a reported position can appear in the list but cannot be placed on the map.

Labels avoid other labels and map controls. Selected, keyboard-focused/hovered, and favorite aircraft take priority. Ordinary labels show only the callsign below zoom level 7 and disappear below level 5; aircraft icons remain visible. The **Aircraft labels** layer switch hides all labels. Label placement never changes an aircraft's map position.

## Favorites

The star beside the aircraft filters opens all saved favorites, including offline ones. Enter a **Callsign or registration** without waiting for a live aircraft. **Automatic** recognizes a hyphenated registration such as `PH-HLP`; otherwise it treats the value as a callsign. Choose **Registration** explicitly for registrations without a hyphen, such as `N123AB`.

Registrations accept 3–12 letters or digits with an optional hyphen; callsigns accept 1–8 letters or digits. Case and spaces are ignored; wildcards are not supported. Registrations follow the aircraft even when its callsign changes. Callsign favorites follow whichever aircraft transmits that exact callsign. The star in aircraft details saves the individual ICAO identity.

All favorite types work with map/list filters, sorting, arrival notifications and device synchronization. In the logbook, registrations and callsigns match their latest recorded values; the receiver must also support these favorite types. Removing an entry from the favorites overview requires confirmation.

## Filters and saved views

**Favorites only** is directly accessible in the filter menu. Other controls are grouped into **Aircraft category**, **Altitude and speed** (including flight status), **Distance**, and **Advanced**. Advanced filters cover data source, position availability, exact ICAO type codes such as `B738, A320`, and emergency/squawk values.

Groups show active choices in their headings. Opening one closes the previous group without changing filters or unfinished edits. The menu floats above the map and closes when you click outside or press Escape. Active filter chips below search can be removed individually; saved views retain all filter groups and sorting.

The **Filters** tab edits the current view; **Saved** lists saved views with their criteria and sort order. **Save as new** is always available in the footer. After applying a saved view and changing its filters, the footer shows **Unsaved changes**: choose **Update** to replace its criteria, or **Save as new** to keep both. Changing filters never overwrites a saved view automatically. Use the pencil to rename, edit its filters or delete with confirmation. Duplicate names are rejected; up to 20 views can be saved. Updating keeps the same notification rule and device-sync identity; removing all criteria also turns off that rule's notifications.

Choose altitude, distance from the receiver, speed, callsign, or last reception in the list's sort selector. The adjacent arrow reverses the order; its tooltip describes the current direction. The star puts favorites first without hiding other aircraft. Missing sort values always stay at the bottom, including favorites. Equal values use callsign and ICAO ID as a stable tie-breaker. The displayed list reading follows the selected criterion. Sorting and favorite priority are saved locally, included in saved views, and synchronized with paired devices; existing saved views remain compatible.

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

History replay uses readsb's `globe_history` files, read directly or through another Vector server. Recording must be enabled in readsb. In history mode, the profile uses only snapshots from the loaded replay window, never the current live trace. With insufficient points, it shows an unavailable-data state instead of an invented graph.

## Appearance and layers

Settings offers one appearance choice: **Dark**, **Light**, or **Automatic**. It controls the interface and map together, including the legend, aircraft, labels and trails. Automatic is the default for new users and follows the device's system color scheme, including changes while Vector is open. Explicit Dark or Light choices override the system setting.

Existing Vector, Midnight, Radar and Amber preferences migrate to Dark; Daylight migrates to Light. The separate map-style preference is retired. Paired devices synchronize the chosen mode, not its resolved colors: Automatic may be dark on one device and light on another. System color changes never overwrite this shared preference.

The map uses the same online OpenStreetMap tiles in both modes, with dark land/light labels at night and a softly desaturated light presentation by day. Switching appearance updates the raster layer named `openstreetmap` in the style configured by `VECTOR_MAP_STYLE_URL`, without reloading tiles or moving the map. Custom styles without that layer are not recolored automatically.

Both modes share the same altitude color order, with adjusted contrast: green → turquoise → blue → violet → rose → coral/orange from low to high. The legend, aircraft, and traces use the same linear 0–12 km scale; colors above 12 km stay at its upper endpoint.

Map layers include aircraft labels, altitude shadows, aircraft trails, leg trace, actual range outline, and distance rings. **Aircraft trails** is on by default; its switch controls only the decorative speed trails, not leg traces, shadows, rotor/propeller animation or position smoothing. Your choice is saved locally and synchronized across paired devices. Settings also controls position animation, unit system, language, and detail-panel behavior.

## Connection status

Vector retries failed configuration, receiver, and live-data requests automatically. Requests time out after 10 seconds, with retry delays increasing to a maximum of 15 seconds. After three failures, configuration and receiver metadata are reloaded too. Returning to the tab or regaining network connectivity triggers an immediate retry when no request is already running.

The live indicator checks the receiver's timestamp, not just HTTP success. Data older than 15 seconds, or a receiver clock more than 30 seconds ahead, is treated as outdated. Missing or invalid timestamps are rejected. Keep the receiver and viewing device clocks synchronized.

During an outage, aircraft remain at their last known positions, the footer shows data age, and motion/local trace recording pause until fresh data returns. Duplicate snapshots do not restart animation or add history samples. Visible aircraft during an outage are not live positions.

## Aircraft database status

Open the **Receiver dashboard** to see **Aircraft database**: the last update in local 24-hour date/time notation and the number of aircraft records. Updates older than 48 hours are highlighted, so you can check the daily updater before metadata becomes too old. The panel refreshes every minute while open and when you return to the tab.

The timestamp comes from the validated database file published by the updater. A failed download leaves both the previous file and its date unchanged; a successful refresh advances the date even when the source data is identical. The date reflects the installed copy, not the upstream dataset's release date. It is not proof that the systemd timer is enabled: manual refreshes count too.

With a remote Vector source, this is the receiver's database status. Missing files and unavailable checks are shown explicitly; an unavailable check may retain the last verified date, never a new success date. Older remote Vector versions may report **Update unknown** until upgraded.

Aircraft icons are original Vector silhouettes for aircraft families, shared by the map, list, details and shadows. They do not promise a model-exact outline. Balloons and unknown contacts stay upright; unknown contacts remain a small neutral dot. Altitude colors, favorites, selection and motion behave consistently across the set.

Map icons smoothly grow from approximately 32 pixels at overview zoom (7.2 or lower), through 38 pixels around zoom 9.2, to a maximum of 46 pixels at zoom 11.5. Their geographic centers do not shift. Shadows, hit areas, favorite brackets and label spacing follow the icon size, while label text, list/detail icons and trail stroke widths stay unchanged.

On the live map, helicopters/gyrocopters have a slow rotor animation. Light aircraft have a rotating nose propeller and turboprops have one at each wing-mounted engine. The propeller blades rotate in a narrow, top-down projection rather than pulsing in width. Only the moving parts animate; the body, heading and GPS position are not altered. This is decorative, not measured engine RPM or an exact blade count. It is independent of position smoothing and pauses for stationary/ground contacts, old data, history mode and hidden tabs. Reduced-motion preferences disable it; list/detail icons and shadows stay static.

Subtle animated speed trails fade in between zoom levels 6.6 and 7.2 for fresh, airborne contacts moving at least 30 knots with a known direction. They follow the recent measured route, including turns, combining recent receiver recordings with the live position buffer. Jets have the longest trails, turboprops intermediate trails, and piston/electric propeller aircraft the shortest, softer trails. Known engine metadata determines propulsion and engine count; otherwise the displayed aircraft family supplies a visual fallback. Ultralights and fixed-wing drones require engine metadata. Helicopters/gyrocopters keep only their rotor animation; gliders (including motor gliders), balloons/airships, parachutists, ground vehicles and unknown contacts have no speed trail.

Trail length and flow speed increase with ground speed. The length scale smoothly grows from 16% at zoom 6.5 to 100% at zoom 9.5, with full maximum lengths of about 385 screen pixels for jets, 243 for turboprops and 162 for propeller aircraft. Visibility still fades in between zoom 6.6 and 7.2. The fade along each trail becomes gentler between zoom 8.5 and 11.5, so longer routes become visible earlier without making the trails darker.

These are decorative airflow cues, **not measured condensation trails or engine-state measurements**. Older points stay attached to their map positions as the icon turns or the map zooms. Vector preloads recent receiver traces for eligible aircraft in view, so recorded trails can appear shortly after opening the map. Requests are staggered, limited to three at a time, and cached; full-day traces are not downloaded for this layer. Loading pauses during zoom gestures and when trails are hidden or disabled. If recent recordings are unavailable, trails build up from live positions instead. Routes are limited to twenty minutes and 600 points; missing history is not extrapolated. Sparse receiver samples are supported, while reception gaps, new legs and large position jumps still break the trail. The available route and zoom level can make a trail shorter than its maximum. Unlike the altitude-colored legtrace, these trails are neutral-colored and fade out; they disappear when zoomed out, in history mode, on stale data, in hidden tabs and with reduced motion. They do not appear in lists, details or shadows.

## Receiver logbook

The book icon in the top bar opens **Logbook**. Search callsign, registration, type or ICAO address; choose 24 hours, 7, 30 or 90 days and sort by most recent reception or most visits. **Favorites only** filters the entire logbook using your existing favorites, combined with the search and period. The count and first/last reception apply to that period, within the receiver's retention window.

Click an aircraft's name to expand up to 50 recent visits. A new visit begins after a reception gap of at least 30 minutes, not necessarily a new flight. The star uses your existing favorites and device synchronization. **View live** appears when that aircraft is currently in the live feed and opens its details on the map.

The receiver records without an open browser. History starts when the updated receiver first runs; it does not import earlier readsb recordings. Everyone using that receiver sees the same logbook, while favorites remain personal. Unavailable receiver data pauses new observations without deleting recorded visits. A remote source needs a Vector version with logbook support. See [configuration, retention and backups](STANDALONE.md#receiver-logbook).

## Device synchronization

Synchronization is optional. Without it, preferences stay in the current browser. It needs no account, email, password, public domain, or Google/Apple configuration.

1. Choose **Start synchronization** on the first device to save its preferences on this Vector server.
2. Choose **Connect a new device** on a connected device.
3. Enter the six-character code on another device using the same server. The code expires after ten minutes and works only once.

Appearance mode, units, language, detail-panel behavior, map layers, trace period, filters, sorting, event preferences, and favorites synchronize live, normally within a second. Independent settings and favorite additions/removals merge separately; conflicting changes to the same setting use the last server-processed update.

### Notifications

Save a filter with **Save as new**, then turn on its **bell** in the **Saved** tab to receive notifications for new matching aircraft. For example, save helicopters within 25 km or descending aircraft below a chosen altitude. You can also enable or disable each saved filter under **Notifications → Notification settings**. A saved view needs at least one filter to enable its bell. Notifications work while Vector is open and live; they are not push messages when the browser is closed.

Watched filters monitor all received aircraft, independently of the current map view, search and active filters. A match must remain true for ten seconds. Overlapping filters and favorite arrivals share one row per aircraft, showing the matching filter names. Clicking a notification opens the aircraft; any current search or filters hiding it are cleared. A contact must stop matching for five observed minutes before it can trigger again. Startup, reconnection, return from sleep/history, enabling a rule or changing its criteria establish a baseline without notifying about aircraft already present. Emergency squawks take precedence and remain immediate.

The notification choices synchronize with saved views. The event log and read state remain local and can be cleared in the event center. It keeps one latest filter/favorite notification per aircraft, separate emergency codes, and one receiver-status row, for up to 24 hours and 100 entries. Existing duplicates are consolidated automatically. Repeats update the row instead of adding another; a read notification only becomes unread again after a 30-minute quiet period.

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
