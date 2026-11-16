/**
 * The closed-form cases of the float64 fluid solver (validation/domains/fluid.mjs) for a float32 backend: the same
 * set-ups (packages/box3d-kit/test/fluid-scenarios.mjs) through the proxy (fluid-proxy.ts), the same closed forms and
 * the same tolerances wherever float32 does not force a looser one; `float64` is the float64 case's tolerance and a row
 * whose `tolerance` differs says why in `note`.
 *
 * Two set-ups are this file's own, because the float64 ones hold an obstacle (the backend has none): the projection of
 * a random field (the float64 set-up without its capsule) and a tank of water at rest (without its sphere).
 * Not here: the Taylor-Green energy ledger (the backend sums no dissipation), Stokes drag, buoyancy, the coupling rows
 * (obstacles), the free surface (APIC, not on the GPU).
 */
import {withinTolerance,type GpuCaseRow,type Tolerance} from './shallow-water-cases.ts';

type Kit=Record<string,any>;
type Scenarios=Record<string,(...args:any[])=>any>;
const upper=(value:number):Tolerance=>({kind:'upper',value}),absolute=(value:number):Tolerance=>({kind:'absolute',value}),relative=(value:number):Tolerance=>({kind:'relative',value});
const order=(coarse:number,fine:number):number=>Math.log(Math.abs(coarse)/Math.abs(fine))/Math.log(2);
const G=9.81,PERIODIC='periodic';

/** The float64 projection set-up without its capsule: a random field projected once and stepped three times, for walls, all periodic, and an outflow with a free-slip floor. */
export function projectionNoObstacle(K:Kit):{projected:number;stepped:number;unconverged:number} {
  let seed=7,worst=0,stepped=0,unconverged=0;
  const random=():number=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648-.5;};
  const all={xMin:PERIODIC,xMax:PERIODIC,yMin:PERIODIC,yMax:PERIODIC,zMin:PERIODIC,zMax:PERIODIC};
  for(const boundaries of [{},all,{xMax:'outflow',yMin:'free-slip'}]){
    const f=new K.Fluid({cells:[12,10,8],spacing:0.01,density:1000,viscosity:1e-3,dt:0.01,gravity:[0,-G,0],boundaries});
    f.setVelocity(()=>[random(),random(),random()]);
    f.project();
    let top=0;for(const x of [f.u,f.v,f.w])for(const value of x)top=Math.max(top,Math.abs(value));
    worst=Math.max(worst,f.maxDivergence()*f.h/top);
    f.step(3);stepped=Math.max(stepped,f.stats.divergence);unconverged+=f.stats.unconverged;
  }
  return {projected:worst,stepped,unconverged};
}
/** The float64 tank at rest without its sphere: 0.2 m of water, 16^3 cells, Crank-Nicolson, started from the hydrostatic pressure, 40 steps of 10 ms. */
export function restNoObstacle(K:Kit,{n=16,steps=40}={}):{speed:number;scale:number;head:number;exactHead:number} {
  const L=0.2,h=L/n,rho=1000;
  const fluid=new K.Fluid({cells:[n,n,n],spacing:h,density:rho,viscosity:1e-3,dt:0.01,gravity:[0,-G,0],diffusion:'crank-nicolson'});
  fluid.setPressure((_x:number,y:number)=>rho*G*(L-y));
  fluid.step(steps);
  let speed=0;for(const x of fluid.vel)for(const value of x)speed=Math.max(speed,Math.abs(value));
  const layer=(j:number):number=>{let s=0;for(let k=0;k<n;k++)for(let i=0;i<n;i++)s+=fluid.p[i+n*(j+n*k)];return s/(n*n);};
  return {speed,scale:G*fluid.dt,head:layer(0)-layer(n-1),exactHead:rho*G*(L-h)};
}

