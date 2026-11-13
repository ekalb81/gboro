# GSO Village

A watch-only, low-res, top-down pixel village of Greensboro, NC that shows what's going on in the city from live local data.

This is the first end-to-end slice: one source (the Muse social-media digest) goes from email to JSON to a rendered village.

```
Muse digest email  ->  data/raw/*.txt  ->  npm run ingest  ->  public/data/items.json  ->  public/index.html (canvas village)
```

## Run it

Needs Node 20 or newer. No packages to install.

```sh
npm run dev      # ingest the digests, fetch the weather and road closures, then serve on http://localhost:8080
npm run weather  # refresh just the weather
npm run roads    # refresh just the road closures
npm test         # parser, date, placement and privacy-rule tests
```

## How it works

- **Ingest** (`scripts/ingest.mjs`, `scripts/lib.mjs`): reads every `data/raw/*.txt`, pulls out the `ITEM | ...` lines (12 pipe-separated fields, `n/a` for blanks), normalizes dates to Eastern time, dedupes by post URL, and places each item in a village district by address, venue or title.
- **Public-site rules** (in `applyRules`): individuals' names are never shown (their items read as "a local post"), personal posts from individuals are held back, and unverified news is held back. Held items go to `data/held.json`, which is outside `public/` and ignored by git.
- **Village** (`public/village.js`): a seeded, procedural pixel map built from `public/data/map.json` (roads, railroad, district landmarks), with villagers walking the roads, a marker over each district that has something on, crowds outside places with events today, overheard "chatter" bubbles, and a day/night tint on Greensboro time. Click a building to filter the side list. It re-reads `items.json` every minute.

## Weather

`npm run weather` reads the latest observation from the Greensboro airport station (KGSO) and any active alerts for downtown from the National Weather Service API (free, no key), and writes `public/data/weather.json`. The village shows rain, snow, storms with lightning, fog and drifting cloud shadows, darkens under bad weather, and shows active alerts in a red banner. It re-reads the file every 5 minutes. If a fetch fails, the last file is kept.

To preview a sky without waiting for it, add `?weather=rain`, `snow`, `storm`, `fog`, `cloudy`, `partly` or `clear` to the URL.
## Road closures and traffic

`npm run roads` reads every NCDOT traffic event from DriveNC (free), keeps the ones in Greensboro, places each on the village map and writes `public/data/roads.json` (git-ignored). The village shows each one as a thing in town: barrels and a sawhorse across a closed street, cones and a digging worker for roadwork, two bumped cars under flashing lights for a crash, and bunting for a street closed for a parade or race. Walkers turn around at barrels. Hover an event to read it; the side list ("On the roads") has the details and anything coming up. The page re-reads the file every 5 minutes. If a fetch fails, the last file is kept.

- **Source.** With `DRIVENC_KEY` set, it uses DriveNC's documented [Events API](https://www.drivenc.gov/help/endpoint/event) (free developer key from DriveNC). Without a key it reads the same events from the public DriveNC site's own list and map feeds, which works today but is not a published API and could change.
- **Placement** (`scripts/roads.mjs`). The village map is a schematic, so real coordinates go through an affine fit to a handful of anchor points (Elm and Market, Benbow and Lee, the Coliseum, Friendly Center and so on) with a smooth correction that lands each anchor on its tile. Events on a road the village draws (Elm, Market, Friendly, Spring Garden, Gate City/Lee, Benbow, Battleground, Aycock) snap onto that road; others get a short side street where they are. Add anchors or road names there.
- **Greensboro only.** Guilford County events inside a box around the city; High Point and the rural county are left out. Upcoming events with no location yet only show in the list, and only if they are on a village road.

To see every kind without waiting for a crash, add `?roads=demo` to the URL.

Scheduling: registered in `scripts/collectors.json`, and the publish workflow passes the `DRIVENC_KEY` repo secret to it. Without the secret it uses the keyless public feed.

## Getting digests into `data/raw/`

