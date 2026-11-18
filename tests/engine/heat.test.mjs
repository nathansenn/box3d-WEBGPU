// Closed-form validation of the heat-conduction solver (src/engine/heat.ts). SI units throughout.
// Every tolerance is stated with the discretisation or solver error that justifies it, and the
// measured numbers are printed as test diagnostics (they are the source of docs/HEAT_TRANSFER.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {HeatSolver,HEAT_SOLVER_ID,HEAT_MAX_CELLS,STEFAN_BOLTZMANN,heatExplicitLimit,thermalStrain,restrainedThermalStress,thermalShock} from '../../src/engine/heat.ts';
import {EngineError} from '../../src/engine/contracts.ts';

const close=(actual,expected,atol=0,rtol=0,label='')=>assert.ok(Math.abs(actual-expected)<=atol+rtol*Math.abs(expected),`${label} ${actual} != ${expected}, error ${Math.abs(actual-expected)}, allowed ${atol+rtol*Math.abs(expected)}`);
const order=(coarse,fine,ratio=2)=>Math.log(coarse/fine)/Math.log(ratio);
const sci=value=>value.toExponential(3);
const rejects=(make,code)=>assert.throws(make,error=>error instanceof EngineError&&error.code===code,`expected EngineError ${code}`);
const maxDifference=(a,b)=>{let m=0;for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i]));return m;};

/** erf to about 1e-15: Maclaurin series below 3, Lentz-free continued fraction of erfc above. */
function erf(x){
  const ax=Math.abs(x);
  let value;
  if(ax<3){
    let sum=ax,term=ax;
    for(let n=1;n<200;n++){term*=-ax*ax/n;const add=term/(2*n+1);sum+=add;if(Math.abs(add)<1e-17*Math.abs(sum))break;}
    value=2/Math.sqrt(Math.PI)*sum;
  }else{
    let f=0;
    for(let n=60;n>=1;n--)f=n/2/(ax+f);
    value=1-Math.exp(-ax*ax)/Math.sqrt(Math.PI)/(ax+f);
  }
  return x<0?-value:value;
}

const steel={conductivity:50,density:7800,specificHeat:500};
const alphaSteel=steel.conductivity/(steel.density*steel.specificHeat);
const copper={conductivity:400,density:8900,specificHeat:385};
/** A 1-D bar along x with unit cross-section. */
const slab=(nx,length,extra)=>new HeatSolver({nx,ny:1,nz:1,dx:length/nx,dy:1,dz:1,materials:[steel],temperature:300,...extra});

test('the solver has a versioned identity and validates its input',()=>{
  assert.equal(HEAT_SOLVER_ID,'heat-fv-implicit-js-f64-v1');
  assert.equal(slab(4,1).id,HEAT_SOLVER_ID);
  assert.equal(STEFAN_BOLTZMANN,5.670374419e-8);
  close(erf(1),.8427007929497149,2e-15);close(erf(.5),.5204998778130465,2e-15);close(erf(3.5),.9999992569016276,2e-15);
  const base={nx:2,ny:2,nz:1,dx:.1,dy:.1,dz:.1,materials:[steel],temperature:300};
  for(const patch of [{nx:0},{nx:1.5},{dx:0},{dy:-1},{dz:Infinity},{materials:[]},{materials:[{...steel,density:0}]},{materials:[{density:1,specificHeat:1}]},
    {materials:[{...steel,conductivityTable:{temperatures:[0,1],conductivities:[1,2]}}]},{materials:[{density:1,specificHeat:1,conductivityTable:{temperatures:[1,1],conductivities:[1,2]}}]},
    {temperature:NaN},{temperature:[1,2,3]},{material:[0,0,0,1]},{solid:[0,0,0,0]},{scheme:'rk4'},{dt:0},{tolerance:1},{unknown:1},
    {nx:2048,ny:2048,nz:1},{heatGeneration:[1,2]},{sources:[{min:[0,0,0]}]},{sources:[{min:[0,0,0],power:1,density:1}]},{sources:[{min:[2,0,0],power:1}]},
    {boundaries:[{face:'x-',type:'temperature'}]},{boundaries:[{face:'w',type:'flux',flux:0}]},{boundaries:[{face:'x-',type:'robin',flux:0}]},
    {boundaries:[{face:'x-',type:'convection',coefficient:-1,ambient:300}]},{boundaries:[{face:'x-',type:'radiation',emissivity:1.5,environment:300}]},
    {boundaries:[{face:'x-',type:'radiation',emissivity:.5,environment:-1}]},{boundaries:[{face:'x-',type:'flux',flux:0,region:{min:[1,0,0],max:[1,1,0]}}]},
    {boundaries:[{face:'x-',type:'temperature',temperature:1},{face:'x-',type:'flux',flux:1}]},{boundaries:[{face:'x-',type:'temperature',temperature:1,extra:2}]}]){
    rejects(()=>new HeatSolver({...base,...patch}),'INVALID_PAYLOAD');
  }
  assert.equal(HEAT_MAX_CELLS,2097152);
  const solver=new HeatSolver({...base,boundaries:[{face:'x-',type:'flux',flux:5}]});
  rejects(()=>solver.step(),'INVALID_STATE');                    // no time step was given
  rejects(()=>solver.solveSteady(),'SINGULAR_STEADY');           // flux only: no steady temperature
  rejects(()=>solver.updateBoundary(0,{temperature:1}),'INVALID_PAYLOAD');
  rejects(()=>solver.cellFaceFlux(0,0,0,'q'),'INVALID_PAYLOAD');
  rejects(()=>new HeatSolver({...base,temperature:-5,dt:1,boundaries:[{face:'x-',type:'radiation',emissivity:.5,environment:300}]}),'INVALID_STATE');
  // Flux and convection may share a face; the sum acts.
  const shared=new HeatSolver({...base,boundaries:[{face:'x+',type:'flux',flux:100},{face:'x+',type:'convection',coefficient:10,ambient:300}]});
  close(shared.cellFaceFlux(1,0,0,'x+'),-100,1e-12);
});

