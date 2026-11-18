// Released glass fragments as Box3D rigid bodies (src/studio/material-labs/glass-fragments.ts): a fragment at rest
// carries its weight, fragments do not sink into each other, the rig, the clamp pads, the glass still held in the frame or
// the pendulum's bob, a fragment leaves the plate with the plate's momentum, and the bob and the fragments exchange angular
// momentum about the pivot. Run: node --import ./scripts/register-typescript.mjs --test tests/studio/glass-fragments.test.mjs
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {NativeWorldPool}=await import('../../src/engine/native-world.ts');
const {GlassFragmentWorld,fragmentContact,rigColliders,padColliders,tilePrism,depthInPrism,rotateVector,COLLISION_THICKNESS}=await import('../../src/studio/material-labs/glass-fragments.ts');
const {GlassModel}=await import('../../src/studio/material-labs/glass-si.ts');
const {GLASS_RIG,glassBobPosition}=await import('../../src/studio/material-labs/glass-rig.ts');
const {LABS,normalizeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const {contactPair}=await import('../../src/engine/materials.ts');
const artifact=resolve('public/box3d'),{default:factory}=await import(pathToFileURL(resolve(artifact,'box3d.js')));
const pool=new NativeWorldPool(await factory({wasmBinary:await readFile(resolve(artifact,'box3d.wasm'))}));
const DT=1/120,G=9.81,preset=id=>normalizeSettings('glass',{...LABS.glass.defaults,...LABS.glass.experiments.find(e=>e.id===id).settings});

/** One 0.1 m square tile of 8 mm soda-lime glass, as the lab releases it, turned to lie flat (its normal along y). */
function tile(center,thickness=.008){
  const h=.05,mass=2500*thickness*.01,I=mass/12;
  return {mass,center,velocity:[0,0,0],angularVelocity:[0,0,0],inertia:[I*(.01+thickness**2),I*(.01+thickness**2),I*.02,0,0,0],
    tiles:[Float64Array.from([-h,-h,0,h,-h,0,h,h,0,-h,h,0])],thickness,rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2]};
}

test('contact values come from the material library: glass on glass, glass on steel',()=>{
  const c=fragmentContact(),gg=contactPair('soda-lime-glass','soda-lime-glass'),gs=contactPair('soda-lime-glass','structural-steel-s355');
  assert.equal(c.glass.friction,gg.friction);assert.equal(gg.friction,.95);assert.equal(gs.friction,.6);assert.equal(gs.restitution,.71);
  // Box3D mixes friction as sqrt(f_a f_b) and restitution as max(e_a, e_b).
  assert.ok(Math.abs(Math.sqrt(c.glass.friction*c.rig.friction)-gs.friction)<1e-12);assert.equal(Math.max(c.glass.restitution,c.rig.restitution),gs.restitution);
});

test('a fragment lying on the floor carries its weight, at rest, with a bounded overlap',()=>{
  const world=new GlassFragmentWorld(pool,.008);
  try{
    // Flat, 5 cm above the floor, beside the rig.
    const f=tile([0,.06,1.5]),k=world.add(f);let force=0,samples=0;
    for(let i=0;i<240;i++){world.step(DT);if(i>=180){force+=world.normalForce(DT);samples++;}}
    const s=world.state(k),weight=f.mass*G;force/=samples;
    console.log(`# resting tile: normal force ${force.toFixed(5)} N against m g ${weight.toFixed(5)} N (${((force/weight-1)*100).toFixed(3)} %), height ${s.position[1].toFixed(5)} m, speed ${Math.hypot(...s.linearVelocity).toExponential(1)} m/s, deepest overlap ${(world.deepest*1000).toFixed(2)} mm`);
    assert.ok(Math.abs(force/weight-1)<1e-4,'the floor carries the weight');
    assert.ok(Math.hypot(...s.linearVelocity)<1e-3,'at rest');
    assert.ok(Math.abs(s.position[1]-COLLISION_THICKNESS/2)<.003,'lies on the floor (its 16 mm collision hull)');
    // A tile on another tile: the floor carries both.
    const top=world.add(tile([0,.04,1.5]));let both=0;samples=0;
    for(let i=0;i<240;i++){world.step(DT);if(i>=180){both+=world.normalForce(DT);samples++;}}
    both/=samples;const lower=world.state(k).position[1],upper=world.state(top).position[1];
    console.log(`# two stacked tiles: normal force ${both.toFixed(5)} N (contacts tile-floor and tile-tile) against 3 m g ${(3*weight).toFixed(5)} N; gap ${((upper-lower)*1000).toFixed(2)} mm`);
    // Sum of the normal impulses of all contacts: tile on floor (2 m g) plus tile on tile (m g).
    assert.ok(Math.abs(both/(3*weight)-1)<5e-4);assert.ok(Math.abs(upper-lower-COLLISION_THICKNESS)<.003,'stacked, not sunk');
  }finally{world.destroy();}
});

