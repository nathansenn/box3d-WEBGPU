// The averaged nodal pressure element (`element: 'tet4-nodal'`) and the sparse LDLᵀ preconditioner (`linearSolver: 'ldl'`) of the
// tetrahedral solid (src/engine/solid.ts, src/engine/sparse-ldl.ts), SI units. Every tolerance is stated beside its check.
// Measured values are printed as test diagnostics (`node --test --test-reporter=tap`); docs/SOLID_MECHANICS.md quotes them.
// No check depends on wall-clock time. Run by `npm run test:solid`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SolidBody,boxMesh,boxNode} from '../../src/engine/solid.ts';
import {SolidContact} from '../../src/engine/solid-contact.ts';
import {SparseLDL} from '../../src/engine/sparse-ldl.ts';
import {EngineError} from '../../src/engine/contracts.ts';
import {concreteMaterial} from '../../src/engine/materials.ts';

const steel={youngModulus:200e9,poissonRatio:.3,density:7850};
const near=(a,b)=>Math.abs(a-b)<1e-9;
const invalid=fn=>assert.throws(fn,error=>error instanceof EngineError&&error.code==='INVALID_PAYLOAD');
const random=(seed=7)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5;};
const bits=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('hex');

test('sparse LDLᵀ: a factorization of a random sparse SPD block matrix solves it to rounding; constrained unknowns solve to zero',()=>{
  const rnd=random(3),N=30,n=3*N,A=new Float64Array(n*n),blocks=[],adj=Array.from({length:N},()=>[]);
  for(let a=0;a<N;a++)for(let b=a+1;b<N;b++)if(b-a<4||rnd()>.45){adj[a].push(b);const M=Array.from({length:9},rnd);blocks.push([a,b,M]);for(let p=0;p<3;p++)for(let q=0;q<3;q++){A[(3*a+p)*n+3*b+q]+=M[3*p+q];A[(3*b+q)*n+3*a+p]+=M[3*p+q];}}
  for(let a=0;a<N;a++){const M=Array.from({length:9},rnd);for(let p=0;p<3;p++)for(let q=p;q<3;q++){const v=(M[3*p+q]+M[3*q+p])/2+(p===q?20:0);M[3*p+q]=M[3*q+p]=v;}blocks.push([a,a,M]);for(let p=0;p<3;p++)for(let q=0;q<3;q++)A[(3*a+p)*n+3*a+q]+=M[3*p+q];}
  const L=new SparseLDL(N,(a,visit)=>adj[a].forEach(visit)),fixed=new Uint8Array(n);fixed[5]=1;fixed[40]=1;
  L.begin(fixed);for(const [a,b,M] of blocks)L.addBlock(a,b,M);L.factor();
  const x=Float64Array.from({length:n},rnd);x[5]=x[40]=0;const r=new Float64Array(n);
  for(let i=0;i<n;i++)if(!fixed[i])for(let j=0;j<n;j++)if(!fixed[j])r[i]+=A[i*n+j]*x[j];
  const z=new Float64Array(n);L.solve(r,z);let error=0;for(let i=0;i<n;i++)error=Math.max(error,Math.abs(z[i]-x[i]));
  console.log(`# sparse LDL: error ${error.toExponential(2)}, factor entries ${L.entries} of ${n*(n-1)/2}`);
  assert.equal(L.modified,0);assert.ok(error<1e-12,`${error}`);assert.ok(L.entries<n*(n-1)/2,'fill-reducing order: sparser than dense');
  // An indefinite matrix gives a positive definite preconditioner (reset pivots), never a breakdown.
  L.begin(new Uint8Array(n));for(const [a,b,M] of blocks)L.addBlock(a,b,a===b?M.map((v,k)=>k%4===0?-v:v):M);L.factor();
  assert.ok(L.modified>0&&[...L.D].every(d=>d>0),'reset pivots, all positive');
});

