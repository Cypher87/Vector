# Guided installation and migration

For a standard Debian 13 readsb receiver, installation and migration use the **same command**. There is no need to find data paths, edit `.env`, configure permissions, or download metadata manually:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
sudo bash /tmp/vector-install.sh
```

Review the downloaded script before running it if desired. Once installation completes, open **`http://<pi-address>:3000`**.

## What happens automatically

The installer checks for at least 2 GiB free and builds the candidate in a separate `/opt/vector/releases/build-*` directory. It does not check out code or install dependencies over the running app. Privileged helper code and service units come from a separate root-only source checkout, never from the build directory writable by the webapp user. After the build, root owns the candidate and the installer logs its version and Git revision. The existing `/opt/vector/app` directory is migrated automatically to the release layout without losing its build.

1. Detect the running readsb systemd service and its actual live/history output paths.
2. Back up configuration and affected service files in root-only `/var/lib/vector-installer/`.
3. Prepare the aircraft database, preserving the last valid copy if downloading fails.
4. Reuse existing read permissions; readable output needs no ACL support (including on ACL-less tmpfs mounts). For restricted output, test ACL support before granting narrowly scoped access. A root-owned startup helper checks access when readsb recreates `/run` data after a restart.
5. Add missing recording/output options to the standard `/etc/default/readsb` configuration, if needed. Receiver device, gain, network, MLAT, feeder, and location settings are preserved.
6. Switch `/etc/vector/vector.env` to direct file access, preserving other settings. Staged settings are validated before replacing the live configuration.
7. Install/start Vector and the daily metadata updater. Verify that the API returns fresh receiver data, not merely that the process is running.

Existing readsb recordings are retained. If the installer creates a new history directory, it uses `/var/lib/readsb/vector-history` with a separate daily cleanup job and a **seven-day retention period**. Existing history directories and their retention policies are not changed. New history takes time to accumulate; a completed replay block will not exist immediately after recording is enabled.

readsb remains the decoder and recorder. Vector uses no tar1090 application, web endpoints, or icons, in either local or remote mode. The separate `tar1090-db` metadata dataset is retained. The installer does not uninstall other applications, stop shared web servers, or remove receiver data; an existing tar1090 installation is left untouched, but Vector does not use it.

## When the installer asks a question

- **Multiple running receivers:** choose the intended readsb service.
- **Existing external HTTP source:** enter another Vector server's URL, explicitly switch to local readsb, or cancel. Existing Vector-to-Vector connections are preserved without questions.
- **Missing recording options:** approve the brief readsb restart and new recording behavior. An already configured receiver does not need a restart just to switch Vector's data source.
- **No local receiver:** enter the URL of another Vector server. Vector does not install/configure an SDR decoder or guess device settings.

For automated installations, `--yes` accepts safe defaults and the necessary receiver restart. It never guesses between multiple receivers; specify one if needed:

```bash
sudo VECTOR_READSB_SERVICE=readsb.service bash /tmp/vector-install.sh --yes
```

To update only, retaining an existing `local` or `vector` data source:

```bash
sudo bash /tmp/vector-install.sh --keep-source
```

Automatic option changes support the conventional readsb systemd layout using `/etc/default/readsb` and `JSON_OPTIONS`. Custom startup wrappers, isolated/container receivers, unsupported readsb builds, and separately relocated full traces are not rewritten blindly. An unsupported configuration stops with an explanation before publishing new settings. `--keep-source` refuses legacy HTTP sources: rerun without it to migrate. Source choices are never guessed by `--yes`.

Only running readsb decoder processes count as receivers; companion services such as MQTT exporters are excluded. If a data path is genuinely unreadable and its filesystem cannot grant ACL access, installation stops with that path and restores configuration. It does not remount filesystems, grant write access, or make private data public.

## Recovery

A failed build does not change the active application. A failed migration or post-start data check restores the previous application, Node runtime, configuration, root-owned receiver helpers and affected service state. Recorded data, synchronization state and downloaded metadata are not reverted or deleted during recovery. If installation is interrupted, rerunning the installer first recovers the unfinished transaction. Concurrent installer runs are blocked.

