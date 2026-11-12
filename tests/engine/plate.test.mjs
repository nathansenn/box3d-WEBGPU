// Kirchhoff plate on a grid (src/engine/plate.ts) against closed-form plate theory. SI units.
// Run: node --import ./scripts/register-typescript.mjs --test tests/engine/plate.test.mjs  (npm run test:plate)
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {PlateBody,navierUniform,plateFrequency,plateGridFrequency}=await import('../../src/engine/plate.ts');

const A=2.6,B=2,T=.008,GLASS={youngModulus:72e9,poissonRatio:.23,density:2500},Q=1000;
const edge=(x,y)=>x<1e-9||y<1e-9||x>A-1e-9||y>B-1e-9;
/** A simply supported plate: every edge node held at w = 0 (the moment there is zero by construction). */
function simplySupported(cells,extra={}){const p=new PlateBody({size:[A,B],cells,thickness:T,material:GLASS,...extra});p.hold(p.selectNodes(edge));return p;}
function navierStatic(cells){
  const p=simplySupported(cells);for(let n=0;n<p.nodeCount;n++)p.force[n]=Q*p.area[n];p.solveStatic();
  const c=p.node(cells[0]/2,cells[1]/2),[mx,my]=p.moments(c),ex=navierUniform(A,B,p.rigidity,GLASS.poissonRatio,Q);
  return {w:p.w[c]/ex.deflection-1,mx:mx/ex.mx-1,my:my/ex.my-1};
}

test('static: uniform pressure on a simply supported plate matches the Navier series; moments converge at second order',()=>{
  const coarse=navierStatic([26,20]),fine=navierStatic([52,40]);
  console.log('# navier',JSON.stringify({coarse,fine}));
  assert.ok(Math.abs(coarse.w)<2e-5&&Math.abs(fine.w)<1e-5,'centre deflection');
  assert.ok(Math.abs(coarse.mx)<2e-3&&Math.abs(coarse.my)<3e-3,'centre moments at 0.1 m cells');
  const order=Math.log2(coarse.my/fine.my);assert.ok(order>1.9&&order<2.1,`moment order ${order}`);
});

test('dynamics: the (1,1) mode rings at the exact grid frequency, which approaches Kirchhoff theory',()=>{
  const cells=[26,20],p=simplySupported(cells),D=p.rigidity,mu=GLASS.density*T;
  for(let n=0;n<p.nodeCount;n++)p.w[n]=1e-3*Math.sin(Math.PI*p.x(n)/A)*Math.sin(Math.PI*p.y(n)/B);
  const h=.5*p.stableTimeStep(),c=p.node(13,10),E0=p.kineticEnergy()+p.strainEnergy();let prev=p.w[c],crossings=[],drift=0;
  for(let s=0;s<40000;s++){p.advance(h);const w=p.w[c];if(prev>0&&w<=0)crossings.push((s+prev/(prev-w))*h);prev=w;if(s%50===0)drift=Math.max(drift,Math.abs(p.kineticEnergy()+p.strainEnergy()-E0)/E0);}
  const f=(crossings.length-1)/(crossings.at(-1)-crossings[0]),grid=plateGridFrequency(A,B,cells,D,mu,1,1),theory=plateFrequency(A,B,D,mu,1,1);
  console.log('# frequency',JSON.stringify({f,grid,theory,drift}));
  assert.ok(Math.abs(f/grid-1)<1e-5,'grid frequency');assert.ok(Math.abs(grid/theory-1)<2.5e-3,'continuum frequency');
  assert.ok(drift<5e-3,'energy of the symplectic step stays within (omega h)^2 of the start');
});

test('stability: the explicit step refuses a step above its Gershgorin limit; mass damping only removes energy',()=>{
  const p=simplySupported([26,20],{massDamping:2});assert.throws(()=>p.advance(1.01*p.stableTimeStep()),/stability limit/);
  for(let n=0;n<p.nodeCount;n++)if(!p.fixed[n])p.v[n]=Math.sin(n*12.9898);
  const start=p.kineticEnergy()+p.strainEnergy(),h=.9*p.stableTimeStep();let highest=0,last=start;
  for(let s=0;s<4000;s++){p.advance(h);if(s%100===99){last=p.kineticEnergy()+p.strainEnergy();highest=Math.max(highest,last/start);}}
  // The energy of the symplectic step oscillates by about omega h about the true value; with damping it only decays.
  console.log('# damping',JSON.stringify({highest,final:last/start}));
  assert.ok(highest<1.2,`largest energy ${highest} of the start`);assert.ok(last<start*.5);assert.ok(p.dampingLoss>0);
});

