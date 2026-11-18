import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';

registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL?.endsWith('.ts')){
    const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return next(url.href,context);
  }
  return next(specifier,context);
}});
const {StudioMaterials}=await import('../../src/studio/materials.ts');
const {FINISH_PRESETS,finishFor}=await import('../../src/studio/presets.ts');
const T=await import('three/webgpu');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function harness(manual=false) {
  const requests=[],textures=[],disposals=new Map();
  const loader={loadAsync(url){
    const request={url,file:url.split('/').at(-1),settled:false};requests.push(request);
    return new Promise((resolve,reject)=>{
      request.resolve=()=>{
        assert.equal(request.settled,false);request.settled=true;
        const value=new T.Texture();textures.push(value);disposals.set(value,0);
        value.addEventListener('dispose',()=>disposals.set(value,disposals.get(value)+1));
        request.texture=value;resolve(value);return value;
      };
      request.reject=()=>{assert.equal(request.settled,false);request.settled=true;reject(new Error('Controlled texture failure: '+request.file));};
      if(!manual)request.resolve();
    });
  }};
  const library=new StudioMaterials(loader);
  return {library,requests,textures,disposals,
    settle(){for(const request of requests)if(!request.settled)request.resolve();},
    live(){return textures.filter(texture=>disposals.get(texture)===0);},
  };
}
const files=h=>h.requests.map(request=>request.file);
const countDisposals=material=>{let count=0;material.addEventListener('dispose',()=>count++);return ()=>count;};

test('default and plate startup load only the six interior fixture texture variants',async()=>{
  for(const study of [undefined,'plate']) {
    const h=harness();await h.library.init(study);
    assert.equal(h.requests.length,6);
    assert.deepEqual(files(h).sort(),['cast-concrete.png','cast-concrete.png','iron-basecolor.webp','iron-normal.webp','iron-roughness.webp','machined-metal.png'].sort());
    for(const key of ['floor','wall','steel','leaf','grass','rock'])assert.ok(h.library.materials[key].color.isColor,key);
    assert.deepEqual(h.library.materials.floor.map.repeat.toArray(),[16,16]);
    assert.deepEqual(h.library.materials.wall.map.repeat.toArray(),[2,2]);
    assert.equal(h.library.materials.floor.bumpMap,h.library.materials.floor.map);
    assert.equal(h.library.materials.chrome.isMeshPhysicalMaterial,true);
    assert.equal(h.library.materials.chrome.anisotropy,.45);
    assert.equal(h.library.materials.leaf.map,null);
    assert.equal(h.library.materials.wood.map,null);
    assert.equal(h.library.materials.bridgeSteel.isMeshStandardNodeMaterial,undefined);
    h.library.dispose();assert.equal(h.live().length,0);
  }
});

test('bridge assets load once on demand and retain the authored node-material contracts',async()=>{
  const h=harness();await h.library.init();const floor=h.library.materials.floor,steel=h.library.materials.steel;
  await Promise.all([h.library.ensureStudy('bridge'),h.library.ensureStudy('bridge')]);
  assert.equal(h.requests.length,12);
  assert.deepEqual(files(h).slice(6).sort(),['oak-foliage.png','riverbank-earth.png','granite-rock.png','timber-basecolor.webp','timber-normal.webp','forest-floor.png'].sort());
  assert.equal(h.library.materials.floor,floor);assert.equal(h.library.materials.steel,steel);
  for(const [key,name] of [['bridgeSteel','Weathered bridge steel'],['bridgeConcrete','Cast concrete abutments'],['wireRope','Stranded steel wire rope']]){
    const value=h.library.materials[key];assert.equal(value.isMeshStandardNodeMaterial,true);assert.equal(value.name,name);assert.ok(value.colorNode?.isNode,key);
  }
  const m=h.library.materials;
  assert.equal(m.bridgeSteel.normalMap,m.steel.normalMap);assert.equal(m.bridgeSteel.roughnessMap,m.steel.roughnessMap);
  assert.deepEqual(m.bridgeSteel.normalScale.toArray(),[.08,.08]);assert.equal(m.bridgeSteel.roughness,.79);assert.equal(m.bridgeSteel.metalness,.58);
  assert.equal(m.bridgeConcrete.bumpMap,m.wall.map);assert.equal(m.bridgeConcrete.bumpScale,.024);
  assert.deepEqual(m.soil.map.repeat.toArray(),[100,94]);assert.deepEqual(m.moss.map.repeat.toArray(),[125,118]);
  assert.equal(m.leaf.alphaTest,.55);assert.equal(m.leaf.side,T.DoubleSide);assert.equal(m.bark.normalScale.x,.7);
  const identities={...m};await h.library.init('bridge');await h.library.ensureStudy('canopy');await h.library.ensureStudy('plate');
  assert.equal(h.requests.length,12);for(const key of Object.keys(identities))assert.equal(m[key],identities[key]);
  h.library.dispose();for(const value of h.textures)assert.equal(h.disposals.get(value),1);
});

