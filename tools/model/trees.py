"""Build public/model/trees.json: every tree in the downtown model, where it really stands, how tall and wide
it is, and whether it keeps its leaves in winter.

Usage: python3 tools/model/trees.py <lidar-dir> <osm-raw.json> <ortho-15cm.jpg> [out.json]

Inputs (all public, no login):
  lidar-dir     NC 2015 Phase III lidar tiles for downtown (NOAA Digital Coast dataset 6209, GuilfordCoNC,
                20150203_LA_37_1078640{1,2,3,4}.copc.laz on the noaa-nos-coastal-lidar-pds S3 bucket).
                Vegetation returns (classes 3-5) minus ground give a canopy height model; each crown is a
                local high point of that model, its width from the canopy around it.
  osm-raw.json  OpenStreetMap extract (natural=tree nodes, man_made=flagpole nodes, buildings). OSM trees
                that the 2015 lidar does not show (planted since, e.g. LeBauer Park, opened 2016) are added
                as young trees. Lidar crowns now under a building are dropped.
  ortho-15cm    NC OneMap aerial flown 2024-02-03, leaf-off. A crown that is still green in February is an
                evergreen (pine, magnolia, cedar, holly); a grey-brown one is deciduous.

Species: no public inventory of downtown Greensboro's trees exists (the City has only neighbourhood studies),
so each tree gets a species typical of Piedmont NC plantings for what we do know about it: evergreen or not,
height, crown width, and whether it stands along a street or in a park or yard. The choice is stable per
tree. The output says which facts are measured ("src") and which are inferred ("sp").
"""
import json, math, sys, glob
import numpy as np, laspy, pyproj
from PIL import Image
from scipy import ndimage

lazdir, osm_raw, ortho = sys.argv[1:4]
OUT = sys.argv[4] if len(sys.argv) > 4 else __file__.rsplit('/', 3)[0] + '/public/model/trees.json'
N, S, Wl, El = 36.0768, 36.0676, -79.7954, -79.7856
M = 9.0
k = math.cos(math.radians((N + S) / 2)) * 111320
GX = (El - Wl) * k / M; GY = (N - S) * 110574 / M
tr = pyproj.Transformer.from_crs(6346, 4326, always_xy=True)

# ---- canopy height model, 1 m cells in model grid space ----
R = 9  # cells per model unit (1 m)
gw, gh = int(math.ceil(GX * R)), int(math.ceil(GY * R))
gmin = np.full((gh, gw), 1e9, np.float32); vmax = np.full((gh, gw), -1e9, np.float32); bmax = np.full((gh, gw), -1e9, np.float32); vcnt = np.zeros((gh, gw), np.int32); gcnt = np.zeros((gh, gw), np.int32)
for f in sorted(glob.glob(lazdir + '/*.laz')):
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
            np.minimum.at(gmin, (j[g], i[g]), z[g]); np.maximum.at(vmax, (j[v], i[v]), z[v]); np.maximum.at(bmax, (j[b], i[b]), z[b]); np.add.at(vcnt, (j[v], i[v]), 1); np.add.at(gcnt, (j[g], i[g]), 1)
    print('read', f, flush=True)
# ground: fill holes (under buildings) with the nearest known ground
known = gmin < 1e8
idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
dtm = gmin[tuple(idx)]
chm = np.where(vmax > -1e8, vmax - dtm, 0).astype(np.float32)
chm[chm > 45] = 0  # birds, wires
# structures: cells with building or unclassified returns well above the ground (parking decks are often unclassified),
# grown by 2 m so the edges of roofs that were classed as vegetation go too
struct = ndimage.binary_dilation((bmax > -1e8) & (bmax - dtm > 2.5), iterations=2)
chm[struct] = 0
chm_s = ndimage.gaussian_filter(ndimage.grey_closing(chm, size=3), 1.0)