/** Pressure at which the first bond of a simply supported plate breaks, found by statics and bisection. */
function onset(fracture,cells=[26,20]){
  let lo=0,hi=1e6;
  for(let k=0;k<50;k++){const q=.5*(lo+hi),p=simplySupported(cells,{fracture});for(let n=0;n<p.nodeCount;n++)p.force[n]=q*p.area[n];p.solveStatic({tolerance:1e-13});if(p.checkFracture()>0)hi=q;else lo=q;}
  return hi;
}
test('fracture: the first crack opens where the Navier surface stress reaches the strength, perpendicular to it; prestress adds to the strength',()=>{
  const strength=41e6,qc=onset({strength}),ex=navierUniform(A,B,new PlateBody({size:[A,B],cells:[2,2],thickness:T,material:GLASS}).rigidity,GLASS.poissonRatio,1);
  const theory=strength*T*T/(6*Math.max(ex.mx,ex.my));
  console.log('# onset',JSON.stringify({qc,theory,ratio:qc/theory}));
  // The check reads the moment at the middle of a bond (the mean of its two nodes), a little below the peak at the centre.
  assert.ok(qc/theory>1&&qc/theory<1.02,`onset ${qc} Pa against ${theory} Pa`);
  const tempered=onset({strength,prestress:124e6});assert.ok(Math.abs(tempered/qc-(41+124)/41)<1e-9,'linear in strength + prestress');
  const p=simplySupported([26,20],{fracture:{strength}});for(let n=0;n<p.nodeCount;n++)p.force[n]=qc*p.area[n];p.solveStatic({tolerance:1e-13});p.checkFracture();
  // My > Mx at the centre of this plate: the crack runs along x, so it cuts bonds along y.
  const cut=[...p.broken.keys()].filter(b=>p.broken[b]);assert.ok(cut.length>0);for(const b of cut)assert.ok(b>=p.cx*p.ny,'y bonds only');
});

test('cracks: a cut line splits a free plate into two pieces whose masses and momenta sum to the plate; ties keep it whole',()=>{
  for(const tie of [0,25e3]){
    const p=new PlateBody({size:[1,1],cells:[10,10],thickness:.01,material:GLASS,fracture:{strength:41e6,tie}});
    for(let n=0;n<p.nodeCount;n++)p.v[n]=.3+.1*p.x(n);
    const cut=[];for(let j=0;j<=10;j++)cut.push(p.bondX(4,j));p.breakBonds(cut);
    const pieces=p.fragments();assert.equal(pieces.length,tie?1:2);
    let mass=0,momentum=0,total=0,plateMomentum=0;for(const f of pieces){mass+=f.mass;momentum+=f.mass*f.velocity;}
    for(let n=0;n<p.nodeCount;n++){total+=p.mass[n];plateMomentum+=p.mass[n]*p.v[n];}
    assert.ok(Math.abs(mass/total-1)<1e-14&&Math.abs(momentum/plateMomentum-1)<1e-13);
    if(!tie){const [a,b]=pieces;assert.equal(a.nodes.length,5*11);assert.equal(b.nodes.length,6*11);assert.ok(Math.abs(b.angularVelocity[1]+.1)<1e-12,'rigid spin about y from the velocity gradient');}
  }
});

test('determinism: a cracking run repeats bit for bit',()=>{
  const run=()=>{const p=simplySupported([26,20],{fracture:{strength:41e6,dicingSpeed:200}});const c=p.node(13,10),h=.9*p.stableTimeStep();
    for(let s=0;s<3000;s++){p.force.fill(0);if(s<400)p.force[c]=-4e3;p.advance(h);}return {w:[...p.w],b:[...p.broken]};};
  assert.deepEqual(run(),run());
});