/** Gradient and tangent of the kernel against central differences at a state with a plastic history and a rigid turn. */
function differences(material,config,{amp,prestrain=0,turn=.5}){
  const b=new SolidBody({mesh:boxMesh({size:[.02,.01,.01],cells:[3,2,2]}),material,config}),n=3*b.nodeCount,X=b.referencePositions,k=b.kernel(),rnd=random(11);
  if(prestrain){const u0=new Float64Array(n);for(let j=0;j<n;j++)u0[j]=prestrain*(j%3===0?X[j]:-.3*X[j])+.3*amp*rnd();b.setState(u0);k.commit();}
  const u=new Float64Array(n),c=Math.cos(turn),s=Math.sin(turn),rotate=config.model!=='linear';
  for(let j=0;j<n;j+=3){const x=X[j]*(1+prestrain)+amp*rnd(),y=X[j+1]*(1-.3*prestrain)+amp*rnd(),z=X[j+2]+amp*rnd();u[j]=(rotate?c*x-s*y:x)-X[j];u[j+1]=(rotate?s*x+c*y:y)-X[j+1];u[j+2]=z-X[j+2];}
  const f0=new Float64Array(n),f1=new Float64Array(n),f2=new Float64Array(n),out=new Float64Array(n),dir=Float64Array.from({length:n},rnd);
  k.energy(u,f0,true);k.tangentProduct(dir,out);
  const h=1e-9*amp/2e-5,up=u.map((v,j)=>v+h*dir[j]),um=u.map((v,j)=>v-h*dir[j]),e1=k.energy(up,f1,false),e2=k.energy(um,f2,false);
  let err=0,ref=0,dot=0;for(let j=0;j<n;j++){const fd=(f1[j]-f2[j])/(2*h);err=Math.max(err,Math.abs(fd-out[j]));ref=Math.max(ref,Math.abs(fd));dot+=f0[j]*dir[j];}
  return {tangent:err/ref,gradient:Math.abs((e1-e2)/(2*h)/dot-1),plastic:Math.max(...b.equivalentPlasticStrain())};
}

test('tet4-nodal: internal forces are the exact gradient of the energy and the tangent is its derivative, in every regime',()=>{
  const cases=[];
  for(const model of ['linear','corotational','neo-hookean','green-lagrange'])for(const nu of [.3,.49])cases.push([`elastic ${model} nu ${nu}`,{...steel,poissonRatio:nu,thermalExpansion:1e-5},{model},{amp:nu<.4?2e-5:2e-4}]);
  for(const model of ['linear','green-lagrange'])cases.push([`J2 ${model}`,{...steel,yieldStress:250e6,hardeningModulus:1e9},{model},{amp:4e-5,prestrain:.01}]);
  cases.push(['viscoelastic neo-hookean',{youngModulus:2e6,poissonRatio:.49,density:1000},{model:'neo-hookean',viscoelastic:{branches:[{ratio:1,time:.1}]}},{amp:5e-4}]);
  for(const [label,material,config,options] of cases){
    const r=differences(material,{...config,element:'tet4-nodal'},options);
    console.log(`# ${label}: tangent ${r.tangent.toExponential(2)}, gradient ${r.gradient.toExponential(2)}${label.startsWith('J2')?`, p ${r.plastic.toFixed(4)}`:''}`);
    if(label.startsWith('J2'))assert.ok(r.plastic>.005,'the state is plastic');
    // Central differences with a step of 1e-9 of the displacement scale: truncation and rounding near 1e-7.
    assert.ok(r.tangent<2e-6,`${label} tangent ${r.tangent}`);assert.ok(r.gradient<2e-6,`${label} gradient ${r.gradient}`);
  }
  // The concrete law keeps tet4 (its yield is pressure dependent); its tangent through the same kernel for comparison.
  const C=concreteMaterial('concrete-c30-37',{allowUnverified:true}),r=differences(C,{model:'green-lagrange'},{amp:2e-6,prestrain:-.003});
  console.log(`# concrete (tet4): tangent ${r.tangent.toExponential(2)}, gradient ${r.gradient.toExponential(2)}`);
  assert.ok(r.gradient<1e-5&&r.tangent<1e-4,'forward-difference tangent of the law');
});

