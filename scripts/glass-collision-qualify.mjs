import './register-typescript.mjs';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {endianness} from 'node:os';
import {Quaternion,Vector3,Triangle} from 'three';


/** Independent geometry reconstruction: Three.js rotations, face-derived normals
 * and every mesh edge. Does not call the production pose, broad phase or SAT. */
export function referenceShape(body){
  const q=new Quaternion(...body.rotation),p=new Vector3(...body.position),vertices=body.shape.vertices.map(v=>new Vector3(...v).applyQuaternion(q).add(p)),normals=[],edges=[];
  for(const face of body.shape.faces){
    normals.push(vertices[face[1]].clone().sub(vertices[face[0]]).cross(vertices[face[2]].clone().sub(vertices[face[0]])).normalize());
    for(let i=0;i<face.length;i++)edges.push(vertices[face[(i+1)%face.length]].clone().sub(vertices[face[i]]).normalize());
  }
  const min=[0,1,2].map(k=>Math.min(...vertices.map(v=>v.getComponent(k)))),max=[0,1,2].map(k=>Math.max(...vertices.map(v=>v.getComponent(k))));
  return {vertices,normals,edges,min,max,dynamic:body.dynamic};
}
export function referenceSeparation(a,b){
  let gap=-Infinity;
  const axis=n=>{
    const aa=a.vertices.map(v=>v.dot(n)),bb=b.vertices.map(v=>v.dot(n));
    gap=Math.max(gap,Math.min(...bb)-Math.max(...aa),Math.min(...aa)-Math.max(...bb));
  };
  for(const n of a.normals)axis(n);for(const n of b.normals)axis(n);
  for(const ea of a.edges)for(const eb of b.edges){const n=ea.clone().cross(eb);if(n.lengthSq()>1e-16)axis(n.normalize());}
  return gap;
}
export function referenceContacts(bodies){
  const shapes=bodies.map(referenceShape);let maximum=0,pair=null,pairs=0;
  for(let a=0;a<shapes.length;a++)for(let b=a+1;b<shapes.length;b++){
    const x=shapes[a],y=shapes[b];if(!x.dynamic&&!y.dynamic)continue;
    if(x.min.some((v,k)=>v>y.max[k]||x.max[k]<y.min[k]))continue;
    pairs++;const depth=-referenceSeparation(x,y);if(depth>maximum){maximum=depth;pair=[a,b];}
  }
  return {maximum,pair,pairs};
}
/** Independent sphere/surface audit, including centres contained by a hull. */
export function referenceSphereContacts(center,radius,bodies){
  const c=new Vector3(...center),triangle=new Triangle(),closest=new Vector3();let maximum=0,bodyIndex=null;
  for(let index=0;index<bodies.length;index++){
    const body=bodies[index],shape=referenceShape(body);
    if(center.some((v,k)=>v+radius<shape.min[k]||v-radius>shape.max[k]))continue;
    let maxPlane=-Infinity,distance=Infinity;
    body.shape.faces.forEach((face,i)=>{
      maxPlane=Math.max(maxPlane,shape.normals[i].dot(c.clone().sub(shape.vertices[face[0]])));
      for(let j=1;j<face.length-1;j++){
        triangle.set(shape.vertices[face[0]],shape.vertices[face[j]],shape.vertices[face[j+1]]);triangle.closestPointToPoint(c,closest);distance=Math.min(distance,closest.distanceTo(c));
      }
    });
    const depth=maxPlane<=0?radius-maxPlane:radius-distance;
    if(depth>maximum){maximum=depth;bodyIndex=index;}
  }
  return {maximum,bodyIndex};
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const quantile=(a,q)=>{const sorted=[...a].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*q)]??0;};
function stateHash(model){
  const digest=createHash('sha256');
  digest.update(new Uint8Array(model.frame.positions.buffer));digest.update(new Uint8Array(model.frame.rotations.buffer));digest.update(model.frame.damage);
  for(const b of [...model.shardBodies,model.pendulum])digest.update(new Uint8Array(Float64Array.from([...b.position,...b.rotation,...b.velocity,...b.angularVelocity]).buffer));
  digest.update(JSON.stringify({time:model.frame.time,actuator:model.frame.actuator,metrics:model.frame.metrics,collisions:model.frame.collisions}));return digest.digest('hex');
}

