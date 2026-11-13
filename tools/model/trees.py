"""Build public/model/trees.json: every tree in the downtown model, where it really stands, how tall and wide
it is, and whether it keeps its leaves in winter. Two steps:

1. Once per lidar survey (heavy, ~280 MB download):
     python3 tools/model/trees.py lidar <lidar-dir> <ortho-15cm.jpg> <out: data/model/osm/trees-lidar.json>
   lidar-dir holds the NC 2015 Phase III tiles for downtown (NOAA Digital Coast dataset 6209, GuilfordCoNC,
   20150203_LA_37_1078640{1,2,3,4}.copc.laz on the public noaa-nos-coastal-lidar-pds S3 bucket). Vegetation
   returns (classes 3-5) minus ground give a canopy height model; each crown is a local high point of it, its
   width from the canopy around it. False "trees" (vegetation-classed returns on parking decks and roofs, a few
   stray returns) are dropped, and so are crowns that are a bright flat roof or slab in the February 2024
   NC OneMap aerial. A crown still green in that leaf-off aerial, or dark and so dense that almost no pulses
   reached the ground, is an evergreen. Output: a small committed file of crowns.

2. Every model refresh (cheap): python3 tools/model/trees.py <inputs-dir> [out.json]
   Reads <inputs-dir>/osm/trees-lidar.json and <inputs-dir>/osm/downtown-raw.json (OpenStreetMap). Crowns now
   under a building are dropped; OSM natural=tree nodes the lidar does not show (planted since 2015, such as
   LeBauer Park's) are added as young trees; man_made=flagpole nodes become flags.

Species: no public inventory of downtown Greensboro's trees exists (the City has only neighbourhood studies),
so each tree gets a species typical of Piedmont NC plantings for what we do know about it: evergreen or not,
height, crown width, and whether it stands along a street or in a park or yard. The choice is stable per tree.
"""
import json, math, sys, glob
import numpy as np
from PIL import Image, ImageDraw

LIDAR = len(sys.argv) > 1 and sys.argv[1] == 'lidar'
if LIDAR:
    lazdir, ortho, LOUT = sys.argv[2:5]
else:
    INP = sys.argv[1].rstrip('/') + '/'
    OUT = sys.argv[2] if len(sys.argv) > 2 else __file__.rsplit('/', 3)[0] + '/public/model/trees.json'
    osm_raw = INP + 'osm/downtown-raw.json'

N, S, Wl, El = 36.0768, 36.0676, -79.7954, -79.7856
M = 9.0
k = math.cos(math.radians((N + S) / 2)) * 111320
GX = (El - Wl) * k / M; GY = (N - S) * 110574 / M
R = 9  # cells per model unit (1 m)
gw, gh = int(math.ceil(GX * R)), int(math.ceil(GY * R))
def gxy(lon, lat): return ((lon - Wl) * k / M, (N - lat) * 110574 / M)


