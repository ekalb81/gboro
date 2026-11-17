// The downtown scale model ("Brick and Clay", designed by June Holloway's brief in the design thread).
// Plain canvas, no build step. Ported from the design mockup; the mockup's example toggles are replaced
// by a live scene from app.js (weather, council, closures, events, open bars and restaurants).
//
//   const model = startModel({ canvas, map, onPick, onHover, onView });
//   model.update(scene)   // see app.js buildScene() for the shape
//   model.zoomIn() / zoomOut() / canZoom(±1) / pan(fx, fy) / home() / lookAt(b) / highlight(b)
//
// The canvas fills whatever box the page gives it. The camera only moves when someone drags, zooms or picks
// something; it never wanders off on its own. A zoom glides to the next level in a fraction of a second (it jumps
// with prefers-reduced-motion).
//
// map is public/model/downtown.json (tools/model/prep.py). Drop in a newer one and nothing here changes.
import { clockAt, nowDoing, dayRand } from './homeday.js';
import { mowRoute } from './house.js';
import { loadTrees, loadFlags, drawTree as drawTreeSp, treeOutline, treeOutlineParts, addOutlinePart, dayOfYear, look, windOn, windKey, makeBlowing, drawFlag } from './trees.js';
import { makeDetails } from './details.js';

export function startModel({ canvas: cv0, map: MAP, trees: TREES = null, home: HOME = null, details: DET = null, onPick = () => {}, onHover = () => {}, onView = () => {} }) {
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
const NYF=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23',weekday:'short'});
const nyParts=d=>Object.fromEntries(NYF.formatToParts(d).map(p=>[p.type,p.value]));
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
// W,H: the view canvas in canvas pixels. VS: canvas pixels per model pixel (the render scale: see "view size and zoom"
// for how it is chosen; below 1 when zoomed far out). Model pixels are the units every drawing routine below works in.
let W=800,H=450,VS=1;const TILE=512;const TW=16,TH=8,ZPM=2.0,M=MAP.M,GX=MAP.GX,GY=MAP.GY,MARG=60,MAXH=270;
const BW=Math.ceil((GX+GY)*TW+2*MARG),BH=Math.ceil((GX+GY)*TH+MAXH+2*MARG+20);
const BOX=GY*TW+MARG,BOY=MAXH+MARG;
let ox=BOX,oy=BOY;
const P=(gx,gy,z=0)=>[ox+(gx-gy)*TW,oy+(gx+gy)*TH-z];
const pairs=a=>{const r=[];for(let i=0;i<a.length;i+=2)r.push([a[i],a[i+1]]);return r};
const cache=new Map();const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function mix(a,b,t){const k=a+b+t;let v=cache.get(k);if(v)return v;const A=hex(a),B=hex(b);v='#'+A.map((x,i)=>Math.max(0,Math.min(255,Math.round(x+(B[i]-x)*t))).toString(16).padStart(2,'0')).join('');cache.set(k,v);return v}
const hash=(a,b)=>{const s=Math.sin(a*12.9898+b*78.233)*43758.5453;return s-Math.floor(s)};
function pip(x,y,pts){let ins=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)ins=!ins}return ins}
function hull(p){p=p.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],up=[];for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q)}for(let i=p.length-1;i>=0;i--){const q=p[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0)up.pop();up.push(q)}up.pop();lo.pop();return lo.concat(up)}

// ---------- canvases ----------
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const cv=cv0,ctx=cv.getContext('2d');const QS=new URLSearchParams(location.search);
// How a frame is put together. 'layers' (the default): the picture is drawn straight onto the visible canvas, the lit
// windows and the glow are two more canvases stacked on it, and the browser's compositor does the colour grade
// (saturate, multiply, add), the tilt-shift blur (backdrop-filter under a fading mask) and the vignette; the lantern
// sign and the labels go on one more canvas on top, so they stay sharp. Nothing is copied from canvas to canvas.
// 'canvas' (?compose=canvas, or a browser without the CSS it needs): everything is composited in the canvas, as before.
// Without a graphics card (a software renderer) the compositor's blur and blending and the clipping of moving things
// cost more than the old way, so such a machine keeps the old way throughout: ?compose=layers and ?cut=clip force the new.
const SOFT=(()=>{try{const g=document.createElement('canvas').getContext('webgl');if(!g)return false;const x=g.getExtension('WEBGL_debug_renderer_info'),r=String(x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER));
  const l=g.getExtension('WEBGL_lose_context');if(l)l.loseContext();return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(r)}catch{return false}})();
let LYWHY='';const LY=(()=>{const par=cv.parentElement,sup=(k,v)=>!!(window.CSS&&CSS.supports&&CSS.supports(k,v));
  const bf=sup('backdrop-filter','blur(1px)')?'backdropFilter':sup('-webkit-backdrop-filter','blur(1px)')?'webkitBackdropFilter':'';
  if(QS.get('compose')==='canvas'){LYWHY='asked for';return null}
  if(!par||!bf||!sup('mix-blend-mode','plus-lighter')||!sup('mix-blend-mode','multiply')||getComputedStyle(par).position==='static'){LYWHY='the browser lacks backdrop-filter or plus-lighter';return null}
  if(SOFT&&QS.get('compose')!=='layers'){LYWHY='software renderer, no graphics card';return null}
  const base='position:absolute;pointer-events:none;margin:0;padding:0;border:0;',ir=getComputedStyle(cv).imageRendering;
  const el=(tag,css)=>{const e=document.createElement(tag);e.setAttribute('aria-hidden','true');e.style.cssText=base+css;if(tag==='canvas'){e.width=e.height=1;e.style.imageRendering=ir}return e};
  const mask=d=>{const g=`linear-gradient(to ${d},#000,transparent)`;return`-webkit-mask-image:${g};mask-image:${g};`};
  const L_={bf,mul:el('div','mix-blend-mode:multiply;display:none;'),add:el('div','mix-blend-mode:plus-lighter;display:none;'),flash:el('div','display:none;'),
    e:el('canvas',''),g:el('canvas','mix-blend-mode:plus-lighter;display:none;'),bt:el('div',mask('bottom')),bb:el('div',mask('top')),vig:el('div',''),o:el('canvas',''),gOn:false,css:{}};
  L_.all=[L_.mul,L_.add,L_.flash,L_.e,L_.g,L_.bt,L_.bb,L_.vig,L_.o];let at=cv;for(const e of L_.all){at.after(e);at=e}
  return L_})();
// Name tags, signposts and the highlight go on a canvas of their own laid over the model, at the screen's own resolution:
// the model canvas is drawn at half or a third of that when zoomed in, which made small type chunky. It sits above every layer.
const lc=document.createElement('canvas');lc.setAttribute('aria-hidden','true');lc.style.pointerEvents='none';(LY?LY.o:cv).after(lc);const lx=lc.getContext('2d');let LSO=2;
let Wc,Ec,Gc,Tc,w,E,GL,tc,oc;
// ?bench / ?fps: what happened since the last frame (a zoom step, a canvas resized, a style changed) and the time spent
// in input handlers and in laying out the layers, for the readout and the benchmark. Off, these do nothing.
const DIAG=QS.has('bench')||QS.has('fps'),evs=[],ev=s=>{if(DIAG&&evs.length<24)evs.push(s)},tm={inp:0,fit:0,ml:0,pl:0};
// Where the canvas sits and how big it is, measured once and again only when its box or the screen's pixel ratio changes:
// asking the browser on every zoom step (after sizes and styles were just written) made it lay the page out on the spot.
let GEO=null;const geo=()=>{const dpr=window.devicePixelRatio||1;if(GEO&&GEO.dpr===dpr)return GEO;const r=cv.getBoundingClientRect(),g={r,dpr,dw:Math.round(r.width*dpr),dh:Math.round(r.height*dpr),x:cv.offsetLeft,y:cv.offsetTop,cw:cv.offsetWidth,ch:cv.offsetHeight};if(r.width&&r.height)GEO=g;return g};
function makeLayers(){const T0=DIAG?performance.now():0;makeLayers0();if(DIAG)tm.ml+=performance.now()-T0}
function makeLayers0(){
  if(LY){for(const c of [cv,LY.e,LY.o].concat(LY.gOn?[LY.g]:[]))if(c.width!==W||c.height!==H){c.width=W;c.height=H;if(c===cv)ev('canvas '+W+'x'+H)}
    if(!w){w=ctx;E=LY.e.getContext('2d');GL=LY.g.getContext('2d');oc=LY.o.getContext('2d')}return}
  if(Wc&&Wc.width===W&&Wc.height===H&&cv.width===W&&cv.height===H)return; // a zoom step at the same canvas size keeps them
  Wc=mk(W,H);Ec=mk(W,H);Gc=mk(W,H);Tc=mk(W,H);w=Wc.getContext('2d');E=Ec.getContext('2d');GL=Gc.getContext('2d');tc=Tc.getContext('2d');cv.width=W;cv.height=H;oc=ctx;ev('canvas '+W+'x'+H)}
// layers mode: the stacked elements sit exactly on the canvas; the blur and the vignette are sized in CSS pixels.
// Each style is written only when its value changes: a zoom step at the same canvas size moves nothing and only the
// blur radius differs. R gives the size and scale to style for when they are not the current ones (a zoom on its way).
function placeLayers(R,boxOnly){if(!LY)return;const T0=DIAG?performance.now():0;placeLayers0(R||{W,H,vs:VS},boxOnly);if(DIAG)tm.pl+=performance.now()-T0}
function placeLayers0(R,boxOnly){const{x,y,cw,ch}=geo();if(!cw)return;const gk=[x,y,cw,ch].join();
  if(gk!==LY.gk){LY.gk=gk;const box=(e,t,h)=>{e.style.left=x+'px';e.style.top=y+t+'px';e.style.width=cw+'px';e.style.height=h+'px'};
    for(const e of LY.all)box(e,0,ch);box(LY.bt,0,ch*.3);box(LY.bb,ch*.68,ch-ch*.68);ev('layers moved')}
  if(boxOnly)return;
  const s=cw/R.W,bl=`blur(${(1.6*Math.max(.6,R.vs)*.8*s).toFixed(2)}px)`;if(bl!==LY.bl){LY.bl=bl;LY.bt.style[LY.bf]=bl;LY.bb.style[LY.bf]=bl;ev(bl)}
  // the same as the canvas gradient from radius .45 H (clear) to .62 W (dark); on a tall view the second is the smaller, and it runs the other way
  const r0=R.H*.45*s,r1=R.W*.62*s,c0='rgba(20,10,30,0)',c1='rgba(20,10,30,.22)';
  const vg=`radial-gradient(circle at 50% 50%,${r0<r1?c0:c1} ${Math.min(r0,r1).toFixed(1)}px,${r0<r1?c1:c0} ${Math.max(r0,r1).toFixed(1)}px)`;if(vg!==LY.vg){LY.vg=vg;LY.vig.style.background=vg;ev('vignette')}}
// the glow canvas is only there while something glows (lamps on, or a tile with glow on it)
// (it keeps its size for ten seconds after the last glow, so a zoom or a drag that brings one lit thing in and out of
// view does not allocate a canvas each time; it is always blank while hidden)
function useGlow(on){if(!LY)return;
  if(on){LY.gIdle=0;if(!LY.gOn){LY.gOn=true;LY.g.style.display='';ev('glow on');if(LY.g.width!==W||LY.g.height!==H){LY.g.width=W;LY.g.height=H}}}
  else if(LY.gOn){LY.gOn=false;LY.gIdle=0;LY.g.style.display='none';ev('glow off')}
  else if(LY.g.width>1&&++LY.gIdle>600)LY.g.width=LY.g.height=1}
const layerCss=(e,k,v)=>{if(LY.css[k]===v)return;LY.css[k]=v;e.style.display=v?'':'none';if(v)e.style.background=v};
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

// TGT.de / TGT.dg: something may be painted on the lit-window / glow layer; while not, rubbing out there is a no-op and is skipped
function erase(p){if(TGT.de)eraseOn(TGT.e,p);if(TGT.dg)eraseOn(TGT.g,p)}
function eraseOn(e,p){e.globalCompositeOperation='destination-out';e.fillStyle='#000';e.fill(p);e.globalCompositeOperation='source-over'}
function path(pts){const p=new Path2D();p.moveTo(pts[0][0],pts[0][1]);for(let i=1;i<pts.length;i++)p.lineTo(pts[i][0],pts[i][1]);p.closePath();return p}
function poly(c,pts,fill,stroke){const p=path(pts);c.fillStyle=fill;c.fill(p);if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke(p)}if(c===TGT.c)erase(p)}
let LNE=false; // lines rub out the lit-window and glow layers under them too (as a scratch card did): set while a static thing is drawn under a clip
function line(c,a,b,col,lw=1){c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.strokeStyle=col;c.lineWidth=lw;c.stroke();
  if(LNE&&c===TGT.c)for(const e of [TGT.de?TGT.e:null,TGT.dg?TGT.g:null])if(e){e.globalCompositeOperation='destination-out';e.beginPath();e.moveTo(a[0],a[1]);e.lineTo(b[0],b[1]);e.strokeStyle='#000';e.lineWidth=lw;e.stroke();e.globalCompositeOperation='source-over'}}
function fr(c,x,y,ww,hh,col){c.fillStyle=col;c.fillRect(x,y,ww,hh);if(c===TGT.c){if(TGT.de)TGT.e.clearRect(x,y,ww,hh);if(TGT.dg)TGT.g.clearRect(x,y,ww,hh)}}
function circ(c,x,y,r,col){const p=new Path2D();p.arc(x,y,r,0,7);c.fillStyle=col;c.fill(p);if(c===TGT.c)erase(p)}
const eq=(q,col,al)=>{TGT.de=TGT.wide=1;const e=TGT.e;e.fillStyle=col;if(al==null)e.fill(path(q));else{e.globalAlpha=al;e.fill(path(q));e.globalAlpha=1}};
const ed=(p,col,s=1)=>{TGT.de=1;if(TGT.ink)TGT.ink.push(p[0],p[1]);TGT.e.fillStyle=col;TGT.e.fillRect(Math.round(p[0]-s/2),Math.round(p[1]-s/2),s,s)};
function eg(x,y,r,al,sy=1,col='255,205,120'){TGT.dg=1;const G=TGT.g;G.save();G.translate(x,y);G.scale(1,sy);const gr=G.createRadialGradient(0,0,0,0,0,r);gr.addColorStop(0,`rgba(${col},${al})`);gr.addColorStop(1,`rgba(${col},0)`);G.fillStyle=gr;G.fillRect(-r,-r,r*2,r*2);G.restore()}

// ---------- buildings ----------
const PART=Object.fromEntries((MAP.PT||[]).map(p=>[p.id,p]));
// The OSM outline 208115796 covers both towers. Use its real 3D parts instead:
// Lincoln Financial Tower (1990) and the Jefferson Standard Building (1923), joined by a low connector.
(()=>{const ob=MAP.B.find(b=>b.id===208115796);if(!ob||!PART[341049142]||!PART[467218959])return;
  ob.p=[44.85,46.66,46.42,46.72,45.97,50.57,44.6,50.42];ob.l=4;ob.h=16;ob.n='';ob.t='office';
  MAP.B.push({id:341049142,p:PART[341049142].p,l:20,h:79,t:'office',n:'Lincoln Financial Tower'});
  MAP.B.push({id:467218959,p:PART[467218959].p,l:18,h:65,t:'office',n:'Jefferson Standard Building'})})();
// Bridges (MAP.DK, from prep.py): each deck is a slab that takes its place among the buildings, so it is drawn in the
// right order and hides what passes under or behind it. A road bridge's span stands on piers and its approaches are
// ramps of fill whose tops slope evenly down to the street (tools/model/bridges.py; a ramp piece carries its slope
// in dk.sl); a rail bridge is a low girder plate the tracks cross on while the street dips under it; a skywalk is a
// glazed box above the street. Cars, people and trains on a deck ride at its height (rideZ).
(MAP.DK||[]).forEach((d,i)=>MAP.B.push({id:9200000000+i,p:d.p,t:'bridge',n:'',dk:d}));
// The house up the street (model/house.json, drawn close up by house.js): here its outline is the measured one, it gets
// its own walls and roof, and the one who lives there goes about her made-up day on the lot (see HD below). It carries
// no name, tenant or address.
const HM=HOME&&HOME.at?(()=>{const[ax,ay]=HOME.at,g=p=>[ax+p[0]/M,ay+p[1]/M],Hh=HOME.house,m=Hh.main;
  const rectG=r=>[g([r[0],r[1]]),g([r[2],r[1]]),g([r[2],r[3]]),g([r[0],r[3]])].flat(),c=g([(m[0]+m[2])/2,(m[1]+m[3])/2]);
  let ob=MAP.B.find(b=>!b.dk&&pip(c[0],c[1],pairs(b.p)));if(!ob){ob={id:9300000001};MAP.B.push(ob)}
  Object.assign(ob,{p:rectG(m),t:'house',n:'',tn:[],ad:'',a:''});delete ob.tr;delete ob.tb;delete ob.f;
  const ids={[ob.id]:'home'};
  if(Hh.wing){MAP.B.push({id:9300000002,p:rectG(Hh.wing),t:'house',n:'',lh:Hh.wingEave||Hh.eave});ids[9300000002]='home'}
  if(HOME.shed){MAP.B.push({id:9300000003,p:rectG(HOME.shed.box),t:'shed',n:'',lh:HOME.shed.h});ids[9300000003]='homeshed'}
  return{g,ids}})():null;
const SPECIAL={...(HM?HM.ids:{}),341049142:'tower',467218959:'jsb',208101229:'kress',208202822:'theatre',326037856:'city',264852482:'depot',1064222230:'tanger',208101224:'icrc',133178249:'ballpark'};
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
  const hm=(b.dk?b.dk.z1:0)||(b.tb>2.5?b.tb:0)||(b.id!==208115796&&b.lh>2.5?b.lh:0)||b.h||lv*3.6;if(b.lh>2.5&&!b.l&&!(F&&F.floors))lv=Math.max(1,Math.round(b.lh/3.8));const hpx=Math.min(250,hm*ZPM);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),sums=pts.map(p=>p[0]+p[1]);
  const o={i,id:b.id,pts,t,name:b.n,tn:b.tn||[],ad:b.ad||'',am:b.a||'',lv,hm,hpx,area,special:SPECIAL[b.id]||'',minx:Math.min(...xs),maxx:Math.max(...xs),miny:Math.min(...ys),maxy:Math.max(...ys),key:(Math.min(...sums)+Math.max(...sums))/2,cx:xs.reduce((a,c)=>a+c,0)/xs.length,cy:ys.reduce((a,c)=>a+c,0)/ys.length};
  const pick=(arr,s=3)=>arr[Math.floor(hash(b.id%7919,s)*arr.length)];
  if(b.dk){o.deck=b.dk.k;o.dk=b.dk;o.z0=b.dk.z0*ZPM;o.wall=C.Concrete;o.roof=C.Asphalt;if(b.dk.cl&&Array.isArray(b.dk.cl[0]))o.cls=b.dk.cl.map(pairs);
    // a ramp's top is a tilted plane: z = sl[0] + sl[1]*gx + sl[2]*gy (model pixels), kept between its two end heights
    if(b.dk.sl){const[ax,ay,za,bx,by,zb]=b.dk.sl,dx=bx-ax,dy=by-ay,L2=dx*dx+dy*dy||1,kx=(zb-za)*ZPM*dx/L2,ky=(zb-za)*ZPM*dy/L2,k0=za*ZPM-kx*ax-ky*ay,lo=Math.min(za,zb)*ZPM,hi=Math.max(za,zb)*ZPM;o.sl=[k0,kx,ky];o.zf=(x,y)=>Math.max(lo,Math.min(hi,k0+kx*x+ky*y))}}
  else if(o.special==='tower'){o.wall='#ece4d2';o.roof='#cfc6b3';o.win=3.2;o.cornice=1}
  else if(o.special==='home'){o.wall=HOME.house.wall;o.roof=HOME.house.roof;o.hip=1}
  else if(o.special==='homeshed'){o.wall=HOME.shed.wall;o.roof=HOME.shed.roof;o.hip=1}
  else if(o.special==='kress'){o.wall='#f0e4c4';o.roof='#cdc6b8';o.win=2.6;o.cornice=1;o.shop=1;o.lv=4;o.piers=1}
  else if(o.special==='jsb'){o.wall='#e9e0cc';o.roof='#cdc6b8';o.win=2.9;o.cornice=1;o.arch=1}
  else if(b.mat==='brick'&&!o.special&&!['house','detached','residential'].includes(t)){o.wall=pick(brickW);o.roof=pick(roofsF);o.shop=['retail','yes','commercial'].includes(t);o.cornice=1}
  else if(lv>=8){o.wall=pick([C.Limestone,'#bfe0ef','#e8dccb','#a9d4ea']);o.roof=pick(roofsF);o.win=3.2}
  else if(t==='parking'){o.wall=C.Concrete;o.roof='#b9b2a4';o.garage=1}
  else if(t==='church'){o.wall=pick([C.Brick,C['Old brick'],C.Limestone]);o.roof='#55555c';o.hip=1}
  else if(['house','detached','residential'].includes(t)&&area<400){o.wall=pick(pastW);o.roof=pick(roofsH);o.hip=o.house=1}
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
  if(b.rc&&!['tower','jsb'].includes(o.special)&&(!o.hip||o.house))o.roof=mix(b.rc,HI,.08);
  // a house: the measured height is its roof, so the walls stop at the eaves, with a house's few windows
  if(o.house||o.special==='home'){o.lv=o.hm>6.6?2:1;o.hpx=Math.max(2.6,o.hm-(o.lv>1?2.2:2.4))*ZPM;o.win=4.4}
  // what the street photos show (medium and high confidence only)
  if(Fok&&!['tower','jsb','kress','theatre'].includes(o.special)){
    if(F.wall_hex)o.wall=mix(F.wall_hex,HI,.06);if(F.trim_hex){o.trim=F.trim_hex;o.cornice=1}
    if(F.storefront!=null)o.shop=!!F.storefront;o.awn=F.awning_hex||null;
    const ws=F.window_style;if(ws==='curtain wall')o.curtain=1;else if(ws==='ribbon')o.ribbon=1;else if(ws==='arched')o.archAll=1}
  if(o.special==='tower'){o.hpx=190;o.hm=95}
  if(b.tr){o.tiers=b.tr.map(t=>{let q=pairs(t.p);let A=0;for(let i=0;i<q.length;i++){const[a,c]=q[i],[d,e]=q[(i+1)%q.length];A+=a*e-d*c}if(A<0)q.reverse();return{pts:q,h:t.h}}).sort((x,y)=>x.h-y.h);o.htop=Math.min(250,Math.max(...o.tiers.map(t=>t.h))*ZPM);o.hm=Math.max(o.hm,...o.tiers.map(t=>t.h))}
  o.tmax=(o.htop||o.hpx)/(2*TH);
  // rooftop units
  o.units=[];if(!o.hip&&!o.canopy&&!o.deck&&area>140){const n=Math.min(4,1+Math.floor(area/500));for(let k=0;k<n*4&&o.units.length<n;k++){const ux=o.minx+(o.maxx-o.minx)*hash(b.id%997,20+k),uy=o.miny+(o.maxy-o.miny)*hash(b.id%991,40+k);if(pip(ux,uy,pts)&&pip(ux+.3,uy+.25,pts)&&pip(ux-.3,uy-.25,pts))o.units.push([ux,uy])}}
  return o;
}).sort((a,b)=>a.key-b.key);
const byId={};blds.forEach(b=>{byId[b.id]=b;if(b.special)byId[b.special]=b});
const DECKS=blds.filter(b=>b.deck);
/** How high (model pixels) something at (gx,gy) rides: on a road deck for 'road', on a rail bridge for 'rail', else 0. */
function rideZ(kind,gx,gy,ux,uy){let z=0;for(const b of DECKS){if(b.deck!==kind||gx<b.minx||gx>b.maxx||gy<b.miny||gy>b.maxy||b.hpx<=z)continue;if(!pip(gx,gy,b.pts)||ux!=null&&b.cls&&!runsAlong(b.cls,gx,gy,ux,uy))continue;const h=b.zf?b.zf(gx,gy):b.hpx;if(h>z)z=h}return z}
/** Whether something heading (ux,uy) at (gx,gy) goes the deck's way (it is on the bridge), not across it (it is on the street underneath). */
function runsAlong(cls,gx,gy,ux,uy){let bd=1e9,dot=1;for(const l of cls)for(let i=0;i<l.length-1;i++){const a=l[i],q=l[i+1],dx=q[0]-a[0],dy=q[1]-a[1],L2=dx*dx+dy*dy;if(!L2)continue;const t=Math.max(0,Math.min(1,((gx-a[0])*dx+(gy-a[1])*dy)/L2)),d=Math.hypot(a[0]+dx*t-gx,a[1]+dy*t-gy);if(d<bd){bd=d;dot=Math.abs(ux*dx+uy*dy)/Math.sqrt(L2)}}return dot>.75}
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
// Which windows are lit, and how. A lit window is always a window (or one bay of a shopfront, one stretch of a ribbon,
// one bay of a parking deck): nothing lights a whole wall at once. Homes and hotels light window by window in warm
// colours; taller offices light in runs along a floor, a few floors at a time, in paler whites; every window has its own
// colour and strength, so a wall never reads as one flat stripe. All of it comes from the building's id, so it is the
// same on every tile and every redraw.
const RES=['apartments','residential','house','detached','dormitory','hotel'];
const WARM=['#ffd75e','#ffc76a','#ffe6a6','#ffb860','#ffd75e'],PALE=['#fff0c4','#f1f0dc','#ffe08a','#e2ebf0','#ffe9b0'];
function lite(b,wi,l,j,f,wl,q4){if(!f)return;const s=b.id%977,res=RES.includes(b.t);let p=f;
  if(!res&&b.lv>=6&&f<.5)p=hash(s+3.1,l)<Math.min(.5,f*1.6)?(hash(s+7.7,l*37+(j>>2)+Math.round(wl.k*5))<.65?.85:.1):f*.35;
  if(hash(b.id%10007,wi)>=p)return;
  const h=hash(s+.37,wi*1.7+.5),pal=res||b.lv<4?WARM:PALE;let col=pal[Math.floor(h*pal.length)%pal.length];if(wl.f<=.5)col=mix(col,'#ffb050',.25);
  eq(q4,col,.55+.45*hash(s+5.3,wi*2.3+1))}
// a shopfront's bays: all lit where the place is open (or has an event), an odd night light where it is shut
function shopLit(b){const live=L.lit.get(b.id);if(live!=null)return live>=.5?1:.08;return night()?.22:.7}
function visWalls(pts){const out=[];const n=pts.length;for(let k=0;k<n;k++){const a=pts[k],q=pts[(k+1)%n];const dx=q[0]-a[0],dy=q[1]-a[1];const L=Math.hypot(dx,dy);if(L<1e-4)continue;const nx=dy/L,ny=-dx/L;if(nx+ny<=0)continue;out.push({a,q,L,nx,ny,f:(ny-nx)/2+.5,k:(a[0]+a[1]+q[0]+q[1])/2})}return out.sort((x,y)=>x.k-y.k)}
const WP=(wl,u,z,out=0)=>P(wl.a[0]+(wl.q[0]-wl.a[0])*u+wl.nx*out,wl.a[1]+(wl.q[1]-wl.a[1])*u+wl.ny*out,z);
function drawPrism(c,pts,z0,h,wall,roof,noTop){
  for(const s of visWalls(pts))poly(c,[P(s.a[0],s.a[1],z0),P(s.q[0],s.q[1],z0),P(s.q[0],s.q[1],z0+h),P(s.a[0],s.a[1],z0+h)],mix(wall,SH,.32*(1-s.f)));
  if(!noTop)poly(c,pts.map(p=>P(p[0],p[1],z0+h)),surf(mix(roof,HI,.1),true));
}
// Paint on a level plane z model pixels above the ground, in grid units (as the ground itself is painted).
function onPlane(c,z,pts,fn){c.save();c.transform(TW,TH,-TW,TH,ox,oy-z);c.beginPath();pts.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.closePath();c.clip();c.lineCap='round';c.lineJoin='round';fn();c.restore()}
// The tracks as painted on the ground, also used on a rail bridge and across a street at a level crossing
function paintRails(c,lines,bed){
  if(bed){for(const r of lines){polyPath(c,r);c.strokeStyle=gcol(C['Red clay'],'grass');c.lineWidth=5.5/M;c.stroke()}
    for(const r of lines){polyPath(c,r);c.strokeStyle=gcol('#7a5236','grass');c.lineWidth=3.2/M;c.setLineDash([.5/M,.8/M]);c.stroke();c.setLineDash([])}}
  for(const r of lines){polyPath(c,r);c.strokeStyle=C.Tin;c.lineWidth=2.0/M;c.stroke();polyPath(c,r);c.strokeStyle=bed?gcol('#8a6046','grass'):gcol('#6f6c72','road');c.lineWidth=1.45/M;c.stroke()}}
