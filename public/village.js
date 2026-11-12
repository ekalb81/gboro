// GSO Village renderer: a procedural pixel map of Greensboro with live items pinned to districts.
// Plain canvas, no build step. Data: data/map.json (layout) and data/items.json (from scripts/ingest.mjs).

import { initRoads, drawRoads, isClosed } from './roads.js';

const T = 8; // tile size in canvas pixels
const TZ = 'America/New_York';
const CAT_COLORS = { event: '#e0a020', news: '#c8553d', business: '#3d8ac8', government: '#7a5ad0', community: '#4a9a5a' };
const catColor = (c) => CAT_COLORS[c] || '#4a9a5a';

const canvas = document.getElementById('village');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// Seeded RNG so the town looks the same on every visit.
let seed = 1789; // Greensboro's founding-ish year, why not
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

let map, items = [], byDistrict = new Map(), selected = null, windows = [];
let roadMask, W, H;
const bg = document.createElement('canvas');

// ---------- data ----------
async function loadJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function refreshItems() {
  try {
    const data = await loadJSON('data/items.json');
    items = data.items;
    byDistrict = new Map();
    for (const it of items) {
      if (!byDistrict.has(it.district)) byDistrict.set(it.district, []);
      byDistrict.get(it.district).push(it);
    }
    const when = new Date(data.generatedAt).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
    document.getElementById('status').textContent =
      `${items.length} things happening, from ${data.digests} digest${data.digests === 1 ? '' : 's'}. Updated ${when}.`;
    renderList();
    spawnCrowds();
  } catch (e) {
    document.getElementById('status').textContent = 'No data yet. Run `npm run ingest`.';
    console.error(e);
  }
}

// ---------- time helpers ----------
const etDate = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
function fmtWhen(it) {
  if (!it.start) return null;
  if (it.allDay) return new Date(it.start + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  return new Date(it.start).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}
const dayOf = (it) => (it.start ? (it.allDay ? it.start : etDate(new Date(it.start))) : null);
const isToday = (it) => dayOf(it) === etDate(new Date());
function isOver(it) {
  const now = Date.now();
  if (it.end) return new Date(it.end).getTime() < now;
  if (!it.start) return false;
  if (it.allDay) return it.start < etDate(new Date());
  return new Date(it.start).getTime() + 3 * 3600e3 < now;
}
function etHour() {
  return +new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }) % 24;
}

