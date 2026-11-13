// GSO Village: the downtown scale model plus the paper beside it.
// Loads the live data (digest items, council, weather, roads, restaurants and bars), turns it into a scene for
// the model (model.js), and writes the words into the almanac strip and the paper. Crime is written by crime.js,
// into the paper only.
//
// Previews without waiting for real data: ?weather=rain|snow|storm|fog|cloudy|clear, ?council=tonight|session,
// ?roads=demo, ?time=dawn|day|dusk|night.

import { startModel } from './model.js';
import { makePlacer, toGrid, inModel, norm } from './place.js';
import { loadCivic, councilState, councilLine } from './civic.js';
import { GUESS, etNow, isOpen, openLine } from './hours.js';

const TZ = 'America/New_York';
const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...kids) { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== false)); return n; }
const ext = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', textContent: text, onclick: (e) => e.stopPropagation() });

async function loadJSON(url, fallback = null) {
  try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status); return await r.json(); } catch { return fallback; }
}

// ---------- time ----------
const etDate = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const dayOf = (it) => (it.start ? (it.allDay ? it.start : etDate(new Date(it.start))) : null);
const isToday = (it) => dayOf(it) === etDate(new Date());
function isOver(it) {
  const now = Date.now();
  if (it.end) return new Date(it.end).getTime() < now;
  if (!it.start) return false;
  if (it.allDay) return it.start < etDate(new Date());
  return new Date(it.start).getTime() + 3 * 3600e3 < now;
}
const isNow = (it) => it.start && !it.allDay && Date.parse(it.start) - 3600e3 <= Date.now() && !isOver(it);
function fmtWhen(it) {
  if (!it.start) return null;
  if (it.allDay) return new Date(it.start + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  return new Date(it.start).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}
const hhmm = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).replace(':00', '');

// ---------- state ----------
let model, placer, mapInfo;
let items = [], digests = 0, generatedAt = null, council = { lit: false };
let weather = null, roads = { events: [] }, eats = null, places = [];
let picked = null; // building the paper is showing

// ---------- weather ----------
function previewWeather(kind) {
  const base = { text: `Preview: ${kind}`, tempF: 58, windMph: 10, sky: 'cloudy', precip: 'none', intensity: 'moderate', fog: false, alerts: [] };
  if (['rain', 'snow', 'storm'].includes(kind)) base.precip = kind;
  if (kind === 'storm') { base.intensity = 'heavy'; base.windMph = 25; base.alerts = [{ event: 'Severe Thunderstorm Warning', headline: 'Preview alert', severity: 'Severe' }]; }
  if (kind === 'snow') base.tempF = 29;
  if (kind === 'fog') base.fog = true;
  if (kind === 'partly' || kind === 'clear') base.sky = kind;
  return base;
}
function renderAlerts() {
  const live = (weather?.alerts || []).filter((a) => !a.ends || new Date(a.ends).getTime() > Date.now());
  const banner = $('alert');
  banner.hidden = !live.length;
  banner.innerHTML = '';
  for (const a of live) banner.append(el('div', {}, el('b', { textContent: a.event }), a.headline ? ` · ${a.headline}` : ''));
}

// ---------- roads ----------
const ROAD_KIND = { crash: 'Crash', closed: 'Closed', event: 'Closed for an event', work: 'Roadwork' };
const DEMO_ROADS = [
  { id: 'd1', kind: 'closed', full: true, road: 'E Market St', lat: 36.07215, lon: -79.78830, text: 'Demo: E Market St closed at Davie St for utility work.' },
  { id: 'd2', kind: 'work', full: false, road: 'S Elm St', lat: 36.06940, lon: -79.79080, text: 'Demo: S Elm St, one lane closed for paving.' },
  { id: 'd3', kind: 'crash', full: false, road: 'W Friendly Ave', lat: 36.07470, lon: -79.79310, text: 'Demo: crash on W Friendly Ave, one lane blocked.' },
  { id: 'd4', kind: 'work', full: false, road: 'McConnell Rd', lat: 36.0600, lon: -79.7268, text: 'Demo: outside downtown, so the paper only.' },
].map((e) => ({ ...e, upcoming: false, start: null, end: null }));

