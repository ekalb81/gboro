"""Keep the model current: rebuild public/model/downtown.json, trees.json and details.json from fresh OpenStreetMap data.

Run inside the Publish workflow on every build. The rebuild itself happens at most once a week (or as soon as the
model tools or the survey layers in git change); in between, the last build is reused from the Actions cache.
Nothing is ever written back to the repository: the rebuilt model is only deployed.

A rebuild:
  1. fetches the model's box from OpenStreetMap (main API in tiles, Overpass as fallback),
     and the street addresses in it from NC OneMap (addresses.py; the copy in data/model/ is the fallback),
  2. every four weeks checks for a newer aerial, new Mapillary street photos, a newer USGS lidar survey
     and buildings in Overture Maps that the model lacks (each only reported, never applied),
  3. runs prep.py, trees.py and details.py on data/model/ (the survey layers kept in git) plus the fresh extract,
  4. writes what changed to the run summary. Big changes (a building appears or disappears, a height moves by more
     than 10 m, a new source turns up) are flagged there. A partial or broken extract is refused and the last good
     model stays up.

The model's box is read from the committed public/model/downtown.json (GEO), which prep.py defines.

Usage:
  python3 tools/model/refresh.py --publish [--cache DIR]   reuse or rebuild, as the Publish run does
  python3 tools/model/refresh.py --dry-run                  rebuild now and report, change nothing
  python3 tools/model/refresh.py                            rebuild now and write public/model/
  extra: --force (with --publish: rebuild even if fresh), --monthly (run the four-weekly checks now),
         --osm-raw FILE (use a saved OpenStreetMap API extract instead of fetching), --report FILE
--publish exits with status 10 before rebuilding if packages the build needs aren't installed (Pillow, numpy,
scipy, shapely; pyarrow optional), so the workflow only installs them on rebuild runs. MAPILLARY_TOKEN is optional.
"""
import argparse, datetime as dt, hashlib, importlib.util, json, math, os, re, shutil, subprocess, sys, tempfile, time
import urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PUB = os.path.join(ROOT, 'public', 'model')
MODEL = os.path.join(PUB, 'downtown.json')
INPUTS = os.path.join(ROOT, 'data', 'model')
SOURCES = os.path.join(INPUTS, 'sources.json')
OUTPUTS = ('downtown.json', 'trees.json', 'details.json')   # what a rebuild writes into public/model/

UA = 'gso-village/0.1 (community map of Greensboro; github.com/ekalb81/gboro)'
ORTHO_URL = 'https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer'
COUNTY_IMAGERY = 'https://gcgis.guilfordcountync.gov/imagery/rest/services/Imagery'
M = 9.0                 # metres per model tile
OSM_MARGIN = 0.0045     # degrees fetched around the model's box (about 400 to 500 m), so streets and names at the edge are whole
OSM_TILE = 0.012        # degrees per OpenStreetMap API call; keeps each call well under the API's 50,000-node limit
BIG_HEIGHT_M = 10       # a height change over this is worth a look
MIN_AREA_M2 = 40        # buildings smaller than this (sheds, kiosks) never make a change "big"
GEOM_KINDS = ('building', 'highway', 'railway', 'leisure', 'amenity')
MAX_AGE_DAYS = 7        # rebuild at least this often
RETRY_HOURS = 6         # after a failed rebuild, wait this long before trying again
MONTHLY_DAYS = 28
STEP_TIMEOUT = 25 * 60  # seconds allowed for prep.py (about 10 minutes on a hosted runner)


def box_of(model):
    """The model's lon/lat box, as prep.py wrote it into GEO."""
    g = model['GEO']
    return {'n': g['north'], 's': g['south'], 'w': g['west'], 'e': g['east'], 'kx': g['mPerDegLon'], 'ky': g['mPerDegLat']}


# ---------- fetching ----------

