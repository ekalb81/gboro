"""Step 4 of 4 of a lidar refresh: building shapes the map does not give.

Usage: python3 tools/model/lidar_shapes.py <work-dir> <model: public/model/downtown.json> <previous shapes.json> <state-footprints.json> <out shapes.json>
  tiers  for a mapped building whose roof sits at clearly different levels (3 m or more apart), the outline and height
         of each upper level, from the grid lidar_ndsm.py wrote. Redone for every building inside the lidar tiles.
  new    buildings OpenStreetMap lacks. The earlier list keeps its order, because the model numbers these by position
         (9100000000 + n); each gets its height from the new survey, or "gone" when the new survey shows flat ground
         where it stood (prep.py then leaves it out). After them come additions: a State building footprint
         (tools/model/footprints.py) that the map lacks and the lidar shows standing, with the footprint's outline;
         then anything else the survey classified as a building, 60 m2 or more, with the lidar's own outline.
         The additions are sorted by place, so a run that covers more ground renumbers them. Anything keyed by
         one of these numbers (two records in data/model/facades-commons.json) has to be moved to the building's
         new number after such a run: match the buildings by outline between the old and the new model.
prep.py reads the result as <inputs-dir>/osm/shapes.json. Run prep.py first if the map changed, so <model> is current.
"""
import numpy as np,json,math,sys
from shapely.geometry import Polygon,box
from shapely.ops import unary_union
from shapely import contains_xy
from scipy import ndimage
work,model,old_json,fp2022,out=sys.argv[1:6]
d=np.load(work+'/ndsm.npz');nd6=d['nd6'];nd1=d['nd1'];c6=d['cnt6'];vg=d['veg'];cov=d['cover'];R=int(d['res'])
nd=np.where(c6>0,nd6,nd1);gh,gw=nd.shape
m=json.load(open(model));old=json.load(open(old_json))
jj,ii=np.mgrid[0:gh,0:gw];cx=(ii+.5)/R;cy=(jj+.5)/R
bmask=((c6>0)&(nd6>2.5))|((c6==0)&(nd1>3.5)&(vg<nd1-1)&(d['bridge']<=0))
def cells_poly(mask):
    j,i=np.nonzero(mask);return unary_union([box(a/R,b/R,(a+1)/R,(b+1)/R) for a,b in zip(i,j)])
def flat(g):
    if g.geom_type=='MultiPolygon':g=max(g.geoms,key=lambda q:q.area)
    return [round(v,2) for p in list(g.exterior.coords)[:-1] for v in p]
def polys(g):
    if g.is_empty:return []
    gs=list(g.geoms) if g.geom_type in('MultiPolygon','GeometryCollection') else [g]
    return [q for q in gs if q.geom_type=='Polygon']
A=(9.0/R)**2
def kclusters(h):
    # roof levels = the flat places in the footprint's heights: peaks of the 1 m histogram that hold 35 m2 or more,
    # stand 3 m or more apart, and have a real dip between them (so a sloped roof stays one level). Up to 4 levels.
    h=np.sort(h);b0=int(math.floor(h[0]));hist=np.bincount((h-b0).astype(int));s=np.convolve(hist,[1,1,1],'same')
    need=max(35/A,0.04*len(h))
    pk=[i for i in range(len(s)) if s[i]>=need and s[i]>=s[max(0,i-1)] and s[i]>=s[min(len(s)-1,i+1)]]
    acc=[]
    for i in sorted(pk,key=lambda i:-s[i]):
        if all(abs(i-j)>=3 for j in acc) and len(acc)<4: acc.append(i)
    acc.sort()
    while len(acc)>1:      # drop the smaller of two neighbours with no dip between them
        bad=[(min(s[acc[n]],s[acc[n+1]]),n) for n in range(len(acc)-1) if s[acc[n]+1:acc[n+1]].min()>0.5*min(s[acc[n]],s[acc[n+1]])]
        if not bad: break
        n=min(bad)[1];acc.pop(n if s[acc[n]]<s[acc[n+1]] else n+1)
    cuts=[b0+acc[n]+1+int(np.argmin(s[acc[n]+1:acc[n+1]]))+0.5 for n in range(len(acc)-1)]
    parts=[q for q in np.split(h,np.searchsorted(h,cuts)) if len(q)]
    return [(float(np.percentile(q,80)),len(q),float(q.min())) for q in parts]