// ---------- map building ----------
function stampRoad(x, y) {
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
    const tx = x + dx, ty = y + dy;
    if (tx >= 0 && ty >= 0 && tx < W && ty < H) roadMask[ty * W + tx] = 1;
  }
}
function line([x0, y0], [x1, y1], fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function buildBackground() {
  W = map.width; H = map.height;
  bg.width = W * T; bg.height = H * T;
  const g = bg.getContext('2d');
  roadMask = new Uint8Array(W * H);
  const blocked = new Uint8Array(W * H);
  const block = (x, y, w, h, pad = 0) => {
    for (let j = y - pad; j < y + h + pad; j++) for (let i = x - pad; i < x + w + pad; i++)
      if (i >= 0 && j >= 0 && i < W && j < H) blocked[j * W + i] = 1;
  };
  const free = (x, y, w, h, pad = 1) => {
    for (let j = y - pad; j < y + h + pad; j++) for (let i = x - pad; i < x + w + pad; i++)
      if (i < 0 || j < 0 || i >= W || j >= H || blocked[j * W + i]) return false;
    return true;
  };

  // Grass.
  const grass = ['#5d8a3f', '#588540', '#62904a', '#5a873c'];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    g.fillStyle = pick(grass);
    g.fillRect(x * T, y * T, T, T);
    if (rnd() < 0.05) { g.fillStyle = pick(['#e8d36a', '#f2f2f2', '#d97a9a']); g.fillRect(x * T + 2 + (rnd() * 4 | 0), y * T + 2 + (rnd() * 4 | 0), 1, 1); }
  }

  // Railroad.
  const ry = map.railroad.y;
  g.fillStyle = '#7d6a55'; g.fillRect(0, ry * T, W * T, 2 * T);
  g.fillStyle = '#4e3b2a'; for (let x = 0; x < W * T; x += 4) g.fillRect(x, ry * T + 2, 2, 12);
  g.fillStyle = '#b8bcc2'; g.fillRect(0, ry * T + 4, W * T, 1); g.fillRect(0, ry * T + 11, W * T, 1);
  block(0, ry, W, 2);

  // Roads.
  for (const r of map.roads) for (let i = 1; i < r.points.length; i++) line(r.points[i - 1], r.points[i], stampRoad);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (roadMask[y * W + x]) {
    g.fillStyle = (x + y) % 3 ? '#6a6762' : '#66635e';
    g.fillRect(x * T, y * T, T, T);
    blocked[y * W + x] = 1;
  }
  g.fillStyle = '#e8c547'; // center dashes on main roads
  for (const r of map.roads) if (r.kind === 'main') for (let i = 1; i < r.points.length; i++) {
    let n = 0;
    line(r.points[i - 1], r.points[i], (x, y) => { if (n++ % 2 === 0) g.fillRect(x * T + T - 2 + (r.points[0][0] === r.points[1][0] ? 1 : 0), y * T + T - 1, r.points[0][0] === r.points[1][0] ? 1 : 4, r.points[0][0] === r.points[1][0] ? 4 : 1); });
  }

  // Landmarks.
  windows = [];
  for (const d of map.districts) { block(d.x, d.y, d.w, d.h, 1); drawLandmark(g, d); }

  // Houses near roads, denser near districts.
  const near = (x, y, r) => { for (let j = y - r; j <= y + r; j++) for (let i = x - r; i <= x + r; i++) if (i >= 0 && j >= 0 && i < W && j < H && roadMask[j * W + i]) return true; return false; };
  const walls = ['#e6d3b0', '#d9c29a', '#c9b8a0', '#e8e0d0', '#cfae8f'];
  const roofs = ['#a0463a', '#7a4b3a', '#4a5d7a', '#5a6b3a', '#8a5a2a', '#6a4a6a'];
  for (let n = 0; n < 4000; n++) {
    const w = rnd() < 0.5 ? 2 : 3, h = 2;
    const x = rnd() * (W - w) | 0, y = rnd() * (H - h) | 0;
    if (!near(x, y, 3) || !free(x, y, w, h)) continue;
    block(x, y, w, h);
    drawHouse(g, x * T, y * T, w * T, h * T, pick(walls), pick(roofs));
  }

  // Trees on what's left.
  for (let n = 0; n < 900; n++) {
    const x = rnd() * W | 0, y = rnd() * H | 0;
    if (!free(x, y, 1, 1, 0)) continue;
    block(x, y, 1, 1);
    drawTree(g, x * T, y * T);
  }

  // District labels.
  g.font = 'bold 8px monospace';
  g.textBaseline = 'top';
  for (const d of map.districts) {
    const tw = Math.ceil(g.measureText(d.name).width) + 4;
    const lx = Math.round(d.x * T + (d.w * T - tw) / 2), ly = d.y * T + d.h * T + 2;
    g.fillStyle = 'rgba(30,24,16,.75)'; g.fillRect(lx, ly, tw, 10);
    g.fillStyle = '#fff3d0'; g.fillText(d.name, lx + 2, ly + 1);
  }
}

function drawHouse(g, x, y, w, h, wall, roof) {
  g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x + 2, y + 2, w, h);
  g.fillStyle = wall; g.fillRect(x, y + 6, w, h - 6);
  g.fillStyle = roof; g.fillRect(x - 1, y, w + 2, 7);
  g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x - 1, y, w + 2, 1);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 1, y + 6, w + 2, 1);
  g.fillStyle = '#4a3020'; g.fillRect(x + (w >> 1) - 1, y + h - 4, 3, 4);
  g.fillStyle = '#9cc4d8'; g.fillRect(x + 2, y + 9, 2, 2); if (w > 16) g.fillRect(x + w - 4, y + 9, 2, 2);
  windows.push([x + 2, y + 9]);
}

function drawTree(g, x, y) {
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x + 2, y + 6, 6, 2);
  g.fillStyle = '#5a3d22'; g.fillRect(x + 3, y + 5, 2, 3);
  g.fillStyle = pick(['#2f5e2a', '#356b2e', '#2a5426']);
  g.fillRect(x + 1, y + 1, 6, 5); g.fillRect(x + 2, y, 4, 7);
  g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x + 2, y + 1, 2, 2);
}