# ---- crowns: local maxima ----
can = chm_s > 3.0
peak = (chm_s == ndimage.maximum_filter(chm_s, size=7)) & can & (chm_s > 4.0)
pj, pi = np.nonzero(peak)
hs = chm_s[pj, pi]
order = np.argsort(-hs)
crowns = []
taken = np.zeros_like(can)
for o in order:
    j, i = pj[o], pi[o]; h = float(hs[o])
    # a tree's crown is roughly as wide as half to two-thirds its height; skip peaks inside a taller neighbour's crown
    if any((c['j'] - j) ** 2 + (c['i'] - i) ** 2 < (max(3.0, c['h'] * 0.22)) ** 2 for c in crowns[-400:]): continue
    crowns.append({'i': int(i), 'j': int(j), 'h': h})
vc = ndimage.uniform_filter(vcnt.astype(np.float32), size=5) * 25  # vegetation returns within ~2.5 m
gc = ndimage.uniform_filter(gcnt.astype(np.float32), size=5) * 25
for c in crowns: c['n'] = float(vc[c['j'], c['i']]); c['pen'] = float(gc[c['j'], c['i']] / (gc[c['j'], c['i']] + vc[c['j'], c['i']] + 1e-6))
# crown radius: canopy cells belong to the nearest crown (within 10 m)
lab = np.zeros(chm.shape, np.int32)
for n, c in enumerate(crowns, 1): lab[c['j'], c['i']] = n
dist, (ij, ii) = ndimage.distance_transform_edt(lab == 0, return_indices=True)
owner = lab[ij, ii]; owner[(~can) | (dist > 10)] = 0
area = np.bincount(owner.ravel(), minlength=len(crowns) + 1)
for n, c in enumerate(crowns, 1):
    c['r'] = float(np.clip(math.sqrt(area[n] / math.pi), 1.5, 0.45 * c['h'] + 2))

# ---- OSM: trees, flagpoles, buildings ----
els = json.load(open(osm_raw))['elements']
nodes = {e['id']: e for e in els if e['type'] == 'node'}
def gxy(lon, lat): return ((lon - Wl) * k / M, (N - lat) * 110574 / M)
osm_trees = [gxy(e['lon'], e['lat']) for e in els if e['type'] == 'node' and e.get('tags', {}).get('natural') == 'tree']
flags = [dict(zip(('gx', 'gy'), [round(v, 2) for v in gxy(e['lon'], e['lat'])]), h=e.get('tags', {}).get('height')) for e in els if e['type'] == 'node' and e.get('tags', {}).get('man_made') == 'flagpole']
bmask = Image.new('L', (gw, gh), 0)
from PIL import ImageDraw
dr = ImageDraw.Draw(bmask)
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

trees = []
for c in crowns:
    if bm[c['j'], c['i']]: continue  # under a building now (built since 2015)
    trees.append({'gx': (c['i'] + .5) / R, 'gy': (c['j'] + .5) / R, 'h': c['h'], 'r': c['r'], 'src': 'lidar', 'n': c['n'], 'pen': c['pen']})
# ---- check each lidar crown against the 2024 aerial ----
im = Image.open(ortho).convert('RGB'); OW, OH = im.size
A = np.asarray(im).astype(np.float32) / 255
Lum = A.mean(-1)
def patch(t, f):
    lon = Wl + t['gx'] * M / k; lat = N - t['gy'] * M / 110574
    px = (lon - Wl) / (El - Wl) * OW; py = (N - lat) / (N - S) * OH
    rr = max(6, int(t['r'] * f / 0.15))
    x0, x1, y0, y1 = int(px - rr), int(px + rr), int(py - rr), int(py + rr)
    if x0 < 0 or y0 < 0 or x1 > OW or y1 > OH: return None
    return slice(y0, y1), slice(x0, x1)