function liveRoads() {
  const now = Date.now();
  return (roads.events || [])
    .filter((e) => !e.end || new Date(e.end).getTime() > now)
    .map((e) => (e.upcoming && e.start && new Date(e.start).getTime() <= now ? { ...e, upcoming: false } : e))
    .map((e) => {
      if (e.lat == null || e.lon == null) return { ...e, onModel: false };
      const [gx, gy] = toGrid(mapInfo, e.lat, e.lon);
      return { ...e, gx, gy, onModel: inModel(mapInfo, gx, gy) };
    });
}

// ---------- places (restaurants and bars) ----------
const BARS = new Set(['bar', 'nightclub', 'brewery']);
const KIND_LABEL = { bar: 'Bar', nightclub: 'Nightclub', brewery: 'Brewery', cafe: 'Cafe', restaurant: 'Restaurant', takeout: 'Takeout' };
function placeOnModel() {
  places = [];
  for (const p of eats?.places || []) {
    if (p.lat == null) continue;
    const [gx, gy] = toGrid(mapInfo, p.lat, p.lon);
    if (!inModel(mapInfo, gx, gy)) continue;
    const b = model.buildingAt(gx, gy, 1.6);
    places.push({ ...p, gx, gy, bid: b ? b.id : null, guessed: !p.hours, week: p.hours || GUESS[p.kind] || GUESS.restaurant });
  }
}

// ---------- items on the model ----------
// Each live item gets a spot (and usually a building) on the model, or stays in the paper only.
let spots = new Map(); // item id -> { gx, gy, bid }
function placeItems() {
  spots = new Map();
  for (const it of items) {
    const s = placer.place(it);
    if (!s) continue;
    const b = s.buildingId != null ? model.building(s.buildingId) : model.buildingAt(s.gx, s.gy, 1.6);
    spots.set(it.id, { gx: s.gx, gy: s.gy, bid: b ? b.id : null });
  }
}
const isDowntown = (it) => spots.has(it.id) || it.district === 'downtown' || it.district === 'south-elm';
const FOOD_POPUP = /food truck|pop-?up|popup|tasting|cookout|food fest/i;
const shortTitle = (t) => (t.length > 38 ? t.slice(0, 37).trimEnd() + '…' : t);

function buildScene() {
  const now = etNow();
  const wxKind = weather ? (weather.precip === 'storm' ? 'storm' : weather.precip === 'rain' ? 'rain' : weather.precip === 'snow' ? 'snow' : 'clear') : 'clear';
  const scene = {
    wx: wxKind, intensity: weather?.intensity, cloudy: weather?.sky === 'cloudy', fog: !!weather?.fog, windMph: weather?.windMph || 0, tempF: weather?.tempF ?? null,
    council: { lit: council.lit, inSession: council.inSession },
    lit: new Map(), strings: new Set(), crowds: [], trucks: [], bubbles: [], focus: [],
    roads: liveRoads().filter((e) => e.onModel && !e.upcoming).map((e) => ({ gx: e.gx, gy: e.gy, kind: e.kind, full: !!e.full })),
  };
  // Open restaurants and bars light their storefronts; open bars after dark get a few people out front.
  const openB = new Set(), shutB = new Set();
  for (const p of places) {
    if (p.bid == null) continue;
    if (isOpen(p.week, now)) {
      openB.add(p.bid);
      if (BARS.has(p.kind)) scene.crowds.push({ id: p.bid, n: 1 + (p.id.length % 3), evening: true });
    } else shutB.add(p.bid);
  }
  for (const id of openB) scene.lit.set(id, 0.9);
  for (const id of shutB) if (!openB.has(id)) scene.lit.set(id, 0.04);
  // Today's items at a place on the model: string lights and a crowd while they're on, a chatter bubble all day.
  for (const it of items) {
    const s = spots.get(it.id);
    if (!s || !isToday(it) || isOver(it)) continue;
    const on = isNow(it) || it.allDay;
    if (it.kind === 'council') continue; // City Hall has its own lights and flag
    if (it.accountType !== 'individual') scene.bubbles.push({ id: s.bid, gx: s.gx, gy: s.gy, text: shortTitle(it.title) });
    if (s.bid != null) scene.focus.push(s.bid);
    if (!on || it.category !== 'event') continue;
    if (FOOD_POPUP.test(it.title) && (s.bid == null || !model.building(s.bid)?.name)) { scene.trucks.push({ gx: s.gx, gy: s.gy }); continue; }
    if (s.bid != null) { scene.lit.set(s.bid, 1); scene.strings.add(s.bid); scene.crowds.push({ id: s.bid, n: 8 }); }
    else scene.crowds.push({ gx: s.gx, gy: s.gy, n: 6 });
  }
  scene.focus = [...new Set(scene.focus)].slice(0, 6);
  scene.bubbles = scene.bubbles.slice(0, 12);
  return scene;
}

