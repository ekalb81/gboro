# GSO Village

A watch-only, low-res, top-down pixel village of Greensboro, NC that shows what's going on in the city from live local data.

This is the first end-to-end slice: one source (the Muse social-media digest) goes from email to JSON to a rendered village.

```
Muse digest email  ->  data/raw/*.txt  ->  npm run ingest  ->  public/data/items.json  ->  public/index.html (canvas village)
```

## Run it

Needs Node 20 or newer. No packages to install.

```sh
npm run dev      # ingest the digests, fetch the weather, then serve on http://localhost:8080
npm run weather  # refresh just the weather
npm test         # parser, date, placement and privacy-rule tests
```

## How it works

- **Ingest** (`scripts/ingest.mjs`, `scripts/lib.mjs`): reads every `data/raw/*.txt`, pulls out the `ITEM | ...` lines (12 pipe-separated fields, `n/a` for blanks), normalizes dates to Eastern time, dedupes by post URL, and places each item in a village district by address, venue or title.
- **Public-site rules** (in `applyRules`): individuals' names are never shown (their items read as "a local post"), personal posts from individuals are held back, and unverified news is held back. Held items go to `data/held.json`, which is outside `public/` and ignored by git.
- **Village** (`public/village.js`): a seeded, procedural pixel map built from `public/data/map.json` (roads, railroad, district landmarks), with villagers walking the roads, a marker over each district that has something on, crowds outside places with events today, overheard "chatter" bubbles, and a day/night tint on Greensboro time. Click a building to filter the side list. It re-reads `items.json` every minute.

## Weather

`npm run weather` reads the latest observation from the Greensboro airport station (KGSO) and any active alerts for downtown from the National Weather Service API (free, no key), and writes `public/data/weather.json`. The village shows rain, snow, storms with lightning, fog and drifting cloud shadows, darkens under bad weather, and shows active alerts in a red banner. It re-reads the file every 5 minutes. If a fetch fails, the last file is kept.

To preview a sky without waiting for it, add `?weather=rain`, `snow`, `storm`, `fog`, `cloudy`, `partly` or `clear` to the URL.

## Getting digests into `data/raw/`

For now, save each "Greensboro update" email body as a `.txt` file in `data/raw/` (the file name is used as the digest id; a timestamp like `2026-11-11T1902Z.txt` works well). Raw digests name private individuals, so `data/raw/` is git-ignored.

Next step: fetch the digests automatically from a project inbox instead of saving them by hand.

## Map

`public/data/map.json` is a hand-placed, functional layout on a 96x60 tile grid: Elm St runs north-south, Market St east-west, the railroad crosses south of downtown, A&T is east, UNCG and the Coliseum are southwest. It is meant to be navigable, not to scale. Add districts or roads there; add placement rules in `locate()` in `scripts/lib.mjs`.