function drawDeck(c,b){const d=b.dk,top=b.hpx,conc=gcol('#d6cfbf','walk'),asph=gcol(S.wx==='rain'?C['Wet asphalt']:C.Asphalt,'road');
  if(b.deck==='road'){
    // one road surface from the street, up the ramps and over the span, so nothing changes colour at the joints
    const Z=q=>b.zf?b.zf(q[0],q[1]):top,wallC=d.sp?conc:mix(conc,SH,.1),rail=mix(conc,SH,.2),railTop=mix(conc,HI,.35);
    for(const q of d.pr||[])drawPrism(c,pairs(q),0,b.z0,mix(C.Concrete,SH,.12),C.Concrete,true);
    // no wall where the next piece of the same structure stands against this one
    if(!b.vw)b.vw=visWalls(b.pts).filter(s=>{const mx=(s.a[0]+s.q[0])/2+s.nx*.06,my=(s.a[1]+s.q[1])/2+s.ny*.06,h=b.zf?b.zf(mx,my):top;return!DECKS.some(o=>o!==b&&o.deck==='road'&&o.z0<=b.z0+.01&&mx>o.minx&&mx<o.maxx&&my>o.miny&&my<o.maxy&&pip(mx,my,o.pts)&&(o.zf?o.zf(mx,my):o.hpx)>=h-1.5)});
    for(const s of b.vw){const za=Z(s.a),zq=Z(s.q);if(za-b.z0<.3&&zq-b.z0<.3)continue;poly(c,[P(s.a[0],s.a[1],b.z0),P(s.q[0],s.q[1],b.z0),P(s.q[0],s.q[1],zq),P(s.a[0],s.a[1],za)],mix(wallC,SH,.32*(1-s.f)))}
    const topC=surf(mix(asph,HI,.1),true);poly(c,b.pts.map(q=>P(q[0],q[1],Z(q))),topC,topC); // the thin outline closes the hairline seams between pieces
    // the road on top: sidewalks, the gold centre (or median) line, dashed white lane lines
    c.save();if(b.sl)c.transform(TW,TH-b.sl[1],-TW,TH-b.sl[2],ox,oy-b.sl[0]);else c.transform(TW,TH,-TW,TH,ox,oy-top);
    c.beginPath();b.pts.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.closePath();c.clip();c.lineCap='butt';c.lineJoin='round';
    for(const e of d.ed||[]){polyPath(c,e);c.strokeStyle=conc;c.lineWidth=3.6/M;c.stroke()}
    for(const e of d.gl||[]){polyPath(c,e);c.strokeStyle=gcol(C['Line gold'],'road');c.lineWidth=.75/M;c.stroke();polyPath(c,e);c.strokeStyle=topC;c.lineWidth=.3/M;c.stroke()}
    for(const e of d.wl||[]){polyPath(c,e);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.25/M;c.setLineDash([3/M,4/M]);c.stroke();c.setLineDash([])}
    c.restore();
    // parapets along both edges, following the slope
    for(const e of d.ed||[]){const q=pairs(e);for(let i=0;i<q.length-1;i++){const a=q[i],k=q[i+1],za=Z(a),zk=Z(k);if(za<.5&&zk<.5)continue;poly(c,[P(a[0],a[1],za),P(k[0],k[1],zk),P(k[0],k[1],zk+2.6),P(a[0],a[1],za+2.6)],rail);line(c,P(a[0],a[1],za+2.6),P(k[0],k[1],zk+2.6),railTop,.7)}}}
  else if(b.deck==='rail'){
    drawPrism(c,b.pts,0,top,'#4b4f5c',gcol(C['Red clay'],'grass'));
    onPlane(c,top,b.pts,()=>paintRails(c,d.rl||[],1));
    // the girders' top flanges
    const n=b.pts.length;for(let k=0;k<n;k++){const a=b.pts[k],q=b.pts[(k+1)%n];line(c,P(a[0],a[1],top),P(q[0],q[1],top),'#6a6e7c',1)}}
  else{const glass=mix(C['Haw River'],HI,.25);
    drawPrism(c,b.pts,b.z0,top-b.z0,d.cv?glass:conc,d.cv?'#d9d6cf':'#cfc8b8');
    if(d.cv)for(const s of visWalls(b.pts)){line(c,P(s.a[0],s.a[1],b.z0+1),P(s.q[0],s.q[1],b.z0+1),mix(C.Concrete,SH,.2),1.4);line(c,P(s.a[0],s.a[1],top-.5),P(s.q[0],s.q[1],top-.5),'#f1ede4',1);if(evening()){const n=Math.max(1,Math.round(s.L*M/3));for(let k=0;k<n;k++){const u0=(k+.12)/n,u1=(k+.88)/n,A=u=>[s.a[0]+(s.q[0]-s.a[0])*u,s.a[1]+(s.q[1]-s.a[1])*u],p0=A(u0),p1=A(u1);eq([P(p0[0],p0[1],b.z0+2),P(p1[0],p1[1],b.z0+2),P(p1[0],p1[1],top-1),P(p0[0],p0[1],top-1)],'#ffe9b0',.5)}}}}}
function drawBuilding(c,b){if(b.deck){drawDeck(c,b);return}drawBuilding0(c,b);if(b.tiers&&b.special!=='tower')drawTiers(c,b);DT.roof(c,b)}
// stepped roof levels measured by the lidar survey: each tier sits on the one below it
function drawTiers(c,b){let z0=b.hpx;const fr_=litFrac(b);let wi=7;
  for(const t of b.tiers){const z1=Math.min(250,t.h*ZPM);if(z1<z0+3)continue;
    for(const wl of visWalls(t.pts)){const col=mix(b.wall,SH,.32*(1-wl.f));poly(c,[WP(wl,0,z0),WP(wl,1,z0),WP(wl,1,z1),WP(wl,0,z1)],col);
      if(b.cornice&&z1-z0>8)poly(c,[WP(wl,0,z1-2.5),WP(wl,1,z1-2.5),WP(wl,1,z1),WP(wl,0,z1)],b.trim?mix(b.trim,SH,.3*(1-wl.f)):mix(col,HI,.35));
      const glass=mix(mix(C['Haw River'],'#2a3442',.45),SH,.12+.3*(1-wl.f));
      const nw=Math.floor(wl.L*M/(b.win||3.4));if(nw<1)continue;
      for(let z=z0+2.2;z+3.4<z1-2.5;z+=7.4)for(let j=0;j<nw;j++){const u0=(j+.28)/nw,u1=(j+.72)/nw;const q4=[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,z+3.4),WP(wl,u0,z+3.4)];if(b.curtain){poly(c,q4,mix(glass,HI,.05))}else poly(c,q4,glass);lite(b,wi++,b.lv+Math.round(z/7.4),j,fr_,wl,q4)}}
    poly(c,t.pts.map(p=>P(p[0],p[1],z1)),surf(mix(b.roof,HI,.1),true),surf(mix(b.roof,SH,.3),true));z0=z1}}
function drawBuilding0(c,b){
  if(b.special==='tower'){drawLFT(c,b);return}
  const pts=b.pts,hp=b.hpx;const fr_=litFrac(b);let wi=0;const walls=visWalls(pts);b.walls=walls;
  for(const wl of walls){
    const col=mix(b.wall,SH,.32*(1-wl.f));const{a,q}=wl;
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],hp),P(a[0],a[1],hp)],col);
    poly(c,[P(a[0],a[1]),P(q[0],q[1]),P(q[0],q[1],3),P(a[0],a[1],3)],mix(col,SH,.18));
    if(b.canopy)continue;
    if(b.curtain){const gl=mix(mix(b.wall,'#2c3a48',.5),SH,.1+.3*(1-wl.f));poly(c,[WP(wl,0,3),WP(wl,1,3),WP(wl,1,hp-2),WP(wl,0,hp-2)],gl);const lvp=hp/b.lv;for(let l=1;l<b.lv;l++)line(c,WP(wl,0,l*lvp),WP(wl,1,l*lvp),mix(gl,HI,.25));const nm=Math.max(1,Math.round(wl.L*M/1.8));for(let k=1;k<nm;k++)line(c,WP(wl,k/nm,3),WP(wl,k/nm,hp-2),mix(gl,HI,.15));if(fr_)for(let l=0;l<b.lv;l++)for(let k=0;k<nm;k++)lite(b,wi++,l,k,fr_*.7,wl,[WP(wl,k/nm,l*lvp+1),WP(wl,(k+1)/nm,l*lvp+1),WP(wl,(k+1)/nm,(l+1)*lvp-1),WP(wl,k/nm,(l+1)*lvp-1)]);continue}
    if(b.cornice&&hp>10){poly(c,[WP(wl,0,hp-3),WP(wl,1,hp-3),WP(wl,1,hp),WP(wl,0,hp)],b.trim?mix(b.trim,SH,.3*(1-wl.f)):mix(col,HI,.35));line(c,WP(wl,0,hp-3.5),WP(wl,1,hp-3.5),mix(col,SH,.35))}
    const lvpx=hp/b.lv;const glass=mix(mix(C['Haw River'],'#2a3442',.45),SH,.12+.3*(1-wl.f));
    if(b.garage){for(let l=0;l<b.lv;l++){const z=l*lvpx+lvpx*.35,z2=z+lvpx*.42;const q4=[WP(wl,.03,z),WP(wl,.97,z),WP(wl,.97,z2),WP(wl,.03,z2)];poly(c,q4,mix(b.wall,SH,.55));if(fr_){const nb=Math.max(1,Math.round(wl.L*M/8));for(let k=0;k<nb;k++){const h=hash(b.id%977+1.9,wi++);if(h<.12)continue;const u0=.03+.94*(k+.08)/nb,u1=.03+.94*(k+.92)/nb;eq([WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,z2),WP(wl,u0,z2)],'#e9ecd6',.2+.14*h)}}}continue}
    const spacing=(b.win||3.4)/M;const nw=Math.floor(wl.L/spacing);
    // storefront
    let l0=0;
    if(b.shop&&wl.L*M>5){l0=1;const sz=Math.min(lvpx*.75,6.5);const q4=[WP(wl,.04,1.2),WP(wl,.96,1.2),WP(wl,.96,1.2+sz),WP(wl,.04,1.2+sz)];poly(c,q4,mix(glass,SH,.15));
      const nd=Math.max(1,Math.floor(wl.L*M/8));for(let k=0;k<nd;k++){const u=(k+.5)/nd;line(c,WP(wl,u,1.2),WP(wl,u,1.2+sz),mix(col,SH,.1))}
      if(fr_){const sp=shopLit(b);for(let k=0;k<nd;k++){const h=hash(b.id%977+2.7,wi++);if(h>=sp)continue;const u0=.04+.92*(k+.1)/nd,u1=.04+.92*(k+.9)/nd;eq([WP(wl,u0,1.8),WP(wl,u1,1.8),WP(wl,u1,.9+sz),WP(wl,u0,.9+sz)],WARM[Math.floor(hash(b.id%977+4.1,k+wl.k)*5)%5],.7+.3*hash(b.id%977+6.3,k+wl.k))}}
      if(b.awn){const an=Math.max(4,Math.round(wl.L*M/1.2));for(let k=0;k<an;k++){const u0=.03+.94*k/an,u1=.03+.94*(k+1)/an;poly(c,[WP(wl,u0,2+sz),WP(wl,u1,2+sz),WP(wl,u1,sz-.5,.13),WP(wl,u0,sz-.5,.13)],surf(k%2?b.awn:mix(b.awn,HI,.12),true))}}}
    if(nw<1)continue;
    for(let l=l0;l<b.lv;l++){
      const z=l*lvpx+lvpx*.3,wh=Math.max(2,lvpx*.45);if(z+wh>hp-(b.cornice?4:1.5))break;
      const ar=(b.arch&&l>=b.lv-2)||b.archAll;
      if(b.ribbon){const q4=[WP(wl,.03,z),WP(wl,.97,z),WP(wl,.97,z+wh),WP(wl,.03,z+wh)];poly(c,q4,glass);const ns=Math.max(1,Math.round(wl.L*M/5));for(let k=0;k<ns;k++){const u0=.03+.94*(k+.06)/ns,u1=.03+.94*(k+.94)/ns;lite(b,wi++,l,k*4,fr_,wl,[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,z+wh),WP(wl,u0,z+wh)])}continue}
      for(let j=0;j<nw;j++){const u0=(j+.28)/nw,u1=(j+.72)/nw;const zt=ar?z+wh*1.5:z+wh;const q4=[WP(wl,u0,z),WP(wl,u1,z),WP(wl,u1,zt),WP(wl,u0,zt)];poly(c,q4,glass);if(ar){const du=(u1-u0)*.25;poly(c,[WP(wl,u0+du,zt),WP(wl,u1-du,zt),WP(wl,u1-du,zt+1.2),WP(wl,u0+du,zt+1.2)],glass)}
        if(wh>=3)line(c,WP(wl,u0,z+wh-.5),WP(wl,u1,z+wh-.5),mix(glass,HI,.4));
        lite(b,wi++,l,j,fr_,wl,q4)}
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
      if(fr_)for(let l=0;l<20;l++){const z=Z(l*3.95)+2;lite(b,wi++,l,0,fr_*.8,wl,[WP(wl,.2,z),WP(wl,.8,z),WP(wl,.8,z+3),WP(wl,.2,z+3)])}
      continue}
    const glass=mix('#3a4656',SH,.1+.3*(1-wl.f));
    const nb=Math.max(1,Math.round(wl.L*M/6.2));
    const win=(u0,u1,z0,z1,arch)=>{const q4=[WP(wl,u0,z0),WP(wl,u1,z0),WP(wl,u1,z1),WP(wl,u0,z1)];poly(c,q4,glass);if(arch){const du=(u1-u0)*.25;poly(c,[WP(wl,u0+du,z1),WP(wl,u1-du,z1),WP(wl,u1-du,z1+1.4),WP(wl,u0+du,z1+1.4)],glass)}lite(b,wi++,Math.round(z0/(3.95*ZPM)),Math.round(u0*nb*2),fr_,wl,q4)};
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
  // a bridge deck is a slab between z0 and its top: it hides what the line of sight meets inside that slab only
  if(b.deck){const t1=(b.hpx-zpx)/(2*TH);if(t1<=0)return false;const t0=Math.max(0,(b.z0-zpx)/(2*TH));return segHits(gx+t0,gy+t0,t1-t0,b.pts)}
  const hit=(pts,top)=>{const t=(top-zpx)/(2*TH);return t>0&&segHits(gx,gy,t,pts)};
  if(hit(b.pts,b.hpx+(b.special==='jsb'?12:0)))return true;if(b.tiers)for(const t of b.tiers)if(hit(t.pts,Math.min(250,t.h*ZPM)))return true;return false}
/** Buildings standing between the viewer and any of the sample points [gx,gy,zpx]. */
function blockersFor(smp){const out=[];let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of smp){if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1]}
  // rayHits' own first test, for all the samples at once
  for(const b of blds){if(b.minx>x1+b.tmax+.5||b.maxx<x0-.05||b.miny>y1+b.tmax+.5||b.maxy<y0-.05)continue;for(const[gx,gy,z] of smp)if(rayHits(b,gx,gy,z||0)){out.push(b);break}}return out}
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
// pools, courts, playgrounds, brick paving, benches and the like (public/details.js, from public/model/details.json)
const DT=makeDetails(DET,{P:(x,y,z)=>P(x,y,z),M,ZPM,mix,gcol,hash,pip,fr,poly,line,circ,eq,mk,inTG,lampsOn,onPlane,snowy:()=>S.wx==='snow',HI,SH});
// The ground texture: one texel per 1.5 m. Where the 2022 aerial has been classified (MAP.GC) each texel takes the
// colour of what is really there (paving, asphalt, lawn, planting beds, bare ground); otherwise the vegetation mask.
const GC_COL=['#bdb7ab','#8f8c94','#5cb648','#6f9a4a','#b98a64','#37a6dc','#a9a39a','#b3a596']; // 7: ballast along the tracks
let GTEX=null,GCLS=null;
// The aerial was flown in February, and the long winter shadows of buildings and bare trees on lawns were read as
// asphalt: grey blotches in the grass. A patch of "asphalt" that no mapped street, drive or parking lot accounts for
// takes the kind of ground that surrounds it instead.
function dropShadows(cls,gw,gh,R){
  const mc=mk(gw,gh),m=mc.getContext('2d',{willReadFrequently:true});m.setTransform(R,0,0,R,0,0);m.lineCap='round';m.lineJoin='round';m.fillStyle=m.strokeStyle='#fff';
  MAP.R.forEach(r=>{polyPath(m,r.p);if(r.ar){m.closePath();m.fill();m.lineWidth=4/M;m.stroke()}else{m.lineWidth=(RW[r.c]+7)/M;m.stroke()}});
  (MAP.PL||[]).forEach(p=>{polyPath(m,p);m.closePath();m.fill();m.lineWidth=5/M;m.stroke()});
  const md=m.getImageData(0,0,gw,gh).data,N=gw*gh,loose=i=>cls[i]===1&&md[i*4]<128,seen=new Uint8Array(N),stack=new Int32Array(N),tally=new Int32Array(8);
  for(let s0=0;s0<N;s0++){if(seen[s0]||!loose(s0))continue;let n=0,top=0;stack[top++]=s0;seen[s0]=1;tally.fill(0);
    while(n<top){const i=stack[n++],x=i%gw;for(const j of [x?i-1:-1,x<gw-1?i+1:-1,i-gw,i+gw]){if(j<0||j>=N)continue;if(loose(j)){if(!seen[j]){seen[j]=1;stack[top++]=j}}else tally[cls[j]&7]++}}
    let best=1,bn=tally[1]/1.5;for(let k=0;k<8;k++)if(k!==1&&k!==6&&tally[k]>bn){bn=tally[k];best=k}
    if(best!==1)for(let q=0;q<top;q++)cls[stack[q]]=best}}
function buildGroundTex(){const R=MAP.GC?MAP.GC.r:VG?VG.r:6,gw=Math.ceil(GX*R),gh=Math.ceil(GY*R);
  const GCa=MAP.GC&&!GCLS?(()=>{const v=MAP.GC,a=new Uint8Array(v.w*v.h);v.rows.forEach((row,j)=>{let i=0;row.split(',').forEach(t=>{const cls=parseInt(t[0],36),n=parseInt(t.slice(1),36);a.fill(cls,j*v.w+i,j*v.w+i+n);i+=n})});return a})():null;
  const kinds=['walk','road','grass','grass','grass','road','walk','walk'];const pal=GC_COL.map((c0,k)=>hex(gcol(c0,kinds[k])));const lawn2=hex(gcol(mix(C.Bermuda,C.Fescue,.3),'grass'));
  // the kind of ground in each cell, worked out once (the colours change with the light, the kinds do not)
  const cls=GCLS||(GCLS=(()=>{const a=new Uint8Array(gw*gh);for(let j=0;j<gh;j++)for(let i=0;i<gw;i++)a[j*gw+i]=GCa?GCa[Math.min(j,MAP.GC.h-1)*MAP.GC.w+Math.min(i,MAP.GC.w-1)]:VG&&isVeg((i+.5)/R,(j+.5)/R)?2:0;if(GCa)dropShadows(a,gw,gh,R);return a})());
  // The picture has two texels to each surveyed cell, and where two neighbours of a cell agree with each other but
  // not with it, that corner of the cell takes their kind (the "scale2x" rule), so the edge of a lawn or a patch of
  // paving runs in a line or a curve, not in 1.5 m stair-steps.
  const w2=gw*2,h2=gh*2,cnv=mk(w2,h2),g=cnv.getContext('2d'),img=g.createImageData(w2,h2),d=img.data;
  for(let j=0;j<gh;j++)for(let i=0;i<gw;i++){const e=cls[j*gw+i],u=j?cls[(j-1)*gw+i]:e,dn=j<gh-1?cls[(j+1)*gw+i]:e,l=i?cls[j*gw+i-1]:e,r=i<gw-1?cls[j*gw+i+1]:e,sq=u!==dn&&l!==r;
    for(let q=0;q<4;q++){const k=!sq?e:q===0?(l===u?l:e):q===1?(u===r?r:e):q===2?(l===dn?l:e):(dn===r?r:e),I=i*2+(q&1),J=j*2+(q>>1);
      let col=pal[k];if(k===2&&hash(i+7,j+3)<.4)col=lawn2;const n=(hash(I*.37+11,J*.71+5)-.5)*(k===0||k===6?8:k===1?5:11);const o=(J*w2+I)*4;d[o]=col[0]+n;d[o+1]=col[1]+n;d[o+2]=col[2]+n;d[o+3]=255}}
  g.putImageData(img,0,0);GTEX={c:cnv,R:R*2}}
function drawGround(c){
  setT(c);c.fillStyle='#3a2c26';c.fillRect(0,0,BW,BH);
  // table weave
  c.fillStyle='rgba(255,255,255,.025)';for(let y=Math.max(0,Math.floor(TR[1]/4)*4-4);y<Math.min(BH,TR[3]+4);y+=4)c.fillRect(0,y,BW,1);
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
  DT.under(c);
  // footpaths (OSM footways and paths), drawn under the streets so crossings stay painted
  c.lineCap='round';c.lineJoin='round';
  for(const f of (MAP.FW||[])){if(!inTG(f._bb))continue;polyPath(c,f.p);c.strokeStyle=gcol(f.k==='steps'?'#c9c2b4':'#dcd6ca','walk');c.lineWidth=(f.k==='cycleway'?2.4:1.8)/M;c.stroke()}
  MAP.PL.forEach(p=>{if(!inTG(p._bb))return;polyPath(c,p);c.closePath();c.fillStyle=gcol(mix(C.Asphalt,C.Concrete,.4),'road');c.fill();c.strokeStyle=gcol('#d8d4ca','walk');c.lineWidth=1.2/M;c.stroke()});
  // painted stalls in the surface lots
  if(ST.length){c.strokeStyle=gcol('#eeeae2','road');c.lineWidth=.035;c.lineCap='butt';c.beginPath();for(const s of ST){const[x,y,ux,uy,ax,ay]=stallFrame(s);if(TG&&(x<TG[0]||x>TG[2]||y<TG[1]||y>TG[3]))continue;for(const sd of [-.5,.5]){const bx=x+ax*sd*s[4],by=y+ay*sd*s[4];c.moveTo(bx-ux*s[5]/2,by-uy*s[5]/2);c.lineTo(bx+ux*s[5]/2,by+uy*s[5]/2)}}c.stroke();c.lineCap='round'}
  const Rs=MAP.R.filter(r=>inTG(r._bb)&&!r.br);
  Rs.filter(r=>r.ar).forEach(r=>{polyPath(c,r.p);c.closePath();c.fillStyle=gcol('#d8d4ca','walk');c.fill()});
  Rs.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#c8c3b8','walk');c.lineWidth=(RW[r.c]+8)/M;c.stroke()});
  Rs.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#d8d4ca','walk');c.lineWidth=(RW[r.c]+6.6)/M;c.stroke()});
  Rs.filter(r=>!r.ar&&r.c===6).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#cdc8bd','walk');c.lineWidth=4/M;c.stroke()});
  const RLs=MAP.RL.filter(r=>inTG(r._bb));
  paintRails(c,RLs.map(r=>r.p),1);
  Rs.filter(r=>!r.ar&&r.c===5).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(mix(C.Asphalt,C.Concrete,.3),'road');c.lineWidth=RW[5]/M;c.stroke()});
  const asph=gcol(S.wx==='rain'?C['Wet asphalt']:C.Asphalt,'road');
  Rs.filter(r=>!r.ar&&r.c<=4).forEach(r=>{polyPath(c,r.p);c.strokeStyle=asph;c.lineWidth=RW[r.c]/M;c.stroke()});
  // lane markings: double yellow on main streets, dashed white on smaller ones
  Rs.filter(r=>!r.ar&&r.c<=2&&!r.ow&&!r.rb).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol(C['Line gold'],'road');c.lineWidth=.75/M;c.stroke();polyPath(c,r.p);c.strokeStyle=asph;c.lineWidth=.3/M;c.stroke()});
  Rs.filter(r=>!r.ar&&!r.rb&&(r.c===3||(r.c<=2&&r.ow))).forEach(r=>{polyPath(c,r.p);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.25/M;c.setLineDash([3/M,4/M]);c.stroke();c.setLineDash([])});
  // crosswalks and stop bars (worked out from the street graph, see XWALK)
  c.lineCap='butt';c.strokeStyle=gcol('#f4f1ea','road');
  {c.beginPath();c.lineWidth=.55/M;for(const k of XWALK.cw){if(TG&&(k[0]<TG[0]-2||k[0]>TG[2]+2||k[1]<TG[1]-2||k[1]>TG[3]+2))continue;const[x,y,ux,uy,w]=k,vx=-uy,vy=ux,n=Math.floor(w/1.1),h=1.4/M;
      for(let q=0;q<n;q++){const t=(-(n-1)/2+q)*1.1/M;c.moveTo(x+vx*t-ux*h,y+vy*t-uy*h);c.lineTo(x+vx*t+ux*h,y+vy*t+uy*h)}}c.stroke();
    c.beginPath();c.lineWidth=.5/M;for(const k of XWALK.bars){if(TG&&(k[0]<TG[0]-2||k[0]>TG[2]+2||k[1]<TG[1]-2||k[1]>TG[3]+2))continue;c.moveTo(k[0],k[1]);c.lineTo(k[2],k[3])}c.stroke()}
  // level crossings: the street crosses the tracks at grade, so the rails show through the road between panels, with
  // a stop line before the first track each way
  for(const[ax,ay,bx,by,cl] of (MAP.LX||[])){const L=Math.hypot(bx-ax,by-ay)||1,ux=(bx-ax)/L,uy=(by-ay)/L,hw=(RW[cl]/2+.2)/M,e=2.2/M;
    if(TG&&(Math.max(ax,bx)<TG[0]-3||Math.min(ax,bx)>TG[2]+3||Math.max(ay,by)<TG[1]-3||Math.min(ay,by)>TG[3]+3))continue;
    c.save();c.beginPath();c.moveTo(ax-ux*e-uy*hw,ay-uy*e+ux*hw);c.lineTo(bx+ux*e-uy*hw,by+uy*e+ux*hw);c.lineTo(bx+ux*e+uy*hw,by+uy*e-ux*hw);c.lineTo(ax-ux*e+uy*hw,ay-uy*e-ux*hw);c.closePath();c.clip();
    for(const r of RLs){polyPath(c,r.p);c.strokeStyle=gcol(mix(C.Asphalt,C.Concrete,.45),'road');c.lineWidth=3.6/M;c.stroke()}
    paintRails(c,RLs.map(r=>r.p),0);c.restore();
    if(cl<=4){const sb=(e+2.4/M);c.strokeStyle=gcol('#f4f1ea','road');c.lineWidth=.6/M;
      c.beginPath();c.moveTo(ax-ux*sb,ay-uy*sb);c.lineTo(ax-ux*sb-uy*hw,ay-uy*sb+ux*hw);c.moveTo(bx+ux*sb,by+uy*sb);c.lineTo(bx+ux*sb+uy*hw,by+uy*sb-ux*hw);c.stroke()}}
  DT.over(c);
  // a street dipping under a rail bridge darkens toward the portal; the ground under a raised span is in shade
  for(const b of DECKS){if(!inTG([b.minx-2,b.miny-2,b.maxx+2,b.maxy+2]))continue;
    if(b.deck==='rail')for(const[ln,cl] of b.dk.dip||[]){polyPath(c,ln);c.strokeStyle='rgba(30,22,52,.26)';c.lineWidth=RW[cl]/M;c.lineCap='butt';c.stroke();c.lineCap='round'}
    else if(b.z0>0){c.beginPath();b.pts.forEach((q,i)=>i?c.lineTo(q[0],q[1]):c.moveTo(q[0],q[1]));c.closePath();c.fillStyle='rgba(30,22,52,.3)';c.fill()}}
  c.restore();setT(c);c.lineCap='round';DT.low(c);
}
// Parking stalls: [x, y, stall axis (deg), aisle direction (deg), spacing along the aisle, depth (tiles), seed], from
// the rows prep.py lays out (MAP.SR: start, step, count, angles, spacing, depth).
const ST=[];(MAP.SR||[]).forEach((r,ri)=>{for(let k=0;k<r[4];k++)ST.push([r[0]+r[2]*k,r[1]+r[3]*k,r[5],r[6],r[7],r[8],ri*31+k,ri])});
function stallFrame(s){const a=s[2]*rad,b=s[3]*rad;return[s[0],s[1],Math.cos(a),Math.sin(a),Math.cos(b),Math.sin(b)]}
// cast shadows from the real sun
// The shadow mask is built once per sun position; each tile then lays it down with the iso transform.
let SHM=null;
function buildShadows(){SHM=null;
  if(SUN.alt<2||S.wx==='rain')return;
  const R=4,mc=mk(Math.ceil(GX*R),Math.ceil(GY*R)),m=mc.getContext('2d');m.setTransform(R,0,0,R,0,0);m.fillStyle=m.strokeStyle='#2c2147';
  const k=1/Math.tan(Math.max(4,SUN.alt)*rad),vx=-Math.sin(SUN.az*rad),vy=Math.cos(SUN.az*rad);
  m.lineJoin='round';for(const b of blds){if(!b.canopy){m.lineWidth=.32;m.beginPath();b.pts.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.closePath();m.stroke()}const L=Math.min(b.hm*k,b.hm*8)/M;const sh=hull(b.pts.concat(b.pts.map(p=>[p[0]+vx*L,p[1]+vy*L])));m.beginPath();sh.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.closePath();m.fill()}
  for(const o of pts0){if(o.kind==='tree'){const lf=look(o.sp,DOY,o.seed).leaf,r=o.r*.8/M,L=Math.min(o.h*.6*k,o.h*5)/M;m.globalAlpha=['loblolly','magnolia','cedar','holly'].includes(o.sp)?1:.35+.65*lf;m.beginPath();m.ellipse(o.gx+vx*L,o.gy+vy*L,r,r,0,0,7);m.fill();m.globalAlpha=1}else if(o.kind==='car'&&!o.hid){const L=Math.min(1.5*k,8)/M;m.beginPath();const r=o.r;const h=hull(r.concat(r.map(p=>[p[0]+vx*L,p[1]+vy*L])));h.forEach((p,i)=>i?m.lineTo(p[0],p[1]):m.moveTo(p[0],p[1]));m.fill()}}
  SHM={c:mc,R}}
