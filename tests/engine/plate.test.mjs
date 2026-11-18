// Kirchhoff plate on a grid (src/engine/plate.ts) against closed-form plate theory. SI units.
// Run: node --import ./scripts/register-typescript.mjs --test tests/engine/plate.test.mjs  (npm run test:plate)
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {PlateBody,navierUniform,plateFrequency,plateGridFrequency}=await import('../../src/engine/plate.ts');

const A=2.6,B=2,T=.008,GLASS={youngModulus:72e9,poissonRatio:.23,density:2500},Q=1000;
const edge=(x,y)=>x<1e-9||y<1e-9||x>A-1e-9||y>B-1e-9;
const close=(a,b,tol,label)=>assert.ok(Math.abs(a-b)<=tol*Math.abs(b),`${label}: ${a} vs ${b} (${((a/b-1)*100).toFixed(3)} %)`);
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

test('checkpoint: a cracking plate restored from saveState() continues bit for bit',async()=>{
  const {encodeState,decodeState}=await import('../../src/engine/checkpoint.ts');
  const make=()=>{const p=simplySupported([26,20],{fracture:{strength:41e6,tie:2e4}});return p;},c=n=>n,load=(p,s)=>{p.force.fill(0);if(s<400)p.force[p.node(13,10)]=-4e3;};
  const a=make(),h=.9*a.stableTimeStep();for(let s=0;s<300;s++){load(a,s);a.advance(h);}
  const saved=decodeState(encodeState(a.saveState())),b=make();b.restoreState(saved);
  for(let s=300;s<1500;s++){load(a,s);load(b,s);a.advance(h);b.advance(h);}
  assert.deepEqual([...b.w],[...a.w]);assert.deepEqual([...b.broken],[...a.broken]);assert.ok(a.broken.some(Boolean));void c;
});

// ---- Von Karman plate (membrane: true) ----
const {levy,LEVY}=await import('../../validation/domains/plate.mjs');
const square=(n,extra={})=>{const p=new PlateBody({size:[1,1],cells:[n,n],thickness:.01,material:{youngModulus:70e9,poissonRatio:.316,density:2700},membrane:true,...extra});const rim=p.selectNodes((x,y)=>x<1e-9||x>1-1e-9||y<1e-9||y>1-1e-9);p.hold(rim);p.holdInPlane(rim);return p;};
const pressure=(p,load)=>{const q=load*70e9*1e-8;for(let n=0;n<p.nodeCount;n++)p.force[n]=q*p.area[n];};

test('von Karman plate: centre deflection of a square plate under uniform pressure against Levy (NACA Report 737), edges held and edges free to move',async()=>{
  // 1 %: Levy's six-term series is itself good to about 1 % at the largest loads (he says so, and brackets the true values).
  for(const [load,w,tension] of LEVY.held){
    const r=await levy('held',load);
    console.log(`# edges held, ${load}: w / h ${r.w.toFixed(4)} (Levy ${w}, linear ${r.linear.toFixed(3)}); edge tension ${r.tension.toFixed(3)} (Levy ${tension}); centre membrane ${r.membrane.toFixed(2)}, bending ${r.bending.toFixed(2)} E h^2 / a^2; ${r.steps} steps`);
    assert.ok(r.converged);close(r.w,w,.01,`held ${load}`);
    // 4 %: measured 1.6 to 3.3 % above Levy's Table 10.
    close(r.tension,tension,.04,`edge tension ${load}`);
  }
  for(const [load,w] of LEVY.free){
    const r=await levy('free',load);
    console.log(`# edges free and straight, ${load}: w / h ${r.w.toFixed(4)} (Levy ${w}); net edge force ${r.tension.toExponential(1)}`);
    assert.ok(r.converged);close(r.w,w,.01,`free ${load}`);
    assert.ok(Math.abs(r.tension)<1e-6,'the tied edges carry no net force');
  }
  const top=await levy('held',278.5);
  assert.ok(top.w>1.827&&top.w<1.846,`inside Levy's bracket for the true value: ${top.w}`);
  const free=await levy('free',247);assert.ok(free.w>2.704&&free.w<2.743,`inside Levy's bracket: ${free.w}`);
  const coarse=await levy('held',278.5,8),fine=await levy('held',278.5,32);
  console.log(`# mesh: ${coarse.w.toFixed(4)}, ${top.w.toFixed(4)}, ${fine.w.toFixed(4)} on 8, 16, 32 cells`);
  assert.ok(Math.abs(coarse.w/fine.w-1)<.015&&Math.abs(top.w/fine.w-1)<.004);
});

