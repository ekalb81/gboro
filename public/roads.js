// Road closures, roadwork and crashes in the village, from data/roads.json (scripts/fetch-roads.mjs).
// Each event is a thing in town rather than a label: barrels across a closed street, cones and a
// worker for roadwork, smashed cars with flashing lights for a crash, bunting for a parade or race.
// Walkers turn around at barrels. Hover an event to read it; the side list has the details.
//
// Preview without live data: ?roads=demo

const TZ = 'America/New_York';
let T, ctx, canvas, map;
let events = [];
const closed = new Set(); // "x,y" tiles walkers will not enter

const key = (x, y) => `${x},${y}`;
export const isClosed = (x, y) => closed.has(key(x, y));

const DEMO = [
  { id: 'd1', kind: 'closed', full: true, road: 'S Elm St', on: 'Elm St', tile: [48, 40], dir: 'v', text: 'Demo: S Elm St closed for a water main repair.' },
  { id: 'd2', kind: 'work', full: false, road: 'W Market St', on: 'Market St', tile: [20, 24], dir: 'h', text: 'Demo: W Market St, right lane closed for paving.' },
  { id: 'd3', kind: 'crash', full: false, road: 'Benbow Rd', on: 'Benbow Rd', tile: [64, 32], dir: 'v', text: 'Demo: crash on Benbow Rd, one lane blocked.' },
  { id: 'd4', kind: 'event', full: true, road: 'Hardie St', on: null, tile: [70, 28], dir: 'h', text: 'Demo: Hardie St closed for a 5K.' },
  { id: 'd5', kind: 'closed', full: true, road: 'McConnell Rd', on: null, tile: [75, 33], dir: 'h', text: 'Demo: McConnell Rd closed for construction.' },
].map((e) => ({ ...e, upcoming: false, start: null, end: null }));

const KIND = {
  crash: { icon: '💥', label: 'Crash' },
  closed: { icon: '🚧', label: 'Closed' },
  event: { icon: '🎉', label: 'Closed for an event' },
  work: { icon: '🦺', label: 'Roadwork' },
};

/** Call once after the village has built its map and attached its own canvas listeners. */
export function initRoads(opts) {
  ({ T, ctx, canvas, map } = opts);
  canvas.addEventListener('mousemove', onHover);
  refreshRoads();
  setInterval(refreshRoads, 5 * 60e3);
}

async function refreshRoads() {
  const demo = new URLSearchParams(location.search).get('roads') === 'demo';
  let data;
  try {
    data = demo ? { events: DEMO, source: 'demo', generatedAt: new Date().toISOString() } : await (await fetch('data/roads.json', { cache: 'no-store' })).json();
  } catch {
    return; // no roads.json yet: quiet streets
  }
  events = (data.events || []).filter((e) => !e.end || new Date(e.end).getTime() > Date.now());
  closed.clear();
  for (const e of onMap()) if (e.full && e.on) for (const [x, y] of blockTiles(e)) closed.add(key(x, y));
  renderRoadList(data);
}

const onMap = () => events.filter((e) => e.tile && !e.upcoming);

// A village road is two tiles wide. A closure blocks the two tiles across it.
function blockTiles(e) {
  const [x, y] = e.tile;
  return e.dir === 'v' ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
}

// ---------- drawing ----------

function px(e) {
  const [x, y] = e.tile;
  return [x * T, y * T];
}

function barrel(x, y, t, i) {
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 1, y + 5, 4, 1);
  ctx.fillStyle = '#e8702a'; ctx.fillRect(x, y, 4, 5);
  ctx.fillStyle = '#fff4e0'; ctx.fillRect(x, y + 1, 4, 1); ctx.fillRect(x, y + 3, 4, 1);
  if (Math.floor(t / 500 + i) % 2) { ctx.fillStyle = '#ffe680'; ctx.fillRect(x + 1, y - 1, 2, 1); } // blinking lamp
}

function cone(x, y) {
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(x, y + 4, 4, 1);
  ctx.fillStyle = '#f07a20'; ctx.fillRect(x + 1, y, 2, 1); ctx.fillRect(x + 1, y + 1, 2, 2); ctx.fillRect(x, y + 3, 4, 1);
  ctx.fillStyle = '#fff4e0'; ctx.fillRect(x + 1, y + 2, 2, 1);
}

function worker(x, y, t) {
  const dig = Math.floor(t / 350) % 2;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x, y + 7, 4, 1);
  ctx.fillStyle = '#f2d23a'; ctx.fillRect(x, y, 4, 1);            // hard hat
  ctx.fillStyle = '#c99a72'; ctx.fillRect(x, y + 1, 4, 2);        // face
  ctx.fillStyle = '#c6e03a'; ctx.fillRect(x, y + 3, 4, 3);        // hi-vis vest
  ctx.fillStyle = '#2a3550'; ctx.fillRect(x, y + 6, 1, 1); ctx.fillRect(x + 3, y + 6, 1, 1);
  ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x + 4, y + 2 + dig, 1, 4);  // shovel handle
  ctx.fillStyle = '#9aa0a6'; ctx.fillRect(x + 4, y + 6 + dig, 2, 1);  // blade
}

function car(x, y, color, tilt) {
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x + 1, y + 4, 6, 1);
  ctx.fillStyle = color; ctx.fillRect(x, y + tilt, 6, 3); ctx.fillRect(x + 1, y - 1 + tilt, 4, 1);
  ctx.fillStyle = '#9cc4d8'; ctx.fillRect(x + 2, y - 1 + tilt, 2, 1);
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(x, y + 3 + tilt, 1, 1); ctx.fillRect(x + 5, y + 3 + tilt, 1, 1);
}