function drawLandmark(g, d) {
  const x = d.x * T, y = d.y * T, w = d.w * T, h = d.h * T;
  if (d.id === 'board') { // bulletin board in a little park
    g.fillStyle = '#4f8a3a'; g.fillRect(x - 4, y - 4, w + 8, h + 8);
    g.fillStyle = '#5a3d22'; g.fillRect(x + 2, y + 10, 2, 12); g.fillRect(x + w - 4, y + 10, 2, 12);
    g.fillStyle = d.roof; g.fillRect(x, y + 2, w, 12);
    g.fillStyle = '#c9a46a'; g.fillRect(x + 1, y + 3, w - 2, 10);
    g.fillStyle = '#f5f0e0'; g.fillRect(x + 3, y + 5, 4, 5); g.fillRect(x + 10, y + 4, 5, 4); g.fillRect(x + 16, y + 7, 4, 5);
    return;
  }
  if (d.id === 'away') { // signpost pointing out of town
    g.fillStyle = '#5a3d22'; g.fillRect(x + 10, y + 6, 2, 18);
    g.fillStyle = '#d8c08a'; g.fillRect(x + 2, y + 6, 18, 6); g.fillRect(x + 20, y + 7, 2, 4); g.fillRect(x + 22, y + 8, 1, 2);
    g.fillStyle = '#5a3d22'; g.fillRect(x + 4, y + 8, 12, 1); g.fillRect(x + 4, y + 10, 8, 1);
    return;
  }
  const roofH = Math.max(10, Math.round(h * 0.4));
  g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + 3, y + 3, w, h);
  g.fillStyle = d.wall; g.fillRect(x, y + roofH, w, h - roofH);
  g.fillStyle = d.roof; g.fillRect(x - 1, y, w + 2, roofH);
  g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(x - 1, y, w + 2, 2);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - 1, y + roofH - 1, w + 2, 1);
  if (d.id === 'downtown') { g.fillStyle = '#d8d0b8'; g.fillRect(x + (w >> 1) - 3, y - 8, 6, 9); g.fillStyle = '#e8c547'; g.fillRect(x + (w >> 1) - 1, y - 6, 2, 2); } // clock tower
  if (d.id === 'coliseum') { g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 4; i < w - 4; i += 6) g.fillRect(x + i, y + 3, 3, roofH - 6); }
  for (let wy = y + roofH + 3; wy < y + h - 6; wy += 6) for (let wx = x + 3; wx < x + w - 4; wx += 5) {
    g.fillStyle = '#9cc4d8'; g.fillRect(wx, wy, 3, 3);
    windows.push([wx, wy, 3]);
  }
  g.fillStyle = '#3a2618'; g.fillRect(x + (w >> 1) - 2, y + h - 6, 5, 6);
}

// ---------- villagers ----------
const SKIN = ['#f1c9a5', '#d9a77c', '#a8754e', '#7a4f32', '#5a3a24'];
const SHIRT = ['#c8553d', '#3d8ac8', '#e0a020', '#4a9a5a', '#7a5ad0', '#e8e0d0', '#2b2b2b', '#d06a9a'];
let folks = [];
const isRoad = (x, y) => x >= 0 && y >= 0 && x < W && y < H && roadMask[y * W + x] === 1;

function newWalker() {
  let x, y;
  do { x = rnd() * W | 0; y = rnd() * H | 0; } while (!isRoad(x, y));
  return { kind: 'walk', tx: x, ty: y, px: x * T + 2, py: y * T, dir: [0, 0], speed: 0.25 + rnd() * 0.35, skin: pick(SKIN), shirt: pick(SHIRT), step: rnd() * 10, say: null };
}
function stepWalker(f) {
  const gx = f.tx * T + 2, gy = f.ty * T;
  if (Math.abs(f.px - gx) < 0.5 && Math.abs(f.py - gy) < 0.5) {
    f.px = gx; f.py = gy;
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isRoad(f.tx + dx, f.ty + dy) && !isClosed(f.tx + dx, f.ty + dy));
    const ahead = opts.filter(([dx, dy]) => !(dx === -f.dir[0] && dy === -f.dir[1]));
    const keep = ahead.find(([dx, dy]) => dx === f.dir[0] && dy === f.dir[1]);
    f.dir = keep && rnd() < 0.85 ? keep : pick(ahead.length ? ahead : opts) || [0, 0];
    f.tx += f.dir[0]; f.ty += f.dir[1];
  }
  const gx2 = f.tx * T + 2, gy2 = f.ty * T;
  f.px += Math.sign(gx2 - f.px) * Math.min(f.speed, Math.abs(gx2 - f.px));
  f.py += Math.sign(gy2 - f.py) * Math.min(f.speed, Math.abs(gy2 - f.py));
  f.step += f.speed;
}