function drawShadows(c){if(!SHM)return;const R=SHM.R;
  c.save();c.setTransform(...BT);c.transform(TW/R,TH/R,-TW/R,TH/R,ox,oy);c.globalAlpha=S.wx==='snow'?.22:.34;c.drawImage(SHM.c,0,0);c.restore();
}

// ---------- static points ----------
// One car, parked or moving, to scale (2 model pixels to the metre up, as the buildings): a soft contact shadow, the
// body, and a glazed cabin with a roof in the body colour. ty: 0 sedan, 1 SUV or crossover, 2 pickup, 3 van.
// [length, width (m), body top, roof top (model px), cabin length (share of the car), cabin set back (m)]
const CARS=[[4.5,1.8,2.1,3.2,.5,.25],[4.7,1.9,2.4,3.7,.62,.45],[5.3,1.9,2.4,3.7,.34,-.55],[5,1.95,2.3,4.1,.8,.3]];
const GLASS='#33405e',carKind=u=>u<.46?0:u<.8?1:u<.93?2:3;
const pts0=[];
(function place(){
  const R=6,mw=Math.ceil(GX*R),mh=Math.ceil(GY*R);const mkMask=()=>{const mc=mk(mw,mh),m=mc.getContext('2d');m.fillStyle='#fff';m.fillRect(0,0,mw,mh);m.setTransform(R,0,0,R,0,0);m.lineCap='round';m.strokeStyle='#000';m.fillStyle='#000';return[mc,m]};
  const[fc,m]=mkMask();
  MAP.R.forEach(r=>{polyPath(m,r.p);if(r.ar){m.closePath();m.fill()}else{m.lineWidth=(RW[r.c]+(r.c<=4?9:3))/M;m.stroke()}});
  MAP.RL.forEach(r=>{polyPath(m,r.p);m.lineWidth=8/M;m.stroke()});
  MAP.PL.forEach(p=>{polyPath(m,p);m.closePath();m.fill()});
  const[bc,bm]=mkMask();
  blds.forEach(b=>{for(const mm of [m,bm]){mm.beginPath();b.pts.forEach((p,i)=>i?mm.lineTo(p[0],p[1]):mm.moveTo(p[0],p[1]));mm.closePath();mm.fill();mm.lineWidth=2.5/M;mm.stroke()}});
  const[rc,rm]=mkMask();MAP.R.forEach(r=>{if(r.ar||r.c>5)return;polyPath(rm,r.p);rm.lineWidth=(RW[r.c]+.6)/M;rm.stroke()});
  const px=m.getImageData(0,0,mw,mh).data,bpx=bm.getImageData(0,0,mw,mh).data,rpx=rm.getImageData(0,0,mw,mh).data;
  const at=(d,x,y)=>{if(x<=.3||y<=.3||x>=GX-.3||y>=GY-.3)return false;const i=((Math.floor(y*R))*mw+Math.floor(x*R))*4;return d[i]>128};
  const parks=MAP.PK.map(p=>pairs(p.p));
  let s=3;const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};
  // A surveyed tree whose crown hangs over a street can come out with its trunk on the roadway or the tracks (the
  // model also paints one-way roadways wider than they are): such a tree is stood just behind the kerb or clear of
  // the rails, or left out if that is more than a few metres away.
  const hard=[];MAP.R.forEach(r=>{if(r.ar||r.c>5)return;const hw=(RW[r.c]/2+1.2)/M;for(let i=2;i<r.p.length;i+=2)hard.push([r.p[i-2],r.p[i-1],r.p[i],r.p[i+1],hw])});
  MAP.RL.forEach(r=>{for(let i=2;i<r.p.length;i+=2)hard.push([r.p[i-2],r.p[i-1],r.p[i],r.p[i+1],2.6/M])});
  const deepest=(gx,gy)=>{let best=null,bd=.02;for(const h of hard){const hw=h[4];if(gx<Math.min(h[0],h[2])-hw||gx>Math.max(h[0],h[2])+hw||gy<Math.min(h[1],h[3])-hw||gy>Math.max(h[1],h[3])+hw)continue;const dx=h[2]-h[0],dy=h[3]-h[1],L2=dx*dx+dy*dy,t=L2?Math.max(0,Math.min(1,((gx-h[0])*dx+(gy-h[1])*dy)/L2)):0,qx=h[0]+dx*t,qy=h[1]+dy*t,d=Math.hypot(gx-qx,gy-qy);if(hw-d>bd){bd=hw-d;best=[qx,qy,d,hw]}}return best};
  const offRoad=o=>{let x=o.gx,y=o.gy;for(let k=0;k<3;k++){const h=deepest(x,y);if(!h){if(k){o.gx=x;o.gy=y}return true}const[qx,qy,d,hw]=h;if(d<1e-4)return false;x=qx+(x-qx)/d*(hw+.03);y=qy+(y-qy)/d*(hw+.03);if(Math.hypot(x-o.gx,y-o.gy)>4.5/M)return false}return false};
  // the real trees (public/model/trees.json); without that file, fall back to the old guessed ones
  const real=loadTrees(TREES).filter(offRoad);
  if(real.length)pts0.push(...real);
  else for(let y=0;y<GY;y+=.8)for(let x=0;x<GX;x+=.8){const gx=x+rnd()*.7,gy=y+rnd()*.7;if(!at(px,gx,gy))continue;const inPark=parks.some(p=>pip(gx,gy,p));if(rnd()<(inPark?.5:isVeg(gx,gy)?.32:0))pts0.push({kind:'tree',gx,gy,h:9+rnd()*6,r:3+rnd()*2,sp:rnd()<.3?'loblolly':'willowoak',seed:rnd()})}
  // street trees and lamps along main streets
  MAP.TR.forEach(t=>{const p=pairs(t.p);let acc=0,acc2=0;const offT=(RW[t.c]/2+2.6)/M,offL=(RW[t.c]/2+1.1)/M;for(let i=0;i<p.length-1;i++){const[a,b]=[p[i],p[i+1]];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!L)continue;const ux=(b[0]-a[0])/L,uy=(b[1]-a[1])/L;for(let d=0;d<L;d+=.15){acc+=.15;acc2+=.15;const bx=a[0]+ux*d,by=a[1]+uy*d;
    if(acc2>12/M&&t.c<=3){acc2=0;for(const sd of [-1,1]){const gx=bx-uy*offT*sd,gy=by+ux*offT*sd;if(!real.length&&at(bpx,gx,gy)&&rnd()<.75)pts0.push({kind:'tree',gx,gy,h:7,r:2.5,sp:'willowoak',seed:rnd()})}}
    if(acc>30/M&&t.c<=3){acc=0;const sd=rnd()<.5?1:-1;const gx=bx-uy*offL*sd,gy=by+ux*offL*sd;if(at(bpx,gx,gy)&&at(rpx,gx,gy))pts0.push({kind:'lamp',gx,gy})}}}});
  // parked cars in surface lots
  const carCols=['#e6e6ea','#e6e6ea','#ecebe6','#c4c8d0','#b9bec8','#9aa0aa','#6b7280','#4a4f5c','#2f2f38','#2f2f38','#a8483a','#34508c','#6a7f96','#7d8a6a','#8a6a54'];
  // Parked cars sit in the lots' real stalls (tools/model/prep.py lays them out along each lot's painted rows and
  // stall angle, read from the 2022 aerial), nose in, about two thirds full until the
  // page says how busy it is (see "how busy it is" below: each car keeps a number u, and is shown while u is under
  // its lot's share of stalls in use). Without stalls, a plain grid.
  if(ST.length)ST.forEach((st,i)=>{const u=hash(i*.731+3,st[6]);if(u>.9)return;const[x,y,ux,uy]=stallFrame(st);const L=4.4/M,Wd=1.85/M,j=(hash(i,9)-.5)*.25/M;const cx=x+ux*j,cy=y+uy*j;
    if(!at(bpx,cx,cy))return;const ty=carKind(hash(i*1.31,st[6]+5)),nose=hash(i,st[6]+2)<.82?1:-1,K=CARS[ty];pts0.push({kind:'car',gx:cx,gy:cy,ux:ux*nose,uy:uy*nose,ty,r:rect(cx,cy,ux,uy,K[0]/M,K[1]/M),col:carCols[Math.floor(hash(i,st[6]+1)*carCols.length)],u,row:st[7]})});
  else MAP.PL.forEach((pl,li)=>{const q=pairs(pl);const xs=q.map(p=>p[0]),ys=q.map(p=>p[1]);const horiz=hash(li,5)<.5;const sx=(horiz?5.6:2.8)/M,sy=(horiz?2.8:5.6)/M;for(let y=Math.min(...ys)+sy;y<Math.max(...ys)-sy/2;y+=sy)for(let x=Math.min(...xs)+sx;x<Math.max(...xs)-sx/2;x+=sx){const ri=Math.round(((horiz?x-Math.min(...xs):y-Math.min(...ys)))/(5.6/M));if(ri%3===2)continue;if(!pip(x,y,q)||!at(bpx,x,y)||rnd()>.5)continue;const r=rect(x,y,horiz?1:0,horiz?0:1,4.3/M,1.9/M);pts0.push({kind:'car',gx:x,gy:y,ux:horiz?1:0,uy:horiz?0:1,ty:0,r,col:carCols[Math.floor(rnd()*carCols.length)]})}});
  // landmarks
  const ccp=MAP.PK.find(p=>p.n==='Center City Park');if(ccp&&!DT.points.some(o=>o.what==='jet')){const q=pairs(ccp.p);pts0.push({kind:'fountain',gx:q.reduce((a,p)=>a+p[0],0)/q.length,gy:q.reduce((a,p)=>a+p[1],0)/q.length})}
  const lb=MAP.PK.find(p=>p.n==='Lebauer Park');if(lb){const q=pairs(lb.p);let best=null;for(let i=0;i<q.length-1;i++){const a=q[i],b=q[i+1];const nx=b[1]-a[1],ny=-(b[0]-a[0]);if(nx+ny>0){const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!best||L>best.L)best={a,b,L}}}if(best)pts0.push({kind:'string',a:best.a,b:best.b,gx:(best.a[0]+best.b[0])/2,gy:(best.a[1]+best.b[1])/2})}
  pts0.push(...DT.points);
  for(let i=pts0.length-1;i>=0;i--){const o=pts0[i];if((o.kind==='car'||o.kind==='tree')&&DT.wet(o.gx,o.gy)){pts0.splice(i,1);continue}if(DECKS.some(b=>b.deck!=='foot'&&o.gx>b.minx&&o.gx<b.maxx&&o.gy>b.miny&&o.gy<b.maxy&&pip(o.gx,o.gy,b.pts)))pts0.splice(i,1)}
  pts0.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy));
})();
const NET=(()=>{const lb=MAP.PK.find(p=>p.n==='Lebauer Park');if(!lb)return null;const q=pairs(lb.p);return{cx:q.reduce((a,p)=>a+p[0],0)/q.length,cy:q.reduce((a,p)=>a+p[1],0)/q.length,rx:16/M,ry:11/M}})();
function drawTree(c,o){drawTreeSp(c,o,{P,fr,circ,poly,line,mix,surf,SH,HI,doy:DOY,lean:WIND.lean})}
const FLAGS=loadFlags(TREES);
// A post-top street lamp, as on downtown's sidewalks: a footed post, a pale globe under a dark cap. Lit, the globe
// glows and throws a soft pool on the pavement.
function drawLamp(c,o){const[x,y]=P(o.gx,o.gy),X=Math.round(x),Y=Math.round(y);const on=lampsOn(),post='#3f3b4c';if(on)eg(x+.5,y,15,.3,.5);
  c.fillStyle='rgba(30,22,52,.22)';c.fillRect(X-1,Y,4,1);fr(c,X-1,Y-1,3,1,post);fr(c,X,Y-10,1,9,post);fr(c,X-1,Y-11,3,1,mix(post,HI,.25));fr(c,X-1,Y-13,3,2,on?'#ffe7a6':'#e4dfd2');fr(c,X-1,Y-14,3,1,post);fr(c,X,Y-15,1,1,post);
  if(on){ed([x+.5,y-12],'#fff2c4',2);eg(x+.5,y-11,6,.4)}}
function drawString(c,o){[o.a,o.b].forEach(p=>line(c,P(p[0],p[1]),P(p[0],p[1],22),SH));if(!lampsOn())return;for(let k=0;k<=56;k++){const t=k/56;const gx=o.a[0]+(o.b[0]-o.a[0])*t,gy=o.a[1]+(o.b[1]-o.a[1])*t;ed(P(gx,gy,22-Math.sin(t*Math.PI*4)**2*5),k%2?'#ffe9a8':'#ffb98a')}}
function drawCar(c,gx,gy,ux,uy,z,col,ty){const k=CARS[ty]||CARS[0],L=k[0]/M,Wd=k[1]/M;
  // the shadow it stands on, a touch wider than the car and off to the right (on the ground only: none on a bridge)
  if(!z){const sh=rect(gx+.5/M,gy+.5/M,ux,uy,L+.3/M,Wd+.3/M);c.fillStyle='rgba(30,22,52,.28)';c.beginPath();sh.forEach((q,i)=>{const[x,y]=P(q[0],q[1]);i?c.lineTo(x,y):c.moveTo(x,y)});c.fill()}
  drawPrism(c,rect(gx,gy,ux,uy,L,Wd),z+.5,k[2]-.5,col,col);
  const cl=k[4]*k[0],cb=k[5];
  if(ty===2){// a pickup's open bed behind the cab
    const b0=-k[0]/2+.25,b1=-cb-cl/2-.15,bx=(b0+b1)/2,bl=b1-b0;
    if(bl>.5)poly(c,rect(gx+ux*bx/M,gy+uy*bx/M,ux,uy,bl/M,Wd-.5/M).map(q=>P(q[0],q[1],z+k[2])),mix(col,SH,.45))}
  drawPrism(c,rect(gx-ux*cb/M,gy-uy*cb/M,ux,uy,cl/M,Wd-.3/M),z+k[2],k[3]-k[2],GLASS,mix(col,HI,.22))}
function drawCarS(c,o){drawCar(c,o.gx,o.gy,o.ux,o.uy,0,o.col,o.ty)}
function drawFountain(c,o){const r=7/M;const ring=[...Array(16)].map((_,k)=>[o.gx+Math.cos(k*Math.PI/8)*r,o.gy+Math.sin(k*Math.PI/8)*r]);drawPrism(c,ring,0,3,C.Concrete,C.Concrete,true);poly(c,ring.map(p=>P(p[0],p[1],3)),surf(mix(C['Haw River'],HI,.25),true));const ring2=ring.map(p=>[o.gx+(p[0]-o.gx)*.3,o.gy+(p[1]-o.gy)*.3]);drawPrism(c,ring2,0,7,C.Concrete,C.Concrete)}
function drawPoint(c,o){switch(o.kind){case'tree':drawTree(c,o);break;case'lamp':drawLamp(c,o);break;case'string':drawString(c,o);break;case'car':drawCarS(c,o);break;case'fountain':drawFountain(c,o);break;case'prop':DT.drawProp(c,o);break}}
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
function silhouette(b){if(b.sil)return b.sil;const o0=ox,o1=oy;ox=BOX;oy=BOY;const p=new Path2D(),polys=[];let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  const prism=(pts,h,z0=0,hf)=>{const n=pts.length,H=q=>hf?hf(q[0],q[1])+3:h;const add=q=>{let A=0;for(let k=0;k<q.length;k++){const u=q[k],v=q[(k+1)%q.length];A+=u[0]*v[1]-v[0]*u[1]}if(A<0)q=q.slice().reverse();polys.push(q);q.forEach(([x,y],k)=>{k?p.lineTo(x,y):p.moveTo(x,y);if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y});p.closePath()};
    add(pts.map(q=>P(q[0],q[1],z0)));add(pts.map(q=>P(q[0],q[1],H(q))));for(let k=0;k<n;k++){const a=pts[k],c=pts[(k+1)%n];add([P(a[0],a[1],z0),P(c[0],c[1],z0),P(c[0],c[1],H(c)),P(a[0],a[1],H(a))])}};
  if(b.deck)prism(b.pts,b.hpx+3,b.z0,b.zf);
  else prism(b.pts,b.hpx+(b.special?14:2));if(b.tiers)for(const t of b.tiers)prism(t.pts,Math.min(250,t.h*ZPM)+(b.special?14:2));
  ox=o0;oy=o1;b.sil={p,box:[x0-1,y0-1,x1+1,y1+1],polys};return b.sil}
// The outline of the union of overlapping polygons (filled nonzero), as closed loops with no overlaps, so that an
// even-odd fill of the loops is the union. Vertical slabs between every vertex and crossing; in each slab the covered
// stretches; their upper and lower edges plus the vertical steps between neighbouring slabs are the outline.
function unionOutline(polys){const ED=[],xsA=[];
  for(const q of polys)for(let k=0;k<q.length;k++){const a=q[k],b=q[(k+1)%q.length];xsA.push(a[0]);if(a[0]===b[0])continue;ED.push(a[0]<b[0]?[a[0],a[1],b[0],b[1],1]:[b[0],b[1],a[0],a[1],-1])}
  for(let i=0;i<ED.length;i++)for(let j=i+1;j<ED.length;j++){const a=ED[i],b=ED[j];if(a[2]<=b[0]||b[2]<=a[0])continue;
    const d1x=a[2]-a[0],d1y=a[3]-a[1],d2x=b[2]-b[0],d2y=b[3]-b[1],den=d1x*d2y-d1y*d2x;if(Math.abs(den)<1e-12)continue;
    const t=((b[0]-a[0])*d2y-(b[1]-a[1])*d2x)/den,u=((b[0]-a[0])*d1y-(b[1]-a[1])*d1x)/den;if(t>1e-9&&t<1-1e-9&&u>1e-9&&u<1-1e-9)xsA.push(a[0]+t*d1x)}
  xsA.sort((a,b)=>a-b);const xs=[];for(const x of xsA)if(!xs.length||x-xs[xs.length-1]>1e-6)xs.push(x);
  const yAt=(e,x)=>e[1]+(e[3]-e[1])*(x-e[0])/(e[2]-e[0]),segs=[];let prev=[];
  const steps=(x,L,R)=>{const ev=[];for(const[a,b]of L)ev.push([a,1,0],[b,-1,0]);for(const[a,b]of R)ev.push([a,0,1],[b,0,-1]);ev.sort((a,b)=>a[0]-b[0]);let l=0,r=0;
    for(let i=0;i<ev.length-1;i++){l+=ev[i][1];r+=ev[i][2];if((l>0)!==(r>0)&&ev[i+1][0]-ev[i][0]>1e-7)segs.push([x,ev[i][0],x,ev[i+1][0]])}};
  for(let i=0;i<xs.length-1;i++){const xa=xs[i],xb=xs[i+1],xm=(xa+xb)/2;const act=ED.filter(e=>e[0]<=xa+1e-6&&e[2]>=xb-1e-6).map(e=>[yAt(e,xm),e]).sort((a,b)=>a[0]-b[0]);
    const iv=[];let wd=0,top=null;for(const[y,e]of act){const w0=wd;wd+=e[4];if(!w0&&wd)top=[y,e];else if(w0&&!wd){const l=iv[iv.length-1];if(y-top[0]<1e-7)continue;if(l&&top[0]-l[2]<1e-7){l[1]=e;l[2]=y}else iv.push([top[1],e,y])}}
    const L=[],R=[];for(const[t,b]of iv){const ta=yAt(t,xa),tb=yAt(t,xb),ba=yAt(b,xa),bb=yAt(b,xb);segs.push([xa,ta,xb,tb],[xa,ba,xb,bb]);L.push([ta,ba]);R.push([tb,bb])}
    steps(xa,prev,L);prev=R}
  if(xs.length)steps(xs[xs.length-1],prev,[]);
  // chain the pieces into loops, dropping points along a straight run
  const key=(x,y)=>Math.round(x*256)+'|'+Math.round(y*256),at=new Map(),used=new Uint8Array(segs.length),loops=[];
  segs.forEach((g,i)=>{for(const k of [key(g[0],g[1]),key(g[2],g[3])]){if(!at.has(k))at.set(k,[]);at.get(k).push(i)}});
  for(let i=0;i<segs.length;i++){if(used[i])continue;const lp=[];let g=segs[i],x=g[0],y=g[1],j=i;const k0=key(x,y);
    for(;;){used[j]=1;g=segs[j];const fwd=key(g[0],g[1])===key(x,y);lp.push([x,y]);x=fwd?g[2]:g[0];y=fwd?g[3]:g[1];const k=key(x,y);if(k===k0)break;const nx=(at.get(k)||[]).find(n=>!used[n]);if(nx==null)break;j=nx}
    const out=[];for(let n=0;n<lp.length;n++){const a=lp[(n+lp.length-1)%lp.length],b=lp[n],c=lp[(n+1)%lp.length];if(Math.abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1e-6)out.push(b)}
    if(out.length>2)loops.push(out)}
  return loops}
// For cutting a moving thing out where something stands in front of it, without a scratch card: clip paths that are
// everything except the outline (a huge rectangle with the outline as a hole, filled even-odd). Buildings: one path
// from the union of their walls and roofs. Trees, lamps and parked cars: one per simple piece (clips intersect).
function invOf(q){if(q.inv)return q.inv;const big=()=>{const p=new Path2D();p.rect(-1e5,-1e5,2e5,2e5);return p};
  if(q.polys){const p=big();q.loops=unionOutline(q.polys);for(const lp of q.loops){lp.forEach(([x,y],i)=>i?p.lineTo(x,y):p.moveTo(x,y));p.closePath()}q.inv=[p]}
  else{q.inv=q.parts.map(([pt,dx,dy])=>{const p=big();addOutlinePart(p,pt,dx,dy);return p});
    q.pb=q.parts.map(([pt,dx,dy])=>{if(pt[0]==='e')return[pt[1]-pt[3]+dx,pt[2]-pt[4]+dy,pt[1]+pt[3]+dx,pt[2]+pt[4]+dy];if(pt[0]==='r')return[pt[1]+dx,pt[2]+dy,pt[1]+pt[3]+dx,pt[2]+pt[4]+dy];
      const xs=pt[1].map(v=>v[0]+dx),ys=pt[1].map(v=>v[1]+dy);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]})}
  return q.inv}
// How a box lies against an outline (loops from unionOutline): 0 clear of it, 1 partly over it, 2 wholly inside it.
function boxVsLoops(b,loops){const[x0,y0,x1,y1]=b;
  for(const lp of loops)for(let i=0,n=lp.length;i<n;i++){const a=lp[i],c=lp[(i+1)%n];let ax=a[0],ay=a[1],dx=c[0]-ax,dy=c[1]-ay;
    if(Math.max(ax,c[0])<x0||Math.min(ax,c[0])>x1||Math.max(ay,c[1])<y0||Math.min(ay,c[1])>y1)continue;
    let t0=0,t1=1,ok=true;for(const[pp,qq]of [[-dx,ax-x0],[dx,x1-ax],[-dy,ay-y0],[dy,y1-ay]]){if(pp===0){if(qq<0){ok=false;break}}else{const r=qq/pp;if(pp<0){if(r>t1){ok=false;break}if(r>t0)t0=r}else{if(r<t0){ok=false;break}if(r<t1)t1=r}}}
    if(ok)return 1}
  // no edge touches the box: it is wholly inside or wholly outside; one corner tells which
  let inside=false;for(const lp of loops)for(let i=0,n=lp.length,j=n-1;i<n;j=i++){const a=lp[i],c=lp[j];if((a[1]>y0)!==(c[1]>y0)&&x0<(c[0]-a[0])*(y0-a[1])/(c[1]-a[1])+a[0])inside=!inside}
  return inside?2:0}
const scr=[mk(64,64),mk(64,64),mk(64,64)].map(c=>c.getContext('2d'));const scrInk=[0,0,0];
// cuts: [{p: Path2D, box}] in model pixels, static origin. Only the cuts whose box meets the card are filled, and the
// card's lit-window and glow layers are skipped while nothing has been painted on them (most people and cars by day).
function growScr(w_,h_){if(scr[0].canvas.width<w_||scr[0].canvas.height<h_){for(const c of scr){c.canvas.width=Math.max(c.canvas.width,w_);c.canvas.height=Math.max(c.canvas.height,h_)}scrInk.fill(0)}}
function drawCut(box,fn,cuts,dst){
  const X0=Math.floor(BT[0]*box[0]+BT[4]),Y0=Math.floor(BT[3]*box[1]+BT[5]),X1=Math.ceil(BT[0]*box[2]+BT[4]),Y1=Math.ceil(BT[3]*box[3]+BT[5]);const w_=X1-X0,h_=Y1-Y0;if(w_<=0||h_<=0)return;
  growScr(w_,h_);
  const t0=TGT,b0=BT;BT=[b0[0],0,0,b0[3],b0[4]-X0,b0[5]-Y0];
  for(let i=0;i<3;i++){const c=scr[i];c.setTransform(1,0,0,1,0,0);c.globalCompositeOperation='source-over';c.globalAlpha=1;if(!i)c.clearRect(0,0,w_,h_);else if(scrInk[i]){c.clearRect(0,0,c.canvas.width,c.canvas.height);scrInk[i]=0}c.setTransform(...BT)}
  const T_={c:scr[0],e:scr[1],g:scr[2],de:0,dg:0};TGT=T_;fn();scrInk[1]=T_.de;scrInk[2]=T_.dg;
  const k=1/BT[0],pd=2*k+1,ax=-BT[4]*k-(ox-BOX),ay=-BT[5]*k-(oy-BOY),cb=[ax-pd,ay-pd,ax+w_*k+pd,ay+h_*k+pd];
  for(let i=0;i<3;i++){if(i&&!scrInk[i])continue;const c=scr[i];c.save();c.globalCompositeOperation='destination-out';c.setTransform(...BT);c.translate(ox-BOX,oy-BOY);c.fillStyle='#000';for(const q of cuts)if(hitBox(q.box,cb))c.fill(q.p);c.restore()}
  BT=b0;TGT=t0;
  for(const d of [t0.de?dst.e:null,t0.dg?dst.g:null]){if(!d)continue;d.save();d.setTransform(1,0,0,1,0,0);d.globalCompositeOperation='destination-out';d.drawImage(scr[0].canvas,0,0,w_,h_,X0,Y0,w_,h_);d.restore()}
  if(scrInk[1])t0.de=1;if(scrInk[2])t0.dg=1;
  const ds=[dst.c,dst.e,dst.g];for(let i=0;i<3;i++){if(i&&!scrInk[i])continue;const d=ds[i];d.save();d.setTransform(1,0,0,1,0,0);d.drawImage(scr[i].canvas,0,0,w_,h_,X0,Y0,w_,h_);d.restore()}}