To undo the most recent installation/update manually:

```bash
sudo bash /tmp/vector-install.sh --rollback
```

The app and runtime links are journaled before activation and restored before the old service is restarted. A separate root-owned recovery runner under `/usr/local/lib/vector-installer/` remains usable even when the active app/runtime links are interrupted or reverted. Later administrator edits are not silently overwritten: recovery stops and reports the protected backup location if it finds a conflict. Keep backups private because they may contain receiver settings. Backups made by older installers still offer configuration-only recovery; they do not contain a previous app build.

The previous builds are retained under `/opt/vector/releases/` for recovery; they are not receiver history. Do not manually remove the active or previous release while a rollback may still be needed. Vector 0.9 defaults to the development branch `main`, not a claimed stable 1.0 release. `VECTOR_REF` may select an existing installer-compatible tag or commit instead.

Uninstall removes the Vector permission hook before removing its runtime. readsb's recording options, history, and the independent retention job remain; `--purge` also removes Vector configuration, state, helper code, and migration backups. It does not purge receiver history.

## Browser updates

Run the current installer once to install `vector-updater.service`. Browser updates work on an official installer-managed instance, not on a development server or custom repository. They update the Vector server you opened, not a remote receiver supplying its data.

1. Set a separate administrator password (12–128 characters). Input is hidden and only a salted scrypt hash is saved; no password is passed through command arguments or shell history:

   ```bash
   sudo /opt/vector/runtime/node/bin/node /usr/local/lib/vector-updater/set-update-password.mjs
   ```

2. In `/etc/vector/vector.env`, set `VECTOR_UPDATES_ENABLED=true`. Leave the generated `VECTOR_UPDATE_PASSWORD_HASH` intact. The default is `false`.
3. Restart the webapp: `sudo systemctl restart vector`.
4. Refresh the browser, open **Settings → Updates**, unlock with the administrator password, check for updates, and confirm the proposed build.

The menu is hidden while updates are disabled; setting a password alone does not enable it. Checks are manual: there is no automatic startup or scheduled check. The open dialog polls local progress every 2.5 seconds, not GitHub. Use the password command again to change the administrator password.

The installed version and short Git revision distinguish releases and builds. Checks use the official `Cypher87/Vector` `main` branch. Each installation is pinned to the exact revision shown at confirmation. A browser cannot supply a different URL, repository, branch, installer flag or shell command. The worker uses the installer's shared lock, stages a separate release, preserves the source configuration, and checks fresh data after restarting. Source changes that need interactive decisions must be performed from the terminal instead.

The webapp remains unprivileged. The separate root-owned service accepts only bounded requests through a local Unix socket restricted to `root:vector`, checks the opt-in and password independently, and keeps its jobs/status outside the webapp. Password attempts are rate-limited, administrator sessions expire after 15 minutes, and changing the password or disabling updates invalidates sessions when next checked. Device synchronization sessions grant no update rights. Administrator tokens are scoped HTTP-only, same-site cookies, with `Secure` on HTTPS. **Use HTTPS outside a trusted LAN**; on plain HTTP a password can be intercepted. A reverse proxy must forward the correct host and protocol so same-origin checks continue to work.

Closing the browser does not cancel an accepted update. Progress reconnects after the brief webapp restart. The worker records the outcome before restarting itself with the new code. Interrupted jobs attempt the installer's pending recovery on worker startup; a recovery conflict is reported as requiring administrator attention rather than claiming success.

```bash
systemctl status vector-updater --no-pager
sudo journalctl -u vector-updater _TRANSPORT=stdout -n 100 --no-pager -o cat
```

Disable browser updates by setting `VECTOR_UPDATES_ENABLED=false` and restarting `vector`. This blocks new requests; it does not abort an already accepted installation halfway through. Full installer logs stay in the administrator's journal and are not exposed in the browser.

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

Legacy HTTP directory sources are no longer supported. The installer removes their obsolete environment settings after a successful migration; a manually started legacy configuration fails with migration instructions instead of silently choosing a different receiver. Photos, routes, and map tiles continue using their external providers. Use HTTPS or a trusted network. The packaged service needs an active Node.js runtime; it is not a static site.
