// Closed-form validation of the tetrahedral solid solver (src/engine/solid.ts), SI units.
// Every tolerance is stated beside the check with its reason. Measured values are printed as
// test diagnostics (`node --test --test-reporter=tap`); docs/SOLID_MECHANICS.md quotes them.
// No check depends on wall-clock time.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,SOLID_SOLVER_ID,boxMesh,boxNode,boundaryFaces,tetVolume,symmetricEigenvalues,vonMisesStress} from '../../src/engine/solid.ts';
import {EngineError} from '../../src/engine/contracts.ts';

const MODELS=['linear','corotational','neo-hookean'];
const steel={youngModulus:200e9,poissonRatio:.3,density:7850};
const close=(actual,expected,relative,absolute=0,label='')=>assert.ok(Math.abs(actual-expected)<=absolute+relative*Math.abs(expected),`${label} ${actual} != ${expected}: error ${Math.abs(actual-expected)}, relative ${Math.abs(actual/expected-1)}`);
const invalid=(fn,code='INVALID_PAYLOAD')=>assert.throws(fn,error=>error instanceof EngineError&&error.code===code);
const order=(coarse,fine)=>Math.log2(Math.abs(coarse)/Math.abs(fine));
const lame=({youngModulus:E,poissonRatio:nu})=>({lambda:E*nu/((1+nu)*(1-2*nu)),mu:E/(2*(1+nu))});

/** Moves the interior nodes of a box mesh by a repeatable pseudo-random fraction of a cell. */
function jitter(mesh,cells,size,amount=.35){
  let seed=20261111;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5;};
  for(let k=1;k<cells[2];k++)for(let j=1;j<cells[1];j++)for(let i=1;i<cells[0];i++){
    const n=boxNode(cells,i,j,k);for(let c=0;c<3;c++)mesh.positions[3*n+c]+=amount*size[c]/cells[c]*random();
  }
  return mesh;
}
const irregular=(size,cells)=>jitter(boxMesh({size,cells}),cells,size);
const near=(a,b)=>Math.abs(a-b)<1e-9;
/** Symmetry planes x = 0, y = 0, z = 0: no rigid motion, free Poisson contraction. */
function symmetryPlanes(body,planes='xyz'){
  if(planes.includes('x'))body.constrain(body.selectNodes(x=>near(x,0)),[0,null,null]);
  if(planes.includes('y'))body.constrain(body.selectNodes((x,y)=>near(y,0)),[null,0,null]);
  if(planes.includes('z'))body.constrain(body.selectNodes((x,y,z)=>near(z,0)),[null,null,0]);
}
const facesWithNormal=(body,axis,sign)=>body.selectFaces((cx,cy,cz,nx,ny,nz)=>sign*[nx,ny,nz][axis]>.999);
const sumComponent=(values,nodes,component)=>{let s=0;for(const n of nodes)s+=values[3*n+component];return s;};
const meanComponent=(values,nodes,component)=>sumComponent(values,nodes,component)/nodes.length;
const maxAbs=values=>values.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
const bits=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength).toString('hex');

test('box mesher: positive conforming elements, exact volume, outward boundary, stated symmetry',()=>{
  for(const pattern of ['alternating5','kuhn6'])for(const cells of [[1,1,1],[2,3,4],[3,2,2]]){
    const size=[1.5,.8,.6],mesh=boxMesh({size,cells,pattern,origin:[.2,-.1,.3]}),count=mesh.tets.length/4;
    assert.equal(count,cells[0]*cells[1]*cells[2]*(pattern==='kuhn6'?6:5));
    let volume=0;for(let t=0;t<count;t++){const v=tetVolume(mesh.positions,...mesh.tets.subarray(4*t,4*t+4));assert.ok(v>0);volume+=v;}
    close(volume,size[0]*size[1]*size[2],1e-13);
    // Conforming: the boundary is exactly the box surface, closed, and encloses the volume.
    const faces=boundaryFaces(mesh),p=mesh.positions;let area=0,enclosed=0;const closed=[0,0,0];
    for(let f=0;f<faces.length;f+=3){
      const [a,b,c]=[faces[f],faces[f+1],faces[f+2]].map(n=>[p[3*n],p[3*n+1],p[3*n+2]]),u=b.map((v,k)=>v-a[k]),w=c.map((v,k)=>v-a[k]);
      const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];area+=Math.hypot(...n)/2;
      for(let k=0;k<3;k++){closed[k]+=n[k]/2;enclosed+=n[k]*(a[k]+b[k]+c[k])/18;}
    }
    close(area,2*(size[0]*size[1]+size[1]*size[2]+size[0]*size[2]),1e-13);close(enclosed,volume,1e-13);
    for(const component of closed)close(component,0,0,1e-13);
    assert.equal(faces.length/3,4*(cells[0]*cells[1]+cells[1]*cells[2]+cells[0]*cells[2]));
  }
  // alternating5 with even counts is mirror-symmetric: the lumped masses mirror about every mid-plane.
  const cells=[4,2,2],body=new SolidBody({mesh:boxMesh({size:[2,1,1],cells}),material:steel});
  for(let k=0;k<=2;k++)for(let j=0;j<=2;j++)for(let i=0;i<=4;i++){
    const m=body.nodalMass[boxNode(cells,i,j,k)];
    close(body.nodalMass[boxNode(cells,4-i,j,k)],m,1e-13);close(body.nodalMass[boxNode(cells,i,2-j,k)],m,1e-13);close(body.nodalMass[boxNode(cells,i,j,2-k)],m,1e-13);close(body.nodalMass[boxNode(cells,i,k,j)],m,1e-13);
  }
  close(body.mass,7850*2,1e-13);close(body.nodalMass.reduce((s,v)=>s+v,0),body.mass,1e-13);close(body.referenceVolume,2,1e-13);
});

test('inputs are validated and caller tetrahedra are accepted in either orientation',()=>{
  const positions=[0,0,0, 1,0,0, 0,1,0, 0,0,1];
  const flipped=new SolidBody({mesh:{positions,tets:[0,2,1,3]},material:steel});
  assert.equal(flipped.solver,SOLID_SOLVER_ID);assert.equal(SOLID_SOLVER_ID,'solid-tet-corot-js-f64-v1');
  close(flipped.referenceVolume,1/6,1e-14);assert.deepEqual([...flipped.tets],[0,2,3,1]);assert.equal(flipped.faces.length,12);
  invalid(()=>new SolidBody({mesh:{positions,tets:[0,1,2,2]},material:steel}));
  invalid(()=>new SolidBody({mesh:{positions:[0,0,0,1,0,0,2,0,0,3,0,0],tets:[0,1,2,3]},material:steel}));
  invalid(()=>new SolidBody({mesh:{positions,tets:[0,1,2,4]},material:steel}));
  invalid(()=>new SolidBody({mesh:{positions:[...positions,5,5,5],tets:[0,1,2,3]},material:steel}));
  invalid(()=>new SolidBody({mesh:{positions,tets:[0,1,2,3]},material:{...steel,poissonRatio:.5}}));
  invalid(()=>new SolidBody({mesh:{positions,tets:[0,1,2,3]},material:{...steel,youngModulus:-1}}));
  invalid(()=>new SolidBody({mesh:{positions,tets:[0,1,2,3]},material:{...steel,colour:'red'}}));
  invalid(()=>new SolidBody({mesh:{positions,tets:[0,1,2,3]},material:steel,config:{model:'plastic'}}));
  invalid(()=>new SolidBody({mesh:{positions:[0,0,NaN,1,0,0,0,1,0,0,0,1],tets:[0,1,2,3]},material:steel}));
  invalid(()=>boxMesh({size:[1,1,1],cells:[0,1,1]}));invalid(()=>boxMesh({size:[1,1,1],cells:[1,1,1],pattern:'hex'}));
  const body=new SolidBody({mesh:boxMesh({size:[1,1,1],cells:[1,1,1]}),material:steel});
  invalid(()=>body.constrain([99]));invalid(()=>body.setNodalForce(0,[0,Infinity,0]));invalid(()=>body.addPressure([1e6],1));invalid(()=>body.failedElements({criterion:'tresca',strength:1}));
  body.constrain([0]);invalid(()=>body.setState(new Float64Array(24).fill(1e-3)));
});