covered=np.zeros_like(bmask);tiers={};kept=0;redone=0
for b in m['B']:
    p=b['p'];fp=Polygon([(p[i],p[i+1]) for i in range(0,len(p),2)]).buffer(0)
    if fp.is_empty:continue
    x0,y0,x1,y1=fp.bounds;a0,a1=max(0,int(x0*R)-1),min(gw,int(x1*R)+2);b0,b1=max(0,int(y0*R)-1),min(gh,int(y1*R)+2)
    sub=contains_xy(fp,cx[b0:b1,a0:a1],cy[b0:b1,a0:a1])
    if not b.get('lidar_new'): covered[b0:b1,a0:a1]|=ndimage.binary_dilation(sub,iterations=2)
    o=old['tiers'].get(str(b['id']))
    if not cov[b0:b1,a0:a1][sub].all() or b['id'] in (208115796,):
        if o: tiers[str(b['id'])]=dict(o,survey=2015);kept+=1
        continue
    hs=nd[b0:b1,a0:a1][sub&bmask[b0:b1,a0:a1]]
    if len(hs)<12: continue
    cl=kclusters(hs[hs>2.5])
    if len(cl)<2:continue
    res=[]
    for k in range(1,len(cl)):
        hk,nk,lo=cl[k]
        if nk*A<35:continue
        msk=np.zeros((gh,gw),bool);sm=sub&(nd[b0:b1,a0:a1]>=lo-0.5)&bmask[b0:b1,a0:a1];sm=ndimage.binary_opening(sm);msk[b0:b1,a0:a1]=sm
        g=cells_poly(msk).intersection(fp).simplify(0.13)
        for q in polys(g):
            if q.area*81>=35: res.append({'p':flat(q),'h':round(hk,1)})
    if res: tiers[str(b['id'])]={'base':round(cl[0][0],1),'tiers':res,'survey':2024};redone+=1
# buildings the map lacks: the earlier list keeps its order (the model numbers them by position) and gets 2024 heights
new=[];rep=[]
for nb in old['new']:
    p=nb['p'];fp=Polygon([(p[i],p[i+1]) for i in range(0,len(p),2)]).buffer(0)
    x0,y0,x1,y1=fp.bounds;a0,a1=max(0,int(x0*R)-1),min(gw,int(x1*R)+2);b0,b1=max(0,int(y0*R)-1),min(gh,int(y1*R)+2)
    sub=contains_xy(fp,cx[b0:b1,a0:a1],cy[b0:b1,a0:a1]);covered[b0:b1,a0:a1]|=ndimage.binary_dilation(sub,iterations=2)
    nb=dict(nb)
    if sub.any() and cov[b0:b1,a0:a1][sub].all():
        hs=nd[b0:b1,a0:a1][sub&bmask[b0:b1,a0:a1]];frac=len(hs)/max(1,sub.sum())
        nb['h_2015']=nb['h'];nb['standing_2024']=round(frac,2)
        if frac>=0.3:
            nb['h']=round(float(np.percentile(hs,85)),1);nb['src']=nb.get('src','').replace('height from lidar 2015','height from lidar 2024').replace('lidar 2015','outline lidar 2015, height lidar 2024')
        if frac<0.1: nb['gone']='flat ground in the Feb 2024 lidar (the aerial it was checked against was flown Feb 2022)'
        rep.append((nb['h_2015'],nb['h'],round(frac,2),nb['area'],nb.get('t','')))
    new.append(nb)