def get(url, data=None, timeout=180, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # network blips are common on shared runners
            last = e
            print(f'  {url.split("?")[0]} failed ({e}); retry {i + 1}/{tries}', file=sys.stderr)
            time.sleep(10 * (i + 1))
    raise RuntimeError(f'{url.split("?")[0]}: {last}')


def osm_tiles(bx):
    """Split the fetch box into API-sized tiles: (west, south, east, north) each."""
    s, n, w, e = bx['s'] - OSM_MARGIN, bx['n'] + OSM_MARGIN, bx['w'] - OSM_MARGIN, bx['e'] + OSM_MARGIN
    ny = max(1, math.ceil((n - s) / OSM_TILE)); nx = max(1, math.ceil((e - w) / OSM_TILE))
    return [(round(w + (e - w) * i / nx, 6), round(s + (n - s) * j / ny, 6), round(w + (e - w) * (i + 1) / nx, 6), round(s + (n - s) * (j + 1) / ny, 6))
            for j in range(ny) for i in range(nx)]


def merge_elements(parts):
    """Join API replies, keeping one copy of each node, way and relation, in a stable order."""
    seen = {}
    for els in parts:
        for e in els:
            seen.setdefault((e['type'], e['id']), e)
    order = {'node': 0, 'way': 1, 'relation': 2}
    return [seen[k] for k in sorted(seen, key=lambda k: (order.get(k[0], 3), k[1]))]


def fetch_osm(bx):
    tiles = osm_tiles(bx)
    bounds = {'minlat': bx['s'] - OSM_MARGIN, 'minlon': bx['w'] - OSM_MARGIN, 'maxlat': bx['n'] + OSM_MARGIN, 'maxlon': bx['e'] + OSM_MARGIN}
    try:
        parts = []
        for w, s, e, n in tiles:   # the API returns every node of any way that touches the tile, so tiles join cleanly
            parts.append(json.loads(get(f'https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}'))['elements'])
            time.sleep(1)          # be polite
        return {'version': '0.6', 'generator': 'tools/model/refresh.py (OSM API map calls, merged)', 'bounds': bounds,
                'elements': merge_elements(parts)}, f'OpenStreetMap API ({len(tiles)} tiles)'
    except Exception as ex:
        print(f'OSM API failed ({ex}); trying Overpass', file=sys.stderr)
    q = f'[out:json][timeout:180];(nwr({bounds["minlat"]},{bounds["minlon"]},{bounds["maxlat"]},{bounds["maxlon"]}););(._;>;);out body;'
    for mirror in ('https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'):
        try:
            d = json.loads(get(mirror, data=urllib.parse.urlencode({'data': q}).encode(), timeout=240, tries=2))
            return {'version': '0.6', 'generator': 'tools/model/refresh.py (Overpass)', 'bounds': bounds,
                    'elements': merge_elements([d['elements']])}, 'Overpass'
        except Exception as ex:
            print(f'{mirror} failed ({ex})', file=sys.stderr)
    raise RuntimeError('OpenStreetMap unreachable (API and Overpass)')


def to_geometry(raw):
    """The plain API extract (nodes + ways) -> the Overpass 'out geom' form prep.py reads as its first argument:
    ways with a geometry list, only those tagged as buildings, roads, rail, parks or amenities, sorted by id."""
    nodes = {e['id']: e for e in raw['elements'] if e['type'] == 'node'}
    out = []
    for e in raw['elements']:
        t = e.get('tags') or {}
        if e['type'] != 'way' or not any(k in t for k in GEOM_KINDS):
            continue
        pts = [nodes[n] for n in e.get('nodes', []) if n in nodes]
        if len(pts) < 2:
            continue
        geo = [{'lat': p['lat'], 'lon': p['lon']} for p in pts]
        out.append({'type': 'way', 'id': e['id'],
                    'bounds': {'minlat': min(p['lat'] for p in geo), 'minlon': min(p['lon'] for p in geo),
                               'maxlat': max(p['lat'] for p in geo), 'maxlon': max(p['lon'] for p in geo)},
                    'geometry': geo, 'tags': t})
    out.sort(key=lambda e: e['id'])
    return {'version': 0.6, 'generator': 'tools/model/refresh.py (OSM map call, Overpass-style out tags geom)', 'elements': out}


def buildings_in_box(geom, bx):
    """Mapped buildings whose middle is inside the model's box: the count a partial extract is caught by."""
    n = 0
    for e in geom['elements']:
        if 'building' not in e['tags']:
            continue
        g = e['geometry']
        la = sum(p['lat'] for p in g) / len(g); lo = sum(p['lon'] for p in g) / len(g)
        n += bx['s'] <= la <= bx['n'] and bx['w'] <= lo <= bx['e']
    return n


# ---------- four-weekly checks: each only reports ----------

def newest_date(catalog):
    """The newest flight date (YYYY-MM-DD) named in an ImageServer identify reply's catalog items, or None.
    NC OneMap names each image with its flight date at the end, e.g. OF6i0_37_000_10786402_20220209."""
    best = None
    today = dt.date.today().isoformat()
    for f in ((catalog or {}).get('catalogItems') or {}).get('features', []):
        for v in (f.get('attributes') or {}).values():
            if not isinstance(v, str):   # ids and sizes are numbers that can look like dates
                continue
            for m in re.finditer(r'(?<!\d)(20\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)', v):
                d = '-'.join(m.groups())
                if d <= today and (best is None or d > best):
                    best = d
    return best


def check_aerial(src, bx):
    if 'aerial_year' in src:
        catalog = json.loads(get(f'{COUNTY_IMAGERY}?f=json', timeout=60, tries=2))
        layers = [re.fullmatch(r'Imagery/(\d{4})_Orthos', item['name']) for item in catalog['services']
                  if item['type'] == 'ImageServer']
        year = max(int(layer[1]) for layer in layers if layer)
        base = src['aerial_year']
        if year > base:
            return (f'Guilford County lists {year} Orthos (model uses {base}). Verify downtown coverage and '
                    'acquisition metadata before refreshing the aerial-derived layers.'), None
        return None, f'newest Guilford County orthophoto layer {year}'
    q = urllib.parse.urlencode({'geometry': json.dumps({'x': (bx['w'] + bx['e']) / 2, 'y': (bx['n'] + bx['s']) / 2, 'spatialReference': {'wkid': 4326}}),
                                'geometryType': 'esriGeometryPoint', 'returnCatalogItems': 'true', 'returnGeometry': 'false', 'f': 'json'})
    when = newest_date(json.loads(get(f'{ORTHO_URL}/identify?{q}', timeout=60, tries=2)))
    if not when:
        return None, 'no flight date in the reply'
    base = src.get('aerial_date')
    if base and when > base:
        return (f'NC OneMap has a newer aerial (flown {when}; the model uses {base}). To use it, run ortho.py, roofs and '
                'ground.py again, then set aerial_date in data/model/sources.json.'), None
    if not base:
        src['aerial_date'] = when
    return None, f'newest flight {when}'


def check_mapillary(src, bx):
    tok = os.environ.get('MAPILLARY_TOKEN')
    if not tok:
        return None, 'skipped (no MAPILLARY_TOKEN)'
    q = urllib.parse.urlencode({'access_token': tok, 'fields': 'id,captured_at', 'bbox': f'{bx["w"]},{bx["s"]},{bx["e"]},{bx["n"]}', 'limit': 2000})
    d = json.loads(get(f'https://graph.mapillary.com/images?{q}', timeout=120))
    caps = [int(i['captured_at']) for i in d.get('data', []) if i.get('captured_at')]
    if not caps:
        return None, 'no photos returned'
    day = lambda c: dt.datetime.fromtimestamp(c / 1000, dt.timezone.utc).date().isoformat()
    newest = day(max(caps))
    prev = src.get('mapillary_newest')
    src['mapillary_newest'] = newest
    if prev and newest > prev:
        fresh = sum(1 for c in caps if day(c) > prev)
        return f'{fresh} new street photos since {prev} (newest {newest}); facades can be re-read from them.', None
    return None, f'newest photo {newest}'


def check_lidar(src, bx):
    q = urllib.parse.urlencode({'datasets': 'Lidar Point Cloud (LPC)', 'bbox': f'{bx["w"]},{bx["s"]},{bx["e"]},{bx["n"]}', 'max': 200, 'outputFormat': 'JSON'})
    d = json.loads(get(f'https://tnmaccess.nationalmap.gov/api/v1/products?{q}', timeout=120))
    projects = sorted({m.group(1) for it in d.get('items', []) for m in [re.search(r'Point Cloud\s+(\S+)', it.get('title', ''))] if m})
    prev = src.get('lidar_projects')
    src['lidar_projects'] = projects
    new = [p for p in projects if p not in (prev or [])]
    if prev is not None and new:
        return f'New lidar survey on USGS covering the model: {", ".join(new)}. Heights and shapes can be re-measured from it (tools/model/lidar_*.py).', None
    return None, f'{len(projects)} USGS lidar project(s) cover the model'


def check_overture(src, model, bx):
    xml = get('https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/').decode()
    rel = sorted(re.findall(r'<Prefix>release/([^/<]+)/</Prefix>', xml))
    if not rel:
        return None, 'no releases listed'
    latest = rel[-1]
    if src.get('overture_release') == latest:
        return None, f'release {latest} already checked'
    try:
        import pyarrow.dataset as ds, pyarrow.compute as pc, pyarrow.fs as pafs
        from shapely import wkb
        from shapely.geometry import Polygon
    except ImportError:
        return None, f'release {latest} (pyarrow/shapely not installed, not checked)'
    fs = pafs.S3FileSystem(anonymous=True, region='us-west-2', **({'proxy_options': os.environ['HTTPS_PROXY']} if os.environ.get('HTTPS_PROXY') else {}))
    base = f'overturemaps-us-west-2/release/{latest}/theme=buildings/type=building/'
    files = [f.path for f in fs.get_file_info(pafs.FileSelector(base))]
    flt = ((pc.field('bbox', 'xmin') > bx['w']) & (pc.field('bbox', 'xmax') < bx['e']) & (pc.field('bbox', 'ymin') > bx['s']) & (pc.field('bbox', 'ymax') < bx['n']))
    rows = ds.dataset(files, filesystem=fs, format='parquet').to_table(filter=flt, columns=['id', 'height', 'sources', 'geometry']).to_pylist()
    have = [Polygon(list(zip(b['p'][::2], b['p'][1::2]))).buffer(0) for b in model['B']]
    found = []
    for r in rows:
        if any((s or {}).get('dataset') == 'OpenStreetMap' for s in r['sources'] or []):
            continue
        g = wkb.loads(r['geometry'])
        if g.geom_type != 'Polygon':
            continue
        gg = Polygon([((x - bx['w']) * bx['kx'] / M, (bx['n'] - y) * bx['ky'] / M) for x, y in g.exterior.coords]).buffer(0)
        area = gg.area * M * M
        if area < MIN_AREA_M2 or any(gg.intersection(h).area > 0.3 * gg.area for h in have):
            continue
        c = g.centroid
        found.append((round(c.y, 5), round(c.x, 5), round(area)))
    seen = src.get('overture_seen') or []   # each candidate is reported once, not again with every release
    fresh = [f for f in found if not any(abs(f[0] - la) * bx['ky'] < 15 and abs(f[1] - lo) * bx['kx'] < 15 for la, lo in seen)]
    src['overture_release'] = latest
    src['overture_seen'] = [[f[0], f[1]] for f in found]
    if fresh:
        return (f'Overture {latest} has {len(fresh)} building(s) the model lacks' + (' that were not listed before' if seen else '') + ': '
                + '; '.join(f'{la:.5f},{lo:.5f} ({ar} m²)' for la, lo, ar in fresh[:12]) + ('; and more' if len(fresh) > 12 else '')
                + '. Check them against the aerial before adding.'), None
    return None, f'release {latest}: nothing new ({len(found)} building(s) already listed)' if found else f'release {latest}: no buildings missing from the model'


# ---------- comparing models ----------

def eff_height(b):
    return b.get('tb') or b.get('lh') or b.get('h') or ((b.get('l') or 0) * 3.6) or None


def area_m2(p):
    xs, ys = p[::2], p[1::2]
    a = 0.0
    for i in range(len(xs)):
        j = (i + 1) % len(xs)
        a += xs[i] * ys[j] - xs[j] * ys[i]
    return abs(a) / 2 * M * M


def canon(model):
    """The model as text that does not depend on the order features came in (the train's path is the one ordered list)."""
    out = {}
    for k, v in model.items():
        if k == 'X' and v:   # a crossing: x, y, and the streets that meet there
            v = [[e[0], e[1], sorted(e[2])] for e in v]
        out[k] = sorted(v, key=lambda x: json.dumps(x, sort_keys=True)) if isinstance(v, list) and k not in ('TRAIN',) else v
    return json.dumps(out, sort_keys=True)


def compare(old, new):
    ob = {b['id']: b for b in old.get('B', [])}
    nb = {b['id']: b for b in new.get('B', [])}
    big, small = [], []
    name = lambda b: b.get('n') or b.get('ad') or f'building {b["id"]}'
    for i in nb:
        if i not in ob:
            (big if area_m2(nb[i]['p']) >= MIN_AREA_M2 else small).append(f'New: {name(nb[i])} ({round(area_m2(nb[i]["p"]))} m²)')
    for i in ob:
        if i not in nb:
            (big if area_m2(ob[i]['p']) >= MIN_AREA_M2 else small).append(f'Gone: {name(ob[i])} ({round(area_m2(ob[i]["p"]))} m²)')
    reshaped = recoloured = 0
    for i in nb.keys() & ob.keys():
        a, b = ob[i], nb[i]
        ha, hb = eff_height(a), eff_height(b)
        if ha and hb and abs(ha - hb) > BIG_HEIGHT_M:
            big.append(f'Height: {name(b)} {round(ha)} m to {round(hb)} m')
        reshaped += a['p'] != b['p']
        recoloured += a.get('rc') != b.get('rc')
        if a.get('n') != b.get('n'):
            small.append(f'Renamed: {a.get("n") or "(no name)"} to {b.get("n") or "(no name)"}')
    if reshaped:
        small.append(f'{reshaped} building outline(s) adjusted')
    if recoloured:
        small.append(f'{recoloured} roof colour(s) changed')
    for k, label in (('R', 'street'), ('FW', 'footpath'), ('PK', 'park'), ('PL', 'parking lot'), ('RL', 'rail line'), ('SIG', 'signal and stop sign')):
        a, b = len(old.get(k) or []), len(new.get(k) or [])
        if a != b:
            small.append(f'{label} pieces: {a} to {b}')
    return big, small


# ---------- building ----------

def run_step(args):
    r = subprocess.run([sys.executable] + args, capture_output=True, text=True, timeout=STEP_TIMEOUT)
    if r.returncode:
        raise RuntimeError(f'{os.path.basename(args[0])} failed: {(r.stderr.strip().splitlines() or ["?"])[-1]}')


def keep_aerial_readings(made, cur):
    """details.py reads two things from the aerial, which is too big for git, so a rebuild here has neither:
    brick paving (BK) and which playgrounds have a rubber surface. Carry both over from the details file that is up now."""
    made['BK'] = cur.get('BK')
    rubber = {json.dumps(a['p']) for a in cur.get('A', []) if a.get('k') == 'play' and a.get('s')}
    for a in made.get('A', []):
        if a.get('k') == 'play' and json.dumps(a['p']) in rubber:
            a['s'] = 'rubber'
    return made


def keep_roof_colours(new, old):
    """prep.py reads the roof colour of each building the lidar found (and OpenStreetMap lacks) from the aerial image,
    which is too big for git. A rebuild here has no aerial, so those buildings keep the colour they have in the model
    that is up now, matched by outline (their ids are only positions in shapes.json). Returns how many were kept."""
    have = {json.dumps(b['p']): b['rc'] for b in old.get('B', []) if b.get('lidar_new') and b.get('rc')}
    n = 0
    for b in new.get('B', []):
        if b.get('lidar_new') and not b.get('rc') and json.dumps(b['p']) in have:
            b['rc'] = have[json.dumps(b['p'])]; n += 1
    return n


def build(old, src, monthly, outdir, osm_raw=None):
    """Rebuild into outdir (downtown.json, trees.json, details.json). Returns (report_lines, kind)."""
    bx = box_of(old)
    notices, notes = [], []
    tmp = tempfile.mkdtemp(prefix='model-refresh-')
    try:
        inp = os.path.join(tmp, 'in')
        shutil.copytree(INPUTS, inp)
        os.makedirs(os.path.join(inp, 'osm'), exist_ok=True)

        # 1. OpenStreetMap
        raw, how = (json.load(open(osm_raw)), 'saved extract') if osm_raw else fetch_osm(bx)
        geom = to_geometry(raw)
        nb = buildings_in_box(geom, bx)
        mapped = sum(1 for b in old['B'] if not b.get('lidar_new'))
        if nb < 0.8 * mapped:
            raise RuntimeError(f'only {nb} buildings came back from OpenStreetMap against {mapped} in the model; refusing a partial extract')
        json.dump(raw, open(os.path.join(inp, 'osm', 'downtown-raw.json'), 'w'))
        json.dump(geom, open(os.path.join(tmp, 'osm.json'), 'w'))
        notes.append(f'OpenStreetMap via {how}: {len(geom["elements"])} mapped features, {nb} buildings in the model\'s box.')

        # 1b. Street addresses for the buildings OpenStreetMap has none for: a fresh copy from the State, else the one in git
        kept = os.path.join(inp, 'addresses.json')
        have = json.load(open(kept)) if os.path.exists(kept) else {}
        try:
            sys.path.insert(0, HERE)
            import addresses
            fresh = addresses.fetch((bx['w'], bx['s'], bx['e'], bx['n']), get=lambda u: get(u, timeout=120, tries=2))
            if len(fresh['points']) < 0.8 * len(have.get('points', [])) or len(fresh['parcels']) < 0.8 * len(have.get('parcels', [])):
                raise RuntimeError(f'only {len(fresh["points"])} address points and {len(fresh["parcels"])} parcels came back')
            json.dump(fresh, open(kept, 'w'))
            notes.append(f'Street addresses from NC OneMap: {len(fresh["points"])} address points, {len(fresh["parcels"])} parcels.')
        except Exception as e:
            notes.append(f'Street addresses: NC OneMap did not answer ({e}); using the copy in git'
                         + (f' from {have["fetched"]}.' if have.get('fetched') else '.'))

        # 2. Four-weekly checks
        if monthly:
            for label, fn in (('Aerial', lambda: check_aerial(src, bx)), ('Street photos', lambda: check_mapillary(src, bx)),
                              ('Lidar', lambda: check_lidar(src, bx)), ('Overture', lambda: check_overture(src, old, bx))):
                try:
                    notice, note = fn()
                    if notice: notices.append(notice)
                    if note: notes.append(f'{label}: {note}.')
                except Exception as e:
                    notes.append(f'{label}: check failed ({e}).')
            src['monthly_checked'] = dt.date.today().isoformat()

        # 3. Rebuild: the model, then the trees and small details that are placed on it
        out = os.path.join(outdir, 'downtown.json')
        run_step([os.path.join(HERE, 'prep.py'), os.path.join(tmp, 'osm.json'), inp, out])
        new = json.load(open(out))
        if len(new.get('B', [])) < 0.8 * len(old.get('B', [])):
            raise RuntimeError(f'rebuilt model has {len(new.get("B", []))} buildings against {len(old.get("B", []))}; refusing it')
        if keep_roof_colours(new, old):
            with open(out, 'w') as fh:
                fh.write(json.dumps(new, separators=(',', ':')))
        if box_of(new) != bx:
            notes.append('The model\'s box changed in prep.py; trees and details were placed on the new one.')
        for tool, name in (('trees.py', 'trees.json'), ('details.py', 'details.json')):
            cur = os.path.join(PUB, name)
            dst = os.path.join(outdir, name)
            try:
                if not os.path.exists(os.path.join(HERE, tool)):
                    continue
                run_step([os.path.join(HERE, tool), inp, dst, out] if tool == 'trees.py' else [os.path.join(HERE, tool), inp, out, dst])
                made = json.load(open(dst))
                if name == 'details.json' and made.get('BK') is None and os.path.exists(cur):
                    keep_aerial_readings(made, json.load(open(cur)))
                    json.dump(made, open(dst, 'w'), separators=(',', ':'))
            except Exception as e:
                notes.append(f'{name} not rebuilt ({e}); the last one stays up.')
                if os.path.exists(dst):
                    os.remove(dst)

        # 4. Compare with the model that is up now
        big, small = compare(old, new)
        for name, label in (('trees.json', 'trees'), ('details.json', 'small details (benches, pools, fences and the like)')):
            a, b = os.path.join(PUB, name), os.path.join(outdir, name)
            if os.path.exists(a) and os.path.exists(b) and json.load(open(a)) != json.load(open(b)):
                small.append(f'{label} updated')
        if not big and not small and canon(new) != canon(old):
            small.append('small adjustments to streets, paths or ground')
        kind = 'big' if (big or notices) else 'small' if small else 'none'
        hs = os.path.join(INPUTS, 'osm', 'heights.json')
        survey = json.load(open(hs)).get('survey_date', '?') if os.path.exists(hs) else 'no heights file'
        lines = [f'## Model rebuilt {dt.date.today().isoformat()}: '
                 f'{"worth a look" if kind == "big" else "small changes" if kind == "small" else "no changes"}', '']
        if notices:
            lines += ['**New sources**', ''] + [f'- {n}' for n in notices] + ['']
        if big:
            lines += ['**Big changes** (live now)', ''] + [f'- {c}' for c in big[:60]] + ([f'- and {len(big) - 60} more'] if len(big) > 60 else []) + ['']
        if small:
            lines += ['**Small changes**', ''] + [f'- {c}' for c in small[:40]] + ([f'- and {len(small) - 40} more'] if len(small) > 40 else []) + ['']
        aerial = src.get('aerial_source') or f'aerial flown {src.get("aerial_date", "?")}'
        lines += ['**Checked**', ''] + [f'- {n}' for n in notes] + [f'- Heights and stepped shapes: lidar flown {survey}. Roof colours and ground: {aerial}.']
        return lines, kind
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def inputs_hash():
    """Changes when the model tools, the survey layers or the committed model change, so a merged change rebuilds at once."""
    h = hashlib.sha256()
    try:   # the model files as committed: a model rebuilt by hand and merged replaces the cached build too
        h.update(subprocess.run(['git', 'ls-tree', 'HEAD', 'public/model/'], cwd=ROOT, capture_output=True, timeout=30).stdout)
    except Exception:
        pass
    for base in (HERE, INPUTS):
        for d, dirs, files in sorted(os.walk(base)):
            dirs[:] = sorted(x for x in dirs if x != '__pycache__')
            for f in sorted(files):
                if f.endswith('.pyc') or (base == HERE and f.startswith('test_')):
                    continue
                fp = os.path.join(d, f)
                h.update(os.path.relpath(fp, ROOT).encode())
                with open(fp, 'rb') as fh:
                    h.update(fh.read())
    return h.hexdigest()[:16]


def summary(text):
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(text + '\n')


def cache_changed():
    """Tell the workflow the cached build changed, so it saves the cache only then."""
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as fh:
            fh.write('changed=true\n')


def publish(a):
    """Put the freshest good model into public/model/, rebuilding when it is a week old or the inputs changed."""
    cache = os.path.abspath(a.cache)
    os.makedirs(cache, exist_ok=True)
    meta_path = os.path.join(cache, 'built.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    now = dt.datetime.now(dt.timezone.utc)
    ih = inputs_hash()
    age = lambda k: (now - dt.datetime.fromisoformat(meta[k])).total_seconds() / 3600 if meta.get(k) else 1e9
    cached = meta.get('inputs') == ih and os.path.exists(os.path.join(cache, 'downtown.json'))

    def use_cached():   # a build made from other tools or survey layers than those in git now is never used
        if cached:
            for name in OUTPUTS:
                if os.path.exists(os.path.join(cache, name)):
                    shutil.copy(os.path.join(cache, name), os.path.join(PUB, name))

    fresh = cached and age('built_at') < MAX_AGE_DAYS * 24
    waiting = meta.get('failed_inputs') == ih and age('failed_at') < RETRY_HOURS
    if not a.force and (fresh or waiting):
        use_cached()
        print('Model: ' + (f'using the build from {meta["built_at"][:16]}.' if cached else 'using the one in git.')
              + ('' if fresh else ' The last rebuild failed; trying again later.'))
        return 0
    missing = [m for m in ('PIL', 'numpy', 'scipy', 'shapely') if importlib.util.find_spec(m) is None]
    if missing:
        use_cached()
        print(f'Model: rebuild due; needs {", ".join(missing)}.')
        return 10

    src_path = os.path.join(cache, 'sources.json')
    base = json.load(open(SOURCES)) if os.path.exists(SOURCES) else {}
    src = {k: v for k, v in base.items() if not k.startswith('$')}         # baselines from git, then what earlier runs saw
    src.update(json.load(open(src_path)) if os.path.exists(src_path) else {})
    for key in ('aerial_year', 'aerial_source', 'aerial_date'):
        src.pop(key, None)
        if key in base:
            src[key] = base[key]
    monthly = a.monthly or not src.get('monthly_checked') or \
        (dt.date.today() - dt.date.fromisoformat(src['monthly_checked'])).days >= MONTHLY_DAYS
    old = json.load(open(os.path.join(cache, 'downtown.json') if cached else MODEL))
    if cached:
        use_cached()   # so the comparison of trees and details is against what is up now
    out = tempfile.mkdtemp(prefix='model-out-')
    try:
        lines, kind = build(old, src, monthly, out, a.osm_raw)
    except Exception as e:
        meta['failed_at'] = now.isoformat(); meta['failed_inputs'] = ih
        json.dump(meta, open(meta_path, 'w'))
        shutil.rmtree(out, ignore_errors=True)
        cache_changed()
        summary(f'## Model not rebuilt\n\n{e}\n\nThe last good model stays up; the next try is in {RETRY_HOURS} hours.')
        return 0
    for name in OUTPUTS:
        if os.path.exists(os.path.join(out, name)):
            shutil.copy(os.path.join(out, name), os.path.join(PUB, name))
        shutil.copy(os.path.join(PUB, name), os.path.join(cache, name))
    shutil.rmtree(out, ignore_errors=True)
    json.dump(src, open(src_path, 'w'), indent=1, sort_keys=True)
    json.dump({'built_at': now.isoformat(), 'inputs': ih, 'kind': kind}, open(meta_path, 'w'))
    cache_changed()
    summary('\n'.join(lines) + '\n')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--publish', action='store_true')
    ap.add_argument('--cache', default=os.path.join(ROOT, 'data', 'model-build'))
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--monthly', action='store_true')
    ap.add_argument('--report')
    ap.add_argument('--osm-raw')
    a = ap.parse_args()
    if a.publish:
        sys.exit(publish(a))
    src = {k: v for k, v in (json.load(open(SOURCES)) if os.path.exists(SOURCES) else {}).items() if not k.startswith('$')}
    out = tempfile.mkdtemp(prefix='model-out-')
    try:
        lines, kind = build(json.load(open(MODEL)), src, a.monthly, out, a.osm_raw)
        report = '\n'.join(lines) + '\n'
        print(report)
        if a.report:
            open(a.report, 'w').write(report)
        if not a.dry_run:
            for name in OUTPUTS:
                if os.path.exists(os.path.join(out, name)):
                    shutil.copy(os.path.join(out, name), os.path.join(PUB, name))
    finally:
        shutil.rmtree(out, ignore_errors=True)


if __name__ == '__main__':
    main()
