import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PressToolCollider,pressNormalCorrection,createPressToolQuery} from '../../src/engine/press-contact.ts';
import {PRESS_TOOLS} from '../../src/studio/press-settings.ts';
const collider=(tool,toolScale=1,angle=0)=>new PressToolCollider({tool,toolScale,angle});
const near=(actual,expected,tolerance=1e-10)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const vector=(actual,expected,tolerance=1e-10)=>actual.forEach((v,i)=>near(v,expected[i],tolerance));
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);

test('closed flat tools distinguish their bottom, side, bevel and top',()=>{
  const round=collider('round');
  for(const [p,d,n] of [[[0,-.01,0],.01,[0,-1,0]],[[.1,.01,0],.014,[1,0,0]],[[0,.1,0],.074,[0,1,0]]]){const q=round.sample(p,0);near(q.distance,d);vector(q.normal,n);}
  near(round.sample([.084,.0235,0],0).distance,0);
  const wide=collider('wide'),q=wide.sample([.162,.037,.142],0);
  vector(q.closest,[.142,.027,.112]);near(q.distance,Math.hypot(.02,.01,.03));
  const inside=collider('square').sample([.079,.016,0],0);near(inside.distance,-.001);vector(inside.normal,[1,0,0]);
});
test('sphere, cone, wedge and cylinder return their analytical outward normals',()=>{
  const cases=[['ball',[.0528,.0176,0],[.6,-.8,0]],['bead',[.0216,.0072,.05],[.6,-.8,0]],
    ['cone',[.02,.019,0],[.95/Math.hypot(.95,1),-1/Math.hypot(.95,1),0]],
    ['wedge',[.02,.022,.05],[1.1/Math.hypot(1.1,1),-1/Math.hypot(1.1,1),0]]];
  for(const [tool,surface,normal] of cases){const p=surface.map((v,i)=>v+.003*normal[i]),q=collider(tool).sample(p,0);near(q.distance,.003);vector(q.closest,surface);vector(q.normal,normal);}
  const cap=collider('bead').sample([0,.036,.2],0);near(cap.distance,.045);vector(cap.normal,[0,0,1]);
});
test('ring bore, disjoint tips and cross reentrant corners retain their empty space',()=>{
  const ring=collider('ring').sample([0,.02,0],0);near(ring.distance,.051);near(ring.closest[1],.02);
  near(collider('ring').sample([.07,.0175,0],0).distance,-.0175);
  const four=collider('four-point');near(four.sample([-.068,-.005,-.068],0).distance,.005);assert.ok(four.sample([0,.02,0],0).distance>.06);
  const cross=collider('cross').sample([.026,.017,.026],0);near(cross.distance,-Math.SQRT2*.001);vector(cross.closest,[.027,.017,.027]);vector(cross.normal,[Math.SQRT1_2,0,Math.SQRT1_2]);
  assert.ok(collider('cross').sample([.03,.017,.03],0).distance>0);
});
test('all twelve closed shapes obey rotation, scaling, translation and distance identities',()=>{
  let state=0x39a0bc;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/2**32;};
  const angle=37*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),scale=1.3,ram=.413;
  const rotate=p=>[c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2]];
  for(const {id} of PRESS_TOOLS){const base=collider(id),changed=collider(id,scale,37),out=createPressToolQuery();
    for(let i=0;i<150;i++){
      const p=Array.from({length:3},()=>random()*.4-.2),q=base.sample(p,0),rp=rotate(p).map((v,k)=>v*scale+(k===1?ram:0));
      assert.equal(changed.sample(rp,ram,out),out);near(out.distance,q.distance*scale);vector(out.normal,rotate(q.normal));vector(out.closest,rotate(q.closest).map((v,k)=>v*scale+(k===1?ram:0)));
      near(Math.hypot(...q.normal),1);near(base.sample(q.closest,0).distance,0);
      const p2=p.map(v=>v+.005*(random()-.5)),q2=base.sample(p2,0);
      assert.ok(Math.abs(q.distance-q2.distance)<=Math.hypot(...p.map((v,k)=>v-p2[k]))+1e-10);
      if(Math.abs(q.distance)>.002){const h=1e-7,gradient=p.map((v,k)=>{const a=[...p],b=[...p];a[k]+=h;b[k]-=h;return (base.sample(a,0).distance-base.sample(b,0).distance)/(2*h);});vector(gradient,q.normal,2e-6);}
    }
  }
});
test('continuous casts find crossings with two clear endpoints and moving ram contact',()=>{
  const square=collider('square'),hit=square.sweep([.3,.01,0],[-.3,.01,0],0,0,.002);
  assert.equal(hit.status,'hit');near(hit.time,(.3-.082)/.6,5e-9);assert.ok(Math.abs(hit.contact.distance-.002)<=1e-9);
  const moving=collider('round').sweep([0,0,0],[0,0,0],.12,-.1,.002);assert.equal(moving.status,'hit');near(moving.time,(.12-.002)/.22,1e-8);vector(moving.contact.normal,[0,-1,0]);
  const relative=collider('round').sweep([0,-.12,0],[0,.1,0],0,0,.002);near(relative.time,moving.time);
});
test('casts preserve holes, finite tool height and explicit exhaustion',()=>{
  for(const tool of ['ring','four-point'])assert.equal(collider(tool).sweep([0,-.2,0],[0,.2,0],0,0,.002).status,'miss');
  assert.equal(collider('round').sweep([0,.2,0],[.1,.2,0],0,0,.002).status,'miss');
  const exhausted=collider('square').sweep([.3,.01,0],[-.3,.01,0],0,0,.002,{maxQueries:1});assert.equal(exhausted.status,'unresolved');assert.equal(exhausted.time,0);
  const tangent=collider('ball').sweep([-.2,-.002,0],[.2,-.002,0],0,0,.002);assert.equal(tangent.status,'hit');assert.ok(tangent.queries<=32);assert.ok(tangent.time<=.5+1e-6);
  const overlap=collider('square').sweep([0,.01,0],[0,.01,0],0,0,.002);assert.equal(overlap.status,'hit');assert.ok(overlap.initialOverlap);
});
test('normal correction includes the guided ram effective mass and lateral sheet motion',()=>{
  const n=[.6,-.8,0],q={distance:-.002,closest:[0,0,0],normal:n,part:0},r=.001,w=2,ram=.3;
  const correction=pressNormalCorrection(q,r,w,ram);assert.ok(correction.resolvable);assert.ok(correction.particleDelta[0]>0&&correction.particleDelta[1]<0&&correction.ramDelta>0);
  near(dot(n,correction.particleDelta)-n[1]*correction.ramDelta,.003);
  near(correction.particleDelta[1]/w+correction.ramDelta/ram,0);
  const guided=pressNormalCorrection({...q,normal:[1,0,0]},r,0,1);assert.equal(guided.resolvable,false);
  const fixedTool=pressNormalCorrection(q,r,2,0);vector(fixedTool.particleDelta,n.map(v=>v*.003));assert.equal(fixedTool.ramDelta,0);
  const lateral=pressNormalCorrection({...q,normal:[1,0,0]},r,1e-300,1e300);assert.ok(lateral.resolvable);vector(lateral.particleDelta,[.003,0,0]);assert.equal(lateral.ramDelta,0);
  const tinyY=pressNormalCorrection({...q,normal:[1,1e-200,0]},r,1,1e300);assert.ok(tinyY.resolvable);near(tinyY.particleDelta[0],.003);assert.ok(tinyY.ramDelta<0&&Number.isFinite(tinyY.ramDelta));
});
test('invalid geometry and query requests fail without changing a caller-owned result',()=>{
  for(const p of [{tool:'missing',toolScale:1,angle:0},{tool:'ball',toolScale:0,angle:0},{tool:'ball',toolScale:1,angle:NaN}])assert.throws(()=>new PressToolCollider(p));
  const c=collider('ball'),out=c.sample([0,-.1,0],0),saved=structuredClone(out);
  assert.throws(()=>c.sample([0,NaN,0],0,out));assert.deepEqual(out,saved);
  assert.throws(()=>c.sweep([0,0,0],[0,0,0],0,0,-1));assert.throws(()=>c.sweep([0,0,0],[0,0,0],0,0,0,{maxQueries:0}));
  assert.throws(()=>pressNormalCorrection({...saved,normal:[0,0,0]},0,1,1));
});

