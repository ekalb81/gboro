"""Step 3 of 4 of a lidar refresh: a 1.5 m grid of height above ground over the whole model, from the points
lidar_load.py kept. Usage: python3 tools/model/lidar_ndsm.py <work-dir>     (writes <work-dir>/ndsm.npz)
Per cell: the highest building-class return, the highest unclassified one, the highest vegetation one, bridge decks,
how many building returns, and whether the downloaded tiles cover it. Ground is the lowest ground return, holes filled
from their neighbours.
"""
import numpy as np,json,sys,math,pyproj
from shapely.geometry import box
from shapely.ops import unary_union,transform
from shapely import contains_xy
work=sys.argv[1];M=9.0;RES=6;cell=M/RES
cov=json.load(open(work+'/cover.json'));gw=int(math.ceil(cov['GXm']/cell));gh=int(math.ceil(cov['GYm']/cell))
d=np.load(work+'/pts.npz');X=d['X'];Y=d['Y'];Z=d['Z'];C=d['C']
i=np.floor(X/cell).astype(np.int64);j=np.floor(Y/cell).astype(np.int64);ok=(i>=0)&(i<gw)&(j>=0)&(j<gh)
i,j,Z,C=i[ok],j[ok],Z[ok],C[ok]
def grid(mask,fn,init):
    a=np.full((gh,gw),init,np.float32);fn.at(a,(j[mask],i[mask]),Z[mask]);return a
gmin=grid(np.isin(C,[2,11,20]),np.minimum,1e9)
d6=grid(C==6,np.maximum,-1e9);d1=grid(C==1,np.maximum,-1e9);vmax=grid(np.isin(C,[3,4,5]),np.maximum,-1e9);br=grid(C==17,np.maximum,-1e9)
c6=np.zeros((gh,gw),np.int32);np.add.at(c6,(j[C==6],i[C==6]),1)
call=np.zeros((gh,gw),np.int32);np.add.at(call,(j,i),1)
dtm=gmin.copy();known=dtm<1e8
for it in range(600):
    if known.all():break
    P=np.pad(np.where(known,dtm,0),1);K=np.pad(known.astype(np.float32),1)
    s=sum(P[1+a:1+a+gh,1+b:1+b+gw] for a in (-1,0,1) for b in (-1,0,1));n=sum(K[1+a:1+a+gh,1+b:1+b+gw] for a in (-1,0,1) for b in (-1,0,1))
    new=(~known)&(n>0);dtm[new]=s[new]/n[new];known=known|new
tr=pyproj.Transformer.from_crs(6543,4326,always_xy=True)
N0,S_,Wl=36.0768,36.0660,-79.7954;N=N0+145*9.0/110574;k=math.cos(math.radians((N0+S_)/2))*111320
def tomodel(x,y,z=None):
    lon,lat=tr.transform(x,y);return ((np.asarray(lon)-Wl)*k,(N-np.asarray(lat))*110574)
COVER=unary_union([transform(tomodel,box(*t['bbox_ftus']).segmentize(250)) for t in cov['tiles'] if t['used']]).buffer(0)
jj,ii=np.mgrid[0:gh,0:gw];covm=contains_xy(COVER,(ii+.5)*cell,(jj+.5)*cell)
f=lambda a:np.where(a>-1e8,a-dtm,0).astype(np.float32)
np.savez_compressed(work+'/ndsm.npz',nd6=f(d6),nd1=f(d1),veg=f(vmax),bridge=f(br),cnt6=c6,cnt=call,cover=covm,dtm=dtm,res=RES)
print(gw,gh,'covered',covm.mean().round(3),'first covered row (tiles)',np.argmax(covm.any(1))/RES,'bld cells',((c6>0)&(f(d6)>2.5)).mean().round(3),'empty covered cells',((call==0)&covm).mean().round(4))
