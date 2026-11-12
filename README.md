# GSO Village

A watch-only, low-res, top-down pixel village of Greensboro, NC that shows what's going on in the city from live local data.

This is the first end-to-end slice: one source (the Muse social-media digest) goes from email to JSON to a rendered village.

```
Muse digest email  ->  data/raw/*.txt  ->  npm run ingest  ->  public/data/items.json  ->  public/index.html (canvas village)
```

## Run it

Needs Node 20 or newer. No packages to install.

```sh
npm run dev      # ingest the digests, fetch road closures, then serve on http://localhost:8080
npm run roads    # refresh just the road closures
npm test         # parser, date, placement and privacy-rule tests
```

## How it works

- **Ingest** (`scripts/ingest.mjs`, `scripts/lib.mjs`): reads every `data/raw/*.txt`, pulls out the `ITEM | ...` lines (12 pipe-separated fields, `n/a` for blanks), normalizes dates to Eastern time, dedupes by post URL, and places each item in a village district by address, venue or title.
- **Public-site rules** (in `applyRules`): individuals' names are never shown (their items read as "a local post"), personal posts from individuals are held back, and unverified news is held back. Held items go to `data/held.json`, which is outside `public/` and ignored by git.
- **Village** (`public/village.js`): a seeded, procedural pixel map built from `public/data/map.json` (roads, railroad, district landmarks), with villagers walking the roads, a marker over each district that has something on, crowds outside places with events today, overheard "chatter" bubbles, and a day/night tint on Greensboro time. Click a building to filter the side list. It re-reads `items.json` every minute.

## Road closures and traffic

`npm run roads` reads every NCDOT traffic event from DriveNC (free), keeps the ones in Greensboro, places each on the village map and writes `public/data/roads.json` (git-ignored). The village shows each one as a thing in town: barrels and a sawhorse across a closed street, cones and a digging worker for roadwork, two bumped cars under flashing lights for a crash, and bunting for a street closed for a parade or race. Walkers turn around at barrels. Hover an event to read it; the side list ("On the roads") has the details and anything coming up. The page re-reads the file every 5 minutes. If a fetch fails, the last file is kept.

- **Source.** With `DRIVENC_KEY` set, it uses DriveNC's documented [Events API](https://www.drivenc.gov/help/endpoint/event) (free developer key from DriveNC). Without a key it reads the same events from the public DriveNC site's own list and map feeds, which works today but is not a published API and could change.
- **Placement** (`scripts/roads.mjs`). The village map is a schematic, so real coordinates go through an affine fit to a handful of anchor points (Elm and Market, Benbow and Lee, the Coliseum, Friendly Center and so on) with a smooth correction that lands each anchor on its tile. Events on a road the village draws (Elm, Market, Friendly, Spring Garden, Gate City/Lee, Benbow, Battleground, Aycock) snap onto that road; others get a short side street where they are. Add anchors or road names there.
- **Greensboro only.** Guilford County events inside a box around the city; High Point and the rural county are left out. Upcoming events with no location yet only show in the list, and only if they are on a village road.

To see every kind without waiting for a crash, add `?roads=demo` to the URL.

## Getting digests into `data/raw/`

For now, save each "Greensboro update" email body as a `.txt` file in `data/raw/` (the file name is used as the digest id; a timestamp like `2026-11-11T1902Z.txt` works well). Raw digests name private individuals, so `data/raw/` is git-ignored.

Next step: fetch the digests automatically from a project inbox instead of saving them by hand.

## Map

`public/data/map.json` is a hand-placed, functional layout on a 96x60 tile grid: Elm St runs north-south, Market St east-west, the railroad crosses south of downtown, A&T is east, UNCG and the Coliseum are southwest. It is meant to be navigable, not to scale. Add districts or roads there; add placement rules in `locate()` in `scripts/lib.mjs`.
