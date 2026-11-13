// The downtown scale model ("Brick and Clay", designed by June Holloway's brief in the design thread).
// Plain canvas, no build step. Ported from the design mockup; the mockup's example toggles are replaced
// by a live scene from app.js (weather, council, closures, events, open bars and restaurants).
//
//   const model = startModel({ canvas, map, onPick, onHover, onView });
//   model.update(scene)   // see app.js buildScene() for the shape
//   model.zoomIn() / zoomOut() / canZoom(±1) / pan(fx, fy) / home() / lookAt(b) / highlight(b)
//
// The canvas fills whatever box the page gives it. The camera only moves when someone drags, zooms or picks
// something; it never wanders off on its own.
//
// map is public/model/downtown.json (tools/model/prep.py). Drop in a newer one and nothing here changes.
import { loadTrees, loadFlags, drawTree as drawTreeSp, treeOutline, dayOfYear, look, windOn, windKey, makeBlowing, drawFlag } from './trees.js';

export function startModel({ canvas: cv0, map: MAP, trees: TREES = null, onPick = () => {}, onHover = () => {}, onView = () => {} }) {
MAP = JSON.parse(JSON.stringify(MAP)); // the tower fix-up below edits it
const PAL=[
 ['Pine night','#1d2a2b','letterbox, deep shade'],['Loblolly','#2b7448','pine trees'],['Pine','#3d9a4f','leafy trees'],['Bermuda','#5cb648','lawn'],['Fescue','#8ad05a','lawn light'],
 ['Red clay','#cf5a36','bare ground, rail bed'],['Clay light','#f0965a','paths'],['Old brick','#b23f2c','mills, depot'],['Brick','#e05a3c','storefronts'],['Mortar','#f5dba6','sidewalks, trim'],
 ['Limestone','#f2e6cb','tower, civic'],['Concrete','#cfc6b3','municipal'],['Slate','#4a68b0','roofs'],['Tin','#9cc6da','metal roofs, rails'],['Asphalt','#57566a','roads'],
 ['Wet asphalt','#434862','rain roads'],['Line gold','#ffd23f','road paint'],['Tobacco','#f7a823','accent, flags'],['Paper','#fff3d6','the paper'],['Plum ink','#2c2147','shadows, text'],
 ['Haw River','#37a6dc','water, glass'],['Aggie blue','#2452c4','flags'],['Window glow','#ffd75e','lit windows'],['Barrel orange','#ff7426','closures']
];
const C=Object.fromEntries(PAL.map(([n,h])=>[n,h]));
const SH=C['Plum ink'],HI='#fff6e4',GLOW=C['Window glow'],BULB='#fff1c2';
const rad=Math.PI/180;

// ---------- time and sun (Greensboro, America/New_York) ----------
const LAT=36.0726,LON=-79.792;
function sunPos(d){const n=d.getTime()/86400000+2440587.5-2451545.0;const L=(280.46+0.9856474*n)%360,g=((357.528+0.9856003*n)%360)*rad;const lam=(L+1.915*Math.sin(g)+0.02*Math.sin(2*g))*rad,eps=(23.439-4e-7*n)*rad;
  const ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam)),dec=Math.asin(Math.sin(eps)*Math.sin(lam));const gmst=((18.697374558+24.06570982441908*n)%24+24)%24;const ha=(gmst*15+LON)*rad-ra;const la=LAT*rad;
  const alt=Math.asin(Math.sin(la)*Math.sin(dec)+Math.cos(la)*Math.cos(dec)*Math.cos(ha));const A=Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(la)-Math.tan(dec)*Math.cos(la));return{alt:alt/rad,az:((A/rad+180)%360+360)%360}}
const nyParts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23',weekday:'short'}).formatToParts(d).map(p=>[p.type,p.value]));
function nyDate(h,m){const now=new Date(),p=nyParts(now);const guess=Date.UTC(+p.year,+p.month-1,+p.day,h,m);const q=nyParts(new Date(guess));const off=(Date.UTC(+q.year,+q.month-1,+q.day,+q.hour,+q.minute)-guess);return new Date(guess-off)}
const fmtTime=d=>{const p=nyParts(d);let h=+p.hour%12;if(!h)h=12;return h+':'+p.minute.padStart(2,'0')};
const ampm=d=>+nyParts(d).hour<12?'AM':'PM';
function sunTimes(){const base=nyDate(0,0).getTime();let rise=null,set=null,prev=sunPos(new Date(base)).alt;for(let m=2;m<1440;m+=2){const a=sunPos(new Date(base+m*60000)).alt;if(prev<-0.833&&a>=-0.833)rise=new Date(base+m*60000);if(prev>=-0.833&&a<-0.833)set=new Date(base+m*60000);prev=a}return{rise,set}}
const PREVIEW={dawn:[6,52],day:[12,30],dusk:[17,20],night:[22,45]};
// ?date=2026-04-05 previews the trees on another day of the year
const DATEQ=(()=>{const q=new URLSearchParams(location.search).get('date');const d=q&&new Date(q+'T12:00:00-05:00');return d&&!isNaN(d)?d:null})();
const sceneDate0=()=>DATEQ||new Date();
const sceneDate=()=>S.time==='now'?new Date():nyDate(...PREVIEW[S.time]);

// ---------- geometry ----------
// W,H: the view canvas in canvas pixels. VS: canvas pixels per model pixel (the render scale; up to RESMAX for sharper
// detail, below 1 when zoomed far out). Model pixels are the units every drawing routine below works in.
let W=800,H=450,VS=1;const RESMAX=2,TILE=512;const TW=16,TH=8,ZPM=2.0,M=MAP.M,GX=MAP.GX,GY=MAP.GY,MARG=60,MAXH=270;
const BW=Math.ceil((GX+GY)*TW+2*MARG),BH=Math.ceil((GX+GY)*TH+MAXH+2*MARG+20);
const BOX=GY*TW+MARG,BOY=MAXH+MARG;
let ox=BOX,oy=BOY;
const P=(gx,gy,z=0)=>[ox+(gx-gy)*TW,oy+(gx+gy)*TH-z];
const pairs=a=>{const r=[];for(let i=0;i<a.length;i+=2)r.push([a[i],a[i+1]]);return r};
const cache=new Map();const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function mix(a,b,t){const k=a+b+t;let v=cache.get(k);if(v)return v;const A=hex(a),B=hex(b);v='#'+A.map((x,i)=>Math.round(x+(B[i]-x)*t).toString(16).padStart(2,'0')).join('');cache.set(k,v);return v}
const hash=(a,b)=>{const s=Math.sin(a*12.9898+b*78.233)*43758.5453;return s-Math.floor(s)};
function pip(x,y,pts){let ins=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ins=!ins}return ins}
function hull(p){p=p.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],up=[];for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q)}for(let i=p.length-1;i>=0;i--){const q=p[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0)up.pop();up.push(q)}up.pop();lo.pop();return lo.concat(up)}

// ---------- canvases ----------
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const cv=cv0,ctx=cv.getContext('2d');
let Wc,Ec,Gc,Tc,w,E,GL,tc;
function makeLayers(){Wc=mk(W,H);Ec=mk(W,H);Gc=mk(W,H);Tc=mk(W,H);w=Wc.getContext('2d');E=Ec.getContext('2d');GL=Gc.getContext('2d');tc=Tc.getContext('2d');cv.width=W;cv.height=H}
makeLayers();
let TGT={c:null,e:null,g:null};
// BT: the transform from model pixels to the canvas being drawn (set per tile or per frame); routines that set their
// own transform (ground, shadows) start from it.
let BT=[1,0,0,1,0,0];
const setT=(...cs)=>{for(const c of cs)c.setTransform(...BT)};
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const S={time:'now',wx:'clear',labels:false};
{const t=new URLSearchParams(location.search).get('time');if(PREVIEW[t])S.time=t}
// The live scene. app.js replaces it through update(); everything defaults to a quiet town.
let L={version:0,wx:'clear',storm:false,fog:false,cloudy:false,windMph:0,tempF:null,council:{lit:false,inSession:false},
  lit:new Map(),strings:new Set(),crowds:[],trucks:[],closures:[],bubbles:[],focus:[],signs:[]};
let signRects=[];
let WIND=windOn(0,0,null),DOY=dayOfYear(sceneDate0());const blowing=makeBlowing();
let SUN=sunPos(new Date());
const evening=()=>SUN.alt<4,night=()=>SUN.alt<-8,lampsOn=()=>SUN.alt<2;
function surf(col,top){if(S.wx==='snow'&&top)return mix(col,'#f5f7fb',.78);if(S.wx==='pollen'&&top)return mix(col,'#e8d860',.16);return col}

function erase(p){for(const e of [TGT.e,TGT.g]){e.globalCompositeOperation='destination-out';e.fillStyle='#000';e.fill(p);e.globalCompositeOperation='source-over'}}
function path(pts){const p=new Path2D();p.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)p.lineTo(pts[i][0],pts[i][1]);p.closePath();return p}
function poly(c,pts,fill,stroke){const p=path(pts);c.fillStyle=fill;c.fill(p);if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke(p)}if(c===TGT.c)erase(p)}
function line(c,a,b,col,lw=1){c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.strokeStyle=col;c.lineWidth=lw;c.stroke()}
function fr(c,x,y,ww,hh,col){c.fillStyle=col;c.fillRect(x,y,ww,hh);if(c===TGT.c){TGT.e.clearRect(x,y,ww,hh);TGT.g.clearRect(x,y,ww,hh)}}
function circ(c,x,y,r,col){const p=new Path2D();p.arc(x,y,r,0,7);c.fillStyle=col;c.fill(p);if(c===TGT.c)erase(p)}
const eq=(q,col)=>{TGT.e.fillStyle=col;TGT.e.fill(path(q))};
const ed=(p,col,s=1)=>{TGT.e.fillStyle=col;TGT.e.fillRect(Math.round(p[0]-s/2),Math.round(p[1]-s/2),s,s)};
function eg(x,y,r,al,sy=1,col='255,205,120'){const G=TGT.g;G.save();G.translate(x,y);G.scale(1,sy);const gr=G.createRadialGradient(0,0,0,0,0,r);gr.addColorStop(0,`rgba(${col},${al})`);gr.addColorStop(1,`rgba(${col},0)`);G.fillStyle=gr;G.fillRect(-r,-r,r*2,r*2);G.restore()}

// ---------- buildings ----------
const PART=Object.fromEntries((MAP.PT||[]).map(p=>[p.id,p]));
// The OSM outline 208115796 covers both towers. Use its real 3D parts instead:
// Lincoln Financial Tower (1990) and the Jefferson Standard Building (1923), joined by a low connector.
(()=>{const ob=MAP.B.find(b=>b.id===208115796);if(!ob||!PART[341049142]||!PART[467218959])return;
  ob.p=[44.85,46.66,46.42,46.72,45.97,50.57,44.6,50.42];ob.l=4;ob.h=16;ob.n='';ob.t='office';
  MAP.B.push({id:341049142,p:PART[341049142].p,l:20,h:79,t:'office',n:'Lincoln Financial Tower'});
  MAP.B.push({id:467218959,p:PART[467218959].p,l:18,h:65,t:'office',n:'Jefferson Standard Building'})})();
const SPECIAL={341049142:'tower',467218959:'jsb',208101229:'kress',208202822:'theatre',326037856:'city',264852482:'depot',1064222230:'tanger',208101224:'icrc',133178249:'ballpark'};
const brickW=['#a2503a','#8f4232','#b0604a','#7e4436','#b9714f','#c79a72','#d9c9a8','#e6e0d4','#9a5440'];
const pastW=[C.Mortar,C.Paper,'#ffd59a','#c9eeb0','#ffcdc2','#c8e4f5',C.Limestone];
const roofsF=['#e9e8e3','#dcdbd6','#c8c7c2','#b3b1ab','#8f8d88','#6e6c6a','#d8d2c4'];
const roofsH=['#55555c','#4a4440','#6b5a4e','#7a3e34','#5c6a72','#8a8a86'];
const awnC=['#23303d','#6e2626','#2c4636','#34343a','#7a5a34','#1f3f5f'];
const blds=MAP.B.map((b,i)=>{
  let pts=pairs(b.p);let A=0;for(let k=0;k<pts.length;k++){const[a,c]=pts[k],[d,e]=pts[(k+1)%pts.length];A+=a*e-d*c}A/=2;if(A<0)pts.reverse();
  const area=Math.abs(A)*M*M;const t=b.t||'yes';const r=hash(b.id%9973,7);
  const F=b.f||null,Fok=F&&F.confidence!=='low';
  let lv=b.l||(F&&F.floors&&!b.h?F.floors:0);if(!lv){lv=({house:2,detached:2,residential:2,apartments:3,office:3,commercial:2,retail:2,industrial:1,parking:4,garage:1,shed:1,garages:1,school:2,university:3,dormitory:4,government:3,hotel:4,church:2,train_station:2,roof:1,yes:2})[t]||2;if((t==='yes'||t==='retail')&&r>.6)lv++;if(area<45)lv=1}
  if(SPECIAL[b.id]==='kress'){delete b.tr;delete b.tb}
  const hm=(b.tb>2.5?b.tb:0)||(b.id!==208115796&&b.lh>2.5?b.lh:0)||b.h||lv*3.6;if(b.lh>2.5&&!b.l&&!(F&&F.floors))lv=Math.max(1,Math.round(b.lh/3.8));const hpx=Math.min(250,hm*ZPM);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),sums=pts.map(p=>p[0]+p[1]);
  const o={i,id:b.id,pts,t,name:b.n,lv,hm,hpx,area,special:SPECIAL[b.id]||'',minx:Math.min(...xs),maxx:Math.max(...xs),miny:Math.min(...ys),maxy:Math.max(...ys),key:(Math.min(...sums)+Math.max(...sums))/2,cx:xs.reduce((a,c)=>a+c,0)/xs.length,cy:ys.reduce((a,c)=>a+c,0)/ys.length};
  const pick=(arr,s=3)=>arr[Math.floor(hash(b.id%7919,s)*arr.length)];
  if(o.special==='tower'){o.wall='#ece4d2';o.roof='#cfc6b3';o.win=3.2;o.cornice=1}
  else if(o.special==='kress'){o.wall='#f0e4c4';o.roof='#cdc6b8';o.win=2.6;o.cornice=1;o.shop=1;o.lv=4;o.piers=1}
  else if(o.special==='jsb'){o.wall='#e9e0cc';o.roof='#cdc6b8';o.win=2.9;o.cornice=1;o.arch=1}
  else if(b.mat==='brick'&&!o.special&&!['house','detached','residential'].includes(t)){o.wall=pick(brickW);o.roof=pick(roofsF);o.shop=['retail','yes','commercial'].includes(t);o.cornice=1}
  else if(lv>=8){o.wall=pick([C.Limestone,'#bfe0ef','#e8dccb','#a9d4ea']);o.roof=pick(roofsF);o.win=3.2}
  else if(t==='parking'){o.wall=C.Concrete;o.roof='#b9b2a4';o.garage=1}
  else if(t==='church'){o.wall=pick([C.Brick,C['Old brick'],C.Limestone]);o.roof='#55555c';o.hip=1}
  else if(['house','detached','residential'].includes(t)&&area<400){o.wall=pick(pastW);o.roof=pick(roofsH);o.hip=1}
  else if(['government','office'].includes(t)){o.wall=pick([C.Limestone,C.Concrete,'#e9d2b0','#d8e2ea']);o.roof=pick(roofsF);o.cornice=1}
  else if(['university','school','dormitory','train_station'].includes(t)){o.wall=pick([C['Old brick'],C.Brick,'#c8673f']);o.roof=pick([C.Slate,'#5e5e64',C.Tin]);o.cornice=1}
  else if(['apartments','hotel'].includes(t)){o.wall=pick(['#ffd59a','#f0b48a',C.Mortar,'#c8e4f5','#e9d2b0']);o.roof=pick(roofsF)}
  else if(t==='roof'){o.wall=C.Tin;o.roof=C.Tin;o.canopy=1;o.hpx=Math.min(o.hpx,9)}
  else{o.wall=pick(brickW);o.roof=pick(roofsF);o.shop=['retail','yes','commercial'].includes(t);o.cornice=1;o.awn=hash(b.id%5003,9)<.35?pick(awnC,11):null;o.tank=false}
  if(o.special==='depot'){o.wall=C['Old brick'];o.roof='#55555c';o.cornice=1}
  if(o.special==='city'){o.wall=C.Concrete;o.roof='#55555c'}
  if(o.special==='theatre'){o.wall='#ece6d8';o.roof='#cfcabe';o.lv=4;o.cornice=1;o.shop=0;o.awn=null}
  if(o.special==='tanger'){o.wall='#a9d4ea';o.roof='#e9e4da';o.win=2.4}
  if(o.special==='icrc'){o.wall=C.Brick;o.roof='#3f5aa8';o.band=1;o.shop=1}
  if(b.rc&&!['tower','jsb'].includes(o.special)&&!o.hip)o.roof=mix(b.rc,HI,.08);
  // what the street photos show (medium and high confidence only)
  if(Fok&&!['tower','jsb','kress','theatre'].includes(o.special)){
    if(F.wall_hex)o.wall=mix(F.wall_hex,HI,.06);if(F.trim_hex){o.trim=F.trim_hex;o.cornice=1}
    if(F.storefront!=null)o.shop=!!F.storefront;o.awn=F.awning_hex||null;
    const ws=F.window_style;if(ws==='curtain wall')o.curtain=1;else if(ws==='ribbon')o.ribbon=1;else if(ws==='arched')o.archAll=1}
  if(o.special==='tower'){o.hpx=190;o.hm=95}
  if(b.tr){o.tiers=b.tr.map(t=>{let q=pairs(t.p);let A=0;for(let i=0;i<q.length;i++){const[a,c]=q[i],[d,e]=q[(i+1)%q.length];A+=a*e-d*c}if(A<0)q.reverse();return{pts:q,h:t.h}}).sort((x,y)=>x.h-y.h);o.htop=Math.min(250,Math.max(...o.tiers.map(t=>t.h))*ZPM);o.hm=Math.max(o.hm,...o.tiers.map(t=>t.h))}
  o.tmax=(o.htop||o.hpx)/(2*TH);
  // rooftop units
  o.units=[];if(!o.hip&&!o.canopy&&area>140){const n=Math.min(4,1+Math.floor(area/500));for(let k=0;k<n*4&&o.units.length<n;k++){const ux=o.minx+(o.maxx-o.minx)*hash(b.id%997,20+k),uy=o.miny+(o.maxy-o.miny)*hash(b.id%991,40+k);if(pip(ux,uy,pts)&&pip(ux+.3,uy+.25,pts)&&pip(ux-.3,uy-.25,pts))o.units.push([ux,uy])}}
  return o;
}).sort((a,b)=>a.key-b.key);
const byId={};blds.forEach(b=>{byId[b.id]=b;if(b.special)byId[b.special]=b});
// Draw order. Sorting by the middle of each footprint goes wrong for long or L-shaped buildings, so order every pair
// that can overlap on screen by looking along the line of sight: on a vertical screen line (gx-gy fixed) the building
// whose footprint is crossed first (smaller gx+gy) is farther away and is drawn first.
(function orderBuildings(){
  const n=blds.length;const sr=blds.map(b=>{let s0=1e9,s1=-1e9,u0=1e9,u1=-1e9;for(const[x,y] of b.pts){const s=x-y,u=x+y;if(s<s0)s0=s;if(s>s1)s1=s;if(u<u0)u0=u;if(u>u1)u1=u}return{s0,s1,u0,u1,top:(b.htop||b.hpx)+24}});
  const cut=(b,sv)=>{const us=[];const p=b.pts;for(let k=0;k<p.length;k++){const a=p[k],q=p[(k+1)%p.length];const sa=a[0]-a[1],sb=q[0]-q[1];if((sa<sv)!==(sb<sv)){const t=(sv-sa)/(sb-sa);us.push(a[0]+a[1]+t*(q[0]+q[1]-a[0]-a[1]))}}return us.sort((x,y)=>x-y)};
  const after=blds.map(()=>[]),indeg=new Array(n).fill(0);
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const A=sr[i],B=sr[j];const s0=Math.max(A.s0,B.s0),s1=Math.min(A.s1,B.s1);if(s1<=s0)continue;
    // screen-y overlap (model pixels): footprint u range times TH, raised by the height
    if(A.u1*TH<B.u0*TH-B.top||B.u1*TH<A.u0*TH-A.top)continue;
    let va=0,vb=0;for(let k=1;k<=7;k++){const sv=s0+(s1-s0)*k/8;const ua=cut(blds[i],sv),ub=cut(blds[j],sv);if(ua.length<2||ub.length<2)continue;
      if(ua[ua.length-1]<=ub[0]+1e-3)va++;else if(ub[ub.length-1]<=ua[0]+1e-3)vb++;
      else{// interleaved (an L or U wrapped round the other): compare the nearest pieces
        const ma=(ua[0]+ua[ua.length-1])/2,mb=(ub[0]+ub[ub.length-1])/2;if(ma<mb)va+=.5;else vb+=.5}}
    if(!va&&!vb)continue;if(va>=vb){after[i].push(j);indeg[j]++}else{after[j].push(i);indeg[i]++}}
  const done=new Array(n).fill(false),out=[];
  for(let c=0;c<n;c++){let best=-1;for(let i=0;i<n;i++)if(!done[i]&&indeg[i]===0&&(best<0||blds[i].key<blds[best].key))best=i;
    if(best<0)for(let i=0;i<n;i++)if(!done[i]&&(best<0||blds[i].key<blds[best].key))best=i; // a cycle: break it at the farthest
    done[best]=true;out.push(blds[best]);for(const j of after[best])indeg[j]--}
  blds.length=0;blds.push(...out);blds.forEach((b,i)=>b.i=i)})();