test('the bob and a fragment exchange angular momentum about the pivot (no gravity)',()=>{
  const world=new GlassFragmentWorld(pool,.008),r=GLASS_RIG,mass=50,I=mass*(r.pendulumLength**2+r.bobOffsetZ**2+.4*r.bobRadius**2);
  try{
    world.world.setGravity(0,0,0);
    // A 0.1 m tile of the pane at rest where the bob passes, and the bob coming at 4.6 m/s.
    let angle=.15,speed=-2.4;world.addBob(mass,r.bobRadius,glassBobPosition(angle,0));
    const f=tile([0,r.pivotY-r.pendulumLength,-.02]);f.rotation=undefined;const k=world.add(f);
    // Angular momentum about the pivot axis (x through (0, pivotY, 0)): the pendulum's I omega_x with omega_x = -speed, and the
    // fragment's (r - p) x m v plus its spin.
    const about=()=>{
      const s=world.state(k),held=world.world.bodyMassData(world.handle(k)).inertia,q=s.rotation,w=s.angularVelocity;
      const wb=rotateVector([-q[0],-q[1],-q[2],q[3]],w),Iw=rotateVector(q,[held[0]*wb[0]+held[3]*wb[1]+held[4]*wb[2],held[3]*wb[0]+held[1]*wb[1]+held[5]*wb[2],held[4]*wb[0]+held[5]*wb[1]+held[2]*wb[2]]);
      const y=s.position[1]-r.pivotY,z=s.position[2],v=s.linearVelocity;
      return {pendulum:-I*speed,fragment:f.mass*(y*v[2]-z*v[1])+Iw[0],p:f.mass*Math.hypot(...v)};
    };
    const before=about();
    for(let i=0;i<30;i++){
      const a=glassBobPosition(angle,0),next=angle+speed*DT,b=glassBobPosition(next,0);
      world.driveBob(a,[(b[0]-a[0])/DT,(b[1]-a[1])/DT,(b[2]-a[2])/DT],-(next-angle)/DT);world.step(DT);
      speed+=GlassModel.generalizedImpulse(world.bobReaction(),.5*(angle+next))/I;angle=next;
    }
    const after=about(),exchanged=Math.abs(after.fragment-before.fragment),error=Math.abs(after.pendulum+after.fragment-before.pendulum-before.fragment);
    console.log(`# bob on a tile: the tile took ${exchanged.toFixed(4)} N m s about the pivot (momentum ${after.p.toFixed(3)} kg m/s), the pendulum gave ${(before.pendulum-after.pendulum).toFixed(4)}; difference ${error.toExponential(2)} N m s (${(error/exchanged*100).toFixed(3)} % of the exchange)`);
    assert.ok(exchanged>.5,'the bob hit the tile');assert.ok(error<1e-3*exchanged,'angular momentum about the pivot is conserved');
  }finally{world.destroy();}
});