// screen boxes (model pixels, static origin) for culling, the samples that decide what stands in front of each
// static point, and the outlines with which trees, lamps and parked cars hide whatever passes behind them
// a tree's outline as it is drawn now (its lean in the wind, how much crown it has this time of year)
function treeOcc(o){const o0=ox,o1=oy;ox=BOX;oy=BOY;const[x,y]=P(o.gx,o.gy);ox=o0;oy=o1;const q=new Path2D();q.addPath(treeOutline(o,WIND.lean,DOY),new DOMMatrix([1,0,0,1,Math.round(x),Math.round(y)]));
  o.occParts=treeOutlineParts(o,WIND.lean,DOY).map(pt=>[pt,Math.round(x),Math.round(y)]);return q}
let occFor='';
(function prepPoints(){for(const b of blds)silhouette(b);ox=BOX;oy=BOY;
  const boxOf=(pts,zmax,pad)=>{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const[gx,gy] of pts)for(const z of [0,zmax]){const[x,y]=P(gx,gy,z);if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return[x0-pad,y0-pad,x1+pad,y1+pad]};
  for(const b of blds){b.box=boxOf(b.pts,(b.htop||b.hpx)+40,8)}
  for(const o of pts0){let fp,zmax,pad,smp;
    if(o.kind==='tree'){const hp=Math.max(9,o.h*2),rp=Math.max(3,o.r*1.9)+4;fp=[[o.gx,o.gy]];zmax=hp+4;pad=rp+1;smp=[[o.gx,o.gy,0]];
      o.occ=treeOcc(o)}
    else if(o.kind==='lamp'){fp=[[o.gx,o.gy]];zmax=17;pad=16;smp=[[o.gx,o.gy,0]];const[x,y]=P(o.gx,o.gy);const q=new Path2D();q.rect(Math.round(x),Math.round(y-11),1,11);q.rect(Math.round(x-1),Math.round(y-15),3,4);o.occ=q;o.occParts=[[['r',Math.round(x),Math.round(y-11),1,11],0,0],[['r',Math.round(x-1),Math.round(y-15),3,4],0,0]]}
    else if(o.kind==='car'){fp=o.r;zmax=5;pad=3;smp=o.r.map(p=>[p[0],p[1],0]).concat([[o.gx,o.gy,0]]);const h=hull(o.r.map(p=>P(p[0],p[1])).concat(o.r.map(p=>P(p[0],p[1],CARS[o.ty][3]))));o.occ=path(h);o.occParts=[[['p',h],0,0]]}
    else if(o.kind==='fountain'){const r=7/M;fp=[[o.gx-r,o.gy-r],[o.gx+r,o.gy+r],[o.gx-r,o.gy+r],[o.gx+r,o.gy-r]];zmax=8;pad=2;smp=fp.map(p=>[p[0],p[1],0])}
    else if(o.kind==='prop'){const r=o.pr/M;fp=[[o.gx-r,o.gy-r],[o.gx+r,o.gy+r],[o.gx-r,o.gy+r],[o.gx+r,o.gy-r]];zmax=o.ph+4;pad=3;smp=[[o.gx,o.gy,0]]}
    else{fp=[o.a,o.b];zmax=24;pad=4;smp=[[o.a[0],o.a[1],0],[o.b[0],o.b[1],0],[o.gx,o.gy,0]]}
    o.box=boxOf(fp,zmax,pad);o.bl=blockersFor(smp);if(o.occ)o.cut={p:o.occ,parts:o.occParts,box:[o.box[0]-4,o.box[1]-4,o.box[2]+4,o.box[3]+4]}}})();
const OCC=new Map();for(const o of pts0)if(o.occ){const k=Math.floor(o.gx/2)*4096+Math.floor(o.gy/2);if(!OCC.has(k))OCC.set(k,[]);OCC.get(k).push(o)}
/** Static things standing in front of a moving thing at (gx,gy): trees, lamps and parked cars nearer the viewer. */
function occludersAt(gx,gy){const out=[],s=gx-gy,u=gx+gy;for(let i=Math.floor(gx/2)-1;i<=Math.floor(gx/2)+3;i++)for(let j=Math.floor(gy/2)-1;j<=Math.floor(gy/2)+3;j++){const l=OCC.get(i*4096+j);if(!l)continue;for(const o of l){const du=o.gx+o.gy-u;if(du>.02&&du<6&&Math.abs(o.gx-o.gy-s)<2.6)out.push(o.cut)}}return out}

// ---------- static tiles ----------
// The still parts of the model are rendered in TILE-pixel squares at the current scale, only where the camera looks,
// and kept until the light or the scene changes (then they are redrawn a few at a time, old ones showing meanwhile).
// ?bench: per-frame timings of each phase, read by scripts/bench.mjs (window.__bench). Off, it costs one null check per phase.
// ?fps: the same timings shown in a small box on the page (see fpsBox), for checking a browser by eye.
const FPS=QS.has('fps'),CARD=QS.get('cut')==='card'||(SOFT&&QS.get('cut')!=='clip');
const BM=DIAG?(window.__bench={frames:[],tiles:0,tileMs:0,staticMs:0,tw:0,twLate:0,flush:QS.get('bench')==='flush'}):null;let bmT=0,bmF=null;
// an input handler, timed for the readout
const timed=f=>DIAG?(...a)=>{const t=performance.now();try{return f(...a)}finally{tm.inp+=performance.now()-t}}:f;
const bm=k=>{const t=performance.now();bmF[k]=(bmF[k]||0)+t-bmT;bmT=t};
const DBG=new URLSearchParams(location.search).has('debug');const tiles=new Map();let stver=0,T=0,renderedFor='';
// How a static thing (tree, lamp, parked car, string of lights, fountain) that is partly behind a building is cut when
// a tile is drawn. 'clip' (wherever moving things are clipped, i.e. not on a software renderer): drawn straight onto the
// tile under a clip that is everything but the buildings in front, so no canvas is read back. 'card': on a scratch card,
// the buildings rubbed out of it, the card copied onto the tile's layers, as it always was. ?tilecut=card|clip forces one.
// ?ahead=0 turns drawing ahead off (tiles are then drawn only when the view needs them), to see what it costs.
const TCLIP=QS.get('tilecut')?QS.get('tilecut')==='clip':!CARD,AHEAD=QS.get('ahead')!=='0';
// Tile canvases are reused, not made and thrown away: a tile dropped from the cache hands its canvases to a small pool
// and the next tile drawn takes them from there. A tile's lit-window and glow layers are real canvases only while
// something is painted on them; otherwise they are NIL (one shared blank) and the canvas they were drawn on goes back
// to the pool as it is, without being resized. CS counts what was made, freed and reused, for the readout and the bench.
const NIL=mk(1,1).getContext('2d'),pool=[],POOL=24,CS={made:0,freed:0,reused:0,cards:0,log:[],last:[]};
const csLog=k=>{CS[k]++;if(DIAG){CS.log.push([performance.now(),k]);if(CS.log.length>600)CS.log.splice(0,200)}};
function takeCanvas(){const c=pool.pop();if(c){csLog('reused');return c}csLog('made');return mk(TILE,TILE).getContext('2d')}
function giveCanvas(c){if(c!==NIL)pool.push(c)}
function freeSpare(){const c=pool.pop();c.canvas.width=c.canvas.height=0;csLog('freed')}
const dropTile=t=>{giveCanvas(t.c);giveCanvas(t.e);giveCanvas(t.g);t.c=t.e=t.g=NIL};
const hitBox=(bx,r)=>!(bx[0]>r[2]||bx[2]<r[0]||bx[1]>r[3]||bx[3]<r[1]);
let TR=null;const scales=new Set();
// A tile is drawn in small steps (the ground, then one building, tree, lamp or parked car at a time), so the work can be
// spread over frames; run straight through, the steps are exactly the drawing a tile always had.
function* tileSteps(tx,ty,t,vs){scales.add(vs);
  for(const k of ['c','e','g']){if(t[k]===NIL)t[k]=takeCanvas();const c=t[k];c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';c.clearRect(0,0,TILE,TILE)}
  t.cards=0;
  const bt=[vs,0,0,vs,-tx*TILE,-ty*TILE],tg={c:t.c,e:t.e,g:t.g,de:0,dg:0},r=[tx*TILE/vs,ty*TILE/vs,(tx+1)*TILE/vs,(ty+1)*TILE/vs];
  const at=()=>{BT=bt;TGT=tg;ox=BOX;oy=BOY;TR=r};at();setT(t.c,t.e,t.g);
  const inv=(x,y)=>{const a=(x-ox)/TW,b=(y-oy)/TH;return[(a+b)/2,(b-a)/2]};const cs=[inv(r[0],r[1]),inv(r[2],r[1]),inv(r[0],r[3]),inv(r[2],r[3])];
  TG=[Math.min(...cs.map(c=>c[0])),Math.min(...cs.map(c=>c[1])),Math.max(...cs.map(c=>c[0])),Math.max(...cs.map(c=>c[1]))];
  drawGround(t.c);drawShadows(t.c);TG=null;yield;at();
  for(const b of blds)if(hitBox(b.box,r)){drawBuilding(t.c,b);yield;at()}
  for(const o of pts0)if(hitBox(o.box,r)){if(!o.bl.length)drawPoint(t.c,o);else if(TCLIP)clipPoint(o,tg);else{t.cards++;CS.cards++;drawCut(o.box,()=>drawPoint(TGT.c,o),o.bl.map(silhouette),TGT)}yield;at()}
  drawNet(t.c);
  // a layer with nothing painted on it is not kept: its canvas goes back to the pool for the next tile
  t.de=tg.de;t.dg=tg.dg;if(!t.de){giveCanvas(t.e);t.e=NIL}if(!t.dg){giveCanvas(t.g);t.g=NIL}
  t.vs=vs;t.sw=scr[0].canvas.width;t.sh=scr[0].canvas.height;return t}
// A static thing partly behind buildings, drawn straight onto the tile: clipped to its box (as the card was) and to
// everything but each building in front whose outline really reaches the box; wholly inside one, it is not drawn.
// The lit-window and glow layers are clipped too when something is on them or the thing lights up, so what it paints
// and what it rubs out there are cut the same way.
function clipPoint(o,tg){const ips=[];for(const b of o.bl){const q=silhouette(b),iv=invOf(q),r_=boxVsLoops(o.box,q.loops);if(r_===2)return;if(r_)ips.push(iv[0])}
  if(!ips.length){drawPoint(tg.c,o);return}
  const X0=Math.floor(BT[0]*o.box[0]+BT[4]),Y0=Math.floor(BT[3]*o.box[1]+BT[5]),X1=Math.ceil(BT[0]*o.box[2]+BT[4]),Y1=Math.ceil(BT[3]*o.box[3]+BT[5]);if(X1<=X0||Y1<=Y0)return;
  const lit=lampsOn(),cs=[tg.c];if(tg.de||lit&&(o.kind==='lamp'||o.kind==='string'))cs.push(tg.e);if(tg.dg||lit&&o.kind==='lamp')cs.push(tg.g);
  for(const c of cs){c.save();c.setTransform(1,0,0,1,0,0);c.beginPath();c.rect(X0,Y0,X1-X0,Y1-Y0);c.clip();c.setTransform(...BT);for(const ip of ips)c.clip(ip,'evenodd')}
  LNE=true;try{drawPoint(tg.c,o)}finally{LNE=false;for(const c of cs)c.restore()}}
function tileDone(t,ms,tx,ty,inFrame=true){CS.last.push(t.cards||0);if(CS.last.length>20)CS.last.shift();if(BM){if(BM.flush){const T0=performance.now();for(const k of ['c','e','g'])t[k].getImageData(0,0,1,1);ms+=performance.now()-T0} // software canvases draw lazily: count the drawing here
    BM.tiles++;BM.tileMs+=ms;if(bmF)bmF.td=(bmF.td||0)+1;if(bmF&&inFrame){bmF.nt=(bmF.nt||0)+1;bmF.tt=(bmF.tt||0)+ms;(bmF.tl||(bmF.tl=[])).push(+ms.toFixed(1))}}if(DBG)console.log('[dbg] tile',tx,ty,Math.round(ms)+'ms')}
const newTile=()=>{makeRoom();return{c:takeCanvas(),e:NIL,g:NIL}};
function renderTile(tx,ty,t,vs=VS){const T0=performance.now(),ver=stver;const g=tileSteps(tx,ty,t||newTile(),vs);let r;while(!(r=g.next()).done);t=r.value;t.ver=ver;const ms=performance.now()-T0;tbTw+=ms;tileDone(t,ms,tx,ty);return t}
// tiles part drawn, by key; a step at a time until `until` (performance.now()), then they wait for the next frame
const jobs=new Map();
const dropJob=k=>{const j=jobs.get(k);if(j){jobs.delete(k);dropTile(j.t)}}; // a part-drawn tile given up: its canvases go back to the pool
function work(key,tx,ty,vs,until){let j=jobs.get(key);if(j&&j.ver!==stver){dropJob(key);j=null}
  if(!j){const t=newTile();j={t,g:tileSteps(tx,ty,t,vs),ms:0,ver:stver};jobs.set(key,j);while(jobs.size>4)dropJob(jobs.keys().next().value)}
  const sv=[BT,TGT,ox,oy,TR],t0=performance.now();let r;do r=j.g.next();while(!r.done&&performance.now()<until);[BT,TGT,ox,oy,TR]=sv;const dt_=performance.now()-t0;j.ms+=dt_;tbTw+=dt_;if(BM&&bmF)bmF.tw=(bmF.tw||0)+dt_;
  if(!r.done)return null;jobs.delete(key);const t=r.value,old=tiles.get(key);if(old&&old!==t)dropTile(old);t.ver=j.ver;tileDone(t,j.ms,tx,ty,false);tiles.set(key,t);return t}
function getTile(tx,ty,budget){const key=VS+'|'+tx+'|'+ty;let t=tiles.get(key);
  if(t){tiles.delete(key);tiles.set(key,t);t.use=useNo;if(t.ver!==stver&&budget.left>0){const t0=performance.now();renderTile(tx,ty,t);budget.left-=performance.now()-t0}return t}
  const t0=performance.now();t=jobs.has(key)?work(key,tx,ty,VS,Infinity):renderTile(tx,ty,null);budget.left-=performance.now()-t0;tiles.set(key,t);return t}
// While a drag or a zoom brings in tiles that are not drawn yet, a frame draws them within its budget and, until each
// is done, stands in for it with the same ground at another scale already drawn (a zoom step's previous scale, or the
// next zoom level drawn ahead), stretched to fit. With nothing to stand in, the tile is drawn at once, as before.
function standInAt(tx,ty,any){const r0=tx*TILE/VS,r1=ty*TILE/VS,r2=(tx+1)*TILE/VS,r3=(ty+1)*TILE/VS;let best=null,bd=1e9;
  for(const s of scales){if(s===VS&&!any)continue;const d=Math.abs(Math.log(s/VS));if(d>=bd)continue;const nx=Math.ceil(BW*s/TILE)-1,ny=Math.ceil(BH*s/TILE)-1;
    const a0=Math.max(0,Math.floor(r0*s/TILE)),a1=Math.max(0,Math.floor(r1*s/TILE)),b0=Math.min(nx,Math.ceil(r2*s/TILE)-1),b1=Math.min(ny,Math.ceil(r3*s/TILE)-1);let ok=true;
    for(let y=a1;y<=b1&&ok;y++)for(let x=a0;x<=b0;x++)if(!tiles.has(s+'|'+x+'|'+y)){ok=false;break}
    if(ok){best={s,r:[r0,r1,r2,r3],rg:[a0,a1,b0,b1]};bd=d}}
  return best}
// No scale covers the whole square yet (a zoom in the first seconds, before the small whole-model copy is drawn): the
// scale with the most of it already made, nearest first on a tie, so what can be shown is not left blank.
function partStandIn(tx,ty){const r0=tx*TILE/VS,r1=ty*TILE/VS,r2=(tx+1)*TILE/VS,r3=(ty+1)*TILE/VS;let best=null,bn=0,bd=1e9;
  for(const s of scales){const d=Math.abs(Math.log(s/VS)),nx=Math.ceil(BW*s/TILE)-1,ny=Math.ceil(BH*s/TILE)-1;
    const a0=Math.max(0,Math.floor(r0*s/TILE)),a1=Math.max(0,Math.floor(r1*s/TILE)),b0=Math.min(nx,Math.ceil(r2*s/TILE)-1),b1=Math.min(ny,Math.ceil(r3*s/TILE)-1);let n=0,m=0;
    for(let y=a1;y<=b1;y++)for(let x=a0;x<=b0;x++){m++;if(tiles.has(s+'|'+x+'|'+y))n++}
    const f=m?n/m:0;if(f>bn||(f===bn&&f>0&&d<bd)){best={s,r:[r0,r1,r2,r3],rg:[a0,a1,b0,b1]};bn=f;bd=d}}
  return best}
function drawStandIn({s,r:[r0,r1,r2,r3],rg},cx,cy){
  for(let y=rg[1];y<=rg[3];y++)for(let x=rg[0];x<=rg[2];x++){const k=s+'|'+x+'|'+y,t=tiles.get(k);if(!t)continue;
    t.use=useNo; // in use: not to be dropped to make room for the tile it stands in for
    const i0=Math.max(r0,x*TILE/s),i1=Math.max(r1,y*TILE/s),i2=Math.min(r2,(x+1)*TILE/s),i3=Math.min(r3,(y+1)*TILE/s);if(i2<=i0||i3<=i1)continue;
    const dx=Math.round(i0*VS)-cx,dy=Math.round(i1*VS)-cy,dw=Math.round(i2*VS)-cx-dx,dh=Math.round(i3*VS)-cy-dy,sx=i0*s-x*TILE,sy=i1*s-y*TILE,sw=(i2-i0)*s,sh=(i3-i1)*s;
    w.drawImage(t.c.canvas,sx,sy,sw,sh,dx,dy,dw,dh);if(t.de){FT.de=FT.wide=1;E.drawImage(t.e.canvas,sx,sy,sw,sh,dx,dy,dw,dh)}if(t.dg){glowOn();GL.drawImage(t.g.canvas,sx,sy,sw,sh,dx,dy,dw,dh)}}}
// What is worth drawing ahead: the whole model at a small scale (once), the ring of tiles just outside the view, then
// the view at the next zoom out and in (after a zoom step: the next level the same way first). A little of it is drawn
// at the end of each frame (what is left of the frame's tile allowance, see tileBudget), so a drag or a zoom step
// usually finds its tiles ready, and otherwise has something to stand in. Not while the pointer is down, and while a
// zoom glides only the tiles it will land on (landOnly).
let keepN=24,nVis=12,zdir=0,useNo=0;const OV=.5;
function aheadList(landOnly){const out=[];const{dw,dh}=dev();
  // while a zoom is on its way, "the view" is where it will land: those tiles come first, so it lands sharp
  const R=ZG?ZG.rest:null,VS_=R?R.vs:VS,W_=R?R.W:W,H_=R?R.H:H,cX=R?R.camX:camX,cY=R?R.camY:camY;const mx=cX+W_/VS_/2,my=cY+H_/VS_/2;
  const add=(vs,x0,y0,x1,y1,skip)=>{const nx=Math.ceil(BW*vs/TILE)-1,ny=Math.ceil(BH*vs/TILE)-1;for(let y=Math.max(0,y0);y<=Math.min(ny,y1);y++)for(let x=Math.max(0,x0);x<=Math.min(nx,x1);x++)if(!skip||!skip(x,y))out.push([x,y,vs])};
  const cx=Math.round(cX*VS_),cy=Math.round(cY*VS_),tx0=Math.floor(cx/TILE),ty0=Math.floor(cy/TILE),tx1=Math.floor((cx+W_-1)/TILE),ty1=Math.floor((cy+H_-1)/TILE);
  if(R)add(VS_,tx0,ty0,tx1,ty1);if(landOnly)return out; // while a zoom glides, nothing but the tiles it lands on
  const ring=()=>add(VS_,tx0-1,ty0-1,tx1+1,ty1+1,(x,y)=>x>=tx0&&x<=tx1&&y>=ty0&&y<=ty1);
  const level=d=>{if(!zoomAllowed(zi+d,dw,dh))return;const{vs}=planFor(ZL[zi+d],dw,dh);if(vs===VS_)return;const hw=dw/ZL[zi+d]/2,hh=dh/ZL[zi+d]/2;
    add(vs,Math.floor((mx-hw)*vs/TILE),Math.floor((my-hh)*vs/TILE),Math.floor((mx+hw)*vs/TILE),Math.floor((my+hh)*vs/TILE))};
  // after a zoom step the next level the same way comes before the ring (another step is the likeliest thing next);
  // after a drag, or at first, the ring comes first
  if(zdir){level(zdir);ring();level(-zdir)}else{ring();level(-1);level(1)}
  // first the whole model at a small scale (OV), kept for good: then there is always something to stand in
  // ...as far as the memory allows: a tile is one canvas by day and up to three once windows are lit and lamps glow
  const fit_=Math.floor(TILE_MB*262144/(TILE*TILE*(lampsOn()||FT.de?3:1.2))),nx=Math.ceil(BW*OV/TILE)-1,ny=Math.ceil(BH*OV/TILE)-1,nOv=(nx+1)*(ny+1)<=fit_/4?(nx+1)*(ny+1):0;
  const ov=[];if(VS_!==OV&&nOv)for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)ov.push([x,y,OV]);
  return ov.concat(out.slice(0,Math.max(0,Math.min(keepN,fit_-nOv)-nVis-4)))} // no more than the cache holds next to the view, so drawing ahead never undoes itself
// Where static things are cut on scratch cards (?tilecut=card, a software renderer), drawing ahead uses cards of its
// own: how big the shared ones have grown decides some edge antialiasing, so leaving them as they are keeps every
// frame drawn exactly as before. (Cut by clip, no card is used and none of this matters.)
const scrA=[mk(64,64),mk(64,64),mk(64,64)].map(c=>c.getContext('2d')),scrInkA=[0,0,0];
// A tile drawn ahead starts from the shared ones' size, and when it comes into view the shared ones grow as drawing it
// there would have grown them: so it, and everything after, comes out exactly as if it had been drawn then.
function drawAhead(until,landOnly){const miss=([x,y,vs])=>{const t=tiles.get(vs+'|'+x+'|'+y);return!t||t.ver!==stver},al=aheadList(landOnly);if(BM)BM.aheadLeft=al.filter(miss).length;const q=al.find(miss);if(!q)return;const[x,y,vs]=q,key=vs+'|'+x+'|'+y;
  if(!jobs.has(key)&&!roomAhead(al))return;
  if(!jobs.has(key))for(let i=0;i<3;i++){const a=scrA[i].canvas,m=scr[i].canvas;if(a.width!==m.width||a.height!==m.height){a.width=m.width;a.height=m.height;scrInkA[i]=0}}
  const sv=scr.slice(),si=scrInk.slice();scr.splice(0,3,...scrA);scrInk.splice(0,3,...scrInkA);
  try{const t=work(key,x,y,vs,until);if(t)t.ah=1}finally{scrA.splice(0,3,...scr);scrInkA.splice(0,3,...scrInk);scr.splice(0,3,...sv);scrInk.splice(0,3,...si)}trimTiles(keepN)}
// The cache is bounded by count and by memory (TILE_MB of tile canvases; browsers, Safari above all, cap the total
// canvas memory of a page and fail badly past it). The tiles on screen always stay. A dropped tile hands its canvases
// to the pool, and the pool frees what is over the cap at once instead of waiting for the garbage collector.
const TILE_MB=+QS.get('tilemb')||(window.matchMedia&&matchMedia('(pointer:coarse)').matches?64:160);
const tilePx=t=>t.c.canvas.width*t.c.canvas.height+t.e.canvas.width*t.e.canvas.height+t.g.canvas.width*t.g.canvas.height;
// (the pool and the part-drawn tiles count toward the memory too)
const sparePx=()=>{let px=pool.length*TILE*TILE;for(const j of jobs.values())px+=tilePx(j.t);return px};
const usedPx=()=>{let px=sparePx();for(const t of tiles.values())px+=tilePx(t);return px};
// the tiles in least-recently-used order that may be dropped: not the last nVis (the view), not a tile laid on the
// screen in this frame or the last one (the view again, and whatever is standing in for a tile not drawn yet: t.use),
// and not the small whole-model copy or any other tile at its scale
const kept=t=>t.vs===OV||t.use>=useNo-1,nLoose=()=>{let n=0;for(const t of tiles.values())if(t.vs!==OV)n++;return n};
function dropOldest(){if(nLoose()<=nVis)return false;for(const[k,t]of tiles){if(kept(t))continue;tiles.delete(k);dropTile(t);return true}return false}
// Drawing ahead never throws away what it is itself asking for: when a new tile would push out (by count or by
// memory) a tile that is on the list too, there is no room for more and it stops, instead of drawing the list round
// and round (as it did in a small cache when tiles at the whole-model copy's scale, which are never dropped, had
// taken most of the room: a tile drawn every few frames for as long as the page stood still).
function roomAhead(al){const n=nLoose();if(n<keepN&&(pool.length>=3||usedPx()+(3-pool.length)*TILE*TILE<=TILE_MB*262144))return true;
  if(n<=nVis)return false;for(const[k,t]of tiles)if(!kept(t))return!al.some(([x,y,vs])=>vs+'|'+x+'|'+y===k);return false}
// Before a new tile is started at the memory cap, the oldest tile hands over its canvases, so the new one is drawn on
// those instead of on new ones (made first and the old ones freed after, as it was, the cache at its cap made and
// freed three canvases for every tile drawn).
function makeRoom(){const cap=TILE_MB*262144;for(let i=0;i<3&&pool.length<3&&usedPx()+(3-pool.length)*TILE*TILE>cap;i++)if(!dropOldest())break}
function trimTiles(keep){let n=nLoose();const cap=TILE_MB*262144;
  while(n>keep&&n>nVis&&dropOldest())n--;
  // over the cap: spare canvases are freed, then old tiles dropped. Three spares (one tile's worth) are let be, so that
  // when the view alone is over the cap (a small cache, a big window at night) the next tile still finds its canvases
  for(;;){if(usedPx()-Math.min(pool.length,3)*TILE*TILE<=cap)break;if(pool.length>3)freeSpare();else if(!dropOldest())break}
  while(pool.length>POOL)freeSpare()}
