import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIVER_PROFILES, DEFAULT_RIVER, normalizeRiver, riverProfile, readRiver, writeRiver, advanceRiverClock } from '../../src/studio/river-settings.ts';
import { camerasFor, SCENE_SETUPS } from '../../src/studio/presets.ts';

test('all source flow profiles survive URL serialization exactly',()=>{
  for(const p of RIVER_PROFILES){
    const state={flow:p.flow,wave:p.wave,foam:p.foam,animate:true};
    const url=new URLSearchParams('studio=bridge');writeRiver(url,state);
    assert.equal(url.get('water'),p.id);assert.equal(url.get('studio'),'bridge');assert.deepEqual(readRiver(url),state);
  }
});
test('custom tuning and frozen water survive reload without being mislabeled as a preset',()=>{
  const state={flow:.87,wave:.56,foam:1.45,animate:false};
  const url=new URLSearchParams();writeRiver(url,state);
  assert.equal(url.get('water'),'custom');assert.deepEqual(readRiver(url),state);assert.equal(riverProfile(state),'custom');
});
test('hostile or stale URL values resolve to finite supported settings',()=>{
  assert.deepEqual(readRiver(new URLSearchParams('water=missing&flow=NaN&wave=Infinity&foam=')),DEFAULT_RIVER);
  assert.deepEqual(readRiver(new URLSearchParams('flow=-50&wave=500&foam=-2&flowMotion=0')),{flow:.15,wave:1.8,foam:0,animate:false});
  assert.deepEqual(normalizeRiver({flow:Infinity,wave:NaN,foam:undefined,animate:'yes'}),DEFAULT_RIVER);
  assert.equal(readRiver(new URLSearchParams('water=calm&flow=')).flow,.5);
});
test('freezing the current preserves its phase and resuming has no wall-clock jump',()=>{
  const frozen={...DEFAULT_RIVER,animate:false};
  assert.equal(advanceRiverClock(17,200,frozen),17);
  assert.equal(advanceRiverClock(17,.1,DEFAULT_RIVER),17.1);
  assert.equal(advanceRiverClock(17,-3,DEFAULT_RIVER),17);
  assert.equal(advanceRiverClock(17,NaN,DEFAULT_RIVER),17);
  assert.equal(advanceRiverClock(17,100,DEFAULT_RIVER),17.25);
});
test('flow speed scales the visible phase while wave and foam do not alter the clock',()=>{
  assert.equal(advanceRiverClock(0,.2,{...DEFAULT_RIVER,flow:.5}),.1);
  assert.equal(advanceRiverClock(0,.2,{...DEFAULT_RIVER,flow:2}),.4);
  assert.equal(advanceRiverClock(0,.2,{...DEFAULT_RIVER,wave:0,foam:0}),.2);
});
test('river inspection cameras are published only for the bridge',()=>{
  assert.ok(camerasFor('bridge').some(p=>p.id==='stream'));assert.ok(camerasFor('bridge').some(p=>p.id==='bank'));
  for(const study of ['canopy','plate'])assert.ok(camerasFor(study).every(p=>!['stream','bank'].includes(p.id)));
});
test('complete bridge setups have reproducible river profiles; other studies remain independent',()=>{
  for(const setup of SCENE_SETUPS){
    if(setup.study==='bridge'){
      assert.ok(RIVER_PROFILES.some(p=>p.id===setup.water),setup.id);
      const initial=readRiver(new URLSearchParams(),setup.water),serialized=new URLSearchParams();
      writeRiver(serialized,initial);assert.deepEqual(readRiver(serialized),initial);assert.equal(riverProfile(initial),setup.water);
    }else assert.equal(setup.water,undefined);
  }
});
