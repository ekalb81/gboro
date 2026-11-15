// Where things go on the downtown model. No DOM, so node tests can import it.
//
// The model (public/model/downtown.json) is a grid at MAP.M metres per tile, north to the upper right,
// with GEO giving the lat/lon box it was cut from. Things with coordinates (restaurants, road events)
// project straight onto it. Digest items only have a venue and an address, so they are placed by:
//   1. a named model building that matches the venue (Carolina Theatre, Tanger Center, ...)
//   2. a restaurant or bar from eats.json that matches the venue, or has the same street address
//   3. a shop, office or venue mapped inside a model building (the building's "tn" list), or the building at that exact address ("ad")
//   4. the street address: between the two nearest known addresses on that street, or failing that
//      along the street by Greensboro's block numbering (100s per block out from Elm St and Market St).
// Anything that can't be placed inside the model goes in the paper only.

export const norm = (s) => (s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’`.]/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

const DIRS = { n: 'north', s: 'south', e: 'east', w: 'west', north: 'north', south: 'south', east: 'east', west: 'west' };
const SUFFIX = {
  st: 'street', street: 'street', ave: 'avenue', av: 'avenue', avenue: 'avenue', blvd: 'boulevard', boulevard: 'boulevard',
  rd: 'road', road: 'road', dr: 'drive', drive: 'drive', pl: 'place', place: 'place', ct: 'court', court: 'court',
  ln: 'lane', lane: 'lane', pkwy: 'parkway', parkway: 'parkway', way: 'way', sq: 'square', cir: 'circle', hwy: 'highway',
};

/** "245 E. Friendly Ave, Greensboro, NC" -> { num: 245, street: 'east friendly avenue' }, or null. */
export function parseAddress(addr) {
  if (!addr || /^n\/?a$/i.test(addr.trim())) return null;
  const first = addr.split(',')[0];
  const m = norm(first).match(/^(\d+)[a-z]?\s+(.+)$/);
  if (!m) return null;
  const words = m[2].split(' ').filter((w) => !/^(suite|ste|unit|apt)$/.test(w));
  const cut = words.findIndex((w, i) => i > 0 && /^(suite|ste|unit|apt|\d+)$/.test(w));
  const ws = (cut > 0 ? words.slice(0, cut) : words).map((w, i, a) => (i === 0 && a.length > 1 && DIRS[w] ? DIRS[w] : i === a.length - 1 && SUFFIX[w] ? SUFFIX[w] : w));
  return { num: +m[1], street: ws.join(' ') };
}

/** Lat/lon to model grid [gx, gy]. */
export function toGrid(model, lat, lon) {
  const g = model.GEO;
  return [((lon - g.west) * g.mPerDegLon) / model.M, ((g.north - lat) * g.mPerDegLat) / model.M];
}
export const inModel = (model, gx, gy, margin = 0) => gx >= -margin && gy >= -margin && gx <= model.GX + margin && gy <= model.GY + margin;

const pairs = (a) => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };

/**
 * Everything placement needs, built once per model + eats snapshot.
 * eatsPlaces: eats.json places (with lat, lon, address).
 */
export function makePlacer(model, eatsPlaces = []) {
  // Street points by normalised name.
  const streets = new Map();
  for (const r of model.R) {
    if (!r.n || r.ar) continue;
    const k = norm(r.n);
    if (!streets.has(k)) streets.set(k, []);
    streets.get(k).push(...pairs(r.p));
  }
  // Named buildings.
  const named = model.B.filter((b) => b.n && norm(b.n).length >= 4).map((b) => {
    const p = pairs(b.p);
    return { id: b.id, n: norm(b.n), gx: p.reduce((s, q) => s + q[0], 0) / p.length, gy: p.reduce((s, q) => s + q[1], 0) / p.length };
  });
  // Who is inside each building, and each building's own street address (tools/model/names.py).
  const centre = (b) => { const p = pairs(b.p); return { id: b.id, gx: p.reduce((s, q) => s + q[0], 0) / p.length, gy: p.reduce((s, q) => s + q[1], 0) / p.length }; };
  const tenants = model.B.flatMap((b) => (b.tn || []).filter((t) => norm(t).length >= 4).map((t) => ({ ...centre(b), n: norm(t) })));
  const addressed = model.B.flatMap((b) => {
    const m = (b.ad || '').match(/^(\d+)[A-Za-z]?(?:-(\d+)[A-Za-z]?)?\s+(.+)$/);
    const a = m && parseAddress(`1 ${m[3]}`);
    return a ? [{ ...centre(b), lo: +m[1], hi: +(m[2] || m[1]), street: a.street }] : [];
  });
  // Known addresses with coordinates, from the restaurants and bars.
  const places = eatsPlaces.filter((p) => p.lat != null && p.lon != null).map((p) => {
    const [gx, gy] = toGrid(model, p.lat, p.lon);
    return { ...p, gx, gy, n: norm(p.name), addr: parseAddress(p.address) };
  });
  const byStreet = new Map();
  for (const p of places) if (p.addr) { if (!byStreet.has(p.addr.street)) byStreet.set(p.addr.street, []); byStreet.get(p.addr.street).push(p); }

  const matchName = (v, list) => {
    if (!v || v.length < 4) return null;
    let hit = list.find((x) => x.n === v);
    if (!hit && v.length >= 5) hit = list.find((x) => x.n.length >= 5 && (v.includes(x.n) || x.n.includes(v)));
    return hit || null;
  };

  // Greensboro numbers addresses in hundreds per block out from Elm St (east/west) and Market St (north/south).
  const BLOCK_M = 155; // metres per hundred numbers; fitted to 53 downtown eats.json addresses (median miss about 40 m)
  function byBlockNumbers(a) {
    const pts = streets.get(a.street);
    if (!pts || !pts.length) return null;
    const dir = a.street.split(' ')[0];
    const ax = dir === 'east' ? [1, 0] : dir === 'west' ? [-1, 0] : dir === 'north' ? [0, -1] : dir === 'south' ? [0, 1] : null;
    // No direction prefix: the number can't be placed from block numbering, so leave it to the paper.
    if (!ax) return null;
    const divider = streets.get(dir === 'east' || dir === 'west' ? 'north elm street' : 'east market street');
    // Origin: the street point closest to the divider street.
    let origin = pts[0], best = Infinity;
    for (const p of pts) for (const q of divider || []) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < best) { best = d; origin = p; } }
    if (!divider) origin = pts.reduce((o, p) => (p[0] * ax[0] + p[1] * ax[1] < o[0] * ax[0] + o[1] * ax[1] ? p : o), pts[0]);
    // Walk outward along the street's own points.
    const want = (Math.max(0, a.num - 100) / 100) * BLOCK_M / model.M;
    const proj = (p) => (p[0] - origin[0]) * ax[0] + (p[1] - origin[1]) * ax[1];
    const out = pts.filter((p) => proj(p) >= -0.5).sort((p, q) => proj(p) - proj(q));
    if (!out.length) return null;
    let prev = origin, acc = 0;
    for (const p of out) {
      const L = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (acc + L >= want && L > 0) { const t = (want - acc) / L; return [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t]; }
      acc += L; prev = p;
    }
    // Past the end of the modelled street: extend straight on and let inModel decide.
    return [prev[0] + ax[0] * (want - acc), prev[1] + ax[1] * (want - acc)];
  }

  function byAddress(a) {
    const known = byStreet.get(a.street) || [];
    const same = known.find((p) => p.addr.num === a.num);
    if (same) return { gx: same.gx, gy: same.gy, how: 'address' };
    // Between the nearest known numbers on the same side of the 100s, if there are two around it.
    const lo = known.filter((p) => p.addr.num < a.num).sort((p, q) => q.addr.num - p.addr.num)[0];
    const hi = known.filter((p) => p.addr.num > a.num).sort((p, q) => p.addr.num - q.addr.num)[0];
    if (lo && hi && hi.addr.num - lo.addr.num <= 200) {
      const t = (a.num - lo.addr.num) / (hi.addr.num - lo.addr.num);
      return { gx: lo.gx + (hi.gx - lo.gx) * t, gy: lo.gy + (hi.gy - lo.gy) * t, how: 'street' };
    }
    const g = byBlockNumbers(a);
    return g ? { gx: g[0], gy: g[1], how: 'street' } : null;
  }

  /** { gx, gy, how, buildingId?, place? } inside the model, or null. */
  function place(item) {
    const v = norm(item.venue);
    const b = matchName(v, named);
    if (b) return { gx: b.gx, gy: b.gy, how: 'building', buildingId: b.id };
    const p = matchName(v, places);
    if (p && inModel(model, p.gx, p.gy)) return { gx: p.gx, gy: p.gy, how: 'place', place: p };
    if (p) return null; // a known place, but outside downtown
    const t = matchName(v, tenants);
    if (t) return { gx: t.gx, gy: t.gy, how: 'building', buildingId: t.id };
    const a = parseAddress(item.address);
    if (!a) return null;
    // The exact number first; then a range, which only covers its own side of the street (odd or even) when both ends agree.
    const on = addressed.filter((x) => x.street === a.street);
    const at = on.find((x) => x.lo === a.num || x.hi === a.num)
      || on.find((x) => a.num > x.lo && a.num < x.hi && ((x.lo - x.hi) % 2 !== 0 || (a.num - x.lo) % 2 === 0));
    if (at) return { gx: at.gx, gy: at.gy, how: 'building', buildingId: at.id };
    const g = byAddress(a);
    return g && inModel(model, g.gx, g.gy) ? g : null;
  }

  return { place, places, streets, parseAddress, byAddress };
}

/** Distance from a point to the nearest point on a polyline chain, and how far along it that is. */
export function nearestOnChain(chainPts, gx, gy) {
  let best = { dist: Infinity, d: 0, i: 0 }, acc = 0;
  for (let i = 1; i < chainPts.length; i++) {
    const [ax, ay] = chainPts[i - 1], [bx, by] = chainPts[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const t = L2 ? Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / L2)) : 0;
    const dist = Math.hypot(ax + dx * t - gx, ay + dy * t - gy);
    if (dist < best.dist) best = { dist, d: acc + L * t, i };
    acc += L;
  }
  return best;
}