// Geometry of the overlap, measured outside Box3D: each tile of a fragment is a prism (8 corners); two prisms overlap by the
// smallest overlap of their projections on the separating-axis candidates (face normals, edge cross products). Box3D's own
// contact statistic is the deepest point of a manifold, which for two crossing thin plates can exceed their thickness.
const rot=(q,v)=>{const [x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);return [v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];};
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const unit=a=>{const l=Math.hypot(...a);return l>1e-12?a.map(v=>v/l):null;};
const EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],FACES=[[0,1,2],[4,6,5],[0,4,5],[1,5,6],[2,6,7],[3,7,4]];
function prisms(f,t){const out=[];for(let k=0;k<f.nodes.length;k++){const v=[];for(const dz of [-t,t])for(let c=0;c<4;c++){const i=3*(4*k+c),p=rot(f.q,[f.corners[i],f.corners[i+1],f.corners[i+2]+dz]);v.push([f.x[0]+p[0],f.x[1]+p[1],f.x[2]+p[2]]);}out.push(v);}return out;}
function overlap(A,B){
  const axes=[];for(const P of [A,B])for(const [a,b,c] of FACES){const n=unit(cross(sub(P[b],P[a]),sub(P[c],P[a])));if(n)axes.push(n);}
  for(const [a1,a2] of EDGES)for(const [b1,b2] of EDGES){const n=unit(cross(sub(A[a2],A[a1]),sub(B[b2],B[b1])));if(n)axes.push(n);}
  let best=Infinity;
  for(const n of axes){let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;for(const p of A){const d=dot(p,n);a0=Math.min(a0,d);a1=Math.max(a1,d);}for(const p of B){const d=dot(p,n);b0=Math.min(b0,d);b1=Math.max(b1,d);}const o=Math.min(a1,b1)-Math.max(a0,b0);if(o<=0)return 0;best=Math.min(best,o);}
  return best;
}
/** Deepest overlap between two fragments, and of any fragment corner inside a static box of the rig or below the floor. */
function overlaps(model){
  const t=model.thickness/2,P=model.fragments.map(f=>prisms(f,t)),boxes=[...rigColliders(model.thickness).map(f=>({c:f.position,h:f.halfExtents})),{c:[0,-.5,0],h:[40,.5,40]}];
  let pair=0,fixed=0;
  for(let a=0;a<P.length;a++){
    for(const prism of P[a])for(const p of prism)for(const b of boxes)fixed=Math.max(fixed,Math.min(b.h[0]-Math.abs(p[0]-b.c[0]),b.h[1]-Math.abs(p[1]-b.c[1]),b.h[2]-Math.abs(p[2]-b.c[2])));
    const fa=model.fragments[a];
    for(let b=a+1;b<P.length;b++){const fb=model.fragments[b];if(Math.hypot(fa.x[0]-fb.x[0],fa.x[1]-fb.x[1],fa.x[2]-fb.x[2])>fa.reach+fb.reach)continue;for(const A of P[a])for(const B of P[b])pair=Math.max(pair,overlap(A,B));}
  }
  return {pair,fixed,...clampDepths(model)};
}
/** How deep a corner of a drawn shard (its tiles, as thick as the glass) lies inside the bob's sphere, a clamp pad (shards that
 * started inside a pad are skipped until they are clear of it) or a drawn tile of the glass still held in the frame, m. */
function clampDepths(model){
  const t=model.thickness/2,c=model.bob,R=GLASS_RIG.bobRadius,pads=padColliders(model.thickness),plate=model.plate;let bob=0,pad=0,held=0;
  for(const f of model.fragments){
    const ignoring=model.rigid.ignoring.has(f.body);
    for(const P of prisms(f,t)){
      for(const p of P){
        bob=Math.max(bob,R-Math.hypot(p[0]-c[0],p[1]-c[1],p[2]-c[2]));
        if(!ignoring)for(const b of pads)pad=Math.max(pad,Math.min(b.halfExtents[0]-Math.abs(p[0]-b.position[0]),b.halfExtents[1]-Math.abs(p[1]-b.position[1]),b.halfExtents[2]-Math.abs(p[2]-b.position[2])));
      }
      for(let n=0;n<plate.nodeCount;n++){
        if(!plate.active[n]||Math.hypot(plate.x(n)-f.x[0],plate.y(n)-f.x[1])>f.reach+.15)continue;
        const pose=model.tilePose(n),H=tilePrism(model.tileCorners(n),0,pose.position,pose.rotation,t);
        for(const p of P)held=Math.max(held,depthInPrism(p,H));
      }
    }
  }
  return {bob,pad,held};
}