test('internal forces are the exact gradient of the strain energy for every model',()=>{
  // With every node constrained and no load, the reactions are the internal forces. A central
  // difference of the energy with step h has relative error O(h^2 * strain) plus rounding / h.
  for(const model of MODELS){
    const cells=[2,2,2],body=new SolidBody({mesh:irregular([1,1,1],cells),material:{...steel,thermalExpansion:1.2e-5},config:{model}}),size=3*body.nodeCount;
    body.setTemperatureChange(40);
    const u=Float64Array.from({length:size},(_,j)=>.03*Math.sin(1.3*j)),direction=Float64Array.from({length:size},(_,j)=>Math.cos(.7*j));
    const energyAt=state=>{for(let n=0;n<body.nodeCount;n++)body.constrain([n],[state[3*n],state[3*n+1],state[3*n+2]]);body.setState(state);return body.strainEnergy();};
    const h=1e-6,plus=energyAt(u.map((v,j)=>v+h*direction[j])),minus=energyAt(u.map((v,j)=>v-h*direction[j]));energyAt(u);
    const work=body.reactions().reduce((s,f,j)=>s+f*direction[j],0);
    close((plus-minus)/(2*h),work,1e-8,0,model);
  }
});

test('patch test: an arbitrary uniform strain is reproduced on an irregular mesh to 1e-10',t=>{
  // The basic correctness test of the element. Boundary nodes follow u = A X; the interior nodes
  // must land on the same field, because a linear field is in the element space. The tolerance
  // is the solver's, not a discretisation error.
  const A=[1.0e-3,2.0e-4,-3.0e-4, 4.0e-4,-2.0e-3,5.0e-4, -1.0e-4,3.0e-4,1.5e-3],size=[1.2,.9,.7],cells=[3,3,3];
  for(const model of MODELS){
    const body=new SolidBody({mesh:irregular(size,cells),material:steel,config:{model,tolerance:1e-13}}),X=body.referencePositions;
    const field=n=>[0,1,2].map(i=>A[3*i]*X[3*n]+A[3*i+1]*X[3*n+1]+A[3*i+2]*X[3*n+2]);
    const boundary=body.selectNodes((x,y,z)=>near(x,0)||near(x,size[0])||near(y,0)||near(y,size[1])||near(z,0)||near(z,size[2]));
    assert.equal(body.nodeCount-boundary.length,8,'eight interior nodes are solved for');
    for(const n of boundary)body.constrain([n],field(n));
    const result=body.solveStatic();assert.ok(result.converged,JSON.stringify(result.reason));
    let error=0,scale=0;
    for(let n=0;n<body.nodeCount;n++){const f=field(n);for(let i=0;i<3;i++){error=Math.max(error,Math.abs(result.displacements[3*n+i]-f[i]));scale=Math.max(scale,Math.abs(f[i]));}}
    assert.ok(error<=1e-10*scale,`${model}: displacement error ${error/scale}`);
    t.diagnostic(`patch ${model}: max displacement error / max displacement = ${(error/scale).toExponential(2)}`);
    if(model!=='linear')continue;
    // Uniform stress lambda tr(eps) I + 2 mu eps and uniform strain in every element.
    const {lambda,mu}=lame(steel),eps=[A[0],A[4],A[8],.5*(A[5]+A[7]),.5*(A[2]+A[6]),.5*(A[1]+A[3])],trace=eps[0]+eps[1]+eps[2],sigma=eps.map((e,k)=>2*mu*e+(k<3?lambda*trace:0));
    const stress=body.stresses(),strain=body.strains(),reference=maxAbs(sigma);let stressError=0;
    for(let e=0;e<body.tetCount;e++)for(let k=0;k<6;k++){stressError=Math.max(stressError,Math.abs(stress[6*e+k]-sigma[k]));close(strain[6*e+k],eps[k],0,1e-13);}
    assert.ok(stressError<=1e-10*reference,`stress error ${stressError/reference}`);
    t.diagnostic(`patch linear: max stress error / max stress = ${(stressError/reference).toExponential(2)}`);
    close(result.strainEnergy,.5*size[0]*size[1]*size[2]*sigma.reduce((s,v,k)=>s+v*eps[k]*(k<3?1:2),0),1e-11);
  }
});

test('uniaxial tension: elongation F L / (E A), lateral strain -nu, uniform stress F / A',t=>{
  // A traction-driven patch test on an irregular mesh: the exact solution is a uniform strain,
  // so the only error is the solver tolerance (1e-9 asked of the 1e-12 solve).
  const L=2,b=.3,h=.2,A=b*h,F=5e4,{youngModulus:E,poissonRatio:nu}=steel,cells=[6,2,2];
  const body=new SolidBody({mesh:irregular([L,b,h],cells),material:steel,config:{model:'linear',tolerance:1e-12}});
  symmetryPlanes(body);body.addTraction(facesWithNormal(body,0,1),[F/A,0,0]);
  const result=body.solveStatic();assert.ok(result.converged);
  const end=body.selectNodes(x=>near(x,L)),side=body.selectNodes((x,y)=>near(y,b)),top=body.selectNodes((x,y,z)=>near(z,h)),strain=F/(E*A);
  for(const n of end)close(result.displacements[3*n],F*L/(E*A),1e-9);
  for(const n of side)close(result.displacements[3*n+1],-nu*strain*b,1e-9);
  for(const n of top)close(result.displacements[3*n+2],-nu*strain*h,1e-9);
  const stress=body.stresses(),strains=body.strains(),mises=body.vonMises(),principal=body.principalStresses(),sigma=F/A;
  for(let e=0;e<body.tetCount;e++){
    close(stress[6*e],sigma,1e-9);for(let k=1;k<6;k++)close(stress[6*e+k],0,0,1e-9*sigma);
    close(strains[6*e],strain,1e-9);close(strains[6*e+1],-nu*strain,1e-9);close(strains[6*e+2],-nu*strain,1e-9);
    close(mises[e],sigma,1e-9);close(principal[3*e],sigma,1e-9);close(principal[3*e+1],0,0,1e-9*sigma);close(principal[3*e+2],0,0,1e-9*sigma);
  }
  // Reactions balance the load; energy is F^2 L / (2 E A); the volume grows by (1 - 2 nu) strain to first order.
  close(sumComponent(result.reactions,body.selectNodes(x=>near(x,0)),0),-F,1e-10);
  close(result.reactions.reduce((s,v,j)=>s+(j%3===1?v:0),0),0,0,1e-9*F);
  close(result.strainEnergy,F*F*L/(2*E*A),1e-9);close(body.loadPotential(),-F*F*L/(E*A),1e-9);
  close(body.volume(),L*A*(1+strain)*(1-nu*strain)**2,1e-12);
  t.diagnostic(`tension: elongation ${meanComponent(result.displacements,end,0)} m, expected ${F*L/(E*A)}; stress ${stress[0]} Pa, expected ${sigma}`);
});