test('steady slab with fixed end temperatures: linear profile and flux k dT / L',t=>{
  const nx=20,L=.2,hot=400,cold=300;
  const solver=slab(nx,L,{boundaries:[{face:'x-',type:'temperature',temperature:hot},{face:'x+',type:'temperature',temperature:cold}]});
  const result=solver.solveSteady();
  assert.equal(result.converged,true);assert.equal(result.outerIterations,1);
  let worst=0;
  for(let i=0;i<nx;i++)worst=Math.max(worst,Math.abs(solver.temperature[i]-(hot+(cold-hot)*(i+.5)/nx)));
  const flux=steel.conductivity*(hot-cold)/L,faces=solver.faceHeatFlux();
  let fluxError=0;
  for(let i=0;i<nx-1;i++)fluxError=Math.max(fluxError,Math.abs(faces.x[i]-flux)/flux);
  t.diagnostic(`linear profile: max error ${sci(worst)} K; flux ${flux} W/m^2, max relative error ${sci(fluxError)}; CG iterations ${result.iterations}`);
  // A linear profile is reproduced exactly by the scheme, so only the linear-solver residual (1e-12
  // relative) and roundoff remain: 1e-9 K on a 100 K difference.
  assert.ok(worst<=1e-9,`profile error ${worst}`);
  assert.ok(fluxError<=1e-10,`flux error ${fluxError}`);
  close(solver.boundaryHeatRate(0),flux,0,1e-10,'heat in');close(solver.boundaryHeatRate(1),-flux,0,1e-10,'heat out');
  close(solver.cellFaceFlux(0,0,0,'x-'),-flux,0,1e-10);close(solver.cellFaceFlux(nx-1,0,0,'x+'),flux,0,1e-10);
  assert.equal(solver.faceTemperature(0,0,0,'x-'),hot);
  close(solver.faceTemperature(4,0,0,'x+'),hot+(cold-hot)*5/nx,1e-9);
  assert.equal(solver.time,0);
});

test('composite walls of two and three materials: interface temperatures and flux from the resistances',t=>{
  const layers=[{k:.7,cells:10},{k:.04,cells:5},{k:1.4,cells:15}],h=.01,hot=293.15,cold=263.15;
  for(const used of [layers.slice(0,2),layers]){
    const nx=used.reduce((sum,layer)=>sum+layer.cells,0),material=[];
    used.forEach((layer,m)=>{for(let i=0;i<layer.cells;i++)material.push(m);});
    const solver=new HeatSolver({nx,ny:1,nz:1,dx:h,dy:1,dz:1,temperature:280,material,
      materials:used.map(layer=>({conductivity:layer.k,density:1800,specificHeat:900})),
      boundaries:[{face:'x-',type:'temperature',temperature:hot},{face:'x+',type:'temperature',temperature:cold}]});
    assert.equal(solver.solveSteady().converged,true);
    const resistance=used.map(layer=>layer.cells*h/layer.k),flux=(hot-cold)/resistance.reduce((a,b)=>a+b,0);
    let boundary=0,interfaceT=hot,worst=0;
    const faces=solver.faceHeatFlux();
    let fluxError=0;
    for(let i=0;i<nx-1;i++)fluxError=Math.max(fluxError,Math.abs(faces.x[i]-flux)/flux);
    for(let m=0;m<used.length-1;m++){
      boundary+=used[m].cells;interfaceT-=flux*resistance[m];
      // Both cells that share the interface must report the same interface temperature.
      worst=Math.max(worst,Math.abs(solver.faceTemperature(boundary-1,0,0,'x+')-interfaceT),Math.abs(solver.faceTemperature(boundary,0,0,'x-')-interfaceT));
    }
    t.diagnostic(`${used.length} layers: flux ${flux.toFixed(6)} W/m^2, relative error ${sci(fluxError)}; interface temperature error ${sci(worst)} K`);
    // The harmonic-mean face conductivity makes a piecewise-linear profile exact: solver tolerance only.
    assert.ok(fluxError<=1e-9,`flux error ${fluxError}`);
    assert.ok(worst<=1e-9,`interface error ${worst}`);
  }
});

test('steady slab with a uniform source: the parabola, second order, with the predicted offset',t=>{
  const L=.1,q=2e6,k=steel.conductivity,T0=300,errors=[];
  for(const nx of [8,16,32,64]){
    const h=L/nx,solver=slab(nx,L,{heatGeneration:q,boundaries:[{face:'x-',type:'temperature',temperature:T0},{face:'x+',type:'temperature',temperature:T0}]});
    assert.equal(solver.solveSteady().converged,true);
    let worst=0,offsetError=0;
    for(let i=0;i<nx;i++){
      const x=(i+.5)*h,exact=T0+q*x*(L-x)/(2*k),error=solver.temperature[i]-exact;
      worst=Math.max(worst,Math.abs(error));offsetError=Math.max(offsetError,Math.abs(error-q*h*h/(8*k)));
    }
    errors.push(worst);
    // The half-cell fixed-temperature face shifts the whole discrete parabola by q h^2 / (8 k).
    assert.ok(offsetError<=1e-9,`nx ${nx}: error differs from q h^2/(8k) by ${offsetError}`);
    // Energy balance: all generated heat leaves through the two faces.
    close(solver.boundaryHeatRate(0)+solver.boundaryHeatRate(1),-q*L,0,1e-10,'heat balance');
    close(solver.sourcePower(),q*L,0,1e-12);
  }
  const orders=errors.slice(1).map((error,i)=>order(errors[i],error));
  t.diagnostic(`parabola peak rise ${q*L*L/(8*k)} K; max error by nx 8,16,32,64: ${errors.map(sci).join(', ')} K; orders ${orders.map(o=>o.toFixed(4)).join(', ')}`);
  for(const o of orders)assert.ok(Math.abs(o-2)<=.001,`order ${o}`);
  // Tolerance: the predicted offset q h^2/(8k) at nx = 64 is 0.0122 K on a 50 K rise.
  assert.ok(errors[3]<=q*(L/64)**2/(8*k)*(1+1e-6));
});

test('a point source splits its heat by the two conduction paths (exact)',()=>{
  const nx=10,L=1,power=40,cell=3,h=L/nx;
  const solver=slab(nx,L,{sources:[{min:[cell,0,0],power}],boundaries:[{face:'x-',type:'temperature',temperature:0},{face:'x+',type:'temperature',temperature:0}]});
  assert.equal(solver.solveSteady().converged,true);
  const x=(cell+.5)*h,left=x/steel.conductivity,right=(L-x)/steel.conductivity,peak=power*left*right/(left+right);
  close(solver.temperature[cell],peak,1e-10);
  close(solver.boundaryHeatRate(0),-power*right/(left+right),0,1e-10);close(solver.boundaryHeatRate(1),-power*left/(left+right),0,1e-10);
  // A region source of the same total power is spread by volume.
  const spread=slab(nx,L,{sources:[{min:[2,0,0],max:[5,0,0],power}]});
  close(spread.sourcePower(),power,0,1e-14);close(spread.heatGeneration[4],power/(4*h),0,1e-14);assert.equal(spread.heatGeneration[6],0);
});

test('convection boundary: flux = dT / (L/k + 1/h_c), and the surface temperature',t=>{
  const nx=12,L=.3,hot=500,ambient=290,film=25;
  const solver=slab(nx,L,{boundaries:[{face:'x-',type:'temperature',temperature:hot},{face:'x+',type:'convection',coefficient:film,ambient}]});
  assert.equal(solver.solveSteady().converged,true);
  const flux=(hot-ambient)/(L/steel.conductivity+1/film),surface=ambient+flux/film;
  const measured=-solver.boundaryHeatRate(1),surfaceMeasured=solver.faceTemperature(nx-1,0,0,'x+');
  t.diagnostic(`flux ${flux.toFixed(6)} W/m^2, relative error ${sci(Math.abs(measured-flux)/flux)}; surface ${surface.toFixed(6)} K, error ${sci(Math.abs(surfaceMeasured-surface))} K`);
  // Half-cell conduction and the film are two resistances in series, so the result is exact.
  close(measured,flux,0,1e-10,'flux');close(solver.boundaryHeatRate(0),flux,0,1e-10);
  close(surfaceMeasured,surface,1e-9,0,'surface');
  close(solver.boundaryArea(1),1,1e-15);
  // Raising the ambient through updateBoundary moves the answer with it.
  solver.updateBoundary(1,{ambient:hot});solver.solveSteady();
  close(solver.boundaryHeatRate(1),0,1e-7);
});

