"""Build public/model/details.json: the small real things the downtown model's streets and buildings leave out.

Usage: python3 tools/model/details.py [inputs-dir] [model.json] [out.json] [--aerial image.jpg]
       python3 tools/model/details.py find-pools [inputs-dir] [model.json] [--aerial image.jpg]

Reads <inputs-dir>/osm/downtown-raw.json (the OpenStreetMap extract with all tags), data/model/details-extra.json (things
OpenStreetMap does not have, checked by eye against the aerial, in longitude and latitude) and, for brick paving inside
parks and plazas, the --aerial image and its JSON sidecar (defaults to <inputs-dir>/imagery/ortho-downtown-15cm.jpg).
The model's bounds are read from the model file itself
(public/model/downtown.json, GEO), so when the model grows this only needs running again, after prep.py.

Writes, in the model's grid units (one unit = 9 m, x east, y south, from the north-west corner):
  A  areas:  pool, fountain, court, turf, play, sand, dogpark, platform, brick, pavers, seating, balcony, lawn;
             `b` = the building a rooftop feature belongs to
  L  lines:  fence, wall, stream, brickpath
  P  points: [kind, x, y, extra]: bench, table, art, memorial, flag, busstop, hydrant, bin, bike, postbox, fountain, play,
             gate, tower (water tower), bookcase, bbq
  D  ball diamonds: home plate, the unit direction to centre field, and the outfield outline
  BK brick paving read from the aerial inside parks and pedestrian areas: run-length rows, 1.5 m cells
"""
import argparse, json, math, os, sys
from pathlib import Path
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..', '..')
args = sys.argv[1:]; FIND = bool(args) and args[0] == 'find-pools'
if FIND: args = args[1:]
parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('inputs', nargs='?', default='/mnt/project-files/village')
parser.add_argument('model', nargs='?', default=os.path.join(ROOT, 'public', 'model', 'downtown.json'))
parser.add_argument('out', nargs='?', default=os.path.join(ROOT, 'public', 'model', 'details.json'))
parser.add_argument('--aerial', type=Path)
args = parser.parse_args(args)
INP = args.inputs.rstrip('/') + '/'; MODEL = args.model; OUT = args.out
AERIAL = args.aerial or Path(INP + 'imagery/ortho-downtown-15cm.jpg')
EXTRA = os.path.join(ROOT, 'data', 'model', 'details-extra.json')
MAP = json.load(open(MODEL)); G = MAP['GEO']; M = MAP['M']; GX, GY = MAP['GX'], MAP['GY']
KX, KY = G['mPerDegLon'], G['mPerDegLat']
def g(lon, lat): return ((lon - G['west']) * KX / M, (G['north'] - lat) * KY / M)
def ll(x, y): return (G['west'] + x * M / KX, G['north'] - y * M / KY)
def inreg(x, y, m=0): return -m <= x <= GX + m and -m <= y <= GY + m
def flat(pts): return [round(v, 2) for p in pts for v in p]
def pip(x, y, q):
    ins = False; n = len(q)
    for i in range(n):
        (xi, yi), (xj, yj) = q[i], q[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: ins = not ins
    return ins
def centre(pts): return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
def area(pts): return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2 * M * M
BLD = [(b['id'], [(b['p'][i], b['p'][i + 1]) for i in range(0, len(b['p']), 2)]) for b in MAP['B']]
BB = [(min(p[0] for p in q), min(p[1] for p in q), max(p[0] for p in q), max(p[1] for p in q)) for _, q in BLD]
def building_at(x, y):
    for (bid, q), bb in zip(BLD, BB):
        if bb[0] <= x <= bb[2] and bb[1] <= y <= bb[3] and pip(x, y, q): return bid
    return None

# ---------------------------------------------------------------- pool-coloured patches in the aerial
def aerial():
    import numpy as np
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    with AERIAL.with_suffix('.json').open() as sidecar:
        provenance = json.load(sidecar)
    meta = provenance['bounds']
    if not FIND and args.aerial and not (meta['west'] <= G['west'] < G['east'] <= meta['east']
                                         and meta['south'] <= G['south'] < G['north'] <= meta['north']):
        raise ValueError('The aerial does not cover the model bounds')
    with Image.open(AERIAL) as image:
        if 'size' in provenance and tuple(provenance['size']) != image.size:
            raise ValueError('The aerial image dimensions do not match its sidecar')
        im = np.asarray(image if image.mode == 'RGB' else image.convert('RGB'))
    H, W = im.shape[:2]
    def px(x, y):            # grid -> image pixel
        lon, lat = ll(x, y); return ((lon - meta['west']) / (meta['east'] - meta['west']) * W, (meta['north'] - lat) / (meta['north'] - meta['south']) * H)
    def gr(i, j):            # image pixel -> grid
        return g(meta['west'] + i / W * (meta['east'] - meta['west']), meta['north'] - j / H * (meta['north'] - meta['south']))
    return dict(im=im, H=H, W=W, px=px, gr=gr, mpp=(meta['north'] - meta['south']) * KY / H)

if FIND:
    import numpy as np
    from scipy import ndimage as ndi
    A = aerial(); im = A.pop('im').astype(np.float32) / 255
    r, gg, b = im[..., 0], im[..., 1], im[..., 2]; mx = im.max(-1); mn = im.min(-1); d = mx - mn + 1e-6
    hue = np.where(mx == r, ((gg - b) / d) % 6, np.where(mx == gg, (b - r) / d + 2, (r - gg) / d + 4)) * 60
    sat = (mx - mn) / (mx + 1e-6)
    m = (hue > 160) & (hue < 197) & (sat > .22) & (mx > .5)
    m = ndi.binary_opening(m, iterations=2); lab, n = ndi.label(m)
    for i, s in enumerate(ndi.find_objects(lab)):
        blob = lab[s] == i + 1; a = blob.sum() * A['mpp'] ** 2
        if a < 10: continue
        ys, xs = np.nonzero(blob); cx, cy = xs.mean() + s[1].start, ys.mean() + s[0].start
        ring = []
        for k in range(20):          # outline: the farthest pool pixel along each of 20 rays from the middle
            t = k * math.pi / 10; rr = 0
            for q in range(1, 400):
                x, y = int(round(cx + math.cos(t) * q)) - s[1].start, int(round(cy + math.sin(t) * q)) - s[0].start
                if 0 <= x < blob.shape[1] and 0 <= y < blob.shape[0] and blob[y, x]: rr = q
                elif q > rr + 4: break
            ring.append(ll(*A['gr'](cx + math.cos(t) * (rr + 1), cy + math.sin(t) * (rr + 1))))
        gx, gy = A['gr'](cx, cy)
        print(json.dumps({'grid': [round(gx, 1), round(gy, 1)], 'm2': round(a), 'hue': round(float(hue[s][blob].mean())),
                          'sat': round(float(sat[s][blob].mean()), 2), 'll': [[round(p[0], 6), round(p[1], 6)] for p in ring]}))
    sys.exit()

# ---------------------------------------------------------------- OpenStreetMap
raw = json.load(open(INP + 'osm/downtown-raw.json'))['elements']
NODE = {e['id']: e for e in raw if e['type'] == 'node'}
def way_pts(e):
    if e.get('geometry'): return [g(p['lon'], p['lat']) for p in e['geometry']]
    return [g(NODE[i]['lon'], NODE[i]['lat']) for i in e.get('nodes', []) if i in NODE]
A_, L_, P_, D_ = [], [], [], []
PT_KIND = {('amenity', 'bench'): 'bench', ('leisure', 'picnic_table'): 'table', ('tourism', 'artwork'): 'art', ('historic', 'memorial'): 'memorial',
           ('man_made', 'flagpole'): 'flag', ('highway', 'bus_stop'): 'busstop', ('emergency', 'fire_hydrant'): 'hydrant',
           ('amenity', 'waste_basket'): 'bin', ('amenity', 'bicycle_parking'): 'bike', ('amenity', 'post_box'): 'postbox',
           ('amenity', 'fountain'): 'fountain', ('barrier', 'lift_gate'): 'gate', ('man_made', 'water_tower'): 'tower',
           ('amenity', 'public_bookcase'): 'bookcase', ('amenity', 'bbq'): 'bbq', ('leisure', 'firepit'): 'bbq'}
BRICK = ('bricks', 'brick', 'sett', 'cobblestone'); PAVER = ('paving_stones',)
pool_nodes = []
for e in raw:
    t = e.get('tags') or {}
    if not t: continue
    if e['type'] == 'node':
        x, y = g(e['lon'], e['lat'])
        if not inreg(x, y, -.15): continue
        if t.get('leisure') == 'swimming_pool': pool_nodes.append((x, y)); continue
        kind = next((v for (k, val), v in PT_KIND.items() if t.get(k) == val), None)
        if 'playground' in t or (t.get('leisure') == 'pitch' and t.get('sport') in ('table_tennis', 'gaga')): kind = 'play'
        if not kind: continue
        if kind == 'tower' and e['id'] == 4154138087:  # NOAA 2015 lidar, centre of the tank's circular rim
            x, y = g(-79.7845892, 36.0675079)
        if kind != 'tower' and building_at(x, y): continue          # indoors, or on a roof where it would not be seen
        extra = t.get('direction', '')
        if kind == 'play': extra = t.get('playground') or t.get('sport') or ''
        try: extra = float(extra) if kind == 'bench' else extra
        except ValueError: extra = ''
        P_.append([kind, round(x, 2), round(y, 2), extra])
    elif e['type'] == 'way':
        pts = way_pts(e)
        if len(pts) < 2: continue
        closed = len(pts) > 3 and pts[0] == pts[-1]
        cx, cy = centre(pts)
        if closed:
            if not inreg(cx, cy, 1): continue
            q = pts[:-1]; kind = None; rec = {}
            if t.get('leisure') == 'swimming_pool': kind = 'pool'
            elif t.get('amenity') == 'fountain': kind = 'fountain'
            elif t.get('leisure') == 'pitch':
                sp = t.get('sport', '')
                if sp == 'baseball': continue                        # the diamond comes from details-extra.json
                kind = 'court' if sp in ('basketball', 'tennis', 'pickleball', 'multi', 'volleyball') or t.get('surface') in ('asphalt', 'concrete', 'acrylic') else 'turf'
                rec['s'] = sp
            elif t.get('leisure') == 'playground': kind = 'play'
            elif t.get('playground') == 'sandpit': kind = 'sand'
            elif t.get('leisure') == 'dog_park': kind = 'dogpark'
            elif t.get('railway') == 'platform': kind = 'platform'
            elif t.get('leisure') == 'outdoor_seating': kind = 'seating'
            elif (t.get('highway') in ('pedestrian', 'footway') or t.get('place') == 'square') and t.get('surface') in BRICK: kind = 'brick'
            elif (t.get('highway') in ('pedestrian', 'footway') or t.get('place') == 'square') and t.get('surface') in PAVER: kind = 'pavers'
            elif t.get('playground') in ('slide', 'structure', 'climbingframe'):
                P_.append(['play', round(cx, 2), round(cy, 2), t['playground']]); continue
            if kind:
                b = building_at(cx, cy)
                if b and kind not in ('pool', 'court'): continue     # under a roof
                if b: rec['b'] = b
                A_.append({'k': kind, 'p': flat(q), **rec}); continue
        if not any(inreg(x, y) for x, y in pts): continue
        if t.get('barrier') in ('fence', 'wall', 'retaining_wall', 'hedge'):
            L_.append({'k': 'fence' if t['barrier'] in ('fence', 'hedge') else 'wall', 'p': flat(pts)})
        elif t.get('waterway') in ('stream', 'river', 'ditch') and t.get('tunnel') not in ('culvert', 'yes'):
            L_.append({'k': 'stream', 'p': flat(pts)})
        elif t.get('highway') in ('footway', 'path', 'pedestrian') and t.get('surface') in BRICK and not closed:
            L_.append({'k': 'brickpath', 'p': flat(pts)})

# ---------------------------------------------------------------- things checked by eye (longitude, latitude)
if os.path.exists(EXTRA):
    X = json.load(open(EXTRA))
    for a in X.get('areas', []):
        q = [g(*p) for p in a['ll']]; cx, cy = centre(q)
        if not inreg(cx, cy): continue
        rec = {'k': a['k'], 'p': flat(q)}
        if a.get('s'): rec['s'] = a['s']
        b = a.get('building') or building_at(cx, cy)
        if b: rec['b'] = b
        A_.append(rec)
    for d in X.get('diamonds', []):
        h = g(*d['home']); md = g(*d['mound']); L = math.hypot(md[0] - h[0], md[1] - h[1])
        if not inreg(*h, 6): continue
        D_.append({'h': [round(h[0], 2), round(h[1], 2)], 'd': [round((md[0] - h[0]) / L, 4), round((md[1] - h[1]) / L, 4)],
                   'p': flat([g(*p) for p in d['field']])})
    for p in X.get('points', []):
        x, y = g(*p['ll'])
        if inreg(x, y, -.15): P_.append([p['k'], round(x, 2), round(y, 2), p.get('x', '')])
# a pool mapped only as a point is drawn when the aerial gave no outline for it: a plain 5 x 10 m pool
pools = [centre([(a['p'][i], a['p'][i + 1]) for i in range(0, len(a['p']), 2)]) for a in A_ if a['k'] == 'pool']
for x, y in pool_nodes:
    if any(math.hypot(x - px, y - py) < 25 / M for px, py in pools): continue
    A_.append({'k': 'pool', 'p': flat([(x - .55, y - .28), (x + .55, y - .28), (x + .55, y + .28), (x - .55, y + .28)])})

# ---------------------------------------------------------------- brick paving inside parks and pedestrian areas, from the aerial
BK = None
try:
    import numpy as np
    from PIL import Image, ImageDraw
    AER = aerial()
except Exception as ex:
    if args.aerial:
        raise
    AER = None; print('no aerial, so no brick paving read from it:', ex)
if AER:
    R = 6; gw, gh = int(math.ceil(GX * R)), int(math.ceil(GY * R))
    zone = Image.new('L', (gw, gh), 0); dz = ImageDraw.Draw(zone)
    for e in raw:
        t = e.get('tags') or {}
        if e['type'] != 'way': continue
        if t.get('leisure') in ('park', 'garden') or (t.get('highway') == 'pedestrian' and (t.get('area') == 'yes' or e['nodes'][0] == e['nodes'][-1])) or t.get('place') == 'square':
            pts = way_pts(e)
            if len(pts) > 3 and pts[0] == pts[-1]: dz.polygon([(x * R, y * R) for x, y in pts], fill=1)
    for _, q in BLD: dz.polygon([(x * R, y * R) for x, y in q], fill=0)
    zone = np.asarray(zone).astype(bool)
    # mean colour of each 1.5 m cell
    ix = np.clip(np.round([AER['px']((i + .5) / R, 0)[0] for i in range(gw)]).astype(int), 0, AER['W'] - 1)
    iy = np.clip(np.round([AER['px'](0, (j + .5) / R)[1] for j in range(gh)]).astype(int), 0, AER['H'] - 1)
    k = max(1, int(round(.75 / AER['mpp'])))
    acc = np.zeros((gh, gw, 3), np.float32); n = 0
    for dy in (-k, 0, k):
        for dx in (-k, 0, k):
            ys = np.clip(iy + dy, 0, AER['H'] - 1)
            xs = np.clip(ix + dx, 0, AER['W'] - 1)
            acc += AER['im'][ys[:, None], xs].astype(np.float32) / 255
            n += 1
    acc /= n; r, gg, b = acc[..., 0], acc[..., 1], acc[..., 2]; mx = acc.max(-1); mn = acc.min(-1)
    sat = (mx - mn) / (mx + 1e-6); lum = acc @ np.array([.3, .59, .11], np.float32)
    # brick pavers: salmon to red-brown (red well over green), mid-bright; dormant lawn is yellower, mulch darker
    brick = zone & (r - gg > .06) & (r - b > .14) & ((r - gg) > .7 * (gg - b)) & (sat > .2) & (lum > .33) & (lum < .8)
    from scipy import ndimage as ndi
    brick = ndi.binary_opening(brick, iterations=1); brick = ndi.binary_closing(brick, iterations=1) & zone
    lab, nl = ndi.label(brick); sizes = ndi.sum(brick, lab, range(1, nl + 1))
    brick = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s * 2.25 >= 40])
    rows = []
    for j in range(gh):
        row = brick[j]; out = []; i = 0
        while i < gw:
            v = row[i]; i0 = i
            while i < gw and row[i] == v: i += 1
            out.append(format(i - i0, 'x'))
        rows.append(','.join(out) if row.any() else '')
    BK = {'r': R, 'w': gw, 'h': gh, 'rows': rows}
    # Blue rubber can cover only part of a playground that also has turf or equipment.
    for a in A_:
        if a['k'] != 'play': continue
        m = Image.new('L', (gw, gh), 0); ImageDraw.Draw(m).polygon([(a['p'][i] * R, a['p'][i + 1] * R) for i in range(0, len(a['p']), 2)], fill=1)
        m = np.asarray(m).astype(bool)
        if m.sum() and ((b - r > .02) & (b > gg) & m).sum() > .10 * m.sum(): a['s'] = 'rubber'
    print('brick paving from the aerial:', int(brick.sum() * 2.25), 'm2')

json.dump({'A': A_, 'L': L_, 'P': P_, 'D': D_, 'BK': BK}, open(OUT, 'w'), separators=(',', ':'))
from collections import Counter
print(len(A_), 'areas', dict(Counter(a['k'] for a in A_)), '|', len(L_), 'lines', dict(Counter(l['k'] for l in L_)), '|', len(P_), 'points',
      dict(Counter(p[0] for p in P_)), '|', len(D_), 'diamonds', '|', os.path.getsize(OUT), 'bytes')