test('simple shear gives G = E / (2 (1 + nu)) and hydrostatic pressure gives K = E / (3 (1 - 2 nu))',t=>{
  const {youngModulus:E,poissonRatio:nu}=steel,G=E/(2*(1+nu)),K=E/(3*(1-2*nu)),L=1,cells=[3,3,3];
  // Pure shear stress tau applied as tractions on four faces; the displacement u_x = (tau / G) y
  // is pinned by six components at three corner nodes that the solution leaves at rest.
  const shear=new SolidBody({mesh:irregular([L,L,L],cells),material:steel,config:{model:'linear',tolerance:1e-12}}),tau=4e7;
  shear.addTraction(facesWithNormal(shear,1,1),[tau,0,0]);shear.addTraction(facesWithNormal(shear,1,-1),[-tau,0,0]);
  shear.addTraction(facesWithNormal(shear,0,1),[0,tau,0]);shear.addTraction(facesWithNormal(shear,0,-1),[0,-tau,0]);
  shear.constrain([boxNode(cells,0,0,0)],[0,0,0]);shear.constrain([boxNode(cells,3,0,0)],[null,0,0]);shear.constrain([boxNode(cells,0,0,3)],[0,null,null]);
  const sheared=shear.solveStatic();assert.ok(sheared.converged);
  const gamma=sheared.displacements[3*boxNode(cells,0,3,0)]/L;close(tau/gamma,G,1e-9,0,'shear modulus');
  const X=shear.referencePositions;for(let n=0;n<shear.nodeCount;n++){close(sheared.displacements[3*n],tau/G*X[3*n+1],0,1e-9*tau/G);close(sheared.displacements[3*n+1],0,0,1e-9*tau/G);close(sheared.displacements[3*n+2],0,0,1e-9*tau/G);}
  const stress=shear.stresses();for(let e=0;e<shear.tetCount;e++){close(stress[6*e+5],tau,1e-9);close(vonMisesStress(stress,6*e),Math.sqrt(3)*tau,1e-9);}
  for(const r of sheared.reactions)close(r,0,0,1e-8*tau*L*L);
  t.diagnostic(`shear modulus measured ${tau/gamma} Pa, expected ${G}`);
  // Pressure p on the three outer faces, symmetry on the other three: every strain is -p / (3 K).
  const block=new SolidBody({mesh:irregular([L,L,L],cells),material:steel,config:{model:'linear',tolerance:1e-12}}),p=5e7;
  symmetryPlanes(block);for(const axis of [0,1,2])block.addPressure(facesWithNormal(block,axis,1),p);
  const pressed=block.solveStatic();assert.ok(pressed.converged);
  const strain=block.strains(),pressure=block.stresses();let dilatation=0;
  for(let e=0;e<block.tetCount;e++){dilatation+=block.elementVolume[e]*(strain[6*e]+strain[6*e+1]+strain[6*e+2]);for(let k=0;k<3;k++)close(pressure[6*e+k],-p,1e-9);for(let k=3;k<6;k++)close(pressure[6*e+k],0,0,1e-9*p);}
  close(-p/(dilatation/block.referenceVolume),K,1e-9,0,'bulk modulus');
  close(block.volume(),L**3*(1-p/(3*K))**3,1e-12);
  t.diagnostic(`bulk modulus measured ${-p*block.referenceVolume/dilatation} Pa, expected ${K}`);
});

test('a bar hanging under its own weight stretches by rho g L^2 / (2 E)',t=>{
  // nu = 0: the exact field u_x = rho g (L x - x^2 / 2) / E is one-dimensional. The lumped weights of a
  // tetrahedral cross-section are not uniform, which leaves a small error that falls with refinement
  // (measured 2.0e-4, 4.1e-5, 1.4e-5). Tolerance at the finest mesh: 5e-5.
  const L=3,w=.2,g=9.81,rho=steel.density,E=steel.youngModulus,exact=rho*g*L*L/(2*E),errors=[];
  for(const n of [1,2,4]){
    const body=new SolidBody({mesh:boxMesh({size:[L,w,w],cells:[15*n,n,n]}),material:{...steel,poissonRatio:0},config:{model:'linear',gravity:[g,0,0],tolerance:1e-12}});
    symmetryPlanes(body);const result=body.solveStatic();assert.ok(result.converged);
    const tip=meanComponent(result.displacements,body.selectNodes(x=>near(x,L)),0);errors.push(tip/exact-1);
    // The support carries the whole weight.
    close(sumComponent(result.reactions,body.selectNodes(x=>near(x,0)),0),-rho*g*L*w*w,1e-10);
    close(body.loadPotential(),-2*result.strainEnergy,1e-9);
  }
  t.diagnostic(`hanging bar nu=0: tip error ${errors.map(e=>e.toExponential(2)).join(', ')} for 1, 2, 4 cells across (15, 30, 60 along); exact ${exact} m`);
  assert.ok(Math.abs(errors[0])>Math.abs(errors[1])&&Math.abs(errors[1])>Math.abs(errors[2])&&Math.abs(errors[2])<5e-5,`errors ${errors}`);
  // nu = 0.3 with the top face held in x only: Poisson contraction varies along the bar, so the exact
  // 3-D field is not one-dimensional; the mean tip displacement stays within (w / L)^2 = 0.4% of the formula.
  const body=new SolidBody({mesh:boxMesh({size:[L,w,w],cells:[24,2,2]}),material:steel,config:{model:'linear',gravity:[g,0,0],tolerance:1e-12}});
  symmetryPlanes(body);const result=body.solveStatic(),tip=meanComponent(result.displacements,body.selectNodes(x=>near(x,L)),0);
  t.diagnostic(`hanging bar nu=0.3: tip ${tip} m, expected ${exact}, error ${(tip/exact-1).toExponential(2)}`);
  close(tip,exact,(w/L)**2);
});