if(BM){BM.cs=CS;BM.flags={tilecut:TCLIP?'clip':'card',ahead:AHEAD}}
if(BM)BM.mem=()=>{const px=c=>c?c.width*c.height*4:0;let b=(LY?3+(LY.gOn?1:0):5)*W*H*4+sparePx()*4;for(const t of tiles.values())b+=px(t.c.canvas)+px(t.e.canvas)+px(t.g.canvas);for(const c of scr)b+=px(c.canvas);b+=px(GTEX&&GTEX.c)+px(SHM&&SHM.c);return{canvasMB:b/1048576,tiles:tiles.size,W,H,VS,BW,BH,k:KPX,plan:PLAN.name,planWhy:PLANWHY,camX:Math.round(camX),camY:Math.round(camY),zoom:zNow(),level:ZL[zi],gliding:!!ZG,budget:TB}};
function renderStatic(){const T0=performance.now();
  SUN=sunPos(sceneDate());DOY=dayOfYear(sceneDate0());{const k=DOY+'|'+windKey(WIND);if(k!==occFor){occFor=k;for(const o of pts0)if(o.kind==='tree'){o.cut.p=o.occ=treeOcc(o);o.cut.parts=o.occParts;o.cut.inv=null}}}buildGroundTex();buildShadows();stver++;
  renderedFor=stateKey();if(BM)BM.staticMs+=performance.now()-T0;if(DBG)console.log('[dbg] static',Math.round(performance.now()-T0)+'ms')
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
const carCols=['#e6e6ea','#ecebe6','#c4c8d0','#9aa0aa','#5c6270','#2f2f38',C.Brick,'#a8483a',C['Aggie blue'],C.Slate,'#3c8a9c',C.Tobacco,'#4f9a5c','#8a6a54'];
const skins=['#f5d0ad','#e2a87e','#c3825a','#9a6040','#76462e','#553220'];
const shirts=[C.Tobacco,C['Aggie blue'],C.Brick,C.Pine,C.Paper,C['Haw River'],'#b04ec0',C.Slate,'#ff7a9a'];
const cars=[],people=[];
// A divided street (two one-way roadways side by side under one name) has no sidewalk down its middle: find the side
// of each roadway that faces its twin, and keep the walkers to the other side.
for(const ch of chains){const off=(RW[ch.c]/2+2)/M,near=(RW[ch.c]/2+1)/M;
  for(const sd of [1,-1]){let n=0,hit=0;for(let d=.5;d<ch.L;d+=1.5){const[gx,gy,ux,uy]=along(ch,d),px=gx-uy*off*sd,py=gy+ux*off*sd;n++;
      if(chains.some(o=>{if(o===ch||o.n!==ch.n||!o.n)return false;for(let i=1;i<o.p.length;i++){const a=o.p[i-1],b=o.p[i],dx=b[0]-a[0],dy=b[1]-a[1],L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/L2)):0;if(Math.hypot(a[0]+dx*t-px,a[1]+dy*t-py)<near)return true}return false}))hit++}
    if(n&&hit/n>.4)ch.mid=sd}}
chains.forEach((ch,ci)=>{
  const np=Math.round(ch.L/4);for(let k=0;k<np;k++)people.push({ch,d:Math.random()*ch.L,dir:Math.random()<.5?1:-1,side:ch.mid?-ch.mid:Math.random()<.5?1:-1,v:.13+Math.random()*.06,night:k%3!==0,skin:skins[(ci+k)%6],shirt:shirts[(ci*2+k)%9]})});
// ---------- street traffic ----------
// The streets as a graph (OSM ways split where they meet), one lane each way (one way where OSM says so, and round a
// roundabout's ring), driving on the right. Cars follow the car ahead (a simple intelligent-driver model, looking past
// pieces of street too short to hold a car), stop at red and yellow lights at the real signals (OSM traffic_signals;
// two phases, the cross street gets green in turn), come to a full stop at mapped stop signs before going when the
// junction is clear, and yield on side streets and on joining a roundabout. They wait behind the stop bar, keep out
// of a junction they could not leave, and turn left only when nothing is coming. At each junction a car picks a legal
// way on (no wrong way down one-way streets, no U-turns unless it is a dead end); at the model's edge it leaves and
// another car comes in somewhere else.
const SHORT=1.7;
const TF=(()=>{const key=(x,y)=>x.toFixed(2)+','+y.toFixed(2);const pieces=[];
  for(const r of MAP.R){if(r.ar||r.c>4)continue;for(const p of clipLine(pairs(r.p),.3))pieces.push({p,c:r.c,ow:r.ow||r.rb,n:r.n,rb:r.rb})}
  const seen=new Map();for(const pc of pieces)pc.p.forEach((q,i)=>{const k=key(q[0],q[1]);seen.set(k,(seen.get(k)||0)+(i===0||i===pc.p.length-1?1:2))});
  const nodes=new Map();const node=q=>{const k=key(q[0],q[1]);let n=nodes.get(k);if(!n){n={k,x:q[0],y:q[1],out:[],inn:[],cls:9};nodes.set(k,n)}return n};
  const lanes=[];
  for(const pc of pieces){let cur=[pc.p[0]];for(let i=1;i<pc.p.length;i++){cur.push(pc.p[i]);const k=key(pc.p[i][0],pc.p[i][1]);if(i===pc.p.length-1||seen.get(k)!==2){
      if(cur.length>1){const a=node(cur[0]),b=node(cur[cur.length-1]);if(a!==b){const mk_=(pts,from,to)=>{const ch=mkChain(pts,{c:pc.c,n:pc.n});const ln={ch,from,to,L:ch.L,c:pc.c,ow:pc.ow,rb:pc.rb,cars:[],id:lanes.length};lanes.push(ln);from.out.push(ln);to.inn.push(ln);return ln};
        const f=mk_(cur,a,b);if(!pc.ow){const r_=mk_(cur.slice().reverse(),b,a);f.rev=r_;r_.rev=f}a.cls=Math.min(a.cls,pc.c);b.cls=Math.min(b.cls,pc.c)}}cur=[pc.p[i]]}}}
  const N=[...nodes.values()];
  // the junction's controls: real signals and stop signs from OSM, matched to the nearest junction
  for(const n of N)n.deg=new Set([...n.out,...n.inn].map(l=>l.rev?Math.min(l.id,l.rev.id):l.id)).size;
  const near=(x,y,r)=>{let best=null,bd=r;for(const n of N){if(n.deg<3)continue;const d=Math.hypot(n.x-x,n.y-y);if(d<bd){bd=d;best=n}}return best};
  for(const[x,y,k] of (MAP.SIG||[])){if(k==='s'){const n=near(x,y,3.2);if(n)n.signal=true}}
  for(const[x,y,k] of (MAP.SIG||[])){if(k==='p'||k==='y'){// a stop or yield sign belongs to the approach it stands on
      let best=null,bd=2.2;for(const n of N){if(n.signal||n.deg<3)continue;for(const l of n.inn){const q=l.ch.p[l.ch.p.length-2]||l.ch.p[0];const d=Math.hypot(x-n.x,y-n.y);if(d<bd&&((x-n.x)*(q[0]-n.x)+(y-n.y)*(q[1]-n.y))>0){bd=d;best=l}}}if(best){best.sign=k==='p'?'stop':'yield';best.signAt=[x,y]}}}
  for(const n of N){const hd=l=>{const p=l.ch.p,a=p[p.length-2],b=p[p.length-1];return Math.atan2(b[1]-a[1],b[0]-a[0])};
    // signals a few metres apart (a divided street's two carriageways, a split junction) work as one: the same
    // timing and the same street on green, so nobody is held on the short link between them
    if(n.signal&&n.inn.length){let g=n;for(;;){const m=[...g.out.map(l=>l.to),...g.inn.map(l=>l.from)].find(q=>q.signal&&q!==g&&q.k<g.k&&Math.hypot(q.x-g.x,q.y-g.y)<2.6);if(!m)break;g=m}
      const h0=hd(g.inn[0]);for(const l of n.inn){let d=Math.abs(((hd(l)-h0)%Math.PI+Math.PI)%Math.PI);d=Math.min(d,Math.PI-d);l.phase=d<Math.PI/4?0:1;l.inner=l.L<SHORT&&l.from.signal}n.offset=hash(g.x,g.y)*40}
    // side streets give way at junctions without lights, and whoever joins a roundabout gives way to those on it
    else if(n.deg>=3){const ring=n.out.some(l=>l.rb);n.rb=ring;for(const l of n.inn)if(!l.sign&&(ring?!l.rb:l.c>n.cls))l.sign='yield'}}
  const entries=lanes.filter(l=>l.from.out.length===1&&l.from.inn.length<=1&&(l.from.x<1||l.from.y<1||l.from.x>GX-1||l.from.y>GY-1));
  return{lanes,nodes:N,entries:entries.length?entries:lanes}})();
// Crosswalks and stop bars, from the junctions of that graph. A signalled junction has a crosswalk on every arm; one
// without lights only across the streets that give way (a side street meeting a main one, the entries of a roundabout),
// as painted downtown. None is painted on the ring of a roundabout itself, or on the short link between two junctions
// that sit a few metres apart (a divided street's two carriageways), which is where they used to pile up.
// cw: [x, y, ux, uy (along the street), street width (m)]; bars: [x0, y0, x1, y1] across the lanes that stop.
const XWALK=(()=>{const cw=[],bars=[];
  for(const n of TF.nodes){if(n.deg<3)continue;const arms=[];
    for(const l of n.out)arms.push({o:l,i:l.rev||null});for(const l of n.inn)if(!l.rev)arms.push({o:null,i:l});
    const wmax=RW[n.cls]||RW[3];
    for(const a of arms){const l=a.o||a.i,far=a.o?l.to:l.from;if(l.c>3||l.rb)continue;if(l.L<3.2&&far.deg>=3)continue;
      const gives=a.i&&(a.i.sign==='stop'||a.i.sign==='yield');if(!n.signal&&!gives&&!(n.rb&&!l.rb))continue;
      // a point d (grid units) out along the arm, with the direction pointing away from the junction
      const at=d=>{d=Math.min(d,l.L*.45);if(a.o){return along(l.ch,d)}const q=along(l.ch,l.L-d);return[q[0],q[1],-q[2],-q[3]]};
      const w=RW[l.c],[x,y,ux,uy]=at((wmax/2+(n.rb?3.4:2.2))/M);cw.push([x,y,ux,uy,w]);
      if(a.i&&(n.signal||a.i.sign==='stop')){const[bx,by,bu,bv]=at((wmax/2+(n.rb?5.5:4.3))/M),rx=bv,ry=-bu,h0=a.o?.25/M:-(w/2-.4)/M,h1=(w/2-.4)/M;
        bars.push([bx+rx*h0,by+ry*h0,bx+rx*h1,by+ry*h1])}}}
  return{cw,bars}})();
// walkers keep to the sidewalks: where a street ends on a roundabout they turn back short of the ring
for(const ch of chains){const rbAt=q=>TF.nodes.some(n=>n.rb&&Math.hypot(n.x-q[0],n.y-q[1])<1.2);if(rbAt(ch.p[0]))ch.d0=Math.min(1.8,ch.L/3);if(rbAt(ch.p[ch.p.length-1]))ch.d1=ch.L-Math.min(1.8,ch.L/3)}
const CYC=[22,3,1.5];const CYCLE=2*(CYC[0]+CYC[1]+CYC[2]);
/** 'g', 'y' or 'r' for an approach at a signal */
function light(l){if(!l.to.signal||l.inner)return null;let t=((T+l.to.offset)%CYCLE+CYCLE)%CYCLE;const half=CYCLE/2;const mine=l.phase===0?t<half:t>=half;if(!mine)return'r';t%=half;return t<CYC[0]?'g':t<CYC[0]+CYC[1]?'y':'r'}
// A car waits with its nose just short of the crosswalk (crosswalks lie 0.8 to 3.6 m beyond the kerb line of the
// widest street at the junction, the stop bar at 4.3 m); on a piece of street shorter than that, at its start.
// SHORT: a piece of street too short to wait on (the link between a divided street's carriageways, a roundabout's ring).
const CARL=4.6/9,stopBack=l=>Math.min((RW[l.to.cls]/2+6.9)/M,Math.max(0,l.L-.15));
const tcars=[];if(new URLSearchParams(location.search).has('debug'))window.__tf={TF,tcars,pts0,blds,people,light,train:d=>{if(d!=null)trainD=d;return{d:trainD,L:trainCh.L,x:XING.map(x=>({td:x.td,on:x.on,down:x.down,lanes:x.lanes.length}))}}};
(function seedCars(){for(const l of TF.lanes){const n=Math.floor(l.L/(l.c<=2?6:10)+Math.random()*.7);for(let k=0;k<n;k++){const s=(k+.3+Math.random()*.4)*l.L/Math.max(1,n);addCar(l,s)}}})();
function addCar(l,s){const c={lane:l,s,v:.6,ty:carKind(Math.random()),col:carCols[Math.floor(Math.random()*carCols.length)],v0:(l.c<=2?1.5:1.15)*(.88+Math.random()*.24),wait:0,go:false,off:null};l.cars.push(c);l.cars.sort((a,b)=>b.s-a.s);tcars.push(c);return c}
function nextLane(c){const l=c.lane;const opts=l.to.out.filter(o=>o!==l.rev&&!o.blocked);if(!opts.length)return l.to.out.find(o=>o===l.rev&&!o.blocked)||null;
  // mostly straight on, sometimes a turn
  const h=(q,a)=>{const p=q.ch.p;return a?Math.atan2(p[1][1]-p[0][1],p[1][0]-p[0][0]):Math.atan2(p[p.length-1][1]-p[p.length-2][1],p[p.length-1][0]-p[p.length-2][0])};const h0=h(l,false);
  const w=opts.map(o=>{let d=Math.abs(h(o,true)-h0);d=Math.min(d,2*Math.PI-d);return(d<.5?4:1)*(o.vol||1)});let r=Math.random()*w.reduce((a,b)=>a+b,0);for(let i=0;i<opts.length;i++){r-=w[i];if(r<=0)return opts[i]}return opts[0]}
// Is the junction taken, for a car that must give way (stop sign, yield, joining a roundabout)? Yes while someone from
// another street is crossing it, or is about to: already past their line, or coming on a street with the right of way
// and a second or so off.
function boxBusy(n,me,l){for(const o of n.out)for(let i=o.cars.length-1;i>=0;i--){const k=o.cars[i];if(k.s>.6)break;if(k!==me&&k.v>.05&&k.from!==l)return true}
  for(const m of n.inn){if(m===l)continue;const r=coming(m,3.6,me);if(!r)continue;const[d,h]=r;if(h.lane===m&&h.go?d<.7+h.v*.5:!m.sign&&h.v>.05&&d<.9+h.v*2)return true}return false}
// The nearest car coming down a lane toward its end, looking back through the short pieces behind it (a roundabout's
// ring is made of them) up to D grid units away: [distance to the lane's end, the car], or null.
function coming(m,D,skip){const h=m.cars[0];if(h)return h===skip?null:[m.L-h.s,h];if(m.L>=D)return null;let best=null;
  for(const q of m.from.inn){if(q===m.rev)continue;const r=coming(q,D-m.L,skip);if(r&&(!best||r[0]+m.L<best[0]))best=[r[0]+m.L,r[1]]}return best}
// The same for a car with the right of way where no sign or light settles it: it still does not drive into someone
// from another street who is already crossing, turns left only when nothing is coming, and of two cars arriving
// together the nearer goes first.
function crossBusy(n,me,l){const nx=me.next,mine=l.L-me.s;
  for(const o of n.out){if(o===l.rev)continue;for(let i=o.cars.length-1;i>=0;i--){const k=o.cars[i];if(k.s>.55)break;if(k!==me&&k.v>.05&&k.from&&k.from!==l&&(!nx||k.from.rev!==nx))return true}}
  for(const m of n.inn){if(m===l||m.sign||(nx&&m.rev===nx))continue;const h=m.cars[0];if(!h)continue;const d=m.L-h.s;
    if(h.go?d<.7:h.v>.05&&d<1.2&&(d<mine-1e-3||(d<mine+1e-3&&m.id<l.id)))return true}return false}
// The gap to the nearest car beyond a lane that is short and empty (the pieces of a roundabout, a street split in two
// at a junction): the last car on whichever lanes lead on from it. [gap, that car's speed]
function tailBeyond(nx,base,depth){let g=1e9,v=0;for(const o of nx.to.out){if(o===nx.rev)continue;const t=o.cars[o.cars.length-1];
    if(t){const d=base+nx.L+t.s-CARL;if(d<g){g=d;v=t.v}}else if(depth>1&&o.L<2&&base+nx.L<3){const r=tailBeyond(o,base+nx.L,depth-1);if(r[0]<g){g=r[0];v=r[1]}}}
  return[g,v]}
function stepTraffic(dt){
  feedCars(dt);
  for(const l of TF.lanes){
    for(let i=0;i<l.cars.length;i++){const c=l.cars[i];if(!c.next)c.next=nextLane(c);
      // the gap to whatever is ahead: the car in front, or the last car on the lane we turn into
      let gap=1e9,vl=0;if(i>0){gap=l.cars[i-1].s-c.s-CARL;vl=l.cars[i-1].v}else if(c.next){if(c.next.cars.length){const t=c.next.cars[c.next.cars.length-1];gap=l.L-c.s+t.s-CARL;vl=t.v}else if(c.next.L<2)[gap,vl]=tailBeyond(c.next,l.L-c.s,3)}
      // must we stop at the end of this lane?
      const sb=stopBack(l),toLine=l.L-sb-c.s;let hold=false;
      if(!c.go&&toLine>-.15){const lt=light(l);
        if(lt==='r')hold=true;else if(lt==='y')hold=c.v*c.v/(2*2.2)<toLine+.05;
        else if(l.sign==='stop'&&l.L>=SHORT){if(c.v<.04&&toLine<.35){c.wait+=dt;if(c.wait>1.3&&(!boxBusy(l.to,c,l)||c.wait>25))c.go=true;else hold=true}else hold=true}
        else if(l.sign){hold=toLine<1.6&&boxBusy(l.to,c,l);if(hold&&c.v<.04){c.wait+=dt;if(c.wait>25)hold=false}}
        else if(lt==null&&l.to.deg>=3&&toLine<1.2){hold=crossBusy(l.to,c,l);if(hold&&c.v<.04){c.wait+=dt;if(c.wait>12)hold=false}}
        // Keep the junction clear: no driving in while the way out is full, and where the next piece of street is too
        // short to wait on (a link between two junctions, a roundabout's ring) its light or sign is obeyed from here.
        if(!hold&&i===0&&c.next&&toLine<1.2&&l.to.deg>=3){const q=c.next,t=q.cars[q.cars.length-1];let h2=!!t&&t.v<.25&&t.s<CARL+.45;
          if(!h2&&q.L<SHORT&&q.sign)h2=boxBusy(q.to,c,q);
          if(h2){c.wait2=(c.wait2||0)+dt;if(c.wait2<30)hold=true}}
        if(!hold&&toLine<.4){c.go=true;c.wait2=0}}
      for(const k of L.closures)if(k.full)for(const q of (k.lanes||[]))if(q.lane===l&&q.s>c.s){const d=q.s-.5-c.s;if(d<gap){gap=d;vl=0}}
      // a level crossing with its lights flashing: wait at the stop line (a car already past it clears the tracks)
      for(const x of XING)if(x.on)for(const q of x.lanes)if(q.lane===l&&q.s>c.s-.1){const d=Math.max(.001,q.s-c.s);if(d<gap){gap=d;vl=0}}
      if(hold&&toLine<gap){gap=Math.max(.001,toLine);vl=0}
      const A=1.1,Bd=2.2,s0=.32,Th=.9;const ds=s0+c.v*Th+c.v*(c.v-vl)/(2*Math.sqrt(A*Bd));let a=A*(1-Math.pow(c.v/c.v0,4)-Math.pow(Math.max(0,ds)/Math.max(.02,gap),2));a=Math.max(-6,a);
      c.v=Math.max(0,c.v+a*dt);c.s+=Math.min(c.v*dt,Math.max(0,gap+CARL*.1));c.stopped=c.v<.05}
    // cars that reached the end move on (or leave the model)
    while(l.cars.length&&l.cars[0].s>=l.L){const c=l.cars.shift();const nx=c.next;const[ox_,oy_]=lanePos(l,l.L);c.s-=l.L;c.wait=0;c.go=false;c.next=null;
      if(nx){c.from=l;c.lane=nx;nx.cars.push(c);if(nx.cars.length>1&&nx.cars[nx.cars.length-2].s<c.s)nx.cars.sort((a,b)=>b.s-a.s);const[px,py,ux_,uy_]=lanePos(nx,0),e=along(l.ch,l.L);c.off=[ox_-px,oy_-py,Math.min(.9,nx.L),e[2],e[3]]}
      else if(tcars.length>carTarget){tcars.splice(tcars.indexOf(c),1)}
      else{const e=pickEntry();const tail=e.cars[e.cars.length-1];if(tail&&tail.s<CARL*2){c.lane=l;c.s=l.L-.01;c.v=0;l.cars.unshift(c);break}c.lane=e;c.s=0;c.v=.8;c.off=null;c.from=null;e.cars.push(c)}}}
}
function lanePos(l,s){const[gx,gy,ux,uy]=along(l.ch,s);const off=l.ow&&!l.rev?0:(RW[l.c]/4)/M;return[gx-uy*off,gy+ux*off,ux,uy]}
const trainCh=clipLine(pairs(MAP.TRAIN),1.5).map(p=>mkChain(p,{})).sort((a,b)=>b.L-a.L)[0]||mkChain([[0,0],[0,0]],{});
let trainD=-12,trainWait=4;
// Level crossings (MAP.LX): where a street crosses the tracks at grade. Each has a post with a crossbuck and lights on
// the right of each approach and, where OSM maps a barrier, a gate arm. When the model's train comes the lights flash,
// the arms come down and cars wait at the stop line. (The train itself is for show: no public feed says when real
// trains pass, so its timing is made up.)
const projCh=(ch,x,y)=>{let best={d:1e9,s:0};for(let i=1;i<ch.p.length;i++){const[a0,a1]=ch.p[i-1],[b0,b1]=ch.p[i];const dx=b0-a0,dy=b1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((x-a0)*dx+(y-a1)*dy)/L2)):0;const d=Math.hypot(a0+dx*t-x,a1+dy*t-y);if(d<best.d)best={d,s:ch.cum[i-1]+Math.sqrt(L2)*t}}return best};
const XING=(MAP.LX||[]).filter(l=>l[4]<=4).map(([ax,ay,bx,by,cl,gates])=>{const L=Math.hypot(bx-ax,by-ay)||1,ux=(bx-ax)/L,uy=(by-ay)/L,cx=(ax+bx)/2,cy=(ay+by)/2,back=L/2+4.6/M,side=(RW[cl]/2+1.3)/M;
  const tp=projCh(trainCh,cx,cy);const x={cx,cy,ux,uy,cl,gates,td:tp.d<L/2+1?tp.s:null,down:0,on:false,lanes:[],
    // a post on the right of each approach: [x, y, which way the arm reaches (toward the street's middle)]
    posts:[[ax-ux*3/M-uy*side,ay-uy*3/M+ux*side,uy,-ux],[bx+ux*3/M+uy*side,by+uy*3/M-ux*side,-uy,ux]]};
  // each approach's stop line is found on whichever lane really holds it and heads for the tracks (a street is often
  // split into two segments inside the crossing, so the lane through the middle is not always the one to stop on)
  for(const[px,py,dx,dy] of [[cx-ux*back,cy-uy*back,ux,uy],[cx+ux*back,cy+uy*back,-ux,-uy]])for(const l of TF.lanes){const q=projCh(l.ch,px,py);if(q.d>.15)continue;const t=along(l.ch,q.s);if(t[2]*dx+t[3]*dy>.5)x.lanes.push({lane:l,s:q.s})}
  return x});
function stepCrossings(dt){for(const x of XING){x.on=x.td!=null&&trainD>x.td-18&&trainD-7*2.3<x.td+2.5;x.down=Math.max(0,Math.min(1,x.down+(x.on?dt/1.6:-dt/1.2)))}}

// ---------- how busy it is ----------
// The page (app.js, from public/activity.js) says how busy downtown is right now: an estimate from the hour, the day
// of the week, the weather and what is on, not a measurement. Three things follow it.
//
// Moving cars. Each street carries its average daily traffic (NCDOT's count where a count station is on it, else a
// figure typical of its class). The cars on a stretch at any moment are its hourly flow times its length over the
// speed, plus a share for those waiting at lights; the total is never more than the model first seeded, so the
// busiest hour costs no more to draw than before. Cars enter on a street in proportion to its traffic, and when
// there are too many, those that drive off the model are not replaced.
//
// Parked cars. Every lot's rows are filled according to what stands around them (offices, shops and restaurants,
// homes and hotels, churches), each with its own daily rhythm, and lots near an event or a busy place fill further.
//
// People. Each walker has a rank; the busier the sidewalks, the further down the ranks they are shown. Elm Street
// comes first, then the main streets.
const AADT_CLASS=[16000,16000,12000,6000,1500,600,600];const PEAK_SHARE=.084;
let carTarget=1e9,walkLv=.5,ACT=null,volFor=null,entryW=null;
for(const l of TF.lanes)l.aadt=AADT_CLASS[l.c]||1500;
const laneVol=l=>l.aadt/(l.rev?2:1);
function setLaneVols(){const top=Math.max(...TF.lanes.map(laneVol));for(const l of TF.lanes)l.vol=Math.max(.05,laneVol(l)/top);entryW=null}
setLaneVols();
/** NCDOT count stations ({gx,gy,aadt}): a station sets the traffic of the whole street it stands on. */
function setVolumes(list){if(list===volFor)return;volFor=list;const by=new Map();
  for(const l of TF.lanes)l.aadt=AADT_CLASS[l.c]||1500;
  for(const st of list||[]){if(!(st.aadt>0))continue;let best=null,bd=3;for(const l of TF.lanes){if(!l.ch.n)continue;const ch=l.ch;for(let i=1;i<ch.p.length;i++){const[a0,a1]=ch.p[i-1],[b0,b1]=ch.p[i];const dx=b0-a0,dy=b1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((st.gx-a0)*dx+(st.gy-a1)*dy)/L2)):0;const d=Math.hypot(a0+dx*t-st.gx,a1+dy*t-st.gy);if(d<bd){bd=d;best=l}}}
    if(best){const k=best.ch.n;if(!by.has(k))by.set(k,[]);by.get(k).push(st.aadt)}}
  for(const l of TF.lanes){const v=by.get(l.ch.n);if(v)l.aadt=v.reduce((a,b)=>a+b,0)/v.length}
  setLaneVols();if(DBG)console.log('[dbg] street volumes',[...by].map(([k,v])=>k+' '+Math.round(v.reduce((a,b)=>a+b,0)/v.length)).join(', '))}
/** The cars a lane should hold when `share` of the day's traffic passes in this hour. */
const SEED=tcars.length;
function laneCars(l,share){const kmh=(l.c<=2?1.5:1.15)*M*3.6;return laneVol(l)*share/kmh*(l.L*M/1000)*1.4}
function pickEntry(){const E=TF.entries;if(!entryW){entryW=E.map(laneVol);entryW.sum=entryW.reduce((a,b)=>a+b,0)}let r=Math.random()*entryW.sum;for(let i=0;i<E.length;i++){r-=entryW[i];if(r<=0)return E[i]}return E[E.length-1]}
function dropCar(c){const a=c.lane.cars,i=a.indexOf(c);if(i>=0)a.splice(i,1);const j=tcars.indexOf(c);if(j>=0)tcars.splice(j,1)}
let feedAcc=0;
function feedCars(dt){if(tcars.length>=carTarget){feedAcc=0;return}feedAcc+=dt*3;while(feedAcc>=1&&tcars.length<carTarget){feedAcc--;const e=pickEntry(),tail=e.cars[e.cars.length-1];if(!tail||tail.s>CARL*2.5){const c=addCar(e,0);c.v=.8}}}
/** Thin the cars to a level at once (when the page opens, or comes back after a long sleep), lane by lane. */
function trimCars(share){for(const l of TF.lanes){const want=laneCars(l,share);let n=Math.floor(want+Math.random());while(l.cars.length>n)dropCar(l.cars[Math.floor(Math.random()*l.cars.length)])}}
function setTraffic(share,first){let n=0;for(const l of TF.lanes)n+=laneCars(l,share);const was=carTarget;carTarget=Math.max(2,Math.min(SEED,Math.round(n)));if(first||tcars.length>carTarget*1.6+6)trimCars(share);return was!==carTarget}

// what each row of stalls serves: the buildings within about 120 m, nearer and larger ones counting for more
const LOTKIND={apartments:'home',residential:'home',house:'home',detached:'home',dormitory:'home',hotel:'home',church:'church',retail:'retail',commercial:'retail',office:'office',government:'office',public:'office',university:'office',school:'office',industrial:'office',train_station:'office',yes:'mixed'};
const rowMix=(MAP.SR||[]).map(r=>{const x=r[0]+r[2]*(r[4]-1)/2,y=r[1]+r[3]*(r[4]-1)/2;const m={office:0,retail:0,home:0,church:0};
  for(const b of blds){const d=Math.hypot(b.cx-x,b.cy-y);if(d>13)continue;const k=LOTKIND[b.t];if(!k)continue;const w=Math.sqrt(b.area*Math.max(1,b.lv))/(1+(d/4)*(d/4));if(k==='mixed'){m.office+=w*.5;m.retail+=w*.5}else m[k]+=w}
  const s=m.office+m.retail+m.home+m.church;if(!s)return{x,y,office:.6,retail:.4,home:0,church:0};for(const k in m)m[k]/=s;return{x,y,...m}});
