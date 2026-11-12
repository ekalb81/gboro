import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, feedItems, blueskyItems, easternStamp, itemLine, urlsIn, decodeEntities } from '../scripts/feeds.mjs';
import { parseDigest } from '../scripts/lib.mjs';

const RSS = `<?xml version="1.0"?><rss><channel><title>Rhino</title>
<item><title><![CDATA[Council OKs Elm St. plan | phase 2]]></title><link>https://www.rhinotimes.com/news/elm-plan/</link>
<pubDate>Tue, 10 Nov 2026 18:29:00 +0000</pubDate><description>&lt;p&gt;Greensboro City Council&amp;#8217;s vote&lt;/p&gt;</description></item>
<item><title>Winston-Salem bridge removal</title><link>https://example.com/ws-bridge</link><pubDate>Tue, 10 Nov 2026 12:00:00 +0000</pubDate><description>Forsyth story</description></item>
<item><title>Old story</title><link>https://example.com/old</link><pubDate>Mon, 01 Sep 2026 12:00:00 +0000</pubDate></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">A&amp;T homecoming recap</title>
<link rel="alternate" href="https://example.com/ghoe"/><published>2026-07-04T16:00:00Z</published><summary>Greensboro</summary></entry></feed>`;

test('parses RSS and Atom, unwrapping CDATA and entities', () => {
  const rss = parseFeed(RSS);
  assert.equal(rss.length, 3);
  assert.equal(rss[0].title, 'Council OKs Elm St. plan | phase 2');
  assert.equal(rss[0].url, 'https://www.rhinotimes.com/news/elm-plan/');
  assert.equal(rss[0].published.toISOString(), '2026-11-10T18:29:00.000Z');
  assert.match(rss[0].summary, /Council’s vote/);
  const atom = parseFeed(ATOM);
  assert.equal(atom[0].title, 'A&T homecoming recap');
  assert.equal(atom[0].url, 'https://example.com/ghoe');
  assert.equal(decodeEntities('&#x27;&#39;&quot;&bogus;'), `''"&bogus;`);
});

test('formats posted time in Greensboro time, EST or EDT', () => {
  assert.equal(easternStamp(new Date('2026-11-10T18:29:00Z')), 'Nov 10, 2026 1:29 PM EST');
  assert.equal(easternStamp(new Date('2026-07-04T16:00:00Z')), 'Jul 4, 2026 12:00 PM EDT');
});

test('feed items become ITEM lines the digest parser reads', () => {
  const since = new Date('2026-11-01T00:00:00Z');
  const lines = feedItems({ name: 'The Rhino Times', mustMatch: 'Greensboro|Guilford' }, parseFeed(RSS), { since });
  assert.equal(lines.length, 1); // Winston-Salem filtered by mustMatch, old story by date
  const { items, problems } = parseDigest(lines.join('\n'), 'feeds');
  assert.equal(problems.length, 0);
  const [it] = items;
  assert.equal(it.title, 'Council OKs Elm St. plan phase 2'); // a pipe in a title can't break the line
  assert.equal(it.category, 'news');
  assert.equal(it.verified, true);
  assert.equal(it.accountType, 'news');
  assert.equal(it.venue, null);
});

test('Bluesky: own posts only, recent, trimmed, linked to bsky.app', () => {
  const feed = {
    feed: [
      { post: { uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', author: { handle: 'gsoparks.bsky.social' }, record: { text: 'Free skate night at the Greensboro Ice House Friday!', createdAt: '2026-11-11T20:00:00Z' } } },
      { post: { uri: 'at://did:plc:zzz/app.bsky.feed.post/1', author: { handle: 'someone.else' }, record: { text: 'reposted', createdAt: '2026-11-11T20:00:00Z' } }, reason: { $type: 'app.bsky.feed.defs#reasonRepost' } },
      { post: { uri: 'at://did:plc:abc/app.bsky.feed.post/old', author: { handle: 'gsoparks.bsky.social' }, record: { text: 'old', createdAt: '2026-01-01T00:00:00Z' } } },
      { post: { uri: 'at://did:plc:abc/app.bsky.feed.post/long', author: { handle: 'gsoparks.bsky.social' }, record: { text: 'x'.repeat(300), createdAt: '2026-11-11T21:00:00Z' } } },
    ],
  };
  const lines = blueskyItems({ handle: 'gsoparks.bsky.social', name: 'Greensboro Parks' }, feed, { since: new Date('2026-11-01') });
  assert.equal(lines.length, 2);
  const { items } = parseDigest(lines.join('\n'));
  assert.equal(items[0].url, 'https://bsky.app/profile/gsoparks.bsky.social/post/3kxyz');
  assert.equal(items[0].platform, 'Bluesky');
  assert.equal(items[0].account, 'Greensboro Parks');
  assert.equal(items[0].verified, true);
  assert.ok(items[1].title.length <= 140 && items[1].title.endsWith('...'));
});

test('finds URLs already saved so reruns only add new items', () => {
  const line = itemLine({ category: 'news', title: 't', url: 'https://example.com/a', account: 'x', accountType: 'news', posted: 'n/a', verified: true });
  const saved = `Subject: whatever\nhttps://not-an-item.example\n${line}\n`;
  assert.deepEqual([...urlsIn(saved)], ['https://example.com/a']);
});