For now, save each "Greensboro update" email body as a `.txt` file in `data/raw/` (the file name is used as the digest id; a timestamp like `2026-11-11T1902Z.txt` works well). Raw digests name private individuals, so `data/raw/` is git-ignored.

### Fetching digests automatically

```sh
npm run fetch            # pull new digest emails into data/raw/, then ingest
npm run fetch -- --dry-run      # list what would be saved, change nothing
npm run fetch -- --no-ingest    # save only
```

`scripts/fetch-digests.mjs` searches Gmail for `subject:"Greensboro update" newer_than:14d` (override with `DIGEST_QUERY`). It saves each new email's text as `data/raw/<received UTC>.txt`, for example `2026-11-11T1902Z.txt`, and skips digests it already has. It uses Gmail's REST API with read-only access and no packages.

It needs three environment variables:

| Variable | What it is |
|---|---|
| `GMAIL_CLIENT_ID` | OAuth client ID (Web application type) from a Google Cloud project with the Gmail API enabled |
| `GMAIL_CLIENT_SECRET` | That client's secret |
| `GMAIL_REFRESH_TOKEN` | A refresh token for the inbox, granted only the `https://www.googleapis.com/auth/gmail.readonly` scope |

One-time setup:

1. In Google Cloud Console, create a project and enable the Gmail API.
2. Configure the OAuth consent screen as External and add the inbox as a test user. Then **publish the app to "In production"**. While the app is in "Testing", Google expires refresh tokens after 7 days. An unverified app used only by its owner is fine; Google shows an "unverified app" warning once, which you click through.
3. Create an OAuth client of type **Web application**, with `https://developers.google.com/oauthplayground` as an authorized redirect URI. The OAuth Playground only works with a web client.
4. Get a refresh token. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), open the gear menu, set OAuth flow to **Server-side** (client-side gives no refresh token), tick "Use your own OAuth credentials", paste the client ID and secret, authorize the `gmail.readonly` scope while signed in as the inbox, then exchange the code for tokens. The refresh token only works with the client that issued it, so use that same client's ID and secret below.
5. Put the three values in GitHub Actions secrets, or locally in `.env` (git-ignored) and run `node --env-file=.env scripts/fetch-digests.mjs`.

Point it at a dedicated project inbox rather than a personal account if you can. A Gmail filter can forward only the "Greensboro update" emails there, so the token can't read anything else.

## Map

`public/data/map.json` is a hand-placed, functional layout on a 96x60 tile grid: Elm St runs north-south, Market St east-west, the railroad crosses south of downtown, A&T is east, UNCG and the Coliseum are southwest. It is meant to be navigable, not to scale. Add districts or roads there; add placement rules in `locate()` in `scripts/lib.mjs`.

### News feeds and Bluesky

```sh
npm run feeds                  # pull new items from data/sources.json into data/raw/, then ingest
npm run feeds -- --dry-run     # print the new ITEM lines, change nothing
npm run feeds -- --days=3      # only look back 3 days (default 7)
```

`scripts/fetch-feeds.mjs` reads the RSS/Atom feeds and Bluesky accounts listed in `data/sources.json`. It writes new items as Muse-style `ITEM` lines to `data/raw/feeds-<UTC>.txt`, so ingest, placement and the privacy rules treat every source the same way. Items whose URL is already in `data/raw/` are skipped, and a feed that fails is reported without stopping the others.

- **RSS sources** take `name`, `url`, and optionally `mustMatch`, a case-insensitive regex. Use it for regional outlets so only Greensboro stories come through. Items are tagged `news` and verified.
- **Bluesky sources** take `handle`, `name`, `accountType` (default `organization`) and optionally `category` and `mustMatch`. Only the account's own posts are used, not reposts or replies, via the public `getAuthorFeed` endpoint, which needs no login. List organizations only, not private individuals.

The feed URLs in `data/sources.json` haven't been checked against the live sites yet. Drop any that fail on the first run.

## Crime

