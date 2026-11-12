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