/** End-loaded cantilever of square section t x t, n cells through the thickness. */
function cantilever(n,nu,slenderness=5,model='linear'){
  const L=1,t=L/slenderness,E=200e9,F=1000;
  const body=new SolidBody({mesh:boxMesh({size:[L,t,t],cells:[slenderness*n,n,n]}),material:{youngModulus:E,poissonRatio:nu,density:7850},config:{model}});
  body.constrain(body.selectNodes(x=>near(x,0)));body.addTraction(facesWithNormal(body,0,1),[0,-F/(t*t),0]);
  const result=body.solveStatic();assert.ok(result.converged,`cantilever ${n} ${nu}: ${result.reason}`);
  const I=t**4/12,G=E/(2*(1+nu)),kappa=10*(1+nu)/(12+11*nu),timoshenko=-F*L**3/(3*E*I)-F*L/(kappa*G*t*t);
  const tip=meanComponent(result.displacements,body.selectNodes(x=>near(x,L)),1);
  close(sumComponent(result.reactions,body.selectNodes(x=>near(x,0)),1),F,1e-8);
  return {tip,timoshenko,error:tip/timoshenko-1,bernoulli:-F*L**3/(3*E*I)};
}

test('cantilever with an end load converges to F L^3 / (3 E I) + F L / (kappa G A); locking is measured',t=>{
  // Reference: Timoshenko tip deflection with kappa = 10 (1 + nu) / (12 + 11 nu) (5/6 at nu = 0);
  // the shear term is 2.4% of the bending term at L / t = 5 and nu = 0. Linear tetrahedra are too
  // stiff in bending (shear locking): the error is large on coarse meshes and falls at an order that
  // rises towards 2. The asserted bounds are the measured errors with a small margin.
  const errors=[1,2,4,8].map(n=>cantilever(n,0).error);
  t.diagnostic(`cantilever nu=0, L/t=5, 1/2/4/8 cells through the thickness: tip error vs Timoshenko ${errors.map(e=>(100*e).toFixed(2)+'%').join(', ')}`);
  const orders=[order(errors[0],errors[1]),order(errors[1],errors[2]),order(errors[2],errors[3])];
  t.diagnostic(`cantilever observed orders ${orders.map(o=>o.toFixed(2)).join(', ')}`);
  for(const e of errors)assert.ok(e<0,'the discrete beam is too stiff, never too soft');
  for(const [k,bound] of [.68,.37,.13,.036].entries())assert.ok(Math.abs(errors[k])<bound,`level ${k}: ${errors[k]}`);
  assert.ok(orders[0]>.85&&orders[1]>1.45&&orders[2]>1.75,`orders ${orders}`);
  // nu = 0.3, clamped root: the clamp also restrains the Poisson contraction, which beam theory ignores,
  // so the 3-D limit sits about 1.2% below Timoshenko (Richardson estimate, see the docs).
  const steelBeam=cantilever(8,.3);
  t.diagnostic(`cantilever nu=0.3, 8 cells: tip ${steelBeam.tip} m, Timoshenko ${steelBeam.timoshenko} m, error ${(100*steelBeam.error).toFixed(2)}%`);
  assert.ok(steelBeam.error<0&&steelBeam.error>-.05);
  // Volumetric locking: the same 4-cell mesh as Poisson's ratio approaches 0.5.
  const locking=[0,.3,.45,.49,.499,.4999].map(nu=>cantilever(4,nu).error);
  t.diagnostic(`cantilever 4 cells, nu = 0, 0.3, 0.45, 0.49, 0.499, 0.4999: tip error ${locking.map(e=>(100*e).toFixed(1)+'%').join(', ')}`);
  for(let k=2;k<locking.length;k++)assert.ok(locking[k]<locking[k-1],'stiffer as nu approaches 0.5');
  assert.ok(locking[1]>-.13&&locking[3]>-.23&&locking[5]>-.30&&locking[5]<-.25,`locking ${locking}`);
});

test('axial vibration of a fixed-free bar: f1 = sqrt(E / rho) / (4 L), second-order convergence, and the time integrator agrees',t=>{
  // Lateral motion is held so the lowest mode is the axial one (nu = 0, so this is the 1-D bar).
  // A lumped mass makes the discrete frequency approach the exact one from below, at second order in the cell size.
  const L=1,E=200e9,rho=7850,exact=Math.sqrt(E/rho)/(4*L),errors=[];let mode,body;
  for(const nx of [4,8,16,32]){
    const w=L/nx;body=new SolidBody({mesh:boxMesh({size:[L,w,w],cells:[nx,1,1]}),material:{youngModulus:E,poissonRatio:0,density:rho},config:{model:'linear',integrator:'midpoint',dt:1/(exact*200),tolerance:1e-12}});
    body.constrain(body.selectNodes(x=>near(x,0)));body.constrain(body.selectNodes(()=>true),[null,0,0]);
    mode=body.fundamentalMode();assert.ok(mode.converged);errors.push(mode.frequency/exact-1);
  }
  t.diagnostic(`axial f1 exact ${exact} Hz; error ${errors.map(e=>e.toExponential(3)).join(', ')} for 4, 8, 16, 32 cells; orders ${[0,1,2].map(k=>order(errors[k],errors[k+1]).toFixed(3)).join(', ')}`);
  for(let k=0;k<3;k++)close(order(errors[k],errors[k+1]),2,.01);
  assert.ok(Math.abs(errors[3])<1.3e-4);
  // Free vibration from the mode shape: the midpoint rule turns each mode by 2 atan(omega h / 2) per step.
  const amplitude=1e-4,tip=body.selectNodes(x=>near(x,L))[0],phase=2*Math.atan(mode.angularFrequency*body.dt/2);
  body.setState(mode.shape.map(v=>amplitude*v));const start=body.displacements[3*tip];
  for(let step=1;step<=400;step++){body.step();if(step%50===0)close(body.displacements[3*tip],start*Math.cos(phase*step),0,2e-8*amplitude);}
  assert.equal(body.unconvergedSteps,0);
});

test('first bending frequency of a cantilever approaches Euler-Bernoulli theory',t=>{
  // f1 = (1.8751^2 / (2 pi L^2)) sqrt(E I / (rho A)). L / t = 10, nu = 0.3. Bending locking makes the mesh
  // too stiff, so the frequency is too high: within 6% at four cells through the thickness, with an
  // observed order near 2. Shear and rotary inertia lower the true value by about 1% at this slenderness.
  const L=1,thickness=.1,E=200e9,rho=7850,exact=1.875104068711961**2/(2*Math.PI*L*L)*Math.sqrt(E*thickness**2/(12*rho)),errors=[];
  for(const n of [1,2,4]){
    const body=new SolidBody({mesh:boxMesh({size:[L,thickness,thickness],cells:[10*n,n,n]}),material:{youngModulus:E,poissonRatio:.3,density:rho},config:{model:'linear'}});
    body.constrain(body.selectNodes(x=>near(x,0)));
    const mode=body.fundamentalMode();assert.ok(mode.converged);errors.push(mode.frequency/exact-1);
  }
  t.diagnostic(`bending f1 exact ${exact} Hz; error ${errors.map(e=>(100*e).toFixed(2)+'%').join(', ')} for 1, 2, 4 cells through the thickness; orders ${order(errors[0],errors[1]).toFixed(2)}, ${order(errors[1],errors[2]).toFixed(2)}`);
  assert.ok(errors[0]>errors[1]&&errors[1]>errors[2]&&errors[2]>0);
  assert.ok(errors[1]<.22&&errors[2]<.06);assert.ok(order(errors[1],errors[2])>1.7);
});