def lidar_step():
    import laspy, pyproj
    from scipy import ndimage
    tr = pyproj.Transformer.from_crs(6346, 4326, always_xy=True)
    # ---- canopy height model, 1 m cells in model grid space ----
    gmin = np.full((gh, gw), 1e9, np.float32); vmax = np.full((gh, gw), -1e9, np.float32); bmax = np.full((gh, gw), -1e9, np.float32)
    vcnt = np.zeros((gh, gw), np.int32); gcnt = np.zeros((gh, gw), np.int32)
    files = sorted(glob.glob(lazdir + '/*.laz'))
    if not files: sys.exit('no .laz tiles in ' + lazdir)
    for f in files:
        with laspy.open(f) as fh:
            for ch in fh.chunk_iterator(5_000_000):
                c = np.asarray(ch.classification)
                keep = np.isin(c, [1, 2, 3, 4, 5, 6, 17, 18])
                if not keep.any(): continue
                x = np.asarray(ch.x)[keep]; y = np.asarray(ch.y)[keep]; z = np.asarray(ch.z, np.float32)[keep]; c = c[keep]
                lon, lat = tr.transform(x, y)
                i = ((lon - Wl) * k / M * R).astype(np.int64); j = ((N - lat) * 110574 / M * R).astype(np.int64)
                ok = (i >= 0) & (i < gw) & (j >= 0) & (j < gh)
                i, j, z, c = i[ok], j[ok], z[ok], c[ok]
                g = np.isin(c, [2, 18]); v = np.isin(c, [3, 4, 5]); b = np.isin(c, [1, 6, 17])
                np.minimum.at(gmin, (j[g], i[g]), z[g]); np.maximum.at(vmax, (j[v], i[v]), z[v]); np.maximum.at(bmax, (j[b], i[b]), z[b])
                np.add.at(vcnt, (j[v], i[v]), 1); np.add.at(gcnt, (j[g], i[g]), 1)
        print('read', f, flush=True)
    known = gmin < 1e8  # ground under buildings: the nearest known ground
    idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
    dtm = gmin[tuple(idx)]
    chm = np.where(vmax > -1e8, vmax - dtm, 0).astype(np.float32)
    chm[chm > 45] = 0  # birds, wires
    # structures: cells with building or unclassified returns well above the ground (parking decks are often
    # unclassified), grown by 2 m so roof edges that were classed as vegetation go too
    struct = ndimage.binary_dilation((bmax > -1e8) & (bmax - dtm > 2.5), iterations=2)
    chm[struct] = 0
    chm_s = ndimage.gaussian_filter(ndimage.grey_closing(chm, size=3), 1.0)
    # ---- crowns: local high points, skipping peaks inside a taller neighbour's crown ----
    can = chm_s > 3.0
    peak = (chm_s == ndimage.maximum_filter(chm_s, size=7)) & can & (chm_s > 4.0)
    pj, pi = np.nonzero(peak); hs = chm_s[pj, pi]
    crowns = []
    for o in np.argsort(-hs):
        j, i = pj[o], pi[o]; h = float(hs[o])
        if any((c['j'] - j) ** 2 + (c['i'] - i) ** 2 < (max(3.0, c['h'] * 0.22)) ** 2 for c in crowns[-400:]): continue
        crowns.append({'i': int(i), 'j': int(j), 'h': h})
    vc = ndimage.uniform_filter(vcnt.astype(np.float32), size=5) * 25  # returns within ~2.5 m
    gc = ndimage.uniform_filter(gcnt.astype(np.float32), size=5) * 25
    for c in crowns:
        c['n'] = float(vc[c['j'], c['i']]); c['pen'] = float(gc[c['j'], c['i']] / (gc[c['j'], c['i']] + vc[c['j'], c['i']] + 1e-6))
    # crown radius: canopy cells belong to the nearest crown (within 10 m)
    lab = np.zeros(chm.shape, np.int32)
    for n, c in enumerate(crowns, 1): lab[c['j'], c['i']] = n
    dist, (ij, ii) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
    owner = lab[ij, ii]; owner[(~can) | (dist > 10)] = 0
    area = np.bincount(owner.ravel(), minlength=len(crowns) + 1)
    for n, c in enumerate(crowns, 1):
        c['r'] = float(np.clip(math.sqrt(area[n] / math.pi), 1.5, 0.45 * c['h'] + 2))
        c['gx'] = (c['i'] + .5) / R; c['gy'] = (c['j'] + .5) / R
    # ---- check each crown against the February 2024 aerial ----
    Image.MAX_IMAGE_PIXELS = None
    A = np.asarray(Image.open(ortho).convert('RGB')).astype(np.float32) / 255
    OH, OW = A.shape[:2]; Lum = A.mean(-1)
    def patch(t, f, lo):
        lon = Wl + t['gx'] * M / k; lat = N - t['gy'] * M / 110574
        px = (lon - Wl) / (El - Wl) * OW; py = (N - lat) / (N - S) * OH
        rr = max(lo, int(t['r'] * f / 0.15))
        x0, x1, y0, y1 = int(px - rr), int(px + rr), int(py - rr), int(py + rr)
        if x0 < 0 or y0 < 0 or x1 > OW or y1 > OH: return None
        return slice(y0, y1), slice(x0, x1)
    dropped = {'sparse': 0, 'roof_or_paving_2024': 0}
    out = []
    for t in crowns:
        # a handful of vegetation returns is a wire, a sign or a roof unit, not a tree
        if t['n'] < 15: dropped['sparse'] += 1; continue
        # mostly bright, flat surface in 2024: a new roof or fresh concrete where a tree stood in 2015
        s = patch(t, 0.5, 6)
        if s and (Lum[s] > 0.8).mean() > 0.5: dropped['roof_or_paving_2024'] += 1; continue
        # evergreen: green in February, or a dark crown that let almost no pulses reach the ground in February
        g = patch(t, 0.7, 4); gf = 0.0
        if g:
            a = A[g]; r_, g_, b_ = a[..., 0], a[..., 1], a[..., 2]
            mx = a.max(-1); mn = a.min(-1); sat = (mx - mn) / (mx + 1e-6)
            gf = float(((g_ > r_ + 0.01) & (g_ > b_ + 0.02) & (sat > 0.14) & (mx < 0.55) & (mx > 0.08)).mean())
        dark = s is not None and float(Lum[s].mean()) < 0.3
        ever = gf > 0.25 or (t['pen'] < 0.1 and dark)
        out.append([round(t['gx'], 2), round(t['gy'], 2), round(t['h'], 1), round(t['r'], 1), 1 if ever else 0])
    json.dump({'about': 'Tree crowns from NC 2015 Phase III lidar (NOAA Digital Coast dataset 6209, flown 2015-02-03), checked against the 2024-02-03 NC OneMap aerial. gx, gy in model grid units (9 m), h and r in metres, ever = evergreen.',
               'cols': ['gx', 'gy', 'h', 'r', 'ever'], 'C': out}, open(LOUT, 'w'), separators=(',', ':'))
    print(len(out), 'crowns;', dropped)