function refreshScene() {
  if (!model) return;
  model.update(buildScene());
  renderAlmanac();
}

// ---------- almanac strip ----------
function renderAlmanac() {
  const now = new Date();
  const st = model.sunTimes();
  const bits = [];
  bits.push(el('span', {}, now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }), ' · ', el('b', { textContent: `${model.fmtTime(now)} ${model.ampm(now)}` })));
  if (weather) bits.push(el('span', { textContent: [weather.tempF != null ? `${Math.round(weather.tempF)}°F` : null, (weather.text || '').toLowerCase() || null, weather.windMph ? `wind ${weather.windMph} mph` : null].filter(Boolean).join(', ') }));
  bits.push(el('span', { textContent: `sunrise ${st.rise ? model.fmtTime(st.rise) : '?'} · sunset ${st.set ? model.fmtTime(st.set) : '?'}` }));
  const closed = liveRoads().filter((e) => e.onModel && !e.upcoming).length;
  if (closed) bits.push(el('span', { textContent: `${closed} road event${closed === 1 ? '' : 's'} downtown` }));
  const c = councilLine(council);
  const tonight = items.filter((it) => isDowntown(it) && isToday(it) && !isOver(it) && it.kind !== 'council').length;
  bits.push(el('span', { textContent: [c, tonight ? `${tonight} thing${tonight === 1 ? '' : 's'} on downtown today` : 'downtown is quiet today'].filter(Boolean).join(' · ') }));
  const lab = el('label', {}, el('input', { type: 'checkbox', checked: labelsOn, onchange: (e) => { labelsOn = e.target.checked; model.setLabels(labelsOn); } }), 'labels');
  bits.push(lab, el('a', { className: 'open', href: '#paper', textContent: 'the paper' }));
  $('almanac').replaceChildren(...bits);
  $('paperDate').textContent = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}
let labelsOn = false;

