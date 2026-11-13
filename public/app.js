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
const SVG = 'http://www.w3.org/2000/svg';
/** One of the icons from the sprite in index.html. */
function icon(name) {
  const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
/** A coloured square with an icon, at the left of each line in the paper. */
const tile = (name, bg, pinned = false) => el('span', { className: 'tile', style: `background:${bg}` }, icon(name), pinned ? el('span', { className: 'pin', title: 'On the model' }, icon('pin')) : null);
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
const ALERT_ICON = [[/freeze|frost|winter|ice|snow|cold|chill|sleet/i, 'snow'], [/thunder|tornado|storm/i, 'storm'], [/flood|rain/i, 'rain'], [/fog/i, 'fog'], [/wind/i, 'wind'], [/heat/i, 'therm']];
const alertIcon = (ev) => (ALERT_ICON.find(([re]) => re.test(ev)) || [null, 'alert'])[1];
// NWS headlines end "... until November 14 at 8:00AM EST by NWS Raleigh NC"; the chip only needs "until Sat 8 AM".
const untilShort = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(':00', '');
function renderAlerts() {
  const live = (weather?.alerts || []).filter((a) => !a.ends || new Date(a.ends).getTime() > Date.now());
  const box = $('alert');
  box.hidden = !live.length;
  box.replaceChildren(...live.flatMap((a) => {
    const level = /warning/i.test(a.event) ? (/severe|extreme/i.test(a.severity || '') || /tornado|severe/i.test(a.event) ? 'severe' : 'warn') : '';
    const more = el('div', { className: 'chip-more', textContent: a.headline || a.event });
    const chip = el('button', { className: `chip ${level}`.trim(), title: a.headline || a.event, ariaExpanded: 'false', onclick: () => chip.setAttribute('aria-expanded', chip.getAttribute('aria-expanded') === 'true' ? 'false' : 'true') },
      el('span', { className: 'badge' }, icon(alertIcon(a.event))), a.event, a.ends ? el('span', { className: 'until', textContent: `until ${untilShort(a.ends)}` }) : null);
    chip.setAttribute('aria-expanded', 'false');
    return [chip, more];
  }));
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
// Where each area of town lies, for the signposts at the model's edge (hub points from scripts/eats-lib.mjs).
const AREAS = [
  ['college-hill', 36.07100, -79.80041], ['uncg', 36.06750, -79.80900], ['westside', 36.08600, -79.83360], ['north', 36.09539, -79.81632],
  ['coliseum', 36.05930, -79.82500], ['ncat', 36.07710, -79.77260], ['southeast', 36.06300, -79.76500],
];
const SIGN_NAME = { 'college-hill': 'College Hill', uncg: 'UNCG', westside: 'Friendly', north: 'Battleground', coliseum: 'Coliseum', ncat: 'NC A&T', southeast: 'Southeast' };
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
  scene.signs = AREAS.map(([id, lat, lon]) => ({ id, lat, lon, name: SIGN_NAME[id], n: items.filter((it) => it.district === id && !isDowntown(it) && !isOver(it)).length }));
  scene.bubbles = scene.bubbles.slice(0, 12);
  return scene;
}

function refreshScene() {
  if (!model) return;
  model.update(buildScene());
  renderAlmanac();
}

// ---------- almanac strip ----------
function skyIcon(night) {
  if (!weather) return night ? 'moon' : 'sun';
  if (weather.precip === 'storm') return 'storm';
  if (weather.precip === 'rain') return 'rain';
  if (weather.precip === 'snow') return 'snow';
  if (weather.fog) return 'fog';
  if (weather.sky === 'cloudy') return 'cloud';
  return night ? 'moon' : 'sun';
}
function renderAlmanac() {
  const now = new Date();
  const st = model.sunTimes();
  const night = st.rise && st.set ? now < st.rise || now > st.set : false;
  const ic = skyIcon(night);
  const wet = ['rain', 'storm', 'snow', 'fog', 'cloud'].includes(ic);
  const temp = weather?.tempF != null ? `${Math.round(weather.tempF)}°` : null;
  const cond = [(weather?.text || '').toLowerCase() || null, weather?.windMph ? `wind ${weather.windMph} mph` : null].filter(Boolean).join(', ');
  $('almanac').replaceChildren(
    el('span', { className: `sky${night && !wet ? ' night' : wet ? ' wet' : ''}` }, icon(ic)),
    el('div', {},
      el('div', { className: 'when' }, model.fmtTime(now), el('small', { textContent: model.ampm(now) })),
      el('div', { className: 'day', textContent: now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' }) })),
    temp || cond ? el('div', { className: 'wx' }, temp ? el('b', { textContent: temp }) : null, cond ? el('div', { className: 'cond', textContent: cond }) : null,
      el('div', { className: 'sun' }, el('span', {}, icon('rise'), st.rise ? model.fmtTime(st.rise) : '?'), el('span', {}, icon('set'), st.set ? model.fmtTime(st.set) : '?'))) : null);
}

// ---------- the paper ----------
const KINDS = [
  [/jazz|blues|band|concert|live music|\blive\b|dj\b|bluegrass|karaoke|\bjam\b|symphony|orchestra|choir|hip.?hop|rap|singer|music|showcase/i, 'music', '#d9822b'],
  [/comedy|open mic|poetry|slam|stand.?up|improv/i, 'mic', '#7a4fb0'],
  [/book|reading|author|library|signing/i, 'book', '#3f7f8f'],
  [/movie|film|screening|cinema/i, 'film', '#4a68b0'],
  [/gallery|art\b|arts\b|craft|museum|exhibit|paint/i, 'art', '#c2477a'],
  [/market|vendor|pop.?up shop|bazaar|fair\b/i, 'basket', '#5a9a3c'],
  [/run\b|5k|walk\b|yoga|fitness|ride\b|cycle/i, 'run', '#2e8f6a'],
  [/beer|brew|wine|cocktail|tasting|happy hour/i, 'beer', '#c99a00'],
  [/taco|food|brunch|dinner|lunch|breakfast|truck|bbq|cook|eat/i, 'food', '#b8452f'],
  [/trivia|game|bingo|party|dance|drag|salsa/i, 'star', '#d14a8b'],
];
function kindOf(it) {
  if (it.kind === 'council') return ['hall', '#4a68b0'];
  if (it.category === 'news') return ['news', '#5b4c3e'];
  const k = KINDS.find(([re]) => re.test(it.title));
  return k ? [k[1], k[2]] : ['cal', '#8a5a2b'];
}
const showOnModel = (bid) => model.highlight(bid != null ? model.building(bid) : picked);
function itemLi(it) {
  const civic = it.platform === 'City of Greensboro';
  const when = fmtWhen(it);
  const s = spots.get(it.id);
  const [ic, bg] = kindOf(it);
  const li = el('li', { className: ['it', isOver(it) ? 'past' : '', s ? 'go' : ''].join(' ').trim() },
    tile(ic, bg, !!s),
    el('div', { className: 'body' },
      el('div', { className: 't', textContent: it.title }),
      el('div', { className: 'm', textContent: [isOver(it) ? 'Earlier' : null, when, it.venue].filter(Boolean).join(' · ') }),
      el('div', { className: 'm' },
        civic ? `${it.scheduled === 'usual' ? 'Usual schedule, check the city site' : it.recording ? 'Recording on the City’s YouTube' : it.account || 'City of Greensboro'} ` : `${it.platform} · ${it.account || 'a local post'} `,
        /^https:\/\//.test(it.url) ? ext(it.url, civic ? (/youtube\.com/.test(it.url) ? 'Watch ↗' : 'Details ↗') : 'View post ↗') : null)));
  if (s && s.bid != null) { li.onclick = () => showBuilding(model.building(s.bid), true); li.onmouseenter = () => showOnModel(s.bid); li.onmouseleave = () => showOnModel(null); }
  else if (s) li.onclick = () => model.lookAt({ cx: s.gx, cy: s.gy, hpx: 0 });
  return li;
}
const byTime = (a, b) => (isOver(a) - isOver(b)) || (a.start || '9999').localeCompare(b.start || '9999');

// Downtown items under day headings; the far future folds away so the paper stays short.
function dayGroup(it) {
  const d = dayOf(it);
  if (!d) return 'Any day';
  const today = etDate(new Date());
  const diff = Math.round((Date.parse(d) - Date.parse(today)) / 86400e3);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long' });
  return 'Later on';
}
function renderDowntown() {
  const list = items.filter((it) => isDowntown(it) && it.kind !== 'council').sort(byTime);
  const live = list.filter((it) => !isOver(it)), past = list.filter(isOver);
  const box = $('downtown');
  box.replaceChildren();
  if (!live.length) box.append(el('div', { className: 'sub', textContent: 'Nothing posted for downtown right now.' }));
  const groups = new Map();
  for (const it of live) { const g = dayGroup(it); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(it); }
  let shown = 0;
  for (const [g, its] of groups) {
    const ul = el('ul', {}, ...its.map((it) => itemLi(it)));
    if (g === 'Later on' || shown > 24) box.append(el('details', {}, el('summary', { textContent: `${g === 'Later on' ? 'Later on' : g} (${its.length})` }), ul));
    else box.append(el('div', { className: 'day-h', textContent: g }), ul);
    shown += its.length;
  }
  if (past.length) box.append(el('details', {}, el('summary', { textContent: `Earlier (${past.length})` }), el('ul', {}, ...past.map((it) => itemLi(it)))));
}

function renderAround() {
  const names = Object.fromEntries((mapInfo.districts || []).map((d) => [d.id, d.name]));
  names.board = 'All over town'; names.away = 'Out of town';
  const order = ['college-hill', 'uncg', 'westside', 'north', 'coliseum', 'ncat', 'southeast', 'board', 'away'];
  const box = $('aroundList');
  const open = new Set([...box.querySelectorAll('details.area[open]')].map((d) => d.id));
  box.replaceChildren(el('div', { className: 'sub', textContent: 'The model covers downtown only. Everything else, by area; the signposts at the edge of the model point to each one.' }));
  const rest = items.filter((it) => !isDowntown(it));
  const groups = [...new Set([...order, ...rest.map((it) => it.district)])];
  for (const g of groups) {
    const list = rest.filter((it) => it.district === g).sort(byTime);
    const live = list.filter((it) => !isOver(it));
    if (!list.length) continue;
    const ul = el('ul', {}, ...live.map((it) => itemLi(it)));
    const past = list.filter(isOver);
    if (past.length) ul.append(el('li', {}, el('details', {}, el('summary', { textContent: `Earlier (${past.length})` }), el('ul', {}, ...past.map((it) => itemLi(it))))));
    const d = el('details', { className: 'area', id: `area-${g}` }, el('summary', {}, `${names[g] || g} `, el('span', { className: 'n', textContent: `· ${live.length} coming up` })), ul);
    d.open = open.has(d.id);
    box.append(d);
  }
}

function renderCityHall() {
  const meetings = items.filter((it) => it.kind === 'council' && !isOver(it)).sort(byTime);
  const box = $('cityhall');
  const line = councilLine(council);
  box.replaceChildren(
    el('div', { textContent: line ? `${line}. The Melvin Municipal Office Building is lit.` : 'No council meeting today. The Melvin Municipal Office Building lights up on meeting nights.' }),
    meetings.length ? el('ul', {}, ...meetings.slice(0, 3).map((it) => itemLi(it))) : null);
  const city = model.building('city');
  if (city) box.firstChild.append(' ', el('a', { href: '#', textContent: 'Show me', onclick: (e) => { e.preventDefault(); showBuilding(city, true); } }));
}

function renderRoads() {
  const list = liveRoads().sort((a, b) => (b.onModel - a.onModel) || (a.upcoming - b.upcoming));
  const ul = $('roads');
  ul.replaceChildren(...list.map((e) => {
    const when = [e.start && e.upcoming ? `from ${fmtWhen({ start: e.start })}` : null, e.end ? `until ${fmtWhen({ start: e.end })}` : null].filter(Boolean).join(' ');
    const li = el('li', { className: `it${e.onModel ? ' go' : ''}` },
      tile(e.kind === 'crash' ? 'alert' : 'cone', e.kind === 'crash' ? '#c0321f' : e.kind === 'work' ? '#e0662a' : '#b8452f', e.onModel && !e.upcoming),
      el('div', { className: 'body' },
        el('div', { className: 't' }, e.road || 'Road', e.upcoming ? ' (coming up)' : ''),
        el('div', { className: 'm', textContent: e.text }),
        el('div', { className: 'm', textContent: [ROAD_KIND[e.kind], when].filter(Boolean).join(' · ') })));
    if (e.upcoming) li.style.opacity = 0.7;
    if (e.onModel) li.onclick = () => model.lookAt({ cx: e.gx, cy: e.gy, hpx: 0 });
    return li;
  }));
  if (!list.length) ul.append(el('li', { className: 'm', textContent: 'No closures or crashes reported in Greensboro right now.' }));
  const when = roads.generatedAt ? hhmm(roads.generatedAt) : '';
  $('roadsSource').textContent = roads.source === 'demo' ? 'Demo closures, not live.' : `From NCDOT DriveNC${when ? `, checked ${when}` : ''}. Downtown ones are on the model as barrels, cones or a stopped car.`;
}

function placeLi(p, now) {
  const [ic, bg] = BARS.has(p.kind) ? ['beer', '#c99a00'] : p.kind === 'cafe' ? ['coffee', '#8a5a2b'] : ['food', '#b8452f'];
  const li = el('li', { className: `it${p.bid != null ? ' go' : ''}` },
    tile(ic, bg, p.bid != null),
    el('div', { className: 'body' },
      el('div', { className: 't', textContent: p.name }),
      el('div', { className: 'm', textContent: [KIND_LABEL[p.kind], p.address].filter(Boolean).join(' · ') }),
      el('div', { className: 'm', textContent: p.guessed ? `${openLine(p, now)} (hours not listed, so a guess)` : openLine(p, now) })));
  if (p.bid != null) { li.onclick = () => showBuilding(model.building(p.bid), true); li.onmouseenter = () => showOnModel(p.bid); li.onmouseleave = () => showOnModel(null); }
  return li;
}
function renderEats() {
  const box = $('eats');
  if (!eats) { box.replaceChildren(el('div', { className: 'sub', textContent: 'No restaurants and bars yet.' })); return; }
  const now = etNow();
  const open = places.filter((p) => isOpen(p.week, now));
  const bars = open.filter((p) => BARS.has(p.kind));
  box.replaceChildren(
    el('div', { className: 'stat' }, tile('beer', '#c99a00'), el('div', { textContent: `${open.length} of ${places.length} local places downtown are open now, ${bars.length} of them bars. Open ones have their storefronts lit; open bars have a few people out front after dark.` })),
    el('details', {}, el('summary', { textContent: 'Open now' }), el('ul', {}, ...open.sort((a, b) => a.name.localeCompare(b.name)).map((p) => placeLi(p, now)))));
}

/** The card at the top of the paper for a building on the model. */
function showBuilding(b, look = false) {
  picked = b;
  model.highlight(b);
  const box = $('card');
  if (!b) { box.replaceChildren(); return; }
  if (look) model.lookAt(b);
  const here = items.filter((it) => spots.get(it.id)?.bid === b.id).sort(byTime);
  const ps = places.filter((p) => p.bid === b.id);
  const now = etNow();
  const name = b.name || ps[0]?.name || 'A downtown building';
  const card = el('div', { className: 'card' },
    el('button', { title: 'Close', ariaLabel: 'Close', onclick: () => showBuilding(null) }, icon('close')),
    el('div', { className: 't', textContent: name }),
    !here.length && !ps.length ? el('div', { className: 'sub', textContent: 'Nothing posted here right now.' }) : null,
    ps.length ? el('ul', {}, ...ps.map((p) => placeLi(p, now))) : null,
    here.length ? el('ul', {}, ...here.map((it) => itemLi(it))) : null);
  box.replaceChildren(card);
  if (matchMedia('(max-width:900px)').matches) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  onPick: (b) => {
    if (b && b.sign) {
      const d = $(`area-${b.sign}`);
      if (d) { d.open = true; d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
      (d || $('around')).scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    showBuilding(b);
  },
  onHover: (b) => { $('village').style.cursor = b ? 'pointer' : 'grab'; },
  onView: () => syncTools(),
});
// ---------- controls on the model ----------
function syncTools() { $('zin').disabled = !model.canZoom(1); $('zout').disabled = !model.canZoom(-1); }
$('zin').onclick = () => { model.zoomIn(); syncTools(); };
$('zout').onclick = () => { model.zoomOut(); syncTools(); };
$('home').onclick = () => model.home();
$('labels').onclick = (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); model.setLabels(on); };
$('fold').onclick = (e) => { const on = $('app').classList.toggle('folded'); e.currentTarget.setAttribute('aria-pressed', on); e.currentTarget.title = on ? 'Bring the paper back' : 'Fold the paper away'; };
new ResizeObserver(syncTools).observe($('village'));
// the hint goes once someone has had a look around, or after a while
if (matchMedia('(pointer:coarse)').matches) $('hint').textContent = 'Drag to look around · pinch to zoom · tap a building';
const dropHint = () => $('hint').classList.add('gone');
$('village').addEventListener('pointerdown', dropHint, { once: true });
setTimeout(dropHint, 12e3);
placeOnModel();
await Promise.all([refreshItems(), refreshWeather(), refreshRoads()]);
refreshScene();
renderPaper();

setInterval(async () => { await refreshItems(); refreshScene(); renderPaper(); }, 60e3);
setInterval(async () => { await refreshWeather(); refreshScene(); }, 5 * 60e3);
setInterval(async () => { await refreshRoads(); refreshScene(); renderRoads(); }, 5 * 60e3);
setInterval(() => { council = councilState(items); refreshScene(); renderAlerts(); }, 30e3); // opening hours and council state turn over by the clock