test('von Karman plate: a small load gives the linear plate; the forces are the gradient of the energy; the explicit step keeps its energy',()=>{
  // 1e-5 of the thickness: the membrane terms are of second order in w / h.
  const small=square(8),linear=new PlateBody({size:[1,1],cells:[8,8],thickness:.01,material:{youngModulus:70e9,poissonRatio:.316,density:2700}});
  linear.hold(linear.selectNodes((x,y)=>x<1e-9||x>1-1e-9||y<1e-9||y>1-1e-9));
  pressure(small,1e-3);pressure(linear,1e-3);small.relax({tolerance:1e-10});linear.solveStatic();
  const c=small.node(4,4);close(small.w[c],linear.w[c],1e-6,'small deflection');
  // Gradient: with the in-plane displacements in equilibrium, d E / d w is the internal force (central differences).
  const p=square(8);for(let n=0;n<p.nodeCount;n++)if(!p.fixed[n])p.w[n]=.02*Math.sin(Math.PI*p.x(n))*Math.sin(Math.PI*p.y(n))*(1+.3*Math.sin(7*n));
  p.advance(1e-12);
  let worst=0;
  for(const n of [p.node(4,4),p.node(2,5),p.node(6,1)]){
    const w0=p.w[n],d=1e-6;p.w[n]=w0+d;const up=p.strainEnergy();p.w[n]=w0-d;const down=p.strainEnergy();p.w[n]=w0;
    p.v.fill(0);const before=p.v[n];p.advance(1e-9);const force=-(p.v[n]-before)*p.mass[n]/1e-9;p.v.fill(0);
    worst=Math.max(worst,Math.abs(force/((up-down)/(2*d))-1));
  }
  console.log(`# force against the energy gradient: ${worst.toExponential(2)}`);
  assert.ok(worst<1e-5,`gradient ${worst}`);
  // Free vibration of the first mode shape at an amplitude of two thicknesses: symplectic Euler keeps the energy within an
  // oscillation of order omega h that does not grow (the same bound in the second half of the run as in the first).
  const ring=(fraction,steps)=>{
    const q=square(8);for(let n=0;n<q.nodeCount;n++)if(!q.fixed[n])q.w[n]=.02*Math.sin(Math.PI*q.x(n))*Math.sin(Math.PI*q.y(n));
    const h=fraction*q.stableTimeStep(),E0=q.kineticEnergy()+q.strainEnergy();let first=0,second=0,least=Infinity;
    for(let k=0;k<steps;k++){q.advance(h);least=Math.min(least,q.stableTimeStep());if(k%10===0){const e=Math.abs((q.kineticEnergy()+q.strainEnergy())/E0-1);if(k<steps/2)first=Math.max(first,e);else second=Math.max(second,e);}}
    return {first,second,least};
  };
  const coarse=ring(.2,6000),fine=ring(.1,12000);
  console.log(`# energy within ${coarse.first.toExponential(2)} then ${coarse.second.toExponential(2)} at 0.2 of the limit, ${fine.first.toExponential(2)} then ${fine.second.toExponential(2)} at 0.1; the limit fell to ${(coarse.least/linear.stableTimeStep()).toFixed(3)} of the linear plate's`);
  assert.ok(coarse.second<1.2*coarse.first+1e-4&&fine.second<1.2*fine.first+1e-4,'no drift');
  assert.ok(fine.first<.7*coarse.first,'the oscillation shrinks with the step');
  assert.ok(coarse.first<.03,`energy ${coarse.first}`);
  assert.ok(coarse.least<linear.stableTimeStep(),'membrane tension lowers the stable step');
  assert.throws(()=>{const q=square(8);pressure(q,300);q.relax();q.advance(.99*linear.stableTimeStep());},/stability limit/);
});

