# GSO Village

A watch-only, low-res, top-down pixel village of Greensboro, NC that shows what's going on in the city from live local data.

This is the first end-to-end slice: one source (the Muse social-media digest) goes from email to JSON to a rendered village.

```
Muse digest email  ->  data/raw/*.txt  ->  npm run ingest  ->  public/data/items.json  ->  public/index.html (canvas village)
```

## Run it

Needs Node 20 or newer. No packages to install.

```sh
npm run dev      # ingest the digests, then serve on http://localhost:8080
npm test         # parser, date, placement and privacy-rule tests
```

## How it works

- **Ingest** (`scripts/ingest.mjs`, `scripts/lib.mjs`): reads every `data/raw/*.txt`, pulls out the `ITEM | ...` lines (12 pipe-separated fields, `n/a` for blanks), normalizes dates to Eastern time, dedupes by post URL, and places each item in a village district by address, venue or title.
- **Public-site rules** (in `applyRules`): individuals' names are never shown (their items read as "a local post"), personal posts from individuals are held back, and unverified news is held back. Held items go to `data/held.json`, which is outside `public/` and ignored by git.
- **Village** (`public/village.js`): a seeded, procedural pixel map built from `public/data/map.json` (roads, railroad, district landmarks), with villagers walking the roads, a marker over each district that has something on, crowds outside places with events today, overheard "chatter" bubbles, and a day/night tint on Greensboro time. Click a building to filter the side list. It re-reads `items.json` every minute.

## Getting digests into `data/raw/`

For now, save each "Greensboro update" email body as a `.txt` file in `data/raw/` (the file name is used as the digest id; a timestamp like `2026-11-11T1902Z.txt` works well). Raw digests name private individuals, so `data/raw/` is git-ignored.

Next step: fetch the digests automatically from a project inbox instead of saving them by hand.

## Map

`public/data/map.json` is a hand-placed, functional layout on a 96x60 tile grid: Elm St runs north-south, Market St east-west, the railroad crosses south of downtown, A&T is east, UNCG and the Coliseum are southwest. It is meant to be navigable, not to scale. Add districts or roads there; add placement rules in `locate()` in `scripts/lib.mjs`.

## Crime by district

`npm run crime` writes `public/data/crime.json`: reported incidents per Greensboro Police division for the last full Monday-to-Sunday week, next to the week before. It shows up in the side panel as "Week by district" (`public/crime.js`). Crime is never drawn on the map.

- **Source:** the City of Greensboro's open data ("GPD - Crime", ArcGIS layer `OpenGateCity/OpenData_ES_MS/MapServer/4`). Free, no key.
- **Privacy by construction:** the fetcher only ever requests `inci_id`, `district`, `ibr_code` and `date_rept`. No addresses, coordinates, premises or victim fields are requested, so none can reach the site. A test checks this.
- **Counting:** each incident counts once, under its most serious offense (violent, property, other). Sheriff and other agencies' incidents go in an "Other agencies" row.
- **Half-filled weeks:** if the newest week is far below the weeks before it (records still arriving), it steps back a week rather than show a fake drop.
- **Stale feed:** as of November 2026 the City's feed stopped at October 6, 2025. The page says so and shows the latest full week the City published. It picks up new data on its own once the City resumes.
