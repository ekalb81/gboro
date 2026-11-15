"""Names for the model's buildings, from OpenStreetMap only (so a rebuild picks up new ones by itself).

For each building, in order of how much it says about the building:
  n   its own name: the OSM name, else addr:housename ("Guilford Building"), else a correction from
      data/model/names.json (for typos and gaps upstream)
  tn  who is inside: named shops, restaurants, offices... mapped as points within the footprint, best known first
  ad  its street address, short ("304 S Elm St"), from the building or from a point inside it
The renderer labels a building with the first of these it has. Closed places (disused:, was:) are left out.
"""
import re

# a point counts as a tenant when it has one of these keys; lower rank is listed (and labelled) first
RANK={'tourism':0,'amenity':1,'leisure':2,'shop':3,'craft':3,'healthcare':4,'club':4,'office':5}
AMENITY_FIRST={'theatre','arts_centre','cinema','library','museum','townhall','courthouse','place_of_worship','university','college','events_venue','music_venue'}
AMENITY_FOOD={'restaurant','bar','pub','cafe','nightclub','biergarten','fast_food','ice_cream','food_court'}
NOT_TENANT={'parking','parking_entrance','parking_space','bicycle_parking','bench','atm','vending_machine','toilets','waste_basket','post_box',
            'drinking_water','fountain','charging_station','bicycle_rental','telephone','clock','recycling','shelter','taxi','information',
            'artwork','attraction','viewpoint','picnic_table','playground','pitch','garden','yes'}
ABBR={'North':'N','South':'S','East':'E','West':'W','Street':'St','Avenue':'Ave','Boulevard':'Blvd','Road':'Rd','Drive':'Dr',
      'Place':'Pl','Court':'Ct','Lane':'Ln','Parkway':'Pkwy','Square':'Sq','Circle':'Cir','Highway':'Hwy'}

def pip(x,y,p):
    c=False
    for i in range(len(p)):
        x1,y1=p[i];x2,y2=p[i-1]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c

def short_address(num,street):
    """('346, 348','South Elm Street') -> '346-348 S Elm St'; '' when either half is missing."""
    if not num or not street: return ''
    parts=[p.strip() for p in re.split(r'[,;]',str(num)) if p.strip()]
    if not parts: return ''
    if len(parts)>1:
        a=parts[0].split('-')[0];b=parts[-1].split('-')[-1]
        num=a if a==b else a+'-'+b
    else: num=parts[0]
    w=street.split()
    w=[ABBR.get(x,x) if (i==0 and len(w)>1 and x in('North','South','East','West')) or (i==len(w)-1 and i>0) else x for i,x in enumerate(w)]
    return num+' '+' '.join(w)

def tenant_rank(t):
    """Sort key for a tagged point, or None if it is not a tenant worth naming."""
    name=(t.get('name') or '').strip()
    if not name: return None
    best=None
    for k,r in RANK.items():
        v=t.get(k)
        if not v or v in NOT_TENANT or v=='no': continue
        if k=='amenity': r=0 if v in AMENITY_FIRST else 1 if v in AMENITY_FOOD else 4
        if k=='tourism': r=0 if v in('hotel','museum','gallery','motel','hostel') else 4
        if best is None or r<best: best=r
    return best

def name_buildings(B,raw,g,overrides=None):
    """Fill n / tn / ad on each building dict in B. raw: OSM API elements; g: {'lat','lon'} -> model grid."""
    overrides=overrides or {}
    ways={e['id']:e.get('tags',{}) for e in raw if e['type']=='way'}
    pts=[]
    for e in raw:
        if e['type']!='node' or not e.get('tags'): continue
        t=e['tags'];r=tenant_rank(t)
        addr=short_address(t.get('addr:housenumber'),t.get('addr:street'))
        if r is None and not addr: continue
        x,y=g(e)
        pts.append((x,y,r,t.get('name','').strip() if r is not None else '',addr))
    for b in B:
        poly=list(zip(b['p'][0::2],b['p'][1::2]))
        xs=[p[0] for p in poly];ys=[p[1] for p in poly]
        x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
        t=ways.get(b['id'],{})
        o=overrides.get(str(b['id']),{})
        own=o.get('name') or b.get('n') or t.get('addr:housename','')
        inside=[p for p in pts if x0<=p[0]<=x1 and y0<=p[1]<=y1 and pip(p[0],p[1],poly)]
        ten=[];seen={own.lower()}
        for p in sorted((p for p in inside if p[2] is not None),key=lambda p:(p[2],p[3].lower())):
            if p[3].lower() in seen: continue
            seen.add(p[3].lower());ten.append(p[3])
        ad=short_address(t.get('addr:housenumber'),t.get('addr:street'))
        if not ad:
            # every point inside agrees on the street: take the lowest number as the building's address
            inn=sorted(set(p[4] for p in inside if p[4]))
            if inn and len(set(a.split(' ',1)[1] for a in inn))==1: ad=inn[0]
        b['n']=own
        if ten: b['tn']=ten[:8]
        if ad: b['ad']=ad
    return B

def coverage(B):
    c={'name':0,'tenant':0,'address':0,'none':0}
    for b in B: c['name' if b.get('n') else 'tenant' if b.get('tn') else 'address' if b.get('ad') else 'none']+=1
    return c