function litFrac(b){
  if(!evening())return 0;const n=night();
  const live=L.lit.get(b.id);if(live!=null)return live;
  switch(b.special){case'city':return L.council.lit?1:.03;case'theatre':return .3;case'depot':return .85;case'tanger':return .2;case'tower':return n?.06:.3}
  if(b.garage)return 1;if(b.lv>=8)return n?.08:.35;
  if(['apartments','residential','house','detached','dormitory','hotel'].includes(b.t))return n?.4:.35;
  if(b.shop)return n?.12:.55;if(b.t==='church')return .15;return n?.04:.3;
}
function visWalls(pts){const out=[];const n=pts.length;for(let k=0;k<n;k++){const a=pts[k],q=pts[(k+1)%n];const dx=q[0]-a[0],dy=q[1]-a[1];const L=Math.hypot(dx,dy);if(L<1e-4)continue;const nx=dy/L,ny=-dx/L;if(nx+ny<=0)continue;out.push({a,q,L,nx,ny,f:(ny-nx)/2+.5,k:(a[0]+a[1]+q[0]+q[1])/2})}return out.sort((x,y)=>x.k-y.k)}
const WP=(wl,u,z,out=0)=>P(wl.a[0]+(wl.q[0]-wl.a[0])*u+wl.nx*out,wl.a[1]+(wl.q[1]-wl.a[1])*u+wl.ny*out,z);
function drawPrism(c,pts,z0,h,wall,roof,noTop){
  for(const s of visWalls(pts))poly(c,[P(s.a[0],s.a[1],z0),P(s.q[0],s.q[1],z0),P(s.q[0],s.q[1],z0+h),P(s.a[0],s.a[1],z0+h)],mix(wall,SH,.32*(1-s.f)));
  if(!noTop)poly(c,pts.map(p=>P(p[0],p[1],z0+h)),surf(mix(roof,HI,.1),true));
}
function drawBuilding(c,b){drawBuilding0(c,b);if(b.tiers&&b.special!=='tower')drawTiers(c,b)}
// stepped roof levels measured by the lidar survey: each tier sits on the one below it
function drawTiers(c,b){let z0=b.hpx;const fr_=litFrac(b);let wi=7;
  for(const t of b.tiers){const z1=Math.min(250,t.h*ZPM);if(z1<z0+3)continue;
    for(const wl of visWalls(t.pts)){const col=mix(b.wall,SH,.32*(1-wl.f));poly(c,[WP(wl,0,z0),WP(wl,1,z0),WP(wl,1,z1),WP(wl,0,z1)],col);
      if(b.cornice&&z1-z0>8)poly(c,[WP(wl,0,z1-2.5),WP(wl,1,z1-2.5),WP(wl,1,z1),WP(wl,0,z1)],b.trim?mix(b.trim,SH,.3*(1-wl.f)):mix(col,HI,.35));
      const glass=mix(mix(C['Haw River'],'#2a3442',.45),SH,.12+.3*(1-wl.f)),lit=wl.f>.5?GLOW:mix(GLOW,'#ffb050',.3);
      const nw=Math.floor(wl.L*M/(b.win||3.4));if(nw<1)continue;
      for(let z=z0+2.2;z+3.4<z1-2.5;z+=7.4)for(let j=0;j<nw;j++){const u0=(j+.28)/nw,u1=(j+.72)/nw;const q4=[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,z+3.4),WP(wl,u0,z+3.4)];if(b.curtain){poly(c,q4,mix(glass,HI,.05))}else poly(c,q4,glass);if(hash(b.id%10007,wi++)<fr_)eq(q4,lit)}}
    poly(c,t.pts.map(p=>P(p[0],p[1],z1)),surf(mix(b.roof,HI,.1),true),surf(mix(b.roof,SH,.3),true));z0=z1}}