def merge_step():
    crowns = json.load(open(INP + 'osm/trees-lidar.json'))['C']
    els = json.load(open(osm_raw))['elements']
    nodes = {e['id']: e for e in els if e['type'] == 'node'}
    osm_trees = [(gxy(e['lon'], e['lat']), e.get('tags', {})) for e in els if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'tree']
    flags = [dict(zip(('gx', 'gy'), [round(v, 2) for v in gxy(e['lon'], e['lat'])]), h=e.get('tags', {}).get('height')) for e in els if e['type'] == 'node' and e.get('tags', {}).get('man_made') == 'flagpole']
    bmask = Image.new('L', (gw, gh), 0); dr = ImageDraw.Draw(bmask)
    streets = Image.new('L', (gw, gh), 0); ds = ImageDraw.Draw(streets)
    parks = Image.new('L', (gw, gh), 0); dp = ImageDraw.Draw(parks)
    for e in els:
        if e['type'] != 'way': continue
        t = e.get('tags', {})
        pts = [gxy(nodes[n]['lon'], nodes[n]['lat']) for n in e.get('nodes', []) if n in nodes]
        if len(pts) < 2: continue
        px = [(x * R, y * R) for x, y in pts]
        if 'building' in t and len(px) >= 3: dr.polygon(px, fill=255)
        if t.get('highway') in ('primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'primary_link', 'secondary_link', 'tertiary_link'):
            ds.line(px, fill=255, width=26)  # within ~13 m of a street's centre line: sidewalk and verge
        if (t.get('leisure') in ('park', 'garden', 'playground') or t.get('landuse') in ('grass', 'recreation_ground', 'cemetery') or t.get('natural') in ('wood', 'scrub')) and len(px) >= 3:
            dp.polygon(px, fill=255)
    bm = np.asarray(bmask) > 0; st = np.asarray(streets) > 0; pk = np.asarray(parks) > 0
    cell = lambda gx, gy: (min(gh - 1, max(0, int(gy * R))), min(gw - 1, max(0, int(gx * R))))

    trees = []; under = 0
    for gx, gy, h, r, ever in crowns:
        if bm[cell(gx, gy)]: under += 1; continue  # a building stands there now
        trees.append({'gx': gx, 'gy': gy, 'h': h, 'r': r, 'ever': bool(ever), 'src': 'lidar'})
    added = 0
    for (gx, gy), tg in osm_trees:
        if not (0 < gx < GX and 0 < gy < GY): continue
        if any((t['gx'] - gx) ** 2 + (t['gy'] - gy) ** 2 < (max(3.5, t['r']) / M) ** 2 for t in trees): continue
        trees.append({'gx': gx, 'gy': gy, 'h': 5.0, 'r': 1.8, 'ever': tg.get('leaf_cycle') == 'evergreen' or tg.get('leaf_type') == 'needleleaved', 'src': 'osm'}); added += 1

    def hsh(a, b):
        s = math.sin(a * 12.9898 + b * 78.233) * 43758.5453
        return s - math.floor(s)
    for t in trees:
        ctx = 'park' if pk[cell(t['gx'], t['gy'])] else 'street' if st[cell(t['gx'], t['gy'])] else 'yard'
        u = hsh(t['gx'], t['gy']); h = t['h']; r = t['r']
        if t['ever']:
            if h >= 12 and r < h * 0.38: sp = 'loblolly'
            elif h >= 7: sp = 'magnolia' if u < .6 else 'loblolly'
            else: sp = 'cedar' if u < .5 else 'holly'
        elif ctx == 'street':
            if t['src'] == 'osm' or h < 6: sp = ['crape', 'crape', 'zelkova', 'redmaple', 'pear'][int(u * 5)]
            elif h < 12: sp = ['zelkova', 'redmaple', 'willowoak', 'willowoak', 'pear'][int(u * 5)]
            else: sp = ['willowoak', 'willowoak', 'willowoak', 'redmaple', 'zelkova'][int(u * 5)]
        else:
            if h < 6: sp = ['dogwood', 'redbud', 'crape', 'dogwood', 'redmaple'][int(u * 5)]
            elif h < 14: sp = ['redmaple', 'willowoak', 'sweetgum', 'riverbirch', 'dogwood'][int(u * 5)]
            elif h < 22: sp = ['willowoak', 'redmaple', 'sweetgum', 'tulip', 'willowoak'][int(u * 5)]
            else: sp = ['tulip', 'willowoak', 'willowoak', 'whiteoak', 'tulip'][int(u * 5)]
        t['sp'] = sp
    trees.sort(key=lambda t: t['gx'] + t['gy'])
    SP = sorted({t['sp'] for t in trees})
    out = {
        'about': 'Downtown Greensboro trees. Positions, heights (m) and crown radii (m) from NC 2015 Phase III lidar (NOAA dataset 6209) plus OpenStreetMap natural=tree for trees planted since; trees under buildings dropped. Evergreen vs deciduous from the 2024-02-03 leaf-off NC OneMap aerial. Species inferred (no public inventory): typical Piedmont NC plantings by evergreen, size and setting.',
        'cols': ['gx', 'gy', 'h', 'r', 'sp', 'src'], 'SP': SP, 'SRC': ['lidar', 'osm'],
        'T': [[round(t['gx'], 2), round(t['gy'], 2), round(t['h'], 1), round(t['r'], 1), SP.index(t['sp']), 0 if t['src'] == 'lidar' else 1] for t in trees],
        'F': flags,
    }
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    from collections import Counter
    print(len(trees), 'trees;', under, 'lidar crowns under buildings;', added, 'from OSM only;', dict(Counter(t['sp'] for t in trees)), 'flags', len(flags))


lidar_step() if LIDAR else merge_step()