const lotCars=pts0.filter(o=>o.kind==='car'&&o.u!=null);const NOBOX=[1e9,1e9,1e9,1e9],NOPATH=new Path2D();
/** Show or hide each parked car for the lots' shares in use. True when any car changed (the still tiles are stale). */
function setParking(act){const occ=rowMix.map(m=>{if(!act)return .66;let o=m.office*act.park.office+m.retail*act.park.retail+m.home*act.park.home+m.church*act.park.church;
    for(const d of act.draws||[]){const q=Math.hypot(d.gx-m.x,d.gy-m.y);if(q<d.r)o=Math.max(o,d.occ*(1-.5*q/d.r))}return Math.round(Math.min(.9,o)*25)/25});
  let ch=false;for(const o of lotCars){const hid=!(o.u<occ[o.row]);if(hid===!!o.hid)continue;ch=true;o.hid=hid;
    // a hidden car keeps its place in the lists but gets a box nothing meets and an empty outline: it is not drawn
    // into the tiles and hides nothing that passes
    if(hid){o.box1=o.box;o.cut1=[o.cut.p,o.cut.box];o.box=NOBOX;o.cut.p=NOPATH;o.cut.box=NOBOX}else{o.box=o.box1;o.cut.p=o.cut1[0];o.cut.box=o.cut1[1]}}
  return ch}
setParking(null);
people.forEach((p,i)=>{p.rk=hash(i*.37+1,5)/(/Elm Street/.test(p.ch.n||'')?1:p.ch.c<=2?.75:.55)});
/** Take the page's estimate (scene.act) and street counts (scene.volumes). True if the still tiles must be redrawn. */
function setActivity(scene){if(scene.volumes!==undefined)setVolumes(scene.volumes);const a=scene.act;if(!a)return false;const first=!ACT;ACT=a;
  walkLv=a.walk;setTraffic(a.hourShare,first);return setParking(a)}
if(DBG)window.__busy=()=>({cars:tcars.length,carTarget,seed:SEED,walkers:people.filter(p=>p.rk<walkLv).length,walkersAll:people.length,parked:lotCars.filter(o=>!o.hid).length,stalls:ST.length,act:ACT});

// ---------- the house up the street: her day ----------
// The same made-up day as on the close-up page (homeday.js: the same clock and the same weather rules), shown as figures
// the size of everyone else on the model: mowing, by the fire with friends, a book in the yard, out for a run or a walk
// along her street and back. Nothing is watched. ?do=mow|run|walk|fire|coffee|read|garden previews one of them.
const HD=HM?(()=>{const g=HM.g,lot=HOME,F=lot.fire,D=lot.doors,me=lot.her||{},Qd=QS.get('do');
  const ch=pts=>mkChain(pts.map(g)),mps=v=>v/M; // metres a second, in tiles a second
  const chair=i=>{const a=lot.chairs[i%lot.chairs.length].a*rad;return[F.x+Math.cos(a)*(F.r-.55),F.y+Math.sin(a)*(F.r-.55)]};
  const CH=lot.chairs.map((k,i)=>({p:g(chair(i)),c:k.c}));
  const SX=lot.street[0],endY=lot.walk[lot.walk.length-1][1],shedPt=[lot.shed.box[2]+.8,lot.shed.box[3]-1.5];
  const yard=D.yard||[D.back[0]-1,D.back[1]];
  const rMow=ch([D.back,yard,shedPt,...mowRoute(lot).route.pts,D.gateOut,D.gateIn,shedPt]);
  const rOut=ch([...lot.walk,[SX+.6,endY]]);
  const back=p=>ch([D.back,yard,p]);
  const near=[F.x+.9,F.y-1.1],rChair=back(chair(0)),rPatio=ch([D.back,lot.patioChair]),rNear=back(near);
  const beds=lot.beds.map(b=>[b[2]+.5,(b[1]+b[3])/2]);
  // her street: the mapped road nearest the end of the front walk, joined end to end with the rest of the same road
  const street=(()=>{const[sx,sy]=g([SX+3,endY]);let best=null;
    const segs=MAP.R.filter(r=>!r.ar&&r.c<=4).map(r=>({n:r.n,c:r.c,p:pairs(r.p)}));
    for(const r of segs)for(let i=1;i<r.p.length;i++){const[a0,a1]=r.p[i-1],[b0,b1]=r.p[i],dx=b0-a0,dy=b1-a1,L2=dx*dx+dy*dy,t=L2?Math.max(0,Math.min(1,((sx-a0)*dx+(sy-a1)*dy)/L2)):0,d=Math.hypot(a0+dx*t-sx,a1+dy*t-sy);if(!best||d<best.d)best={r,d}}
    if(!best||best.d>3)return null;
    let ln=best.r.p.slice();const rest=segs.filter(r=>r!==best.r&&r.n===best.r.n),k=q=>q[0].toFixed(2)+','+q[1].toFixed(2);
    for(let go=true;go;){go=false;for(const r of rest){if(r.used)continue;const a=k(r.p[0]),b=k(r.p[r.p.length-1]),h=k(ln[0]),e=k(ln[ln.length-1]);
      if(a===e)ln=ln.concat(r.p.slice(1));else if(b===e)ln=ln.concat(r.p.slice(0,-1).reverse());else if(b===h)ln=r.p.slice(0,-1).concat(ln);else if(a===h)ln=r.p.slice(1).reverse().concat(ln);else continue;r.used=go=true}}
    const cl=clipLine(ln).map(q=>mkChain(q,{c:best.r.c})).find(q=>projCh(q,sx,sy).d<3);if(!cl)return null;
    const d0=projCh(cl,sx,sy).s,[x,y,ux,uy]=along(cl,d0),o=(RW[cl.c]/2+2)/M,e=g([SX,endY]);
    return{ch:cl,d0,off:Math.hypot(x-uy*o-e[0],y+ux*o-e[1])<Math.hypot(x+uy*o-e[0],y-ux*o-e[1])?o:-o}})();
  const mins=d=>{const p=nyParts(d);return +p.hour*60+ +p.minute};
  let sun=null,sunDay=-1,force=null;const t00=performance.now();
  /** Everyone and everything on the lot that moves, for this moment, onto the frame's list. */
  function add(dyn,vis){
    const now=sceneDate(),c=clockAt(now);c.min+=S.time==='now'?now.getMilliseconds()/60000:(performance.now()-t00)/60000; // a previewed hour still runs
    if(sunDay!==c.d){const t=sunTimes();sun={rise:t.rise?mins(t.rise):420,set:t.set?mins(t.set):1080};sunDay=c.d}
    if(Qd&&!force)force={kind:Qd,t0:c.min-(Qd==='fire'?60:Qd==='mow'?3:.1)};
    const st=nowDoing(c,{precip:!L.wx||L.wx==='clear'?'none':L.wx,intensity:L.intensity,tempF:L.tempF,windMph:L.windMph},sun,force),t=(c.min-st.t0)*60,Tt=(st.t1-st.t0)*60;
    let at=null;const pp=(q,pose,o={})=>{if(!o.skin)at=[+q[0].toFixed(2),+q[1].toFixed(2)];if(vis(q[0],q[1]))dyn.push({kind:'pp',gx:q[0],gy:q[1],skin:o.skin||me.skin||skins[1],shirt:o.shirt||me.top||C['Haw River'],f:pose==='walk'&&blink(T*3,.5,.5),bob:pose==='bob'&&blink(T*2+q[0]*9,.3,.3)})};
    const errand=r=>{const v=mps(1.25),dT=r.L/v;if(t<dT)pp(along(r,t*v),'walk');else if(t>Tt-dT)pp(along(r,(Tt-t)*v),'walk');else pp(along(r,r.L),'sit')};
    let fire=0;
    if(st.kind==='run'||st.kind==='walk'){const s=Math.min(t,Tt-t)*mps(st.kind==='run'?3.1:1.3),shirt=st.kind==='run'?me.runTop:me.top;
      if(s<rOut.L)pp(along(rOut,s),'walk',{shirt});
      else if(street){const d=street.d0+(dayRand(c,5)>.5?1:-1)*(s-rOut.L);if(d>0&&d<street.ch.L){const[x,y,ux,uy]=along(street.ch,d);pp([x-uy*street.off,y+ux*street.off],'walk',{shirt})}}}
    else if(st.kind==='mow'){const v=rMow.L/Math.max(60,Tt-40),d=Math.max(0,Math.min(rMow.L,(t-20)*v)),[x,y,ux,uy]=along(rMow,d);pp([x,y],d>0&&d<rMow.L?'walk':'stand');if(vis(x,y))dyn.push({kind:'mower',gx:x+ux*.75/M,gy:y+uy*.75/M})}
    else if(st.kind==='garden'){const n=beds.length;pp(g(beds[Math.min(n-1,Math.floor(t/(Tt/n)))]),'stand')}
    else if(st.kind==='coffee')errand(rPatio);
    else if(st.kind==='read')errand(rChair);
    else if(st.kind==='fire'){const v=mps(1.25),dT=rChair.L/v;
      if(t<rNear.L/v)pp(along(rNear,t*v),'walk');else if(t<420)pp(g(near),'stand');else if(t>Tt-dT)pp(along(rChair,(Tt-t)*v),'walk');else pp(g(chair(0)),'sit');
      fire=Math.max(0,Math.min(1,(t-150)/240))*Math.max(0,Math.min(1,(Tt-60-t)/300));
      const n=Math.min(st.friends||3,lot.chairs.length-1);let cars=0;
      for(let i=0;i<n;i++){const ta=(12+i*6)*60,tl=Tt-(15-i*3)*60;if(t>ta-60&&t<tl+90)cars=Math.max(cars,n>2?i%2+1:1);if(t>ta+45&&t<tl)pp(g(chair(i+1)),'bob',{skin:skins[(i*2+3)%6],shirt:shirts[(i*3+1)%9]})}
      for(let k=0;k<cars;k++){const q=g([SX+1.3,D.gateOut[1]-6-k*6.2]);if(vis(q[0],q[1]))dyn.push({kind:'car',gx:q[0],gy:q[1],ux:0,uy:1,col:carCols[(k*3+2)%carCols.length],parked:1})}}
    const fp=g([F.x,F.y]);if(vis(fp[0],fp[1]))dyn.push({kind:'firepit',gx:fp[0],gy:fp[1],on:fire,chairs:CH});
    if(DBG)window.__home={kind:st.kind,t,Tt,at,street:street?+street.ch.L.toFixed(1):0};
  }
  return{add}})():null;

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
const touches=new Map();let pinch0=0,pinchZ=0;
cv.addEventListener('pointerdown',timed(e=>{touches.set(e.pointerId,[e.clientX,e.clientY]);if(touches.size===2){const[a,b]=[...touches.values()];pinch0=Math.hypot(a[0]-b[0],a[1]-b[1]);pinchZ=zNow();drag=null;return}if(touches.size>2)return;if(ZG)land();drag={x:e.clientX,y:e.clientY,cx:camX,cy:camY};cv.setPointerCapture(e.pointerId);cv.style.cursor='grabbing'}));
// two fingers: the zoom follows the spread of the fingers and settles on the nearest level when they lift (with reduced
// motion it steps a level at a time, as before)
cv.addEventListener('pointermove',timed(e=>{if(touches.has(e.pointerId))touches.set(e.pointerId,[e.clientX,e.clientY]);if(touches.size===2&&pinch0){const[a,b]=[...touches.values()];const d=Math.hypot(a[0]-b[0],a[1]-b[1]);
  if(!reduce&&started)zoomLive(pinchZ*d/pinch0);else if(d/pinch0>1.4||d/pinch0<.7){zoomBy(d>pinch0?1:-1);pinch0=d;onView()}return}if(!drag)return;const s=W/cv.clientWidth/VS;camX=clampX(drag.cx-(e.clientX-drag.x)*s);camY=clampY(drag.cy-(e.clientY-drag.y)*s);tgtX=camX;tgtY=camY;glide=false;zdir=0;if(reduce)requestAnimationFrame(frame)}));
const toStatic=e=>{const r=cv.getBoundingClientRect();return[((e.clientX-r.left)*W/r.width+Math.round(camX*VS))/VS,((e.clientY-r.top)*H/r.height+Math.round(camY*VS))/VS]};
function pickAt(e){const r=cv.getBoundingClientRect(),qx=(e.clientX-r.left)*W/r.width/LS,qy=(e.clientY-r.top)*H/r.height/LS;for(const g of signRects)if(qx>=g.x-2&&qx<=g.x+g.w+2&&qy>=g.y-2&&qy<=g.y+g.h+2)return{sign:g.id,name:g.name};const[sx,sy]=toStatic(e);for(let i=blds.length-1;i>=0;i--){const b=blds[i];if(!b.hull){ox=BOX;oy=BOY;const z=b.htop||b.hpx;b.hull=hull(b.pts.map(p=>P(p[0],p[1])).concat(b.pts.map(p=>P(p[0],p[1],z))))}if(pip(sx,sy,b.hull))return b}return null}
const endDrag=timed(e=>{if(e)touches.delete(e.pointerId);if(touches.size<2){if(pinch0)zoomSettle();pinch0=0}if(drag&&e&&e.type==='pointerup'&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5){const b=pickAt(e);onPick(b)}if(drag)TB=Math.min(TB,2);drag=null;cv.style.cursor='grab'});cv.addEventListener('pointerup',endDrag);cv.addEventListener('pointercancel',endDrag);
cv.addEventListener('mousemove',timed(e=>{if(drag)return;const b=pickAt(e);if(b!==hoverB){hoverB=b;onHover(b);if(reduce)requestAnimationFrame(frame)}}));cv.addEventListener('mouseleave',()=>{hoverB=null;onHover(null)});

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
  const pnl=[WP(wl,u(-.7),zt+.8*pz,.02),WP(wl,u(cols+.7),zt+.8*pz,.02),WP(wl,u(cols+.7),zt-5.8*pz,.02),WP(wl,u(-.7),zt-5.8*pz,.02)];poly(cx,pnl,'#1d1a1c');
  let k0=0;txt.split('').forEach((ch,i)=>{const g=gl[i],wdt=ws[i];for(let r=0;r<5;r++)for(let k=0;k<wdt;k++){const on=g[r*wdt+k]==='1';
    const ua=u(k0+k+.1),ub=u(k0+k+.9),za=zt-(r+.1)*pz,zb=zt-(r+.9)*pz;poly(cx,[WP(wl,ua,za,.03),WP(wl,ub,za,.03),WP(wl,ub,zb,.03),WP(wl,ua,zb,.03)],on?'#ffb43a':'#33282a')}k0+=wdt+1});
  return pnl}
function signText(cx,wl,z0,txt){
  // bulb matrix at a fixed 2px pitch, centred on the wall and reading left to right on screen
  const A=P(wl.a[0],wl.a[1],0),Q=P(wl.q[0],wl.q[1],0);const flip=Q[0]<A[0];
  const pxPerU=Math.abs(Q[0]-A[0])/1||1;const du=2/pxPerU;const cols=txt.length*4-1;
  const half=cols*du/2;const pad=3*du;
  const u=k=>flip?1-(.5-half+k*du):(.5-half+k*du);
  const pnl=[WP(wl,u(-1.5),z0+1,.02),WP(wl,u(cols+.5),z0+1,.02),WP(wl,u(cols+.5),z0+13,.02),WP(wl,u(-1.5),z0+13,.02)];poly(cx,pnl,'#221c26');
  for(let i=0;i<txt.length;i++){const g=FONT[txt[i]]||FONT[' '];for(let r=0;r<5;r++)for(let k=0;k<3;k++){const on=g[r*3+k]==='1';on?ed(WP(wl,u(i*4+k),z0+11-r*2,.03),BULB,2):ed(WP(wl,u(i*4+k),z0+11-r*2,.03),'#3a2e30')}}
}
// What each building is called on the model: a short form for the landmarks, else its own name, else who is inside it, else its
// street address (all from the model data, see tools/model/names.py). LAB lists them most recognisable first: landmarks, named
// buildings, tenants, addresses, and bigger before smaller within each. Each frame they are laid on in that order, and a label that
// would touch one already down waits for a closer zoom, so the model is never papered over.
const LABELS=[['tower','Lincoln Financial'],['jsb','Jefferson Standard'],['icrc','Civil Rights Museum'],['theatre','Carolina Theatre'],['city','Melvin Municipal'],['depot','Galyon Depot'],['tanger','Tanger Center'],['ballpark','First National Bank Field'],['kress','Kress Building'],[208219206,'Courthouse'],[414240404,'Cultural Center'],[366999616,'Renaissance Plaza'],[411854108,'Public Library']];
const wrapLabel=t=>{if(t.length<=20)return[t];const w=t.split(' ');let best=null;for(let i=1;i<w.length;i++){const a=w.slice(0,i).join(' '),b=w.slice(i).join(' '),m=Math.max(a.length,b.length);if(!best||m<best.m)best={m,a,b}}if(!best)return[t.slice(0,19)+'…'];const cut=x=>x.length>28?x.slice(0,27).trimEnd()+'…':x;return[cut(best.a),cut(best.b)]};
for(const b of blds){const park=b.t==='parking'||b.am==='parking';b.label=b.name||b.tn[0]||b.ad||(park?'Parking deck':'');b.lt=b.name?1:b.tn.length?2:3;b.more=b.name?b.tn.length:Math.max(0,b.tn.length-1)}
for(const[k,t]of LABELS){const b=byId[k];if(b){b.label=t;b.lt=0}}
const LAB=blds.filter(b=>b.label);for(const b of LAB){b.ll=wrapLabel(b.label);b.lsz=b.area*Math.max(8,b.htop||b.hpx)}LAB.sort((a,b)=>a.lt-b.lt||b.lsz-a.lsz);
const LFONT='800 6.5px "Nunito Sans", system-ui, sans-serif',LFONT2='600 6px "Nunito Sans", system-ui, sans-serif';let labW=false;

// ?fps: a small box in the corner with the frame rate, the time between frames, the time in each part of frame()
// (averages over the last half second or so) and what it is running on. Canvas drawing that the browser defers to its
// graphics process is not in the per-part times, only in the time between frames: "outside" is the part of the time
// between frames that was not spent in frame() (the browser's own work, input handlers, and idling until the next frame).
// Below that, the longest frame of the last five seconds, taken apart: the time in frame() by part, in input handlers
// (and, of that, in fit(): sizing the canvases "layers" and styling the stacked elements "place"), the rest, and what
// happened in it (a zoom step, a canvas resized, a blur restyled, tiles drawn, squares shown stretched, a zoom gliding).
// And the last zoom: how many frames the glide had and its longest, how long the frame that landed took, and the
// longest frame in the 0.6 s after it (when the tiles of the new level and the blur's new radius come in).
let fpsEl=null,fpsN=0,fpsT=0,fpsW=null,fpsZ=null;
const fpsWhat=(A,B)=>{const what=[...(A.ev||[]),...(A.evF||[]),...(B.ev||[])];if(A.zg)what.push('gliding at '+A.zg);if(A.nt)what.push(A.nt+' tile'+(A.nt>1?'s':'')+' drawn whole ('+(A.tt||0).toFixed(1)+' ms)');if(A.tw)what.push('tile work '+A.tw.toFixed(1)+' ms');if(A.td)what.push(A.td+' finished');if(A.si)what.push(A.si+' squares stretched');return what.length?what.join(', '):'nothing special'};const PH=['zoom','tiles','sim','dyn','blow','grade','tilt','sign','labels','ahead'];
function fpsBox(){const fr_=BM.frames,now=performance.now(),n=fr_.length;
  if(n>1){const B=fr_[n-1],A=fr_[n-2],iv=B.t-A.t;
    const zs=(A.ev||[]).filter(e=>e.startsWith('zoom '));if(zs.length){if(!fpsZ||fpsZ.land!=null)fpsZ={what:zs[0].slice(5),t0:A.t,n:0,gmax:0,gms:0,land:reduce?iv:null,lin:A.end-A.t,lt:A.t,amax:0,aw:''};else fpsZ.what=fpsZ.what.split('>')[0]+'>'+zs[zs.length-1].split('>')[1]}
    if(fpsZ){const z=fpsZ;if(A.zg){z.n++;z.gmax=Math.max(z.gmax,iv);z.gms=B.t-z.t0}if((A.evF||[]).includes('landed')){z.land=iv;z.lin=A.end-A.t;z.lt=A.t;z.amax=0}else if(z.land!=null&&A.t>z.lt&&A.t-z.lt<600&&iv>z.amax){z.amax=iv;z.aw=fpsWhat(A,B)}}
    if(!fpsW||iv>=fpsW.iv)fpsW={iv,A,B};
    else if(B.t-fpsW.B.t>5000){fpsW={iv,A,B};for(let i=n-2;i>0&&fr_[i].t>B.t-5000;i--)if(fr_[i].t-fr_[i-1].t>fpsW.iv)fpsW={iv:fr_[i].t-fr_[i-1].t,A:fr_[i-1],B:fr_[i]}}}
  if(now-fpsT<500)return;const fs=fr_.slice(fpsN);if(fs.length<2)return;fpsN=fr_.length>3000?(fr_.length=0):fr_.length;fpsT=now;
  if(!fpsEl){fpsEl=document.createElement('pre');fpsEl.style.cssText='position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:6px 8px;background:rgba(0,0,0,.8);color:#9f9;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;pointer-events:none;border-radius:6px;white-space:pre';document.body.appendChild(fpsEl)}
  const iv=fs.slice(1).map((f,i)=>f.t-fs[i].t),span=fs[fs.length-1].t-fs[0].t,avg=k=>fs.reduce((s_,f)=>s_+(f[k]||0),0)/fs.length,sum=k=>fs.reduce((s_,f)=>s_+(f[k]||0),0);
  const out=fs.slice(1).map((f,i)=>f.t-fs[i].end),f1=v=>v.toFixed(1);
  const ua=navigator.userAgent,br=(/Edg\/([\d.]+)/.exec(ua)&&'Edge '+RegExp.$1)||(/Firefox\/([\d.]+)/.exec(ua)&&'Firefox '+RegExp.$1)||(/Chrome\/([\d.]+)/.exec(ua)&&'Chrome '+RegExp.$1)||(/Version\/([\d.]+).*Safari/.exec(ua)&&'Safari '+RegExp.$1)||ua.slice(0,40);
  let mb=sparePx();for(const t of tiles.values())mb+=tilePx(t);
  const cs5=k=>CS.log.filter(e=>e[1]===k&&e[0]>now-5000).length;let twS=0,exS=0,ex0=0,n0=0,n1=0;for(const[,tw,ex]of TS){if(tw>.3){twS+=tw;exS+=ex;n1++}else{ex0+=ex;n0++}}ex0=n0?ex0/n0:0;const exT=Math.max(0,exS-n1*ex0); // extra rest after tile frames, over what frames without tile work show
  let wl='';if(fpsW){const{A,B}=fpsW,inF=A.end-A.t,ph=PH.filter(k=>A[k]>=.05).map(k=>k+' '+f1(A[k])).join(' '),fitH=B.fit||0,fitF=A.fitF||0;
    wl=`worst frame of the last 5 s: ${f1(fpsW.iv)} ms, ${f1((now-B.t)/1000)} s ago = frame() ${f1(inF)} (${ph||'-'}) + handlers ${f1(B.inp||0)} + rest ${f1(Math.max(0,fpsW.iv-inF-(B.inp||0)))}\n`+
      `  fit() in it: ${f1(fitH+fitF)} ms (layers ${f1((B.ml||0)+(A.mlF||0))}, place ${f1((B.pl||0)+(A.plF||0))})   what happened: ${fpsWhat(A,B)}\n`}
  if(fpsZ){const z=fpsZ;wl+=`last zoom ${z.what}: `+(z.n?`glide ${z.n} frames in ${z.gms.toFixed(0)} ms (longest ${f1(z.gmax)})`:reduce?'a jump (reduced motion)':'no glide frame yet')+(z.land!=null?`, the frame that landed ${f1(z.land)} ms (frame() ${f1(z.lin)}), longest in the 0.6 s after ${f1(z.amax)}${z.amax>25?' ('+z.aw+')':''}`:'')+'\n'}
  fpsEl.textContent=`${(1000*(fs.length-1)/span).toFixed(1)} fps   frame ${(span/(fs.length-1)).toFixed(1)} ms (max ${Math.max(...iv).toFixed(0)})   work ${PH.reduce((s_,k)=>s_+avg(k),0).toFixed(1)} ms   outside frame() ${f1(out.reduce((a,b)=>a+b,0)/out.length)} ms (max ${Math.max(...out).toFixed(0)})\n`+
    PH.map(k=>k+' '+avg(k).toFixed(1)).join('  ')+'\n'+
    `input handlers ${f1(sum('inp'))} ms in this half second (longest ${f1(Math.max(...fs.map(f=>f.inp||0)))})   fit() ${f1(sum('fit')+sum('fitF'))} ms (layers ${f1(sum('ml')+sum('mlF'))}, place ${f1(sum('pl')+sum('plF'))})\n`+
    `tiles cut by ${TCLIP?'clip':'card'}${QS.get('tilecut')?' (?tilecut)':''}, ${CS.last.length?f1(CS.last.reduce((a,b)=>a+b,0)/CS.last.length):'-'} cards a tile   drawing ahead ${AHEAD?'on':'OFF (?ahead=0)'}   tile canvases in the last 5 s: ${cs5('made')} made, ${cs5('freed')} freed, ${cs5('reused')} reused (${pool.length} spare)\n`+
    `tile work ${f1(twS)} ms in ${n1} frames of the last 5 s, extra rest after them ${f1(exT)} ms = ${twS>.5?f1(exT/twS):'-'} ms of rest per ms of tile work (${f1(n1?exS/n1:0)} ms extra a frame against ${f1(ex0)} without tile work)   allowance ${f1(TB)} ms${TBFIX?' (pinned, ?tilems)':''}${tbGap?' every '+(tbGap+1)+' frames':''}, ${sum('late')} stalls\n`+wl+
    `moving things ${Math.round(avg('n'))}, cut out ${Math.round(avg('cut'))}   tiles ${tiles.size} (${(mb*4/1048576).toFixed(0)} MB of ${TILE_MB})   glow ${FT.dg?'on':'off'}\n`+
    `${br}   dpr ${window.devicePixelRatio}   canvas ${W}x${H} shown ${cv.clientWidth}x${cv.clientHeight} css   scale ${+VS.toFixed(2)} (${KPX} device px a canvas px)   zoom ${+zNow().toFixed(2)}${ZG?' (on its way to '+ZL[zi]+')':''}\n`+
    `compose: ${LY?'layers':'canvas ('+LYWHY+(HASFILTER?'':'; no canvas filter')+')'}   cut: ${CARD?'card':'clip'}${SOFT?'   (software renderer found)':''}   res: ${PLAN.name} (${PLANWHY}${GV.on?', watching':''})${reduce?'   reduced motion: zoom jumps':''}`}
// The buildings that could stand in front of something at grid box (x0,y0)-(x1,y1): a coarse grid over each building's
// reach (its footprint plus how far its height carries up the screen), so a frame does not scan every building for
// every moving thing. In the buildings' own order, each once.
let BGRID=null,bgStamp=0;const BGC=4,bgOut=[];
function bldsNear(x0,y0,x1,y1){
  if(!BGRID){BGRID=new Map();blds.forEach((b,i)=>{b.bi=i;b.bq=0;for(let cx=Math.floor((b.minx-b.tmax-.5)/BGC);cx<=Math.floor((b.maxx+.05)/BGC);cx++)for(let cy=Math.floor((b.miny-b.tmax-.5)/BGC);cy<=Math.floor((b.maxy+.05)/BGC);cy++){const k=cx*4096+cy;if(!BGRID.has(k))BGRID.set(k,[]);BGRID.get(k).push(b)}})}
  const ax=Math.floor(x0/BGC),bx=Math.floor(x1/BGC),ay=Math.floor(y0/BGC),by=Math.floor(y1/BGC);if(ax===bx&&ay===by)return BGRID.get(ax*4096+ay)||bgOut0;
  bgOut.length=0;bgStamp++;for(let cx=ax;cx<=bx;cx++)for(let cy=ay;cy<=by;cy++){const l=BGRID.get(cx*4096+cy);if(l)for(const b of l)if(b.bq!==bgStamp){b.bq=bgStamp;bgOut.push(b)}}
  return bgOut.sort((a,b)=>a.bi-b.bi)}