function drawBuilding0(c,b){
  if(b.special==='tower'){drawLFT(c,b);return}
  const pts=b.pts,hp=b.hpx;const fr_=litFrac(b);let wi=0;const walls=visWalls(pts);b.walls=walls;
  for(const wl of walls){
    const col=mix(b.wall,SH,.32*(1-wl.f));const{a,q}=wl;
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],hp),P(a[0],a[1],hp)],col);
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],3),P(a[0],a[1],3)],mix(col,SH,.18));
    if(b.canopy)continue;
    if(b.curtain){const gl=mix(mix(b.wall,'#2c3a48',.5),SH,.1+.3*(1-wl.f));poly(c,[WP(wl,0,3),WP(wl,1,3),WP(wl,1,hp-2),WP(wl,0,hp-2)],gl);const lvp=hp/b.lv;for(let l=1;l<b.lv;l++)line(c,WP(wl,0,l*lvp),WP(wl,1,l*lvp),mix(gl,HI,.25));const nm=Math.max(1,Math.round(wl.L*M/1.8));for(let k=1;k<nm;k++)line(c,WP(wl,k/nm,3),WP(wl,k/nm,hp-2),mix(gl,HI,.15));if(fr_)for(let l=0;l<b.lv;l++)for(let k=0;k<nm;k++)if(hash(b.id%10007,wi++)<fr_*.7)eq([WP(wl,k/nm,l*lvp+1),WP(wl,(k+1)/nm,l*lvp+1),WP(wl,(k+1)/nm,(l+1)*lvp-1),WP(wl,k/nm,(l+1)*lvp-1)],GLOW);continue}
    if(b.cornice&&hp>10){poly(c,[WP(wl,0,hp-3),WP(wl,1,hp-3),WP(wl,1,hp),WP(wl,0,hp)],b.trim?mix(b.trim,SH,.3*(1-wl.f)):mix(col,HI,.35));line(c,WP(wl,0,hp-3.5),WP(wl,1,hp-3.5),mix(col,SH,.35))}
    const lvpx=hp/b.lv;const glass=mix(mix(C['Haw River'],'#2a3442',.45),SH,.12+.3*(1-wl.f));const lit=wl.f>.5?GLOW:mix(GLOW,'#ffb050',.3);
    if(b.garage){for(let l=0;l<b.lv;l++){const z=l*lvpx+lvpx*.35,z2=z+lvpx*.42;const q4=[WP(wl,.03,z),WP(wl,.97,z),WP(wl,.97,z2),WP(wl,.03,z2)];poly(c,q4,mix(b.wall,SH,.55));if(fr_)eq(q4,'rgba(255,236,190,.5)')}continue}
    const spacing=(b.win||3.4)/M;const nw=Math.floor(wl.L/spacing);
    // storefront
    let l0=0;
    if(b.shop&&wl.L*M>5){l0=1;const sz=Math.min(lvpx*.75,6.5);const q4=[WP(wl,.04,1.2),WP(wl,.96,1.2),WP(wl,.96,1.2+sz),WP(wl,.04,1.2+sz)];poly(c,q4,mix(glass,SH,.15));
      const nd=Math.max(1,Math.floor(wl.L*M/8));for(let k=0;k<nd;k++){const u=(k+.5)/nd;line(c,WP(wl,u,1.2),WP(wl,u,1.2+sz),mix(col,SH,.1))}
      if(fr_)eq(q4,mix(GLOW,'#ffffff',.25));
      if(b.awn){const an=Math.max(4,Math.round(wl.L*M/1.2));for(let k=0;k<an;k++){const u0=.03+.94*k/an,u1=.03+.94*(k+1)/an;poly(c,[WP(wl,u0,2+sz),WP(wl,u1,2+sz),WP(wl,u1,sz-.5,.13),WP(wl,u0,sz-.5,.13)],surf(k%2?b.awn:mix(b.awn,HI,.12),true))}}}
    if(nw<1)continue;
    for(let l=l0;l<b.lv;l++){
      const z=l*lvpx+lvpx*.3,wh=Math.max(2,lvpx*.45);if(z+wh>hp-(b.cornice?4:1.5))break;
      const ar=(b.arch&&l>=b.lv-2)||b.archAll;
      if(b.ribbon){const q4=[WP(wl,.03,z),WP(wl,.97,z),WP(wl,.97,z+wh),WP(wl,.03,z+wh)];poly(c,q4,glass);if(hash(b.id%10007,wi++)<fr_)eq(q4,lit);continue}
      for(let j=0;j<nw;j++){const u0=(j+.28)/nw,u1=(j+.72)/nw;const zt=ar?z+wh*1.5:z+wh;const q4=[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,zt),WP(wl,u0,zt)];poly(c,q4,glass);if(ar){const du=(u1-u0)*.25;poly(c,[WP(wl,u0+du,zt),WP(wl,u1-du,zt),WP(wl,u1-du,zt+1.2),WP(wl,u0+du,zt+1.2)],glass)}
        if(wh>=3)line(c,WP(wl,u0,z+wh-.5),WP(wl,u1,z+wh-.5),mix(glass,HI,.4));
        if(hash(b.id%10007,wi++)<fr_)eq(q4,lit)}
    }
    if(b.band){poly(c,[WP(wl,0,hp-8),WP(wl,1,hp-8),WP(wl,1,hp-4),WP(wl,0,hp-4)],mix(C.Mortar,SH,.3*(1-wl.f)))}
  }
  let fi=0;for(let k=1;k<pts.length;k++)if(pts[k][0]+pts[k][1]>pts[fi][0]+pts[fi][1])fi=k;line(c,P(pts[fi][0],pts[fi][1]),P(pts[fi][0],pts[fi][1],hp),mix(b.wall,HI,.35));
  if(b.special==='kress'){const wl=walls.slice().sort((x,y)=>y.nx-x.nx)[0];if(wl){const col=mix(b.wall,SH,.32*(1-wl.f));
    const np=Math.max(3,Math.round(wl.L*M/3));for(let k=0;k<=np;k++){const u=k/np;line(c,WP(wl,u,9,.01),WP(wl,u,hp-1,.01),mix(col,HI,.45))}
    const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const flip=Q[0]<A[0];const du=1/(Math.abs(Q[0]-A[0])||1);const txt='KRESS',cols=txt.length*4-1;{const v0=.5-(cols+2)*du/2,v1=.5+(cols+2)*du/2;poly(c,[WP(wl,flip?1-v0:v0,hp-8,.015),WP(wl,flip?1-v1:v1,hp-8,.015),WP(wl,flip?1-v1:v1,hp-.5,.015),WP(wl,flip?1-v0:v0,hp-.5,.015)],'#3a3226')}for(const[u0,u1]of[[.16,.36],[.4,.6],[.64,.84]]){poly(c,[WP(wl,u0,9,.01),WP(wl,u1,9,.01),WP(wl,u1,hp-10,.01),WP(wl,u0,hp-10,.01)],mix('#4e5e44',SH,.2*(1-wl.f)));for(let z=12;z<hp-10;z+=5)line(c,WP(wl,u0,z,.012),WP(wl,u1,z,.012),'#8a9a6e');for(const u of[u0+(u1-u0)/3,u0+2*(u1-u0)/3])line(c,WP(wl,u,9,.012),WP(wl,u,hp-10,.012),'#8a9a6e')}
    for(let i=0;i<txt.length;i++){const g=FONT[txt[i]];for(let r=0;r<5;r++)for(let k=0;k<3;k++){if(g[r*3+k]!=='1')continue;const v=.5-cols*du/2+(i*4+k+.5)*du;const p=WP(wl,flip?1-v:v,hp-2-r,.02);fr(c,Math.round(p[0]),Math.round(p[1]),1,1,'#b8862a')}}}}
  if(b.special==='jsb'&&PART[807732943]){const cp=pairs(PART[807732943].p);const ch=(71-65)*ZPM;b.crown=cp;
    poly(c,pts.map(p=>P(p[0],p[1],hp)),surf(mix(b.roof,HI,.08),true),surf(mix(b.roof,SH,.3),true));
    for(const wl of visWalls(cp)){const col=mix(b.wall,SH,.32*(1-wl.f));poly(c,[WP(wl,0,hp),WP(wl,1,hp),WP(wl,1,hp+ch),WP(wl,0,hp+ch)],col);poly(c,[WP(wl,0,hp+ch-2),WP(wl,1,hp+ch-2),WP(wl,1,hp+ch),WP(wl,0,hp+ch)],mix(col,HI,.35));
      const nw=Math.floor(wl.L*M/2.9);const glass=mix('#3a4656',SH,.1+.3*(1-wl.f));for(let j=0;j<nw;j++){const u0=(j+.3)/nw,u1=(j+.7)/nw;poly(c,[WP(wl,u0,hp+2),WP(wl,u1,hp+2),WP(wl,u1,hp+7),WP(wl,u0,hp+7)],glass)}}
    poly(c,cp.map(p=>P(p[0],p[1],hp+ch)),surf(mix(b.roof,HI,.1),true));return}
  if(b.hip&&b.area<900){const apex=[b.cx,b.cy];const rh=Math.min(12,Math.sqrt(b.area)*.5);const tris=[];const n=pts.length;
    for(let k=0;k<n;k++){const a=pts[k],q=pts[(k+1)%n];const dx=q[0]-a[0],dy=q[1]-a[1];tris.push({a,q,k:(a[0]+a[1]+q[0]+q[1])/2,vis:(dy-dx)>0})}
    tris.sort((x,y)=>(x.vis-y.vis)||(x.k-y.k));
    for(const t of tris)poly(c,[P(t.a[0],t.a[1],hp),P(t.q[0],t.q[1],hp),P(apex[0],apex[1],hp+rh)],surf(t.vis?mix(b.roof,HI,.12):mix(b.roof,SH,.22),true));
    if(b.t==='church'){drawPrism(c,[[b.cx-.12,b.cy-.12],[b.cx+.12,b.cy-.12],[b.cx+.12,b.cy+.12],[b.cx-.12,b.cy+.12]],hp,rh+6,b.wall,b.roof);const t0=P(b.cx,b.cy,hp+rh+6);poly(c,[[t0[0]-3,t0[1]],[t0[0]+3,t0[1]],[t0[0],t0[1]-14]],surf(C.Slate,true))}
  }else{
    poly(c,pts.map(p=>P(p[0],p[1],hp)),surf(mix(b.roof,HI,.08),true),surf(mix(b.roof,SH,.3),true));
    if(b.area>200&&!b.canopy){const s=Math.max(.8,1-1.2/Math.sqrt(b.area));poly(c,pts.map(p=>P(b.cx+(p[0]-b.cx)*s,b.cy+(p[1]-b.cy)*s,hp)),surf(mix(b.roof,SH,.1),true))}
    for(const[ux,uy] of b.units){drawPrism(c,[[ux-.17,uy-.12],[ux+.17,uy-.12],[ux+.17,uy+.12],[ux-.17,uy+.12]],hp,4,'#c9cfd6','#e4e8ec');const tp=P(ux,uy,hp+4);circ(c,tp[0],tp[1],1.3,'#8a93a0')}
    if(b.tank){const tx=b.cx,ty=b.cy;[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]].forEach(([dx,dy])=>line(c,P(tx+dx,ty+dy,hp),P(tx+dx,ty+dy,hp+7),'#5a3f2c'));const oct=[...Array(8)].map((_,k)=>[tx+Math.cos(k*Math.PI/4)*.16,ty+Math.sin(k*Math.PI/4)*.16]);drawPrism(c,oct,hp+7,9,'#9a6a46','#9a6a46',true);const ap=P(tx,ty,hp+20);poly(c,oct.map(p=>P(p[0],p[1],hp+16)).concat([]),surf('#6a4a36',true));poly(c,[P(tx-.16,ty,hp+16),P(tx,ty+.16,hp+16),P(tx+.16,ty,hp+16),ap],surf('#7a5236',true))}
  }
  // Galyon Depot: red brick with a limestone balustrade (its columned portico faces Washington St, away from this view)
  if(b.special==='depot'){for(const wl of walls){if(wl.L*M<6)continue;const col=mix('#e8e0cc',SH,.3*(1-wl.f));poly(c,[WP(wl,0,hp-3,.01),WP(wl,1,hp-3,.01),WP(wl,1,hp+2,.01),WP(wl,0,hp+2,.01)],col);const n=Math.round(wl.L*M/.8);for(let k=1;k<n;k++){const u=k/n;line(c,WP(wl,u,hp-2.5,.02),WP(wl,u,hp+1,.02),mix(col,SH,.25))}}}
  // Carolina Theatre (1927): cream neoclassical front on South Greene St with pediment, marquee and two blade signs
  if(b.special==='theatre'){const wl=(walls.filter(w=>w.nx>.8).sort((x,y)=>y.L-x.L)[0])||walls[0];if(wl){const col=mix(b.wall,SH,.3*(1-wl.f));
    for(let k=1;k<6;k++){const u=.12+.76*k/6;line(c,WP(wl,u,14,.01),WP(wl,u,hp-3,.01),mix(col,HI,.5))}
    const glass=mix('#3a4656',SH,.1+.3*(1-wl.f));for(let k=0;k<5;k++){const u0=.12+.76*k/5+.03,u1=.12+.76*(k+1)/5-.03;poly(c,[WP(wl,u0,17),WP(wl,u1,17),WP(wl,u1,hp-6),WP(wl,u0,hp-6)],glass);line(c,WP(wl,u0,(17+hp-6)/2),WP(wl,u1,(17+hp-6)/2),mix(col,HI,.3))}
    poly(c,[WP(wl,.12,hp),WP(wl,.88,hp),WP(wl,.5,hp+7)],mix(col,HI,.25));line(c,WP(wl,.12,hp),WP(wl,.5,hp+7),mix(col,SH,.25));line(c,WP(wl,.5,hp+7),WP(wl,.88,hp),mix(col,SH,.25));
    poly(c,[WP(wl,.06,9,.0),WP(wl,.94,9),WP(wl,.94,13,.3),WP(wl,.06,13,.3)],'#f4efe2');poly(c,[WP(wl,.06,9),WP(wl,.94,9),WP(wl,.94,8,.3),WP(wl,.06,8,.3)],'#bdb5a2');line(c,WP(wl,.3,11,.31),WP(wl,.7,11,.31),'#2a3a5a');
    for(const u of [.04,.96]){poly(c,[WP(wl,u,12),WP(wl,u,hp+10),WP(wl,u,hp+10,.32),WP(wl,u,12,.32)],'#3a2a2c');for(let k=0;k<8;k++){const z=14+k*(hp-4)/8;fr(c,...WP(wl,u,z,.16).map(Math.round),1,1,'#e8c060')}
      if(lampsOn())for(let k=0;k<14;k++)ed(WP(wl,u,13+k*(hp-3)/14,.16),k%2?'#ff7a5a':'#ffe08a')}
    if(lampsOn()){for(let k=0;k<26;k++){const u=.07+.86*k/25;ed(WP(wl,u,13,.31),GLOW);ed(WP(wl,u,8.5,.31),GLOW)}eq([WP(wl,.06,9),WP(wl,.94,9),WP(wl,.94,13,.3),WP(wl,.06,13,.3)],'rgba(255,244,214,.55)')}}}
  if(L.strings.has(b.id)&&evening()){const wl=walls.slice().sort((x,y)=>(y.nx-x.nx))[0];if(wl){const cols=['#ffe9a8','#ff9a8a','#a8d8ff'];for(let k=0;k<=28;k++){const u=k/28;ed(WP(wl,u,12-Math.sin(u*Math.PI*3)**2*3,.35),cols[k%3])}}}
}
function drawLFT(c,b){
  const pts=b.pts,Z=m=>m*ZPM,top=Z(79),LIME='#ece4d2',DARK='#2c3940';
  const walls=visWalls(pts);b.walls=walls;const fr_=litFrac(b);let wi=0;
  for(const wl of walls){
    const{a,q}=wl;const short=wl.L*M<6;
    const col=short?mix(DARK,SH,.25*(1-wl.f)):mix(LIME,SH,.30*(1-wl.f));
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],top),P(a[0],a[1],top)],col);
    if(short){// the dark glass recesses at the stepped corners
      for(let l=1;l<20;l++){const z=Z(l*3.95);line(c,WP(wl,0,z),WP(wl,1,z),mix(col,HI,.14))}
      if(fr_)for(let l=0;l<20;l++)if(hash(b.id%977,wi++)<fr_*.8){const z=Z(l*3.95)+2;eq([WP(wl,.2,z),WP(wl,.8,z),WP(wl,.8,z+3),WP(wl,.2,z+3)],GLOW)}
      continue}
    const glass=mix('#3a4656',SH,.1+.3*(1-wl.f)),lit=wl.f>.5?GLOW:mix(GLOW,'#ffb050',.3);
    const nb=Math.max(1,Math.round(wl.L*M/6.2));
    const win=(u0,u1,z0,z1,arch)=>{const q4=[WP(wl,u0,z0),WP(wl,u1,z0),WP(wl,u1,z1),WP(wl,u0,z1)];poly(c,q4,glass);if(arch){const du=(u1-u0)*.25;poly(c,[WP(wl,u0+du,z1),WP(wl,u1-du,z1),WP(wl,u1-du,z1+1.4),WP(wl,u0+du,z1+1.4)],glass)}if(hash(b.id%10007,wi++)<fr_)eq(q4,lit)};
    for(const zm of [8,49,59.5,63.5])poly(c,[WP(wl,0,Z(zm)),WP(wl,1,Z(zm)),WP(wl,1,Z(zm)+1.5),WP(wl,0,Z(zm)+1.5)],mix(col,HI,.38));
    poly(c,[WP(wl,0,top-3),WP(wl,1,top-3),WP(wl,1,top),WP(wl,0,top)],mix(col,HI,.42));line(c,WP(wl,0,top-3.5),WP(wl,1,top-3.5),mix(col,SH,.3));
    for(let k=0;k<nb;k++){const u0=k/nb,u1=(k+1)/nb,uw=u1-u0;
      if(k>0)line(c,WP(wl,u0,Z(8)),WP(wl,u0,top-3),mix(col,HI,.28));
      win(u0+uw*.22,u1-uw*.22,1,Z(6),true);
      for(let zm=9.6;zm<47;zm+=3.95){win(u0+uw*.14,u0+uw*.42,Z(zm),Z(zm)+3.4);win(u0+uw*.58,u0+uw*.86,Z(zm),Z(zm)+3.4)}
      win(u0+uw*.14,u0+uw*.44,Z(50.3),Z(57.6),true);win(u0+uw*.56,u0+uw*.86,Z(50.3),Z(57.6),true);
      win(u0+uw*.22,u0+uw*.40,Z(60.6),Z(62.6));win(u0+uw*.60,u0+uw*.78,Z(60.6),Z(62.6));
      win(u0+uw*.14,u0+uw*.44,Z(65),Z(75.4),true);win(u0+uw*.56,u0+uw*.86,Z(65),Z(75.4),true)}
  }
  let fi=0;for(let k=1;k<pts.length;k++)if(pts[k][0]+pts[k][1]>pts[fi][0]+pts[fi][1])fi=k;line(c,P(pts[fi][0],pts[fi][1]),P(pts[fi][0],pts[fi][1],top),mix(LIME,HI,.4));
  poly(c,pts.map(p=>P(p[0],p[1],top)),surf(mix('#cfc6b3',HI,.08),true),surf(mix('#cfc6b3',SH,.3),true));
  if(!PART[341049143]||!PART[341049145])return;
  // green copper pyramid (OSM: 52 degree pyramidal roof, #558074) truncated by the clock lantern
  const base=pairs(PART[341049143].p),l0=pairs(PART[341049145].p);
  const cen=a=>[a.reduce((s,p)=>s+p[0],0)/a.length,a.reduce((s,p)=>s+p[1],0)/a.length];
  const lc=cen(l0),ln=l0.map(p=>[lc[0]+(p[0]-lc[0])*1.35,lc[1]+(p[1]-lc[1])*1.35]);
  const half=a=>{const c0=cen(a);let s=0;for(let i=0;i<a.length;i++){const p=a[i],q=a[(i+1)%a.length];s+=Math.hypot((p[0]+q[0])/2-c0[0],(p[1]+q[1])/2-c0[1])}return s/a.length};
  const zl=top+Z((half(base)-half(ln))*M*Math.tan(52*rad)),zt=Z(95);
  const GR=PART[341049143].rc||'#558074';const bc=cen(base);
  const fin=(p,z,h)=>{const s=P(p[0],p[1],z);fr(c,Math.round(s[0])-1,Math.round(s[1]-h),2,h,mix(LIME,SH,.15));fr(c,Math.round(s[0])-1,Math.round(s[1]-h)-1,1,1,LIME)};
  const front=p=>(p[0]-bc[0])+(p[1]-bc[1])>0;
  base.forEach(p=>{if(!front(p))fin(p,top,7)});
  const faces=base.map((p,i)=>{const q=base[(i+1)%4];const dx=q[0]-p[0],dy=q[1]-p[1],L=Math.hypot(dx,dy);const nx=dy/L,ny=-dx/L;return{i,p,q,lp:ln[i],lq:ln[(i+1)%4],nx,ny,vis:nx+ny}}).sort((a,b)=>a.vis-b.vis);
  for(const f of faces){const fsh=(f.ny-f.nx)/2+.5;const col=f.vis>0?mix(GR,SH,.35*(1-fsh)):mix(GR,HI,.06);
    poly(c,[P(f.p[0],f.p[1],top),P(f.q[0],f.q[1],top),P(f.lq[0],f.lq[1],zl),P(f.lp[0],f.lp[1],zl)],surf(col,true));
    if(f.vis>0)for(let k=1;k<8;k++){const u=k/8;line(c,P(f.p[0]+(f.q[0]-f.p[0])*u,f.p[1]+(f.q[1]-f.p[1])*u,top),P(f.lp[0]+(f.lq[0]-f.lp[0])*u,f.lp[1]+(f.lq[1]-f.lp[1])*u,zl),mix(col,SH,.18))}}
  base.forEach((p,i)=>{if(front(p)||front(ln[i]))line(c,P(p[0],p[1],top),P(ln[i][0],ln[i][1],zl),mix(GR,HI,.35))});
  base.forEach(p=>{if(front(p))fin(p,top,7)});
  ln.forEach(p=>{if(!front(p))fin(p,zt,4)});
  drawPrism(c,ln,zl-1,zt-zl+1,'#e4dccb','#cfc6b3');
  ln.forEach(p=>{if(front(p))fin(p,zt,4)});
  b.lantern=ln;b.lanternZ=zl;b.lanternTop=zt;
}
// Line of sight: from a point (gx,gy) at height z it runs toward the viewer along +gx,+gy and rises 2*TH model
// pixels per tile, so it passes through a prism if it meets the footprint before climbing past the prism's top.
function segHits(x,y,t,pts){if(pip(x,y,pts))return true;const x2=x+t,y2=y+t;
  for(let k=0;k<pts.length;k++){const[ax,ay]=pts[k],[bx,by]=pts[(k+1)%pts.length];const d1=(bx-ax)*(y-ay)-(by-ay)*(x-ax),d2=(bx-ax)*(y2-ay)-(by-ay)*(x2-ax);if((d1>0)===(d2>0))continue;const d3=(x2-x)*(ay-y)-(y2-y)*(ax-x),d4=(x2-x)*(by-y)-(y2-y)*(bx-x);if((d3>0)!==(d4>0))return true}return false}
function rayHits(b,gx,gy,zpx){if(b.minx>gx+b.tmax+.5||b.maxx<gx-.05||b.miny>gy+b.tmax+.5||b.maxy<gy-.05)return false;
  if(b.canopy&&pip(gx,gy,b.pts))return false; // under a canopy, not behind it
  const hit=(pts,top)=>{const t=(top-zpx)/(2*TH);return t>0&&segHits(gx,gy,t,pts)};
  if(hit(b.pts,b.hpx+(b.special==='jsb'?12:0)))return true;if(b.tiers)for(const t of b.tiers)if(hit(t.pts,Math.min(250,t.h*ZPM)))return true;return false}
/** Buildings standing between the viewer and any of the sample points [gx,gy,zpx]. */
function blockersFor(smp){const out=[];for(const b of blds){for(const[gx,gy,z] of smp)if(rayHits(b,gx,gy,z||0)){out.push(b);break}}return out}
const blockers=(gx,gy,zpx=0)=>blockersFor([[gx,gy,zpx]]);
function rect(cx,cy,dx,dy,len,wid){const L=Math.hypot(dx,dy)||1;const ux=dx/L,uy=dy/L,vx=-uy,vy=ux;const a=len/2,b=wid/2;return[[cx-ux*a-vx*b,cy-uy*a-vy*b],[cx+ux*a-vx*b,cy+uy*a-vy*b],[cx+ux*a+vx*b,cy+uy*a+vy*b],[cx-ux*a+vx*b,cy-uy*a+vy*b]]}

// ---------- ground and model base ----------
const RW=[16,14,12,10,8,4.5,5];
function polyPath(c,flat){c.beginPath();c.moveTo(flat[0],flat[1]);for(let i=2;i<flat.length;i+=2)c.lineTo(flat[i],flat[i+1])}
// vegetation mask from the 2024 NC OneMap aerial (1.5 m cells); everything else downtown is paved
const VG=(()=>{const v=MAP.VG;if(!v)return null;const a=new Uint8Array(v.w*v.h);v.rows.forEach((row,j)=>{let i=0,cur=0;row.split(',').forEach(t=>{const n=parseInt(t,16);if(cur)a.fill(1,j*v.w+i,j*v.w+i+n);i+=n;cur^=1})});return{r:v.r,w:v.w,h:v.h,a}})();
const isVeg=(gx,gy)=>{if(!VG)return true;const i=Math.floor(gx*VG.r),j=Math.floor(gy*VG.r);return i>=0&&j>=0&&i<VG.w&&j<VG.h&&VG.a[j*VG.w+i]===1};
function gcol(base,kind){let c=base;if(S.wx==='snow')c=mix(c,'#f5f7fb',kind==='road'?.15:kind==='walk'?.5:.72);if(S.wx==='pollen')c=mix(c,'#e8d860',.1);return c}
// bounding boxes (grid units) so a tile only strokes the streets that touch it
const bbOf=f=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(let i=0;i<f.length;i+=2){const x=f[i],y=f[i+1];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return[x0-2,y0-2,x1+2,y1+2]};
for(const r of MAP.R)r._bb=bbOf(r.p);for(const r of MAP.RL)r._bb=bbOf(r.p);for(const p of MAP.PK)p._bb=bbOf(p.p);for(const p of MAP.PL)p._bb=bbOf(p);for(const f of (MAP.FW||[]))f._bb=bbOf(f.p);for(const a of (MAP.GA||[]))a._bb=bbOf(a.p);
let TG=null;const inTG=bb=>!TG||!(bb[0]>TG[2]||bb[2]<TG[0]||bb[1]>TG[3]||bb[3]<TG[1]);
// The ground texture: one texel per 1.5 m. Where the 2024 aerial has been classified (MAP.GC) each texel takes the
// colour of what is really there (paving, asphalt, lawn, planting beds, bare ground); otherwise the vegetation mask.
const GC_COL=['#bdb7ab','#8f8c94','#5cb648','#6f9a4a','#b98a64','#37a6dc','#a9a39a'];
let GTEX=null;
function buildGroundTex(){const R=MAP.GC?MAP.GC.r:VG?VG.r:6,gw=Math.ceil(GX*R),gh=Math.ceil(GY*R);const cnv=mk(gw,gh),g=cnv.getContext('2d');const img=g.createImageData(gw,gh),d=img.data;
  const GCa=MAP.GC?(()=>{const v=MAP.GC,a=new Uint8Array(v.w*v.h);v.rows.forEach((row,j)=>{let i=0;row.split(',').forEach(t=>{const cls=parseInt(t[0],36),n=parseInt(t.slice(1),36);a.fill(cls,j*v.w+i,j*v.w+i+n);i+=n})});return a})():null;
  const kinds=['walk','road','grass','grass','grass','road','walk'];const pal=GC_COL.map((c0,k)=>hex(gcol(c0,kinds[k])));const lawn2=hex(gcol(mix(C.Bermuda,C.Fescue,.3),'grass'));
  for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){let cls;if(GCa)cls=GCa[Math.min(j,MAP.GC.h-1)*MAP.GC.w+Math.min(i,MAP.GC.w-1)];else cls=VG&&isVeg((i+.5)/R,(j+.5)/R)?2:0;
    let col=pal[cls];if(cls===2&&hash(i+7,j+3)<.4)col=lawn2;const n=(hash(i*.37+11,j*.71+5)-.5)*(cls===0||cls===6?10:cls===1?6:14);const o=(j*gw+i)*4;d[o]=col[0]+n;d[o+1]=col[1]+n;d[o+2]=col[2]+n;d[o+3]=255}
  g.putImageData(img,0,0);GTEX={c:cnv,R}}
