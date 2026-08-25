# Vector ADS-B Radar

Vector is een moderne frontend voor [readsb](https://github.com/wiedehopf/readsb) en tar1090-data. De applicatie toont actuele vliegtuigen op een MapLibre-kaart en gebruikt de bestaande JSON- en `globe_history`-uitvoer van de receiver; readsb zelf hoeft niet te worden aangepast.

## Functionaliteit

- live vliegtuigkaart met richting, type-afhankelijke tar1090-iconen en hoogtekleuren;
- doorzoekbare, sorteerbare en filterbare vliegtuiglijst;
- detailpaneel met vluchtgegevens, route, volledige luchthavennamen en vliegtuigfoto;
- hoogtegekleurde leg traces voor het geselecteerde toestel;
- geschiedenis met tijdlijn, afspeelsnelheid en terugkeer naar live;
- instelbare labels en eenheden: metrisch, luchtvaart of imperial;
- externe serverconfiguratie voor readsb, sitenaam en receiver;
- responsieve interface voor desktop en kleinere schermen.

## Raspberry Pi en Debian 13

### Vereisten

- Raspberry Pi met 64-bits Debian 13 (`arm64`); Debian 13 `amd64` wordt eveneens ondersteund;
- een bestaande en lokaal bereikbare readsb/tar1090-installatie;
- `systemd` en internettoegang tijdens de installatie;
- ongeveer 1 GB vrije schijfruimte voor broncode, dependencies en de build.

Het [Debian 13-pakket](https://packages.debian.org/trixie/nodejs) levert Node.js 20.19.2, terwijl de gebruikte Vinext-versie Node.js 22 vereist. Het installatiescript vervangt daarom de systeemversie niet. Het installeert de [officiële Node.js 22.23.2 ARM64-build](https://nodejs.org/en/blog/release/v22.23.2/) geïsoleerd onder `/opt/vector/runtime`, controleert de vastgelegde SHA-256-checksum en activeert pnpm 11.19.0 via [Corepack](https://nodejs.org/download/release/latest-v22.x/docs/api/corepack.html). Dit voorkomt conflicten met readsb of andere software op de Pi.

### Installeren

Download het script, bekijk het desgewenst en voer het als root uit:

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
less /tmp/vector-install.sh
sudo bash /tmp/vector-install.sh
```

Het script is herhaalbaar en:

- installeert Vector onder `/opt/vector`;
- maakt één niet-inlogbare systeemgebruiker `vector` aan;
- bewaart lokale configuratie onder `/etc/vector/vector.env`;
- bouwt een zelfstandige Vinext-serverbundle;
- installeert en activeert `vector.service`;
- luistert standaard op `0.0.0.0:3000` en herstart na fouten.

Een bestaande `/etc/vector/vector.env` wordt bij installatie en updates behouden. Het script stopt wanneer de checkout onder `/opt/vector/app` lokale wijzigingen bevat, zodat deze niet stilzwijgend worden overschreven.

### Configuratie

Bewerk de lokale configuratie en herstart daarna de service:

```bash
sudoedit /etc/vector/vector.env
sudo systemctl restart vector
```

De veilige standaardconfiguratie voor tar1090 op dezelfde Pi is:

```ini
READSB_LIVE_URL=http://127.0.0.1/tar1090/data/
READSB_HISTORY_URL=http://127.0.0.1/tar1090/globe_history/
VECTOR_SITE_NAME=Vector
VECTOR_RECEIVER_TITLE="Local readsb receiver"
VECTOR_UNIT_SYSTEM=metric
VECTOR_MAP_STYLE_URL=/map-style.json
HOST=0.0.0.0
PORT=3000
```

`VECTOR_UNIT_SYSTEM` accepteert `metric`, `aeronautical` of `imperial`; de standaard is `metric`. `READSB_LIVE_URL` wijst naar de map met minimaal `receiver.json`, `aircraft.json` en optioneel `traces/`. `READSB_HISTORY_URL` wijst naar de door readsb geschreven `globe_history`-map met replaybestanden zoals `YYYY/MM/DD/heatmap/NN.bin.ttf`.

De upstream-URLs blijven op de server. De browser krijgt alleen relatieve proxyresources te zien en kan de proxy niet naar een andere host sturen. HTTP-redirects, credentials in upstream-URLs, path traversal en onbekende bestanden worden geweigerd.

Vector gebruikt geen `public/config.json`. De server bouwt `/api/config` uitsluitend op uit de environmentconfiguratie en veilige standaardwaarden. Gebruik lokaal een door Git genegeerde `.env.local`; de Pi-installatie gebruikt uitsluitend `/etc/vector/vector.env`.

### Openen

Open Vector vanaf een apparaat op hetzelfde netwerk:

```text
http://<pi-adres>:3000
```

Vervang `<pi-adres>` door het LAN-adres van de Raspberry Pi. Poort 3000 moet bereikbaar zijn in een eventueel actieve firewall. `HOST=127.0.0.1` beperkt Vector tot lokale toegang; pas dan een eigen reverse proxy toe.

### Service beheren

```bash
sudo systemctl start vector
sudo systemctl stop vector
sudo systemctl restart vector
systemctl status vector --no-pager
```

Live logs bekijken:

```bash
journalctl -u vector -f
```

De laatste honderd logregels bekijken:

```bash
journalctl -u vector -n 100 --no-pager
```

### Bijwerken

Voer het actuele installatiescript opnieuw uit. De Git-checkout, dependencies, productiebuild en service worden bijgewerkt; `/etc/vector/vector.env` blijft behouden.

```bash
curl -fsSLo /tmp/vector-install.sh \
  https://raw.githubusercontent.com/Cypher87/Vector/main/scripts/install-debian.sh
sudo VECTOR_REF=main bash /tmp/vector-install.sh
```

Voor een specifieke release, branch of commit kan `VECTOR_REF` worden aangepast:

```bash
sudo VECTOR_REF=v1.2.3 bash /tmp/vector-install.sh
```

### Volledig verwijderen

Download zo nodig eerst het installatiescript opnieuw. `--purge` verwijdert ook de configuratie, state-directory en systeemgebruiker; maak vooraf een back-up als de configuratie bewaard moet blijven.

```bash
sudo bash /tmp/vector-install.sh --uninstall --purge
```

Zonder `--purge` blijven `/etc/vector/vector.env`, `/var/lib/vector` en het serviceaccount behouden:

```bash
sudo bash /tmp/vector-install.sh --uninstall
```

## Lokale ontwikkeling

Vereisten voor ontwikkeling zijn Node.js 22.13 of nieuwer en pnpm 11.19.0. Maak een genegeerd `.env.local`-bestand met dezelfde variabelen als `/etc/vector/vector.env` en start daarna:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Kwaliteitscontroles:

```bash
pnpm lint
pnpm test
pnpm build
```

## Productieruntime

Vector is **geen statische build**. De routes `/api/config` en `/api/readsb` moeten actief blijven om externe configuratie veilig te laden en live data, traces en history replay op te halen. `pnpm build` maakt daarom een Vinext standalone Node-server in `dist/standalone/`; de systemd-service start `dist/standalone/server.js`.

Voor een handmatige productie-run:

```bash
pnpm build
HOST=0.0.0.0 PORT=3000 pnpm start
```

De meegeleverde kaartstijl gebruikt online kaarttegels. Route- en fotogegevens worden eveneens via externe diensten opgehaald wanneer die informatie beschikbaar is.

## Architectuur

De technische opzet en uitbreidingsrichting staan in [`docs/ARCHITECTUUR.md`](docs/ARCHITECTUUR.md).

## Licenties en databronnen

Vector gebruikt vliegtuigvormen en typekoppelingen die zijn afgeleid van tar1090. Zie [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) en de meegeleverde GPL-licentietekst voor de vereiste bronvermelding.
