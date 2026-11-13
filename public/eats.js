// Restaurants and bars layer: little shops on the village map from data/eats.json (scripts/fetch-eats.mjs).
// Open places light up after dark, open bars get a neon sign and a few people out front,
// and a bar with an event today (from the Muse digest items) gets a pennant and a crowd.
// village.js calls: loadEats, placeShops (while building the map), drawShops, drawEatsOverlay, setEventItems.

const T = 8;
const TZ = 'America/New_York';
const BARS = new Set(['bar', 'nightclub', 'brewery']);
const LABEL = { bar: 'Bar', nightclub: 'Nightclub', brewery: 'Brewery', cafe: 'Cafe', restaurant: 'Restaurant', takeout: 'Takeout' };

// When OSM has no readable hours, guess typical ones so the town still feels right. Shown as a guess.
const typical = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) =>
  Array.from({ length: 7 }, (_, d) => (days.includes(d) ? [[open * 60, close * 60]] : []));
const GUESS = {
  restaurant: typical(11, 21), takeout: typical(10, 21), cafe: typical(7, 17),
  bar: typical(16, 25), brewery: typical(14, 22), nightclub: typical(21, 26, [3, 4, 5]),
};

const STYLE = {
  restaurant: { wall: '#e8d8b8', roof: '#7a3f2e', a: '#c8553d', b: '#f3ead2' },
  takeout:    { wall: '#e8dcc0', roof: '#6a5a2a', a: '#e0a020', b: '#f3ead2' },
  cafe:       { wall: '#eadfca', roof: '#5a4030', a: '#8a5a3a', b: '#f3ead2' },
  bar:        { wall: '#8a5040', roof: '#3a2a2a', a: '#2f5a3a', b: '#24402c', neon: '#ff5fa2' },
  brewery:    { wall: '#9a6a42', roof: '#4a3020', a: '#c88a2a', b: '#8a5a1a', neon: '#ffc24a' },
  nightclub:  { wall: '#4a3a5a', roof: '#2a2238', a: '#6a4a9a', b: '#3a2a5a', neon: '#7ad0ff' },
};

let data = null, shops = [], hovered = null, picked = null, events = new Map();
let statusCache = { at: 0 };
const canvas = document.getElementById('village');

const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export async function loadEats() {
  try {
    const r = await fetch('data/eats.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch {
    data = null; // no eats.json yet: the village just has no shops
  }
  renderPanel();
}

/** Called while the map is built, after roads and landmarks and before houses, so houses leave room for shops. */
export function placeShops({ W, H, free, block }) {
  shops = [];
  if (!data) return;
  // Central places claim their tile first; the rest spiral outward to the nearest free tile.
  const order = [...data.places].sort((a, b) => (BARS.has(b.kind) - BARS.has(a.kind)) || a.name.localeCompare(b.name));
  for (const p of order) {
    const spot = nearestFree(p.x, p.y, W, H, free);
    if (!spot) continue;
    block(spot[0], spot[1], 1, 1);
    shops.push({ ...p, tx: spot[0], ty: spot[1], seed: hash(p.id), guessed: !p.hours, week: p.hours || GUESS[p.kind] || GUESS.restaurant });
  }
  shops.sort((a, b) => a.ty - b.ty);
  renderPanel();
}

function nearestFree(x, y, W, H, free) {
  for (let r = 0; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = x + dx, ty = y + dy;
      if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 2) continue;
      if (free(tx, ty, 1, 1, 0) && free(tx, ty + 1, 1, 1, 0)) return [tx, ty]; // room for the doorstep
    }
  }
  return null;
}

// ---------- time ----------
function etNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return { day, min: (+parts.hour % 24) * 60 + +parts.minute };
}
function isOpen(week, { day, min }) {
  if (week[day].some(([a, b]) => min >= a && min < b)) return true;
  return week[(day + 6) % 7].some(([, b]) => b > 1440 && min + 1440 < b);
}
const fmtMin = (m) => {
  m %= 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
function openLine(s, now = etNow()) {
  if (isOpen(s.week, now)) {
    const today = s.week[now.day].find(([a, b]) => now.min >= a && now.min < b);
    const end = today ? today[1] : s.week[(now.day + 6) % 7].find(([, b]) => b > 1440)[1];
    return today && today[0] === 0 && today[1] === 1440 ? 'Open 24 hours today' : `Open now, until ${fmtMin(end)}`;
  }
  for (let i = 0; i < 7; i++) {
    const d = (now.day + i) % 7;
    const next = s.week[d].find(([a]) => i > 0 || a > now.min);
    if (next) return `Closed, opens ${i === 0 ? '' : i === 1 ? 'tomorrow ' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d] + ' '}${fmtMin(next[0])}`;
  }
  return 'Closed';
}

/** Open/closed for every shop, recomputed at most every 30 seconds. */
function status() {
  if (Date.now() - statusCache.at < 30e3) return statusCache;
  const now = etNow();
  const open = new Set(shops.filter((s) => isOpen(s.week, now)).map((s) => s.id));
  statusCache = { at: Date.now(), now, open };
  renderPanel();
  return statusCache;
}

// ---------- events from the digest ----------
const norm = (s) => (s || '').toLowerCase().replace(/&/g, 'and').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const etDate = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });

/** Digest items whose venue is one of our places and that happen today and aren't over. */
export function setEventItems(items) {
  events = new Map();
  if (!data) return;
  const today = etDate(new Date());
  const byName = new Map(data.places.map((p) => [norm(p.name), p.id]));
  for (const it of items || []) {
    if (!it.start) continue;
    const day = it.allDay ? it.start : etDate(new Date(it.start));
    const over = it.end ? new Date(it.end) < new Date() : !it.allDay && new Date(it.start).getTime() + 3 * 3600e3 < Date.now();
    if (day !== today || over) continue;
    const v = norm(it.venue);
    let id = byName.get(v);
    if (!id && v.length >= 5) for (const [n, pid] of byName) if (n.length >= 5 && (v.includes(n) || n.includes(v))) { id = pid; break; }
    if (id) events.set(id, it);
  }
  renderPanel();
}

// ---------- drawing ----------
function drawShop(ctx, s, open) {
  const x = s.tx * T, y = s.ty * T, st = STYLE[s.kind] || STYLE.restaurant;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 1, y + 1, T, T);
  ctx.fillStyle = st.wall; ctx.fillRect(x, y + 2, T, T - 2);
  ctx.fillStyle = st.roof; ctx.fillRect(x - 1, y - 1, T + 2, 3);
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x - 1, y - 1, T + 2, 1);
  for (let i = 0; i < T; i += 2) { ctx.fillStyle = (i / 2) % 2 ? st.b : st.a; ctx.fillRect(x + i, y + 2, 2, 2); } // awning
  ctx.fillStyle = open ? '#3a2618' : '#2a2420'; ctx.fillRect(x + 3, y + 5, 2, 3); // door
  ctx.fillStyle = '#3a4450'; ctx.fillRect(x + 1, y + 5, 1, 2); ctx.fillRect(x + 6, y + 5, 1, 2); // windows
  if (s.kind === 'brewery') { ctx.fillStyle = '#6a4020'; ctx.fillRect(x + 6, y + 7, 2, 2); }
  if (open && s.kind !== 'nightclub') { ctx.fillStyle = '#7ac85a'; ctx.fillRect(x + 5, y + 4, 1, 1); } // little OPEN light
  if (events.has(s.id)) { // pennant on the roof
    ctx.fillStyle = '#5a3d22'; ctx.fillRect(x + 6, y - 6, 1, 6);
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(x + 7, y - 6, 3, 1); ctx.fillRect(x + 7, y - 5, 2, 1); ctx.fillRect(x + 7, y - 4, 1, 1);
  }
}

const SKIN = ['#f1c9a5', '#d9a77c', '#a8754e', '#7a4f32', '#5a3a24'];
const SHIRT = ['#c8553d', '#3d8ac8', '#e0a020', '#4a9a5a', '#7a5ad0', '#e8e0d0', '#2b2b2b', '#d06a9a'];
function drawLoiterers(ctx, s, n, t) {
  for (let i = 0; i < n; i++) {
    const h = hash(s.id + i);
    const px = s.tx * T - 5 + (h % 14), py = s.ty * T + 8 + ((h >> 4) % 4) - (Math.floor(t / 350 + (h % 7)) % 2);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(px, py + 7, 4, 1);
    ctx.fillStyle = '#2b2018'; ctx.fillRect(px, py, 4, 1);
    ctx.fillStyle = SKIN[h % SKIN.length]; ctx.fillRect(px, py + 1, 4, 2);
    ctx.fillStyle = SHIRT[(h >> 8) % SHIRT.length]; ctx.fillRect(px, py + 3, 4, 3);
    ctx.fillStyle = '#2a3550'; ctx.fillRect(px, py + 6, 1, 1); ctx.fillRect(px + 3, py + 6, 1, 1);
  }
}

/** Shops and the people outside them. Drawn before the night tint so they darken with the town. */
export function drawShops(ctx, t) {
  if (!shops.length) return;
  const { open, now } = status();
  const evening = now.min >= 17 * 60 || now.min < 3 * 60;
  for (const s of shops) drawShop(ctx, s, open.has(s.id));
  for (const s of shops) {
    const ev = events.has(s.id);
    if (!open.has(s.id) && !ev) continue;
    const n = ev ? 6 : BARS.has(s.kind) && evening ? 1 + (s.seed % 3) : 0;
    if (n) drawLoiterers(ctx, s, n, t);
  }
}