test('bridge-first startup defers the interior floor while keeping visible crown hardware textured',async()=>{
  const h=harness();await h.library.init('bridge');
  assert.equal(h.requests.length,11);assert.equal(files(h).includes('machined-metal.png'),true);
  assert.equal(h.library.materials.floor.map,null);assert.ok(h.library.materials.wood.map);assert.ok(h.library.materials.chrome.map);
  await h.library.ensureStudy('plate');assert.equal(h.requests.length,12);assert.ok(h.library.materials.floor.map);
  h.library.dispose();
});

test('finishes preserve texture color spaces, tiling and physical appearance settings',async()=>{
  const h=harness();
  for(const id of ['canopy-linen','canopy-navy','canopy-leather','plate-machined','bridge-weathered','bridge-teak']){
    const preset=FINISH_PRESETS.find(p=>p.id===id),value=await h.library.finish(preset);
    const cloth=preset.study==='canopy',wood=preset.study==='bridge',repeat=preset.pack==='leather'?[4,3.2]:cloth?[3,2.4]:wood?[1,.33]:[1,1];
    assert.equal(value.isMeshPhysicalMaterial,true);assert.equal(value.name,preset.name);assert.equal(value.color.getHexString(),new T.Color(preset.color).getHexString());
    assert.equal(value.roughness,preset.roughness);assert.equal(value.metalness,preset.metalness);
    assert.deepEqual(value.normalScale.toArray(),[preset.normal,preset.normal]);
    assert.equal(value.map.colorSpace,T.SRGBColorSpace);assert.equal(value.normalMap.colorSpace,T.NoColorSpace);assert.equal(value.roughnessMap.colorSpace,T.NoColorSpace);
    assert.deepEqual(value.map.repeat.toArray(),repeat);assert.deepEqual(value.normalMap.repeat.toArray(),cloth&&preset.pack!=='leather'?[26,21]:repeat);
    assert.equal(value.map.wrapS,T.RepeatWrapping);assert.equal(value.map.wrapT,T.RepeatWrapping);assert.equal(value.map.anisotropy,8);
    assert.equal(value.side,wood?T.FrontSide:T.DoubleSide);
    assert.equal(value.sheen,preset.sheen??(cloth?(preset.pack==='navy'?.18:.55):0));
    assert.equal(value.clearcoat,preset.clearcoat??(wood&&preset.roughness<.8?.2:0));
    h.library.releaseFinish(value);
  }
  assert.equal(h.live().length,0);h.library.dispose();
});

test('two-phase finish replacement retains shared maps until their last material releases',async()=>{
  const h=harness();const first=await h.library.finish(finishFor('canopy'));
  const second=await h.library.finish({...finishFor('canopy'),color:'#888888'});
  assert.equal(h.requests.length,3);assert.equal(first.map,second.map);assert.equal(first.normalMap,second.normalMap);
  const firstDisposals=countDisposals(first),secondDisposals=countDisposals(second);
  h.library.releaseFinish(first);h.library.releaseFinish(first);
  assert.equal(firstDisposals(),1);assert.equal(h.live().length,3);
  second.dispose();h.library.releaseFinish(second);
  assert.equal(secondDisposals(),1);assert.equal(h.live().length,0);
  const third=await h.library.finish(finishFor('canopy'));assert.equal(h.requests.length,6);assert.notEqual(third.map,first.map);
  h.library.releaseFinish(third);h.library.dispose();for(const value of h.textures)assert.equal(h.disposals.get(value),1);
});

test('finish release never disposes maps retained by visible fixture materials',async()=>{
  const h=harness();await h.library.init('plate');const chrome=h.library.materials.chrome;
  const value=await h.library.finish(finishFor('plate'));assert.equal(h.requests.length,6);
  assert.equal(value.map,chrome.map);assert.equal(value.normalMap,chrome.normalMap);assert.equal(value.roughnessMap,chrome.roughnessMap);
  h.library.releaseFinish(value);assert.equal(h.live().length,6);
  h.library.dispose();assert.equal(h.live().length,0);
});

test('loading bridge assets preserves a finish already adopted for hall worktops',async()=>{
  const h=harness();await h.library.init('canopy');const worktop=await h.library.finish(finishFor('bridge'));
  const original=h.library.materials.wood;original.dispose();h.library.materials.wood=worktop;
  await h.library.ensureStudy('bridge');assert.equal(h.library.materials.wood,worktop);
  assert.equal(h.disposals.get(worktop.map),0);assert.ok(h.library.materials.bark.map);
  h.library.dispose();assert.equal(h.live().length,0);
});