const bgOut0=[];
let FT={de:1,dg:1};const glowOn=()=>{useGlow(true);FT.dg=1};
// How long a frame may spend drawing tiles (in the frame, for the view; then ahead, with what is left), and how often.
// Tile drawing costs more than the time measured here: the browser's graphics process does the actual painting
// afterwards, and when it falls behind, the next frame is held up however little the page itself did (Safari: 2 ms of
// tile drawing, 40 to 85 ms of stall). So the allowance follows what tile drawing is seen to cost. For every frame
// the "extra rest" is how much later the next frame started than it should have (given how long frame() itself took).
// After a frame that drew tiles: extra rest of more than half a frame over what frames without tile drawing show
// (tbE0) is a stall and halves the allowance, down to 1.5 ms, and at 1.5 ms spaces tile drawing out instead (every
// 2nd, 4th, up to every 9th frame); no stall gives a quarter millisecond back, up to 12, and halves the spacing.
// The allowance is also kept to what fits in a frame beside the rest of frame()'s work (when that fits at all).
// While a zoom glides only the tiles it lands on are drawn, 2 ms a frame at most, and none after a stall; while the
// pointer is down nothing is drawn ahead; and when a glide lands or a drag ends the allowance starts again from 2 ms.
// TS keeps the last five seconds (tile ms and extra rest per frame) for the readout. ?tilems=N pins the allowance at
// N ms a frame whatever happens (a diagnostic: is a stall a matter of how much is drawn, or of drawing at all?).
const TBFIX=+QS.get('tilems')||0;
let TB=12,tbGap=0,tbSince=99,tbLast=0,tbEnd=0,tbBase=16.7,tbMin=1e9,tbN=0,tbTw=0,tbE0=0;const TS=[];
function tileBudget(now){const iv=now-tbLast,inF=tbEnd-tbLast,tw=tbTw;tbLast=now;tbTw=0;
  if(!reduce&&iv>0)resGov(iv,tw,now);
  if(reduce||!(iv>0&&iv<1000))return TB; // (reduced motion draws frames only when asked, so their spacing says nothing)
  if(iv<tbMin)tbMin=iv;if(++tbN>=90){tbBase=tbMin;tbMin=1e9;tbN=0} // the usual interval: the shortest of the last 90 frames
  const base=Math.min(tbBase,tbMin),extra=Math.max(0,iv-Math.max(1,Math.ceil((inF-1)/base))*base),other=Math.max(0,inF-tw);
  if(tw>.3){const stall=extra>base*.5+tbE0;
    if(stall){if(TB<=1.5)tbGap=Math.min(8,tbGap*2+1);TB=Math.max(1.5,TB/2);if(ZG)ZG.noTiles=true;if(BM)bmF.late=1}
    else{TB=Math.min(12,TB+.25);tbGap>>=1}}
  else tbE0+=(Math.min(extra,2*base)-tbE0)*.1;
  if(BM){TS.push([now,tw,extra]);while(TS[0][0]<now-5000)TS.shift();BM.tw+=tw;if(tw>.3)BM.twLate+=extra;bmF.tb=TB;bmF.ex=extra}
  if(TBFIX)return TB=TBFIX;
  tbSince=tw>.3?0:tbSince+1;if(tbSince<tbGap)return 0;
  return other<base*.5?Math.min(TB,Math.max(1.5,base-other-3)):TB}
let TSG=null,VGR=null,last=0,lastCheck=0,flash=0,hoverB=null,hiB=null,FOGP=null,LS=2;const HASFILTER='filter' in ctx;
function frame(ts){const F0=performance.now();
  if(BM){bmT=performance.now();bmF={t:bmT,fit:tm.fit,inp:tm.inp,ml:tm.ml,pl:tm.pl,ev:evs.splice(0)};tm.fit=tm.inp=tm.ml=tm.pl=0}
  const dt=Math.min(.1,(ts-last)/1000||0);last=ts;if(!reduce)T+=dt;
  if(S.time==='now'&&ts-lastCheck>30000){lastCheck=ts;SUN=sunPos(new Date());if(stateKey()!==renderedFor)renderStatic()}
  const D=sceneDate();
  if(ZG)zoomFrame();const zg=!!ZG;if(LY&&LY.due&&!zg&&--LY.due===0)placeLayers();if(BM){bm('zoom');if(zg)bmF.zg=+ZG.z.toFixed(3)}
  if(glide&&!drag){camX+=(tgtX-camX)*Math.min(1,dt*2);camY+=(tgtY-camY)*Math.min(1,dt*2);if(Math.hypot(tgtX-camX,tgtY-camY)<1)glide=false}
  const cx=Math.round(camX*VS),cy=Math.round(camY*VS);
  // the still model: tiles at the current scale (missing ones now, stale ones a few per frame)
  // FT.de / FT.dg: whether anything is on the lit-window / glow layer so far this frame. While a layer is blank,
  // rubbing out on it, clipping it and laying it on the picture are all skipped; a blank layer is not cleared again.
  if(lampsOn())useGlow(true);
  for(const c of [w,E,GL])c.setTransform(1,0,0,1,0,0);if(FT.de)E.clearRect(0,0,W,H);if(FT.dg)GL.clearRect(0,0,W,H);w.fillStyle='#3a2c26';w.fillRect(0,0,W,H);
  FT={c:w,e:E,g:GL,de:0,dg:0,wide:CARD?1:0,ink:[]};
  frame.stale=false;useNo++;const tb=tileBudget(F0),budget={left:tb},tx0=Math.max(0,Math.floor(cx/TILE)),ty0=Math.max(0,Math.floor(cy/TILE)),tx1=Math.min(Math.ceil(BW*VS/TILE)-1,Math.floor((cx+W-1)/TILE)),ty1=Math.min(Math.ceil(BH*VS/TILE)-1,Math.floor((cy+H-1)/TILE));
  for(let ty=ty0;ty<=ty1;ty++)for(let tx=tx0;tx<=tx1;tx++){const X=tx*TILE-cx,Y=ty*TILE-cy,key=VS+'|'+tx+'|'+ty;let t,si;
    // a missing tile with something to stand in for it is drawn a step at a time within the budget (see standInAt)
    // a zoom on its way: every square from tiles already made, at whatever scale is nearest
    if(zg){if(si=standInAt(tx,ty,true)||partStandIn(tx,ty)){drawStandIn(si,cx,cy);if(BM)bmF.si=(bmF.si||0)+1}continue}
    if(!tiles.has(key)&&(si=standInAt(tx,ty))){const t0=performance.now();t=budget.left>0?work(key,tx,ty,VS,t0+budget.left):null;budget.left-=performance.now()-t0;
      if(!t){drawStandIn(si,cx,cy);frame.stale=true;budget.left=0;if(BM)bmF.si=(bmF.si||0)+1;continue}}
    else t=getTile(tx,ty,budget);
    if(t.ah){t.ah=0;growScr(t.sw,t.sh)}
    if(t.ver!==stver)frame.stale=true;w.drawImage(t.c.canvas,X,Y);if(t.de){FT.de=FT.wide=1;E.drawImage(t.e.canvas,X,Y)}if(t.dg){glowOn();GL.drawImage(t.g.canvas,X,Y)}}
  const nv=nVis=(tx1-tx0+1)*(ty1-ty0+1);keepN=Math.max(32,nv*3+2*(tx1-tx0+ty1-ty0)+16);trimTiles(keepN); // the view, the ring round it and the view at the next level each way
  BT=[VS,0,0,VS,0,0];setT(w,E,GL);TGT=FT;ox=BOX-cx/VS;oy=BOY-cy/VS;
  BM&&bm('tiles');
  const ev=evening(),nt=night(),lamp=lampsOn();const dyn=[];
  const vis=(gx,gy)=>{if(gx<.1||gy<.1||gx>GX-.1||gy>GY-.1)return false;const[x,y]=P(gx,gy);return x>-30&&x<VWm()+30&&y>-40&&y<VHm()+60};
  if(!reduce){stepCrossings(Math.min(dt,.1));stepTraffic(Math.min(dt,.05))}
  for(const c of tcars){let[px,py,ux,uy]=lanePos(c.lane,Math.min(c.s,c.lane.L));if(c.off){let k=Math.max(0,1-c.s/c.off[2]);k=k*k*(3-2*k);px+=c.off[0]*k;py+=c.off[1]*k;if(c.off[3]!=null){const hx=ux+(c.off[3]-ux)*k,hy=uy+(c.off[4]-uy)*k,hl=Math.hypot(hx,hy);if(hl>.2){ux=hx/hl;uy=hy/hl}}if(k<=0)c.off=null}if(!vis(px,py))continue;
    dyn.push({kind:'car',gx:px,gy:py,ux,uy,col:c.col,ty:c.ty,stopped:c.stopped,z:rideZ('road',px,py,ux,uy)})}
  // the lights themselves, and stop signs, at the stop line on the right of each approach
  for(const l of TF.lanes){const lt=light(l);if(!lt&&l.sign!=='stop')continue;const s_=Math.max(0,l.L-Math.min((RW[l.to.cls]/2+4.3)/M,l.L*.45));const[gx,gy,ux,uy]=along(l.ch,s_);const off=(RW[l.c]/2+1.4)/M;const px=gx-uy*off,py=gy+ux*off;if(!vis(px,py))continue;
    dyn.push(lt?{kind:'sig',gx:px,gy:py,lt}:{kind:'stopsign',gx:px,gy:py})}
  for(const p of people){if(!reduce){p.d+=p.dir*p.v*dt;const d0=p.ch.d0||0,d1=p.ch.d1==null?p.ch.L:p.ch.d1;if(p.d>d1||p.d<d0){p.dir=p.d>d1?-1:1;p.d=Math.max(d0,Math.min(d1,p.d))}}if(p.rk>=walkLv)continue;
    const[gx,gy,ux,uy]=along(p.ch,p.d);const off=(RW[p.ch.c]/2+2.0)/M*p.side;const px=gx-uy*off,py=gy+ux*off;if(!vis(px,py))continue;dyn.push({kind:'pp',gx:px,gy:py,skin:p.skin,shirt:p.shirt,f:blink(T*3+p.d,.5,.5),z:rideZ('road',px,py,ux,uy)})}
  if(HD)HD.add(dyn,vis);
  const crowd=(b,n,dx,col)=>{if(!b)return;for(let i=0;i<n;i++)dyn.push({kind:'pp',gx:b.maxx+dx+(i%3)*.12,gy:b.cy-.5+i*.13,skin:skins[i%6],shirt:col||shirts[(i+2)%9],bob:blink(T*2+i,.3,.3)})};
  // crowds only where something is actually on: events at a venue, council in session, open bars after dark
  const crowdAt=(gx,gy,n,col)=>{for(let i=0;i<n;i++)dyn.push({kind:'pp',gx:gx+(i%3)*.12,gy:gy-.5+i*.13,skin:skins[i%6],shirt:col||shirts[(i+2)%9],bob:blink(T*2+i,.3,.3)})};
  for(const k of L.crowds){if(k.evening&&!ev)continue;const b=k.id!=null?byId[k.id]:null;if(b)crowd(b,k.n,.3,k.col);else crowdAt(k.gx,k.gy,k.n,k.col)}
  if(L.council.lit&&byId.city)crowd(byId.city,L.council.inSession?4:2,.4,C.Slate);
  for(const k of L.closures){const[gx,gy,ux,uy]=along(k.ch,k.d);const kind=k.kind==='work'?'cone':'barrel';const n=k.full?3:1;for(let j=-n;j<=n;j++){const o=j*(RW[k.ch.c]/7)/M;dyn.push({kind,gx:gx-uy*o,gy:gy+ux*o})}
    if(k.kind==='crash')dyn.push({kind:'car',gx:gx+ux*.3,gy:gy+uy*.3,ux:uy,uy:-ux,col:C.Brick,stopped:1,haz:1})}
  for(const t of L.trucks){dyn.push({kind:'truck',gx:t.gx,gy:t.gy});for(let i=0;i<5;i++)dyn.push({kind:'pp',gx:t.gx-.35-i*.14,gy:t.gy+.5,skin:skins[(i+2)%6],shirt:shirts[(i+5)%9],f:blink(T+i,.4,.4)})}
  if(!reduce){if(trainD>trainCh.L+14){trainWait-=dt;if(trainWait<=0){trainD=-12;trainWait=12}}else trainD+=dt*2.2}
  for(let k=0;k<7;k++){const d=trainD-k*2.3;if(d<0||d>trainCh.L)continue;const[gx,gy,ux,uy]=along(trainCh,d);if(!vis(gx,gy))continue;dyn.push({kind:'train',gx,gy,ux,uy,eng:k===0,z:rideZ('rail',gx,gy)})}
  for(const x of XING)for(const[gx,gy,ax_,ay_] of x.posts)if(vis(gx,gy))dyn.push({kind:'xing',gx,gy,ax:ax_,ay:ay_,x})
  for(const f of FLAGS)if(vis(f.gx,f.gy))dyn.push(f);
  dyn.sort((a,b)=>(a.gx+a.gy)-(b.gx+b.gy));
  BM&&bm('sim');
  const drawDyn=(o,c)=>{
    const z=o.z||0;
    if(o.kind==='car'){const ty=o.ty||0,hl=CARS[ty][0]/2,sw=.55/M;drawCar(c,o.gx,o.gy,o.ux,o.uy,z,o.col,ty);
      // lights at the corners: headlamps after dark, tail lamps after dark and brighter under braking, hazards at a crash
      const lampAt=(f,sd,col,s)=>ed(P(o.gx+o.ux*f*hl/M-o.uy*sd*sw,o.gy+o.uy*f*hl/M+o.ux*sd*sw,z+1.5),col,s);
      if(lamp&&!o.parked){lampAt(1,1,'#fff4c8',1);lampAt(1,-1,'#fff4c8',1)}if((o.stopped||lamp)&&!o.parked){const tc=o.stopped?'#ff3a2a':'#b8443c';lampAt(-1,1,tc,1);lampAt(-1,-1,tc,1)}
      if(o.haz&&blink(T,.4,.4))for(const f of [1,-1])for(const sd of [1,-1])lampAt(f,sd,'#ffb040',1)}
    else if(o.kind==='flag')drawFlag(c,o,{P,fr,line,SH,T,wind:WIND});
    else if(o.kind==='pp'){const[x,y]=P(o.gx,o.gy,z);person(c,x,y-(o.bob?1:0),o.skin,o.shirt,o.f)}
    else if(o.kind==='mower'){const[x,y]=P(o.gx,o.gy);fr(c,Math.round(x-1),Math.round(y-2),3,2,'#c8372c');fr(c,Math.round(x-1),Math.round(y),3,1,SH)}
    else if(o.kind==='firepit'){const[x,y]=P(o.gx,o.gy),X=Math.round(x),Y=Math.round(y);for(const k of o.chairs){const[a,b]=P(k.p[0],k.p[1]);fr(c,Math.round(a),Math.round(b-2),2,2,k.c)}
      fr(c,X-2,Y-1,5,2,'#8d8377');fr(c,X-1,Y-1,3,1,o.on>0?'#5a2a1a':'#3a3432');
      if(o.on>0){const fl=blink(T*5,.5,.5);fr(c,X-1,Y-3,3,2,'#ff7426');fr(c,X-(fl?1:0),Y-4-(fl?1:0),1,2,'#ffd23f');ed([X+.5,Y-2.5],'#ffb040',2);if(ev)eg(X+.5,Y-2,22*o.on,.5,.6,'255,150,70')}}
    else if(o.kind==='sig'){const[x,y]=P(o.gx,o.gy);const X=Math.round(x),Y=Math.round(y);fr(c,X-1,Y-1,3,1,'#4a4a52');fr(c,X,Y-10,1,10,'#4a4a52');fr(c,X-1,Y-17,3,7,'#24242c');fr(c,X,Y-16,1,1,'#5a2622');fr(c,X,Y-14,1,1,'#5a4a22');fr(c,X,Y-12,1,1,'#1f4a2e');const col={r:'#ff3b2a',y:'#ffc02a',g:'#3ee06a'}[o.lt],z={r:-16,y:-14,g:-12}[o.lt];fr(c,X,Y+z,1,1,col);ed([X+.5,Y+z+.5],col,1);if(lamp)eg(X+.5,Y+z+.5,4,.5,1,o.lt==='r'?'255,80,60':o.lt==='y'?'255,190,60':'80,240,120')}
    else if(o.kind==='stopsign'){const[x,y]=P(o.gx,o.gy);const X=Math.round(x),Y=Math.round(y);fr(c,X,Y-10,1,10,'#8a8a90');fr(c,X-1,Y-14,3,4,'#d22a20');fr(c,X-2,Y-13,5,2,'#d22a20');fr(c,X,Y-13,1,1,'#ffffff')}
    else if(o.kind==='cone'){const[x,y]=P(o.gx,o.gy);fr(c,Math.round(x),Math.round(y-4),1,1,C['Barrel orange']);fr(c,Math.round(x-1),Math.round(y-3),3,2,C['Barrel orange']);fr(c,Math.round(x-1),Math.round(y-2),3,1,C.Paper);fr(c,Math.round(x-2),Math.round(y-1),5,1,C['Barrel orange'])}
    else if(o.kind==='barrel'){const[x,y]=P(o.gx,o.gy);fr(c,Math.round(x-1),Math.round(y-5),3,5,C['Barrel orange']);fr(c,Math.round(x-1),Math.round(y-3),3,1,C.Paper);if(lamp&&blink(T,.5,.5))ed([x,y-6],'#ffb040')}
    else if(o.kind==='truck'){const r=rect(o.gx,o.gy,1,0,6.5/M,2.6/M);drawPrism(c,r,0,10,C.Paper,C.Tobacco);const wq=[P(o.gx-.15,o.gy+1.3/M,4),P(o.gx+.15,o.gy+1.3/M,4),P(o.gx+.15,o.gy+1.3/M,8),P(o.gx-.15,o.gy+1.3/M,8)];poly(c,wq,mix(C['Haw River'],SH,.3));if(ev)eq(wq,GLOW)}
    else if(o.kind==='xing'){const x_=o.x,[x,y]=P(o.gx,o.gy),X=Math.round(x),Y=Math.round(y);
      fr(c,X,Y-13,1,13,'#8a8a90');line(c,[X-2.5,Y-15.5],[X+3.5,Y-10.5],'#f4f1ea',1.2);line(c,[X-2.5,Y-10.5],[X+3.5,Y-15.5],'#f4f1ea',1.2);
      // two red lamps that flash in turn while a train is near
      const fl=x_.on||x_.down>0,a=fl&&blink(T,.45,.45),b=fl&&!a;fr(c,X-2,Y-9,2,2,a?'#ff3b2a':'#5a2a2a');fr(c,X+1,Y-9,2,2,b?'#ff3b2a':'#5a2a2a');
      if(a)ed([X-1,Y-8],'#ff3b2a',2);if(b)ed([X+2,Y-8],'#ff3b2a',2);if(fl&&lamp)eg(X+.5,Y-8,7,.5,1,'255,80,60');
      // the gate arm: upright when clear, across the lane when down
      if(x_.gates){const len=(RW[x_.cl]/2+.6)/M,th=x_.down*Math.PI/2,s_=Math.sin(th),k_=Math.cos(th),lp=len*TW*1.1;const tip=P(o.gx+o.ax*len*s_,o.gy+o.ay*len*s_,4+lp*k_),base=[X+.5,Y-4];
        line(c,base,tip,'#f4f1ea',1.6);c.setLineDash([2,2]);line(c,base,tip,'#d22a20',1.6);c.setLineDash([])}}
    else if(o.kind==='train'){const r=rect(o.gx,o.gy,o.ux,o.uy,19/M,3.4/M);drawPrism(c,r,z+1,12,o.eng?C.Slate:'#c0603c',o.eng?'#33509a':'#8f4228');if(o.eng){const hp=P(o.gx+o.ux*9.6/M,o.gy+o.uy*9.6/M,z+7);ed(hp,'#fff3c0',2);if(lamp)eg(hp[0],hp[1]+3,24,.45,.6)}}
  };
  // Anything with a building, tree, lamp or parked car in front of it is cut out where those stand (see drawCut).
  const DB={xing:[16,30,16,6],sig:[6,21,6,3],stopsign:[6,18,6,3],car:[14,12,14,7],pp:[5,13,6,3],mower:[4,6,4,3],firepit:[26,26,26,16],cone:[4,7,4,2],barrel:[4,9,4,2],truck:[18,28,18,8],train:[34,40,34,16],flag:[4,34,16,4]};
  const sx0=ox-BOX,sy0=oy-BOY,pd=3/VS+1;
  for(const o of dyn){let smp;const oz=o.z||0;if(o.kind==='car'||o.kind==='train'){const r=o.kind==='car'?rect(o.gx,o.gy,o.ux,o.uy,CARS[o.ty||0][0]/M,2/M):rect(o.gx,o.gy,o.ux,o.uy,19/M,3.4/M);smp=r.map(p=>[p[0],p[1],oz]).concat([[o.gx,o.gy,oz]])}else if(o.kind==='truck'){smp=rect(o.gx,o.gy,1,0,6.5/M,2.6/M).map(p=>[p[0],p[1],0])}else smp=[[o.gx,o.gy,oz]];
    // Same choice as before (a cut-out card whenever any building, tree, lamp or parked car stands in front), but only
    // the outlines near the thing are kept, and once one is found the far buildings need no line-of-sight test.
    const[x,y]=P(o.gx,o.gy,oz),d=DB[o.kind]||DB.car,sb=[x-d[0]-sx0-pd,y-d[1]-sy0-pd,x+d[2]-sx0+pd,y+d[3]-sy0+pd];
    const occ=o.kind!=='train'?occludersAt(o.gx,o.gy):[];let any=occ.length>0;const cuts=[];
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const p of smp){if(p[0]<x0)x0=p[0];if(p[0]>x1)x1=p[0];if(p[1]<y0)y0=p[1];if(p[1]>y1)y1=p[1]}
    for(const b of bldsNear(x0,y0,x1,y1)){if(b.minx>x1+b.tmax+.5||b.maxx<x0-.05||b.miny>y1+b.tmax+.5||b.maxy<y0-.05)continue;const near=hitBox(b.sil.box,sb);if(!near&&any)continue;for(const p of smp)if(rayHits(b,p[0],p[1],p[2])){any=true;if(near)cuts.push(b.sil);break}}
    if(any){for(const q of occ)if(hitBox(q.box,sb))cuts.push(q);if(BM){bmF.cut=(bmF.cut||0)+1;bmF.cuts=(bmF.cuts||0)+cuts.length}}
    if(CARD){if(any)drawCut([x-d[0],y-d[1],x+d[2],y+d[3]],()=>drawDyn(o,TGT.c),cuts,{c:w,e:E,g:GL});else drawDyn(o,w);continue}
    // No scratch card: the thing is drawn straight onto the picture, clipped to everything except the outlines that
    // really reach its box (building outlines are tested exactly; wholly behind one, it is not drawn at all).
    const ips=[];let hid=false;
    for(const q of cuts){const iv=invOf(q);if(q.loops){const r_=boxVsLoops(sb,q.loops);if(r_===2){hid=true;break}if(r_)ips.push(iv[0])}else for(let i=0;i<iv.length;i++)if(hitBox(q.pb[i],sb))ips.push(iv[i])}
    if(hid){if(BM)bmF.hid=(bmF.hid||0)+1;continue}
    // The lit-window layer matters to this thing only if it paints there, or something already painted there is under
    // it (rubbed out where the thing covers it); otherwise that layer is left alone, as is the glow layer by day.
    const k=o.kind;let nE=FT.wide||k==='sig'||(k==='car'?lamp||o.stopped||o.haz:k==='barrel'?lamp:k==='truck'?ev:k==='train'&&o.eng);const nG=FT.dg||(lamp&&(k==='sig'||k==='train'));
    if(!nE)for(let i=0,ik=FT.ink;i<ik.length;i+=2)if(ik[i]>x-d[0]-2&&ik[i]<x+d[2]+2&&ik[i+1]>y-d[1]-2&&ik[i+1]<y+d[3]+2){nE=true;break}
    const de0=FT.de;if(!nE)FT.de=0;
    if(ips.length){if(BM)bmF.clip=(bmF.clip||0)+1;for(let i=0;i<3;i++){if(i===1&&!nE||i===2&&!nG)continue;const c=i?i>1?GL:E:w;c.save();c.translate(sx0,sy0);for(const ip of ips)c.clip(ip,'evenodd');c.setTransform(VS,0,0,VS,0,0)}}
    drawDyn(o,w);
    if(ips.length){w.restore();if(nE)E.restore();if(nG)GL.restore()}
    if(!nE)FT.de=de0}
  BM&&bm('dyn');
  // live clocks: Lincoln Financial's bulb sign (time, then temperature) and the depot clock
  // (the depot has no clock face; the tower clock above Lincoln Financial is the town clock)
  for(const t of L.trucks){const[sx,sy]=P(t.gx,t.gy,13);for(let i=0;i<5;i++){const ph=(T*.5+i/5)%1;w.globalAlpha=(1-ph)*.55;w.fillStyle='#f2eee6';w.beginPath();w.arc(sx+ph*10+Math.sin(ph*6+i)*2,sy-ph*26,2+ph*4,0,7);w.fill()}w.globalAlpha=1}
  // leaves and petals blowing off the trees on screen, in the wind's real direction (model pixels)
  {const on=[];for(const o of pts0){if(o.kind!=='tree')continue;const[x,y]=P(o.gx,o.gy);if(x<-20||x>VWm()+20||y<-10||y>VHm()+80)continue;if(o.lkD!==DOY){o.lkD=DOY;o.lk=look(o.sp,DOY,o.seed)}const lk=o.lk;if(!lk.dropping&&!lk.petals)continue;on.push({x,y,hp:o.h*2,rp:o.r*1.9,look:lk})}blowing.step(w,dt,{onScreen:on,wind:WIND,reduce,W:VWm(),H:VHm()})}
  BM&&bm('blow');
  // weather in screen pixels
  w.setTransform(1,0,0,1,0,0);const ps=Math.max(1,Math.round(VS));
  if(S.wx==='rain'){w.fillStyle='rgba(205,215,235,.55)';const slant=20+Math.min(30,L.windMph)*4,nr=Math.round(rain.length*(L.intensity==='light'?.4:L.intensity==='heavy'?1:.7));rain.forEach((r,i)=>{if(i>=nr)return;if(!reduce){r[0]-=dt*slant*ps;r[1]+=dt*300*ps;if(r[1]>H){r[1]=-4;r[0]=Math.random()*W+40}if(r[0]<0)r[0]+=W}w.fillRect(r[0]|0,r[1]|0,ps,4*ps)})}
  if(S.wx==='snow'){w.fillStyle='#ffffff';snow.forEach(s=>{if(!reduce){s[1]+=dt*(14+s[2]*14)*ps;s[0]+=Math.sin(T+s[2]*9)*dt*7*ps;if(s[1]>H){s[1]=-2;s[0]=Math.random()*W}}const z=(s[2]>.6?2:1)*ps;w.fillRect(s[0]|0,s[1]|0,z,z)})}
  if(S.wx==='pollen'){w.fillStyle='#f3e37a';motes.forEach(m=>{if(!reduce){m[0]+=dt*9*ps;m[1]+=Math.sin(T+m[2])*dt*5*ps;if(m[0]>W)m[0]=0}w.fillRect(m[0]|0,m[1]|0,ps,ps)})}
  if(L.fog){if(!FOGP){const f=mk(2,2),g=f.getContext('2d');g.fillStyle='rgba(232,234,238,.10)';g.fillRect(0,0,1,1);g.fillRect(1,1,1,1);FOGP=w.createPattern(f,'repeat')}w.fillStyle=FOGP;w.fillRect(0,0,W,H);w.fillStyle='rgba(232,234,238,.18)';w.fillRect(0,0,W,H)}
  // grade (saturation up in daylight for the painted-model look), done by the graphics card: saturate, multiply, add
  const G=gradeFor(SUN),X=L.cloudy&&S.wx==='clear'?WXG.cloudy:WXG[S.wx];const m=[G.m[0]*X.m[0],G.m[1]*X.m[1],G.m[2]*X.m[2]],a=[G.a[0]+X.a[0],G.a[1]+X.a[1],G.a[2]+X.a[2]],d=Math.min(.6,G.d+X.d);
  const c255=v=>Math.max(0,Math.min(255,Math.round(v))),add=a.map((v,i)=>v+Math.max(0,m[i]-1)*110);
  const mulC=m.some(v=>v<.999)?`rgb(${m.map(v=>c255(Math.min(1,v)*255)).join(',')})`:'',addC=add.some(v=>v>.5)?`rgb(${add.map(c255).join(',')})`:'';let flC='';
  if(L.storm){if(flash<=0&&!reduce&&Math.random()<.003)flash=10;if(flash>0){flC=`rgba(255,255,240,${flash>7?.5:flash/30})`;flash--}}
  if(LY){ // the compositor grades, blurs and stacks: only styles change here, and only when their values do
    const sat=Math.abs(d)>.005?`saturate(${(1-d).toFixed(3)})`:'';if(LY.css.sat!==sat){LY.css.sat=sat;cv.style.filter=sat}
    layerCss(LY.mul,'mul',mulC);layerCss(LY.add,'add',addC);layerCss(LY.flash,'flash',flC);
    if(!FT.dg&&!lampsOn())useGlow(false);
    BM&&bm('grade');
    oc.setTransform(1,0,0,1,0,0);oc.clearRect(0,0,W,H);
  }else{
  ctx.setTransform(1,0,0,1,0,0);ctx.globalCompositeOperation='source-over';
  if(HASFILTER&&Math.abs(d)>.005){ctx.filter=`saturate(${(1-d).toFixed(3)})`;ctx.drawImage(Wc,0,0);ctx.filter='none'}else ctx.drawImage(Wc,0,0);
  if(mulC){ctx.globalCompositeOperation='multiply';ctx.fillStyle=mulC;ctx.fillRect(0,0,W,H)}
  if(addC){ctx.globalCompositeOperation='lighter';ctx.fillStyle=addC;ctx.fillRect(0,0,W,H)}
  ctx.globalCompositeOperation='source-over';
  if(flC){ctx.fillStyle=flC;ctx.fillRect(0,0,W,H)}
  if(FT.de)ctx.drawImage(Ec,0,0);if(FT.dg){ctx.globalCompositeOperation='lighter';ctx.drawImage(Gc,0,0);ctx.globalCompositeOperation='source-over'}
  BM&&bm('grade');
  // tilt-shift: blur the top and bottom bands so it reads as a small model
  if(HASFILTER){const b1=Math.ceil(H*.3)+4,b2=Math.floor(H*.68)-4;tc.clearRect(0,0,W,b1+12);tc.clearRect(0,b2-12,W,H-b2+12);tc.filter=`blur(${(1.6*Math.max(.6,VS)*.8).toFixed(2)}px)`;tc.drawImage(cv,0,0,W,b1,0,0,W,b1);tc.drawImage(cv,0,b2,W,H-b2,0,b2,W,H-b2);tc.filter='none';tc.globalCompositeOperation='destination-in';if(!TSG||TSG.H!==H){TSG=tc.createLinearGradient(0,0,0,H);TSG.addColorStop(0,'rgba(0,0,0,1)');TSG.addColorStop(.3,'rgba(0,0,0,0)');TSG.addColorStop(.68,'rgba(0,0,0,0)');TSG.addColorStop(1,'rgba(0,0,0,1)');TSG.H=H}tc.fillStyle=TSG;tc.fillRect(0,0,W,H);tc.globalCompositeOperation='source-over';
    // the mask is clear between 30% and 68% of the height, so only the two bands are laid on
    const m1=Math.ceil(H*.3)+1,m2=Math.floor(H*.68)-1;ctx.drawImage(Tc,0,0,W,m1,0,0,W,m1);ctx.drawImage(Tc,0,m2,W,H-m2,0,m2,W,H-m2)}
  }
  BM&&bm('tilt');
  // Lincoln Financial's bulb sign (time, then temperature) goes on last, outside the tilt-shift blur, so it stays sharp
  const tw=byId.tower,pnls=[];if(tw&&tw.lantern){const txt=blink(T,5,3)||reduce||L.tempF==null?fmtTime(D):(Math.round(L.tempF)+'°F');oc.setTransform(VS,0,0,VS,0,0);for(const wl of visWalls(tw.lantern))pnls.push(lanternSign(oc,wl,tw.lanternZ,tw.lanternTop,txt));oc.setTransform(1,0,0,1,0,0)}
  if(!VGR||VGR.W!==W||VGR.H!==H){VGR=oc.createRadialGradient(W/2,H/2,H*.45,W/2,H/2,W*.62);VGR.addColorStop(0,'rgba(20,10,30,0)');VGR.addColorStop(1,'rgba(20,10,30,.22)');VGR.W=W;VGR.H=H}
  // layers mode: the vignette is an element under this canvas, so the sign (which the vignette used to cover) gets its share here
  if(!LY){oc.fillStyle=VGR;oc.fillRect(0,0,W,H)}else if(pnls.length){oc.save();oc.setTransform(VS,0,0,VS,0,0);const cp=new Path2D();for(const q of pnls){q.forEach(([x,y],i)=>i?cp.lineTo(x,y):cp.moveTo(x,y));cp.closePath()}oc.clip(cp);oc.setTransform(1,0,0,1,0,0);oc.fillStyle=VGR;oc.fillRect(0,0,W,H);oc.restore()}
  BM&&bm('sign');
  // labels, signposts and the highlight keep a steady size on screen: drawn in label pixels (LS canvas pixels each)
  {const ctx=lx,LS=LSO,kx=lc.width/W,ky=lc.height/H;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,lc.width,lc.height);
  ctx.setTransform(LS,0,0,LS,0,0);const WL=lc.width/LS,HL=lc.height/LS,LP=([x,y])=>[x*VS*kx/LS,y*VS*ky/LS];
  ctx.font=LFONT;ctx.textBaseline='top';
  const tag=(x,y,t)=>{x=Math.round(x);y=Math.round(y);const tw_=Math.ceil(ctx.measureText(t).width)+8;const bx=Math.max(2,Math.min(WL-tw_-2,x-(tw_>>1)));if(y<2||y>HL-14||x<4||x>WL-4)return;ctx.fillStyle=SH;ctx.fillRect(bx+1,y-1,tw_-2,13);ctx.fillRect(bx,y,tw_,11);ctx.fillStyle=C.Paper;ctx.fillRect(bx+1,y,tw_-2,11);ctx.fillStyle=SH;ctx.fillRect(x-1,y+12,3,2);ctx.fillText(t,bx+4,y+2.5)};
  const top=b=>LP(P(b.cx,b.cy,(b.htop||b.hpx)+(b.special==='tower'?10:8)));
  const bub=[];const nb=L.bubbles.length;
  if(nb){const slot=Math.floor(T/7);for(let k=0;k<Math.min(2,nb);k++){const o=L.bubbles[(slot*2+k)%nb];if(!blink(T+k*3.5,6,1))continue;const b=o.id!=null?byId[o.id]:null;bub.push([b?top(b):LP(P(o.gx,o.gy,24)),o.text])}}
  if(S.labels){
    if(!labW){labW=true;
      // a building whose roof is hidden behind a nearer one is not named (the tag would sit on the wrong building); landmarks always are
      const o0=ox,o1=oy;ox=BOX;oy=BOY;for(const b of blds)if(!b.hull){const z=b.htop||b.hpx;b.hull=hull(b.pts.map(p=>P(p[0],p[1])).concat(b.pts.map(p=>P(p[0],p[1],z))))}
      for(const b of LAB){if(!b.lt)continue;const q=P(b.cx,b.cy,b.htop||b.hpx);for(let j=b.i+1;j<blds.length;j++)if(pip(q[0],q[1],blds[j].hull)){b.lhid=1;break}}ox=o0;oy=o1;
      for(const b of LAB){ctx.font=b.lt>1?LFONT2:LFONT;b.lw=Math.ceil(Math.max(...b.ll.map(t=>ctx.measureText(t).width)))+(b.lt>1?6:8)}ctx.font=LFONT}
    // f: label pixels per model pixel. Far out only the landmarks are named; names, then tenants, then addresses join on the way in.
    const f=VS*kx/LS,maxT=f<.3?0:f<.45?1:f<.95?2:3,put=[],said=new Set(),gap=f<.55?5:3;
    for(const b of LAB){if(b.lt>maxT)break;if(b.lhid||said.has(b.label))continue;const[px,py]=top(b),n=b.ll.length,small=b.lt>1,lh=small?7:8,w=b.lw,h=n*lh+3,x=Math.round(px),bx=x-(w>>1),by=Math.round(py)-10-(n-1)*lh;
      if(bx>WL+40||bx+w<-40||by>HL+20||by+h<-20)continue;
      let hit=false;for(const r of put)if(bx<r[0]+r[2]+gap&&bx+w+gap>r[0]&&by<r[1]+r[3]+gap&&by+h+gap>r[1]){hit=true;break}if(hit)continue;
      put.push([bx,by,w,h]);said.add(b.label);
      ctx.fillStyle=SH;ctx.fillRect(bx+1,by-1,w-2,h+2);ctx.fillRect(bx,by,w,h);ctx.fillStyle=b.lt?(small?'#f3e9d2':C.Paper):'#ffe9a8';ctx.fillRect(bx+1,by,w-2,h);ctx.fillStyle=SH;ctx.fillRect(x-1,by+h+1,3,2);
      ctx.font=small?LFONT2:LFONT;ctx.fillStyle=b.lt===3?'#6b5a55':SH;ctx.textAlign='center';b.ll.forEach((t,i)=>ctx.fillText(t,bx+w/2,by+2.5+i*lh));ctx.textAlign='start'}
    ctx.font=LFONT}
  else bub.forEach(([[x,y],t])=>tag(x,y-10,t));
  if(hoverB&&(hoverB.label||hoverB.name)&&!hoverB.sign){const[x,y]=top(hoverB);tag(x,y-10,hoverB.label||hoverB.name)}
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
  ctx.setTransform(1,0,0,1,0,0)}
  if(BM){bm('labels');bmF.n=dyn.length;BM.frames.push(bmF);if(BM.frames.length>4000)BM.frames.splice(0,2000)}
  // a little drawing ahead with what is left of the frame's tile allowance: not while the pointer is down, and while
  // a zoom glides only the tiles it lands on, 2 ms at most, none once tile drawing has stalled a frame of the glide
  if(AHEAD&&!frame.stale&&tb>0&&!drag&&!(zg&&ZG.noTiles)){const left=(zg?Math.min(tb,2):tb)-tbTw;if(left>.5)drawAhead(performance.now()+left,zg)}
  if(BM){bm('ahead');bmF.fitF=tm.fit;bmF.mlF=tm.ml;bmF.plF=tm.pl;tm.fit=tm.ml=tm.pl=0;bmF.evF=evs.splice(0);bmF.end=performance.now();if(FPS)fpsBox()}
  tbEnd=performance.now();
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
  const busy=setActivity(scene);
  if(key!==prevKey||windKey(WIND)!==pw||busy){L.version++;if(started)restatic()}
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
function buildingAt(gx,gy,maxDist=2.2){let best=null,bd=maxDist;for(const b of blds){if(b.deck||gx<b.minx-bd||gx>b.maxx+bd||gy<b.miny-bd||gy>b.maxy+bd)continue;if(pip(gx,gy,b.pts))return b;let d=Infinity;for(let k=0;k<b.pts.length;k++){const[a0,a1]=b.pts[k],[q0,q1]=b.pts[(k+1)%b.pts.length];const dx=q0-a0,dy=q1-a1,L2=dx*dx+dy*dy;const t=L2?Math.max(0,Math.min(1,((gx-a0)*dx+(gy-a1)*dy)/L2)):0;d=Math.min(d,Math.hypot(a0+dx*t-gx,a1+dy*t-gy))}if(d<bd){bd=d;best=b}}return best}
/** Glide the camera to a building and hold it there for a while. */
function lookAt(b){if(!b)return;if(ZG)land();[tgtX,tgtY]=camFor(b);tgtX=clampX(tgtX);tgtY=clampY(tgtY);if(reduce){camX=tgtX;camY=tgtY;requestAnimationFrame(frame)}else glide=true}
let started=false,glide=false;