test('temperature-dependent conductivity: the Kirchhoff flux, second order',t=>{
  const L=.2,hot=600,cold=300;
  const run=(nx,conductivityTable)=>{
    const solver=new HeatSolver({nx,ny:1,nz:1,dx:L/nx,dy:1,dz:1,temperature:450,materials:[{density:2000,specificHeat:800,conductivityTable}],
      boundaries:[{face:'x-',type:'temperature',temperature:hot},{face:'x+',type:'temperature',temperature:cold}]});
    assert.equal(solver.solveSteady().converged,true);
    close(solver.boundaryHeatRate(0),-solver.boundaryHeatRate(1),0,1e-9,'steady balance');
    return solver.boundaryHeatRate(0);
  };
  // k = k0 (1 + beta T): flux = k0 [(T1 - T2) + beta (T1^2 - T2^2) / 2] / L. With a linear k(T) the
  // harmonic-mean scheme returns this flux exactly on any grid (the temperatures are still second order).
  const k0=10,beta=.004,linear=k0*((hot-cold)+beta/2*(hot*hot-cold*cold))/L;
  const linearErrors=[4,8].map(nx=>Math.abs(run(nx,{temperatures:[0,1000],conductivities:[k0,k0*(1+beta*1000)]})-linear)/linear);
  for(const error of linearErrors)assert.ok(error<=1e-9,`linear k(T) flux error ${error}`);
  // k = 5 + 1e-4 T^2 (14 to 41 W/(m K) across the slab), tabulated every kelvin. The reference is the
  // exact integral of the table, flux = (1/L) * integral of k dT, so only the grid error is measured.
  const temperatures=[],conductivities=[];
  for(let T=250;T<=650;T++){temperatures.push(T);conductivities.push(5+1e-4*T*T);}
  let integral=0;
  for(let i=1;i<temperatures.length;i++)if(temperatures[i]>cold&&temperatures[i]<=hot)integral+=(conductivities[i]+conductivities[i-1])/2;
  const exact=integral/L,errors=[8,16,32].map(nx=>Math.abs(run(nx,{temperatures,conductivities})-exact)/exact);
  const orders=errors.slice(1).map((error,i)=>order(errors[i],error));
  t.diagnostic(`linear k(T): flux ${linear} W/m^2, relative error at 4 and 8 cells ${linearErrors.map(sci).join(', ')}`);
  t.diagnostic(`quadratic k(T): flux ${exact} W/m^2; relative error by nx 8,16,32: ${errors.map(sci).join(', ')}; orders ${orders.map(o=>o.toFixed(3)).join(', ')}`);
  for(const o of orders)assert.ok(Math.abs(o-2)<=.1,`order ${o}`);
  // Tolerance: second-order error of the cell-centred k for a threefold change in k across the slab.
  assert.ok(errors[2]<=5e-4,`error ${errors[2]}`);
});

/** A semi-infinite solid at 300 K whose surface jumps to 400 K at t = 0, compared at t = 100 s.
 * The bar is 0.5 m long: 7 diffusion lengths sqrt(4 alpha t), so the far end does not matter. */
function semiInfinite(scheme,nx,dt){
  const L=.5,h=L/nx,solver=slab(nx,L,{dt,scheme,boundaries:[{face:'x-',type:'temperature',temperature:400}]});
  solver.step(Math.round(100/dt));
  let worst=0;
  for(let i=0;i<nx;i++)worst=Math.max(worst,Math.abs(solver.temperature[i]-(400-100*erf((i+.5)*h/(2*Math.sqrt(alphaSteel*solver.time))))));
  return {error:worst/100,solver};
}

test('semi-infinite solid with a sudden surface temperature: the erfc solution at the order of each scheme',t=>{
  const delta=Math.sqrt(4*alphaSteel*100);
  // Crank-Nicolson, h and dt halved together: second order in both.
  const cn=[50,100,200].map(nx=>semiInfinite('crank-nicolson',nx,250/nx).error),cnOrders=[order(cn[0],cn[1]),order(cn[1],cn[2])];
  // Backward Euler: first order in dt (dt halved with h), and second order when dt follows h^2.
  const beLinear=[50,100,200].map(nx=>semiInfinite('backward-euler',nx,250/nx).error),beLinearOrders=[order(beLinear[0],beLinear[1]),order(beLinear[1],beLinear[2])];
  const beSquare=[50,100,200].map(nx=>semiInfinite('backward-euler',nx,5*(50/nx)**2).error),beSquareOrders=[order(beSquare[0],beSquare[1]),order(beSquare[1],beSquare[2])];
  t.diagnostic(`diffusion length ${delta.toFixed(5)} m; errors are max |T - exact| / 100 K at nx 50,100,200`);
  t.diagnostic(`Crank-Nicolson, dt ~ h: ${cn.map(sci).join(', ')}; orders ${cnOrders.map(o=>o.toFixed(3)).join(', ')}`);
  t.diagnostic(`backward Euler, dt ~ h: ${beLinear.map(sci).join(', ')}; orders ${beLinearOrders.map(o=>o.toFixed(3)).join(', ')}`);
  t.diagnostic(`backward Euler, dt ~ h^2: ${beSquare.map(sci).join(', ')}; orders ${beSquareOrders.map(o=>o.toFixed(3)).join(', ')}`);
  for(const o of cnOrders)assert.ok(Math.abs(o-2)<=.05,`Crank-Nicolson order ${o}`);
  for(const o of beSquareOrders)assert.ok(Math.abs(o-2)<=.05,`backward Euler order with dt ~ h^2: ${o}`);
  // First order is approached from above as the second-order space error fades.
  assert.ok(beLinearOrders[1]>.95&&beLinearOrders[1]<1.25&&beLinearOrders[1]<beLinearOrders[0],`backward Euler order ${beLinearOrders}`);
  // Tolerance: the Crank-Nicolson error is 0.124 (h/delta)^2 at this resolution; allow 0.25 (h/delta)^2.
  assert.ok(cn[2]<=.25*(.5/200/delta)**2,`Crank-Nicolson error ${cn[2]}`);
  assert.ok(beSquare[2]<=.6*(.5/200/delta)**2,`backward Euler error ${beSquare[2]}`);

  // Order in dt alone, at fixed h: differences between successive halvings of dt fall 4x and 2x.
  const fields=scheme=>[2,1,.5].map(dt=>Float64Array.from(semiInfinite(scheme,200,dt).solver.temperature));
  const cnFields=fields('crank-nicolson'),beFields=fields('backward-euler');
  const cnTime=order(maxDifference(cnFields[0],cnFields[1]),maxDifference(cnFields[1],cnFields[2]));
  const beTime=order(maxDifference(beFields[0],beFields[1]),maxDifference(beFields[1],beFields[2]));
  t.diagnostic(`order in dt alone (nx 200, dt 2,1,0.5 s): Crank-Nicolson ${cnTime.toFixed(4)}, backward Euler ${beTime.toFixed(4)}`);
  assert.ok(Math.abs(cnTime-2)<=.02,`Crank-Nicolson time order ${cnTime}`);
  assert.ok(Math.abs(beTime-1)<=.02,`backward Euler time order ${beTime}`);

  // A documented limit: Crank-Nicolson does not damp the sharpest modes, so a sudden surface change
  // overshoots and rings when alpha dt / h^2 is large. Backward Euler never leaves the range of the data.
  const peak=scheme=>{
    const solver=slab(200,.5,{dt:4,scheme,boundaries:[{face:'x-',type:'temperature',temperature:400}]});
    let highest=-Infinity;
    for(let s=0;s<25;s++){solver.step();for(const value of solver.temperature)highest=Math.max(highest,value);}
    return highest;
  };
  const cnPeak=peak('crank-nicolson'),bePeak=peak('backward-euler'),large=semiInfinite('crank-nicolson',200,4).error;
  t.diagnostic(`alpha dt / h^2 = ${(alphaSteel*4/(.5/200)**2).toFixed(2)}: highest cell temperature in 25 steps is ${cnPeak.toFixed(2)} K with Crank-Nicolson (surface 400 K) and ${bePeak.toFixed(2)} K with backward Euler; Crank-Nicolson error at t = 100 s is ${sci(large)}`);
  assert.ok(bePeak<=400,'backward Euler stays inside the data range');
  assert.ok(cnPeak>400,'Crank-Nicolson overshoots at this time step (documented limit)');
});