test('compound tools resolve retained oblique and moving-ram exhaustion cases',()=>{
  const witnesses=[{"tool":"ring","scale":0.65,"angle":0,"start":[0.3354716166812425,0.2525890694389098,-0.15857145940491785],"end":[-0.2701709226801856,0.13816282031738647,0.21118832879353044],"ramStart":0.213,"ramEnd":0.213,"radius":0.012},{"tool":"ring","scale":0.65,"angle":0,"start":[-0.19804847175092744,0.5207244301550498,-0.16080643632892028],"end":[0.2018134237529579,0.048653343259095566,0.02776520823572254],"ramStart":0.213,"ramEnd":0.30764731966145337,"radius":0},{"tool":"cross","scale":0.65,"angle":0,"start":[-0.2423599957567,-0.004967479883216663,0.22216376748276673],"end":[0.2989924435582304,0.4322761087573509,-0.32672331397413074],"ramStart":0.213,"ramEnd":0.227773828163743,"radius":0.012},{"tool":"cross","scale":1,"angle":90,"start":[0.6267507478467877,0.5909207814672203,-0.08077664717219832],"end":[-0.40505307992582584,-0.10684266167429521,0.026885040003136434],"ramStart":0.213,"ramEnd":0.213,"radius":0},{"tool":"four-point","scale":1.3,"angle":37,"start":[0.5118651226130824,0.14232227654832727,-0.21639935122975154],"end":[-0.8271773751748723,0.3803833293435792,0.5761409783546351],"ramStart":0.213,"ramEnd":0.213,"radius":0.001}];
  for(const w of witnesses){const hit=collider(w.tool,w.scale,w.angle).sweep(w.start,w.end,w.ramStart,w.ramEnd,w.radius);assert.equal(hit.status,'hit',JSON.stringify(w));assert.ok(hit.queries<128);assert.ok(Math.abs(hit.contact.distance-w.radius)<=1e-9);}
});
