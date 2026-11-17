// Pull Muse "Greensboro update" digest emails from Gmail into data/raw/, then run ingest.
//
// Usage: node scripts/fetch-digests.mjs [--no-ingest] [--dry-run]
//
// Env (see README "Fetching digests automatically"):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN   read-only OAuth credentials for the inbox
//   DIGEST_QUERY   Gmail search for digests (default: subject:"Greensboro update" newer_than:14d)
//   DIGEST_MAX     most messages to look at per run (default 200)

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getAccessToken, gmailClient, newDigests } from './gmail.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data', 'raw');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const creds = {
  clientId: process.env.GMAIL_CLIENT_ID,
  clientSecret: process.env.GMAIL_CLIENT_SECRET,
  refreshToken: process.env.GMAIL_REFRESH_TOKEN,
};
const missing = Object.entries({ GMAIL_CLIENT_ID: creds.clientId, GMAIL_CLIENT_SECRET: creds.clientSecret, GMAIL_REFRESH_TOKEN: creds.refreshToken })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. See README, "Fetching digests automatically".`);
  process.exit(2);
}

const query = process.env.DIGEST_QUERY || 'subject:"Greensboro update" newer_than:14d';
const max = Number(process.env.DIGEST_MAX || 200);

const gmail = gmailClient(await getAccessToken(creds));
const ids = await gmail.listMessageIds(query, max);
await mkdir(rawDir, { recursive: true });

// What is already saved, and which Gmail message each file holds.
const saved = new Map();
for (const f of (await readdir(rawDir)).filter((n) => n.endsWith('.txt'))) {
  saved.set(f, (await readFile(join(rawDir, f), 'utf8')).match(/^Gmail-Id: (\S+)$/m)?.[1] || null);
}

// Each digest is written as it arrives, so a failure part-way keeps what was already downloaded.
const { files, skipped } = await newDigests(gmail, ids, saved, {
  save: async ({ name, text }) => {
    if (dryRun) console.log(`  would save ${name}`);
    else await writeFile(join(rawDir, name), text);
  },
});

console.log(`${ids.length} digest emails matched: ${files.length} ${dryRun ? 'new (dry run)' : 'saved'}, ${skipped} already in data/raw.`);

if (!dryRun && !args.has('--no-ingest')) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'ingest.mjs')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
