# Publishing GSO Village

The site is static: everything in `public/` is the whole site. One GitHub Actions workflow,
`.github/workflows/publish.yml`, keeps it fresh:

```
every 30 min, on push to main, or by hand
  -> npm test
  -> node scripts/refresh.mjs     (each collector in scripts/collectors.json, then ingest)
  -> check public/ has no private files
  -> deploy public/ to the host named in DEPLOY_TARGET
```

**Nothing goes public until you set `DEPLOY_TARGET`.** Until then the workflow only builds on push
or when run by hand, and scheduled runs are skipped.

## Recommended host: GitHub Pages, with the repo made public

- Free, no extra account, and the deploy is two built-in actions.
- Actions minutes are unlimited on public repos. A 30-minute schedule is about 1,440 runs a month,
  which would use most of the 2,000 free minutes a private repo gets.
- GitHub Pages on a private repo needs a paid plan.

Making the repo public is safe for the data: raw digests, held items and `items.json` are
git-ignored and never committed, and the collectors read their credentials from Actions secrets.
Check the git history yourself before flipping it, since it becomes public too.

### Switch it on

1. **Repo settings > General > Danger zone > Change visibility** to Public.
2. **Settings > Pages > Build and deployment > Source**: choose **GitHub Actions**.
3. **Settings > Secrets and variables > Actions > Variables**: add `DEPLOY_TARGET` = `github-pages`.
4. **Actions > Publish > Run workflow**. The site appears at `https://ekalb81.github.io/gboro/`.
5. Optional: a custom domain under Settings > Pages.

## Alternative: Cloudflare Pages, repo stays private

Free, and the repo can stay private (watch the Actions minutes, or change the cron in
`publish.yml` to hourly: `'7 * * * *'`).

1. In Cloudflare, create a Pages project named `gso-village` using **Direct Upload**
   (or set the variable `CLOUDFLARE_PROJECT` to another name).
2. Create an API token with the **Cloudflare Pages: Edit** permission.
3. Add Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Add the variable `DEPLOY_TARGET` = `cloudflare`, then run the workflow.

## Secrets the collectors use

| Secret | Collector | Without it |
|---|---|---|
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Muse digests | skipped; setup steps in the README |

News RSS, Bluesky and NWS weather need no secrets.

## Adding a data source

1. Write the collector as `scripts/fetch-<source>.mjs`. It should either write its own JSON into
   `public/data/` (like weather) or write Muse-style `ITEM` lines into `data/raw/` for ingest.
   Exit non-zero on failure; leave the last good output alone if you can.
2. Add one entry to `scripts/collectors.json`:
   ```json
   { "name": "Road closures (NCDOT)", "script": "scripts/fetch-roads.mjs", "args": [], "env": ["SOME_KEY"], "timeoutMinutes": 5 }
   ```
   `args`, `env` and `timeoutMinutes` (default 5) are optional. A collector is skipped if its
   script isn't there or a variable in `env` is unset.
3. If it needs a key, add it to Actions secrets and pass it in the "Collect data and ingest"
   step's `env:` in `publish.yml`.

Run `node scripts/refresh.mjs` locally to run everything (`--list` shows what's ready,
`--only=weather` runs one). One collector failing never stops the others; only an ingest failure
fails the run.

## How fresh data and privacy fit together

- Every run starts from a clean checkout and refetches recent data (digests from the last 14 days,
  feeds from the last 7). Raw posts name private people, so they are not stored in git or in an
  Actions cache, which fork pull requests on a public repo can read.
- The trade-off: if a source is down for a run, its items drop off the site until the next good run.
- The workflow fails the deploy if `held.json` or any raw `.txt` file ends up in `public/`.

## Things to know

- GitHub runs schedules late when it's busy, often by 5 to 15 minutes.
- On a public repo, GitHub pauses scheduled workflows after 60 days with no commits. Re-enable
  under Actions if that happens.
- To take the site down: delete the `DEPLOY_TARGET` variable, then unpublish under Settings > Pages
  (or delete the Cloudflare project).
