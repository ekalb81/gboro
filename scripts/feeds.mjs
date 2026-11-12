// Turn RSS/Atom feeds and Bluesky author feeds into the same `ITEM | ...` lines Muse writes,
// so scripts/ingest.mjs handles every source the same way. No dependencies.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Text of the first <tag>, with CDATA unwrapped, markup stripped and entities decoded.
function tagText(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return null;
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Descriptions are often entity-escaped HTML, so decode, strip tags, then decode what's left.
  const text = decodeEntities(decodeEntities(raw.replace(/<[^>]+>/g, ' ')).replace(/<[^>]+>/g, ' '));
  return text.replace(/\s+/g, ' ').trim() || null;
}

function atomLink(xml) {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0];
  const href = pick?.match(/href=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]) : null;
}

/** Parse an RSS 2.0 or Atom document into { title, url, published (Date|null), summary }. */
export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const atom = !blocks.length;
  if (atom) blocks.push(...[...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]));
  return blocks
    .map((b) => {
      const url = atom ? atomLink(b) : tagText(b, 'link') || tagText(b, 'guid');
      const when = tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date');
      const d = when ? new Date(when) : null;
      return {
        title: tagText(b, 'title'),
        url: url && /^https?:\/\//.test(url) ? url.trim() : null,
        published: d && !Number.isNaN(d.getTime()) ? d : null,
        summary: tagText(b, 'description') || tagText(b, 'summary') || tagText(b, 'content'),
      };
    })
    .filter((x) => x.title && x.url);
}

/** "Nov 10, 2026 1:29 PM EST", the posted-time style parseWhen() reads, in Greensboro time. */
export function easternStamp(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return `${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`;
}

const clean = (v) => {
  const s = (v ?? '').toString().replace(/[|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s || 'n/a';
};

/** One ITEM line in Muse's 12-field layout. */
export function itemLine({ category, title, venue, address, start, end, url, account, accountType, posted, verified }) {
  return [
    'ITEM', category, title, venue, address, start, end, url, account, accountType,
    posted instanceof Date ? easternStamp(posted) : posted,
    verified ? 'yes' : 'no',
  ].map((v, i) => (i === 0 ? v : clean(v))).join(' | ');
}

export function matches(text, pattern) {
  return !pattern || new RegExp(pattern, 'i').test(text || '');
}

/** Feed entries -> ITEM lines for one RSS source from data/sources.json. */
export function feedItems(source, entries, { since } = {}) {
  return entries
    .filter((e) => !since || !e.published || e.published >= since)
    .filter((e) => matches(`${e.title} ${e.summary || ''}`, source.mustMatch))
    .map((e) =>
      itemLine({
        category: source.category || 'news',
        title: e.title,
        url: e.url,
        account: source.name,
        accountType: source.accountType || 'news',
        posted: e.published || 'n/a',
        verified: source.verified ?? true,
      }),
    );
}

/** URL of a Bluesky post from its at:// URI and the author's handle. */
export function bskyPostUrl(uri, handle) {
  const rkey = uri.split('/').pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

/** app.bsky.feed.getAuthorFeed response -> ITEM lines for one account from data/sources.json. */
export function blueskyItems(source, feed, { since } = {}) {
  const out = [];
  for (const { post, reason } of feed.feed || []) {
    if (!post || reason) continue; // skip reposts: only the account's own posts
    if (post.author?.handle?.toLowerCase() !== source.handle.toLowerCase()) continue;
    const text = post.record?.text || '';
    const created = new Date(post.record?.createdAt || post.indexedAt);
    if (since && created < since) continue;
    if (!matches(text, source.mustMatch)) continue;
    const title = text.length > 140 ? `${text.slice(0, 137).trimEnd()}...` : text;
    if (!title) continue;
    out.push(
      itemLine({
        category: source.category || 'community',
        title,
        url: bskyPostUrl(post.uri, post.author.handle),
        account: source.name || post.author.displayName || post.author.handle,
        accountType: source.accountType || 'organization',
        posted: Number.isNaN(created.getTime()) ? 'n/a' : created,
        verified: source.verified ?? ['news', 'organization'].includes(source.accountType || 'organization'),
      }),
    );
  }
  return out;
}

/** Every post/article URL already present in saved raw files, so reruns add only new items. */
export function urlsIn(text) {
  const urls = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!/^ITEM\s*\|/.test(line.trim())) continue;
    const url = line.split('|')[7]?.trim();
    if (url) urls.add(url);
  }
  return urls;
}