test('the assembled sparse matrix is the tangent the conjugate gradients multiply by, for both elements and every law',()=>{
  const C=concreteMaterial('concrete-c30-37',{allowUnverified:true});
  const cases=[['tet4','linear',steel],['tet4','green-lagrange',{...steel,yieldStress:250e6}],['tet4','green-lagrange',C],['tet4','neo-hookean',{...steel,poissonRatio:.49}],
    ['tet4-nodal','linear',steel],['tet4-nodal','corotational',{...steel,poissonRatio:.49}],['tet4-nodal','neo-hookean',{...steel,poissonRatio:.49}],['tet4-nodal','green-lagrange',{...steel,yieldStress:250e6,hardeningModulus:1e9}]];
  for(const [element,model,material] of cases){
    const b=new SolidBody({mesh:boxMesh({size:[.04,.01,.01],cells:[4,2,2]}),material,config:{model,element,linearSolver:'ldl'}}),n=3*b.nodeCount,k=b.kernel(),rnd=random(5),X=b.referencePositions;
    b.constrain(b.selectNodes(x=>near(x,0)));
    const a=material.concrete?-1e-4:2e-3,u=new Float64Array(n);for(let j=0;j<n;j++)u[j]=X[j-j%3]*(j%3===0?a:j%3===1?-.3*a:.15*a)*(1+.2*rnd());
    for(let j=0;j<n;j++)if(k.fixed[j])u[j]=0;
    b.setState(u);if(material.yieldStress||material.concrete){k.energy(u,null,true);k.commit();}
    k.energy(u,null,true);const L=k.assembleTangent(1,0);L.factor();
    const x=Float64Array.from({length:n},(v,j)=>k.fixed[j]?0:rnd()),Kx=new Float64Array(n),z=new Float64Array(n);k.tangentProduct(x,Kx);L.solve(Kx,z);
    let error=0,scale=0;for(let j=0;j<n;j++){error=Math.max(error,Math.abs(z[j]-x[j]));scale=Math.max(scale,Math.abs(x[j]));}
    console.log(`# ${element} ${model}${material.yieldStress?' J2':material.concrete?' concrete':''}: K^-1 (K x) - x ${(error/scale).toExponential(2)}`);
    assert.equal(L.modified,0,'positive definite');
    // 1e-7: the condition number of a 3-D stiffness (about 1e6 here) times rounding.
    assert.ok(error<1e-7*scale,`${element} ${model}: ${error/scale}`);
  }
});

test('near-incompressible patch test (nu = 0.4999): a uniform strain is reproduced on an irregular mesh by every model of tet4-nodal',()=>{
  const A=[1.0e-3,2.0e-4,-3.0e-4, 4.0e-4,-2.0e-3,5.0e-4, -1.0e-4,3.0e-4,1.5e-3],size=[1.2,.9,.7],cells=[3,3,3],rnd=random(20261111);
  for(const model of ['linear','corotational','neo-hookean','green-lagrange']){
    const mesh=boxMesh({size,cells});
    for(let kz=1;kz<3;kz++)for(let j=1;j<3;j++)for(let i=1;i<3;i++){const n=boxNode(cells,i,j,kz);for(let c=0;c<3;c++)mesh.positions[3*n+c]+=.35*size[c]/cells[c]*rnd();}
    const body=new SolidBody({mesh,material:{...steel,poissonRatio:.4999},config:{model,element:'tet4-nodal',linearSolver:'ldl',tolerance:1e-13}}),X=body.referencePositions;
    const field=n=>[0,1,2].map(i=>A[3*i]*X[3*n]+A[3*i+1]*X[3*n+1]+A[3*i+2]*X[3*n+2]);
    const boundary=body.selectNodes((x,y,z)=>near(x,0)||near(x,size[0])||near(y,0)||near(y,size[1])||near(z,0)||near(z,size[2]));
    for(const n of boundary)body.constrain([n],field(n));
    const r=body.solveStatic();assert.ok(r.converged,r.reason);
    let error=0,scale=0;for(let n=0;n<body.nodeCount;n++){const f=field(n);for(let i=0;i<3;i++){error=Math.max(error,Math.abs(r.displacements[3*n+i]-f[i]));scale=Math.max(scale,Math.abs(f[i]));}}
    const s=body.stresses();let spread=0;for(let e=1;e<body.tetCount;e++)for(let q=0;q<6;q++)spread=Math.max(spread,Math.abs(s[6*e+q]-s[q]));
    console.log(`# patch nu 0.4999 ${model}: displacement error ${(error/scale).toExponential(2)}, stress spread ${(spread/Math.max(...s.map(Math.abs))).toExponential(2)} of the largest`);
    // The solver tolerance (1e-13 of the force) on a stiffness whose bulk is 5000 times its shear modulus.
    assert.ok(error<=1e-8*scale,`${model}: ${error/scale}`);assert.ok(spread<=1e-6*Math.max(...s.map(Math.abs)),`${model} stress spread`);
  }
});