n_old=len(new)
# additions: the State's 2022 building footprints that the map lacks and the 2024 lidar confirms are standing ...
N0,S_,Wl=36.0768,36.0660,-79.7954;N=N0+145*9.0/110574;kk=math.cos(math.radians((N0+S_)/2))*111320
U=unary_union([Polygon(list(zip(b['p'][0::2],b['p'][1::2]))).buffer(0) for b in m['B'] if not b.get('lidar_new')]+[Polygon(list(zip(nb['p'][0::2],nb['p'][1::2]))).buffer(0) for nb in old['new']]).buffer(0)
GX=gw/R;GY=gh/R;add=[];taken=np.zeros_like(bmask)
for f in json.load(open(fp2022)):
    F=Polygon([((lo-Wl)*kk/9.0,(N-la)*110574/9.0) for lo,la in f['ll']]).buffer(0)
    if F.is_empty or F.area*81<40: continue
    x0,y0,x1,y1=F.bounds
    if x0<0 or y0<0 or x1>GX or y1>GY: continue
    if F.intersection(U).area>0.25*F.area: continue
    a0,a1=max(0,int(x0*R)-1),min(gw,int(x1*R)+2);b0,b1=max(0,int(y0*R)-1),min(gh,int(y1*R)+2)
    sub=contains_xy(F,cx[b0:b1,a0:a1],cy[b0:b1,a0:a1])
    if not sub.any() or not cov[b0:b1,a0:a1][sub].all(): continue
    hs=nd[b0:b1,a0:a1][sub&bmask[b0:b1,a0:a1]&(c6[b0:b1,a0:a1]>0)]
    taken[b0:b1,a0:a1]|=ndimage.binary_dilation(sub,iterations=2)
    if len(hs)<0.5*sub.sum(): continue
    h=float(np.percentile(hs,85))
    if h<3: continue
    G=F.difference(U.buffer(0.03))
    for q in polys(G):
        if q.area*81>=40: add.append({'p':flat(q.simplify(0.03)),'h':round(h,1),'area':round(q.area*81),'src':'NC building footprints 2022, height from lidar 2024'})
nfp=len(add)
# ... and whatever else the 2024 survey classified as a building that neither the map nor those footprints have
miss=bmask&~covered&~taken&cov&(c6>0)
lab,n=ndimage.label(ndimage.binary_opening(miss))
for k in range(1,n+1):
    cm=lab==k;area=cm.sum()*A
    if area<60:continue
    h=float(np.percentile(nd[cm],85))
    if h<3:continue
    for q in polys(cells_poly(cm).simplify(0.13)):
        if q.area*81<60:continue
        add.append({'p':flat(q),'h':round(h,1),'area':round(q.area*81),'src':'lidar 2024 (classified as a building by the survey)'})
add.sort(key=lambda nb:(round(min(nb['p'][1::2])),min(nb['p'][0::2])))
new+=add
json.dump({'tiers':tiers,'new':new,'source':'NC Emergency Management Phase 3 QL1 lidar flown 2024-02-03 (sdd.nc.gov), 1.5 m cells, inside the downloaded tiles; outside them the 2015 shapes (NC Phase III lidar 2015-02-03, NOAA dataset 6209) are kept, marked survey 2015. Outlines of buildings OpenStreetMap lacks come from the NC Emergency Management 2022 building footprints where they have one. Previous version: shapes-2015.json'},open(out,'w'))
print('from footprints',nfp,'from lidar only',len(add)-nfp);print('tiers',len(tiers),'redone',redone,'kept2015',kept,'old',len(old['tiers']),'| new',len(new),'of which old',n_old)
print('old "new" buildings 2015h,2024h,standing,area:',rep)
for nb in new[n_old:]:
    if nb['src'].startswith('lidar'): print('  lidar-only',nb['h'],nb['area'],nb['p'][:2])
lost=[k for k in old['tiers'] if k not in tiers];gain=[k for k in tiers if k not in old['tiers']]
print('tiered before but not now',lost);print('newly tiered',gain)
