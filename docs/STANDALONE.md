# Guided installation and migration

For a standard Debian 13 readsb receiver, installation and migration use the **same command**. There is no need to find data paths, edit `.env`, configure permissions, or download metadata manually:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
sudo bash /tmp/vector-install.sh
```

Review the downloaded script before running it if desired. Once installation completes, open **`http://<pi-address>:3000`**.

## What happens automatically

1. Detect the running readsb systemd service and its actual live/history output paths.
2. Back up configuration and affected service files in root-only `/var/lib/vector-installer/`.
3. Prepare the aircraft database, preserving the last valid copy if downloading fails.
4. Reuse existing read permissions; readable output needs no ACL support (including on ACL-less tmpfs mounts). For restricted output, test ACL support before granting narrowly scoped access. A root-owned startup helper checks access when readsb recreates `/run` data after a restart.
5. Add missing recording/output options to the standard `/etc/default/readsb` configuration, if needed. Receiver device, gain, network, MLAT, feeder, and location settings are preserved.
6. Switch `/etc/vector/vector.env` to direct file access, preserving other settings. Staged settings are validated before replacing the live configuration.
7. Install/start Vector and the daily metadata updater. Verify that the API returns fresh receiver data, not merely that the process is running.

Existing readsb recordings are retained. If the installer creates a new history directory, it uses `/var/lib/readsb/vector-history` with a separate daily cleanup job and a **seven-day retention period**. Existing history directories and their retention policies are not changed. New history takes time to accumulate; a completed replay block will not exist immediately after recording is enabled.

readsb remains the decoder and recorder. Vector no longer needs the tar1090 web application/server for local data. The installer does not uninstall tar1090, stop shared web servers, or remove receiver data. This leaves the previous interface available as a fallback.

## When the installer asks a question

- **Multiple running receivers:** choose the intended readsb service.
- **Existing external source:** keep it or explicitly switch to the local receiver.
- **Missing recording options:** approve the brief readsb restart and new recording behavior. An already configured receiver does not need a restart just to switch Vector's data source.
- **No local receiver:** enter the URL of another Vector server. Vector does not install/configure an SDR decoder or guess device settings.

For automated installations, `--yes` accepts safe defaults and the necessary receiver restart. It never guesses between multiple receivers; specify one if needed:

```bash
sudo VECTOR_READSB_SERVICE=readsb.service bash /tmp/vector-install.sh --yes
```

To update only, retaining the existing data source:

```bash
sudo bash /tmp/vector-install.sh --keep-source
```

Automatic option changes support the conventional readsb systemd layout using `/etc/default/readsb` and `JSON_OPTIONS`. Custom startup wrappers, isolated/container receivers, unsupported readsb builds, and separately relocated full traces are not rewritten blindly. An unsupported configuration stops with an explanation before publishing new settings; an existing HTTP source can still be kept with `--keep-source`.

Only running readsb decoder processes count as receivers; companion services such as MQTT exporters are excluded. If a data path is genuinely unreadable and its filesystem cannot grant ACL access, installation stops with that path and restores configuration. It does not remount filesystems, grant write access, or make private data public.

## Recovery

A failed migration restores the previous configuration and affected service state. Recorded data and downloaded metadata are never deleted during recovery. If installation is interrupted, rerunning the installer first recovers the unfinished migration. Concurrent installer runs are blocked.

To restore the most recent migration manually while Vector is still installed:

```bash
sudo bash /tmp/vector-install.sh --rollback
```

This is configuration recovery, not a Git/build version downgrade. Later administrator edits are not silently overwritten: if a conflict is found, recovery stops and reports the protected backup location. Keep backups private because they may contain local URLs and receiver settings.

Uninstall removes the Vector permission hook before removing its runtime. readsb's recording options, history, and the independent retention job remain; `--purge` also removes Vector configuration, state, helper code, and migration backups. It does not purge receiver history.

## Aircraft database

The standalone database is downloaded from [wiedehopf/tar1090-db](https://github.com/wiedehopf/tar1090-db), independently of an installed tar1090 application. It is stored outside Git at `/var/lib/vector/aircraft-db/aircraft.csv.gz`. See [source attribution](../THIRD_PARTY_NOTICES.md#optional-aircraft-database).

The downloader validates the complete CSV and replaces it atomically. Invalid/incomplete downloads leave the previous file intact. Metadata reloads within about one minute on subsequent requests. Missing metadata does not fabricate a type or position. A first local installation needs a valid database before migration proceeds.

The **Receiver dashboard → Aircraft database** panel shows the installed database's last update time and record count, warning when the update is older than 48 hours. Failed downloads do not advance that time. This is database freshness, not a direct systemd timer check; use the commands below for timer state and logs.

```bash
systemctl list-timers vector-aircraft-db.timer
sudo systemctl start vector-aircraft-db
sudo journalctl -u vector-aircraft-db -n 50 --no-pager
sudo journalctl -u vector -n 100 --no-pager
```

## Advanced configuration

Only use these settings if overriding automatic detection is necessary. They belong in `/etc/vector/vector.env` on the Pi; restart Vector after editing.

```ini
READSB_SOURCE=local
READSB_LIVE_DIR=/run/readsb
READSB_HISTORY_DIR=/var/globe_history
VECTOR_AIRCRAFT_DATABASE=/var/lib/vector/aircraft-db/aircraft.csv.gz
```

The live directory contains `aircraft.json`, `receiver.json`, optional `outline.json`, and `traces/xx/trace_recent_<hex>.json` / `trace_full_<hex>.json`. Replay uses `YYYY/MM/DD/heatmap/NN.bin.ttf` below the history directory. Compressed files are decoded automatically, even without a `.gz` extension. Only validated resource paths and regular files are served; symlinks inside a data directory are rejected.

On a development PC, point the ignored `.env.local` at Vector on the Pi:

```ini
READSB_SOURCE=vector
READSB_REMOTE_URL=http://receiver.local:3000/
```

Use the actual Pi hostname/address and restart the development server. No local metadata download is needed. Chained Vector proxies are rejected to avoid loops. Synchronization belongs to the server visited in the browser, so development and production preferences stay separate.

Legacy HTTP directories remain supported with `READSB_SOURCE=http`, `READSB_LIVE_URL`, and `READSB_HISTORY_URL`. Photos, routes, and map tiles continue using their external providers. Use HTTPS or a trusted network. The packaged service needs an active Node.js runtime; it is not a static site.