test('a suddenly loaded bar carries its stress wave at sqrt(E / rho)',t=>{
  // nu = 0, so the 1-D bar speed applies. The end traction is switched on at t = 0; the time at which the
  // mean axial stress of a cross-section passes half the applied stress is taken at x = 0.75 L and 0.25 L.
  // Lumped-mass linear elements disperse the front, which delays the half-height point slightly more at the
  // far station; 100 cells and half the stability limit measure 0.9% slow. Tolerance 2%.
  const L=1,nx=100,w=L/nx,E=200e9,rho=7850,c=Math.sqrt(E/rho),material={youngModulus:E,poissonRatio:0,density:rho},mesh=boxMesh({size:[L,w,w],cells:[nx,1,1]});
  const limit=new SolidBody({mesh,material,config:{model:'linear'}}).explicitLimit(),dt=.5*limit.criticalTimeStep;
  const body=new SolidBody({mesh,material,config:{model:'linear',integrator:'explicit',dt}}),applied=1e6;
  body.constrain(body.selectNodes(x=>near(x,0)));body.addTraction(facesWithNormal(body,0,1),[applied,0,0]);
  const X=body.referencePositions,centre=e=>(X[3*body.tets[4*e]]+X[3*body.tets[4*e+1]]+X[3*body.tets[4*e+2]]+X[3*body.tets[4*e+3]])/4;
  const stations=[.75,.25].map(x=>({x,elements:[...Array(body.tetCount).keys()].filter(e=>Math.abs(centre(e)-x)<w/2),time:null,previous:0}));
  const stress=new Float64Array(6*body.tetCount);
  for(let step=0;step<Math.ceil(1.2*L/c/dt)&&stations.some(s=>s.time===null);step++){
    body.step();body.stresses(stress);
    for(const s of stations){
      let mean=0,volume=0;for(const e of s.elements){mean+=stress[6*e]*body.elementVolume[e];volume+=body.elementVolume[e];}mean/=volume;
      if(s.time===null&&mean>=.5*applied)s.time=body.time-dt*(mean-.5*applied)/(mean-s.previous);
      s.previous=mean;
    }
  }
  assert.ok(stations.every(s=>s.time!==null),'the wave reached both stations');
  const speed=(stations[0].x-stations[1].x)/(stations[1].time-stations[0].time);
  t.diagnostic(`wave speed measured ${speed} m/s, sqrt(E/rho) = ${c} m/s, error ${(100*(speed/c-1)).toFixed(2)}%; arrival times x c: ${stations.map(s=>(s.time*c).toFixed(4)).join(', ')} m (expected 0.25, 0.75)`);
  close(speed,c,.02);
});

/** A fixed-free bar released from a stretched and bent shape, so many modes are present. */
function ringing(integrator,model,options={}){
  const L=1,nx=8,w=L/nx,E=200e9,rho=7850,period=4*L/Math.sqrt(E/rho);
  const body=new SolidBody({mesh:boxMesh({size:[L,w,w],cells:[nx,1,1]}),material:{youngModulus:E,poissonRatio:.3,density:rho},config:{model,integrator,dt:period/40,tolerance:1e-12,...options}});
  body.constrain(body.selectNodes(x=>near(x,0)));
  const X=body.referencePositions,u=new Float64Array(X.length);
  for(let n=0;n<body.nodeCount;n++)if(!near(X[3*n],0)){u[3*n]=1e-3*X[3*n];u[3*n+1]=3e-4*X[3*n]**2;}
  body.setState(u);return body;
}

test('energy: the midpoint rule conserves it over 30 periods, backward Euler only loses it',t=>{
  const total=body=>body.strainEnergy()+body.kineticEnergy();
  // Linear model: the midpoint rule conserves the quadratic energy exactly; what is left is the
  // 1e-12 solve tolerance and rounding over 1200 steps.
  const conserving=ringing('midpoint','linear'),initial=total(conserving);let drift=0;
  for(let step=0;step<1200;step++){conserving.step();drift=Math.max(drift,Math.abs(total(conserving)/initial-1));}
  t.diagnostic(`midpoint, linear model: largest relative energy change over 1200 steps (30 periods) ${drift.toExponential(2)}`);
  assert.ok(drift<1e-10,`drift ${drift}`);assert.equal(conserving.unconvergedSteps,0);
  // Backward Euler: the energy never rises and most of it is gone.
  for(const model of ['linear','corotational']){
    const damped=ringing('backward-euler',model);let previous=total(damped);
    for(let step=0;step<400;step++){damped.step();const energy=total(damped);assert.ok(energy<=previous*(1+1e-12),`step ${step}: ${energy} > ${previous}`);previous=energy;}
    t.diagnostic(`backward Euler, ${model}: energy after 400 steps (10 periods) is ${(previous/initial).toExponential(2)} of the start`);
    assert.ok(previous<.05*initial);assert.equal(damped.unconvergedSteps,0);
  }
  // Nonlinear models: the midpoint rule is second-order accurate but does not conserve a non-quadratic
  // energy exactly. At 0.1% strain the change stays below 1e-3 of the energy.
  for(const model of ['corotational','neo-hookean']){
    const body=ringing('midpoint',model),start=total(body);let change=0;
    for(let step=0;step<400;step++){body.step();change=Math.max(change,Math.abs(total(body)/start-1));}
    t.diagnostic(`midpoint, ${model}: largest relative energy change over 400 steps ${change.toExponential(2)}`);
    assert.ok(change<1e-3);assert.equal(body.unconvergedSteps,0);
  }
});

test('Rayleigh damping: a mode decays as exp(-(alpha / 2 + beta omega^2 / 2) t)',t=>{
  // One axial mode released from rest returns to a exp(-zeta omega t_k) at its damped periods t_k.
  // 400 midpoint steps per period leave a time-discretisation error of order (omega h)^2 = 2.5e-4.
  const L=1,nx=8,w=L/nx,material={youngModulus:200e9,poissonRatio:0,density:7850};
  for(const [integrator,damping] of [['midpoint',{massDamping:900}],['midpoint',{stiffnessDamping:8e-6}],['backward-euler',{massDamping:900}],['explicit',{massDamping:500,stiffnessDamping:2e-6}]]){
    const build=dt=>{const body=new SolidBody({mesh:boxMesh({size:[L,w,w],cells:[nx,1,1]}),material,config:{model:'linear',integrator,dt,tolerance:1e-12,...damping}});body.constrain(body.selectNodes(x=>near(x,0)));body.constrain(body.selectNodes(()=>true),[null,0,0]);return body;};
    const mode=build(1e-6).fundamentalMode(),omega=mode.angularFrequency,zeta=.5*((damping.massDamping??0)/omega+(damping.stiffnessDamping??0)*omega),damped=omega*Math.sqrt(1-zeta*zeta);
    const steps=integrator==='backward-euler'?4000:400,body=build(2*Math.PI/damped/steps),tip=body.selectNodes(x=>near(x,L))[0];
    body.setState(mode.shape.map(v=>1e-4*v));const start=body.displacements[3*tip];
    body.step(3*steps);const ratio=body.displacements[3*tip]/start,expected=Math.exp(-zeta*omega*3*2*Math.PI/damped);
    t.diagnostic(`${integrator} ${JSON.stringify(damping)}: zeta ${zeta.toFixed(4)}, amplitude after 3 periods ${ratio.toFixed(5)}, expected ${expected.toFixed(5)}`);
    // Backward Euler adds its own numerical damping of order omega h, so it is only checked to be at least as damped.
    if(integrator==='backward-euler')assert.ok(ratio<expected&&ratio>.9*expected);else close(ratio,expected,2e-3);
  }
});