// Crowds gather outside places with something on today.
function spawnCrowds() {
  folks = folks.filter((f) => f.kind === 'walk');
  for (const d of map.districts) {
    const n = (byDistrict.get(d.id) || []).filter((it) => isToday(it) && !isOver(it)).length;
    for (let i = 0; i < Math.min(8, n * 3); i++) {
      const side = rnd() < 0.5;
      folks.push({ kind: 'crowd', px: side ? d.x * T - 6 - rnd() * 8 : (d.x + d.w) * T + 2 + rnd() * 8, py: (d.y + d.h) * T - 9 + rnd() * 6, skin: pick(SKIN), shirt: pick(SHIRT), step: rnd() * 10, say: null });
    }
  }
}

function drawPerson(f, t) {
  const x = Math.round(f.px), y = Math.round(f.py) + (f.kind === 'crowd' ? -(Math.floor(t / 300 + f.step) % 2) : 0);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y + 7, 4, 1);
  ctx.fillStyle = '#2b2018'; ctx.fillRect(x, y, 4, 1);           // hair
  ctx.fillStyle = f.skin; ctx.fillRect(x, y + 1, 4, 2);           // face
  ctx.fillStyle = f.shirt; ctx.fillRect(x, y + 3, 4, 3);          // shirt
  ctx.fillStyle = '#2a3550';                                      // legs, alternating while walking
  const a = Math.floor(f.step / 3) % 2;
  ctx.fillRect(x + (a ? 0 : 1), y + 6, 1, 1); ctx.fillRect(x + (a ? 2 : 3), y + 6, 1, 1);
}

// ---------- chatter ----------
let chatIdx = 0;
function chatter() {
  const live = items.filter((it) => !isOver(it));
  if (!live.length || !folks.length) return;
  const it = live[chatIdx++ % live.length];
  const d = map.districts.find((x) => x.id === it.district);
  const cx = (d.x + d.w / 2) * T, cy = (d.y + d.h) * T;
  const f = folks.reduce((best, f) => (Math.hypot(f.px - cx, f.py - cy) < Math.hypot(best.px - cx, best.py - cy) ? f : best));
  const text = it.title.length > 30 ? it.title.slice(0, 29) + '…' : it.title;
  f.say = { text, until: performance.now() + 4500 };
  document.getElementById('chatter').innerHTML = '';
  const s = document.createElement('span');
  s.append('Overheard near ', Object.assign(document.createElement('b'), { textContent: d.name }), `: "${it.title}"`);
  document.getElementById('chatter').append(s);
}

function drawBubble(f) {
  ctx.font = '7px monospace';
  const w = Math.ceil(ctx.measureText(f.say.text).width) + 6;
  let x = Math.round(f.px + 2 - w / 2), y = Math.round(f.py) - 14;
  x = Math.max(1, Math.min(canvas.width - w - 1, x)); y = Math.max(1, y);
  ctx.fillStyle = '#2b2418'; ctx.fillRect(x - 1, y - 1, w + 2, 12);
  ctx.fillStyle = '#fffbea'; ctx.fillRect(x, y, w, 10);
  ctx.fillRect(Math.round(f.px + 1), y + 10, 2, 2);
  ctx.fillStyle = '#2b2418'; ctx.textBaseline = 'top'; ctx.fillText(f.say.text, x + 3, y + 2);
}

// ---------- markers, sky, frame ----------
function markerRect(d) {
  return { x: d.x * T + (d.w * T >> 1) - 5, y: d.y * T - (d.id === 'downtown' ? 22 : 14), w: 11, h: 11 };
}
function drawMarkers(t) {
  for (const d of map.districts) {
    const list = (byDistrict.get(d.id) || []).filter((it) => !isOver(it));
    if (!list.length) continue;
    const r = markerRect(d), bob = Math.round(Math.sin(t / 400 + d.x) * 1.5);
    const color = catColor(list[0].category);
    ctx.fillStyle = '#2b2418'; ctx.fillRect(r.x - 1, r.y - 1 + bob, r.w + 2, r.h + 2);
    ctx.fillStyle = color; ctx.fillRect(r.x, r.y + bob, r.w, r.h);
    ctx.fillRect(r.x + 4, r.y + r.h + bob, 3, 2);
    ctx.fillStyle = '#fffbea'; ctx.font = 'bold 8px monospace'; ctx.textBaseline = 'top';
    const label = list.length > 1 ? String(list.length) : '!';
    ctx.fillText(label, r.x + (r.w - ctx.measureText(label).width) / 2, r.y + 2 + bob);
  }
  if (selected) {
    const d = map.districts.find((x) => x.id === selected);
    if (d && Math.floor(t / 400) % 2) { ctx.strokeStyle = '#ffd77a'; ctx.lineWidth = 1; ctx.strokeRect(d.x * T - 3.5, d.y * T - 3.5, d.w * T + 7, d.h * T + 7); }
  }
}