/** Fourier series for a slab at T0 whose two faces are held at Ts from t = 0. */
function slabSeries(x,time,L,alpha,T0,Ts){
  let sum=0;
  for(let n=1;n<400;n+=2)sum+=4/(n*Math.PI)*Math.sin(n*Math.PI*x/L)*Math.exp(-alpha*(n*Math.PI/L)**2*time);
  return Ts+(T0-Ts)*sum;
}

test('slab cooling with fixed-temperature faces: the Fourier series and the first-mode decay rate',t=>{
  const L=.1,T0=500,Ts=300,rate=alphaSteel*(Math.PI/L)**2,faces=[{face:'x-',type:'temperature',temperature:Ts},{face:'x+',type:'temperature',temperature:Ts}];
  // Whole profile at Fourier numbers 0.05 and 0.2 (several modes still matter at 0.05).
  const errors=[];
  for(const nx of [20,40,80]){
    const h=L/nx,dt=20/nx,solver=slab(nx,L,{temperature:T0,dt,scheme:'crank-nicolson',boundaries:faces});
    let worst=0;
    for(const fourier of [.05,.2]){
      solver.step(Math.round(fourier*L*L/alphaSteel/dt)-solver.steps);
      for(let i=0;i<nx;i++)worst=Math.max(worst,Math.abs(solver.temperature[i]-slabSeries((i+.5)*h,solver.time,L,alphaSteel,T0,Ts)));
    }
    errors.push(worst/(T0-Ts));
  }
  const orders=[order(errors[0],errors[1]),order(errors[1],errors[2])];
  t.diagnostic(`series profile, max error / 200 K at nx 20,40,80 (Crank-Nicolson, dt ~ h): ${errors.map(sci).join(', ')}; orders ${orders.map(o=>o.toFixed(3)).join(', ')}`);
  for(const o of orders)assert.ok(Math.abs(o-2)<=.1,`order ${o}`);
  // Tolerance: second-order error, measured 1.6e-4 at 80 cells; 3e-4 allows the same constant at 60 cells.
  assert.ok(errors[2]<=3e-4,`series error ${errors[2]}`);

  // First-mode decay rate alpha (pi/L)^2 from a pure sine mode, which the discrete operator keeps a
  // sine. The discrete rate is known in closed form, so the measured rate is checked twice: against
  // the discrete prediction (solver precision) and against the continuum rate (discretisation).
  const measure=(scheme,nx,dt,steps)=>{
    const h=L/nx,initial=Float64Array.from({length:nx},(_,i)=>Ts+100*Math.sin(Math.PI*(i+.5)*h/L));
    const solver=slab(nx,L,{temperature:initial,dt,scheme,boundaries:faces});
    solver.step(steps);
    const mid=nx>>1,ratio=(solver.temperature[mid]-Ts)/(initial[mid]-Ts);
    const lambda=4*alphaSteel/(h*h)*Math.sin(Math.PI*h/(2*L))**2,z=lambda*dt;
    const growth=scheme==='crank-nicolson'?(1-z/2)/(1+z/2):1/(1+z);
    return {rate:-Math.log(ratio)/solver.time,discrete:-Math.log(growth)/dt,lambda};
  };
  const tau=1/rate;
  // Space error: against the continuum rate with a tiny dt. Time error: against the exact rate of the
  // space-discrete system (lambda), so the two orders are measured separately.
  const space=[10,20,40].map(nx=>measure('crank-nicolson',nx,tau/2000,2000)),spaceErrors=space.map(m=>Math.abs(m.rate-rate)/rate);
  const cnTime=[10,20,40].map(steps=>measure('crank-nicolson',160,tau/steps,steps)),cnTimeErrors=cnTime.map(m=>Math.abs(m.rate-m.lambda)/m.lambda);
  const beTime=[40,80,160].map(steps=>measure('backward-euler',160,tau/steps,steps)),beTimeErrors=beTime.map(m=>Math.abs(m.rate-m.lambda)/m.lambda);
  for(const m of [...space,...cnTime,...beTime])close(m.rate,m.discrete,0,1e-9,'discrete decay rate');
  const spaceOrders=[order(spaceErrors[0],spaceErrors[1]),order(spaceErrors[1],spaceErrors[2])];
  const cnOrders=[order(cnTimeErrors[0],cnTimeErrors[1]),order(cnTimeErrors[1],cnTimeErrors[2])];
  const beOrders=[order(beTimeErrors[0],beTimeErrors[1]),order(beTimeErrors[1],beTimeErrors[2])];
  t.diagnostic(`first-mode rate ${rate.toExponential(6)} 1/s; relative error by nx 10,20,40: ${spaceErrors.map(sci).join(', ')} (predicted (pi h/L)^2/12 = ${sci((Math.PI/40)**2/12)} at 40); orders ${spaceOrders.map(o=>o.toFixed(3)).join(', ')}`);
  t.diagnostic(`time error of the rate, Crank-Nicolson (10,20,40 steps per time constant): ${cnTimeErrors.map(sci).join(', ')}; orders ${cnOrders.map(o=>o.toFixed(3)).join(', ')}`);
  t.diagnostic(`time error of the rate, backward Euler (40,80,160 steps per time constant): ${beTimeErrors.map(sci).join(', ')}; orders ${beOrders.map(o=>o.toFixed(3)).join(', ')}`);
  for(const o of spaceOrders)assert.ok(Math.abs(o-2)<=.02,`space order ${o}`);
  for(const o of cnOrders)assert.ok(Math.abs(o-2)<=.02,`Crank-Nicolson time order ${o}`);
  for(const o of beOrders)assert.ok(Math.abs(o-1)<=.03,`backward Euler time order ${o}`);
  // Tolerance: the leading space error of the rate is (pi h/L)^2/12 = 5.1e-4 at 40 cells.
  close(spaceErrors[2],(Math.PI/40)**2/12,2e-6,0,'space error of the rate');

  // The same rate from the cooling slab itself, once the higher modes have died (Fo 0.5 to 0.8).
  const nx=80,dt=.25,solver=slab(nx,L,{temperature:T0,dt,scheme:'crank-nicolson',boundaries:faces});
  solver.step(Math.round(.5*L*L/alphaSteel/dt));
  const t1=solver.time,a1=(solver.temperature[nx>>1]-Ts);
  solver.step(Math.round(.3*L*L/alphaSteel/dt));
  const late=-Math.log((solver.temperature[nx>>1]-Ts)/a1)/(solver.time-t1);
  t.diagnostic(`late-time rate of the cooling slab: ${late.toExponential(6)} 1/s, relative error ${sci(Math.abs(late-rate)/rate)}`);
  // Tolerance: (pi h/L)^2/12 = 1.3e-4 in space plus the third mode's remnant exp(-8 pi^2 0.5) ~ 1e-17.
  close(late,rate,0,3e-4,'late-time decay rate');
});