async function qualify(){
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),name=process.argv[2];
  if(!name||!/^[a-z0-9-]+$/.test(name))throw new Error('Usage: node scripts/glass-collision-qualify.mjs UNIQUE-RUN-ID [SOURCE-ROOT]');
  const sourceRoot=resolve(process.argv[3]??root),out=join(root,'benchmarks/results/engine-100x/runs',name);mkdirSync(out);
  const paths=['src/engine/convex-contact.ts','src/studio/material-labs/catalog.ts','src/studio/material-labs/models.ts','src/studio/material-labs/glass-rig.ts','src/studio/material-labs/world.ts','src/studio/material-labs/main.ts','src/studio/material-labs/glass-worker.ts','src/studio/material-labs/glass-worker-client.ts','src/studio/material-labs/glass-worker-protocol.ts','tests/engine/convex-contact.test.mjs','tests/studio/material-collision.test.mjs','tests/studio/glass-worker.test.mjs','tests/qualification/glass-reference.test.mjs','scripts/glass-collision-qualify.mjs'];
  paths.push('tests/fixtures/glass-contact/rotating-grazing-pair.json');
  paths.push('src/studio/material-labs/glass-pendulum.ts','tests/studio/glass-pendulum.test.mjs');
  const hashes={};for(const p of paths){const from=join(sourceRoot,p),to=join(out,'frozen',p);mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);hashes[p]=hash(readFileSync(to));}
  const manifest={schema:'box3d.glass-contact-qualification/2',startedAt:new Date().toISOString(),sourceRoot,sourceHash:hash(JSON.stringify(hashes)),hashes,node:process.version,endianness:endianness(),dt:1/120,duration:12,sampleEveryTicks:60,maximumAcceptedPenetration:.0005,performanceClaim:'CPU observations only; no renderer-inclusive speedup qualification.'};
  const {LABS}=await import(pathToFileURL(join(out,'frozen/src/studio/material-labs/catalog.ts')));
  const {GlassModel,DT}=await import(pathToFileURL(join(out,'frozen/src/studio/material-labs/models.ts')));
  const programs=[];
  const priority=['laminated-retention','wired-retention'];
  const presets=[...LABS.glass.experiments].sort((a,b)=>(priority.includes(a.id)?priority.indexOf(a.id):priority.length)-(priority.includes(b.id)?priority.indexOf(b.id):priority.length));
  manifest.evaluationOrder=presets.map(p=>p.id);writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const preset of presets){
    const model=new GlassModel({...LABS.glass.defaults,...preset.settings}),samples=[],timings=[];
    let maxAcceptedPenetration=0,refinements=0,unresolvedSweeps=0,maxContactPoints=0,finite=true,clampsStable=true;
    for(let tick=1;tick<=1440;tick++){
      const start=performance.now();model.step(DT);timings.push(performance.now()-start);
      const stats=model.collisionWorld.stats;maxAcceptedPenetration=Math.max(maxAcceptedPenetration,stats.maxPenetration);refinements+=stats.refinements;unresolvedSweeps+=model.frame.collisions.unresolvedSweeps;maxContactPoints=Math.max(maxContactPoints,model.frame.collisions.contacts);
      finite&&=[model.frame.time,model.frame.actuator,...model.frame.positions,...model.frame.rotations,...model.frame.metrics].every(Number.isFinite);
      finite&&=[...model.pendulum.position,...model.pendulum.rotation,...model.pendulum.velocity,...model.pendulum.angularVelocity].every(Number.isFinite);
      for(let i=0;i<model.shardBodies.length;i++){
        const b=model.shardBodies[i];finite&&=[...b.position,...b.rotation,...b.velocity,...b.angularVelocity].every(Number.isFinite);
        if(model.clampedPieces[i])clampsStable&&=b.position.every((v,k)=>v===model.pieces[i].center[k])&&b.rotation.every((v,k)=>v===(k===3?1:0));
      }
      if(tick%60===0){
        const bodies=model.collisionWorld.bodies.filter(b=>b!==model.pendulum),reference=referenceContacts(bodies),sphereReference=referenceSphereContacts(model.pendulum.position,.235,bodies);
        samples.push({tick,time:model.frame.time,metrics:[...model.frame.metrics],collisions:{...model.frame.collisions},reference,sphereReference,stateHash:stateHash(model)});
        writeFileSync(join(out,preset.id+'-progress.json'),JSON.stringify({tick,finite,clampsStable,maxAcceptedPenetration,unresolvedSweeps,refinements,samples},null,2)+'\n');
        console.log(JSON.stringify({preset:preset.id,tick,referencePenetration:reference.maximum,acceptedPenetration:maxAcceptedPenetration,cpuMs:Math.round(timings.reduce((s,v)=>s+v,0)),refinements}));
      }
      if(!finite)break;
    }
    const maxReferencePenetration=Math.max(0,...samples.flatMap(s=>[s.reference.maximum,s.sphereReference.maximum])),cpuMs=timings.reduce((s,v)=>s+v,0);
    const penetrationAccuracyPassed=finite&&clampsStable&&timings.length===1440&&Math.max(maxAcceptedPenetration,maxReferencePenetration)<=manifest.maximumAcceptedPenetration,sweepQueriesFullyResolved=unresolvedSweeps===0;
    const result={id:preset.id,settings:model.settings,shards:model.pieces.length,clampedPieces:model.clampedPieces.reduce((s,v)=>s+v,0),ticks:timings.length,finite,clampsStable,maxAcceptedPenetration,maxReferencePenetration,refinements,unresolvedSweeps,maxContactPoints,finalMetrics:[...model.frame.metrics],finalCollisions:{...model.frame.collisions},samples,cpu:{totalMs:cpuMs,p50:quantile(timings,.5),p95:quantile(timings,.95),max:Math.max(...timings),realTimeBudgetMet:cpuMs<=12000},penetrationAccuracyPassed,sweepQueriesFullyResolved,accuracyPassed:penetrationAccuracyPassed&&sweepQueriesFullyResolved};
    writeFileSync(join(out,preset.id+'.json'),JSON.stringify(result,null,2)+'\n');programs.push(result);
  }
  programs.sort((a,b)=>LABS.glass.experiments.findIndex(p=>p.id===a.id)-LABS.glass.experiments.findIndex(p=>p.id===b.id));
  const result={schema:manifest.schema,sourceHash:manifest.sourceHash,completedAt:new Date().toISOString(),accuracyPassed:programs.every(p=>p.accuracyPassed),performanceQualified:false,programs:programs.map(({samples,...p})=>p)};
  writeFileSync(join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({out,accuracyPassed:result.accuracyPassed,programs:programs.length}));if(!result.accuracyPassed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await qualify();
