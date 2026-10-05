# Third-party notices

## Optional aircraft database

The standalone installer downloads `aircraft.csv.gz` from
[wiedehopf/tar1090-db](https://github.com/wiedehopf/tar1090-db/tree/csv).
It is stored outside the Git checkout and is not bundled in Vector releases.
The upstream compilation uses [Mictronics](https://github.com/Mictronics/aircraft-database),
ADS-B Exchange and additional aircraft type descriptions; see the
[upstream update process](https://github.com/wiedehopf/tar1090-db/blob/master/update.sh).

Contains information from the Mictronics aircraft database, made available under
the [Open Data Commons Attribution License](https://github.com/Mictronics/aircraft-database/blob/main/LICENSE).
This notice does not relicense other source contributions. Consult their source
terms before redistributing a database. Credits are also available at `/credits.html`.

## Vector aircraft icons

The silhouettes in `src/map/vector-aircraft-shapes.ts` were drawn for Vector.
They are included under Vector's [GPL-3.0 license](LICENSE). Aircraft-family
classification is shared with Vector's filters; no external marker catalog is loaded.

Earlier releases included tar1090-derived icons and their corresponding notices.
Those assets and their generator are no longer included in this release. This
does not change the license or notices of earlier releases. The separately
downloaded aircraft database and its attribution above remain unchanged.