test('lumped-capacitance cooling of a small-Biot block: T = T_inf + (T0 - T_inf) exp(-h A t / (rho c V))',t=>{
  const n=4,side=.02,film=10,T0=400,ambient=300,boundaries=['x-','x+','y-','y+','z-','z+'].map(face=>({face,type:'convection',coefficient:film,ambient}));
  const tau=copper.density*copper.specificHeat*(side/6)/film,biot=film*(side/6)/copper.conductivity,steps=100;
  const solver=new HeatSolver({nx:n,ny:n,nz:n,dx:side/n,dy:side/n,dz:side/n,materials:[copper],temperature:T0,dt:tau/steps,scheme:'crank-nicolson',boundaries});
  let worst=0,worstMean=0,spread=0;
  for(let s=0;s<steps;s++){
    solver.step();
    const exact=ambient+(T0-ambient)*Math.exp(-solver.time/tau);
    let low=Infinity,high=-Infinity,sum=0;
    for(const value of solver.temperature){worst=Math.max(worst,Math.abs(value-exact));low=Math.min(low,value);high=Math.max(high,value);sum+=value;}
    spread=Math.max(spread,high-low);worstMean=Math.max(worstMean,Math.abs(sum/n**3-exact));
  }
  const halfSideBiot=film*(side/2)/copper.conductivity;
  t.diagnostic(`Biot number h (V/A) / k = ${sci(biot)}, time constant ${tau.toFixed(2)} s; over one time constant: mean-temperature error ${sci(worstMean/(T0-ambient))}, worst cell error ${sci(worst/(T0-ambient))} (of 100 K); largest spread inside the block ${sci(spread)} K`);
  // Tolerance: the lumped law describes the mean temperature and is itself good to order Bi = 8.3e-5
  // (the scheme adds (dt/tau)^2/12 = 8e-6). Single cells also differ from the mean by the gradient
  // inside the block, of order h (side/2) / k = 2.5e-4, so that is the bound for the worst cell.
  assert.ok(biot<1e-4);
  assert.ok(worstMean/(T0-ambient)<=biot,`lumped error of the mean ${worstMean/(T0-ambient)}`);
  assert.ok(worst/(T0-ambient)<=halfSideBiot,`lumped error of the worst cell ${worst/(T0-ambient)}`);
  assert.ok(spread<=2*halfSideBiot*(T0-ambient),`the block is not isothermal: ${spread} K`);
  // Energy leaves only through the film: stored-energy change equals the boundary ledger.
  const lost=copper.density*copper.specificHeat*side**3*T0-solver.storedEnergy();
  close(-solver.boundaryEnergy.reduce((a,b)=>a+b,0),lost,0,1e-9,'ledger');
});

test('2-D steady plate with one hot edge: the series solution at the centre, second order',t=>{
  // Square plate: by superposition the centre is exactly a quarter of the hot-edge temperature.
  const plate=(n,width,height)=>{
    const solver=new HeatSolver({nx:n,ny:n,nz:1,dx:width/n,dy:height/n,dz:1,materials:[steel],temperature:0,
      boundaries:[{face:'y+',type:'temperature',temperature:100},{face:'y-',type:'temperature',temperature:0},{face:'x-',type:'temperature',temperature:0},{face:'x+',type:'temperature',temperature:0}]});
    const result=solver.solveSteady();
    assert.equal(result.converged,true);
    return {centre:solver.temperature[solver.index(n>>1,n>>1,0)],solver,result};
  };
  const square=plate(15,1,1);
  t.diagnostic(`square plate centre: ${square.centre} (exact 25), error ${sci(Math.abs(square.centre-25))}`);
  close(square.centre,25,1e-9,0,'square centre');   // exact on the grid too (discrete superposition)
  // 2 x 1 plate, hot long edge: T = (4 T1/pi) sum over odd n of sin(n pi/2) / (2 n cosh(n pi b / (2a))).
  let exact=0;
  for(let n=1;n<200;n+=2)exact+=Math.sin(n*Math.PI/2)/(2*n*Math.cosh(n*Math.PI*1/(2*2)));
  exact*=400/Math.PI;
  const errors=[],iterations=[];
  for(const n of [9,27,81]){const run=plate(n,2,1);errors.push(Math.abs(run.centre-exact));iterations.push(run.result.iterations);}
  const orders=[order(errors[0],errors[1],3),order(errors[1],errors[2],3)];
  t.diagnostic(`2 x 1 plate centre: series ${exact.toFixed(9)}; error at 9,27,81 cells per side: ${errors.map(sci).join(', ')} (of 100); orders ${orders.map(o=>o.toFixed(3)).join(', ')}; CG iterations ${iterations.join(', ')}`);
  for(const o of orders)assert.ok(Math.abs(o-2)<=.05,`order ${o}`);
  // Tolerance: second-order error with dx = 2 dy, measured 1.5e-3 K of 100 K at 81 x 81; allow 2e-3 K.
  assert.ok(errors[2]<=2e-3,`centre error ${errors[2]}`);
  // Heat in through the hot edge leaves through the three cold ones.
  const rates=plate(27,2,1).solver.boundaryHeatRates();
  close(rates[0],-(rates[1]+rates[2]+rates[3]),0,1e-9,'plate heat balance');
});

