// Viscoelastic tetrahedral solid (src/engine/solid.ts, config.viscoelastic): a Prony series on the elastic stress,
// against the closed-form standard linear solid. SI units.
// Run: node --test tests/engine/solid-viscoelastic.test.mjs  (part of npm run test:solid)
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {SolidBody,boxMesh}=await import('../../src/engine/solid.ts');

// Long-term modulus E, one branch of ratio gamma and time tau: E(t) = E (1 + gamma exp(-t / tau)).
const E=2e6,GAMMA=1.5,TAU=2,L=.1,A=.02*.02;
const near=(a,b)=>Math.abs(a-b)<1e-12;
function bar({model='linear',dt=TAU/200,density=1,nu=0}={}){
  return new SolidBody({mesh:boxMesh({size:[L,.02,.02],cells:[4,1,1]}),material:{youngModulus:E,poissonRatio:nu,density},
    config:{model,dt,massDamping:0,tolerance:1e-12,viscoelastic:{branches:[{ratio:GAMMA,time:TAU}]}}});
}
/** Mean axial stress over the elements (Pa). */
const axial=b=>{const s=b.stresses();let m=0;for(let e=0;e<b.tetCount;e++)m+=s[6*e];return m/b.tetCount;};

test('relaxation: a strain held from the first step relaxes by the discrete Prony recursion, which approaches E (1 + gamma exp(-t / tau))',()=>{
  const dt=TAU/200,b=bar({dt}),eps=.01;
  // Every node prescribed: a uniform strain with no inertia, so this checks the stress history alone.
  for(let n=0;n<b.nodeCount;n++){const x=b.referencePositions[3*n];b.constrain([n],[eps*x,0,0]);}
  const a=Math.exp(-dt/TAU),beta=(1-a)/(dt/TAU);let worstDiscrete=0,atTau=0;
  for(let n=1;n<=600;n++){
    b.step();const s=axial(b),discrete=E*eps*(1+GAMMA*beta*a**(n-1));worstDiscrete=Math.max(worstDiscrete,Math.abs(s/discrete-1));
    if(n===200)atTau=s/(E*eps*(1+GAMMA*Math.exp(-1)))-1;
  }
  console.log('# relaxation',JSON.stringify({worstDiscrete,atTau}));
  assert.ok(worstDiscrete<1e-9,'the recursion, exactly');assert.ok(Math.abs(atTau)<.01,'the continuum at t = tau, first order in dt');
});

/** Creep of a bar under a constant end traction, then recovery after unloading. Light material: inertia negligible. */
function creep(dt){
  const b=bar({dt,density:1e-3}),sigma=5e4,end=b.selectFaces((cx,cy,cz,nx)=>nx>.999),tip=b.selectNodes(x=>x>L-1e-9);
  b.constrain(b.selectNodes(x=>x<1e-9),[0,null,null]);b.constrain(b.selectNodes((x,y)=>y<1e-9),[null,0,null]);b.constrain(b.selectNodes((x,y,z)=>z<1e-9),[null,null,0]);
  b.addTraction(end,[sigma,0,0]);
  const strain=()=>{let s=0;for(const n of tip)s+=b.displacements[3*n];return s/tip.length/L;};
  const tauC=TAU*(1+GAMMA),out={};
  const steps=t=>Math.round(t/dt);
  for(let n=1;n<=steps(3*tauC);n++){b.step();if(n===steps(tauC))out.atTauC=strain();}
  out.loaded=strain();b.addTraction(end,[-sigma,0,0]);
  for(let n=1;n<=steps(tauC);n++){b.step();if(n===1)out.instant=strain();}
  out.recovered=strain();
  const e0=sigma/(E*(1+GAMMA)),einf=sigma/E,creepAt=t=>einf-(einf-e0)*Math.exp(-t/tauC);
  const residual=creepAt(3*tauC)-e0;
  return {...out,expected:{atTauC:creepAt(tauC),loaded:creepAt(3*tauC),instant:residual,recovered:residual*Math.exp(-1)},e0,einf};
}
test('creep and recovery of a bar under constant stress follow the standard linear solid, retardation time tau (1 + gamma)',()=>{
  const coarse=creep(TAU/100),fine=creep(TAU/200);
  const err=r=>({atTauC:r.atTauC/r.expected.atTauC-1,loaded:r.loaded/r.expected.loaded-1,instant:r.instant/r.expected.instant-1,recovered:r.recovered/r.expected.recovered-1});
  const c=err(coarse),f=err(fine);console.log('# creep',JSON.stringify({coarse:c,fine:f}));
  for(const k of Object.keys(f))assert.ok(Math.abs(f[k])<.01,`${k}: ${f[k]}`);
  // Backward Euler and the recursion are first order: halving the step halves the error.
  const order=Math.log2(Math.abs(c.atTauC)/Math.abs(f.atTauC));assert.ok(order>.8&&order<1.2,`order ${order}`);
});