function drawGround(c){
  setT(c);c.fillStyle='#3a2c26';c.fillRect(0,0,BW,BH);
  // table weave
  c.fillStyle='rgba(255,255,255,.025)';for(let y=0;y<BH;y+=4)c.fillRect(0,y,BW,1);
  // model base slab
  const D=18;const A=P(0,GY),B_=P(GX,GY),Cc=P(GX,0);
  c.fillStyle='rgba(0,0,0,.35)';c.beginPath();c.moveTo(A[0]+6,A[1]+D+8);c.lineTo(B_[0]+6,B_[1]+D+8);c.lineTo(Cc[0]+10,Cc[1]+D+8);c.lineTo(Cc[0]+10,Cc[1]);c.closePath();c.fill();
  poly(c,[A,B_,[B_[0],B_[1]+D],[A[0],A[1]+D]],'#a8744a');poly(c,[B_,Cc,[Cc[0],Cc[1]+D],[B_[0],B_[1]+D]],'#7d5236');
  for(let k=1;k<4;k++){line(c,[A[0],A[1]+k*D/4],[B_[0],B_[1]+k*D/4],'rgba(60,30,10,.18)');line(c,[B_[0],B_[1]+k*D/4],[Cc[0],Cc[1]+k*D/4],'rgba(40,20,5,.18)')}
  line(c,A,B_,'#f0d6b0');line(c,B_,Cc,'#d9b48c');
  c.setTransform(...BT);c.transform(TW,TH,-TW,TH,ox,oy);
  c.save();c.beginPath();c.rect(0,0,GX,GY);c.clip();
  c.imageSmoothingEnabled=false;c.drawImage(GTEX.c,0,0,GTEX.c.width/GTEX.R,GTEX.c.height/GTEX.R);c.imageSmoothingEnabled=true;
  // OSM areas the aerial can't name on its own: lawns, planted beds and plazas
  for(const a of (MAP.GA||[])){if(!inTG(a._bb))continue;polyPath(c,a.p);c.closePath();c.fillStyle=gcol(a.k==='grass'?C.Bermuda:a.k==='wood'?'#5a8a46':a.k==='bed'?'#7a5a3e':'#d2ccbf',a.k==='plaza'?'walk':'grass');c.fill();if(a.k==='plaza'){c.strokeStyle=gcol('#c4bdb0','walk');c.lineWidth=.6/M;c.stroke()}}
  MAP.PK.forEach(p=>{if(!inTG(p._bb))return;polyPath(c,p.p);c.closePath();c.fillStyle=gcol(p.k==='pitch'?'#79cf5e':C.Fescue,'grass');c.fill()});
  // footpaths (OSM footways and paths), drawn under the streets so crossings stay painted
  c.lineCap='round';c.lineJoin='round';
  for(const f of (MAP.FW||[])){if(!inTG(f._bb))continue;polyPath(c,f.p);c.strokeStyle=gcol(f.k==='steps'?'#c9c2b4':'#dcd6ca','walk');c.lineWidth=(f.k==='cycleway'?2.4:1.8)/M;c.stroke()}
  MAP.PL.forEach(p=>{if(!inTG(p._bb))return;polyPath(c,p);c.closePath();c.fillStyle=gcol(mix(C.Asphalt,C.Concrete,.4),'road');c.fill();c.strokeStyle=gcol('#d8d4ca','walk');c.lineWidth=1.2/M;c.stroke()});
  // painted stalls in the surface lots
  if(ST.length){c.strokeStyle=gcol('#eeeae2','road');c.lineWidth=.035;c.lineCap='butt';c.beginPath();for(const s of ST){const[x,y,ux,uy,ax,ay]=stallFrame(s);if(TG&&(x<TG[0]||x>TG[2]||y<TG[1]||y>TG[3]))continue;for(const sd of [-.5,.5]){const bx=x+ax*sd*s[4],by=y+ay*sd*s[4];c.moveTo(bx-ux*s[5]/2,by-uy*s[5]/2);c.lineTo(bx+ux*s[5]/2,by+uy*s[5]/2)}}c.stroke();c.lineCap='round'}
  const Rs=MAP.R.filter(r=>inTG(r._bb));
  Rs.filter(r=>r.ar).forEach(r=>{polyPath(c,r.p);c.closePath();c.fillStyle=gcol('#d8d4ca','walk');c.fill()});
  Rs.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#c8c3b8','walk');c.lineWidth=(RW[r.c]+8)/M;c.stroke()});
  Rs.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#d8d4ca','walk');c.lineWidth=(RW[r.c]+6.6)/M;c.stroke()});
  Rs.filter(r=>!r.ar&&r.c===6).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#cdc8bd','walk');c.lineWidth=4/M;c.stroke()});
  const RLs=MAP.RL.filter(r=>inTG(r._bb));
  RLs.forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(C['Red clay'],'grass');c.lineWidth=5.5/M;c.stroke()});
  RLs.forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#7a5236','grass');c.lineWidth=3.2/M;c.setLineDash([.5/M,.8/M]);c.stroke();c.setLineDash([])});
  RLs.forEach(r=>{polyPath(c,r.p);c.strokeStyle=C.Tin;c.lineWidth=2.0/M;c.stroke();polyPath(c,r.p);c.strokeStyle=gcol('#8a6046','grass');c.lineWidth=1.45/M;c.stroke()});
  Rs.filter(r=>!r.ar&&r.c===5).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(mix(C.Asphalt,C.Concrete,.3),'road');c.lineWidth=RW[5]/M;c.stroke()});
  const asph=gcol(S.wx==='rain'?C['Wet asphalt']:C.Asphalt,'road');
  Rs.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=asph;c.lineWidth=RW[r.c]/M;c.stroke()});
  // lane markings: double yellow on main streets, dashed white on smaller ones
  Rs.filter(r=>!r.ar&&r.c<=2&&!r.ow).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(C['Line gold'],'road');c.lineWidth=.75/M;c.stroke();polyPath(c,r.p);c.strokeStyle=asph;c.lineWidth=.3/M;c.stroke()});
  Rs.filter(r=>!r.ar&&(r.c===3||(r.c<=2&&r.ow))).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.25/M;c.setLineDash([3/M,4/M]);c.stroke();c.setLineDash([])});
  // crosswalks
  c.lineCap='butt';
  MAP.X.forEach(([x,y,ds])=>{if(TG&&(x<TG[0]-2||x>TG[2]+2||y<TG[1]-2||y>TG[3]+2))return;const wmax=Math.max(...ds.map(d=>RW[d[2]]));for(const[ux,uy,cl] of ds){if(cl>3)continue;const w=RW[cl];const off=(wmax/2+2.2)/M;const cx=x+ux*off,cy=y+uy*off;const vx=-uy,vy=ux;const n=Math.floor(w/1.1);for(let k=0;k<n;k++){const s=(-w/2+.55+k*1.1)/M;c.beginPath();c.moveTo(cx+vx*s-ux*1.4/M,cy+vy*s-uy*1.4/M);c.lineTo(cx+vx*s+ux*1.4/M,cy+vy*s+uy*1.4/M);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.55/M;c.stroke()}}});
  c.restore();setT(c);c.lineCap='round';
}
// Parking stalls: [x, y, stall axis (deg), aisle direction (deg), spacing along the aisle, depth (tiles), seed], from
// the rows prep.py lays out (MAP.SR: start, step, count, angles, spacing, depth).
const ST=[];(MAP.SR||[]).forEach((r,ri)=>{for(let k=0;k<r[4];k++)ST.push([r[0]+r[2]*k,r[1]+r[3]*k,r[5],r[6],r[7],r[8],ri*31+k])});
function stallFrame(s){const a=s[2]*rad,b=s[3]*rad;return[s[0],s[1],Math.cos(a),Math.sin(a),Math.cos(b),Math.sin(b)]}
// cast shadows from the real sun
// The shadow mask is built once per sun position; each tile then lays it down with the iso transform.
let SHM=null;
function buildShadows(){SHM=null;
  if(SUN.alt<2||S.wx==='rain')return;
  const R=4,mc=mk(Math.ceil(GX*R),Math.ceil(GY*R)),m=mc.getContext('2d');m.setTransform(R,0,0,R,0,0);m.fillStyle=m.strokeStyle='#2c2147';
  const k=1/Math.tan(Math.max(4,SUN.alt)*rad),vx=-Math.sin(SUN.az*rad),vy=Math.cos(SUN.az*rad);
  m.lineJoin='round';for(const b of blds){if(!b.canopy){m.lineWidth=.32;m.beginPath();b.pts.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.closePath();m.stroke()}const L=Math.min(b.hm*k,b.hm*8)/M;const sh=hull(b.pts.concat(b.pts.map(p=>[p[0]+vx*L,p[1]+vy*L])));m.beginPath();sh.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.closePath();m.fill()}
  for(const o of pts0){if(o.kind==='tree'){const lf=look(o.sp,DOY,o.seed).leaf,r=o.r*.8/M,L=Math.min(o.h*.6*k,o.h*5)/M;m.globalAlpha=['loblolly','magnolia','cedar','holly'].includes(o.sp)?1:.35+.65*lf;m.beginPath();m.ellipse(o.gx+vx*L,o.gy+vy*L,r,r,0,0,7);m.fill();m.globalAlpha=1}else if(o.kind==='car'){const L=Math.min(1.5*k,8)/M;m.beginPath();const r=o.r;const h=hull(r.concat(r.map(p=>[p[0]+vx*L,p[1]+vy*L])));h.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.fill()}}
  SHM={c:mc,R}}
function drawShadows(c){if(!SHM)return;const R=SHM.R;
  c.save();c.setTransform(...BT);c.transform(TW/R,TH/R,-TW/R,TH/R,ox,oy);c.globalAlpha=S.wx==='snow'?.22:.34;c.drawImage(SHM.c,0,0);c.restore();
}

// ---------- static points ----------
const pts0=[];
(function place(){
  const R=6,mw=Math.ceil(GX*R),mh=Math.ceil(GY*R);const mkMask=()=>{const mc=mk(mw,mh),m=mc.getContext('2d');m.fillStyle='#fff';m.fillRect(0,0,mw,mh);m.setTransform(R,0,0,R,0,0);m.lineCap='round';m.strokeStyle='#000';m.fillStyle='#000';return[mc,m]};
  const[fc,m]=mkMask();
  MAP.R.forEach(r=>{polyPath(m,r.p);if(r.ar){m.closePath();m.fill()}else{m.lineWidth=(RW[r.c]+(r.c<=4?9:3))/M;m.stroke()}});
  MAP.RL.forEach(r=>{polyPath(m,r.p);m.lineWidth=8/M;m.stroke()});
  MAP.PL.forEach(p=>{polyPath(m,p);m.closePath();m.fill()});
  const[bc,bm]=mkMask();
  blds.forEach(b=>{for(const mm of [m,bm]){mm.beginPath();b.pts.forEach((p,i)=>i?mm.lineTo(p[0],p[1]):mm.moveTo(p[0],p[1]));mm.closePath();mm.fill();mm.lineWidth=2.5/M;mm.stroke()}});
  const px=m.getImageData(0,0,mw,mh).data,bpx=bm.getImageData(0,0,mw,mh).data;
  const at=(d,x,y)=>{if(x<=.3||y<=.3||x>=GX-.3||y>=GY-.3)return false;const i=((Math.floor(y*R))*mw+Math.floor(x*R))*4;return d[i]>128};
  const parks=MAP.PK.map(p=>pairs(p.p));
  let s=3;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};
  // the real trees (public/model/trees.json); without that file, fall back to the old guessed ones
  const real=loadTrees(TREES);
  if(real.length)pts0.push(...real);
  else for(let y=0;y<GY;y+=.8)for(let x=0;x<GX;x+=.8){const gx=x+rnd()*.7,gy=y+rnd()*.7;if(!at(px,gx,gy))continue;const inPark=parks.some(p=>pip(gx,gy,p));if(rnd()<(inPark?.5:isVeg(gx,gy)?.32:0))pts0.push({kind:'tree',gx,gy,h:9+rnd()*6,r:3+rnd()*2,sp:rnd()<.3?'loblolly':'willowoak',seed:rnd()})}
  // street trees and lamps along main streets
  MAP.TR.forEach(t=>{const p=pairs(t.p);let acc=0,acc2=0;const offT=(RW[t.c]/2+2.6)/M,offL=(RW[t.c]/2+1.1)/M;for(let i=0;i<p.length-1;i++){const[a,b]=[p[i],p[i+1]];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!L)continue;const ux=(b[0]-a[0])/L,uy=(b[1]-a[1])/L;for(let d=0;d<L;d+=.15){acc+=.15;acc2+=.15;const bx=a[0]+ux*d,by=a[1]+uy*d;
    if(acc2>12/M&&t.c<=3){acc2=0;for(const sd of [-1,1]){const gx=bx-uy*offT*sd,gy=by+ux*offT*sd;if(!real.length&&at(bpx,gx,gy)&&rnd()<.75)pts0.push({kind:'tree',gx,gy,h:7,r:2.5,sp:'willowoak',seed:rnd()})}}
    if(acc>30/M&&t.c<=3){acc=0;const sd=rnd()<.5?1:-1;const gx=bx-uy*offL*sd,gy=by+ux*offL*sd;if(at(bpx,gx,gy))pts0.push({kind:'lamp',gx,gy})}}}});
  // parked cars in surface lots
  const carCols=['#eeeef2','#eeeef2','#f6f4ee','#c4c8d0','#c4c8d0','#9aa0aa','#5c6270','#2c2c34','#2c2c34',C.Brick,C['Aggie blue'],'#6a7f96'];
  // Parked cars sit in the lots' real stalls (tools/model/prep.py lays them out along each lot's painted rows and
  // stall angle, read from the 2024 aerial), nose in, about two thirds full. Without stalls, a plain grid.
  if(ST.length)ST.forEach((st,i)=>{if(hash(i*.731+3,st[6])>.66)return;const[x,y,ux,uy]=stallFrame(st);const L=4.4/M,Wd=1.85/M,j=(hash(i,9)-.5)*.25/M;const cx=x+ux*j,cy=y+uy*j;
    if(!at(bpx,cx,cy))return;pts0.push({kind:'car',gx:cx,gy:cy,r:rect(cx,cy,ux,uy,L,Wd),col:carCols[Math.floor(hash(i,st[6]+1)*carCols.length)]})});
  else MAP.PL.forEach((pl,li)=>{const q=pairs(pl);const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);const horiz=hash(li,5)<.5;const sx=(horiz?5.6:2.8)/M,sy=(horiz?2.8:5.6)/M;for(let y=Math.min(...ys)+sy;y<Math.max(...ys)-sy/2;y+=sy)for(let x=Math.min(...xs)+sx;x<Math.max(...xs)-sx/2;x+=sx){const ri=Math.round(((horiz?x-Math.min(...xs):y-Math.min(...ys)))/(5.6/M));if(ri%3===2)continue;if(!pip(x,y,q)||!at(bpx,x,y)||rnd()>.5)continue;const r=rect(x,y,horiz?1:0,horiz?0:1,4.3/M,1.9/M);pts0.push({kind:'car',gx:x,gy:y,r,col:carCols[Math.floor(rnd()*carCols.length)]})}});
  // landmarks
  const ccp=MAP.PK.find(p=>p.n==='Center City Park');if(ccp){const q=pairs(ccp.p);pts0.push({kind:'fountain',gx:q.reduce((a,p)=>a+p[0],0)/q.length,gy:q.reduce((a,p)=>a+p[1],0)/q.length})}
  const lb=MAP.PK.find(p=>p.n==='Lebauer Park');if(lb){const q=pairs(lb.p);let best=null;for(let i=0;i<q.length-1;i++){const a=q[i],b=q[i+1];const nx=b[1]-a[1],ny=-(b[0]-a[0]);if(nx+ny>0){const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||L>best.L)best={a,b,L}}}if(best)pts0.push({kind:'string',a:best.a,b:best.b,gx:(best.a[0]+best.b[0])/2,gy:(best.a[1]+best.b[1])/2})}
  pts0.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy));
})();
const NET=(()=>{const lb=MAP.PK.find(p=>p.n==='Lebauer Park');if(!lb)return null;const q=pairs(lb.p);return{cx:q.reduce((a,p)=>a+p[0],0)/q.length,cy:q.reduce((a,p)=>a+p[1],0)/q.length,rx:16/M,ry:11/M}})();
function drawTree(c,o){drawTreeSp(c,o,{P,fr,circ,poly,line,mix,surf,SH,HI,doy:DOY,lean:WIND.lean})}
const FLAGS=loadFlags(TREES);
function drawLamp(c,o){const[x,y]=P(o.gx,o.gy);const on=lampsOn();if(on)eg(x+.5,y,15,.3,.5);fr(c,Math.round(x),Math.round(y-16),1,16,SH);fr(c,Math.round(x-1),Math.round(y-17),3,2,SH);if(on){ed([x+.5,y-15.5],'#fff2c4',2);eg(x+.5,y-15,6,.4)}}
function drawString(c,o){[o.a,o.b].forEach(p=>line(c,P(p[0],p[1]),P(p[0],p[1],22),SH));if(!lampsOn())return;for(let k=0;k<=56;k++){const t=k/56;const gx=o.a[0]+(o.b[0]-o.a[0])*t,gy=o.a[1]+(o.b[1]-o.a[1])*t;ed(P(gx,gy,22-Math.sin(t*Math.PI*4)**2*5),k%2?'#ffe9a8':'#ffb98a')}}
function drawCarS(c,o){drawPrism(c,o.r,0,4,o.col,o.col);const[ax,ay]=[(o.r[0][0]+o.r[2][0])/2,(o.r[0][1]+o.r[2][1])/2];const r2=o.r.map(p=>[ax+(p[0]-ax)*.6,ay+(p[1]-ay)*.8]);drawPrism(c,r2,4,2.5,mix(C['Haw River'],SH,.3),mix(o.col,HI,.2))}
function drawFountain(c,o){const r=7/M;const ring=[...Array(16)].map((_,k)=>[o.gx+Math.cos(k*Math.PI/8)*r,o.gy+Math.sin(k*Math.PI/8)*r]);drawPrism(c,ring,0,3,C.Concrete,C.Concrete,true);poly(c,ring.map(p=>P(p[0],p[1],3)),surf(mix(C['Haw River'],HI,.25),true));const ring2=ring.map(p=>[o.gx+(p[0]-o.gx)*.3,o.gy+(p[1]-o.gy)*.3]);drawPrism(c,ring2,0,7,C.Concrete,C.Concrete)}
function drawPoint(c,o){switch(o.kind){case'tree':drawTree(c,o);break;case'lamp':drawLamp(c,o);break;case'string':drawString(c,o);break;case'car':drawCarS(c,o);break;case'fountain':drawFountain(c,o);break}}
// LeBauer Park's suspended net sculpture, drawn above everything
function drawNet(c){if(!NET)return;const{cx,cy,rx,ry}=NET;const z=(u,v)=>26-10*(1-u*u)*(1-v*v);const pt=(u,v)=>P(cx+u*rx,cy+v*ry,z(u,v));const lit=lampsOn();
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([u,v])=>line(c,P(cx+u*rx*1.15,cy+v*ry*1.15),P(cx+u*rx*1.15,cy+v*ry*1.15,34),'#e8e4dc',1));
  c.globalAlpha=.75;for(let i=0;i<=10;i++){const u=-1+i/5;c.beginPath();for(let j=0;j<=20;j++){const v=-1+j/10;const p=pt(u,v);j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])}c.strokeStyle=i%2?'#f08a7a':'#ffb86b';c.lineWidth=.8;c.stroke();
    c.beginPath();for(let j=0;j<=20;j++){const v=-1+j/10;const p=pt(v,u);j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1])}c.stroke()}c.globalAlpha=1;
  [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([u,v])=>line(c,pt(u,v),P(cx+u*rx*1.15,cy+v*ry*1.15,34),'#e8e4dc',.6));
  if(lit){for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){if((i+j)%2)continue;const p=pt(-1+i/5,-1+j/5);ed(p,(i+j)%4?'#ff8ab4':'#8ad8ff')}}}