`npm run crime` writes `public/data/crime.json`, shown in the side panel by `public/crime.js`. Crime is never drawn on the map. Two sources, fetched independently (if one fails, its last good copy is kept):

1. **Crime by month (FBI):** citywide violent and property offenses for the newest complete month, next to the month before, from the FBI Crime Data Explorer (GPD agency code `NC0410200`). Current and automatic, but citywide only and about six weeks behind. Needs a free key from https://api.data.gov/signup/ in `FBI_API_KEY`; without it this part is skipped. If the newest month is well under the months before it (still filling in), it uses the month before.
2. **Week by district (City):** reported incidents per Greensboro Police division for the last full Monday-to-Sunday week, next to the week before, from the City's open data ("GPD - Crime", ArcGIS layer `OpenGateCity/OpenData_ES_MS/MapServer/4`, no key). As of November 2026 the City's feed stopped at October 6, 2025, so the panel shows only the monthly table plus a note. The division table comes back on its own once the City's feed is current again.

- **Privacy by construction:** the City fetcher only ever requests `inci_id`, `district`, `ibr_code` and `date_rept`, never addresses, coordinates, premises or victim fields (a test checks this). The FBI data is citywide totals.
- **Counting (City):** each incident counts once, under its most serious offense (violent, property, other). Sheriff and other agencies go in an "Other agencies" row. A half-filled newest week is skipped rather than shown as a fake drop.
- **Outages:** each FBI request gets 25 seconds and up to three tries (502/503/504 and timeouts only). The publish workflow keeps the last good `crime.json` in an Actions cache (it holds only citywide and per-division totals), so if a source is down the site keeps showing its previous numbers.
- **Scheduling:** registered in `scripts/collectors.json` with no `env` entry, so the City part runs even without the key. The publish workflow passes the `FBI_API_KEY` repo secret to it.

## Council meetings and city events

`npm run civic` builds `public/data/civic.json` from the City's published council schedule, corrected during the year by City posts, local news and the City's YouTube recordings; City Hall lights up on council nights. See [docs/civic.md](docs/civic.md).

## Restaurants and bars

```sh
npm run eats     # fetch local restaurants, bars, cafes and breweries from OpenStreetMap
```

- **Collector** (`scripts/fetch-eats.mjs`, `scripts/eats-lib.mjs`): one Overpass API query for named restaurants, bars, pubs, nightclubs, cafes, takeout and breweries around Greensboro, written to `public/data/eats.json` (git-ignored). Chains (anything with an OSM `brand` tag) are left out; `--keep-chains` keeps them. Overpass servers are often busy or unreachable, so if it doesn't answer the collector falls back to reading map tiles from the main OSM API (about 40 small requests, a second apart). `--source=overpass` or `--source=osm-api` forces one. Places change slowly, so the publish workflow runs it with `--if-older-than=20` (it is in `scripts/collectors.json`) and keeps the last `eats.json` in an Actions cache; a failed fetch leaves the previous copy in place.
- **Placement**: the map is functional, not to scale, so each place goes to its nearest "hub" (Elm & Market, UNCG, A&T, Coliseum, Friendly Center, Battleground, Benbow & Lee, College Hill) and keeps its real direction and rough distance from it. Hubs and their scales are in `HUBS` in `eats-lib.mjs`. Places outside every hub's radius are skipped.
- **Hours**: OSM `opening_hours` is parsed for the common shapes (day ranges, several time ranges, past-midnight closing, `off`, `24/7`). Anything fancier counts as "not listed", and the village uses typical hours for that kind of place, labelled as a guess.
- **Village** (`public/eats.js`): each place is a little shop. Open places show a green light, their windows glow after dark, and open bars get a neon sign and a few people out front in the evening. A bar or restaurant named as the venue of a digest event today gets a pennant and a crowd. Hover a shop for its name and whether it's open; click it for details in the side panel.

Data © OpenStreetMap contributors, under the ODbL. Credit it wherever the site is published.
