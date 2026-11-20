import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const empty = '<rss><channel></channel></rss>';
const rss = (...items) => '<rss><channel>' + items.map(([title, path]) =>
  '<item><title>' + title + '</title><link>https://example.com/' + path + '</link></item>'
).join('') + '</channel></rss>';

test('feed CLI overlaps RSS, preserves source precedence and appends, and fails on a total outage', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gboro-feeds-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, 'scripts'), data = join(root, 'data'), raw = join(data, 'raw');
  await Promise.all([mkdir(scripts), mkdir(raw, { recursive: true })]);
  const names = ['first', 'fast', 'empty', 'unavailable'];
  const sources = {
    rss: names.map((name) => ({ name, url: 'https://fixture.example/' + name })),
    bluesky: [{ handle: 'one.bsky.social' }, { handle: 'two.bsky.social', name: 'Sky Two' }],
  };
  const feed = {
    '/first': { wait: 60, body: rss(['First feed wins', 'same'], ['Already saved', 'seen']) },
    '/fast': { wait: 2, body: rss(['Later source duplicate', 'same'], ['Second feed new item', 'other']) },
    '/empty': { wait: 15, body: empty },
    '/unavailable': { status: 503 },
    'one.bsky.social': { wait: 10, body: '{"feed":[]}' },
    'two.bsky.social': { wait: 1, body: '{"feed":[]}' },
  };
  const sameMinute = join(raw, 'feeds-2026-11-13T2157Z.txt');
  const earlier = 'Fixture header\n\nITEM | news | Saved headline | n/a | n/a | n/a | n/a | https://example.com/seen | another source | news | n/a | yes\n';
  const preload = join(root, 'fake-fetch.mjs'), requests = join(root, 'requests.log'), fixture = join(root, 'responses.json');
  await Promise.all([
    ...['fetch-feeds.mjs', 'feeds.mjs'].map((file) => cp(new URL('../scripts/' + file, import.meta.url), join(scripts, file))),
    writeFile(join(scripts, 'ingest.mjs'), "console.log('Local ingest fallback ran.');\n"),
    writeFile(join(data, 'sources.json'), JSON.stringify(sources)),
    writeFile(sameMinute, earlier),
    writeFile(fixture, JSON.stringify(feed)),
    writeFile(preload, [
      "import { appendFileSync, readFileSync } from 'node:fs';",
      "import { setTimeout as delay } from 'node:timers/promises';",
      "const clock = Date.parse('2026-11-13T21:57:10Z'), RealDate = Date;",
      "globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } };",
      "const responses = JSON.parse(readFileSync(process.env.GBORO_FEED_RESPONSES, 'utf8'));",
      "globalThis.fetch = async (url) => {",
      "  const parsed = new URL(url), id = parsed.searchParams.get('actor') || parsed.pathname;",
      "  const reply = responses[id];",
      "  if (!reply) throw new Error('Unexpected fixture URL ' + url);",
      "  appendFileSync(process.env.GBORO_FEED_REQUESTS, 'start ' + id + '\\n');",
      "  await delay(reply.wait || 0);",
      "  appendFileSync(process.env.GBORO_FEED_REQUESTS, 'end ' + id + '\\n');",
      "  return new Response(reply.body || '', { status: reply.status || 200 });",
      "};",
    ].join('\n')),
  ]);
  const run = (...args) => exec(process.execPath, ['--import', pathToFileURL(preload).href, join(scripts, 'fetch-feeds.mjs'), ...args], {
    env: { ...process.env, GBORO_FEED_REQUESTS: requests, GBORO_FEED_RESPONSES: fixture },
  });

  const { stdout } = await run('--no-ingest');
  const traffic = (await readFile(requests, 'utf8')).trim().split('\n');
  assert.deepEqual(traffic.slice(0, 4), names.map((name) => 'start /' + name));
  assert.deepEqual(traffic.slice(-4), ['start one.bsky.social', 'end one.bsky.social', 'start two.bsky.social', 'end two.bsky.social']);
  assert.match(stdout, /first: 2 recent, 1 new\s+fast: 2 recent, 1 new\s+empty: 0 recent, 0 new\s+unavailable: FAILED \(HTTP 503\)/);
  const appended = await readFile(sameMinute, 'utf8');
  assert.ok(appended.startsWith(earlier));
  assert.match(appended.slice(earlier.length), /First feed wins.+\n.*Second feed new item/);
  assert.doesNotMatch(appended, /Later source duplicate|Already saved/);

  assert.match((await run('--no-ingest')).stdout, /No new feed items\./);
  assert.equal(await readFile(sameMinute, 'utf8'), appended);

  await writeFile(fixture, JSON.stringify(Object.fromEntries(Object.keys(feed).map((id) => [id, { status: 503 }]))));
  await assert.rejects(run(), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /first: FAILED \(HTTP 503\)/);
    assert.match(error.stdout, /Local ingest fallback ran\./);
    assert.match(error.stderr, /All configured feeds failed\./);
    return true;
  });
  assert.equal(await readFile(sameMinute, 'utf8'), appended);
});
