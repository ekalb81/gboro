// Pull Muse "Greensboro update" digest emails from Gmail into data/raw/, then run ingest.
//
// Usage: node scripts/fetch-digests.mjs [--no-ingest] [--dry-run]
//
// Env (see README "Fetching digests automatically"):
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN   read-only OAuth credentials for the inbox
//   DIGEST_QUERY   Gmail search for digests (default: subject:"Greensboro update" newer_than:14d)
//   DIGEST_MAX     most messages to look at per run (default 200)

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getAccessToken, gmailClient, digestFileName, digestFileText } from './gmail.mjs';

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

const exists = (p) => access(p).then(() => true, () => false);

const gmail = gmailClient(await getAccessToken(creds));
const ids = await gmail.listMessageIds(query, max);
await mkdir(rawDir, { recursive: true });

let saved = 0;
let skipped = 0;
for (const id of ids) {
  // Cheap call first: the received time names the file, so saved digests are skipped without downloading the body.
  const meta = await gmail.getMessage(id, 'minimal');
  const base = digestFileName(meta.internalDate);
  let name = `${base}.txt`;
  if (await exists(join(rawDir, `${base}-${id}.txt`))) {
    skipped++;
    continue;
  }
  if (await exists(join(rawDir, name))) {
    // Same minute: it's this message unless the file names a different Gmail id.
    // Hand-saved files have no Gmail-Id line, so they count as this message.
    const savedId = (await readFile(join(rawDir, name), 'utf8')).match(/^Gmail-Id: (\S+)$/m)?.[1];
    if (!savedId || savedId === id) {
      skipped++;
      continue;
    }
    name = `${base}-${id}.txt`; // a second digest in the same minute: keep both
  }
  const msg = await gmail.getMessage(id, 'full');
  const text = digestFileText(msg);
  if (!/^ITEM\s*\|/m.test(text)) console.warn(`  ${base}: no ITEM lines (saved anyway; ingest will ignore it)`);
  if (dryRun) console.log(`  would save ${name}`);
  else await writeFile(join(rawDir, name), text);
  saved++;
}

console.log(`${ids.length} digest emails matched: ${saved} ${dryRun ? 'new (dry run)' : 'saved'}, ${skipped} already in data/raw.`);

if (!dryRun && !args.has('--no-ingest')) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'ingest.mjs')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