test('von Karman plate: the fracture check adds the membrane stress to the bending stress; checkpoints carry the in-plane state',async()=>{
  const {encodeState,decodeState}=await import('../../src/engine/checkpoint.ts');
  // At p a^4 / (E h^4) = 132 the centre's surface stress is membrane plus bending; the plate's largest is elsewhere (the corners twist).
  const r=await levy('held',132),unit=70e9*1e-4,bending=r.bending*unit,total=(r.membrane+r.bending)*unit;
  const sound=square(16,{fracture:{strength:1e12}});pressure(sound,132);sound.relax({tolerance:1e-7});sound.advance(1e-9);
  let bendingPeak=0;for(let n=0;n<sound.nodeCount;n++)bendingPeak=Math.max(bendingPeak,sound.surfaceStress(n));
  console.log(`# centre: bending ${(bending/1e6).toFixed(1)} MPa, with membrane ${(total/1e6).toFixed(1)} MPa; largest in the plate ${(sound.peakStress/1e6).toFixed(1)} MPa, by bending alone ${(bendingPeak/1e6).toFixed(1)} MPa`);
  assert.ok(sound.peakStress>=total*(1-1e-9),'the check sees at least the centre\'s membrane + bending stress');
  assert.ok(sound.peakStress>1.05*bendingPeak,'and more than bending alone anywhere');
  // A strength between the two: bending alone would not crack it, membrane plus bending does.
  const cracked=square(16,{fracture:{strength:.5*(bendingPeak+sound.peakStress)}});pressure(cracked,132);cracked.relax({tolerance:1e-7});
  assert.ok(cracked.advance(1e-9)>0,'a strength below membrane + bending cracks');
  const spared=square(16,{fracture:{strength:1.01*sound.peakStress}});pressure(spared,132);spared.relax({tolerance:1e-7});
  assert.equal(spared.advance(1e-9),0);
  // Checkpoint: a cracking von Karman plate resumes bit for bit; a linear plate's checkpoint has no in-plane fields.
  const make=()=>square(12,{fracture:{strength:60e6}}),load=(p,s)=>{p.force.fill(0);if(s<600)p.force[p.node(6,6)]=-6000;};
  const a=make();for(let s=0;s<200;s++){load(a,s);a.advance(.5*a.stableTimeStep());}
  const saved=decodeState(encodeState(a.saveState())),b=make();b.restoreState(saved);
  for(let s=200;s<900;s++){load(a,s);load(b,s);const h=.5*a.stableTimeStep();a.advance(h);b.advance(h);}
  assert.deepEqual([...b.w],[...a.w]);assert.deepEqual([...b.uv],[...a.uv]);assert.deepEqual([...b.broken],[...a.broken]);assert.ok(a.broken.some(Boolean),'it cracked');
  const plain=simplySupported([6,6]).saveState();
  assert.ok(!('uv' in plain)&&!('cellForce' in plain)&&plain.membrane===false);
  assert.throws(()=>simplySupported([6,6]).holdInPlane([0]),/membrane/);
});

// ---- Graded grid (`lines`): cells split in two around the centre, as the glass lab refines around its impact ----
/** Node lines of `cells` equal cells over `size`, each cell within `half` of `at` split `factor` times. */
const graded=(size,cells,at,half,factor)=>{const h=size/cells,out=[0];for(let i=0;i<cells;i++){const a=i*h,b=(i+1)*h,s=b>at-half+1e-9&&a<at+half-1e-9?factor:1;for(let k=1;k<=s;k++)out.push(k===s?b:a+(b-a)*k/s);}out[out.length-1]=size;return out;};
const PANE_LINES={x:graded(A,26,A/2,.3,2),y:graded(B,20,B/2,.3,2)};
function gradedPane(extra={}){const p=new PlateBody({size:[A,B],cells:[PANE_LINES.x.length-1,PANE_LINES.y.length-1],lines:PANE_LINES,thickness:T,material:GLASS,...extra});p.hold(p.selectNodes(edge));return p;}
const centreOf=p=>p.selectNodes((x,y)=>Math.abs(x-A/2)<1e-9&&Math.abs(y-B/2)<1e-9)[0];

