"""The State's building footprints over the model, as a small JSON file lidar_shapes.py reads.

Usage: python3 tools/model/footprints.py <Guilford_2022_Buildings.gdb> <out.json>
Source (a direct, public download, unlike the lidar): NC Emergency Management building footprints traced from the
2022 imagery, https://sdd.nc.gov/Downloads/public/BuildingFootprintsbyCounty/Current/Guilford_2022_Buildings.zip
Needs pyogrio, pyproj, shapely.
"""
import pyogrio,pyproj,json,sys,math
from shapely import from_wkb
gdb,out=sys.argv[1:3]
N0,S,Wl,E0=36.0768,36.0660,-79.7954,-79.7856;N=N0+145*9.0/110574;k=math.cos(math.radians((N0+S)/2))*111320;El=E0+13*9.0/k
tr=pyproj.Transformer.from_crs(4326,2264,always_xy=True);inv=pyproj.Transformer.from_crs(2264,4326,always_xy=True)
x0,y0=tr.transform(Wl,S);x1,y1=tr.transform(El,N)
meta,fids,geom,fields=pyogrio.raw.read(gdb,layer='S_BUILDING_FP',bbox=(x0-200,y0-200,x1+200,y1+200),columns=['OCCUP_TYPE','YEAR_BUILT','NUM_STORY','IMAGE_YEAR'])
F={n:fields[i] for i,n in enumerate(meta['fields'])};res=[]
for i,gb in enumerate(geom):
    g=from_wkb(gb)
    for q in (g.geoms if g.geom_type=='MultiPolygon' else [g]):
        lon,lat=inv.transform(*zip(*list(q.exterior.coords)))
        res.append({'ll':[[round(a,7),round(b,7)] for a,b in zip(lon,lat)],**{kk:(None if F[kk][i] is None else str(F[kk][i])) for kk in F}})
json.dump(res,open(out,'w'),separators=(',',':'));print(len(res))