test('radiation: a thin plate radiating to cold surroundings matches the lumped ODE',t=>{
  const thickness=.001,emissivity=.8,T0=1000,duration=60,areal=copper.density*copper.specificHeat*thickness;
  const run=(scheme,dt,environment)=>{
    const solver=new HeatSolver({nx:1,ny:1,nz:1,dx:thickness,dy:1,dz:1,materials:[copper],temperature:T0,dt,scheme,
      boundaries:[{face:'x-',type:'radiation',emissivity,environment},{face:'x+',type:'radiation',emissivity,environment}]});
    solver.step(Math.round(duration/dt));
    return solver;
  };
  // Reference 1: surroundings at 0 K, closed form T = T0 (1 + 3 kappa T0^3 t)^(-1/3).
  const kappa=2*emissivity*STEFAN_BOLTZMANN/areal,closed=T0*(1+3*kappa*T0**3*duration)**(-1/3);
  // Reference 2: surroundings at 300 K, classical RK4 on dT/dt = -kappa (T^4 - Te^4) with 60000 steps.
  const rate=T=>-kappa*(T**4-300**4);
  let reference=T0;
  for(let s=0,h=duration/60000;s<60000;s++){
    const k1=rate(reference),k2=rate(reference+h/2*k1),k3=rate(reference+h/2*k2),k4=rate(reference+h*k3);
    reference+=h/6*(k1+2*k2+2*k3+k4);
  }
  // The plate is not perfectly lumped: its surface is cooler than its centre by q (L/2) / k.
  const biot=4*emissivity*STEFAN_BOLTZMANN*T0**3*(thickness/2)/copper.conductivity;
  const cold=[.5,.25,.125].map(dt=>Math.abs(run('crank-nicolson',dt,0).temperature[0]-closed));
  const warm=[.5,.25,.125].map(dt=>Math.abs(run('crank-nicolson',dt,300).temperature[0]-reference));
  const euler=[.5,.25,.125].map(dt=>Math.abs(run('backward-euler',dt,300).temperature[0]-reference));
  t.diagnostic(`plate ${T0} K -> ${closed.toFixed(4)} K (0 K surroundings, closed form) and ${reference.toFixed(4)} K (300 K, RK4) after ${duration} s; radiation Biot number ${sci(biot)}`);
  t.diagnostic(`Crank-Nicolson error at dt 0.5,0.25,0.125 s: ${cold.map(sci).join(', ')} K (0 K) and ${warm.map(sci).join(', ')} K (300 K)`);
  t.diagnostic(`backward Euler error at dt 0.5,0.25,0.125 s: ${euler.map(sci).join(', ')} K; order ${order(euler[1],euler[2]).toFixed(3)}`);
  // Tolerance: the lumped model differs from the conducting plate by order Bi (T0 - T) = 0.1 K (the
  // measured floor is 0.013 K); the linearised Crank-Nicolson step adds 0.0002 K at dt = 0.125 s.
  // Allow 0.1 K on a 440 K fall.
  assert.ok(cold[2]<=.1,`error ${cold[2]} K against the closed form`);
  assert.ok(warm[2]<=.1,`error ${warm[2]} K against RK4`);
  // Backward Euler with the per-step linearisation is first order in dt.
  assert.ok(Math.abs(order(euler[1],euler[2])-1)<=.1,`backward Euler order ${order(euler[1],euler[2])}`);
  assert.ok(euler[2]<=1,`backward Euler error ${euler[2]} K`);
  // Steady state between a radiating face and a fixed face: conduction equals radiation exactly.
  const wall=slab(10,.05,{temperature:600,boundaries:[{face:'x-',type:'temperature',temperature:900},{face:'x+',type:'radiation',emissivity:.9,environment:300}]});
  const steady=wall.solveSteady();
  assert.equal(steady.converged,true);
  const surface=wall.faceTemperature(9,0,0,'x+'),radiated=.9*STEFAN_BOLTZMANN*(surface**4-300**4),conducted=steel.conductivity*(900-surface)/.05;
  t.diagnostic(`radiating wall: surface ${surface.toFixed(6)} K, conducted ${conducted.toFixed(6)} W/m^2, radiated ${radiated.toFixed(6)} W/m^2, ${steady.outerIterations} Newton iterations`);
  close(conducted,radiated,0,1e-9,'conduction = radiation');close(-wall.boundaryHeatRate(1),radiated,0,1e-9);
});

/** A 3-D case with every feature at once: two materials (one with k(T)), a void, all four boundary
 * types, a volumetric source and a point source. */
function mixedCase(scheme,dt=2){
  const nx=6,ny=5,nz=4,n=nx*ny*nz,material=new Uint8Array(n),solid=new Uint8Array(n).fill(1),temperature=new Float64Array(n);
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const cell=i+nx*(j+ny*k);
    material[cell]=i<3?0:1;
    if(i>=2&&i<=3&&j>=2&&j<=3&&k>=1&&k<=2)solid[cell]=0;               // an internal cavity
    if(i===5&&j===4)solid[cell]=0;                                     // a notch on one edge
    temperature[cell]=500+40*Math.sin(.9*i+.4*j)-25*Math.cos(.7*k+.2*i);
  }
  return new HeatSolver({nx,ny,nz,dx:.01,dy:.012,dz:.015,material,solid,temperature,dt,scheme,
    materials:[steel,{density:2700,specificHeat:900,conductivityTable:{temperatures:[300,500,900],conductivities:[230,200,160]}}],
    heatGeneration:2e5,sources:[{min:[1,1,1],power:30}],
    boundaries:[
      {face:'x-',type:'temperature',temperature:450,region:{min:[0,0,0],max:[0,4,3]}},
      {face:'x+',type:'convection',coefficient:150,ambient:300},
      {face:'y-',type:'flux',flux:4000},
      {face:'y+',type:'radiation',emissivity:.85,environment:290},
      {face:'z+',type:'convection',coefficient:40,ambient:320,region:{min:[0,0,3],max:[2,4,3]}},
      {face:'z+',type:'radiation',emissivity:.5,environment:290,region:{min:[0,0,3],max:[2,4,3]}},
      {face:'x-',type:'radiation',emissivity:.9,environment:290,region:{min:[4,2,1],max:[4,3,2]}},   // inside the cavity
    ]});
}

