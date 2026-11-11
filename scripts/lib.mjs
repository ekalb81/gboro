// Parsing, placement and filtering for Muse digest ITEM lines.
// No dependencies, so `node scripts/ingest.mjs` works on a fresh clone.

import { createHash } from 'node:crypto';

export const FIELDS = [
  'category', 'title', 'venue', 'address', 'start', 'end',
  'url', 'account', 'accountType', 'posted', 'verified',
];

const blank = (v) => {
  const s = (v ?? '').trim();
  return s === '' || /^n\/?a$/i.test(s) ? null : s;
};

/** Pull every `ITEM | ...` line out of a digest body. Bad lines are reported, not thrown. */
export function parseDigest(text, digestId = null) {
  const items = [];
  const problems = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^ITEM\s*\|/.test(line)) continue;
    const parts = line.split('|').map((p) => p.trim()).slice(1);
    if (parts.length !== FIELDS.length) {
      problems.push({ line, reason: `expected ${FIELDS.length} fields after ITEM, got ${parts.length}` });
      continue;
    }
    const r = Object.fromEntries(FIELDS.map((f, i) => [f, blank(parts[i])]));
    if (!r.title || !r.url) {
      problems.push({ line, reason: 'missing title or url' });
      continue;
    }
    const start = parseWhen(r.start);
    const end = parseWhen(r.end);
    items.push({
      id: createHash('sha1').update(r.url).digest('hex').slice(0, 10),
      category: (r.category || 'other').toLowerCase(),
      title: r.title,
      venue: r.venue,
      address: r.address,
      start: start?.iso ?? null,
      end: end?.iso ?? null,
      allDay: start?.allDay ?? false,
      url: r.url,
      platform: platformOf(r.url),
      account: r.account,
      accountType: (r.accountType || 'unknown').toLowerCase(),
      posted: parseWhen(r.posted)?.iso ?? null,
      verified: /^y/i.test(r.verified || ''),
      digest: digestId,
    });
  }
  return { items, problems };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Muse writes dates a few ways: "Nov 21, 2026 8:30 PM EST", "Nov 13, 2026",
 * "2026-11-18", "2026-11-11 2:01 PM EST". All are Greensboro (Eastern) time.
 * Returns { iso, allDay } or null.
 */
export function parseWhen(s) {
  s = blank(s);
  if (!s) return null;
  let y, mo, d, h = null, mi = 0, ap = null, tz = null, m;
  const time = String.raw`(?:,?\s+(\d{1,2}):(\d{2})\s*(AM|PM))?(?:\s+(EST|EDT|ET))?\s*$`;
  if ((m = s.match(new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})` + time, 'i')))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
    [h, mi, ap, tz] = [m[4], m[5], m[6], m[7]];
  } else if ((m = s.match(new RegExp(String.raw`^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})` + time, 'i')))) {
    mo = MONTHS[m[1].toLowerCase()];
    [d, y] = [+m[2], +m[3]];
    [h, mi, ap, tz] = [m[4], m[5], m[6], m[7]];
    if (!mo) return null;
  } else {
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  if (h == null) return { iso: `${y}-${pad(mo)}-${pad(d)}`, allDay: true };
  let hour = +h % 12;
  if (/pm/i.test(ap)) hour += 12;
  // EDT if stated; otherwise a rough US DST guess (mid-Mar to early Nov). Good enough for a village clock.
  const edt = tz ? /edt/i.test(tz) : (mo > 3 && mo < 11) || (mo === 3 && d >= 9) || (mo === 11 && d < 2);
  return { iso: `${y}-${pad(mo)}-${pad(d)}T${pad(hour)}:${pad(+mi)}:00${edt ? '-04:00' : '-05:00'}`, allDay: false };
}

export function platformOf(url) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/facebook\.com|fb\.com/.test(host)) return 'Facebook';
  if (/instagram\.com/.test(host)) return 'Instagram';
  if (/threads\.(net|com)/.test(host)) return 'Threads';
  if (/tiktok\.com/.test(host)) return 'TikTok';
  if (/(^|\.)x\.com|twitter\.com/.test(host)) return 'X';
  if (/bsky\.app/.test(host)) return 'Bluesky';
  return host || 'web';
}

// Venues Muse names without an address.
const KNOWN_VENUES = [
  [/pig pounder/i, 'downtown'],
  [/tanger center/i, 'downtown'],
  [/first national bank field|grasshoppers/i, 'downtown'],
];

/** Put an item in one of the village districts from map.json. */
export function locate(item) {
  const addr = (item.address || '').toLowerCase();
  const all = `${item.title} ${item.venue || ''} ${item.address || ''}`.toLowerCase();
  const num = +(addr.match(/^\s*(\d+)/)?.[1] ?? NaN);

  // Somewhere in NC that isn't Greensboro.
  if (addr && /, nc/.test(addr) && !/greensboro/.test(addr)) return 'away';

  if (/benbow|julian st|martin luther king/.test(addr)) return 'southeast';
  if (/gate city|coliseum|\blee st/.test(all)) return 'coliseum';
  if (/battleground|lawndale|cone blvd/.test(addr)) return 'north';
  if (/spring garden/.test(addr)) return num >= 2000 ? 'westside' : 'uncg';
  if (/friendly/.test(addr)) return num >= 2000 ? 'westside' : num >= 500 ? 'college-hill' : 'downtown';
  if (/market st/.test(addr)) {
    if (/\be\.? market|east market/.test(addr)) return num >= 800 ? 'ncat' : 'downtown';
    return num >= 1500 ? 'westside' : 'downtown';
  }
  if (/s\.? elm|south elm|mcgee|lewis st/.test(addr)) return 'south-elm';
  if (/elm st|downtown/.test(addr)) return 'downtown';

  for (const [re, d] of KNOWN_VENUES) if (re.test(all)) return d;
  if (/\buncg\b|spartan/.test(all)) return 'uncg';
  if (/\ba ?(&|and) ?t\b|aggie/.test(all)) return 'ncat';
  return 'board'; // No usable location: pin it to the town bulletin board.
}

/**
 * Public-site rules from the plan. Returns { show, held }.
 * - Unverified news claims are held back.
 * - Personal posts from individuals (community/other) are held back.
 * - Individuals' names are never shown; their items read as "a local post".
 */
export function applyRules(items) {
  const show = [];
  const held = [];
  for (const it of items) {
    const individual = it.accountType === 'individual';
    if (it.category === 'news' && !it.verified) { held.push({ ...it, heldBecause: 'unverified news' }); continue; }
    if (individual && ['community', 'other'].includes(it.category)) { held.push({ ...it, heldBecause: 'personal post' }); continue; }
    show.push({ ...it, account: individual ? null : it.account });
  }
  return { show, held };
}