// ---------- what hides what ----------
// Anything that is partly behind a building (or, for moving things, behind a tree, lamp or parked car) is drawn on a
// small scratch card, the outlines of whatever stands in front are cut out of the card, and the rest goes onto the
// picture. Nothing in front is ever painted again, so nearer buildings never get painted over.
function silhouette(b){if(b.sil)return b.sil;const o0=ox,o1=oy;ox=BOX;oy=BOY;const p=new Path2D();let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  const prism=(pts,h)=>{const n=pts.length;const add=q=>{let A=0;for(let k=0;k<q.length;k++){const u=q[k],v=q[(k+1)%q.length];A+=u[0]*v[1]-v[0]*u[1]}if(A<0)q=q.slice().reverse();q.forEach(([x,y],k)=>{k?p.lineTo(x,y):p.moveTo(x,y);if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y});p.closePath()};
    add(pts.map(q=>P(q[0],q[1])));add(pts.map(q=>P(q[0],q[1],h)));for(let k=0;k<n;k++){const a=pts[k],c=pts[(k+1)%n];add([P(a[0],a[1]),P(c[0],c[1]),P(c[0],c[1],h),P(a[0],a[1],h)])}};
  prism(b.pts,b.hpx+(b.special?14:2));if(b.tiers)for(const t of b.tiers)prism(t.pts,Math.min(250,t.h*ZPM)+(b.special?14:2));
  ox=o0;oy=o1;b.sil={p,box:[x0-1,y0-1,x1+1,y1+1]};return b.sil}
const scr=[mk(64,64),mk(64,64),mk(64,64)].map(c=>c.getContext('2d'));
function drawCut(box,fn,cuts,dst){
  const X0=Math.floor(BT[0]*box[0]+BT[4]),Y0=Math.floor(BT[3]*box[1]+BT[5]),X1=Math.ceil(BT[0]*box[2]+BT[4]),Y1=Math.ceil(BT[3]*box[3]+BT[5]);const w_=X1-X0,h_=Y1-Y0;if(w_<=0||h_<=0)return;
  if(scr[0].canvas.width<w_||scr[0].canvas.height<h_)for(const c of scr){c.canvas.width=Math.max(c.canvas.width,w_);c.canvas.height=Math.max(c.canvas.height,h_)}
  const t0=TGT,b0=BT;BT=[b0[0],0,0,b0[3],b0[4]-X0,b0[5]-Y0];
  for(const c of scr){c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.globalAlpha=1;c.clearRect(0,0,w_,h_);c.setTransform(...BT)}
  TGT={c:scr[0],e:scr[1],g:scr[2]};fn();
  for(const c of scr){c.save();c.globalCompositeOperation='destination-out';c.setTransform(...BT);c.translate(ox-BOX,oy-BOY);c.fillStyle='#000';for(const q of cuts)c.fill(q);c.restore()}
  BT=b0;TGT=t0;
  for(const d of [dst.e,dst.g]){d.save();d.setTransform(1,0,0,1,0,0);d.globalCompositeOperation='destination-out';d.drawImage(scr[0].canvas,0,0,w_,h_,X0,Y0,w_,h_);d.restore()}
  [dst.c,dst.e,dst.g].forEach((d,i)=>{d.save();d.setTransform(1,0,0,1,0,0);d.drawImage(scr[i].canvas,0,0,w_,h_,X0,Y0,w_,h_);d.restore()})}

// screen boxes (model pixels, static origin) for culling, the samples that decide what stands in front of each
// static point, and the outlines with which trees, lamps and parked cars hide whatever passes behind them
(function prepPoints(){ox=BOX;oy=BOY;
  const boxOf=(pts,zmax,pad)=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const[gx,gy] of pts)for(const z of [0,zmax]){const[x,y]=P(gx,gy,z);if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return[x0-pad,y0-pad,x1+pad,y1+pad]};
  for(const b of blds){b.box=boxOf(b.pts,(b.htop||b.hpx)+40,8)}
  for(const o of pts0){let fp,zmax,pad,smp;
    if(o.kind==='tree'){const hp=Math.max(9,o.h*2),rp=Math.max(3,o.r*1.9)+4;fp=[[o.gx,o.gy]];zmax=hp+4;pad=rp+1;smp=[[o.gx,o.gy,0]];
      const[x,y]=P(o.gx,o.gy);const q=new Path2D();q.addPath(treeOutline(o,WIND.lean,DOY),new DOMMatrix([1,0,0,1,Math.round(x),Math.round(y)]));o.occ=q}
    else if(o.kind==='lamp'){fp=[[o.gx,o.gy]];zmax=20;pad=16;smp=[[o.gx,o.gy,0]];const[x,y]=P(o.gx,o.gy);const q=new Path2D();q.rect(Math.round(x),Math.round(y-16),1,16);q.rect(Math.round(x-1),Math.round(y-17),3,2);o.occ=q}
    else if(o.kind==='car'){fp=o.r;zmax=7;pad=3;smp=o.r.map(p=>[p[0],p[1],0]).concat([[o.gx,o.gy,0]]);const h=hull(o.r.map(p=>P(p[0],p[1])).concat(o.r.map(p=>P(p[0],p[1],6.5))));o.occ=path(h)}
    else if(o.kind==='fountain'){const r=7/M;fp=[[o.gx-r,o.gy-r],[o.gx+r,o.gy+r],[o.gx-r,o.gy+r],[o.gx+r,o.gy-r]];zmax=8;pad=2;smp=fp.map(p=>[p[0],p[1],0])}
    else{fp=[o.a,o.b];zmax=24;pad=4;smp=[[o.a[0],o.a[1],0],[o.b[0],o.b[1],0],[o.gx,o.gy,0]]}
    o.box=boxOf(fp,zmax,pad);o.bl=blockersFor(smp)}})();
const OCC=new Map();for(const o of pts0)if(o.occ){const k=Math.floor(o.gx/2)+','+Math.floor(o.gy/2);if(!OCC.has(k))OCC.set(k,[]);OCC.get(k).push(o)}
/** Static things standing in front of a moving thing at (gx,gy): trees, lamps and parked cars nearer the viewer. */
function occludersAt(gx,gy){const out=[],s=gx-gy,u=gx+gy;for(let i=Math.floor(gx/2)-1;i<=Math.floor(gx/2)+3;i++)for(let j=Math.floor(gy/2)-1;j<=Math.floor(gy/2)+3;j++){const l=OCC.get(i+','+j);if(!l)continue;for(const o of l){const du=o.gx+o.gy-u;if(du>.02&&du<6&&Math.abs(o.gx-o.gy-s)<2.6)out.push(o.occ)}}return out}

// ---------- static tiles ----------
// The still parts of the model are rendered in TILE-pixel squares at the current scale, only where the camera looks,
// and kept until the light or the scene changes (then they are redrawn a few at a time, old ones showing meanwhile).
const DBG=new URLSearchParams(location.search).has('debug');const tiles=new Map();let stver=0,T=0,renderedFor='';
const hitBox=(bx,r)=>!(bx[0]>r[2]||bx[2]<r[0]||bx[1]>r[3]||bx[3]<r[1]);
function renderTile(tx,ty,t){const T0=performance.now();
  if(!t){t={};for(const k of ['c','e','g']){t[k]=mk(TILE,TILE).getContext('2d')}}
  for(const k of ['c','e','g']){t[k].setTransform(1,0,0,1,0,0);t[k].clearRect(0,0,TILE,TILE)}
  BT=[VS,0,0,VS,-tx*TILE,-ty*TILE];setT(t.c,t.e,t.g);TGT={c:t.c,e:t.e,g:t.g};ox=BOX;oy=BOY;
  const r=[tx*TILE/VS,ty*TILE/VS,(tx+1)*TILE/VS,(ty+1)*TILE/VS];
  const inv=(x,y)=>{const a=(x-ox)/TW,b=(y-oy)/TH;return[(a+b)/2,(b-a)/2]};const cs=[inv(r[0],r[1]),inv(r[2],r[1]),inv(r[0],r[3]),inv(r[2],r[3])];
  TG=[Math.min(...cs.map(c=>c[0])),Math.min(...cs.map(c=>c[1])),Math.max(...cs.map(c=>c[0])),Math.max(...cs.map(c=>c[1]))];
  drawGround(t.c);drawShadows(t.c);TG=null;
  for(const b of blds)if(hitBox(b.box,r))drawBuilding(t.c,b);
  for(const o of pts0)if(hitBox(o.box,r)){if(!o.bl.length)drawPoint(t.c,o);else drawCut(o.box,()=>drawPoint(TGT.c,o),o.bl.map(b=>silhouette(b).p),TGT)}
  drawNet(t.c);
  t.ver=stver;t.vs=VS;if(DBG)console.log('[dbg] tile',tx,ty,Math.round(performance.now()-T0)+'ms');return t}
function getTile(tx,ty,budget){const key=VS+'|'+tx+'|'+ty;let t=tiles.get(key);
  if(t){tiles.delete(key);tiles.set(key,t);if(t.ver!==stver&&budget.left>0){const t0=performance.now();renderTile(tx,ty,t);budget.left-=performance.now()-t0}return t}
  const t0=performance.now();t=renderTile(tx,ty,null);budget.left-=performance.now()-t0;tiles.set(key,t);return t}
function trimTiles(keep){while(tiles.size>keep){const k=tiles.keys().next().value;tiles.delete(k)}}
function renderStatic(){const T0=performance.now();
  SUN=sunPos(sceneDate());DOY=dayOfYear(sceneDate0());buildGroundTex();buildShadows();stver++;
  renderedFor=stateKey();if(DBG)console.log('[dbg] static',Math.round(performance.now()-T0)+'ms')
}
const stateKey=()=>[S.time,S.wx,L.version,dayOfYear(sceneDate0()),windKey(WIND),Math.round(SUN.alt/1.5),Math.round(SUN.az/3),evening(),lampsOn()].join('|');

// ---------- traffic ----------
// Streets run past the edge of the model; cars, people and the train only use the parts on the model.
function clipLine(p,m=.6){const out=[];let cur=[];const x0=m,y0=m,x1=GX-m,y1=GY-m;const inside=q=>q[0]>=x0&&q[0]<=x1&&q[1]>=y0&&q[1]<=y1;
  for(let i=0;i<p.length-1;i++){let[a,b]=[p[i],p[i+1]];let t0=0,t1=1;const dx=b[0]-a[0],dy=b[1]-a[1];let ok=true;
    for(const[pp,qq] of [[-dx,a[0]-x0],[dx,x1-a[0]],[-dy,a[1]-y0],[dy,y1-a[1]]]){if(pp===0){if(qq<0){ok=false;break}continue}const r=qq/pp;if(pp<0){if(r>t1){ok=false;break}if(r>t0)t0=r}else{if(r<t0){ok=false;break}if(r<t1)t1=r}}
    if(!ok){if(cur.length>1)out.push(cur);cur=[];continue}
    const A=[a[0]+dx*t0,a[1]+dy*t0],B=[a[0]+dx*t1,a[1]+dy*t1];if(!cur.length)cur.push(A);cur.push(B);if(t1<1){out.push(cur);cur=[]}}
  if(cur.length>1)out.push(cur);return out}
const mkChain=(p,extra)=>{const cum=[0];for(let i=1;i<p.length;i++)cum.push(cum[i-1]+Math.hypot(p[i][0]-p[i-1][0],p[i][1]-p[i-1][1]));return{...extra,p,cum,L:cum[cum.length-1]}};
const chains=MAP.TR.flatMap(t=>clipLine(pairs(t.p)).map(p=>mkChain(p,{n:t.n,c:t.c}))).filter(ch=>ch.L>2);
function along(ch,d){d=Math.max(0,Math.min(ch.L-1e-6,d));let i=1;while(i<ch.cum.length-1&&ch.cum[i]<d)i++;const a=ch.p[i-1],b=ch.p[i];const seg=ch.cum[i]-ch.cum[i-1]||1;const t=(d-ch.cum[i-1])/seg;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,(b[0]-a[0])/seg,(b[1]-a[1])/seg]}
const carCols=[C.Brick,C['Haw River'],C.Paper,C.Tobacco,C.Slate,C['Aggie blue'],'#5ec46a','#e8e8ee'];
const skins=['#f5d0ad','#e2a87e','#c3825a','#9a6040','#76462e','#553220'];
const shirts=[C.Tobacco,C['Aggie blue'],C.Brick,C.Pine,C.Paper,C['Haw River'],'#b04ec0',C.Slate,'#ff7a9a'];
const cars=[],people=[];
chains.forEach((ch,ci)=>{
  const np=Math.round(ch.L/4);for(let k=0;k<np;k++)people.push({ch,d:Math.random()*ch.L,dir:Math.random()<.5?1:-1,side:Math.random()<.5?1:-1,v:.13+Math.random()*.06,night:k%3!==0,skin:skins[(ci+k)%6],shirt:shirts[(ci*2+k)%9]})});
