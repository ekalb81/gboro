"""Step 1 of 4 of a lidar refresh: read the State's lidar tiles and keep the points over the model.

Usage: python3 tools/model/lidar_load.py <dir of .las tiles> <work-dir>
Writes <work-dir>/pts.npz (x east and y south of the model's north-west corner in metres, z in metres, class) and
<work-dir>/cover.json (which tiles were used, and the flight dates read from the points).

The tiles are NC Emergency Management's "Phase 3 - 2024, NC QL1" classified point cloud for Guilford County (flown
2024-02-03, about 18 points per square metre, LAS 1.4 in EPSG:6543 US survey feet, heights NAVD88 feet). They have no
direct download address: someone signed in at https://sdd.nc.gov orders the tiles (Data Download, LiDAR) and the site
makes a zip per job. The State flies the county about once a decade, so this is a once-per-flight step. Tile index:
https://sdd.nc.gov/Downloads/public/docs/Layout2024.zip. Classes: 1 unclassified, 2 ground, 3-5 vegetation, 6 building,
7 and 18 noise (dropped), 11 road surface, 17 bridge deck, 20 ignored ground.

Then: lidar_heights.py, lidar_ndsm.py, lidar_shapes.py, and prep.py to rebuild the model. Needs laspy, pyproj, numpy.
"""
import laspy,numpy as np,pyproj,glob,sys,math,json
lasdir,out=sys.argv[1:3]
N0,S,Wl,E0=36.0768,36.0660,-79.7954,-79.7856;NORTH=145;EAST=13;M=9.0
N=N0+NORTH*9.0/110574;k=math.cos(math.radians((N0+S)/2))*111320;El=E0+EAST*9.0/k
GXm=(El-Wl)*k;GYm=(N-S)*110574
tr=pyproj.Transformer.from_crs(6543,4326,always_xy=True);inv=pyproj.Transformer.from_crs(4326,6543,always_xy=True)
cs=[inv.transform(lo,la) for lo in (Wl,El) for la in (S,N)]
FT=0.3048006096012192;mg=60/FT
bx0=min(c[0] for c in cs)-mg;bx1=max(c[0] for c in cs)+mg;by0=min(c[1] for c in cs)-mg;by1=max(c[1] for c in cs)+mg
X=[];Y=[];Z=[];C=[];tiles=[];tmin=1e30;tmax=-1e30
for f in sorted(glob.glob(lasdir+'/*.las')):
    with laspy.open(f) as fh:
        h=fh.header;tb=[float(h.mins[0]),float(h.mins[1]),float(h.maxs[0]),float(h.maxs[1])]
        # a whole tile's edges sit on the 2,500 ft grid (to within the point spacing); an order drawn as a box is cut
        # wherever the box was, so an edge more than 10 ft off the grid is kept as it is
        sn=lambda v,f:(f(v/2500)*2500 if abs(f(v/2500)*2500-v)<10 else v)
        tb=[sn(tb[0],math.floor),sn(tb[1],math.floor),sn(tb[2],math.ceil),sn(tb[3],math.ceil)]
        if any(o['used'] and o['bbox_ftus'][0]<=tb[0] and o['bbox_ftus'][1]<=tb[1] and o['bbox_ftus'][2]>=tb[2] and o['bbox_ftus'][3]>=tb[3] for o in tiles):
            print('skip (inside a tile already read)',f,flush=True);continue
        tiles.append({'file':f.split('/')[-1],'bbox_ftus':tb,'points':int(h.point_count)})
        if tb[0]>bx1 or tb[2]<bx0 or tb[1]>by1 or tb[3]<by0: print('skip (outside model)',f,flush=True);tiles[-1]['used']=False;continue
        tiles[-1]['used']=True;n=0
        for ch in fh.chunk_iterator(4_000_000):
            x=np.asarray(ch.x);y=np.asarray(ch.y);c=np.asarray(ch.classification)
            ok=(x>=bx0)&(x<=bx1)&(y>=by0)&(y<=by1)&(c!=7)&(c!=18)&(~np.asarray(ch.withheld).astype(bool))
            if not ok.any(): continue
            x=x[ok];y=y[ok];t=np.asarray(ch.gps_time)[ok];tmin=min(tmin,t.min());tmax=max(tmax,t.max())
            lon,lat=tr.transform(x,y)
            X.append(((lon-Wl)*k).astype(np.float32));Y.append(((N-lat)*110574).astype(np.float32))
            Z.append((np.asarray(ch.z)[ok]*FT).astype(np.float32));C.append(c[ok].astype(np.uint8));n+=ok.sum()
        print(f,n,flush=True)
X=np.concatenate(X);Y=np.concatenate(Y);Z=np.concatenate(Z);C=np.concatenate(C)
np.savez(out+'/pts.npz',X=X,Y=Y,Z=Z,C=C)
import datetime;e=datetime.datetime(1980,1,6)
json.dump({'tiles':tiles,'gps':[str(e+datetime.timedelta(seconds=float(v)+1e9)) for v in (tmin,tmax)],'GXm':GXm,'GYm':GYm,'n':int(len(X))},open(out+'/cover.json','w'),indent=1)
print(len(X),GXm,GYm,dict(zip(*[a.tolist() for a in np.unique(C,return_counts=True)])))
