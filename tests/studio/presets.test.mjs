import assert from 'node:assert/strict';
import {verifyNonPress} from './non-press-regression.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FINISH_PRESETS, LIGHTING_PRESETS, LOAD_PRESETS, CAMERA_PRESETS, PACKS, finishFor, loadFor, lightingFor } from '../../src/studio/presets.ts';
import { FailureSimulation, FIXED_DT } from '../../src/studio/physics.ts';

let checks=0;
const check=(name,fn)=>{fn();checks++;console.log(`PASS ${name}`);};
const presets=[...FINISH_PRESETS,...LIGHTING_PRESETS,...LOAD_PRESETS,...CAMERA_PRESETS];
check('every preset has a stable unique URL identity',()=>assert.equal(new Set(presets.map(p=>p.id)).size,presets.length));
check('all published surface packs have real local texture payloads',()=>{
  for(const pack of Object.values(PACKS))for(const file of Object.values(pack))assert.ok(existsSync(new URL(`../../public/studio/materials/${file}`,import.meta.url)),file);
});
check('copied assets retain the exact reviewed source hashes',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../docs/design/quality-v2-20260908/asset-provenance.json',import.meta.url)));
  for(const a of manifest.assets){const buffer=readFileSync(new URL('../../'+a.destination,import.meta.url));assert.equal(createHash('sha256').update(buffer).digest('hex'),a.sha256,a.destination);}
});
check('quality enhancement preserves canopy and bridge response',verifyNonPress);
for(const study of ['canopy','plate','bridge']){
  check(`${study}: incompatible or unknown finish and recipe links resolve safely`,()=>{
    for(const p of FINISH_PRESETS)assert.equal(finishFor(study,p.id).study,study);
    for(const p of LOAD_PRESETS)assert.equal(loadFor(study,p.id).study,study);
    assert.equal(finishFor(study,'missing').study,study);assert.equal(loadFor(study,'missing').study,study);
  });
}
check('all lighting treatments have bounded finite inputs and a directional sun',()=>{
  for(const p of LIGHTING_PRESETS){for(const v of [p.exposure,p.intensity,p.ambient,p.environment,p.haze,...p.sun])assert.ok(Number.isFinite(v));assert.ok(Math.hypot(...p.sun)>0);assert.ok(p.exposure>0&&p.exposure<2);}
  assert.equal(lightingFor('missing').id,lightingFor().id);
});
check('every finish uses a compatible payload and valid surface response',()=>{
  for(const p of FINISH_PRESETS){assert.ok(PACKS[p.pack]);assert.ok(p.roughness>=0&&p.roughness<=1);assert.ok(p.metalness>=0&&p.metalness<=1);if(p.study!=='plate')assert.equal(p.metalness,0);}
});
const recipeOutcomes=new Map();
for(const p of LOAD_PRESETS){
  check(`${p.id}: recipe produces finite solver history with attached fixtures`,()=>{
    assert.ok(p.target>=0&&p.target<=5);assert.ok(p.strength>=.4&&p.strength<=2);assert.ok(p.wind>=0&&p.wind<=2);
    const s=new FailureSimulation(p.study);s.targetLoad=p.target;s.strength=p.strength;s.wind=p.wind;
    for(let i=0;i<12/FIXED_DT;i++)s.step();
    assert.ok(s.nodes.every(n=>n.p.every(Number.isFinite)));
    for(const n of s.nodes)if(n.inverseMass===0)assert.deepEqual(n.p,n.rest);
    recipeOutcomes.set(p.id,{broken:s.brokenCount,deflection:s.snapshot().response.deflection});
    if(p.id.endsWith('-service'))assert.equal(s.brokenCount,0);
    if(['canopy-tear','plate-fracture','bridge-collapse'].includes(p.id))assert.ok(s.brokenCount>5);
  });
}
console.log(`\n${checks}/${checks} PASS — preset contracts, provenance and solver integration`);

const {SCENE_SETUPS,SURROUNDING_PRESETS,setupFor,surroundingsFor,PRESET_COUNT}=await import('../../src/studio/presets.ts');
const {readCollection,toggleFavorite,rememberPreset}=await import('../../src/studio/collection-state.ts');
const expanded=[...presets,...SCENE_SETUPS,...SURROUNDING_PRESETS],allowed=new Set(expanded.map(p=>p.id));
check('complete setups resolve compatible, existing choices without fallback',()=>{
  assert.equal(allowed.size,PRESET_COUNT);
  for(const p of SCENE_SETUPS){
    assert.equal(finishFor(p.study,p.finish).id,p.finish,p.id);
    assert.equal(loadFor(p.study,p.load).id,p.load,p.id);
    assert.equal(lightingFor(p.lighting).id,p.lighting,p.id);
    assert.equal(surroundingsFor(p.study,p.surroundings).id,p.surroundings,p.id);
    assert.ok(CAMERA_PRESETS.some(c=>c.id===p.camera));
    assert.equal(setupFor(p.study,p.id),p);
    if(p.intent==='Failure')assert.ok(recipeOutcomes.get(p.load).broken>0,`${p.id} must actually fail during its load ramp`);
    for(const study of ['canopy','plate','bridge'].filter(s=>s!==p.study))assert.equal(setupFor(study,p.id),undefined);
  }
});
check('new matched PBR maps preserve exact source bytes',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../docs/design/quality-v3-20260908/asset-provenance.json',import.meta.url)));
  for(const a of manifest.assets)assert.equal(createHash('sha256').update(readFileSync(new URL('../../'+a.destination,import.meta.url))).digest('hex'),a.sha256,a.destination);
});
check('surroundings stay compatible and cannot introduce invalid shader values',()=>{
  for(const p of SURROUNDING_PRESETS){for(const x of [p.ripple,p.waterScale,p.haze])assert.ok(Number.isFinite(x)&&x>0);}
  for(const study of ['canopy','plate','bridge'])for(const p of SURROUNDING_PRESETS)assert.equal(surroundingsFor(study,p.id).habitat,study==='bridge'?'valley':'hall');
});
check('damaged or stale local storage is sanitized rather than blocking the library',()=>{
  for(const raw of [null,'{','null','[]','true','{"version":9}','{"version":1,"favorites":{}}'])assert.deepEqual(readCollection(raw,allowed),{version:1,favorites:[],recent:[]});
  const clean=readCollection(JSON.stringify({version:1,favorites:['plate-forged','missing','plate-forged',null,3],recent:['canopy-linen','canopy-linen','missing']}),allowed);
  assert.deepEqual(clean,{version:1,favorites:['plate-forged'],recent:['canopy-linen']});
});
check('favorites toggle independently; recent use is deduplicated and bounded across reload',()=>{
  const base={version:1,favorites:[],recent:[]};
  const favorite=toggleFavorite(base,'plate-forged');assert.deepEqual(base.favorites,[]);
  assert.deepEqual(toggleFavorite(favorite,'plate-forged').favorites,[]);
  let recent=favorite;for(const p of expanded.slice(0,50))recent=rememberPreset(recent,p.id);
  recent=rememberPreset(recent,'plate-forged');assert.equal(recent.recent.length,24);assert.equal(recent.recent[0],'plate-forged');
  assert.deepEqual(readCollection(JSON.stringify(recent),allowed),recent);assert.deepEqual(recent.favorites,['plate-forged']);
});
console.log(`\n${checks}/${checks} PASS — expanded collection, persistence and complete setup contracts`);