/** End-loaded cantilever of square section, 4 cells through the thickness (as tests/engine/solid.test.mjs). */
function cantilever(nu,element){
  const L=1,t=.2,E=200e9,F=1000,body=new SolidBody({mesh:boxMesh({size:[L,t,t],cells:[20,4,4]}),material:{youngModulus:E,poissonRatio:nu,density:7850},config:{model:'linear',element,linearSolver:'ldl'}});
  body.constrain(body.selectNodes(x=>near(x,0)));body.addTraction(body.selectFaces((cx,cy,cz,nx)=>nx>.999),[0,-F/(t*t),0]);
  const r=body.solveStatic();assert.ok(r.converged);
  const I=t**4/12,G=E/(2*(1+nu)),kappa=10*(1+nu)/(12+11*nu),exact=-F*L**3/(3*E*I)-F*L/(kappa*G*t*t);let tip=0;const end=body.selectNodes(x=>near(x,L));for(const n of end)tip+=r.displacements[3*n+1]/end.length;
  return tip/exact-1;
}

test('volumetric locking in bending: the 4-cell cantilever as nu approaches 0.5, tet4-nodal against tet4',()=>{
  const nus=[.3,.45,.49,.499,.4999],nodal=nus.map(nu=>cantilever(nu,'tet4-nodal')),standard=nus.map(nu=>cantilever(nu,'tet4'));
  console.log(`# cantilever 4 cells, nu ${nus.join(', ')}: tet4-nodal ${nodal.map(e=>(100*e).toFixed(1)+'%').join(', ')}; tet4 ${standard.map(e=>(100*e).toFixed(1)+'%').join(', ')}`);
  // Measured: tet4-nodal -9.6 % at nu = 0.3 to -23.0 % at 0.4999, tet4 -12.5 % to -29.3 %. The nodal pressure relieves part of
  // the locking in this bending problem, not all of it: on four cells through the depth, a linear tetrahedral mesh still has more nodal volume constraints than the bending modes can satisfy freely (not diagnosed further).
  for(let i=0;i<nus.length;i++)assert.ok(nodal[i]>standard[i]+.025,`softer than tet4 at nu ${nus[i]}`);
  assert.ok(nodal[4]>-.24&&nodal[0]>-.10,`${nodal}`);
});

/** Cook's membrane: tapered panel (0,0), (48,44), (48,60), (0,44), left edge clamped, shear 6.25 per unit length on the right
 * edge (total 100), E = 250, plane strain (one layer of cells, depth held). */
function cook(n,element,nu=.4999){
  const mesh=boxMesh({size:[1,1,48/n],cells:[n,n,1]}),p=mesh.positions;
  for(let i=0;i<p.length;i+=3){const s=p[i],t=p[i+1];p[i]=48*s;p[i+1]=44*s+t*(44+16*s-44*s);}
  const b=new SolidBody({mesh,material:{youngModulus:250,poissonRatio:nu,density:1},config:{model:'linear',element,linearSolver:'ldl',tolerance:1e-11}});
  b.constrain(b.selectNodes(x=>x<1e-9));b.constrain(b.selectNodes(()=>true),[null,null,0]);b.addTraction(b.selectFaces((cx,cy,cz,nx)=>nx>.99),[0,6.25,0]);
  const r=b.solveStatic();assert.ok(r.converged);const tip=b.selectNodes((x,y)=>near(x,48)&&near(y,60));let v=0;for(const k of tip)v+=r.displacements[3*k+1]/tip.length;return v;
}