function sideStreet(e, night) {
  // Roads the village doesn't draw get a short stretch of pavement where they are.
  const [x, y] = px(e);
  ctx.fillStyle = '#6a6762'; ctx.fillRect(x - T, y, 4 * T, 2 * T);
  ctx.fillStyle = '#5a5752'; ctx.fillRect(x - T, y, 4 * T, 1); ctx.fillRect(x - T, y + 2 * T - 1, 4 * T, 1);
  if (night) { ctx.fillStyle = `rgba(16,24,64,${night})`; ctx.fillRect(x - T, y, 4 * T, 2 * T); } // match the village's night tint
}

function drawEvent(e, t, i, night) {
  if (!e.on) sideStreet(e, night);
  const [x, y] = px(e);
  const v = e.dir === 'v';
  // Points across the road (for barrels) and along it (for cones).
  const across = (k) => (v ? [x + 1 + k * 5, y + 4] : [x + 6, y + 1 + k * 5]);
  const along = (k) => (v ? [x + 6, y - 8 + k * 7] : [x - 8 + k * 7, y + 6]);

  if (e.kind === 'closed' || e.kind === 'event') {
    for (let k = 0; k < 3; k++) { const [bx, by] = across(k); barrel(bx, by - 1, t, k + i); }
    // Sawhorse sign.
    const [sx, sy] = v ? [x + 2, y - 5] : [x - 5, y + 4];
    ctx.fillStyle = '#5a3d22'; ctx.fillRect(sx, sy + 3, 1, 3); ctx.fillRect(sx + 7, sy + 3, 1, 3);
    ctx.fillStyle = '#f4f0e6'; ctx.fillRect(sx, sy, 8, 3);
    ctx.fillStyle = '#e8702a'; for (let k = 0; k < 8; k += 3) ctx.fillRect(sx + k, sy, 2, 3);
    if (e.kind === 'event') { // bunting
      const cols = ['#c8553d', '#e0a020', '#3d8ac8', '#4a9a5a'];
      const [fx, fy] = v ? [x - 4, y - 2] : [x - 2, y - 4];
      for (let k = 0; k < 6; k++) { ctx.fillStyle = cols[k % 4]; ctx.fillRect(v ? fx + 3 : fx + k * 4, v ? fy + k * 4 : fy + (k % 2), 2, 2); }
    }
  } else if (e.kind === 'work') {
    for (let k = 0; k < 4; k++) { const [cx, cy] = along(k); cone(cx, cy); }
    const [wx, wy] = along(2);
    worker(v ? wx - 6 : wx + 1, v ? wy : wy - 9, t);
  } else if (e.kind === 'crash') {
    car(x + 1, y + 5, '#3d6ac8', 0);
    car(x + 6, y + 7, '#c8553d', 1);
    const on = Math.floor(t / 250) % 2;
    ctx.fillStyle = on ? '#ff3b3b' : '#3b6bff'; ctx.fillRect(x + 4, y + 1, 2, 2);
    ctx.fillStyle = on ? 'rgba(255,60,60,.18)' : 'rgba(60,100,255,.18)'; ctx.fillRect(x - 4, y - 3, 18, 14);
  }
}

/** Draw every live event. Call from the village's frame loop after the night tint, passing its alpha. */
export function drawRoads(t, night = 0) {
  onMap().forEach((e, i) => drawEvent(e, t, i, night));
}

// ---------- hover and side list ----------

function hitEvent(ev) {
  const r = canvas.getBoundingClientRect();
  const mx = (ev.clientX - r.left) * (canvas.width / r.width), my = (ev.clientY - r.top) * (canvas.height / r.height);
  return onMap().find((e) => { const [x, y] = px(e); return mx >= x - 10 && mx <= x + 18 && my >= y - 10 && my <= y + 18; });
}

function onHover(ev) {
  const e = hitEvent(ev);
  canvas.title = e ? `${KIND[e.kind].label}: ${e.text}` : '';
  if (e) canvas.style.cursor = 'help';
}

function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(':00', '') : null;
}

function renderRoadList(data) {
  const ul = document.getElementById('roads');
  if (!ul) return;
  ul.innerHTML = '';
  for (const e of events) {
    const li = document.createElement('li');
    const t = document.createElement('div'); t.className = 't';
    t.append(`${KIND[e.kind].icon} ${e.road || 'Road'}`, e.upcoming ? ' (coming up)' : '');
    const m1 = document.createElement('div'); m1.className = 'm';
    m1.textContent = e.text;
    const m2 = document.createElement('div'); m2.className = 'm';
    const when = [e.start && (e.upcoming ? `from ${fmt(e.start)}` : null), e.end ? `until ${fmt(e.end)}` : null].filter(Boolean).join(' ');
    m2.textContent = [KIND[e.kind].label, when].filter(Boolean).join(' · ');
    li.append(t, m1, m2);
    if (e.upcoming) li.style.opacity = 0.7;
    ul.append(li);
  }
  if (!events.length) ul.innerHTML = '<li class="m">No closures or crashes reported in Greensboro right now.</li>';
  const src = document.getElementById('roadsSource');
  if (src) {
    const when = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : '';
    src.textContent = `From NCDOT DriveNC${when ? `, checked ${when}` : ''}.`;
  }
}