test('explicit integration reports its stability limit, refuses a larger step, and is stable at the limit',t=>{
  const mesh=boxMesh({size:[1,.2,.2],cells:[10,2,2]}),material=steel;
  const limit=new SolidBody({mesh,material}).explicitLimit(),{lambda,mu}=lame(steel);
  close(limit.waveSpeed,Math.sqrt((lambda+2*mu)/steel.density),1e-14);close(limit.minAltitude,.1/Math.sqrt(3),1e-12);
  close(limit.courant,limit.waveSpeed*limit.criticalTimeStep/limit.minAltitude,1e-14);
  t.diagnostic(`explicit limit: ${limit.criticalTimeStep} s = ${limit.courant.toFixed(3)} x smallest altitude / dilatational wave speed`);
  assert.ok(limit.courant>.5&&limit.courant<1);
  invalid(()=>new SolidBody({mesh,material,config:{integrator:'explicit',dt:.95*limit.criticalTimeStep}}),'UNSTABLE_TIME_STEP');
  invalid(()=>new SolidBody({mesh,material,config:{integrator:'explicit',dt:1.01*limit.criticalTimeStep,explicitSafety:1}}),'UNSTABLE_TIME_STEP');
  // Damping lowers the limit by sqrt(1 + xi^2) - xi.
  const damped=new SolidBody({mesh,material,config:{stiffnessDamping:1e-6}}).explicitLimit(),omega=2/limit.criticalTimeStep,xi=.5e-6*omega;
  close(damped.criticalTimeStep,limit.criticalTimeStep*(Math.sqrt(1+xi*xi)-xi),1e-12);
  // At 99.9% of the limit a rough initial state stays bounded for 3000 steps: velocity Verlet keeps the
  // energy within a band instead of growing. (Above the true limit the energy grows without bound.)
  for(const model of ['linear','corotational']){
    const body=new SolidBody({mesh,material,config:{model,integrator:'explicit',dt:.999*limit.criticalTimeStep,explicitSafety:1}});
    body.constrain(body.selectNodes(x=>near(x,0)));
    const u=Float64Array.from(body.referencePositions,(x,j)=>near(body.referencePositions[j-j%3],0)?0:1e-5*Math.sin(37*j));body.setState(u);
    const initial=body.strainEnergy();let largest=0;
    for(let k=0;k<30;k++){body.step(100);largest=Math.max(largest,(body.strainEnergy()+body.kineticEnergy())/initial);}
    t.diagnostic(`explicit ${model} at 0.999 of the limit: largest energy / initial over 3000 steps = ${largest.toFixed(3)}`);
    assert.ok(largest<2,`energy grew to ${largest}`);
  }
  // Explicit and midpoint agree on a smooth motion (both second order): one axial period.
  const tips=['explicit','midpoint'].map(integrator=>{
    const body=ringing(integrator,'linear',{dt:4/Math.sqrt(200e9/7850)/4000});body.step(1000);return body.displacements[3*body.selectNodes(x=>near(x,1))[0]];
  });
  close(tips[0],tips[1],0,2e-3*1e-3);
});

test('rigid rotation: corotational and Neo-Hookean bodies stay stress-free, the linear model does not',t=>{
  const size=[1,.4,.3],cells=[3,2,2],angle=2.1,axis=[1,2,-1].map(v=>v/Math.sqrt(6)),[ax,ay,az]=axis,c=Math.cos(angle),s=Math.sin(angle),k=1-c;
  const R=[c+ax*ax*k,ax*ay*k-az*s,ax*az*k+ay*s, ay*ax*k+az*s,c+ay*ay*k,ay*az*k-ax*s, az*ax*k-ay*s,az*ay*k+ax*s,c+az*az*k];
  const rotated=(X,n)=>[0,1,2].map(i=>R[3*i]*X[3*n]+R[3*i+1]*X[3*n+1]+R[3*i+2]*X[3*n+2]-X[3*n+i]+[.3,-.2,.5][i]);
  const E=steel.youngModulus,measured={};
  for(const model of MODELS){
    const body=new SolidBody({mesh:irregular(size,cells),material:steel,config:{model}}),X=body.referencePositions,u=new Float64Array(X.length);
    for(let n=0;n<body.nodeCount;n++)u.set(rotated(X,n),3*n);
    body.setState(u);measured[model]={stress:maxAbs(body.stresses())/E,strain:maxAbs(body.strains()),energy:body.strainEnergy()/(E*body.referenceVolume)};
    if(model!=='linear')close(body.volume(),body.referenceVolume,1e-13);
  }
  t.diagnostic(`120 degree rigid rotation, max |stress| / E: ${MODELS.map(m=>`${m} ${measured[m].stress.toExponential(2)}`).join(', ')}`);
  // Rounding only: the strain of a rotated element is a difference of numbers of order one.
  t.diagnostic(`rotation energy / (E V): ${MODELS.map(m=>measured[m].energy.toExponential(2)).join(', ')}`);
  // The Neo-Hookean energy is a sum of order-mu terms that cancel, so its floor is 1e-16 mu rather than strain squared.
  for(const model of ['corotational','neo-hookean']){assert.ok(measured[model].stress<1e-13);assert.ok(measured[model].strain<1e-13);assert.ok(measured[model].energy<(model==='corotational'?1e-26:1e-15));}
  // The linear strain of a rotation by angle a has principal values (cos a - 1): a ghost stress of order E.
  assert.ok(measured.linear.stress>1&&measured.linear.strain>1);
  // The same through the solver: turn one end face by 60 degrees and let the rest follow.
  const turn=Math.PI/3,turned=(X,n)=>[0,X[3*n+1]*Math.cos(turn)-X[3*n+2]*Math.sin(turn)-X[3*n+1],X[3*n+1]*Math.sin(turn)+X[3*n+2]*Math.cos(turn)-X[3*n+2]];
  for(const model of MODELS){
    const body=new SolidBody({mesh:irregular(size,cells),material:steel,config:{model,tolerance:1e-12}}),X=body.referencePositions;
    for(const n of body.selectNodes(x=>near(x,0)))body.constrain([n],turned(X,n));
    const result=body.solveStatic({loadSteps:model==='linear'?1:6});assert.ok(result.converged,`${model} ${result.reason}`);
    const energy=result.strainEnergy/(E*body.referenceVolume);let error=0;
    for(let n=0;n<body.nodeCount;n++){const expected=turned(X,n);for(let i=0;i<3;i++)error=Math.max(error,Math.abs(result.displacements[3*n+i]-expected[i]));}
    t.diagnostic(`end face turned 60 degrees, ${model}: strain energy / (E V) = ${energy.toExponential(2)}, distance from the rigid rotation ${error.toExponential(2)} m`);
    if(model==='linear'){assert.ok(energy>1e-3);assert.ok(error>.01);}else{assert.ok(energy<1e-15);assert.ok(error<1e-9);}
  }
});