test('energy audit: stored-energy change equals boundary heat plus sources for the implicit schemes',t=>{
  for(const scheme of ['backward-euler','crank-nicolson']){
    const solver=mixedCase(scheme),before=solver.storedEnergy();
    assert.equal(solver.components,1);assert.equal(solver.solidCells,6*5*4-8-4);
    let iterations=0,moved=0;
    for(let s=0;s<60;s++){
      iterations+=solver.step();
      for(const rate of solver.boundaryStepRates)moved+=Math.abs(rate)*solver.dt;
    }
    const change=solver.storedEnergy()-before,supplied=solver.boundaryEnergy.reduce((a,b)=>a+b,0)+solver.sourceEnergy;
    const defect=Math.abs(change-supplied),scale=moved+Math.abs(solver.sourceEnergy);
    t.diagnostic(`${scheme}: stored energy changed ${change.toFixed(6)} J; boundaries + sources supplied ${supplied.toFixed(6)} J; defect ${sci(defect)} J = ${sci(defect/scale)} of the ${scale.toFixed(1)} J exchanged; ${iterations} CG iterations in 60 steps`);
    // Conduction between cells cancels in the sum exactly, so the defect is the summed linear-solver
    // residual (1e-12 relative per step, over 60 steps) plus roundoff in the energy sums.
    assert.ok(defect/scale<=1e-10,`energy defect ${defect/scale}`);
    assert.ok(Math.abs(change)>100,'the case must actually exchange heat');
    close(solver.sourceEnergy,solver.sourcePower()*solver.time,0,1e-12,'source ledger');
    assert.ok(solver.boundaryEnergy.every(value=>value!==0),'every boundary condition took part');
  }
});

test('explicit scheme: stable at its limit, refused above it',t=>{
  const n=6,h=.01,limit=h*h/(6*alphaSteel);
  close(heatExplicitLimit(h,alphaSteel),limit,0,1e-15);
  close(heatExplicitLimit(h,alphaSteel,1),h*h/(2*alphaSteel),0,1e-15);
  const initial=Float64Array.from({length:n**3},(_,i)=>300+100*((i*7919)%101)/100);
  const make=dt=>new HeatSolver({nx:n,ny:n,nz:n,dx:h,dy:h,dz:h,materials:[steel],temperature:initial,dt,scheme:'explicit'});
  const solver=make(limit);
  close(solver.explicitStabilityLimit(),limit,0,1e-12,'reported limit h^2/(6 alpha)');
  const energy=solver.storedEnergy(),mean=initial.reduce((a,b)=>a+b,0)/initial.length;
  let low=Infinity,high=-Infinity,range=[];
  for(let s=0;s<400;s++){
    solver.step();
    let min=Infinity,max=-Infinity;
    for(const value of solver.temperature){min=Math.min(min,value);max=Math.max(max,value);}
    low=Math.min(low,min);high=Math.max(high,max);
    if(s===0||s===399)range.push(max-min);
  }
  t.diagnostic(`limit ${limit.toFixed(6)} s = h^2/(6 alpha); 400 steps at the limit: temperatures stayed in [${low.toFixed(6)}, ${high.toFixed(6)}] (initial 300 to 400), spread ${range[0].toFixed(3)} -> ${sci(range[1])} K; energy drift ${sci(Math.abs(solver.storedEnergy()-energy)/energy)}`);
  // At the limit every new temperature is a weighted average of old ones: no overshoot beyond roundoff.
  assert.ok(low>=300-1e-9&&high<=400+1e-9,`bounds broken: ${low}, ${high}`);
  assert.ok(range[1]<1e-6,`an insulated block must even out; spread ${range[1]}`);
  close(solver.temperature[0],mean,1e-6,0,'insulated block mean');
  close(solver.storedEnergy(),energy,0,1e-13,'insulated block energy');
  rejects(()=>make(limit*1.001),'UNSTABLE_TIME_STEP');
  rejects(()=>solver.setTimeStep(limit*1.001),'UNSTABLE_TIME_STEP');
  assert.equal(solver.dt,limit);                               // the refused change left dt alone
  solver.setTimeStep(limit/2);solver.step();
  // A fixed-temperature face halves the distance to the wall, so the limit drops: h^2 / (3 alpha) in 1-D.
  const bar=slab(20,.1,{temperature:500,scheme:'explicit',boundaries:[{face:'x-',type:'temperature',temperature:300},{face:'x+',type:'temperature',temperature:300}]});
  const barLimit=bar.explicitStabilityLimit();
  close(barLimit,.005**2/(3*alphaSteel),0,1e-12,'1-D limit with fixed faces');
  rejects(()=>{bar.setTimeStep(barLimit*1.01);},'UNSTABLE_TIME_STEP');
  // Explicit Euler at half its limit follows the Fourier series (first order in dt, second in h).
  bar.setTimeStep(barLimit/2);
  bar.step(Math.round(.1*.1*.1/alphaSteel/bar.dt));
  let worst=0;
  for(let i=0;i<20;i++)worst=Math.max(worst,Math.abs(bar.temperature[i]-slabSeries((i+.5)*.005,bar.time,.1,alphaSteel,500,300)));
  t.diagnostic(`explicit slab at Fo 0.1, 20 cells: max error ${sci(worst/200)} of 200 K`);
  assert.ok(worst/200<=2e-3,`explicit slab error ${worst/200}`);
  // The explicit ledger balances too (it is the same flux form).
  close(bar.storedEnergy()-steel.density*steel.specificHeat*.1*500,bar.boundaryEnergy[0]+bar.boundaryEnergy[1],0,1e-11,'explicit ledger');
});