test('graded grid: the undamaged pane still matches Navier, the first Kirchhoff mode and the first-crack pressure',()=>{
  const p=gradedPane();assert.equal(p.cx,32);assert.equal(p.cy,26);
  let area=0;for(let n=0;n<p.nodeCount;n++)area+=p.area[n];assert.ok(Math.abs(area/(A*B)-1)<1e-14,'the nodes share the pane');
  for(let n=0;n<p.nodeCount;n++)p.force[n]=Q*p.area[n];p.solveStatic({tolerance:1e-13});
  const c=centreOf(p),[mx,my]=p.moments(c),ex=navierUniform(A,B,p.rigidity,GLASS.poissonRatio,Q),err={w:p.w[c]/ex.deflection-1,mx:mx/ex.mx-1,my:my/ex.my-1};
  // The second difference is first order where the spacing changes (0.1 to 0.05 m), so the deflection is not as close as on
  // the equal grid (8.7e-6); the moments keep the equal grid's tolerances.
  console.log('# graded navier',JSON.stringify(err));
  assert.ok(Math.abs(err.w)<2e-4&&Math.abs(err.mx)<2e-3&&Math.abs(err.my)<3e-3);
  let lo=0,hi=1e6;
  for(let k=0;k<50;k++){const q=.5*(lo+hi),r=gradedPane({fracture:{strength:41e6}});for(let n=0;n<r.nodeCount;n++)r.force[n]=q*r.area[n];r.solveStatic({tolerance:1e-13});if(r.checkFracture()>0)hi=q;else lo=q;}
  const unit=navierUniform(A,B,p.rigidity,GLASS.poissonRatio,1),theory=41e6*T*T/(6*Math.max(unit.mx,unit.my));
  console.log('# graded onset',JSON.stringify({qc:hi,theory,ratio:hi/theory}));
  assert.ok(hi/theory>1&&hi/theory<1.02,'first crack within the equal grid\'s 2 %, never early');
  const q=gradedPane(),cq=centreOf(q);for(let n=0;n<q.nodeCount;n++)q.w[n]=1e-3*Math.sin(Math.PI*q.x(n)/A)*Math.sin(Math.PI*q.y(n)/B);
  const h=.5*q.stableTimeStep();let prev=q.w[cq];const crossings=[];
  for(let s=0;s<200000&&crossings.length<12;s++){q.advance(h);const w=q.w[cq];if(prev>0&&w<=0)crossings.push((s+prev/(prev-w))*h);prev=w;}
  const f=(crossings.length-1)/(crossings.at(-1)-crossings[0]),theoryF=plateFrequency(A,B,p.rigidity,GLASS.density*T,1,1);
  console.log('# graded frequency',JSON.stringify({f,theory:theoryF,error:f/theoryF-1}));
  assert.ok(Math.abs(f/theoryF-1)<2.5e-3,'(1,1) mode within the equal grid\'s 0.25 %');
});

test('graded grid: von Karman centre deflection and edge tension against Levy (Table 9 and 10), as on the equal grid',()=>{
  for(const [load,w,tension] of LEVY.held){
    const lines={x:graded(1,16,.5,.125,2),y:graded(1,16,.5,.125,2)},n=lines.x.length-1;
    const p=new PlateBody({size:[1,1],cells:[n,n],lines,thickness:.01,material:{youngModulus:70e9,poissonRatio:.316,density:2700},membrane:true});
    const rim=p.selectNodes((x,y)=>x<1e-9||x>1-1e-9||y<1e-9||y>1-1e-9);p.hold(rim);p.holdInPlane(rim);pressure(p,load);
    const r=p.relax({tolerance:1e-7}),c=p.selectNodes((x,y)=>Math.abs(x-.5)<1e-9&&Math.abs(y-.5)<1e-9)[0];
    // Average tension across the middle section x = 0.5 (the cells on either side, weighted by their height).
    const mid=p.xs.indexOf(.5);let t=0;for(let j=0;j<n;j++)t+=(p.cellForce[3*(j*n+mid)]+p.cellForce[3*(j*n+mid-1)])/2*p.dy[j];
    const edgeTension=t/.01*1/(70e9*.01*.01);
    console.log(`# graded, edges held, ${load}: w / h ${(p.w[c]/.01).toFixed(4)} (Levy ${w}); edge tension ${edgeTension.toFixed(3)} (Levy ${tension}); ${r.steps} steps, ${n} x ${n} cells`);
    assert.ok(r.converged);close(p.w[c]/.01,w,.01,`graded held ${load}`);close(edgeTension,tension,.04,`graded edge tension ${load}`);
  }
});
