"""Build public/model/downtown.json (the downtown scale model) from an OpenStreetMap extract plus
the optional survey layers (lidar tiers and heights, roof colours, aerial vegetation, street-photo facades).

Usage: python3 tools/model/prep.py <osm-extract.json> [inputs-dir] [out.json]
inputs-dir holds osm/shapes.json, osm/downtown-raw.json, osm/roofs.json, osm/facades.json,
osm/heights.json and imagery/ortho-downtown.png; any that are missing are skipped.
"""
import json,math,sys,os
src=sys.argv[1]
INP=(sys.argv[2] if len(sys.argv)>2 else '/mnt/project-files/village').rstrip('/')+'/'
OUT=sys.argv[3] if len(sys.argv)>3 else os.path.join(os.path.dirname(__file__),'..','..','public','model','downtown.json')
d=json.load(open(src))
N,S,Wl,El=36.0768,36.0676,-79.7954,-79.7856
M=9.0
lat0=N;lon0=Wl;k=math.cos(math.radians((N+S)/2))*111320
def g(p): return ((p['lon']-lon0)*k/M,(lat0-p['lat'])*110574/M)
GX=(El-Wl)*k/M; GY=(N-S)*110574/M
def inreg(x,y,m=0): return -m<=x<=GX+m and -m<=y<=GY+m
def flat(pts): return [round(v,2) for p in pts for v in p]
B=[];R=[];RL=[];PK=[];PL=[];PED=[]
rcls={'motorway':0,'trunk':0,'primary':1,'secondary':2,'tertiary':3,'residential':4,'unclassified':4,'service':5,'pedestrian':6}
for e in d['elements']:
    t=e.get('tags',{});geo=e.get('geometry') or []
    if len(geo)<2: continue
    pts=[g(p) for p in geo]
    cx=sum(p[0] for p in pts)/len(pts);cy=sum(p[1] for p in pts)/len(pts)
    if 'building' in t:
        if not inreg(cx,cy): continue
        if pts[0]==pts[-1]: pts=pts[:-1]
        if len(pts)<3: continue
        lv=t.get('building:levels');h=t.get('height')
        try: lv=float(lv)
        except: lv=None
        try: hm=float(str(h).split()[0])
        except: hm=None
        B.append({'p':flat(pts),'l':lv,'h':hm,'t':t.get('building'),'n':t.get('name',''),'id':e['id'],'a':t.get('amenity',''),'mat':t.get('building:material',''),'rs':t.get('roof:shape','')})
    elif 'highway' in t:
        if t['highway'] not in rcls: continue
        if not any(inreg(x,y,3) for x,y in pts): continue
        area=t.get('area')=='yes' or (t['highway']=='pedestrian' and pts[0]==pts[-1])
        R.append({'c':rcls[t['highway']],'n':t.get('name',''),'p':flat(pts),'ar':1 if area else 0,'ow':1 if t.get('oneway')=='yes' else 0})
    elif t.get('railway')=='rail':
        if not any(inreg(x,y,3) for x,y in pts): continue
        RL.append({'n':t.get('name',''),'p':flat(pts),'sv':1 if t.get('service') else 0})
    elif t.get('leisure') in ('park','pitch','stadium'):
        if not inreg(cx,cy,5): continue
        PK.append({'n':t.get('name',''),'p':flat(pts),'k':t.get('leisure')})
    elif t.get('amenity')=='parking':
        if not inreg(cx,cy,2): continue
        if t.get('parking') in ('multi-storey','underground'): continue
        PL.append(flat(pts))
# merge polylines by name for traffic and rail
def chains(items):
    segs=[list(zip(it['p'][0::2],it['p'][1::2])) for it in items]
    out=[]
    while segs:
        cur=segs.pop(0);changed=True
        while changed:
            changed=False
            for i,s in enumerate(segs):
                if s[0]==cur[-1]: cur=cur+s[1:]
                elif s[-1]==cur[0]: cur=s[:-1]+cur
                elif s[-1]==cur[-1]: cur=cur+s[::-1][1:]
                elif s[0]==cur[0]: cur=s[::-1][:-1]+cur
                else: continue
                segs.pop(i);changed=True;break
        out.append(cur)
    return out
def plen(c): return sum(math.dist(c[i],c[i+1]) for i in range(len(c)-1))
traffic=[]
for nm in ['North Elm Street','South Elm Street','East Market Street','West Market Street','North Greene Street','South Greene Street','North Davie Street','South Davie Street','East Friendly Avenue','West Friendly Avenue','North Eugene Street','South Eugene Street','West Washington Street','East Washington Street','North Church Street','East Lindsay Street','Bellemeade Street','West McGee Street','East Gate City Boulevard','West Gate City Boulevard','North Edgeworth Street','South Edgeworth Street','Summit Avenue','North Murrow Boulevard']:
    its=[r for r in R if r['n']==nm and r['c']<=4]
    for c in chains(its):
        if plen(c)>8: traffic.append({'n':nm,'p':[round(v,2) for p in c for v in p],'c':min(r['c'] for r in its)})
main=[r for r in RL if not r['sv']]
rc=sorted(chains(main),key=plen,reverse=True)
train=[round(v,2) for p in rc[0] for v in p] if rc else []
# intersections for crosswalks
from collections import defaultdict
vx=defaultdict(list)
for r in R:
    if r['ar'] or r['c']>4: continue
    p=list(zip(r['p'][0::2],r['p'][1::2]))
    for i,pt in enumerate(p):
        for j in (i-1,i+1):
            if 0<=j<len(p):
                dx=p[j][0]-pt[0];dy=p[j][1]-pt[1];L=math.hypot(dx,dy)
                if L>0: vx[pt].append((r['n'],round(dx/L,3),round(dy/L,3),r['c']))