interface Spec {id:string;title:string;unit:string;formula:string;runs:string[];measure:(r:Record<string,any>)=>number|{value:number;reference:number};reference?:number;float64:Tolerance;tolerance?:Tolerance;note?:string}
export function fluidRuns(S:Scenarios):Record<string,{quick:boolean;run:(K:Kit)=>any}> {
  const quick=(run:(K:Kit)=>any)=>({quick:true,run}),slow=(run:(K:Kit)=>any)=>({quick:false,run});
  return {
    'projection':quick(K=>projectionNoObstacle(K)),'rest':quick(K=>restNoObstacle(K)),
    'taylor/32':quick(K=>S.taylorGreen(K,{n:32})),'taylor/64':slow(K=>S.taylorGreen(K,{n:64})),
    'poiseuille/16':quick(K=>S.poiseuille(K,{n:16})),'couette':quick(K=>S.couette(K)),
    'duct/8':quick(K=>S.squareDuct(K,{n:8})),'duct/16':slow(K=>S.squareDuct(K,{n:16})),'channel':slow(K=>S.channel(K)),
    'cavity/100':slow(K=>S.cavity(K,{n:32,re:100})),'cavity/400':slow(K=>S.cavity(K,{n:48,re:400,courant:1,tolerance:2e-6})),
  };
}
const SPECS:Spec[]=[
  {id:'projection.divergence',title:'Projection: divergence left (the float64 set-up without its capsule)',unit:'1',formula:'div u = 0 to the solver tolerance',runs:['projection'],measure:r=>Math.max(r.projection.projected,r.projection.stepped),reference:0,float64:upper(1.5e-10),tolerance:upper(3e-6),
    note:'float32: the projection stops at max |div u| h / max |u| = 2e-6 (the float64 solver at 1e-10); the velocity itself is resolved to 6e-8 of its magnitude, and a divergence is a difference of six such numbers.'},
  {id:'taylor-green.rate',title:'Taylor-Green vortex: decay rate',unit:'1/s',formula:'E ~ exp(-4 nu k^2 t)',runs:['taylor/32'],measure:r=>r['taylor/32'].rate,reference:0.04,float64:relative(5e-3)},
  {id:'taylor-green.order',title:'Taylor-Green vortex: spatial convergence',unit:'1',formula:'second order',runs:['taylor/32','taylor/64'],measure:r=>order(r['taylor/32'].velocityError,r['taylor/64'].velocityError),reference:2,float64:absolute(0.3)},
  {id:'taylor-green.error',title:'Taylor-Green vortex: velocity error',unit:'1',formula:'u = sin x cos y exp(-2 nu t)',runs:['taylor/32'],measure:r=>r['taylor/32'].velocityError,reference:0,float64:upper(1e-4)},
  {id:'poiseuille.profile',title:'Plane Poiseuille flow',unit:'1',formula:'the parabola shifted by G h^2 / (8 nu): error (h / H)^2',runs:['poiseuille/16'],measure:r=>({value:r['poiseuille/16'].error,reference:r['poiseuille/16'].closedForm}),float64:relative(1e-6),tolerance:relative(5e-4),
    note:'float32: the Laplacian of a profile resolved to 6e-8 of itself is rounded to about 12 x 6e-8 |u| / h^2, and the steady state carries that over the smallest eigenvalue of the operator: about 2e-5 of the centre-line speed at 16 cells, against the measured deviation (h / H)^2 = 3.9e-3 of it, so up to 5e-3 of the measured number by that estimate; measured 3.9e-5.'},
  {id:'couette.profile',title:'Plane Couette flow',unit:'1',formula:'u = U y / H (exact on this grid)',runs:['couette'],measure:r=>r.couette.error,reference:0,float64:upper(1e-7),tolerance:upper(2e-4),note:'float32: the Laplacian of the profile is rounded to about 12 x 6e-8 |u| / h^2; the steady state carries that over the smallest eigenvalue, pi^2 / H^2: 12 x 6e-8 x (H / h)^2 / pi^2 = 1.9e-5 of the wall speed at 16 cells, and the steady-state rule stops when a step changes less than that.'},
  {id:'duct.flow-rate',title:'Square duct: flow rate',unit:'m^3/s',formula:'series solution',runs:['duct/16'],measure:r=>({value:r['duct/16'].flowRate,reference:r['duct/16'].exactFlowRate}),float64:relative(0.02)},
  {id:'duct.order',title:'Square duct: convergence of the profile',unit:'1',formula:'second order',runs:['duct/8','duct/16'],measure:r=>order(r['duct/8'].error,r['duct/16'].error),reference:2,float64:absolute(0.3)},
  {id:'channel.gradient',title:'Inflow and outflow: pressure gradient',unit:'Pa/m',formula:'dp/dx = -8 mu U_max / H^2',runs:['channel'],measure:r=>({value:r.channel.gradient,reference:r.channel.exactGradient}),float64:relative(0.02)},
  {id:'channel.profile',title:'Inflow and outflow: outlet profile',unit:'1',formula:'fully developed: unchanged',runs:['channel'],measure:r=>r.channel.profile,reference:0,float64:upper(0.01)},
  {id:'channel.mass',title:'Inflow and outflow: mass',unit:'1',formula:'conservation of volume',runs:['channel'],measure:r=>r.channel.massError,reference:0,float64:absolute(1e-8),tolerance:absolute(1e-5),
    note:'float32: the flow through a section is a sum of 12 face velocities each resolved to 6e-8 of itself, and the divergence left per cell is 2e-6 of the largest velocity.'},
  {id:'cavity.re100-u',title:'Lid-driven cavity, Re = 100: u on the vertical centre line',unit:'1',formula:'Ghia, Ghia & Shin 1982, table I',runs:['cavity/100'],measure:r=>r['cavity/100'].uError,reference:0,float64:upper(0.005)},
  {id:'cavity.re100-v',title:'Lid-driven cavity, Re = 100: v on the horizontal centre line',unit:'1',formula:'Ghia, Ghia & Shin 1982, table II',runs:['cavity/100'],measure:r=>r['cavity/100'].vError,reference:0,float64:upper(0.012)},
  {id:'cavity.re400-u',title:'Lid-driven cavity, Re = 400: u on the vertical centre line',unit:'1',formula:'Ghia, Ghia & Shin 1982, table I',runs:['cavity/400'],measure:r=>r['cavity/400'].uError,reference:0,float64:upper(0.025)},
  {id:'cavity.re400-v',title:'Lid-driven cavity, Re = 400: v on the horizontal centre line',unit:'1',formula:'Ghia, Ghia & Shin 1982, table II',runs:['cavity/400'],measure:r=>r['cavity/400'].vError,reference:0,float64:upper(0.025)},
  {id:'rest.speed',title:'Water at rest (the float64 tank without its sphere): spurious currents',unit:'1',formula:'u = 0',runs:['rest'],measure:r=>r.rest.speed/r.rest.scale,reference:0,float64:upper(1e-12),
    note:'Gravity is a gradient on the staggered grid, so the float32 projection removes it exactly too: the measured speed is 0.'},
  {id:'rest.head',title:'Water at rest: pressure head',unit:'Pa',formula:'rho g (L - h)',runs:['rest'],measure:r=>({value:r.rest.head,reference:r.rest.exactHead}),float64:relative(1e-9)},
];
export interface FluidCaseRun {readonly rows:GpuCaseRow[];readonly runs:Record<string,{seconds:number;result:Record<string,unknown>}>}
export function runFluidCases(S:Scenarios,K:Kit,options:{readonly only?:readonly string[];readonly quick?:boolean;readonly progress?:(name:string)=>void}={}):FluidCaseRun {
  const runs=fluidRuns(S),results:Record<string,any>={},info:FluidCaseRun['runs']={};
  for(const [name,entry] of Object.entries(runs)){
    if(options.only?!options.only.includes(name):options.quick===true&&!entry.quick)continue;
    options.progress?.(name);
    const started=performance.now();results[name]=entry.run(K);
    info[name]={seconds:(performance.now()-started)/1000,result:Object.fromEntries(Object.entries(results[name]).filter(([,v])=>typeof v==='number'||typeof v==='boolean'))};
  }
  const rows:GpuCaseRow[]=[];
  for(const spec of SPECS){
    if(!spec.runs.every(name=>name in results))continue;
    const m=spec.measure(results),value=typeof m==='number'?m:m.value,reference=typeof m==='number'?spec.reference??0:m.reference,tolerance=spec.tolerance??spec.float64;
    rows.push({id:`fluid.${spec.id}`,title:spec.title,unit:spec.unit,formula:spec.formula,value,reference,tolerance,float64:spec.float64,pass:withinTolerance(value,reference,tolerance),...(spec.note?{note:spec.note}:{})});
  }
  return {rows,runs:info};
}