test('thermal stress: restrained bar and plate, and a quenched slab cracks from the surface inwards',t=>{
  // Fully restrained steel bar heated by 50 K: sigma = -E alpha dT = -120 MPa (compression).
  const E=200e9,expansion=12e-6,field=new Float64Array(8).fill(343.15);
  const strain=thermalStrain(field,expansion,293.15);
  const bar=restrainedThermalStress(field,{expansion,youngsModulus:E,reference:293.15});
  const plate=restrainedThermalStress(field,{expansion,youngsModulus:E,poissonRatio:.3,reference:293.15,constraint:'plate'});
  const volume=restrainedThermalStress(field,{expansion,youngsModulus:E,poissonRatio:.3,reference:293.15,constraint:'volume'});
  for(let i=0;i<8;i++){
    close(strain[i],expansion*50,0,1e-13);close(bar[i],-E*expansion*50,0,1e-13);
    close(plate[i],-E*expansion*50/(1-.3),0,1e-13);close(volume[i],-E*expansion*50/(1-.6),0,1e-13);
  }
  t.diagnostic(`restrained bar, +50 K: ${bar[0]/1e6} MPa (expected -120); plate ${(plate[0]/1e6).toFixed(6)} MPa (expected ${(-120/.7).toFixed(6)})`);
  assert.equal(thermalShock(field,{expansion,youngsModulus:E,reference:293.15,tensileStrength:250e6}).count,0);   // compression never cracks
  rejects(()=>restrainedThermalStress(field,{expansion,youngsModulus:E,reference:293.15,constraint:'shell'}),'INVALID_PAYLOAD');
  rejects(()=>thermalShock(field,{expansion,youngsModulus:E,reference:293.15}),'INVALID_PAYLOAD');
  rejects(()=>restrainedThermalStress(field,{expansion,youngsModulus:E,poissonRatio:.5,reference:0}),'INVALID_PAYLOAD');

  // An alumina plate at 500 K, restrained in its plane, with both faces quenched to 300 K.
  const alumina={conductivity:30,density:3900,specificHeat:880},nx=40,thickness=.01;
  const options={expansion:8e-6,youngsModulus:370e9,poissonRatio:.22,reference:500,constraint:'plate',tensileStrength:300e6};
  const critical=options.tensileStrength*(1-options.poissonRatio)/(options.youngsModulus*options.expansion);   // 79.05 K of cooling
  const solver=new HeatSolver({nx,ny:1,nz:1,dx:thickness/nx,dy:1,dz:1,materials:[alumina],temperature:500,dt:1e-4,scheme:'backward-euler',
    boundaries:[{face:'x-',type:'temperature',temperature:300},{face:'x+',type:'temperature',temperature:300}]});
  let first=null,previous=0,firstStep=0,fullStep=0;
  for(let s=1;s<=1500&&!fullStep;s++){
    if(first!==null&&solver.dt<1e-3)solver.setTimeStep(1e-3);     // fine steps until the first crack, then coarser
    solver.step();
    const shock=thermalShock(solver.temperature,options);
    // The criterion is exactly "cooled by more than the critical temperature drop".
    for(let i=0;i<nx;i++)assert.equal(shock.cracked[i]===1,500-solver.temperature[i]>=critical*(1-1e-12)||shock.stress[i]>=options.tensileStrength);
    if(shock.count>0&&first===null){first=Array.from(shock.crackedCells);firstStep=s;}
    // Cracked cells are the outermost layers on each side, and the cracked zone never shrinks.
    const half=shock.count/2;
    assert.equal(Number.isInteger(half),true,'symmetric quench cracks symmetrically');
    for(let i=0;i<nx;i++)assert.equal(shock.cracked[i],i<half||i>=nx-half?1:0,`step ${s}: cracked cells are not surface layers`);
    assert.ok(shock.count>=previous);previous=shock.count;
    if(shock.count===nx)fullStep=s;
  }
  t.diagnostic(`quench: critical cooling ${critical.toFixed(3)} K; first cracks at step ${firstStep} (t = ${(firstStep*1e-4).toFixed(4)} s) in cells ${JSON.stringify(first)} of 0..${nx-1}; whole thickness beyond the criterion at t = ${solver.time.toFixed(3)} s`);
  assert.deepEqual(first,[0,nx-1],'the two surface cells crack first');
  assert.ok(firstStep>1&&fullStep>firstStep);
  // A plate free to expand as a whole (reference 'mean'): tension at the cooled surface, compression
  // inside, and the stresses balance through the thickness.
  const free=new HeatSolver({nx,ny:1,nz:1,dx:thickness/nx,dy:1,dz:1,materials:[alumina],temperature:500,dt:1e-3,
    boundaries:[{face:'x-',type:'temperature',temperature:300},{face:'x+',type:'temperature',temperature:300}]});
  free.step(20);
  const balanced=thermalShock(free.temperature,{...options,reference:'mean'});
  assert.ok(balanced.stress[0]>0&&balanced.stress[nx>>1]<0);
  assert.ok(Math.abs(balanced.stress.reduce((a,b)=>a+b,0))<=1e-6*balanced.maxTension);
  assert.equal(balanced.maxTension,balanced.stress[0]);
  // Cells outside the solid get no stress and never crack.
  const masked=thermalShock([300,300,300],{...options,solid:[1,0,1]});
  assert.ok(Number.isNaN(masked.stress[1]));assert.deepEqual(Array.from(masked.crackedCells),[0,2]);
});

test('a voxelised bar inside a 3-D grid behaves as the 1-D bar, and separate bodies are counted',()=>{
  const nx=12,solid=new Uint8Array(nx*3*3);
  for(let i=0;i<nx;i++)solid[i+nx*(1+3*1)]=1;                   // the centre row only
  const boundaries=[{face:'x-',type:'temperature',temperature:400},{face:'x+',type:'convection',coefficient:60,ambient:300}];
  const embedded=new HeatSolver({nx,ny:3,nz:3,dx:.01,dy:.02,dz:.03,materials:[steel],solid,temperature:350,dt:5,scheme:'crank-nicolson',boundaries});
  const plain=new HeatSolver({nx,ny:1,nz:1,dx:.01,dy:.02,dz:.03,materials:[steel],temperature:350,dt:5,scheme:'crank-nicolson',boundaries});
  embedded.step(30);plain.step(30);
  for(let i=0;i<nx;i++)close(embedded.temperature[embedded.index(i,1,1)],plain.temperature[i],1e-10);
  assert.equal(embedded.temperature[0],350);                    // a cell outside the solid is untouched
  close(embedded.storedEnergy(),plain.storedEnergy(),0,1e-12);
  assert.equal(embedded.components,1);
  // Two separate bodies, one of them with no way to reach a steady state.
  const two=new HeatSolver({nx:5,ny:1,nz:1,dx:.01,dy:1,dz:1,materials:[steel],solid:[1,1,0,1,1],temperature:300,boundaries:[{face:'x-',type:'temperature',temperature:400,region:{min:[0,0,0],max:[0,0,0]}}]});
  assert.equal(two.components,2);
  rejects(()=>two.solveSteady(),'SINGULAR_STEADY');
});

test('determinism: a repeat run gives identical bits',()=>{
  const run=()=>{
    const solver=mixedCase('crank-nicolson');
    solver.step(40);
    return {field:Buffer.from(solver.temperature.buffer.slice(0)),ledger:Buffer.from(solver.boundaryEnergy.buffer.slice(0)),diagnostics:JSON.stringify(solver.diagnostics())};
  };
  const a=run(),b=run();
  assert.ok(a.field.equals(b.field),'temperature fields differ');
  assert.ok(a.ledger.equals(b.ledger),'boundary ledgers differ');
  assert.equal(a.diagnostics,b.diagnostics);
  // Stepping in one call or many gives the same bits.
  const single=mixedCase('backward-euler'),many=mixedCase('backward-euler');
  single.step(12);
  for(let s=0;s<12;s++)many.step();
  assert.ok(Buffer.from(single.temperature.buffer).equals(Buffer.from(many.temperature.buffer)));
  const steadyA=mixedCase('backward-euler'),steadyB=mixedCase('backward-euler');
  assert.equal(steadyA.solveSteady().converged,true);steadyB.solveSteady();
  assert.ok(Buffer.from(steadyA.temperature.buffer).equals(Buffer.from(steadyB.temperature.buffer)));
  // At the steady state the boundaries carry away exactly what the sources supply.
  close(steadyA.boundaryHeatRates().reduce((a,b)=>a+b,0),-steadyA.sourcePower(),0,1e-8,'steady heat balance');
});