/** Lit windows and neon after dark, plus the hover label. Drawn after the night tint. */
export function drawEatsOverlay(ctx, t, darkness = 0) {
  if (!shops.length) return;
  const { open } = status();
  for (const s of shops) {
    if (!open.has(s.id)) continue;
    const x = s.tx * T, y = s.ty * T, st = STYLE[s.kind];
    if (darkness) {
      ctx.fillStyle = 'rgba(255,214,110,.9)';
      ctx.fillRect(x + 1, y + 5, 1, 2); ctx.fillRect(x + 6, y + 5, 1, 2);
      ctx.fillStyle = 'rgba(255,200,90,.35)'; ctx.fillRect(x + 1, y + 8, 6, 1); // light spilling out the door
    }
    if (st?.neon && (darkness || BARS.has(s.kind))) {
      const flicker = (Math.floor(t / 90) + s.seed) % 47 === 0;
      if (!flicker) { ctx.fillStyle = st.neon; ctx.fillRect(x + 1, y + 2, 6, 1); }
      if (darkness && !flicker) { ctx.fillStyle = st.neon + '40'; ctx.fillRect(x - 1, y + 1, 10, 3); }
    }
  }
  const s = hovered || picked;
  if (s) drawTip(ctx, s, open.has(s.id));
}

function drawTip(ctx, s, isOpenNow) {
  const ev = events.get(s.id);
  const lines = [s.name, ev ? `Today: ${ev.title}` : isOpenNow ? 'Open now' : 'Closed now'];
  ctx.font = '7px monospace';
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l.length > 34 ? l.slice(0, 33) + '…' : l).width))) + 8;
  let x = s.tx * T + 4 - (w >> 1), y = s.ty * T - 26;
  x = Math.max(1, Math.min(canvas.width - w - 1, x)); y = Math.max(1, y);
  ctx.fillStyle = '#2b2418'; ctx.fillRect(x - 1, y - 1, w + 2, 22);
  ctx.fillStyle = '#fffbea'; ctx.fillRect(x, y, w, 20);
  ctx.fillStyle = '#2b2418'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => { ctx.fillStyle = i ? (ev ? '#a0600a' : isOpenNow ? '#2f7a3a' : '#7a6a4f') : '#2b2418'; ctx.fillText(l.length > 34 ? l.slice(0, 33) + '…' : l, x + 4, y + 2 + i * 9); });
}

// ---------- interaction ----------
function shopAt(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (canvas.width / r.width), y = (e.clientY - r.top) * (canvas.height / r.height);
  return shops.find((s) => x >= s.tx * T - 1 && x <= s.tx * T + T + 1 && y >= s.ty * T - 2 && y <= s.ty * T + T + 1) || null;
}
canvas.addEventListener('mousemove', (e) => { hovered = shopAt(e); if (hovered) canvas.style.cursor = 'pointer'; });
canvas.addEventListener('mouseleave', () => { hovered = null; });
canvas.addEventListener('click', (e) => { picked = shopAt(e); renderPanel(); });

// ---------- side panel ----------
function el(tag, props = {}, ...kids) { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null)); return n; }

function renderPanel() {
  const box = document.getElementById('eats');
  if (!box) return;
  box.innerHTML = '';
  if (!data) { box.append(el('div', { className: 'sub', textContent: 'No places yet. Run `npm run eats`.' })); return; }
  if (!shops.length) return;
  const { open, now } = statusCache.open ? statusCache : { open: new Set(), now: etNow() };
  const bars = shops.filter((s) => BARS.has(s.kind) && open.has(s.id)).length;
  box.append(el('div', { className: 'sub', textContent: `${open.size} of ${shops.length} local places open now, ${bars} of them bars. Hover or click a shop.` }));

  if (picked) {
    const ev = events.get(picked.id);
    const card = el('div', { className: 'eat' },
      el('div', { className: 't', textContent: picked.name }),
      el('div', { className: 'm', textContent: [LABEL[picked.kind], picked.cuisine, picked.address].filter(Boolean).join(' · ') }),
      el('div', { className: 'm', textContent: picked.guessed ? `${openLine(picked, now)} (hours not listed, so this is a guess)` : openLine(picked, now) }),
      picked.hoursText ? el('div', { className: 'm', textContent: picked.hoursText }) : null,
      ev ? el('div', { className: 'm', textContent: `Today: ${ev.title}` }) : null,
      el('div', { className: 'm' },
        picked.website ? el('a', { href: picked.website, target: '_blank', rel: 'noopener noreferrer', textContent: 'Website ↗' }) : null,
        picked.website ? ' ' : null,
        el('a', { href: picked.osm, target: '_blank', rel: 'noopener noreferrer', textContent: 'Map ↗' })));
    box.append(card);
  }

  const tonight = shops.filter((s) => events.has(s.id));
  if (tonight.length) {
    const ul = el('ul');
    for (const s of tonight) {
      const li = el('li', {}, el('div', { className: 't', textContent: s.name }), el('div', { className: 'm', textContent: events.get(s.id).title }));
      li.onclick = () => { picked = s; renderPanel(); };
      ul.append(li);
    }
    box.append(el('div', { className: 'sub', textContent: 'Events at bars and restaurants today:' }), ul);
  }
}