// ---------- street traffic ----------
// The streets as a graph (OSM ways split where they meet), one lane each way (one way where OSM says so), driving on
// the right. Cars follow the car ahead (a simple intelligent-driver model), stop at red and yellow lights at the real
// signals (OSM traffic_signals; two phases, the cross street gets green in turn), come to a full stop at mapped stop
// signs before going when the junction is clear, and yield on side streets at other junctions. At each junction a car
// picks a legal way on (no wrong way down one-way streets, no U-turns unless it is a dead end); at the model's edge it
// leaves and another car comes in somewhere else.
const TF=(()=>{const key=(x,y)=>x.toFixed(2)+','+y.toFixed(2);const pieces=[];
  for(const r of MAP.R){if(r.ar||r.c>4)continue;for(const p of clipLine(pairs(r.p),.3))pieces.push({p,c:r.c,ow:r.ow,n:r.n})}
  const seen=new Map();for(const pc of pieces)pc.p.forEach((q,i)=>{const k=key(q[0],q[1]);seen.set(k,(seen.get(k)||0)+(i===0||i===pc.p.length-1?1:2))});
  const nodes=new Map();const node=q=>{const k=key(q[0],q[1]);let n=nodes.get(k);if(!n){n={k,x:q[0],y:q[1],out:[],inn:[],cls:9};nodes.set(k,n)}return n};
  const lanes=[];
  for(const pc of pieces){let cur=[pc.p[0]];for(let i=1;i<pc.p.length;i++){cur.push(pc.p[i]);const k=key(pc.p[i][0],pc.p[i][1]);if(i===pc.p.length-1||seen.get(k)!==2){
      if(cur.length>1){const a=node(cur[0]),b=node(cur[cur.length-1]);if(a!==b){const mk_=(pts,from,to)=>{const ch=mkChain(pts,{c:pc.c,n:pc.n});const ln={ch,from,to,L:ch.L,c:pc.c,ow:pc.ow,cars:[],id:lanes.length};lanes.push(ln);from.out.push(ln);to.inn.push(ln);return ln};
        const f=mk_(cur,a,b);if(!pc.ow){const r_=mk_(cur.slice().reverse(),b,a);f.rev=r_;r_.rev=f}a.cls=Math.min(a.cls,pc.c);b.cls=Math.min(b.cls,pc.c)}}cur=[pc.p[i]]}}}
  const N=[...nodes.values()];
  // the junction's controls: real signals and stop signs from OSM, matched to the nearest junction
  for(const n of N)n.deg=new Set([...n.out,...n.inn].map(l=>l.rev?Math.min(l.id,l.rev.id):l.id)).size;
  const near=(x,y,r)=>{let best=null,bd=r;for(const n of N){if(n.deg<3)continue;const d=Math.hypot(n.x-x,n.y-y);if(d<bd){bd=d;best=n}}return best};
  for(const[x,y,k] of (MAP.SIG||[])){if(k==='s'){const n=near(x,y,3.2);if(n)n.signal=true}}
  for(const[x,y,k] of (MAP.SIG||[])){if(k==='p'||k==='y'){// a stop or yield sign belongs to the approach it stands on
      let best=null,bd=2.2;for(const n of N){if(n.signal||n.deg<3)continue;for(const l of n.inn){const q=l.ch.p[l.ch.p.length-2]||l.ch.p[0];const d=Math.hypot(x-n.x,y-n.y);if(d<bd&&((x-n.x)*(q[0]-n.x)+(y-n.y)*(q[1]-n.y))>0){bd=d;best=l}}}if(best){best.sign=k==='p'?'stop':'yield';best.signAt=[x,y]}}}
  for(const n of N){const hd=l=>{const p=l.ch.p,a=p[p.length-2],b=p[p.length-1];return Math.atan2(b[1]-a[1],b[0]-a[0])};
    if(n.signal&&n.inn.length){const h0=hd(n.inn[0]);for(const l of n.inn){let d=Math.abs(((hd(l)-h0)%Math.PI+Math.PI)%Math.PI);d=Math.min(d,Math.PI-d);l.phase=d<Math.PI/4?0:1}n.offset=hash(n.x,n.y)*40}
    // side streets give way at junctions without lights
    else if(n.deg>=3)for(const l of n.inn)if(!l.sign&&l.c>n.cls)l.sign='yield'}
  const entries=lanes.filter(l=>l.from.out.length===1&&l.from.inn.length<=1&&(l.from.x<1||l.from.y<1||l.from.x>GX-1||l.from.y>GY-1));
  return{lanes,nodes:N,entries:entries.length?entries:lanes}})();
const CYC=[22,3,1.5];const CYCLE=2*(CYC[0]+CYC[1]+CYC[2]);
/** 'g', 'y' or 'r' for an approach at a signal */
function light(l){if(!l.to.signal)return null;let t=((T+l.to.offset)%CYCLE+CYCLE)%CYCLE;const half=CYCLE/2;const mine=l.phase===0?t<half:t>=half;if(!mine)return'r';t%=half;return t<CYC[0]?'g':t<CYC[0]+CYC[1]?'y':'r'}
const CARL=4.6/9,stopBack=l=>(RW[l.to.cls]/2+3.2)/M;
const tcars=[];if(new URLSearchParams(location.search).has('debug'))window.__tf={TF,tcars,light};
(function seedCars(){for(const l of TF.lanes){const n=Math.floor(l.L/(l.c<=2?6:10)+Math.random()*.7);for(let k=0;k<n;k++){const s=(k+.3+Math.random()*.4)*l.L/Math.max(1,n);addCar(l,s)}}})();
function addCar(l,s){const c={lane:l,s,v:.6,col:carCols[Math.floor(Math.random()*carCols.length)],v0:(l.c<=2?1.5:1.15)*(.88+Math.random()*.24),wait:0,go:false,off:null};l.cars.push(c);l.cars.sort((a,b)=>b.s-a.s);tcars.push(c);return c}
function nextLane(c){const l=c.lane;const opts=l.to.out.filter(o=>o!==l.rev&&!o.blocked);if(!opts.length)return l.to.out.find(o=>o===l.rev&&!o.blocked)||null;
  // mostly straight on, sometimes a turn
  const h=(q,a)=>{const p=q.ch.p;return a?Math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0]):Math.atan2(p[p.length-1][1]-p[p.length-2][1],p[p.length-1][0]-p[p.length-2][0])};const h0=h(l,false);
  const w=opts.map(o=>{let d=Math.abs(h(o,true)-h0);d=Math.min(d,2*Math.PI-d);return d<.5?4:1});let r=Math.random()*w.reduce((a,b)=>a+b,0);for(let i=0;i<opts.length;i++){r-=w[i];if(r<=0)return opts[i]}return opts[0]}
function boxBusy(n,me){for(const l of n.out)for(const c of l.cars)if(c!==me&&c.s<.55&&c.v>.05)return true;for(const l of n.inn)for(const c of l.cars)if(c!==me&&c.go&&l.L-c.s<.6)return true;return false}
function stepTraffic(dt){
  for(const l of TF.lanes){
    for(let i=0;i<l.cars.length;i++){const c=l.cars[i];if(!c.next)c.next=nextLane(c);
      // the gap to whatever is ahead: the car in front, or the last car on the lane we turn into
      let gap=1e9,vl=0;if(i>0){gap=l.cars[i-1].s-c.s-CARL;vl=l.cars[i-1].v}else if(c.next&&c.next.cars.length){const t=c.next.cars[c.next.cars.length-1];gap=l.L-c.s+t.s-CARL;vl=t.v}
      // must we stop at the end of this lane?
      const sb=stopBack(l),toLine=l.L-sb-c.s;let hold=false;
      if(!c.go&&toLine>-.15){const lt=light(l);
        if(lt==='r')hold=true;else if(lt==='y')hold=c.v*c.v/(2*2.2)<toLine+.05;
        else if(l.sign==='stop'){if(c.v<.04&&toLine<.35){c.wait+=dt;if(c.wait>1.3&&!boxBusy(l.to,c))c.go=true;else hold=true}else hold=true}
        else if(l.sign==='yield'){hold=toLine<1.6&&boxBusy(l.to,c)}
        if(!c.next)hold=hold||false;if(!hold&&toLine<.4)c.go=true}
      for(const k of L.closures)if(k.full)for(const q of (k.lanes||[]))if(q.lane===l&&q.s>c.s){const d=q.s-.5-c.s;if(d<gap){gap=d;vl=0}}
      if(hold&&toLine<gap){gap=Math.max(.001,toLine);vl=0}
      const A=1.1,Bd=2.2,s0=.32,Th=.9;const ds=s0+c.v*Th+c.v*(c.v-vl)/(2*Math.sqrt(A*Bd));let a=A*(1-Math.pow(c.v/c.v0,4)-Math.pow(Math.max(0,ds)/Math.max(.02,gap),2));a=Math.max(-6,a);
      c.v=Math.max(0,c.v+a*dt);c.s+=Math.min(c.v*dt,Math.max(0,gap+CARL*.1));c.stopped=c.v<.05}
    // cars that reached the end move on (or leave the model)
    while(l.cars.length&&l.cars[0].s>=l.L){const c=l.cars.shift();const nx=c.next;const[ox_,oy_]=lanePos(l,l.L);c.s-=l.L;c.wait=0;c.go=false;c.next=null;
      if(nx){c.lane=nx;nx.cars.push(c);const[px,py]=lanePos(nx,0);c.off=[ox_-px,oy_-py,.6]}
      else{const e=TF.entries[Math.floor(Math.random()*TF.entries.length)];const tail=e.cars[e.cars.length-1];if(tail&&tail.s<CARL*2){c.lane=l;c.s=l.L-.01;c.v=0;l.cars.unshift(c);break}c.lane=e;c.s=0;c.v=.8;c.off=null;e.cars.push(c)}}}
}
function lanePos(l,s){const[gx,gy,ux,uy]=along(l.ch,s);const off=l.ow&&!l.rev?0:(RW[l.c]/4)/M;return[gx-uy*off,gy+ux*off,ux,uy]}
const trainCh=clipLine(pairs(MAP.TRAIN),1.5).map(p=>mkChain(p,{})).sort((a,b)=>b.L-a.L)[0]||mkChain([[0,0],[0,0]],{});
let trainD=-12,trainWait=4;

// ---------- camera ----------
// camX,camY: the view's top-left corner in model pixels (static origin). The view is W/VS by H/VS model pixels.
let camX,camY,tgtX,tgtY,drag=null;
const VWm=()=>W/VS,VHm=()=>H/VS;
function camFor(b){ox=BOX;oy=BOY;const[x,y]=P(b.cx,b.cy,(b.hpx||0)*.45);return[x-VWm()/2,y-VHm()*.5]}
const clampX=v=>BW<=VWm()?(BW-VWm())/2:Math.max(0,Math.min(BW-VWm(),v)),clampY=v=>BH<=VHm()?(BH-VHm())/2:Math.max(0,Math.min(BH-VHm(),v));
// ?at=gx,gy opens the model looking at that spot (grid units), e.g. for a shared link
const AT=(()=>{const q=new URLSearchParams(location.search).get('at');if(!q)return null;const[a,b]=q.split(',').map(Number);return isFinite(a)&&isFinite(b)?{cx:a,cy:b,hpx:0}:null})();
[camX,camY]=camFor(AT||byId.tower||blds[0]);if(!AT)camY-=40;camX=clampX(camX);camY=clampY(camY);tgtX=camX;tgtY=camY;
cv.style.cursor='grab';cv.style.touchAction='none';
const touches=new Map();let pinch0=0;
cv.addEventListener('pointerdown',e=>{touches.set(e.pointerId,[e.clientX,e.clientY]);if(touches.size===2){const[a,b]=[...touches.values()];pinch0=Math.hypot(a[0]-b[0],a[1]-b[1]);drag=null;return}if(touches.size>2)return;drag={x:e.clientX,y:e.clientY,cx:camX,cy:camY};cv.setPointerCapture(e.pointerId);cv.style.cursor='grabbing'});
cv.addEventListener('pointermove',e=>{if(touches.has(e.pointerId))touches.set(e.pointerId,[e.clientX,e.clientY]);if(touches.size===2&&pinch0){const[a,b]=[...touches.values()];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(d/pinch0>1.4||d/pinch0<.7){zoomBy(d>pinch0?1:-1);pinch0=d;onView()}return}if(!drag)return;const s=W/cv.clientWidth/VS;camX=clampX(drag.cx-(e.clientX-drag.x)*s);camY=clampY(drag.cy-(e.clientY-drag.y)*s);tgtX=camX;tgtY=camY;glide=false;if(reduce)requestAnimationFrame(frame)});
const toStatic=e=>{const r=cv.getBoundingClientRect();return[((e.clientX-r.left)*W/r.width+Math.round(camX*VS))/VS,((e.clientY-r.top)*H/r.height+Math.round(camY*VS))/VS]};
function pickAt(e){const r=cv.getBoundingClientRect(),qx=(e.clientX-r.left)*W/r.width/LS,qy=(e.clientY-r.top)*H/r.height/LS;for(const g of signRects)if(qx>=g.x-2&&qx<=g.x+g.w+2&&qy>=g.y-2&&qy<=g.y+g.h+2)return{sign:g.id,name:g.name};const[sx,sy]=toStatic(e);for(let i=blds.length-1;i>=0;i--){const b=blds[i];if(!b.hull){ox=BOX;oy=BOY;const z=b.htop||b.hpx;b.hull=hull(b.pts.map(p=>P(p[0],p[1])).concat(b.pts.map(p=>P(p[0],p[1],z))))}if(pip(sx,sy,b.hull))return b}return null}
const endDrag=e=>{if(e)touches.delete(e.pointerId);if(touches.size<2)pinch0=0;if(drag&&e&&e.type==='pointerup'&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5){const b=pickAt(e);onPick(b)}drag=null;cv.style.cursor='grab'};cv.addEventListener('pointerup',endDrag);cv.addEventListener('pointercancel',endDrag);
cv.addEventListener('mousemove',e=>{if(drag)return;const b=pickAt(e);if(b!==hoverB){hoverB=b;onHover(b);if(reduce)requestAnimationFrame(frame)}});cv.addEventListener('mouseleave',()=>{hoverB=null;onHover(null)});

// ---------- light grading from the sun ----------
const GD={dawn:{m:[1.03,.9,.92],a:[18,4,16],d:-.05},day:{m:[1.02,1.01,1],a:[0,0,0],d:-.12},dusk:{m:[1.04,.82,.76],a:[16,0,18],d:-.05},night:{m:[.40,.45,.70],a:[6,8,24],d:.2}};
const lerpG=(A,B,t)=>({m:A.m.map((v,i)=>v+(B.m[i]-v)*t),a:A.a.map((v,i)=>v+(B.a[i]-v)*t),d:A.d+(B.d-A.d)*t});
function gradeFor(sun){const tw=sun.az<180?GD.dawn:GD.dusk;if(sun.alt>=10)return GD.day;if(sun.alt>=-1)return lerpG(tw,GD.day,(sun.alt+1)/11);if(sun.alt>=-10)return lerpG(GD.night,tw,(sun.alt+10)/9);return GD.night}
const WXG={clear:{m:[1,1,1],a:[0,0,0],d:0},rain:{m:[.84,.88,.96],a:[0,0,6],d:.15},snow:{m:[1.04,1.04,1.08],a:[4,4,8],d:.08},pollen:{m:[1.04,1.03,.88],a:[6,6,0],d:0},cloudy:{m:[.94,.96,1],a:[0,0,4],d:.1}};
const blink=(t,on,off)=>(t%(on+off))<on;
let rain,snow,motes;
function reseed(){rain=[...Array(Math.round(260*W*H/360000))].map(()=>[Math.random()*W,Math.random()*H]);snow=[...Array(Math.round(240*W*H/360000))].map(()=>[Math.random()*W,Math.random()*H,Math.random()]);motes=[...Array(Math.round(80*W*H/360000))].map(()=>[Math.random()*W,Math.random()*H,Math.random()*6])}
reseed();
function person(c,x,y,skin,shirt,f){x=Math.round(x);y=Math.round(y)-6;if(S.wx==='rain'){fr(c,x-2,y-2,6,1,shirt);fr(c,x,y-1,1,1,SH)}c.fillStyle='rgba(44,33,71,.25)';c.fillRect(x-1,y+6,4,1);fr(c,x,y,2,2,skin);fr(c,x,y+2,2,2,shirt);const lg=mix(SH,'#5a5070',.3);fr(c,x+(f?0:1),y+4,1,2,lg);fr(c,x+(f?1:0),y+4,1,2,lg)}

// 3x5 bulb font for the time-and-temperature sign
const FONT={'0':'111101101101111','1':'010110010010111','2':'111001111100111','3':'111001111001111','4':'101101111001001','5':'111100111001111','6':'111100111101111','7':'111001001001001','8':'111101111101111','9':'111101111001111',':':'000010000010000','°':'111101111000000','F':'111100110100100','-':'000000111000000','K':'101101110101101','R':'110101110101101','E':'111100111100111','S':'111100111001111',' ':'000000000000000'};
function lanternSign(cx,wl,z0,z1,txt){
  // amber bulb digits on a dark panel, as on the real lantern atop the tower. Each bulb is a little square laid in the
  // wall's plane, as big as the lantern face allows, so the time reads cleanly at every zoom.
  const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const span=Math.abs(Q[0]-A[0])||1;const flip=Q[0]<A[0];
  const gl=[...txt].map(ch=>ch===':'?'01010':(FONT[ch]||FONT[' ']));
  const ws=[...txt].map(ch=>ch===':'?1:3);const cols=ws.reduce((s,v)=>s+v,0)+ws.length-1;
  const pu=Math.min(1.7,span*.9/(cols+1)),du=pu/span,pz=Math.min(pu*1.05,(z1-z0)*.8/6);
  const u=k=>{const v=.5-cols*du/2+k*du;return flip?1-v:v};const zt=(z0+z1)/2+2.5*pz;
  poly(cx,[WP(wl,u(-.7),zt+.8*pz,.02),WP(wl,u(cols+.7),zt+.8*pz,.02),WP(wl,u(cols+.7),zt-5.8*pz,.02),WP(wl,u(-.7),zt-5.8*pz,.02)],'#1d1a1c');
  let k0=0;txt.split('').forEach((ch,i)=>{const g=gl[i],wdt=ws[i];for(let r=0;r<5;r++)for(let k=0;k<wdt;k++){const on=g[r*wdt+k]==='1';
    const ua=u(k0+k+.1),ub=u(k0+k+.9),za=zt-(r+.1)*pz,zb=zt-(r+.9)*pz;poly(cx,[WP(wl,ua,za,.03),WP(wl,ub,za,.03),WP(wl,ub,zb,.03),WP(wl,ua,zb,.03)],on?'#ffb43a':'#33282a')}k0+=wdt+1});
}
function signText(cx,wl,z0,txt){
  // bulb matrix at a fixed 2px pitch, centred on the wall and reading left to right on screen
  const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const flip=Q[0]<A[0];
  const pxPerU=Math.abs(Q[0]-A[0])/1||1;const du=2/pxPerU;const cols=txt.length*4-1;
  const half=cols*du/2;const pad=3*du;
  const u=k=>flip?1-(.5-half+k*du):(.5-half+k*du);
  const pnl=[WP(wl,u(-1.5),z0+1,.02),WP(wl,u(cols+.5),z0+1,.02),WP(wl,u(cols+.5),z0+13,.02),WP(wl,u(-1.5),z0+13,.02)];poly(cx,pnl,'#221c26');
  for(let i=0;i<txt.length;i++){const g=FONT[txt[i]]||FONT[' '];for(let r=0;r<5;r++)for(let k=0;k<3;k++){const on=g[r*3+k]==='1';on?ed(WP(wl,u(i*4+k),z0+11-r*2,.03),BULB,2):ed(WP(wl,u(i*4+k),z0+11-r*2,.03),'#3a2e30')}}
}
const LABELS=[['tower','Lincoln Financial'],['jsb','Jefferson Standard'],['icrc','Civil Rights Museum'],['theatre','Carolina Theatre'],['city','Melvin Municipal'],['depot','Galyon Depot'],['tanger','Tanger Center'],[208219206,'Courthouse'],[414240404,'Cultural Center'],[366999616,'Renaissance Plaza'],[411854108,'Public Library']];

