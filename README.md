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

## Restaurants and bars

```sh
npm run eats     # fetch local restaurants, bars, cafes and breweries from OpenStreetMap
```

- **Collector** (`scripts/fetch-eats.mjs`, `scripts/eats-lib.mjs`): one Overpass API query for named restaurants, bars, pubs, nightclubs, cafes, takeout and breweries around Greensboro, written to `public/data/eats.json` (git-ignored). Chains (anything with an OSM `brand` tag) are left out; `--keep-chains` keeps them. Overpass servers are often busy or unreachable, so if it doesn't answer the collector falls back to reading map tiles from the main OSM API (about 40 small requests, a second apart). `--source=overpass` or `--source=osm-api` forces one. Places change slowly, so a daily run is plenty.
- **Placement**: the map is functional, not to scale, so each place goes to its nearest "hub" (Elm & Market, UNCG, A&T, Coliseum, Friendly Center, Battleground, Benbow & Lee, College Hill) and keeps its real direction and rough distance from it. Hubs and their scales are in `HUBS` in `eats-lib.mjs`. Places outside every hub's radius are skipped.
- **Hours**: OSM `opening_hours` is parsed for the common shapes (day ranges, several time ranges, past-midnight closing, `off`, `24/7`). Anything fancier counts as "not listed", and the village uses typical hours for that kind of place, labelled as a guess.
- **Village** (`public/eats.js`): each place is a little shop. Open places show a green light, their windows glow after dark, and open bars get a neon sign and a few people out front in the evening. A bar or restaurant named as the venue of a digest event today gets a pennant and a crowd. Hover a shop for its name and whether it's open; click it for details in the side panel.

Data © OpenStreetMap contributors, under the ODbL. Credit it wherever the site is published.
