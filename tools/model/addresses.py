"""Street addresses for the model's box, from the State's address points (AddressNC, NC OneMap; public, no key).

Usage: python3 tools/model/addresses.py [out.json]      (default data/model/addresses.json)

OpenStreetMap gives an address for about four buildings in ten here; the rest (houses mostly) had none, and the site
could only call them "A downtown building". This writes every address point in the box as [lon, lat, "413 McAdoo Ave"];
tools/model/names.py gives one to each building that OpenStreetMap left without. A survey layer like the lidar ones:
addresses change rarely, so it is read from git at each rebuild and fetched again only by running this.
"""
import datetime as dt, json, os, sys, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
URL = 'https://services.nconemap.gov/secure/rest/services/AddressNC/NC1Map_Addresses/FeatureServer/0/query'
DIR = {'NORTH': 'N', 'SOUTH': 'S', 'EAST': 'E', 'WEST': 'W'}
TYPE = {'STREET': 'St', 'AVENUE': 'Ave', 'BOULEVARD': 'Blvd', 'ROAD': 'Rd', 'DRIVE': 'Dr', 'PLACE': 'Pl', 'COURT': 'Ct', 'LANE': 'Ln',
        'PARKWAY': 'Pkwy', 'SQUARE': 'Sq', 'CIRCLE': 'Cir', 'HIGHWAY': 'Hwy'}
KEEP = {'SECU', 'YWCA', 'YMCA', 'NC', 'US'}


def word(w):
    if w in KEEP: return w
    if w.startswith('MC') and len(w) > 3: return 'Mc' + w[2:].capitalize()
    return w.capitalize()


def short(a):
    """One AddressNC record -> '413 McAdoo Ave' ('' without a number or a street)."""
    num, name = (a.get('add_number') or '').strip(), (a.get('st_name') or '').strip()
    if not num or not name: return ''
    parts = [num + (a.get('addnum_suf') or '').strip(), DIR.get(a.get('st_predir') or '', ''), ' '.join(word(w) for w in name.split()),
             TYPE.get(a.get('st_postyp') or '', word(a.get('st_postyp') or ''))]
    return ' '.join(p for p in parts if p)


def fetch(west, south, east, north):
    out, off = [], 0
    while True:
        q = dict(where='1=1', geometry=f'{west},{south},{east},{north}', geometryType='esriGeometryEnvelope', inSR=4326,
                 spatialRel='esriSpatialRelIntersects', outFields='add_number,addnum_suf,st_predir,st_name,st_postyp', outSR=4326,
                 orderByFields='objectid', resultOffset=off, resultRecordCount=2000, f='json')
        d = json.load(urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(q), timeout=180))
        if 'features' not in d: raise SystemExit('AddressNC answered without features: ' + json.dumps(d)[:300])
        out += d['features']; off += len(d['features'])
        if not d.get('exceededTransferLimit') or not d['features']: return out


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'model', 'addresses.json')
    g = json.load(open(os.path.join(ROOT, 'public', 'model', 'downtown.json')))['GEO']
    # the keepsake house (public/model/house.json) is shown with no name or address: no point on or beside its lot is kept
    try:
        lot = json.load(open(os.path.join(ROOT, 'public', 'model', 'house.json'))); m = json.load(open(os.path.join(ROOT, 'public', 'model', 'downtown.json')))['M']
        x0, y0 = lot['at'][0] + lot['base'][0] / m, lot['at'][1] + lot['base'][1] / m; x1, y1 = lot['at'][0] + lot['base'][2] / m, lot['at'][1] + lot['base'][3] / m
        pad = 12 / m; kx, ky = g['mPerDegLon'] / m, 110574 / m
        private = lambda lon, lat: min(x0, x1) - pad < (lon - g['west']) * kx < max(x0, x1) + pad and min(y0, y1) - pad < (g['north'] - lat) * ky < max(y0, y1) + pad
    except FileNotFoundError: private = lambda lon, lat: False
    seen, pts = set(), []
    for f in fetch(g['west'], g['south'], g['east'], g['north']):
        ad = short(f['attributes'])
        k = (ad, round(f['geometry']['x'], 5), round(f['geometry']['y'], 5))   # flats in one building share a spot
        if not ad or k in seen or private(f['geometry']['x'], f['geometry']['y']): continue
        seen.add(k); pts.append([round(f['geometry']['x'], 6), round(f['geometry']['y'], 6), ad])
    pts.sort(key=lambda p: (p[2], p[0], p[1]))
    json.dump({'_note': 'Street address points in the model\'s box, from AddressNC (NC OneMap). Made by tools/model/addresses.py; '
                        'tools/model/names.py gives one to each building OpenStreetMap has no address for.',
               'source': 'AddressNC, NC OneMap (services.nconemap.gov, AddressNC/NC1Map_Addresses)',
               'fetched': dt.date.today().isoformat(), 'points': pts}, open(out, 'w'), separators=(',', ':'))
    print(len(pts), 'address points ->', out)


if __name__ == '__main__': main()
