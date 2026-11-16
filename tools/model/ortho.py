"""Fetch the aerial photo the model's ground, roof colours and trees are read from.

Usage: python3 tools/model/ortho.py <out.jpg> [metres-per-pixel=0.15] [west south east north]
Source: NC OneMap Orthoimagery_Latest (services.nconemap.gov). Writes <out.jpg> and <out>.json (bounds, size, date asked).
The image is a plain lon/lat grid over the bounds, north up, resampled so a pixel is the same number of metres both ways.

The server stretches the box you ask for to the shape of the picture you ask for, measured in degrees. So each tile is
asked for with width:height equal to its degrees of longitude:latitude (no stretch), then resized to square metres. (The
first copy of this aerial asked for metre-shaped tiles and silently got 21% more latitude in each, so everything read from
it sat up to 53 m too far north or south.) The reply's own extent is checked against the request.
"""
import io, json, math, sys, time, urllib.request, urllib.parse
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
OUT = sys.argv[1]; MPP = float(sys.argv[2]) if len(sys.argv) > 2 else .15
# default: the model's bounds (prep.py): downtown, plus 145 tiles north and 13 tiles east, a tile being 9 m
W, S, E, N = (float(v) for v in sys.argv[3:7]) if len(sys.argv) > 6 else (
    -79.7954, 36.0660, -79.7856 + 13 * 9.0 / (math.cos(math.radians((36.0768 + 36.0660) / 2)) * 111320), 36.0768 + 145 * 9.0 / 110574)
U = 'https://services.nconemap.gov/secure/rest/services/Imagery/Orthoimagery_Latest/ImageServer/exportImage'
k = math.cos(math.radians((36.0768 + 36.0660) / 2)) * 111320; KY = 110574   # the model's own metres per degree of longitude
TW = round((E - W) * k / MPP); TH = round((N - S) * KY / MPP)          # final size, square metres per pixel
ppd = TW / (E - W)                                                      # pixels per degree, both ways, as fetched
nx = math.ceil(TW / 3000); ny = math.ceil((N - S) * ppd / 3000)
def get(url, tries=4):
    for i in range(tries):
        try: return urllib.request.urlopen(url, timeout=300).read()
        except Exception as ex:
            if i == tries - 1: raise
            time.sleep(3 * 2 ** i)
xs = [round(TW * i / nx) for i in range(nx + 1)]; H0 = round((N - S) * ppd); ys = [round(H0 * j / ny) for j in range(ny + 1)]
raw = Image.new('RGB', (TW, H0))
for i in range(nx):
    for j in range(ny):
        w, e = W + xs[i] / ppd, W + xs[i + 1] / ppd; n, s = N - ys[j] / ppd, N - ys[j + 1] / ppd
        q = urllib.parse.urlencode({'bbox': f'{w},{s},{e},{n}', 'bboxSR': 4326, 'imageSR': 4326, 'size': f'{xs[i+1]-xs[i]},{ys[j+1]-ys[j]}',
                                    'format': 'png', 'interpolation': 'RSP_BilinearInterpolation'})
        ext = json.loads(get(U + '?' + q + '&f=json'))['extent']
        off = max(abs(ext['xmin'] - w), abs(ext['xmax'] - e), abs(ext['ymin'] - s), abs(ext['ymax'] - n)) * KY
        if off > .5: raise SystemExit(f'the server moved tile {i},{j} by {off:.1f} m: {ext}')
        raw.paste(Image.open(io.BytesIO(get(U + '?' + q + '&f=image'))).convert('RGB'), (xs[i], ys[j])); print('tile', i, j, flush=True)
raw.resize((TW, TH), Image.LANCZOS).save(OUT, quality=90)
json.dump({'bounds': {'west': W, 'south': S, 'east': E, 'north': N}, 'size': [TW, TH], 'm_per_px': MPP,
           'crs': 'EPSG:4326 (pixel x linear in longitude, pixel y linear in latitude, north up)',
           'source': 'NC Orthoimagery Program, Orthoimagery_Latest ImageServer, services.nconemap.gov',
           'credit': 'Imagery: NC Center for Geographic Information and Analysis / NC 911 Board (NC OneMap)',
           'fetched': time.strftime('%Y-%m-%d')}, open(OUT.rsplit('.', 1)[0] + '.json', 'w'), indent=1)
print(TW, TH)