test("Cook's membrane, nearly incompressible: the tip deflection converges to the reference 7.769 (Sukumar et al. 2023)",()=>{
  // Reference: v = 7.769 at (48, 60) for E = 250, nu -> 0.5, plane strain, F = 6.25 per unit length (N. Sukumar et al.,
  // "Stress-hybrid virtual element method on quadrilateral meshes...", arXiv:2304.04941, section on Cook's membrane, quoting
  // their reference [6]). Here nu = 0.4999, the solid's upper limit.
  const ref=7.769,rows=[4,8,16,32].map(n=>({n,nodal:cook(n,'tet4-nodal'),standard:cook(n,'tet4')}));
  console.log(`# Cook's membrane tip / 7.769 (n cells per side): ${rows.map(r=>`${r.n}: tet4-nodal ${(r.nodal/ref).toFixed(4)}, tet4 ${(r.standard/ref).toFixed(4)}`).join('; ')}`);
  for(let i=1;i<rows.length;i++)assert.ok(rows[i].nodal>rows[i-1].nodal&&rows[i].nodal<ref,'converges from below (linear tetrahedra are stiff in bending)');
  for(const r of rows)assert.ok(r.nodal>r.standard,'softer than tet4 on every mesh');
  // Measured 0.9588 at 32 cells: within 5 %; tet4 0.904.
  assert.ok(rows[3].nodal/ref>.95,`${rows[3].nodal}`);
});

/** Pure bending of a plane-strain strip (one cell deep, depth held), h = 10 mm, ny cells through the depth, perfectly plastic, at
 * 16 k_y: moment against the fully plastic M_p' (1 - (k_y / k)^2 / 3), M_p' = (2 / sqrt 3) sigma_y h^2 / 4. */
function planeStrainBend(ny,element){
  const E=200e9,NU=.3,SY=250e6,h=.01,L=.02,dz=h/ny,b=new SolidBody({mesh:boxMesh({size:[L,h,dz],cells:[2*ny,ny,1]}),material:{youngModulus:E,poissonRatio:NU,density:7850,yieldStress:SY},config:{model:'linear',element,linearSolver:'ldl',maxNewtonIterations:200}});
  b.constrain(b.selectNodes(x=>near(x,0)),[0,null,null]);b.constrain(b.selectNodes(()=>true),[null,null,0]);b.constrain(b.selectNodes((x,y)=>near(x,0)&&near(y,h/2)),[0,0,null]);
  const end=b.selectNodes(x=>near(x,L)),X=b.referencePositions,sy=2/Math.sqrt(3)*SY,ky=2*sy/(E/(1-NU*NU)*h);let M=0;
  for(let s=1;s<=8;s++){const k=16*ky*s/8;for(const n of end)b.constrain([n],[-k*L*(X[3*n+1]-h/2),null,null]);const r=b.solveStatic();assert.ok(r.converged);M=0;for(const n of end)M-=r.reactions[3*n]*(X[3*n+1]-h/2);}
  return M/dz/(sy*h*h/4*(1-1/(3*16*16)));
}

test('plastic incompressibility: plane-strain pure bending at 16 k_y with tet4-nodal against tet4',()=>{
  const rows=[2,4,8].map(ny=>({ny,nodal:planeStrainBend(ny,'tet4-nodal'),standard:planeStrainBend(ny,'tet4')}));
  console.log(`# plane-strain bending M / M(k) at 16 k_y: ${rows.map(r=>`${r.ny} cells: tet4-nodal ${r.nodal.toFixed(4)}, tet4 ${r.standard.toFixed(4)}`).join('; ')}`);
  for(const r of rows)assert.ok(r.nodal>1&&r.nodal<r.standard,'above the closed form (bending of linear tetrahedra), below tet4');
  // Measured 1.048 and 1.013 at 4 and 8 cells (tet4 1.068, 1.020): the locking part is removed, the bending part of linear
  // tetrahedra stays.
  assert.ok(rows[1].nodal<1.055&&rows[2].nodal<1.016,`${rows.map(r=>r.nodal)}`);
});