test('failed finish preparation keeps the active finish usable and retires late sibling loads',async()=>{
  const h=harness(true);const activePromise=h.library.finish(finishFor('canopy'));await tick();h.settle();const active=await activePromise;
  const replacement=h.library.finish(FINISH_PRESETS.find(p=>p.id==='plate-copper'));
  const rejected=assert.rejects(replacement,/Controlled texture failure/);await tick();
  h.requests.find(r=>r.file==='copper-basecolor.jpg').reject();await rejected;
  const late=h.requests.filter(r=>!r.settled).map(r=>r.resolve());await tick();
  for(const value of late)assert.equal(h.disposals.get(value),1);
  assert.equal(h.disposals.get(active.map),0);assert.equal(h.live().length,3);
  const retry=h.library.finish(FINISH_PRESETS.find(p=>p.id==='plate-copper'));await tick();h.settle();const recovered=await retry;
  assert.equal(h.live().length,6);h.library.releaseFinish(active);assert.equal(h.live().length,3);
  h.library.releaseFinish(recovered);h.library.dispose();assert.equal(h.live().length,0);
});

test('failed study loading can retry without duplicate successful texture requests',async()=>{
  const h=harness(true),pending=h.library.init('canopy'),rejected=assert.rejects(pending,/Controlled texture failure/);
  const placeholder=h.library.materials.chrome;await tick();
  h.requests.find(r=>r.file==='machined-metal.png').reject();h.settle();await rejected;
  assert.equal(h.library.materials.chrome,placeholder);
  const retry=h.library.init('plate');await tick();assert.equal(h.requests.length,7);h.settle();await retry;
  assert.notEqual(h.library.materials.chrome,placeholder);assert.equal(h.live().length,6);h.library.dispose();
});

test('dispose reclaims every owned material and texture once, leaving foreign resources untouched',async()=>{
  const h=harness();const placeholders=Object.values(h.library.materials),before=placeholders.map(countDisposals);
  await h.library.init('bridge');await h.library.ensureStudy('plate');
  const finish=await h.library.finish(finishFor('canopy'));h.library.materials.fabric=finish;
  const values=[...new Set(Object.values(h.library.materials))],after=values.map(countDisposals);
  const foreign=new T.MeshStandardMaterial({map:new T.Texture()}),foreignCount=countDisposals(foreign),foreignTextureCount=countDisposals(foreign.map);
  h.library.materials.foreign=foreign;h.library.releaseFinish(foreign);
  h.library.dispose();h.library.dispose();h.library.releaseFinish(finish);
  assert.equal(Object.keys(h.library.materials).length,0);
  for(const count of before)assert.equal(count(),1);for(const count of after)assert.equal(count(),1);
  for(const value of h.textures)assert.equal(h.disposals.get(value),1);
  assert.equal(foreignCount(),0);assert.equal(foreignTextureCount(),0);
  foreign.map.dispose();foreign.dispose();
});

test('pending textures that resolve after disposal are released immediately and all use rejects',async()=>{
  for(const operation of ['finish','init']){
    const h=harness(true),pending=operation==='finish'?h.library.finish(finishFor('canopy')):h.library.init('bridge');
    const rejected=assert.rejects(pending,/disposed/);await tick();assert.ok(h.requests.length>0);
    h.library.dispose();h.settle();await rejected;await tick();
    assert.equal(h.live().length,0);for(const value of h.textures)assert.equal(h.disposals.get(value),1);
    const count=h.requests.length;
    await assert.rejects(h.library.init(),/disposed/);await assert.rejects(h.library.ensureStudy('bridge'),/disposed/);
    await assert.rejects(h.library.finish(finishFor('plate')),/disposed/);await assert.rejects(h.library.texture('unused.png'),/disposed/);
    assert.equal(h.requests.length,count);h.library.dispose();
  }
});

test('disposal before queued requests start prevents the loader from being invoked',async()=>{
  const h=harness(true),pending=h.library.init(),rejected=assert.rejects(pending,/disposed/);
  h.library.dispose();await rejected;assert.equal(h.requests.length,0);
});

test('100 successive finish adoptions keep residency bounded by the active and prepared finishes',async()=>{
  const h=harness();let active;
  for(let i=0;i<100;i++){
    const next=await h.library.finish(FINISH_PRESETS[i%FINISH_PRESETS.length]);
    assert.ok(h.live().length<=6,`at most two finish sets before adoption ${i}`);
    h.library.releaseFinish(active);active=next;
    assert.equal(h.live().length,3,`only the active finish maps remain at adoption ${i}`);
  }
  h.library.releaseFinish(active);assert.equal(h.live().length,0);h.library.dispose();
  for(const value of h.textures)assert.equal(h.disposals.get(value),1);
});
