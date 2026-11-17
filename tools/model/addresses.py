"""Street addresses for the model's buildings, from the State's public address data (NC OneMap), for the buildings
OpenStreetMap gives no name, tenant or address.

Two layers are read for the model's box:
  points   AddressNC, the statewide 911 address points (one per address, set on the structure)
  parcels  NC Parcels, each lot's outline and site address, for buildings no address point falls inside
Only the house number, the street and the position are kept. Owner names, values, sale dates and unit numbers are
never requested or stored.

Usage: python3 tools/model/addresses.py [out.json]      writes data/model/addresses.json (the copy kept in git)
The weekly rebuild (refresh.py) fetches a fresh copy by itself and falls back to the one in git, so this is only
needed after the model's box grows.
"""
import json, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'data', 'model', 'addresses.json')
BASE = 'https://services.nconemap.gov/secure/rest/services/'
POINTS = BASE + 'AddressNC/NC1Map_Addresses/FeatureServer/0'
PARCELS = BASE + 'NC1Map_Parcels/FeatureServer/1'
POINT_FIELDS = 'add_number,st_predir,st_name,st_postyp,st_posdir'
PARCEL_FIELDS = 'saddno,saddpref,saddstr,saddsttyp,saddstsuf'
UA = 'gso-village/0.1 (community map of Greensboro; github.com/ekalb81/gboro)'
DIRS = {'N': 'North', 'S': 'South', 'E': 'East', 'W': 'West', 'NORTH': 'North', 'SOUTH': 'South', 'EAST': 'East', 'WEST': 'West'}
TYPES = {'ST': 'Street', 'AVE': 'Avenue', 'DR': 'Drive', 'CIR': 'Circle', 'CT': 'Court', 'PL': 'Place', 'BLVD': 'Boulevard', 'WAY': 'Way',
         'RD': 'Road', 'SQ': 'Square', 'ALY': 'Alley', 'PLZ': 'Plaza', 'LN': 'Lane', 'PKWY': 'Parkway', 'TER': 'Terrace', 'HWY': 'Highway'}


def query(url, fields, box, geometry, get=None, page=1000):
    """Every feature of an ArcGIS layer inside box (west, south, east, north), a page at a time."""
    out, off = [], 0
    while True:
        q = urllib.parse.urlencode({'where': '1=1', 'geometry': ','.join(str(v) for v in box), 'geometryType': 'esriGeometryEnvelope',
                                    'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': fields, 'outSR': 4326,
                                    'returnGeometry': 'true' if geometry else 'false', 'orderByFields': 'objectid',
                                    'resultOffset': off, 'resultRecordCount': page, 'f': 'json'})
        d = json.loads(get(f'{url}/query?{q}') if get else
                       urllib.request.urlopen(urllib.request.Request(f'{url}/query?{q}', headers={'User-Agent': UA}), timeout=120).read())
        if 'error' in d:
            raise RuntimeError(f'{url.rsplit("/", 3)[1]}: {d["error"].get("message", d["error"])}')
        f = d.get('features', [])
        out += f; off += len(f)
        if not f or not d.get('exceededTransferLimit'):
            return out
        time.sleep(1)   # be polite


def street(pre, name, typ, post):
    """('NORTH','DAVIE','STREET','') or ('','DAVIE','ST','N') -> 'North Davie Street'. The county writes the direction last."""
    name = (name or '').strip()
    if not name:
        return ''
    d = DIRS.get((pre or '').strip().upper()) or DIRS.get((post or '').strip().upper()) or ''
    t = (typ or '').strip().upper()
    t = TYPES.get(t, t.title())
    return ' '.join(w for w in (d, name.title(), t) if w)


def slim(points, parcels):
    """The two replies -> the small file kept in git: [lon, lat, number, street] and {a: [number, street], p: [lon, lat, ...]}."""
    pts = set()
    for f in points:
        a, g = f.get('attributes') or {}, f.get('geometry') or {}
        num, st = str(a.get('add_number') or '').strip(), street(a.get('st_predir'), a.get('st_name'), a.get('st_postyp'), a.get('st_posdir'))
        if num and num != '0' and st and 'x' in g:
            pts.add((round(g['x'], 6), round(g['y'], 6), num, st))
    lots = {}
    for f in parcels:
        a, g = f.get('attributes') or {}, f.get('geometry') or {}
        num, st = str(a.get('saddno') or '').strip(), street(a.get('saddpref'), a.get('saddstr'), a.get('saddsttyp'), a.get('saddstsuf'))
        rings = g.get('rings') or []
        if not num or num == '0' or not st or not rings:
            continue
        ring = max(rings, key=len)   # the lot's outer line; holes and slivers are not needed to tell which lot a building is on
        p = [round(v, 6) for c in ring for v in c[:2]]
        lots.setdefault((num, st, tuple(p)), {'a': [num, st], 'p': p})   # condominiums repeat one outline per unit
    return {'points': [list(p) for p in sorted(pts)], 'parcels': [lots[k] for k in sorted(lots)]}


def fetch(box, get=None):
    """box: (west, south, east, north). Returns the slim dict, or raises."""
    d = slim(query(POINTS, POINT_FIELDS, box, True, get), query(PARCELS, PARCEL_FIELDS, box, True, get))
    if not d['points']:
        raise RuntimeError('no address points came back')
    return d


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else OUT
    g = json.load(open(os.path.join(ROOT, 'public', 'model', 'downtown.json')))['GEO']
    d = fetch((g['west'], g['south'], g['east'], g['north']))
    doc = {'_note': 'Street addresses for buildings OpenStreetMap gives none for: house number, street and position only, from the '
                    'State\'s public 911 address points (AddressNC) and county parcels (NC Parcels) on NC OneMap. No owner names '
                    'or unit numbers. Written by tools/model/addresses.py; the weekly rebuild fetches a fresh copy and falls back to this one.',
           'source': 'NC OneMap: AddressNC address points and NC Parcels', 'fetched': time.strftime('%Y-%m-%d'), **d}
    with open(out, 'w') as fh:
        fh.write(json.dumps(doc, separators=(',', ':')).replace('"points":', '\n"points":').replace('"parcels":', '\n"parcels":') + '\n')
    print(f'{len(d["points"])} address points, {len(d["parcels"])} parcels -> {out}')


if __name__ == '__main__':
    main()