for(const id of ['radial-impact','frosted-fracture','edge-strike','tempered-dice']){
  test(`${id}: fragments leave the plate with its momentum, rest on the rig without sinking into it or into the bob, the pads or the held glass, and end apart`,()=>{
    const model=new GlassModel(preset(id),{fragments:pool}),seconds=id==='tempered-dice'?6:4,every=id==='tempered-dice'?24:2;let pair=0,fixed=0,crossed=0,samples=0;const clamps={bob:0,pad:0,held:0};
    try{
      for(let i=0;i<Math.round(seconds/DT);i++){
        model.step(DT);
        if(i%every===0&&model.fragments.length){const o=overlaps(model);pair=Math.max(pair,o.pair);fixed=Math.max(fixed,o.fixed);samples++;if(o.pair>.001)crossed++;for(const key of ['bob','pad','held'])clamps[key]=Math.max(clamps[key],o[key]);}
      }
      const end=overlaps(model),asleep=model.fragments.filter(f=>f.resting>.5).length,low=Math.min(...model.fragments.map(f=>f.x[1]));
      console.log(`# ${id}: ${model.fragments.length} fragments, ${asleep} asleep after ${seconds} s; momentum at release: linear ${model.releaseError.linear.toExponential(1)}, angular ${model.releaseError.angular.toExponential(1)} (relative); deepest corner in the floor, tray or frame ${(fixed*1000).toFixed(2)} mm; in the bob ${(clamps.bob*1000).toFixed(2)} mm, a pad ${(clamps.pad*1000).toFixed(2)} mm, the held glass ${(clamps.held*1000).toFixed(2)} mm; ${model.releaseShift.count} moved out of the bob at release (up to ${(model.releaseShift.largest*1000).toFixed(1)} mm), ${model.startedInClamp} started inside a clamp; the fragments gave the pendulum ${model.bobImpulse.net.toFixed(3)} N m s against its largest ${model.bobImpulse.largest.toFixed(1)} N m s; two fragments overlap by up to ${(pair*1000).toFixed(2)} mm (more than 1 mm in ${crossed} of ${samples} samples), at the end ${(end.pair*1000).toFixed(2)} mm; Box3D's deepest manifold point ${(model.rigid.deepest*1000).toFixed(1)} mm; lowest centre ${low.toFixed(4)} m`);
      assert.ok(model.fragments.length>0);
      assert.ok(model.releaseError.linear<1e-6&&model.releaseError.angular<1e-6,'momentum at release (Box3D holds float32)');
      assert.ok(fixed<.005,`a corner ${fixed} m inside the floor, tray or frame (Box3D's linear slop is 5 mm)`);
      for(const key of ['bob','pad','held'])assert.ok(clamps[key]<.002,`a corner ${clamps[key]} m inside the ${key}`);
      // Between the drawn (8 mm) shards, which collide as 16 mm hulls: a few dozen falling shards stay within 3 mm. In the
      // toughened pane's rain of 567 tiles into the tray two drawn tiles can cross by up to their thickness for a few ticks
      // (never through each other), and at rest within 5 mm.
      const tempered=id==='tempered-dice';
      assert.ok(pair<(tempered?model.thickness+1e-6:.003),`fragments overlap by ${pair} m`);assert.ok(end.pair<(tempered?.005:.003),`at the end ${end.pair} m`);
      // A tile on the pane's edge has its node, so its centre, on its own edge: standing upright it has its centre on the floor.
      assert.ok(low>-.002,'nothing falls through the floor');
    }finally{model.dispose();}
  });
}

test('determinism: a cracking run with Box3D fragments repeats bit for bit',()=>{
  const run=()=>{const m=new GlassModel(preset('radial-impact'),{fragments:pool});try{for(let i=0;i<150;i++)m.step(DT);return m.snapshot();}finally{m.dispose();}};
  assert.deepEqual(run(),run());
});