let last=0,lastCheck=0,flash=0,hoverB=null,hiB=null,FOGP=null,LS=2;const HASFILTER='filter' in ctx;
function frame(ts){
  const dt=Math.min(.1,(ts-last)/1000||0);last=ts;if(!reduce)T+=dt;
  if(S.time==='now'&&ts-lastCheck>30000){lastCheck=ts;SUN=sunPos(new Date());if(stateKey()!==renderedFor)renderStatic()}
  const D=sceneDate();
  if(glide&&!drag){camX+=(tgtX-camX)*Math.min(1,dt*2);camY+=(tgtY-camY)*Math.min(1,dt*2);if(Math.hypot(tgtX-camX,tgtY-camY)<1)glide=false}
  const cx=Math.round(camX*VS),cy=Math.round(camY*VS);
  // the still model: tiles at the current scale (missing ones now, stale ones a few per frame)
  for(const c of [w,E,GL]){c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H)}w.fillStyle='#3a2c26';w.fillRect(0,0,W,H);
  frame.stale=false;const budget={left:12},tx0=Math.max(0,Math.floor(cx/TILE)),ty0=Math.max(0,Math.floor(cy/TILE)),tx1=Math.min(Math.ceil(BW*VS/TILE)-1,Math.floor((cx+W-1)/TILE)),ty1=Math.min(Math.ceil(BH*VS/TILE)-1,Math.floor((cy+H-1)/TILE));
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){const t=getTile(tx,ty,budget);if(t.ver!==stver)frame.stale=true;const X=tx*TILE-cx,Y=ty*TILE-cy;w.drawImage(t.c.canvas,X,Y);E.drawImage(t.e.canvas,X,Y);GL.drawImage(t.g.canvas,X,Y)}
  trimTiles(Math.max(24,(tx1-tx0+1)*(ty1-ty0+1)*2+8));
  BT=[VS,0,0,VS,0,0];setT(w,E,GL);TGT={c:w,e:E,g:GL};ox=BOX-cx/VS;oy=BOY-cy/VS;
  const ev=evening(),nt=night(),lamp=lampsOn();const dyn=[];
  const vis=(gx,gy)=>{if(gx<.1||gy<.1||gx>GX-.1||gy>GY-.1)return false;const[x,y]=P(gx,gy);return x>-30&&x<VWm()+30&&y>-40&&y<VHm()+60};
  if(!reduce)stepTraffic(Math.min(dt,.05));
  for(const c of tcars){let[px,py,ux,uy]=lanePos(c.lane,Math.min(c.s,c.lane.L));if(c.off){const k=Math.max(0,1-c.s/c.off[2]);px+=c.off[0]*k;py+=c.off[1]*k;if(k<=0)c.off=null}if(!vis(px,py))continue;
    dyn.push({kind:'car',gx:px,gy:py,ux,uy,col:c.col,stopped:c.stopped})}
  // the lights themselves, and stop signs, at the stop line on the right of each approach
  for(const l of TF.lanes){const lt=light(l);if(!lt&&l.sign!=='stop')continue;const s_=Math.max(0,l.L-stopBack(l)+.2);const[gx,gy,ux,uy]=along(l.ch,s_);const off=(RW[l.c]/2+1.2)/M;const px=gx-uy*off,py=gy+ux*off;if(!vis(px,py))continue;
    dyn.push(lt?{kind:'sig',gx:px,gy:py,lt}:{kind:'stopsign',gx:px,gy:py})}
  for(const p of people){if(!reduce){p.d+=p.dir*p.v*dt;if(p.d>p.ch.L||p.d<0){p.dir*=-1;p.d=Math.max(0,Math.min(p.ch.L,p.d))}}if(nt&&p.night)continue;
    const[gx,gy,ux,uy]=along(p.ch,p.d);const off=(RW[p.ch.c]/2+2.0)/M*p.side;const px=gx-uy*off,py=gy+ux*off;if(!vis(px,py))continue;dyn.push({kind:'pp',gx:px,gy:py,skin:p.skin,shirt:p.shirt,f:blink(T*3+p.d,.5,.5)})}
  const crowd=(b,n,dx,col)=>{if(!b)return;for(let i=0;i<n;i++)dyn.push({kind:'pp',gx:b.maxx+dx+(i%3)*.12,gy:b.cy-.5+i*.13,skin:skins[i%6],shirt:col||shirts[(i+2)%9],bob:blink(T*2+i,.3,.3)})};
  // crowds only where something is actually on: events at a venue, council in session, open bars after dark
  const crowdAt=(gx,gy,n,col)=>{for(let i=0;i<n;i++)dyn.push({kind:'pp',gx:gx+(i%3)*.12,gy:gy-.5+i*.13,skin:skins[i%6],shirt:col||shirts[(i+2)%9],bob:blink(T*2+i,.3,.3)})};
  for(const k of L.crowds){if(k.evening&&!ev)continue;const b=k.id!=null?byId[k.id]:null;if(b)crowd(b,k.n,.3,k.col);else crowdAt(k.gx,k.gy,k.n,k.col)}
  if(L.council.lit&&byId.city)crowd(byId.city,L.council.inSession?4:2,.4,C.Slate);
  for(const k of L.closures){const[gx,gy,ux,uy]=along(k.ch,k.d);const kind=k.kind==='work'?'cone':'barrel';const n=k.full?3:1;for(let j=-n;j<=n;j++){const o=j*(RW[k.ch.c]/7)/M;dyn.push({kind,gx:gx-uy*o,gy:gy+ux*o})}
    if(k.kind==='crash')dyn.push({kind:'car',gx:gx+ux*.3,gy:gy+uy*.3,ux:uy,uy:-ux,col:C.Brick,stopped:1,haz:1})}
  for(const t of L.trucks){dyn.push({kind:'truck',gx:t.gx,gy:t.gy});for(let i=0;i<5;i++)dyn.push({kind:'pp',gx:t.gx-.35-i*.14,gy:t.gy+.5,skin:skins[(i+2)%6],shirt:shirts[(i+5)%9],f:blink(T+i,.4,.4)})}
  if(!reduce){if(trainD>trainCh.L+14){trainWait-=dt;if(trainWait<=0){trainD=-12;trainWait=12}}else trainD+=dt*2.2}
  for(let k=0;k<7;k++){const d=trainD-k*2.3;if(d<0||d>trainCh.L)continue;const[gx,gy,ux,uy]=along(trainCh,d);if(!vis(gx,gy))continue;dyn.push({kind:'train',gx,gy,ux,uy,eng:k===0})}
  for(const f of FLAGS)if(vis(f.gx,f.gy))dyn.push(f);
  dyn.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy));
  const drawDyn=(o,c)=>{
    if(o.kind==='car'){const r=rect(o.gx,o.gy,o.ux,o.uy,4.4/M,2/M);drawPrism(c,r,0,4,o.col,o.col);const r2=rect(o.gx-o.ux*.3/M,o.gy-o.uy*.3/M,o.ux,o.uy,2.4/M,1.7/M);drawPrism(c,r2,4,2.5,mix(C['Haw River'],SH,.3),mix(o.col,HI,.2));
      if(lamp){ed(P(o.gx+o.ux*2.3/M,o.gy+o.uy*2.3/M,2.5),'#fff4c8',2)}if(o.stopped||lamp){ed(P(o.gx-o.ux*2.3/M,o.gy-o.uy*2.3/M,2.5),o.stopped?'#ff3a2a':'#c84a40',o.stopped?2:1)}if(o.haz&&blink(T,.4,.4)){ed(P(o.gx+o.ux*2.3/M,o.gy+o.uy*2.3/M,3),'#ffb040',2);ed(P(o.gx-o.ux*2.3/M,o.gy-o.uy*2.3/M,3),'#ffb040',2)}}
    else if(o.kind==='flag')drawFlag(c,o,{P,fr,line,SH,T,wind:WIND});
    else if(o.kind==='pp'){const[x,y]=P(o.gx,o.gy);person(c,x,y-(o.bob?1:0),o.skin,o.shirt,o.f)}
    else if(o.kind==='sig'){const[x,y]=P(o.gx,o.gy);const X=Math.round(x),Y=Math.round(y);fr(c,X,Y-15,1,15,'#3a3a40');fr(c,X-1,Y-21,3,7,'#2a2a30');const col={r:'#ff3b2a',y:'#ffc02a',g:'#3ee06a'}[o.lt],z={r:-20,y:-18,g:-16}[o.lt];fr(c,X,Y+z,1,1,col);ed([X+.5,Y+z+.5],col,1);if(lamp)eg(X+.5,Y+z+.5,4,.5,1,o.lt==='r'?'255,80,60':o.lt==='y'?'255,190,60':'80,240,120')}
    else if(o.kind==='stopsign'){const[x,y]=P(o.gx,o.gy);const X=Math.round(x),Y=Math.round(y);fr(c,X,Y-10,1,10,'#8a8a90');fr(c,X-1,Y-14,3,4,'#d22a20');fr(c,X-2,Y-13,5,2,'#d22a20');fr(c,X,Y-13,1,1,'#ffffff')}
    else if(o.kind==='cone'){const[x,y]=P(o.gx,o.gy);fr(c,Math.round(x),Math.round(y-4),1,1,C['Barrel orange']);fr(c,Math.round(x-1),Math.round(y-3),3,2,C['Barrel orange']);fr(c,Math.round(x-1),Math.round(y-2),3,1,C.Paper);fr(c,Math.round(x-2),Math.round(y-1),5,1,C['Barrel orange'])}
    else if(o.kind==='barrel'){const[x,y]=P(o.gx,o.gy);fr(c,Math.round(x-1),Math.round(y-5),3,5,C['Barrel orange']);fr(c,Math.round(x-1),Math.round(y-3),3,1,C.Paper);if(lamp&&blink(T,.5,.5))ed([x,y-6],'#ffb040')}
    else if(o.kind==='truck'){const r=rect(o.gx,o.gy,1,0,6.5/M,2.6/M);drawPrism(c,r,0,10,C.Paper,C.Tobacco);const wq=[P(o.gx-.15,o.gy+1.3/M,4),P(o.gx+.15,o.gy+1.3/M,4),P(o.gx+.15,o.gy+1.3/M,8),P(o.gx-.15,o.gy+1.3/M,8)];poly(c,wq,mix(C['Haw River'],SH,.3));if(ev)eq(wq,GLOW)}
    else if(o.kind==='train'){const r=rect(o.gx,o.gy,o.ux,o.uy,19/M,3.4/M);drawPrism(c,r,1,12,o.eng?C.Slate:'#c0603c',o.eng?'#33509a':'#8f4228');if(o.eng){const hp=P(o.gx+o.ux*9.6/M,o.gy+o.uy*9.6/M,7);ed(hp,'#fff3c0',2);if(lamp)eg(hp[0],hp[1]+3,24,.45,.6)}}
  };
  // Anything with a building, tree, lamp or parked car in front of it is cut out where those stand (see drawCut).
  const DB={sig:[6,26,6,3],stopsign:[6,18,6,3],car:[14,16,14,6],pp:[5,13,6,3],cone:[4,7,4,2],barrel:[4,9,4,2],truck:[18,28,18,8],train:[34,40,34,16],flag:[4,34,16,4]};
  for(const o of dyn){let smp;if(o.kind==='car'||o.kind==='train'){const r=o.kind==='car'?rect(o.gx,o.gy,o.ux,o.uy,4.4/M,2/M):rect(o.gx,o.gy,o.ux,o.uy,19/M,3.4/M);smp=r.map(p=>[p[0],p[1],0]).concat([[o.gx,o.gy,0]])}else if(o.kind==='truck'){smp=rect(o.gx,o.gy,1,0,6.5/M,2.6/M).map(p=>[p[0],p[1],0])}else smp=[[o.gx,o.gy,0]];
    const cuts=blockersFor(smp).map(b=>silhouette(b).p);if(o.kind!=='train')cuts.push(...occludersAt(o.gx,o.gy));
    if(!cuts.length){drawDyn(o,w);continue}
    const[x,y]=P(o.gx,o.gy),d=DB[o.kind]||DB.car;drawCut([x-d[0],y-d[1],x+d[2],y+d[3]],()=>drawDyn(o,TGT.c),cuts,{c:w,e:E,g:GL})}
  // live clocks: Lincoln Financial's bulb sign (time, then temperature) and the depot clock
  // (the depot has no clock face; the tower clock above Lincoln Financial is the town clock)
  for(const t of L.trucks){const[sx,sy]=P(t.gx,t.gy,13);for(let i=0;i<5;i++){const ph=(T*.5+i/5)%1;w.globalAlpha=(1-ph)*.55;w.fillStyle='#f2eee6';w.beginPath();w.arc(sx+ph*10+Math.sin(ph*6+i)*2,sy-ph*26,2+ph*4,0,7);w.fill()}w.globalAlpha=1}
  // leaves and petals blowing off the trees on screen, in the wind's real direction (model pixels)
  {const on=[];for(const o of pts0){if(o.kind!=='tree')continue;const[x,y]=P(o.gx,o.gy);if(x<-20||x>VWm()+20||y<-10||y>VHm()+80)continue;const lk=look(o.sp,DOY,o.seed);if(!lk.dropping&&!lk.petals)continue;on.push({x,y,hp:o.h*2,rp:o.r*1.9,look:lk})}blowing.step(w,dt,{onScreen:on,wind:WIND,reduce,W:VWm(),H:VHm()})}
  // weather in screen pixels
  w.setTransform(1,0,0,1,0,0);const ps=Math.max(1,Math.round(VS));
  if(S.wx==='rain'){w.fillStyle='rgba(205,215,235,.55)';const slant=20+Math.min(30,L.windMph)*4,nr=Math.round(rain.length*(L.intensity==='light'?.4:L.intensity==='heavy'?1:.7));rain.forEach((r,i)=>{if(i>=nr)return;if(!reduce){r[0]-=dt*slant*ps;r[1]+=dt*300*ps;if(r[1]>H){r[1]=-4;r[0]=Math.random()*W+40}if(r[0]<0)r[0]+=W}w.fillRect(r[0]|0,r[1]|0,ps,4*ps)})}
  if(S.wx==='snow'){w.fillStyle='#ffffff';snow.forEach(s=>{if(!reduce){s[1]+=dt*(14+s[2]*14)*ps;s[0]+=Math.sin(T+s[2]*9)*dt*7*ps;if(s[1]>H){s[1]=-2;s[0]=Math.random()*W}}const z=(s[2]>.6?2:1)*ps;w.fillRect(s[0]|0,s[1]|0,z,z)})}
  if(S.wx==='pollen'){w.fillStyle='#f3e37a';motes.forEach(m=>{if(!reduce){m[0]+=dt*9*ps;m[1]+=Math.sin(T+m[2])*dt*5*ps;if(m[0]>W)m[0]=0}w.fillRect(m[0]|0,m[1]|0,ps,ps)})}
  if(L.fog){if(!FOGP){const f=mk(2,2),g=f.getContext('2d');g.fillStyle='rgba(232,234,238,.10)';g.fillRect(0,0,1,1);g.fillRect(1,1,1,1);FOGP=w.createPattern(f,'repeat')}w.fillStyle=FOGP;w.fillRect(0,0,W,H);w.fillStyle='rgba(232,234,238,.18)';w.fillRect(0,0,W,H)}
  // grade (saturation up in daylight for the painted-model look), done by the graphics card: saturate, multiply, add
  const G=gradeFor(SUN),X=L.cloudy&&S.wx==='clear'?WXG.cloudy:WXG[S.wx];const m=[G.m[0]*X.m[0],G.m[1]*X.m[1],G.m[2]*X.m[2]],a=[G.a[0]+X.a[0],G.a[1]+X.a[1],G.a[2]+X.a[2]],d=Math.min(.6,G.d+X.d);
  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';
  if(HASFILTER&&Math.abs(d)>.005){ctx.filter=`saturate(${(1-d).toFixed(3)})`;ctx.drawImage(Wc,0,0);ctx.filter='none'}else ctx.drawImage(Wc,0,0);
  const c255=v=>Math.max(0,Math.min(255,Math.round(v)));
  if(m.some(v=>v<.999)){ctx.globalCompositeOperation='multiply';ctx.fillStyle=`rgb(${m.map(v=>c255(Math.min(1,v)*255)).join(',')})`;ctx.fillRect(0,0,W,H)}
  const add=a.map((v,i)=>v+Math.max(0,m[i]-1)*110);if(add.some(v=>v>.5)){ctx.globalCompositeOperation='lighter';ctx.fillStyle=`rgb(${add.map(c255).join(',')})`;ctx.fillRect(0,0,W,H)}
  ctx.globalCompositeOperation='source-over';
  if(L.storm){if(flash<=0&&!reduce&&Math.random()<.003)flash=10;if(flash>0){ctx.fillStyle=`rgba(255,255,240,${flash>7?.5:flash/30})`;ctx.fillRect(0,0,W,H);flash--}}
  ctx.drawImage(Ec,0,0);ctx.globalCompositeOperation='lighter';ctx.drawImage(Gc,0,0);ctx.globalCompositeOperation='source-over';
  // tilt-shift: blur the top and bottom bands so it reads as a small model
  if(HASFILTER){tc.clearRect(0,0,W,H);tc.filter=`blur(${(1.6*Math.max(.6,VS)*.8).toFixed(2)}px)`;const b1=Math.ceil(H*.3)+4,b2=Math.floor(H*.68)-4;tc.drawImage(cv,0,0,W,b1,0,0,W,b1);tc.drawImage(cv,0,b2,W,H-b2,0,b2,W,H-b2);tc.filter='none';tc.globalCompositeOperation='destination-in';const gr=tc.createLinearGradient(0,0,0,H);gr.addColorStop(0,'rgba(0,0,0,1)');gr.addColorStop(.3,'rgba(0,0,0,0)');gr.addColorStop(.68,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,0,0,1)');tc.fillStyle=gr;tc.fillRect(0,0,W,H);tc.globalCompositeOperation='source-over';ctx.drawImage(Tc,0,0)}
  // Lincoln Financial's bulb sign (time, then temperature) goes on last, outside the tilt-shift blur, so it stays sharp
  const tw=byId.tower;if(tw&&tw.lantern){const txt=blink(T,5,3)||reduce||L.tempF==null?fmtTime(D):(Math.round(L.tempF)+'°F');ctx.setTransform(VS,0,0,VS,0,0);for(const wl of visWalls(tw.lantern))lanternSign(ctx,wl,tw.lanternZ,tw.lanternTop,txt);ctx.setTransform(1,0,0,1,0,0)}
  const vg=ctx.createRadialGradient(W/2,H/2,H*.45,W/2,H/2,W*.62);vg.addColorStop(0,'rgba(20,10,30,0)');vg.addColorStop(1,'rgba(20,10,30,.22)');ctx.fillStyle=vg;ctx.fillRect(0,0,W,H);
  // labels, signposts and the highlight keep a steady size on screen: drawn in label pixels (LS canvas pixels each)
  ctx.setTransform(LS,0,0,LS,0,0);const WL=W/LS,HL=H/LS,LP=([x,y])=>[x*VS/LS,y*VS/LS];
  ctx.font='8px Silkscreen, monospace';ctx.textBaseline='top';
  const tag=(x,y,t)=>{x=Math.round(x);y=Math.round(y);const tw_=Math.ceil(ctx.measureText(t).width)+8;const bx=Math.max(2,Math.min(WL-tw_-2,x-(tw_>>1)));if(y<2||y>HL-14||x<4||x>WL-4)return;ctx.fillStyle=SH;ctx.fillRect(bx+1,y-1,tw_-2,13);ctx.fillRect(bx,y,tw_,11);ctx.fillStyle=C.Paper;ctx.fillRect(bx+1,y,tw_-2,11);ctx.fillStyle=SH;ctx.fillRect(x-1,y+12,3,2);ctx.fillText(t,bx+4,y+2)};
  const top=b=>LP(P(b.cx,b.cy,(b.htop||b.hpx)+(b.special==='tower'?10:8)));
  const bub=[];const nb=L.bubbles.length;
  if(nb){const slot=Math.floor(T/7);for(let k=0;k<Math.min(2,nb);k++){const o=L.bubbles[(slot*2+k)%nb];if(!blink(T+k*3.5,6,1))continue;const b=o.id!=null?byId[o.id]:null;bub.push([b?top(b):LP(P(o.gx,o.gy,24)),o.text])}}
  if(S.labels){for(const[k,t]of LABELS){const b=byId[k];if(!b)continue;const[x,y]=top(b);tag(x,y-10,t)}}
  else bub.forEach(([[x,y],t])=>tag(x,y-10,t));
  if(hoverB&&hoverB.name&&!hoverB.sign){const[x,y]=top(hoverB);tag(x,y-10,hoverB.name)}
  // signposts at the edge of the model, pointing to the rest of town
  signRects=[];
  for(const g of L.signs){const[px,py]=LP(P(g.gx,g.gy));if(px<-80||px>WL+80||py<-10||py>HL+40)continue;const x=Math.round(px),y=Math.round(py);
    ctx.fillStyle='rgba(44,33,71,.35)';ctx.fillRect(x-2,y,6,2);ctx.fillStyle='#6a4a30';ctx.fillRect(x,y-22,2,22);
    const t=g.n?`${g.name} ${g.n}`:g.name,tw_=Math.ceil(ctx.measureText(t).width)+8,right=g.sx>=0,bx=right?x-2:x+4-tw_,by=y-34,hot=hoverB&&hoverB.sign===g.id;
    ctx.fillStyle=SH;ctx.fillRect(bx-1,by-1,tw_+2,13);ctx.fillStyle=hot?'#fff7e0':C.Paper;ctx.fillRect(bx,by,tw_,11);
    for(let k=0;k<6;k++){const ax=right?bx+tw_+1+k:bx-2-k;ctx.fillStyle=SH;ctx.fillRect(ax,by+k,1,11-2*k);if(k<5){ctx.fillStyle=hot?'#fff7e0':C.Paper;ctx.fillRect(ax+(right?-1:1)*0,by+k+1,1,Math.max(0,9-2*k))}}
    ctx.fillStyle=g.n?'#8a3b2b':SH;ctx.fillText(t,bx+4,by+2);signRects.push({id:g.id,name:g.name,x:Math.min(bx,bx-7),y:by,w:tw_+8,h:22+12})}
  // the building picked in the paper: a gold outline and a bobbing marker above it
  if(hiB){if(!hiB.hull){const o0=ox,o1=oy;ox=BOX;oy=BOY;const z=hiB.htop||hiB.hpx;hiB.hull=hull(hiB.pts.map(p=>P(p[0],p[1])).concat(hiB.pts.map(p=>P(p[0],p[1],z))));ox=o0;oy=o1}
    const hp=new Path2D();hiB.hull.forEach(([x,y],i)=>{const[qx,qy]=LP([x+ox-BOX,y+oy-BOY]);i?hp.lineTo(qx+.5,qy+.5):hp.moveTo(qx+.5,qy+.5)});hp.closePath();
    ctx.lineJoin='round';ctx.strokeStyle=SH;ctx.lineWidth=4;ctx.stroke(hp);ctx.strokeStyle='#ffd23f';ctx.lineWidth=2;ctx.stroke(hp);
    const[mx,my]=top(hiB);const bob=reduce?0:Math.round(Math.sin(T*4)*2);const x=Math.round(mx),y=Math.round(my)-14+bob;
    ctx.fillStyle=SH;ctx.fillRect(x-5,y-11,11,9);ctx.fillRect(x-3,y-2,7,2);ctx.fillRect(x-1,y,3,2);ctx.fillStyle='#ffd23f';ctx.fillRect(x-4,y-10,9,7);ctx.fillRect(x-2,y-3,5,2);ctx.fillRect(x,y-1,1,2);ctx.fillStyle=SH;ctx.fillRect(x-1,y-8,3,3)}
  ctx.setTransform(1,0,0,1,0,0);
  if(!reduce||!frame.once||frame.stale){frame.once=true;requestAnimationFrame(frame)}
}