test('finite strain: a Neo-Hookean block held at a stretch of 1.5 relaxes from (1 + gamma b) times its elastic stress to the elastic stress',()=>{
  const dt=TAU/50,b=bar({model:'neo-hookean',dt,nu:.3}),elastic=bar({model:'neo-hookean',dt,nu:.3});
  // Uniform stretch 1.5 along x with the lateral stretch q free... held here at q = 1 for a closed form: a uniform F.
  for(const body of [b,elastic])for(let n=0;n<body.nodeCount;n++){const x=body.referencePositions[3*n];body.constrain([n],[.5*x,0,0]);}
  const reference=elastic.solveStatic();void reference;
  const target=axial(elastic),a=Math.exp(-dt/TAU),beta=(1-a)/(dt/TAU);let worst=0;
  for(let n=1;n<=400;n++){b.step();worst=Math.max(worst,Math.abs(axial(b)/(target*(1+GAMMA*beta*a**(n-1)))-1));}
  console.log('# neo-hookean',JSON.stringify({worst,target}));
  assert.ok(worst<1e-9);assert.ok(Math.abs(axial(b)/target-1)<1e-3,'relaxed to the elastic stress after 16 tau');
});

test('statics are the relaxed (long-term) response; only backward Euler takes a viscoelastic body',()=>{
  const b=bar(),plain=new SolidBody({mesh:boxMesh({size:[L,.02,.02],cells:[4,1,1]}),material:{youngModulus:E,poissonRatio:0,density:1},config:{model:'linear',tolerance:1e-12}});
  for(const body of [b,plain]){body.constrain(body.selectNodes(x=>x<1e-9));body.addTraction(body.selectFaces((cx,cy,cz,nx)=>nx>.999),[1e4,0,0]);}
  const r=b.solveStatic(),p=plain.solveStatic();let d=0;for(let j=0;j<r.displacements.length;j++)d=Math.max(d,Math.abs(r.displacements[j]-p.displacements[j]));
  assert.ok(d<1e-15);
  for(const integrator of ['midpoint','explicit'])assert.throws(()=>new SolidBody({mesh:boxMesh({size:[L,.02,.02],cells:[2,1,1]}),material:{youngModulus:E,poissonRatio:0,density:1},config:{integrator,viscoelastic:{branches:[{ratio:1,time:1}]}}}),/backward-euler/);
  assert.ok(near(b.viscoelasticScale,1+GAMMA*(1-Math.exp(-(TAU/200)/TAU))/((TAU/200)/TAU)));
});

test('determinism: a viscoelastic creep run repeats bit for bit',()=>{
  const run=()=>{const b=bar({density:1e-3});b.constrain(b.selectNodes(x=>x<1e-9));b.addTraction(b.selectFaces((cx,cy,cz,nx)=>nx>.999),[3e4,0,0]);b.step(50);return [...b.displacements];};
  assert.deepEqual(run(),run());
});

test('through SolidContact: a viscoelastic cube resting on a plane creeps under its weight to the elastic settlement',async()=>{
  const {SolidContact}=await import('../../src/engine/solid-contact.ts');
  // A soft 0.1 m cube (rho 1000, E = 20 kPa long-term, nu = 0) on a fixed plane, gravity on from rest.
  const size=.1,rho=1000,Einf=2e4,tau=.5,dt=1/100;
  const cube=new SolidBody({mesh:boxMesh({size:[size,size,size],cells:[2,2,2]}),material:{youngModulus:Einf,poissonRatio:0,density:rho},
    config:{model:'linear',dt,massDamping:20,gravity:[0,-9.81,0],tolerance:1e-10,viscoelastic:{branches:[{ratio:3,time:tau}]}}});
  const contact=new SolidContact(cube,{gravity:[0,-9.81,0]});
  contact.addBody({shape:{kind:'plane',normal:[0,1,0]},type:'static',position:[0,0,0],rotation:[0,0,0,1]});
  const top=cube.selectNodes((x,y)=>y>size-1e-9),settle=()=>{let s=0;for(const n of top)s+=cube.displacements[3*n+1];return -s/top.length;};
  contact.step(5);const early=settle();contact.step(Math.round(8*tau*4/dt));const late=settle();
  const elastic=rho*9.81*size*size/(2*Einf);
  console.log('# contact creep',JSON.stringify({early,late,elastic}));
  assert.ok(early<.5*elastic,'stiff at first');assert.ok(Math.abs(late/elastic-1)<.03,`relaxed settlement ${late} against ${elastic}`);
});

test('checkpoint: a creeping viscoelastic bar restored from saveState() continues bit for bit',async()=>{
  const {encodeState,decodeState}=await import('../../src/engine/checkpoint.ts');
  const make=()=>{const b=bar({density:1e-3});b.constrain(b.selectNodes(x=>x<1e-9));b.addTraction(b.selectFaces((cx,cy,cz,nx)=>nx>.999),[3e4,0,0]);return b;};
  const a=make();a.step(40);const b=make();b.restoreState(decodeState(encodeState(a.saveState())));
  a.step(60);b.step(60);assert.deepEqual([...b.displacements],[...a.displacements]);assert.deepEqual(b.stresses(),a.stresses());
});