test('Neo-Hookean bar stretched to twice its length matches the analytic nominal stress',t=>{
  // Energy density W = mu/2 (I_C - 3) - mu ln J + lambda/2 (ln J)^2. Uniaxial stretch s with lateral stretch q:
  // zero lateral stress gives mu (q^2 - 1) + lambda ln(s q^2) = 0, and the nominal (first Piola-Kirchhoff)
  // axial stress is P = mu (s - 1/s) + lambda ln(s q^2) / s. The deformation is uniform, so the mesh adds no error.
  const rubber={youngModulus:3e6,poissonRatio:.45,density:1100},{lambda,mu}=lame(rubber),stretch=2,size=[.1,.02,.02],cells=[4,2,2];
  const residual=q=>mu*(q*q-1)+lambda*Math.log(stretch*q*q);let low=.5,high=1;
  for(let k=0;k<200;k++){const mid=.5*(low+high);if(residual(mid)>0)high=mid;else low=mid;}
  const lateral=.5*(low+high),J=stretch*lateral*lateral,nominal=mu*(stretch-1/stretch)+lambda*Math.log(J)/stretch;
  const body=new SolidBody({mesh:irregular(size,cells),material:rubber,config:{model:'neo-hookean',tolerance:1e-12}});
  symmetryPlanes(body);const end=body.selectNodes(x=>near(x,size[0]));body.constrain(end,[(stretch-1)*size[0],null,null]);
  const result=body.solveStatic({loadSteps:10});assert.ok(result.converged,result.reason);
  const force=sumComponent(result.reactions,end,0),area=size[1]*size[2];
  t.diagnostic(`Neo-Hookean stretch 2: nominal stress ${force/area} Pa, analytic ${nominal}; lateral stretch ${1+meanComponent(result.displacements,body.selectNodes((x,y)=>near(y,size[1])),1)/size[1]}, analytic ${lateral}`);
  close(force/area,nominal,1e-9);
  for(const n of body.selectNodes((x,y)=>near(y,size[1])))close(1+result.displacements[3*n+1]/size[1],lateral,1e-9);
  for(const n of body.selectNodes((x,y,z)=>near(z,size[2])))close(1+result.displacements[3*n+2]/size[2],lateral,1e-9);
  // Cauchy stress P s / J along the bar and nothing else; Biot strain (stretch - 1); volume J V; energy W V.
  const stress=body.stresses(),strain=body.strains();
  for(let e=0;e<body.tetCount;e++){close(stress[6*e],nominal*stretch/J,1e-9);for(let k=1;k<6;k++)close(stress[6*e+k],0,0,1e-9*nominal);close(strain[6*e],stretch-1,1e-9);close(strain[6*e+1],lateral-1,1e-9);}
  close(body.volume(),J*body.referenceVolume,1e-10);
  close(result.strainEnergy,body.referenceVolume*(.5*mu*(stretch**2+2*lateral**2-3)-mu*Math.log(J)+.5*lambda*Math.log(J)**2),1e-10);
  // Small strain: the same model reduces to Hooke's law, here to within the strain itself (1e-6).
  const small=new SolidBody({mesh:irregular(size,cells),material:rubber,config:{model:'neo-hookean',tolerance:1e-12}});
  symmetryPlanes(small);small.constrain(end,[1e-6*size[0],null,null]);
  close(sumComponent(small.solveStatic().reactions,end,0)/area,rubber.youngModulus*1e-6,1e-5);
});

test('inversion is refused, not hidden: an over-large compression step fails loudly and load steps recover it',()=>{
  const rubber={youngModulus:3e6,poissonRatio:.3,density:1100},size=[.1,.1,.1],cells=[2,2,2];
  for(const model of ['corotational','neo-hookean']){
    const body=new SolidBody({mesh:boxMesh({size,cells}),material:rubber,config:{model}});
    symmetryPlanes(body);body.constrain(body.selectNodes(x=>near(x,size[0])),[-.06,null,null]);
    // In one step the end layer of cells is pushed through itself before the interior can move.
    invalid(()=>body.solveStatic(),'NUMERICAL_FAILURE');
    body.reset();const result=body.solveStatic({loadSteps:12});assert.ok(result.converged,result.reason);
    for(const n of body.selectNodes(x=>near(x,.05)))close(result.displacements[3*n],-.03,1e-8);
    assert.ok(body.volume()<body.referenceVolume);
  }
});

test('thermal eigenstrain: a free block expands by alpha dT without stress, a restrained bar carries -E alpha dT',t=>{
  const alpha=1.2e-5,rise=80,material={...steel,thermalExpansion:alpha},E=steel.youngModulus,size=[.5,.2,.1],cells=[4,2,2],theta=alpha*rise;
  for(const model of MODELS){
    const free=new SolidBody({mesh:irregular(size,cells),material,config:{model,tolerance:1e-12}});
    symmetryPlanes(free);free.setTemperatureChange(rise);const expanded=free.solveStatic();assert.ok(expanded.converged);
    const X=free.referencePositions;for(let j=0;j<X.length;j++)close(expanded.displacements[j],theta*X[j],0,1e-10*theta);
    assert.ok(maxAbs(free.stresses())<1e-9*E*theta,`${model}: free stress ${maxAbs(free.stresses())}`);
    const strain=free.strains();for(let e=0;e<free.tetCount;e++)for(let k=0;k<6;k++)close(strain[6*e+k],k<3?theta:0,0,1e-12);
    close(expanded.strainEnergy,0,0,1e-18*E*free.referenceVolume);
    if(model!=='linear')close(free.volume(),free.referenceVolume*(1+theta)**3,1e-12);
    // Both ends held along the bar, sides free: uniaxial stress -E alpha dT.
    const held=new SolidBody({mesh:irregular(size,cells),material,config:{model,tolerance:1e-12}});
    symmetryPlanes(held);const end=held.selectNodes(x=>near(x,size[0]));held.constrain(end,[0,null,null]);
    held.setTemperatureChange(new Float64Array(held.nodeCount).fill(rise));assert.ok(held.solveStatic().converged);
    const stress=held.stresses(),force=sumComponent(held.reactions(),end,0)/(size[1]*size[2]);
    t.diagnostic(`restrained bar, ${model}: stress ${stress[0]} Pa, reaction / area ${force} Pa, -E alpha dT = ${-E*theta}`);
    // Exact for the linear model. The finite-strain models differ at first order in the strain
    // (alpha dT = 9.6e-4 here): the sides grow by (1 + nu) alpha dT, which changes the current area,
    // and the Neo-Hookean law is not Hooke's law beyond first order. Measured 2.5e-3 and 3.7e-3; tolerance 5 alpha dT.
    const tolerance=model==='linear'?1e-10:5*theta;
    for(let e=0;e<held.tetCount;e++){close(stress[6*e],-E*theta,tolerance);for(let k=1;k<6;k++)close(stress[6*e+k],0,0,1e-9*E*theta);}
    close(force,-E*theta,tolerance);
  }
  // Fully confined: -E alpha dT / (1 - 2 nu) in every direction.
  const confined=new SolidBody({mesh:irregular(size,cells),material,config:{model:'linear',tolerance:1e-12}});
  confined.constrain(confined.selectNodes((x,y,z)=>near(x,0)||near(x,size[0])||near(y,0)||near(y,size[1])||near(z,0)||near(z,size[2])));
  confined.setTemperatureChange(rise);confined.solveStatic();
  const stress=confined.stresses();for(let e=0;e<confined.tetCount;e++)for(let k=0;k<3;k++)close(stress[6*e+k],-E*theta/(1-2*.3),1e-10);
});