// ---------- view size and zoom ----------
// The canvas fills whatever box the page gives it. Zoom levels are device pixels per model pixel. Each canvas pixel is
// a whole number (k) of device pixels, so edges stay crisp; the model is drawn at VS = zoom / k canvas pixels per model
// pixel (below 1 when zoomed far out, so the whole of downtown fits).
// How big k has to be is the resolution plan. 'sharp' (the default with a graphics card): one canvas pixel per device
// pixel at every zoom level, until the canvas would pass PLANS.sharp.px pixels (a 4K screen filled edge to edge, say),
// where it halves. 'safe' is what the model did before: no more than 2.6 million canvas pixels and no more than 2
// canvas pixels per model pixel, which on a big window or zoomed right in meant drawing at half or a third of the
// screen's resolution and stretching. Sharp draws up to four times the pixels (nine at the closest zoom), which a
// graphics card does not notice and a weak one might, so a governor watches the frames (resGov): if they come slowly
// under sharp it tries safe, keeps safe only if safe is really faster (and remembers that on this device for a week),
// and otherwise goes back to sharp and stops watching, since the pixels were not what was slow. A software renderer
// and a touch device (less canvas memory) keep the old pixel count. ?res=sharp or ?res=safe pins one; ?res=auto forgets what was remembered and starts over on sharp, watched.
const ZL=[.25,.35,.5,.7,1,1.5,2,3,4,6];let zi=-1,KPX=1;
const COARSE=!!(window.matchMedia&&matchMedia('(pointer:coarse)').matches);
const PLANS={sharp:{name:'sharp',res:6,px:COARSE?2.6e6:6e6},safe:{name:'safe',res:2,px:2.6e6}},RESKEY='gso-res',RESQ=QS.get('res');
let PLAN=PLANS.sharp,PLANWHY='default';const GV={on:true,q:[],a:[],slow:0,trial:0,mSharp:0,t0:0,w0:0};
if(PLANS[RESQ]){PLAN=PLANS[RESQ];PLANWHY='?res';GV.on=false}
else if(RESQ==='auto'){PLANWHY='?res=auto';try{localStorage.removeItem(RESKEY)}catch{}}
else if(SOFT){PLAN=PLANS.safe;PLANWHY='software renderer';GV.on=false}
else try{const m=JSON.parse(localStorage.getItem(RESKEY)||'null');if(m&&m.plan==='safe'&&Date.now()-m.t<7*864e5){PLAN=PLANS.safe;PLANWHY='sharp was slow here on '+new Date(m.t).toLocaleDateString();GV.on=false}}catch{}
const dev=geo;
function planFor(z,dw,dh,P=PLAN){let k=1;while(z/k>P.res+1e-9||(dw/k)*(dh/k)>P.px)k++;return{k,vs:z/k}}
function setPlan(name,why){PLAN=PLANS[name];PLANWHY=why;ev('res '+name);fit(true)}
// The governor. iv: the time since the last frame; tw: the tile drawing done in it. It takes the middle frame time of 120 frames at rest
// or dragging, or four seconds' worth when they come that slowly (not a zoom on its way, not a frame that drew tiles:
// those are paced by the tile allowance; but when tiles are being drawn for fifteen seconds on end, every frame counts).
// Slow is under about 48 frames a second (so a 120 Hz screen held at 60 is not noticed). Two slow windows running under sharp: try safe.
// Safe's first window is thrown away (the canvas has just changed size and its tiles are new), the second decides.
function resGov(iv,tw,now){if(!GV.on||ZG||document.hidden||!started)return;if(!GV.t0)GV.t0=now;if(now-GV.t0<3000)return;
  const{dw,dh}=dev(),z=ZL[zi];if(planFor(z,dw,dh,PLANS.sharp).k===planFor(z,dw,dh,PLANS.safe).k){GV.q.length=GV.a.length=0;return} // the two plans agree here: nothing to learn
  if(!GV.a.length)GV.w0=now-iv;GV.a.push(iv);if(tw<=.3)GV.q.push(iv);
  const q=GV.q.length>=120||GV.q.length>=4&&now-GV.w0>=4000;if(!q&&now-GV.w0<15000)return;
  const l=(q?GV.q:GV.a).sort((x,y)=>x-y),m=l[l.length>>1];GV.q.length=GV.a.length=0;
  if(PLAN===PLANS.sharp){if(m>21){if(++GV.slow>=2){GV.slow=0;GV.mSharp=m;GV.trial=1;setPlan('safe','trying: sharp ran at '+m.toFixed(1)+' ms a frame')}}else GV.slow=0;return}
  if(GV.trial++<2)return;GV.on=false;
  if(m<GV.mSharp*.8){PLANWHY='sharp ran at '+GV.mSharp.toFixed(1)+' ms a frame, safe at '+m.toFixed(1);try{localStorage.setItem(RESKEY,JSON.stringify({plan:'safe',t:Date.now(),sharp:+GV.mSharp.toFixed(1),safe:+m.toFixed(1)}))}catch{}}
  else setPlan('sharp','safe was no faster ('+m.toFixed(1)+' ms a frame against '+GV.mSharp.toFixed(1)+')')}
// zoom out until the whole model is in view, and in until about 160 model pixels fill the width
const zoomAllowed=(i,dw,dh)=>i>=0&&i<ZL.length&&dw/ZL[i]>=160&&(i>=zi||BW*ZL[i+1]>dw*.92||BH*ZL[i+1]>dh*.92);
function fit(force,cam){const F0=DIAG?performance.now():0;fit0(force,cam);if(DIAG)tm.fit+=performance.now()-F0}
function fit0(force,cam){const{r,dpr,dw,dh}=dev();if(!r.width||!r.height)return;placeLayers(null,!!(cam||ZG||LY&&LY.due));
  if(zi<0){const zq=+new URLSearchParams(location.search).get('z');const want=zq>0?zq:r.width<700?Math.max(1,dpr*.8):Math.max(1,Math.round(dw/1000));zi=ZL.reduce((bi,v,i)=>Math.abs(v-want)<Math.abs(ZL[bi]-want)?i:bi,0)}
  while(zi>0&&dw/ZL[zi]<160)zi--;
  const{k,vs}=planFor(ZL[zi],dw,dh);const nW=Math.ceil(dw/k),nH=Math.ceil(dh/k),R=ZG?ZG.rest:{W,H,vs:VS};if(!force&&nW===R.W&&nH===R.H&&vs===R.vs)return;
  ZG=null; // the box changed size while a zoom was on its way: it lands here
  const mx=camX+VWm()/2,my=camY+VHm()/2;W=nW;H=nH;VS=vs;KPX=k;LS=Math.max(1,Math.round(dpr*2))/k;
  // the label canvas is as big as the screen, so it only changes with the box, never with a zoom step
  {const j=Math.max(1,Math.ceil(Math.sqrt(dw*dh/6e6))),lw=Math.ceil(dw/j),lh=Math.ceil(dh/j),ir=j>1?'auto':'';if(lc.width!==lw||lc.height!==lh){lc.width=lw;lc.height=lh;ev('labels '+lw+'x'+lh)}if(lc.style.imageRendering!==ir)lc.style.imageRendering=ir;LSO=Math.max(1,Math.round(dpr*2))/j}
  // a zoom landing here restyles the blur and the vignette a few frames later (see frame()), not in the frame that lands
  makeLayers();if(cam&&LY){placeLayers(null,true);LY.due=3}else placeLayers();reseed();if(cam){camX=cam[0];camY=cam[1]}else{camX=clampX(mx-VWm()/2);camY=clampY(my-VHm()/2)}tgtX=camX;tgtY=camY;glide=false;
  if(started&&reduce)requestAnimationFrame(frame)}
// ---------- zooming ----------
// The zoom rests on the levels in ZL, as ever, but gets from one to the next in a short glide (ZDUR ms, easing out)
// about the middle of the view, rather than in one jump. While it glides the picture is drawn at the in-between scale
// from tiles already made (the level it left, or the one it is going to if that was drawn ahead), stretched to fit, and
// no tile is made at an in-between scale; cars, people, labels and the sign are drawn at that scale like any frame, so
// everything stays in register. Drawing ahead works on the tiles it will land on. Nothing is resized or restyled when
// a step starts or while it glides: a canvas changes size (when the level needs it) in the frame that lands, and the
// tilt-shift blur takes the new level's radius three frames after that, so the costs never fall in the same frame. A pinch (two fingers, or a trackpad)
// drives the scale directly and settles on the nearest level when it ends. With reduced motion it jumps, as before.
// ZG while a zoom is on its way: z the scale now (device pixels per model pixel), c the middle of the view in model
// pixels, rest where it lands (level, canvas size, scale, camera: worked out a level at a time exactly as a jump would).
let ZG=null,pinchT=0;const ZDUR=180;
const zNow=()=>ZG?ZG.z:ZL[zi];
const clampIn=(v,B,vw)=>B<=vw?(B-vw)/2:Math.max(0,Math.min(B-vw,v));
function restFor(i,from){const{dw,dh}=dev(),{k,vs}=planFor(ZL[i],dw,dh),nW=Math.ceil(dw/k),nH=Math.ceil(dh/k),vw=nW/vs,vh=nH/vs;
  return{i,k,vs,W:nW,H:nH,vw,vh,camX:clampIn(from.camX+from.vw/2-vw/2,BW,vw),camY:clampIn(from.camY+from.vh/2-vh/2,BH,vh)}}
function zoomStart(){if(!ZG){ZG={z:ZL[zi],live:false,rest:{i:zi,k:KPX,vs:VS,W,H,vw:VWm(),vh:VHm(),camX,camY},c:[camX+VWm()/2,camY+VHm()/2]};glide=false;if(drag){drag=null;cv.style.cursor='grab'}}return ZG}
function zoomStep(g,i){ev('zoom '+ZL[zi]+'>'+ZL[i]);zdir=Math.sign(i-zi);g.rest=restFor(i,g.rest);zi=i}
function zoomGlide(g){g.live=false;g.z0=g.z;g.z1=ZL[zi];g.c0=g.c;g.c1=[g.rest.camX+g.rest.vw/2,g.rest.camY+g.rest.vh/2];g.t0=performance.now()-8}
function land(){const r=ZG.rest;ZG=null;ev('landed');TB=Math.min(TB,2);fit(true,[r.camX,r.camY])}
// each frame of a zoom on its way: the scale and the camera for this frame, or the landing
function zoomFrame(){const g=ZG;
  if(!g.live){const p=(performance.now()-g.t0)/ZDUR;if(p>=1)return land();const e=1-Math.pow(1-Math.max(0,p),3);g.z=g.z0*Math.pow(g.z1/g.z0,e);g.c=[g.c0[0]+(g.c1[0]-g.c0[0])*e,g.c0[1]+(g.c1[1]-g.c0[1])*e]}
  VS=g.z/KPX;camX=clampX(g.c[0]-VWm()/2);camY=clampY(g.c[1]-VHm()/2);tgtX=camX;tgtY=camY}
function zoomBy(d){const{dw,dh}=dev();if(!zoomAllowed(zi+d,dw,dh))return false;
  if(reduce||!started){ev('zoom '+ZL[zi]+'>'+ZL[zi+d]);zdir=d;zi+=d;fit(true);return true}
  const g=zoomStart();zoomStep(g,zi+d);zoomGlide(g);return true}
// a pinch: the scale follows the fingers between the furthest levels allowed, and the level it will settle on (the nearest,
// with a little stickiness so it does not flicker between two) is kept up to date for the buttons and for drawing ahead
function zoomLive(z){const{dw,dh}=dev(),out=i=>i>=0&&dw/ZL[i]>=160&&(BW*ZL[i+1]>dw*.92||BH*ZL[i+1]>dh*.92);
  let lo=zi,hi=zi;while(out(lo-1))lo--;while(hi+1<ZL.length&&dw/ZL[hi+1]>=160)hi++;
  const g=zoomStart();g.live=true;g.z=Math.max(ZL[lo],Math.min(ZL[hi],z));const far=i=>Math.abs(Math.log(ZL[i]/g.z));
  let n=zi;for(let i=lo;i<=hi;i++)if(far(i)<far(n)-(n===zi?.06:0))n=i;
  if(n!==zi){while(zi!==n)zoomStep(g,zi+Math.sign(n-zi));onView()}} // (the blur is restyled once, when it settles)
function zoomSettle(){clearTimeout(pinchT);pinchT=0;if(ZG&&ZG.live)zoomGlide(ZG)}
const canZoom=d=>{const{dw,dh}=dev();return zoomAllowed(zi+d,dw,dh)};
new ResizeObserver(timed(()=>{GEO=null;fit()})).observe(cv);fit();
// The wheel steps a level for each notch (or 60 pixels of a two-finger scroll). A trackpad pinch arrives as small wheel
// moves with ctrl held (Chrome, Firefox, Edge) or as gesture events (Safari): the zoom follows it, see zoomLive.
let wheelAcc=0,gest0=0,gestZ=0;
cv.addEventListener('wheel',timed(e=>{e.preventDefault();
  if(e.ctrlKey&&!e.deltaMode&&Math.abs(e.deltaY)<40&&!reduce&&started){zoomLive(zNow()*Math.exp(-e.deltaY/100));clearTimeout(pinchT);pinchT=setTimeout(zoomSettle,140);return}
  wheelAcc+=e.deltaY;if(Math.abs(wheelAcc)>=60){zoomBy(wheelAcc<0?1:-1);wheelAcc=0;onView()}}),{passive:false});
cv.addEventListener('gesturestart',timed(e=>{e.preventDefault();gest0=touches.size>=2?0:e.scale||1;gestZ=zNow()}));
cv.addEventListener('gesturechange',timed(e=>{e.preventDefault();if(!gest0||touches.size>=2||!(e.scale>0))return;const q=e.scale/gest0;
  if(!reduce&&started)zoomLive(gestZ*q);else if(q>1.4||q<.7){zoomBy(q>1?1:-1);gest0=e.scale;onView()}}));
cv.addEventListener('gestureend',timed(e=>{e.preventDefault();if(gest0){gest0=0;zoomSettle()}}));
cv.addEventListener('keydown',timed(e=>{const k=e.key;if(ZG&&/^Arrow/.test(k))land();const st=80/VS/KPX;let dx=0,dy=0;if(k==='ArrowLeft')dx=-st;else if(k==='ArrowRight')dx=st;else if(k==='ArrowUp')dy=-st;else if(k==='ArrowDown')dy=st;else if(k==='+'||k==='=')zoomBy(1),onView();else if(k==='-'||k==='_')zoomBy(-1),onView();else return;e.preventDefault();if(dx||dy){zdir=0;camX=clampX(camX+dx);camY=clampY(camY+dy);tgtX=camX;tgtY=camY;glide=false;if(reduce)requestAnimationFrame(frame)}}));
/** Pan by a fraction of the view (for on-screen buttons). */
function pan(fx,fy){if(ZG)land();tgtX=clampX(camX+fx*VWm());tgtY=clampY(camY+fy*VHm());if(reduce){camX=tgtX;camY=tgtY;requestAnimationFrame(frame)}else glide=true}
function home(){lookAt(byId.tower||blds[0])}
function lookHome(){if(byId.home)lookAt(byId.home)}
// first paint: a loading card, then build the model
ctx.fillStyle='#3a2c26';ctx.fillRect(0,0,W,H);ctx.fillStyle='#fff3d6';ctx.font=Math.round(10*LS)+'px Silkscreen, monospace';ctx.textAlign='center';ctx.fillText('building the model of downtown…',W/2,H/2);ctx.textAlign='start';
setTimeout(()=>{renderStatic();started=true;(document.fonts?document.fonts.ready:Promise.resolve()).then(()=>requestAnimationFrame(frame))},30);
return{update,building,buildingAt,lookAt,sunTimes,fmtTime,ampm,setLabels:v=>{S.labels=!!v;if(reduce)requestAnimationFrame(frame)},
  zoomIn:timed(()=>zoomBy(1)),zoomOut:timed(()=>zoomBy(-1)),canZoom,pan:timed((fx,fy)=>pan(fx,fy)),home,lookHome,highlight:b=>{hiB=b||null;if(reduce)requestAnimationFrame(frame)}};
}