test('inputs: the element and the linear solver are checked; the concrete law keeps tet4',()=>{
  const mesh=()=>boxMesh({size:[1,1,1],cells:[1,1,1]});
  invalid(()=>new SolidBody({mesh:mesh(),material:steel,config:{element:'tet10'}}));
  invalid(()=>new SolidBody({mesh:mesh(),material:steel,config:{linearSolver:'gmres'}}));
  invalid(()=>new SolidBody({mesh:mesh(),material:concreteMaterial('concrete-c30-37',{allowUnverified:true}),config:{element:'tet4-nodal'}}));
  const b=new SolidBody({mesh:mesh(),material:steel,config:{element:'tet4-nodal',linearSolver:'ldl'}});
  assert.equal(b.element,'tet4-nodal');assert.equal(b.linearSolver,'ldl');
  // The explicit limit is that of tet4: the averaged element's energy is never above tet4's.
  const t4=new SolidBody({mesh:mesh(),material:steel});assert.equal(b.explicitLimit().criticalTimeStep,t4.explicitLimit().criticalTimeStep);
});

test('the sparse preconditioner changes the iterations, not the answer: ldl and cg agree within the solve tolerance',()=>{
  for(const element of ['tet4','tet4-nodal']){
    const run=linearSolver=>{const b=new SolidBody({mesh:boxMesh({size:[.1,.02,.02],cells:[10,2,2]}),material:{...steel,yieldStress:250e6,hardeningModulus:2e9},config:{model:'green-lagrange',element,linearSolver,tolerance:1e-10}});
      b.constrain(b.selectNodes(x=>near(x,0)));b.constrain(b.selectNodes(x=>near(x,.1)),[0,-.004,0]);const r=b.solveStatic({loadSteps:4});assert.ok(r.converged);return {u:r.displacements,cg:r.linearIterations};};
    const a=run('cg'),b=run('ldl');let d=0,s=0;for(let j=0;j<a.u.length;j++){d=Math.max(d,Math.abs(a.u[j]-b.u[j]));s=Math.max(s,Math.abs(a.u[j]));}
    console.log(`# ${element}: |u_ldl - u_cg| ${(d/s).toExponential(2)} of the largest; inner iterations cg ${a.cg}, ldl ${b.cg}`);
    assert.ok(d<1e-7*s,`${d/s}`);assert.ok(b.cg<a.cg/5,'far fewer inner iterations');
  }
});

test('a viscoelastic tet4-nodal body in contact with an ldl preconditioner resumes from a checkpoint bit for bit (the kept factorization is state)',()=>{
  const make=()=>{
    const b=new SolidBody({mesh:boxMesh({size:[.2,.2,.2],cells:[3,3,3]}),material:{youngModulus:2e6,poissonRatio:.49,density:1100},config:{model:'neo-hookean',dt:1/30,gravity:[0,-9.81,0],massDamping:2,tolerance:1e-8,element:'tet4-nodal',linearSolver:'ldl',viscoelastic:{branches:[{ratio:1,time:.3}]}}});
    const c=new SolidContact(b,{gravity:[0,-9.81,0]});
    c.addBody({shape:{kind:'plane',normal:[0,1,0]},type:'static',position:[0,0,0],rotation:[0,0,0,1],friction:.5});
    const top=c.addBody({shape:{kind:'box',halfExtents:[.3,.05,.3]},type:'kinematic',position:[0,.25,0],rotation:[0,0,0,1],friction:.5});
    c.weld(b.selectNodes((x,y)=>y>.2-1e-9),top);
    c.setBodyState(top,{position:[0,.25,0],rotation:[0,0,0,1],linearVelocity:[0,-.03,0],angularVelocity:[0,0,0]});
    return {b,c};
  };
  const a=make();a.c.step(6);const saved={b:a.b.saveState(),c:a.c.saveState()};a.c.step(6);
  const r=make();r.b.restoreState(saved.b);r.c.restoreState(saved.c);r.c.step(6);
  assert.equal(bits(r.b.displacements),bits(a.b.displacements));assert.equal(bits(r.b.stresses()),bits(a.b.stresses()));
  const again=make();again.c.step(12);assert.equal(bits(again.b.displacements),bits(a.b.displacements),'repeat runs are bit-identical');
  assert.ok(a.c.stats.converged&&a.c.stats.unconvergedSteps===0);
});
