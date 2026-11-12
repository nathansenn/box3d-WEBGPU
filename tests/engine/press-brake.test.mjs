// The press brake (src/engine/press-brake.ts): air bending of a sheet on the J2 solid with rigid punch and die
// in contact, against closed forms. SI units. Measured values are printed (`node --test --test-reporter=spec`);
// docs/STUDIO_METAL_PRESS.md quotes them. No check depends on wall-clock time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PressBrake} from '../../src/engine/press-brake.ts';
import {plasticMaterial} from '../../src/engine/materials.ts';

const t=.002;
const S355=plasticMaterial('structural-steel-s355',{allowUnverified:true}),AL6061=plasticMaterial('aluminium-6061-t6');
/** Runs the punch down by `stroke` (m) in `steps`, then back up for `back` steps. */
function run(options,stroke,steps,back=0){
  const pb=new PressBrake({thickness:t,width:1,dt:1/60,...options}),speed=stroke/(steps*pb.dt),history=[];
  pb.setPunchSpeed(speed);
  for(let s=0;s<steps;s++){pb.step();history.push({stroke:pb.stroke,force:pb.punchForce,deflection:pb.deflection,angle:pb.bendAngle,p:pb.maxPlasticStrain,eroded:pb.body.erodedCount});}
  const loaded={force:pb.punchForce,deflection:pb.deflection,angle:pb.bendAngle,die:-2*pb.contact.bodyForce(0)[1]/pb.depth*pb.width};
  if(back){pb.setPunchSpeed(-speed);for(let s=0;s<back;s++)pb.step();}
  return {pb,history,loaded,unloaded:{force:pb.punchForce,deflection:pb.deflection,angle:pb.bendAngle}};
}
const plane=m=>({Ep:m.youngModulus/(1-m.poissonRatio**2),Mp:2/Math.sqrt(3)*m.yieldStress*t*t/4,I:t**3/12});

test('three-point air bend, S355, 2 mm, die opening 8 t: limit load, equilibrium of punch and die, and elastic springback',()=>{
  const material={...S355,hardeningModulus:0,failureStrain:Infinity},{Ep,Mp,I}=plane(material);
  const {pb,history,loaded,unloaded}=run({material,friction:0},.8*t,16,10),V=pb.dieOpening,FL=4*Mp/V;
  const ratio=loaded.force/FL;
  console.log(`# limit: F = ${(loaded.force/1e3).toFixed(2)} kN per metre, 4 Mp' / V = ${(FL/1e3).toFixed(2)} kN per metre, ratio ${ratio.toFixed(3)}`);
  // Beam theory gives 4 M_p' / V with M_p' = (2 / sqrt 3) sigma_y t^2 / 4 (plane strain). The section is short (V / t = 8) and
  // loaded by a punch of radius t, which raises the hinge moment, and four linear tetrahedra through the thickness are 6.6%
  // too strong in fully plastic plane-strain bending (measured, docs). The band is the measured 1.22 with margin, not a claim.
  assert.ok(ratio>1&&ratio<1.35,`limit ratio ${ratio}`);
  // Equilibrium: what the punch pushes down the die shoulders hold up. 1%: the die reaction is read from the same converged springs.
  assert.ok(Math.abs(loaded.die-loaded.force)<=.01*loaded.force,`die ${loaded.die} punch ${loaded.force}`);
  // Springback: the unloading is elastic, so the bend depth recovers by F V^3 / (48 E' I) (plane strain). 12%: the elastic
  // bending stiffness of four cells through the thickness, against shear and contact compliance (measured 0.90).
  const recovered=loaded.deflection-unloaded.deflection,expected=loaded.force*V**3/(48*Ep*I);
  console.log(`# springback: depth recovered ${(recovered*1e6).toFixed(1)} um, closed form ${(expected*1e6).toFixed(1)} um; angle ${loaded.angle.toFixed(2)} -> ${unloaded.angle.toFixed(2)} deg`);
  assert.ok(Math.abs(recovered/expected-1)<.12,`recovered ${recovered} expected ${expected}`);
  assert.ok(unloaded.angle>loaded.angle,'the bend opens up on release');
  assert.ok(Math.abs(unloaded.force)<1e-9,'the punch is clear');assert.ok(history.every(h=>h.eroded===0));
});