X=[]
for pt,ds in vx.items():
    if len(set(d[0] for d in ds))>=2 and len(ds)>=3 and inreg(pt[0],pt[1]):
        X.append([round(pt[0],2),round(pt[1],2),[[d[1],d[2],d[3]] for d in ds]])
# lidar-derived shapes: stepped tiers inside footprints, and verified buildings OSM lacks
try:
    SHP=json.load(open(INP+'osm/shapes.json'))
    for b in B:
        t=SHP['tiers'].get(str(b['id']))
        if t: b['tb']=t['base'];b['tr']=t['tiers']
    for n,nb in enumerate(SHP['new']):
        B.append({'p':nb['p'],'l':None,'h':None,'lh':nb['h'],'t':'yes','n':'','id':9100000000+n,'a':'','mat':'','rs':'','lidar_new':1})
except FileNotFoundError: pass
# 3D building parts (from the unfiltered OSM extract)
PT=[]
try:
    raw=json.load(open(INP+'osm/downtown-raw.json'))['elements']
    nd={e['id']:e for e in raw if e['type']=='node'}
    def num(v):
        try: return float(str(v).split()[0])
        except: return None
    for e in raw:
        t=e.get('tags',{})
        if e['type']!='way' or 'building:part' not in t: continue
        pts=[g(nd[i]) for i in e['nodes'] if i in nd]
        if pts and pts[0]==pts[-1]: pts=pts[:-1]
        PT.append({'id':e['id'],'p':flat(pts),'h':num(t.get('height')),'mh':num(t.get('min_height')),'l':num(t.get('building:levels')),'rs':t.get('roof:shape',''),'rc':t.get('roof:colour',''),'ra':num(t.get('roof:angle')),'n':t.get('name',''),'a':t.get('amenity','')})
except FileNotFoundError: pass

# real roof colours (NC OneMap aerial, 2024) and a ground vegetation mask from the same aerial
try:
    RC=json.load(open(INP+'osm/roofs.json'))
    for b in B:
        if str(b['id']) in RC: b['rc']=RC[str(b['id'])]
    for pt in PT:
        if str(pt['id']) in RC: pt['rc2']=RC[str(pt['id'])]
except FileNotFoundError: pass
VG=None
try:
    from PIL import Image
    import numpy as np
    im=np.asarray(Image.open(INP+'imagery/ortho-downtown.png').convert('RGB')).astype(float)/255
    r_,g_,b_=im[...,0],im[...,1],im[...,2];mx=im.max(-1);mn=im.min(-1);sat=(mx-mn)/(mx+1e-6)
    veg=((g_>b_+0.02)&(sat>0.16)&(mx>0.18)&(mx<0.75)&(g_>=r_-0.06)).astype(float)
    H_,W_=veg.shape;RES=6
    gw=int(math.ceil(GX*RES));gh=int(math.ceil(GY*RES))
    G=np.zeros((gh,gw),np.uint8)
    for j in range(gh):
        y=(j+.5)/RES;lat=lat0-y*M/110574;py0=(N-lat)/(N-S)*H_
        for i in range(gw):
            x=(i+.5)/RES;lon=lon0+x*M/k;px=(lon-Wl)/(El-Wl)*W_
            x0=int(px-2.5);y0=int(py0-2.5)
            if 0<=x0 and 0<=y0 and x0+5<=W_ and y0+5<=H_ and veg[y0:y0+5,x0:x0+5].mean()>0.45: G[j,i]=1
    P_=np.pad(G,1);S_=sum(P_[1+dy:1+dy+gh,1+dx:1+dx+gw] for dy in (-1,0,1) for dx in (-1,0,1))
    G=(S_>=5).astype(np.uint8)
    rows=[]
    for j in range(gh):
        runs=[];cur=0;n=0
        for v in G[j]:
            if v==cur: n+=1
            else: runs.append(n);cur=v;n=1
        runs.append(n)
        rows.append(','.join(format(r,'x') for r in runs))
    VG={'r':RES,'w':gw,'h':gh,'rows':rows}
except FileNotFoundError: pass

# facade readings from Mapillary street photos (2018/2021)
try:
    FC=json.load(open(INP+'osm/facades.json'))
    for b in B:
        f=FC.get(str(b['id']))
        if f: b['f']={k:f.get(k) for k in ('wall_hex','trim_hex','material','floors','storefront','awning_hex','window_style','confidence')}
except FileNotFoundError: pass

# measured heights from NC Phase III lidar (flown 2015-02-03)
try:
    HT=json.load(open(INP+'osm/heights.json'))['buildings']
    for b in B:
        r=HT.get(str(b['id']))
        if r and r.get('h'): b['lh']=round(r['h'],1)
except FileNotFoundError: pass

GEO={'north':N,'south':S,'west':Wl,'east':El,'mPerDegLon':round(k,3),'mPerDegLat':110574}
out={'GEO':GEO,'X':X,'GX':round(GX,2),'GY':round(GY,2),'M':M,'B':B,'R':R,'RL':RL,'PK':PK,'PL':PL,'TR':traffic,'TRAIN':train,'PT':PT,'VG':VG}
s=json.dumps(out,separators=(',',':'))
open(OUT,'w').write(s)
print(len(B),len(R),len(RL),len(PK),len(PL),len(traffic),'train pts',len(train)//2,'trainlen',round(plen(rc[0]),1) if rc else 0,'bytes',len(s),'GX',GX,'GY',GY)
named=[b['n'] for b in B if b['n']]
print(len(named))