test('failure checks flag exactly the elements whose stress exceeds the strength',()=>{
  // Uniform tension: every element is at F / A, so a strength just below flags all and just above flags none.
  const L=1,w=.1,F=2e5,sigma=F/(w*w),body=new SolidBody({mesh:irregular([L,w,w],[8,2,2]),material:steel,config:{model:'linear',tolerance:1e-12}});
  symmetryPlanes(body);body.addTraction(facesWithNormal(body,0,1),[sigma,0,0]);assert.ok(body.solveStatic().converged);
  for(const criterion of ['max-principal','von-mises']){
    assert.equal(body.failedElements({criterion,strength:sigma*(1-1e-6)}).length,body.tetCount);
    assert.equal(body.failedElements({criterion,strength:sigma*(1+1e-6)}).length,0);
  }
  // Uniform compression: the yield check fires, the tensile (largest principal stress) check does not.
  body.clearSurfaceLoads();body.addTraction(facesWithNormal(body,0,1),[-sigma,0,0]);body.solveStatic();
  assert.equal(body.failedElements({criterion:'von-mises',strength:.5*sigma}).length,body.tetCount);
  assert.equal(body.failedElements({criterion:'max-principal',strength:1e-6*sigma}).length,0);
  // Tension plus self-weight: the stress falls from the support to the free end, so only a part fails.
  // The flagged set must equal an independent evaluation of the reported stress tensors, and it must be
  // the part of the bar above the analytic level x* where F / A + rho g (L - x*) equals the strength.
  const g=4000,rho=steel.density,hanging=new SolidBody({mesh:boxMesh({size:[L,w,w],cells:[16,2,2]}),material:{...steel,poissonRatio:0},config:{model:'linear',gravity:[g,0,0],tolerance:1e-12}});
  symmetryPlanes(hanging);hanging.addTraction(facesWithNormal(hanging,0,1),[sigma,0,0]);assert.ok(hanging.solveStatic().converged);
  const strength=sigma+.4*rho*g*L,stress=hanging.stresses(),X=hanging.referencePositions,cut=L-(strength-sigma)/(rho*g),cell=L/16;
  for(const criterion of ['max-principal','von-mises']){
    const failed=hanging.failedElements({criterion,strength}),expected=[],principal=[0,0,0];
    for(let e=0;e<hanging.tetCount;e++){symmetricEigenvalues(stress,6*e,principal,0);if((criterion==='von-mises'?vonMisesStress(stress,6*e):principal[0])>strength)expected.push(e);}
    assert.deepEqual([...failed],expected);assert.ok(failed.length>0&&failed.length<hanging.tetCount);
    const flagged=new Set(failed);
    for(let e=0;e<hanging.tetCount;e++){
      const x=[0,1,2,3].map(q=>X[3*hanging.tets[4*e+q]]),low=Math.min(...x),high=Math.max(...x);
      if(high<cut-cell)assert.ok(flagged.has(e),`element ${e} above the cut must fail`);
      if(low>cut+cell)assert.ok(!flagged.has(e),`element ${e} below the cut must not fail`);
    }
  }
});

test('principal stresses and von Mises stress of known tensors',()=>{
  const out=[0,0,0];
  symmetricEigenvalues([2,3,6,0,0,2],0,out,0);for(const [k,v] of [6,(5+Math.sqrt(17))/2,(5-Math.sqrt(17))/2].entries())close(out[k],v,1e-14);
  symmetricEigenvalues([0,0,0,1,1,1],0,out,0);close(out[0],2,1e-14);close(out[1],-1,1e-14);close(out[2],-1,1e-14);
  symmetricEigenvalues([5,5,5,0,0,0],0,out,0);assert.deepEqual(out,[5,5,5]);
  close(vonMisesStress([7,0,0,0,0,0]),7,1e-15);close(vonMisesStress([0,0,0,0,0,4]),4*Math.sqrt(3),1e-15);close(vonMisesStress([-3,-3,-3,0,0,0]),0,0,1e-15);
});

test('determinism: a repeat run gives identical bits',()=>{
  const run=()=>{
    const out=[];
    for(const [model,integrator] of [['corotational','backward-euler'],['neo-hookean','midpoint'],['linear','explicit']]){
      const mesh=irregular([1,.2,.2],[6,2,2]),probe=new SolidBody({mesh,material:{youngModulus:5e6,poissonRatio:.4,density:1100}});
      const body=new SolidBody({mesh,material:{youngModulus:5e6,poissonRatio:.4,density:1100,thermalExpansion:2e-4},config:{model,integrator,dt:integrator==='explicit'?.5*probe.explicitLimit().criticalTimeStep:2e-3,gravity:[0,-9.81,0],massDamping:.5,stiffnessDamping:integrator==='explicit'?1e-6:1e-4}});
      body.constrain(body.selectNodes(x=>near(x,0)));body.addPressure(facesWithNormal(body,1,1),300);body.setTemperatureChange(15);body.setNodalForce(body.nodeCount-1,[0,0,2]);
      body.step(integrator==='explicit'?400:25);
      out.push(bits(body.displacements),bits(body.velocities),bits(body.stresses()),bits(body.reactions()),String(body.unconvergedSteps));
      body.reset();const result=body.solveStatic({loadSteps:3});out.push(bits(result.displacements),bits(body.principalStresses()),String(result.linearIterations));
    }
    return out;
  };
  const first=run(),second=run();assert.deepEqual(second,first);assert.ok(first.every(text=>text.length>0));
});

test('implicit steps allocate no arrays: the work vectors are created once',()=>{
  // The step reuses the buffers made by the constructor. Counting typed-array constructions is exact,
  // unlike a heap measurement.
  const body=ringing('backward-euler','corotational',{massDamping:1,stiffnessDamping:1e-7});body.step(2);
  const original=globalThis.Float64Array;let constructed=0;
  globalThis.Float64Array=new Proxy(original,{construct(target,args){constructed++;return new target(...args);}});
  try{body.step(5);}finally{globalThis.Float64Array=original;}
  assert.equal(constructed,0);
  const midpoint=ringing('midpoint','neo-hookean');midpoint.step(2);
  globalThis.Float64Array=new Proxy(original,{construct(target,args){constructed++;return new target(...args);}});
  try{midpoint.step(5);}finally{globalThis.Float64Array=original;}
  assert.equal(constructed,0);
});