let pending=0;const restatic=()=>{clearTimeout(pending);pending=setTimeout(()=>{renderStatic();if(reduce)requestAnimationFrame(frame)},10)};
// Live scene from app.js. Static layers are redrawn only when something that is painted into them changes.
function update(scene){
  const prevKey=JSON.stringify([L.wx,L.cloudy,[...L.lit],[...L.strings],L.council.lit]);
  L={...L,...scene};
  S.wx=L.wx==='storm'?'rain':L.wx;L.storm=L.wx==='storm';
  const pw=windKey(WIND);WIND=windOn(L.windMph,L.windGustMph,L.windFromDeg);
  // closures snap to the nearest street the cars drive on
  L.closures=(scene.roads||[]).map(r=>{let best=null;for(const ch of chains){for(let i=1;i<ch.p.length;i++){const[a0,a1]=ch.p[i-1],[b0,b1]=ch.p[i];const dx=b0-a0,dy=b1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((r.gx-a0)*dx+(r.gy-a1)*dy)/L2)):0;const d=Math.hypot(a0+dx*t-r.gx,a1+dy*t-r.gy);if(!best||d<best.dist)best={ch,dist:d,d:ch.cum[i-1]+Math.sqrt(L2)*t}}}return best&&best.dist<4?{...r,ch:best.ch,d:best.d}:null}).filter(Boolean);
  // and onto the traffic lanes: a full closure blocks both directions there, so cars queue before it and route round it
  for(const l of TF.lanes)l.blocked=false;
  for(const k of L.closures){k.lanes=[];let best=null;for(const l of TF.lanes){const ch=l.ch;for(let i=1;i<ch.p.length;i++){const[a0,a1]=ch.p[i-1],[b0,b1]=ch.p[i];const dx=b0-a0,dy=b1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((k.gx-a0)*dx+(k.gy-a1)*dy)/L2)):0;const d=Math.hypot(a0+dx*t-k.gx,a1+dy*t-k.gy);if(!best||d<best.d)best={l,d,s:ch.cum[i-1]+Math.sqrt(L2)*t}}}
    if(best&&best.d<4){k.lanes.push({lane:best.l,s:best.s});if(best.l.rev)k.lanes.push({lane:best.l.rev,s:best.l.L-best.s});if(k.full)for(const q of k.lanes)q.lane.blocked=true}}
  if(scene.signs)L.signs=placeSigns(scene.signs);
  const key=JSON.stringify([L.wx,L.cloudy,[...L.lit],[...L.strings],L.council.lit]);
  if(key!==prevKey||windKey(WIND)!==pw){L.version++;if(started)restatic()}
}
// Each area's signpost goes where a line from the middle of the model toward that area leaves the model,
// a little inside the base, nudged off buildings and away from the other signs.
function placeSigns(list){const G=MAP.GEO;const cx=GX/2,cy=GY/2,out=[];
  const inB=(x,y)=>blds.some(b=>x>=b.minx-.4&&x<=b.maxx+.4&&y>=b.miny-.4&&y<=b.maxy+.4&&pip(x,y,b.pts));
  for(const s of list){const tx=(s.lon-G.west)*G.mPerDegLon/M,ty=(G.north-s.lat)*G.mPerDegLat/M;let dx=tx-cx,dy=ty-cy;const Ln=Math.hypot(dx,dy)||1;dx/=Ln;dy/=Ln;
    const pad=2.5;let t=Infinity;if(dx)t=Math.min(t,((dx>0?GX-pad:pad)-cx)/dx);if(dy)t=Math.min(t,((dy>0?GY-pad:pad)-cy)/dy);
    let gx=cx+dx*t,gy=cy+dy*t;for(let k=0;k<20&&inB(gx,gy);k++){gx-=dx*.6;gy-=dy*.6}
    for(let k=0;k<12&&out.some(o=>Math.hypot(o.gx-gx,o.gy-gy)<5);k++){gx+=-dy*1.5;gy+=dx*1.5;gx=Math.max(pad,Math.min(GX-pad,gx));gy=Math.max(pad,Math.min(GY-pad,gy))}
    out.push({...s,gx,gy,sx:dx-dy})}return out}
/** Building by OSM id (or landmark key), with its name and centre, for the paper. */
const building=id=>byId[id]||null;
/** Building whose footprint holds a grid point, or the nearest one within a tile or two. */
function buildingAt(gx,gy,maxDist=2.2){let best=null,bd=maxDist;for(const b of blds){if(gx<b.minx-bd||gx>b.maxx+bd||gy<b.miny-bd||gy>b.maxy+bd)continue;if(pip(gx,gy,b.pts))return b;let d=Infinity;for(let k=0;k<b.pts.length;k++){const[a0,a1]=b.pts[k],[q0,q1]=b.pts[(k+1)%b.pts.length];const dx=q0-a0,dy=q1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((gx-a0)*dx+(gy-a1)*dy)/L2)):0;d=Math.min(d,Math.hypot(a0+dx*t-gx,a1+dy*t-gy))}if(d<bd){bd=d;best=b}}return best}
/** Glide the camera to a building and hold it there for a while. */
function lookAt(b){if(!b)return;[tgtX,tgtY]=camFor(b);tgtX=clampX(tgtX);tgtY=clampY(tgtY);if(reduce){camX=tgtX;camY=tgtY;requestAnimationFrame(frame)}else glide=true}
let started=false,glide=false;

// ---------- view size and zoom ----------
// The canvas fills whatever box the page gives it. Zoom levels are device pixels per model pixel. The model is drawn at
// up to RESMAX canvas pixels per model pixel (VS) for sharp detail, and below 1 when zoomed far out, so the whole of
// downtown fits; each canvas pixel is a whole number (k) of device pixels so edges stay crisp.
const ZL=[.25,.35,.5,.7,1,1.5,2,3,4,6],MAXPX=2.6e6;let zi=-1,KPX=1;
const dev=()=>{const r=cv.getBoundingClientRect(),dpr=window.devicePixelRatio||1;return{r,dpr,dw:Math.round(r.width*dpr),dh:Math.round(r.height*dpr)}};
function planFor(z,dw,dh){let k=1;while(z/k>RESMAX+1e-9||(dw/k)*(dh/k)>MAXPX)k++;return{k,vs:z/k}}
// zoom out until the whole model is in view, and in until about 160 model pixels fill the width
const zoomAllowed=(i,dw,dh)=>i>=0&&i<ZL.length&&dw/ZL[i]>=160&&(i>=zi||BW*ZL[i+1]>dw*.92||BH*ZL[i+1]>dh*.92);
function fit(force){const{r,dpr,dw,dh}=dev();if(!r.width||!r.height)return;
  if(zi<0){const zq=+new URLSearchParams(location.search).get('z');const want=zq>0?zq:r.width<700?Math.max(1,dpr*.8):Math.max(1,Math.round(dw/1000));zi=ZL.reduce((bi,v,i)=>Math.abs(v-want)<Math.abs(ZL[bi]-want)?i:bi,0)}
  while(zi>0&&dw/ZL[zi]<160)zi--;
  const{k,vs}=planFor(ZL[zi],dw,dh);const nW=Math.ceil(dw/k),nH=Math.ceil(dh/k);if(!force&&nW===W&&nH===H&&vs===VS)return;
  const mx=camX+VWm()/2,my=camY+VHm()/2;W=nW;H=nH;VS=vs;KPX=k;LS=Math.max(1,Math.round(dpr*2))/k;makeLayers();reseed();camX=clampX(mx-VWm()/2);camY=clampY(my-VHm()/2);tgtX=camX;tgtY=camY;glide=false;
  if(started&&reduce)requestAnimationFrame(frame)}
function zoomBy(d){const{dw,dh}=dev();if(!zoomAllowed(zi+d,dw,dh))return false;zi+=d;fit(true);return true}
const canZoom=d=>{const{dw,dh}=dev();return zoomAllowed(zi+d,dw,dh)};
new ResizeObserver(()=>fit()).observe(cv);fit();
cv.addEventListener('wheel',e=>{e.preventDefault();wheelAcc+=e.deltaY;if(Math.abs(wheelAcc)>=60){zoomBy(wheelAcc<0?1:-1);wheelAcc=0;onView()}},{passive:false});let wheelAcc=0;
cv.addEventListener('keydown',e=>{const k=e.key,st=80/VS/KPX;let dx=0,dy=0;if(k==='ArrowLeft')dx=-st;else if(k==='ArrowRight')dx=st;else if(k==='ArrowUp')dy=-st;else if(k==='ArrowDown')dy=st;else if(k==='+'||k==='=')zoomBy(1),onView();else if(k==='-'||k==='_')zoomBy(-1),onView();else return;e.preventDefault();if(dx||dy){camX=clampX(camX+dx);camY=clampY(camY+dy);tgtX=camX;tgtY=camY;glide=false;if(reduce)requestAnimationFrame(frame)}});
/** Pan by a fraction of the view (for on-screen buttons). */
function pan(fx,fy){tgtX=clampX(camX+fx*VWm());tgtY=clampY(camY+fy*VHm());if(reduce){camX=tgtX;camY=tgtY;requestAnimationFrame(frame)}else glide=true}
function home(){lookAt(byId.tower||blds[0])}
// first paint: a loading card, then build the model
ctx.fillStyle='#3a2c26';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff3d6';ctx.font=Math.round(10*LS)+'px Silkscreen, monospace';ctx.textAlign='center';ctx.fillText('building the model of downtown…',W/2,H/2);ctx.textAlign='start';
setTimeout(()=>{renderStatic();started=true;(document.fonts?document.fonts.ready:Promise.resolve()).then(()=>requestAnimationFrame(frame))},30);
return{update,building,buildingAt,lookAt,sunTimes,fmtTime,ampm,setLabels:v=>{S.labels=!!v;if(reduce)requestAnimationFrame(frame)},
  zoomIn:()=>zoomBy(1),zoomOut:()=>zoomBy(-1),canZoom,pan,home,highlight:b=>{hiB=b||null;if(reduce)requestAnimationFrame(frame)}};
}