test('bend radius and cracking: 6061-T6 over a 1 mm nose cracks; S355 over an 8 mm nose bends past 125 degrees without cracking',()=>{
  const tight=run({material:AL6061,punchRadius:.5*t},1.6*t,16);
  const first=tight.history.findIndex(h=>h.eroded>0);
  console.log(`# 6061-T6, r = 0.5 t: first erosion at stroke ${(tight.history[first]?.stroke/t).toFixed(2)} t, angle ${tight.history[first]?.angle.toFixed(1)} deg; peak force ${(Math.max(...tight.history.map(h=>h.force))/1e3).toFixed(1)} kN/m, last ${(tight.loaded.force/1e3).toFixed(1)} kN/m`);
  // The outer fibre of a sheet bent round a radius R stretches by about t / (2 R + t): 50% at R = t / 2, far above 6061-T6's 12%
  // elongation. The crack must open (elements erode) and the punch force must fall to a fraction of its peak.
  assert.ok(first>=0,'the aluminium cracks');assert.ok(tight.loaded.force<.5*Math.max(...tight.history.map(h=>h.force)),'the cracked section carries less');
  const wide=run({material:S355,punchRadius:4*t,dieOpening:14*t,cells:{thickness:4,length:34}},3.2*t,20);
  const R=4*t,estimate=2/Math.sqrt(3)*Math.log((R+t)/(R+t/2)),p=wide.pb.maxPlasticStrain;
  console.log(`# S355, R = 4 t: angle ${wide.loaded.angle.toFixed(1)} deg, largest plastic strain ${p.toFixed(3)}, wrapped-section estimate ${estimate.toFixed(3)}, failure strain ${S355.failureStrain.toFixed(3)}`);
  assert.equal(wide.pb.body.erodedCount,0,'no crack');assert.ok(wide.loaded.angle<125,'bent past 125 degrees');
  // The estimate is the outer fibre of a section wrapped on the nose, in plane strain: (2 / sqrt 3) ln((R + t) / (R + t / 2)).
  // The mesh concentrates the hinge in its outer cells before the sheet wraps: measured 1.4 times the estimate; the band is 0.9 to 1.6.
  assert.ok(p>.9*estimate&&p<1.6*estimate,`p ${p} estimate ${estimate}`);
});

test('press brake inputs are checked',()=>{
  assert.throws(()=>new PressBrake({material:{youngModulus:2e11,poissonRatio:.3,density:7850},thickness:t,width:1}),/yieldStress/);
  assert.throws(()=>new PressBrake({material:S355,thickness:t,width:1,cells:{thickness:3}}),/even/);
  assert.throws(()=>new PressBrake({material:S355,thickness:t,width:1,dieOpening:t}),/opening/);
});

test('the press brake resumes from a checkpoint bit for bit mid-stroke',async()=>{
  const {encodeState,decodeState}=await import('../../src/engine/checkpoint.ts');
  const make=()=>{const pb=new PressBrake({material:S355,thickness:t,width:1,dt:1/60,cells:{thickness:2,length:12}});pb.setPunchSpeed(.05*t*60);return pb;};
  const a=make();for(let i=0;i<6;i++)a.step();
  const saved=encodeState(a.saveState());
  for(let i=0;i<4;i++)a.step();const expected=encodeState(a.saveState());
  const b=make();b.restoreState(decodeState(saved));for(let i=0;i<4;i++)b.step();
  assert.ok(a.maxPlasticStrain>0);
  assert.deepEqual(encodeState(b.saveState()),expected);assert.equal(b.punchForce,a.punchForce);
});