// ---------- the paper ----------
function itemLi(it, { pin = false } = {}) {
  const civic = it.platform === 'City of Greensboro';
  const when = fmtWhen(it);
  const s = spots.get(it.id);
  const li = el('li', { className: [isOver(it) ? 'past' : '', s ? 'go' : ''].join(' ').trim() },
    el('div', { className: 't' }, it.title, pin && s ? el('span', { className: 'pin', textContent: 'on the model', title: 'Tap to look at it on the model' }) : null),
    el('div', { className: 'm', textContent: [isOver(it) ? 'Earlier' : isToday(it) ? 'Today' : null, when, it.venue].filter(Boolean).join(' · ') }),
    el('div', { className: 'm' },
      civic ? `${it.scheduled === 'usual' ? 'Usual schedule, check the city site' : it.recording ? 'Recording on the City’s YouTube' : it.account || 'City of Greensboro'} ` : `${it.platform} · ${it.account || 'a local post'} `,
      /^https:\/\//.test(it.url) ? ext(it.url, civic ? (/youtube\.com/.test(it.url) ? 'Watch ↗' : 'Details ↗') : 'View post ↗') : null));
  if (s && s.bid != null) li.onclick = () => showBuilding(model.building(s.bid), true);
  else if (s) li.onclick = () => model.lookAt({ cx: s.gx, cy: s.gy, hpx: 0 });
  return li;
}
const byTime = (a, b) => (isOver(a) - isOver(b)) || (a.start || '9999').localeCompare(b.start || '9999');

function renderDowntown() {
  const list = items.filter((it) => isDowntown(it) && it.kind !== 'council').sort(byTime);
  const live = list.filter((it) => !isOver(it)), past = list.filter(isOver);
  const ul = $('downtown');
  ul.replaceChildren(...live.map((it) => itemLi(it, { pin: true })));
  if (!live.length) ul.append(el('li', { className: 'm', textContent: 'Nothing posted for downtown right now.' }));
  if (past.length) ul.append(el('li', {}, el('details', {}, el('summary', { textContent: `Earlier (${past.length})` }), el('ul', {}, ...past.map((it) => itemLi(it))))));
}

function renderAround() {
  const names = Object.fromEntries((mapInfo.districts || []).map((d) => [d.id, d.name]));
  names.board = 'All over town'; names.away = 'Out of town';
  const order = ['college-hill', 'uncg', 'westside', 'north', 'coliseum', 'ncat', 'southeast', 'board', 'away'];
  const box = $('aroundList');
  box.replaceChildren(el('div', { className: 'sub', textContent: 'The model covers downtown only. Everything else in the digest, by area:' }));
  const rest = items.filter((it) => !isDowntown(it));
  const groups = [...new Set([...order, ...rest.map((it) => it.district)])];
  for (const g of groups) {
    const list = rest.filter((it) => it.district === g).sort(byTime);
    const live = list.filter((it) => !isOver(it));
    if (!list.length) continue;
    const ul = el('ul', {}, ...live.slice(0, 30).map((it) => itemLi(it)));
    if (live.length > 30) ul.append(el('li', {}, el('details', {}, el('summary', { textContent: `${live.length - 30} more` }), el('ul', {}, ...live.slice(30).map((it) => itemLi(it))))));
    const past = list.filter(isOver);
    if (past.length) ul.append(el('li', {}, el('details', {}, el('summary', { textContent: `Earlier (${past.length})` }), el('ul', {}, ...past.map((it) => itemLi(it))))));
    box.append(el('h3', { textContent: `${names[g] || g} (${live.length})` }), ul);
  }
}

function renderCityHall() {
  const meetings = items.filter((it) => it.kind === 'council' && !isOver(it)).sort(byTime);
  const box = $('cityhall');
  const line = councilLine(council);
  box.replaceChildren(
    el('div', { textContent: line ? `${line}. The Melvin Municipal Office Building is lit.` : 'No council meeting today. The Melvin Municipal Office Building lights up on meeting nights.' }),
    meetings.length ? el('ul', {}, ...meetings.slice(0, 3).map((it) => itemLi(it))) : null);
}

function renderRoads() {
  const list = liveRoads().sort((a, b) => (b.onModel - a.onModel) || (a.upcoming - b.upcoming));
  const ul = $('roads');
  ul.replaceChildren(...list.map((e) => {
    const when = [e.start && e.upcoming ? `from ${fmtWhen({ start: e.start })}` : null, e.end ? `until ${fmtWhen({ start: e.end })}` : null].filter(Boolean).join(' ');
    const li = el('li', { className: e.onModel ? 'go' : '' },
      el('div', { className: 't' }, e.road || 'Road', e.upcoming ? ' (coming up)' : '', e.onModel && !e.upcoming ? el('span', { className: 'pin', textContent: 'on the model' }) : null),
      el('div', { className: 'm', textContent: e.text }),
      el('div', { className: 'm', textContent: [ROAD_KIND[e.kind], when].filter(Boolean).join(' · ') }));
    if (e.upcoming) li.style.opacity = 0.7;
    if (e.onModel) li.onclick = () => model.lookAt({ cx: e.gx, cy: e.gy, hpx: 0 });
    return li;
  }));
  if (!list.length) ul.append(el('li', { className: 'm', textContent: 'No closures or crashes reported in Greensboro right now.' }));
  const when = roads.generatedAt ? hhmm(roads.generatedAt) : '';
  $('roadsSource').textContent = roads.source === 'demo' ? 'Demo closures, not live.' : `From NCDOT DriveNC${when ? `, checked ${when}` : ''}. Downtown ones are on the model as barrels, cones or a stopped car.`;
}

function placeLi(p, now) {
  const li = el('li', { className: p.bid != null ? 'go' : '' },
    el('div', { className: 't', textContent: p.name }),
    el('div', { className: 'm', textContent: [KIND_LABEL[p.kind], p.address].filter(Boolean).join(' · ') }),
    el('div', { className: 'm', textContent: p.guessed ? `${openLine(p, now)} (hours not listed, so a guess)` : openLine(p, now) }));
  if (p.bid != null) li.onclick = () => showBuilding(model.building(p.bid), true);
  return li;
}
function renderEats() {
  const box = $('eats');
  if (!eats) { box.replaceChildren(el('div', { className: 'sub', textContent: 'No restaurants and bars yet.' })); return; }
  const now = etNow();
  const open = places.filter((p) => isOpen(p.week, now));
  const bars = open.filter((p) => BARS.has(p.kind));
  box.replaceChildren(
    el('div', { className: 'sub', textContent: `${open.length} of ${places.length} local places downtown are open now, ${bars.length} of them bars. Open ones have their storefronts lit; open bars have a few people out front after dark.` }),
    el('details', {}, el('summary', { textContent: 'Open now' }), el('ul', {}, ...open.sort((a, b) => a.name.localeCompare(b.name)).map((p) => placeLi(p, now)))));
}

/** The card at the top of the paper for a building on the model. */
function showBuilding(b, look = false) {
  picked = b;
  const box = $('card');
  if (!b) { box.replaceChildren(); return; }
  if (look) model.lookAt(b);
  const here = items.filter((it) => spots.get(it.id)?.bid === b.id).sort(byTime);
  const ps = places.filter((p) => p.bid === b.id);
  const now = etNow();
  const name = b.name || ps[0]?.name || 'A downtown building';
  const card = el('div', { className: 'card' },
    el('button', { textContent: 'close', onclick: () => showBuilding(null) }),
    el('div', { className: 't', textContent: name }),
    !here.length && !ps.length ? el('div', { className: 'sub', textContent: 'Nothing posted here right now.' }) : null,
    ps.length ? el('ul', {}, ...ps.map((p) => placeLi(p, now))) : null,
    here.length ? el('ul', {}, ...here.map((it) => itemLi(it))) : null);
  box.replaceChildren(card);
  if (matchMedia('(max-width:980px)').matches) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else $('paper').scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPaper() {
  const when = generatedAt ? hhmm(generatedAt) : null;
  const live = items.filter((it) => !isOver(it)).length;
  $('status').textContent = `${live} things coming up${digests ? `, from ${digests} digest${digests === 1 ? '' : 's'}` : ''}${when ? `. Updated ${when}.` : '.'}`;
  renderDowntown(); renderCityHall(); renderRoads(); renderEats(); renderAround();
  if (picked) showBuilding(picked);
}

// ---------- refresh loops ----------
async function refreshItems() {
  const [data, civic] = await Promise.all([loadJSON('data/items.json', { items: [], digests: 0, generatedAt: null }), loadCivic()]);
  items = [...(data.items || []), ...(civic.items || [])].sort(byTime);
  digests = data.digests || 0;
  generatedAt = data.generatedAt || civic.generatedAt;
  council = councilState(items);
  placeItems();
}
async function refreshWeather() {
  weather = Q.get('weather') ? previewWeather(Q.get('weather')) : await loadJSON('data/weather.json', null);
  renderAlerts();
}
async function refreshRoads() {
  roads = Q.get('roads') === 'demo' ? { events: DEMO_ROADS, source: 'demo', generatedAt: new Date().toISOString() } : await loadJSON('data/roads.json', { events: [] });
}

// ---------- boot ----------
const [map, info, eatsData] = await Promise.all([loadJSON('model/downtown.json'), loadJSON('data/map.json', { districts: [] }), loadJSON('data/eats.json', null)]);
mapInfo = { ...map, districts: info.districts };
eats = eatsData;
placer = makePlacer(map, eats?.places || []);
model = startModel({
  canvas: $('village'),
  map,
  onPick: (b) => showBuilding(b),
  onHover: (b) => { $('village').style.cursor = b ? 'pointer' : 'grab'; },
});
placeOnModel();
await Promise.all([refreshItems(), refreshWeather(), refreshRoads()]);
refreshScene();
renderPaper();

setInterval(async () => { await refreshItems(); refreshScene(); renderPaper(); }, 60e3);
setInterval(async () => { await refreshWeather(); refreshScene(); }, 5 * 60e3);
setInterval(async () => { await refreshRoads(); refreshScene(); renderRoads(); }, 5 * 60e3);
setInterval(() => { council = councilState(items); refreshScene(); renderAlerts(); }, 30e3); // opening hours and council state turn over by the clock