dropped = {'sparse': 0, 'roof_or_paving_2024': 0}
keep = []
for t in trees:
    # a handful of vegetation returns is a wire, a sign or a roof unit, not a tree
    if t['n'] < 15: dropped['sparse'] += 1; continue
    # mostly bright, flat surface in 2024: a new roof or fresh concrete where a tree stood in 2015
    s = patch(t, 0.5)
    if s and (Lum[s] > 0.8).mean() > 0.5: dropped['roof_or_paving_2024'] += 1; continue
    keep.append(t)
trees = keep
added = 0
for gx, gy in osm_trees:
    if not (0 < gx < GX and 0 < gy < GY): continue
    if any((t['gx'] - gx) ** 2 + (t['gy'] - gy) ** 2 < (max(3.5, t['r']) / M) ** 2 for t in trees): continue
    trees.append({'gx': gx, 'gy': gy, 'h': 5.0, 'r': 1.8, 'src': 'osm'}); added += 1

# ---- evergreen or not, from the February 2024 aerial ----
def green_frac(t):
    lon = Wl + t['gx'] * M / k; lat = N - t['gy'] * M / 110574
    px = (lon - Wl) / (El - Wl) * OW; py = (N - lat) / (N - S) * OH
    rr = max(4, int(t['r'] * 0.7 / 0.15))
    x0, x1, y0, y1 = int(px - rr), int(px + rr), int(py - rr), int(py + rr)
    if x0 < 0 or y0 < 0 or x1 > OW or y1 > OH: return 0.0
    a = A[y0:y1, x0:x1]; r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(-1); mn = a.min(-1); sat = (mx - mn) / (mx + 1e-6)
    # dark-to-mid green foliage; lawn under a bare tree is lighter and yellower, so require some darkness too
    v = (g > r + 0.01) & (g > b + 0.02) & (sat > 0.14) & (mx < 0.55) & (mx > 0.08)
    return float(v.mean())

def hsh(a, b):
    s = math.sin(a * 12.9898 + b * 78.233) * 43758.5453
    return s - math.floor(s)

for t in trees:
    j, i = min(gh - 1, int(t['gy'] * R)), min(gw - 1, int(t['gx'] * R))
    t['ctx'] = 'park' if pk[j, i] else 'street' if st[j, i] else 'yard'
    gf = green_frac(t)
    # evergreen: green in February, or a dark crown that let almost no lidar pulses reach the ground in February
    s_ = patch(t, 0.5)
    dark = s_ is not None and float(Lum[s_].mean()) < 0.3
    t['ever'] = gf > 0.25 or (t['src'] == 'lidar' and t['pen'] < 0.1 and dark)
    u = hsh(t['gx'], t['gy']); h = t['h']; r = t['r']
    if t['ever']:
        if h >= 12 and r < h * 0.38: sp = 'loblolly'
        elif h >= 7: sp = 'magnolia' if u < .6 else 'loblolly'
        else: sp = 'cedar' if u < .5 else 'holly'
    elif t['ctx'] == 'street':
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
    'about': 'Downtown Greensboro trees. Positions, heights (m) and crown radii (m) from NC 2015 Phase III lidar (NOAA dataset 6209) plus OpenStreetMap natural=tree for trees planted since; trees under post-2015 buildings dropped. Evergreen vs deciduous from the 2024-02-03 leaf-off NC OneMap aerial. Species inferred (no public inventory): typical Piedmont NC plantings by evergreen, size and setting.',
    'cols': ['gx', 'gy', 'h', 'r', 'sp', 'src'], 'SP': SP, 'SRC': ['lidar', 'osm'],
    'T': [[round(t['gx'], 2), round(t['gy'], 2), round(t['h'], 1), round(t['r'], 1), SP.index(t['sp']), 0 if t['src'] == 'lidar' else 1] for t in trees],
    'F': flags,
}
json.dump(out, open(OUT, 'w'), separators=(',', ':'))
from collections import Counter
print(len(trees), 'trees;', dropped, added, 'from OSM only;', Counter(t['sp'] for t in trees), Counter(t['ctx'] for t in trees), 'evergreen', sum(t['ever'] for t in trees), 'flags', len(flags))
