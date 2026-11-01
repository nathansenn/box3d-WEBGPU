import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){
    const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);
  }return next(s,c);
}});
const {LABS,LAB_IDS,MATERIALS,normalizeSettings,readSettings,writeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const {createModel,DT}=await import('../../src/studio/material-labs/models.ts');
const receipts=[];
const run=(m,seconds)=>{for(let step=0;step<Math.ceil(seconds/DT);step++)m.step(DT);return m;};
const finite=m=>{for(const key of ['positions','rotations','metrics'])assert.ok([...m.frame[key]].every(Number.isFinite),`${m.id}: finite ${key}`);assert.ok(Number.isFinite(m.frame.time));};
const sum=a=>a.reduce((a,b)=>a+b,0);
const duration=(id,p)=>Math.max(LABS[id].duration,id==='concrete'?p.load/p.rate+4:id==='rubber'?p.load/p.rate+p.damping+8:0);
for(const id of LAB_IDS){
  test(`${id}: normalized controls and a complete URL round-trip`,()=>{
    assert.equal(MATERIALS[id].length,id==='liquid'?24:8);assert.equal(new Set(MATERIALS[id].map(p=>p.id)).size,MATERIALS[id].length);
    assert.equal(LABS[id].experiments.length,id==='liquid'?60:8);assert.equal(new Set(LABS[id].experiments.map(p=>p.id)).size,LABS[id].experiments.length);
    const bad=normalizeSettings(id,{material:'<script>',load:NaN,rate:Infinity,size:-999,damping:1e8,seed:NaN,mode:'unknown'});
    assert.equal(bad.material,MATERIALS[id][0].id);assert.equal(bad.seed,42);
    for(const c of LABS[id].controls){assert.ok(bad[c.key]>=c.min&&bad[c.key]<=c.max,c.key);}
    for(const e of LABS[id].experiments){const expected=normalizeSettings(id,{...LABS[id].defaults,...e.settings});const url=writeSettings(id,expected,e.id);assert.deepEqual(readSettings(id,new URLSearchParams(url)),expected);}
  });
  for(const experiment of LABS[id].experiments){
    test(`${id} / ${experiment.name}: full program stays finite and contains its specimen`,()=>{
      const settings=normalizeSettings(id,{...LABS[id].defaults,...experiment.settings}),model=createModel(id,settings),t=performance.now();
      run(model,duration(id,settings));finite(model);
      if(id==='liquid'){
        assert.ok(Math.abs(model.frame.hydraulics.residual)<1e-8,'sources, storage and sinks balance');
        assert.ok([...model.h].every(h=>h>=0),'nonnegative water depths');
        model.solid.forEach((solid,i)=>{if(solid)assert.equal(model.h[i],0);});
      }
      if(id==='granular'){
        assert.equal(model.frame.metrics[2],model.count);assert.equal(model.frame.positions.length,model.count*3);
        for(let i=0;i<model.count;i++){const [x,y,z]=model.frame.positions.subarray(i*3,i*3+3),r=model.radius;assert.ok(x-r>=-2.85001&&x+r<=2.85001);assert.ok(y-r>=.57999);assert.ok(z-r>=-.85001&&z+r<=.85001);}
      }
      if(id==='glass')assert.ok(model.frame.metrics[1]>=0&&model.frame.metrics[1]<=100);
      if(id==='concrete')assert.ok(model.frame.metrics[1]>=0&&model.frame.metrics[1]<=100);
      if(id==='rubber'){assert.ok(model.frame.positions[0]>0);assert.ok(model.frame.metrics[1]>0&&model.frame.metrics[1]<=100);}
      receipts.push({study:id,experiment:experiment.id,simulatedSeconds:model.frame.time,cpuMs:Math.round((performance.now()-t)*100)/100,phase:model.frame.phase,metrics:[...model.frame.metrics]});
    });
  }
  test(`${id}: identical seed and inputs reproduce state; recorded frames remain immutable`,()=>{
    const a=createModel(id),b=createModel(id),before=a.snapshot();run(a,2);run(b,2);
    assert.deepEqual(a.snapshot(),b.snapshot());assert.equal(before.time,0);assert.notDeepEqual(before.positions,a.frame.positions);
    const frozen=a.snapshot(),copy=structuredClone(frozen);run(a,.5);assert.deepEqual(frozen,copy);
  });
}
test('liquid: viscosity suppresses a moving wave without losing liquid',()=>{
  const water=run(createModel('liquid',{material:'water'}),3),honey=run(createModel('liquid',{material:'honey'}),3);
  assert.ok(honey.frame.metrics[1]<water.frame.metrics[1]*.4);
  assert.ok(Math.abs(honey.volume()-honey.initialVolume)<1e-8);
});
test('glass: thickness resists impact; laminates retain fractured pieces',()=>{
  const thin=run(createModel('glass'),4),thick=run(createModel('glass',{size:24,load:25,rate:.4}),4),held=run(createModel('glass',{material:'laminated',load:80,rate:1.5}),4);
  assert.ok(thin.frame.metrics[1]>50);assert.equal(thick.frame.metrics[1],0);assert.ok(held.frame.metrics[1]>50);
  assert.ok(held.frame.metrics[2]<thin.frame.metrics[2]*.3);
  const broken=sum(thin.frame.damage);run(thin,5);assert.equal(sum(thin.frame.damage),broken);
});
test('glass: off-center triangulation covers the same rectangular pane',()=>{
  for(const fill of [0,65]){const m=createModel('glass',{fill});let area=0;
    for(const piece of m.pieces){const v=piece.vertices.map(p=>p.map((x,i)=>x+piece.center[i]));for(const p of v){assert.ok(p[0]>=-1.300001&&p[0]<=1.300001);assert.ok(p[1]>=1.449999&&p[1]<=3.450001);}area+=Math.abs((v[1][0]-v[0][0])*(v[2][1]-v[0][1])-(v[1][1]-v[0][1])*(v[2][0]-v[0][0]))/2;}
    assert.ok(Math.abs(area-5.2)<1e-10);
  }
});
test('concrete: modest loading stays intact; weaker bonds fail earlier and stay broken',()=>{
  const low=run(createModel('concrete',{load:3,rate:1}),12),weak=run(createModel('concrete',{material:'aged'}),12),strong=run(createModel('concrete',{material:'high-strength'}),12);
  assert.equal(low.frame.metrics[1],0);assert.ok(weak.frame.metrics[1]>strong.frame.metrics[1]+10);
  const count=weak.bonds.filter(b=>b.broken).length;weak.release();run(weak,8);assert.ok(weak.bonds.filter(b=>b.broken).length>=count);
});
test('rubber: elastic recovery and foam permanent set are distinct',()=>{
  const elastic=run(createModel('rubber'),18),foam=run(createModel('rubber',{material:'foam',load:75}),18);
  assert.ok(elastic.frame.metrics[0]<.1);assert.ok(elastic.frame.metrics[1]>99.9);assert.ok(foam.frame.metrics[2]>5);assert.ok(foam.frame.metrics[0]>elastic.frame.metrics[0]+5);
  const held=run(createModel('rubber',{damping:8}),6);assert.ok(held.frame.metrics[0]>40);
});
test('granular: low-friction beads spread farther; contacts stay bounded',()=>{
  const beads=run(createModel('granular',{material:'beads'}),10),sand=run(createModel('granular',{material:'angular',damping:1.5}),10);
  assert.ok(beads.frame.metrics[0]>sand.frame.metrics[0]+.1);
  let worst=0;const p=sand.frame.positions,d=sand.radius*2;
  for(let i=0;i<sand.count;i++)for(let j=i+1;j<sand.count;j++){const k=i*3,l=j*3,dist=Math.hypot(p[k]-p[l],p[k+1]-p[l+1],p[k+2]-p[l+2]);worst=Math.max(worst,(d-dist)/d);}
  assert.ok(worst<.2,`maximum contact overlap ${(worst*100).toFixed(1)}%`);
});
after(()=>{
  const paths=['src/studio/material-labs/catalog.ts','src/studio/material-labs/models.ts'];
  const hashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
  if(process.env.MATERIAL_QA_OUTPUT)writeFileSync(process.env.MATERIAL_QA_OUTPUT,JSON.stringify({timestamp:new Date().toISOString(),fixedStep:DT,scope:'Comparative numerical models; CPU timings exclude rendering.',hashes,programs:receipts},null,2)+'\n');
});
