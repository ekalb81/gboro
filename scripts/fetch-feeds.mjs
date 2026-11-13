// Pull news RSS feeds and Bluesky accounts listed in data/sources.json into data/raw/, then run ingest.
// Items are written as Muse-style ITEM lines, so ingest, placement and privacy rules apply unchanged.
//
// Usage: node scripts/fetch-feeds.mjs [--no-ingest] [--dry-run] [--days=N]

import { readdir, readFile, appendFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseFeed, feedItems, blueskyItems, urlsIn } from './feeds.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data', 'raw');
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const days = Number(argv.find((a) => a.startsWith('--days='))?.slice(7) || 7);
const since = new Date(Date.now() - days * 864e5);
const UA = 'gso-village/0.1 (community village map; https://github.com/ekalb81/gboro)';
const BSKY = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed';

const sources = JSON.parse(await readFile(join(root, 'data', 'sources.json'), 'utf8'));

async function get(url, accept) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// URLs already saved by any earlier digest or feed run.
await mkdir(rawDir, { recursive: true });
const seen = new Set();
for (const f of (await readdir(rawDir)).filter((f) => f.endsWith('.txt'))) {
  for (const u of urlsIn(await readFile(join(rawDir, f), 'utf8'))) seen.add(u);
}

const lines = [];
const report = [];
const keep = (name, found) => {
  const fresh = found.filter((l) => {
    const url = l.split('|')[7].trim();
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  lines.push(...fresh);
  report.push(`  ${name}: ${found.length} recent, ${fresh.length} new`);
};

for (const s of sources.rss || []) {
  try {
    const xml = await (await get(s.url, 'application/rss+xml, application/atom+xml, application/xml, text/xml')).text();
    keep(s.name, feedItems(s, parseFeed(xml), { since }));
  } catch (e) {
    report.push(`  ${s.name}: FAILED (${e.message})`);
  }
}

for (const s of sources.bluesky || []) {
  try {
    const url = `${BSKY}?actor=${encodeURIComponent(s.handle)}&limit=50&filter=posts_no_replies`;
    keep(s.name || s.handle, blueskyItems(s, await (await get(url, 'application/json')).json(), { since }));
  } catch (e) {
    report.push(`  ${s.name || s.handle}: FAILED (${e.message})`);
  }
}

console.log(report.join('\n'));
const stamp = new Date().toISOString().slice(0, 16).replace(':', '');
const file = `feeds-${stamp}Z.txt`;
if (!lines.length) console.log('No new feed items.');
else if (dryRun) console.log(`Would save ${lines.length} new items to data/raw/${file}:\n${lines.join('\n')}`);
else {
  // Append, never overwrite: a second run in the same minute must not drop the first run's items.
  const target = join(rawDir, file);
  const header = `Source: news feeds and Bluesky (scripts/fetch-feeds.mjs)\nFetched: ${new Date().toISOString()}\n\n`;
  const isNew = !(await readdir(rawDir)).includes(file);
  await appendFile(target, `${isNew ? header : ''}${lines.join('\n')}\n`);
  console.log(`Saved ${lines.length} new items to data/raw/${file}.`);
}

if (!dryRun && !argv.includes('--no-ingest')) {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'ingest.mjs')], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