function skyAlpha(h) {
  if (h >= 20 || h < 6) return 0.5;
  if (h < 7 || h >= 18) return 0.25;
  return 0;
}

function frame(t) {
  ctx.drawImage(bg, 0, 0);
  for (const f of folks) if (f.kind === 'walk') stepWalker(f);
  for (const f of [...folks].sort((a, b) => a.py - b.py)) drawPerson(f, t);
  const a = skyAlpha(etHour());
  if (a) {
    ctx.fillStyle = `rgba(16,24,64,${a})`; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(255,214,110,.85)';
    for (const [x, y, s = 2] of windows) if ((x * 7 + y * 13) % 5) ctx.fillRect(x, y, s, s);
  }
  drawRoads(t, a); // after the night tint, so barrel lamps and crash lights stand out
  drawMarkers(t);
  for (const f of folks) if (f.say && f.say.until > t) drawBubble(f); else if (f.say) f.say = null;
  requestAnimationFrame(frame);
}

function tickClock() {
  const now = new Date().toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const h = etHour();
  const part = h >= 20 || h < 6 ? 'Night' : h < 7 || h >= 18 ? 'Dusk' : 'Daytime';
  document.getElementById('clock').innerHTML = `Greensboro · <b>${now}</b> · ${part}`;
}

// ---------- side list & interaction ----------
function renderList() {
  const ul = document.getElementById('list');
  ul.innerHTML = '';
  const shown = selected ? items.filter((it) => it.district === selected) : items;
  const filter = document.getElementById('filter');
  if (selected) {
    const d = map.districts.find((x) => x.id === selected);
    filter.hidden = false; filter.innerHTML = '';
    const b = Object.assign(document.createElement('button'), { className: 'clear', textContent: 'Show everything' });
    b.onclick = () => select(null);
    filter.append(`${d.landmark}. `, b);
    document.getElementById('listTitle').textContent = d.name;
  } else {
    filter.hidden = true;
    document.getElementById('listTitle').textContent = "What's going on";
  }
  const sorted = [...shown].sort((a, b) => isOver(a) - isOver(b));
  for (const it of sorted) {
    const li = document.createElement('li');
    const d = map.districts.find((x) => x.id === it.district);
    const t = document.createElement('div'); t.className = 't';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = catColor(it.category);
    t.append(dot, it.title);
    const when = fmtWhen(it);
    const m1 = document.createElement('div'); m1.className = 'm';
    m1.textContent = [isOver(it) ? 'Earlier' : isToday(it) ? 'Today' : null, when, it.venue || d?.name].filter(Boolean).join(' · ');
    const m2 = document.createElement('div'); m2.className = 'm';
    m2.textContent = `${it.platform} · ${it.account || 'a local post'} `;
    if (/^https:\/\//.test(it.url)) {
      const a = Object.assign(document.createElement('a'), { href: it.url, target: '_blank', rel: 'noopener noreferrer', textContent: 'View post ↗' });
      a.onclick = (e) => e.stopPropagation();
      m2.append(a);
    }
    li.append(t, m1, m2);
    if (isOver(it)) li.style.opacity = 0.55;
    li.onclick = () => select(it.district);
    ul.append(li);
  }
  if (!sorted.length) ul.innerHTML = '<li class="m">Nothing here right now.</li>';
}

function select(id) { selected = id; renderList(); }

function hit(e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (canvas.width / r.width), y = (e.clientY - r.top) * (canvas.height / r.height);
  return map.districts.find((d) => {
    const m = markerRect(d);
    const inBuilding = x >= d.x * T - 2 && x <= (d.x + d.w) * T + 2 && y >= d.y * T - 2 && y <= (d.y + d.h) * T + 12;
    const inMarker = x >= m.x - 2 && x <= m.x + m.w + 2 && y >= m.y - 3 && y <= m.y + m.h + 4;
    return inBuilding || inMarker;
  });
}
canvas.addEventListener('mousemove', (e) => { canvas.style.cursor = hit(e) ? 'pointer' : 'default'; });
canvas.addEventListener('click', (e) => { const d = hit(e); select(d ? (selected === d.id ? null : d.id) : null); });

// ---------- boot ----------
map = await loadJSON('data/map.json');
buildBackground();
for (let i = 0; i < 40; i++) folks.push(newWalker());
await refreshItems();
initRoads({ T, ctx, canvas, map });
tickClock();
setInterval(tickClock, 15e3);
setInterval(refreshItems, 60e3); // pick up new digests without a reload
setInterval(chatter, 5e3);
chatter();
requestAnimationFrame(frame);
