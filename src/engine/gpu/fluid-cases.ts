/**
 * The closed-form cases of the float64 fluid solver (validation/domains/fluid.mjs) for a float32 backend: the same
 * set-ups (packages/box3d-kit/test/fluid-scenarios.mjs) through the proxy (fluid-proxy.ts), the same closed forms and
 * the same tolerances wherever float32 does not force a looser one; `float64` is the float64 case's tolerance and a row
 * whose `tolerance` differs says why in `note`.
 *
 * The coupling set-ups take a rigid world: here a stand-in (`pointWorld`) that integrates free spheres in float64 by
 * symplectic Euler, as the kit's world does a body without contacts (the kit's WebAssembly world does not run in the
 * worker that drives the GPU). Not here: the Taylor-Green energy ledger (the backend sums no dissipation), the
 * repeatability row (it hashes the kit's world), the free surface (APIC, not on the GPU).
 */
import {withinTolerance,type GpuCaseRow,type Tolerance} from './shallow-water-cases.ts';

type Kit=Record<string,any>;
type Scenarios=Record<string,(...args:any[])=>any>;
const upper=(value:number):Tolerance=>({kind:'upper',value}),absolute=(value:number):Tolerance=>({kind:'absolute',value}),relative=(value:number):Tolerance=>({kind:'relative',value});
const order=(coarse:number,fine:number):number=>Math.log(Math.abs(coarse)/Math.abs(fine))/Math.log(2);

interface PointBody {x:number[];q:number[];v:number[];w:number[];mass:number;inertia:number;force:number[];torque:number[]}
/**
 * A rigid world of free spheres for the coupling set-ups (createWorld's options and the calls they make): each step of
 * `step` s is `subSteps` substeps of v += h (g + F / m), x += h v, w += h T / I, the orientation turned by w h; the
 * applied force and torque are cleared after the step. float64 throughout.
 */
export function pointWorld(options:{step:number;subSteps?:number;gravity?:readonly number[]}):any {
  const bodies:PointBody[]=[],g=[...(options.gravity??[0,-9.81,0])],n=options.subSteps??4,h=options.step/n;
  return {
    loop:{step:options.step},
    gravity:()=>g,
    createBody(o:{shape:{kind:string;radius:number};position:readonly number[];density:number}):number {
      if(o.shape.kind!=='sphere')throw new Error('pointWorld: spheres only.');
      const mass=o.density*4/3*Math.PI*o.shape.radius**3;
      bodies.push({x:[...o.position],q:[0,0,0,1],v:[0,0,0],w:[0,0,0],mass,inertia:.4*mass*o.shape.radius**2,force:[0,0,0],torque:[0,0,0]});
      return bodies.length-1;
    },
    setVelocity(b:number,v:readonly number[],w:readonly number[]=[0,0,0]):void {bodies[b].v=[...v];bodies[b].w=[...w];},
    getState(b:number) {const s=bodies[b];return {position:s.x,rotation:s.q,linearVelocity:s.v,angularVelocity:s.w,mass:s.mass,type:'dynamic'};},
    applyForce(b:number,f:readonly number[]):void {for(let k=0;k<3;k++)bodies[b].force[k]+=f[k];},
    applyTorque(b:number,t:readonly number[]):void {for(let k=0;k<3;k++)bodies[b].torque[k]+=t[k];},
    step():void {
      for(const s of bodies){
        for(let i=0;i<n;i++){
          for(let k=0;k<3;k++){s.v[k]+=h*(g[k]+s.force[k]/s.mass);s.x[k]+=h*s.v[k];s.w[k]+=h*s.torque[k]/s.inertia;}
          const [qx,qy,qz,qw]=s.q,[wx,wy,wz]=s.w,a=.5*h;
          const q=[qx+a*(wx*qw+wy*qz-wz*qy),qy+a*(wy*qw+wz*qx-wx*qz),qz+a*(wz*qw+wx*qy-wy*qx),qw-a*(wx*qx+wy*qy+wz*qz)],m=Math.hypot(...q);
          s.q=q.map(c=>c/m);
        }
        s.force=[0,0,0];s.torque=[0,0,0];
      }
    },
    dispose():void {},
  };
}

interface Spec {id:string;title:string;unit:string;formula:string;runs:string[];measure:(r:Record<string,any>)=>number|{value:number;reference:number};reference?:number;float64:Tolerance;tolerance?:Tolerance;note?:string}
export function fluidRuns(S:Scenarios):Record<string,{quick:boolean;run:(K:Kit)=>any}> {
  const quick=(run:(K:Kit)=>any)=>({quick:true,run}),slow=(run:(K:Kit)=>any)=>({quick:false,run});
  return {
    'projection':quick(K=>S.projection(K)),'rest':quick(K=>S.hydrostatic(K)),
    'taylor/32':quick(K=>S.taylorGreen(K,{n:32})),'taylor/64':slow(K=>S.taylorGreen(K,{n:64})),
    'poiseuille/16':quick(K=>S.poiseuille(K,{n:16})),'couette':quick(K=>S.couette(K)),
    'duct/8':quick(K=>S.squareDuct(K,{n:8})),'duct/16':slow(K=>S.squareDuct(K,{n:16})),'channel':slow(K=>S.channel(K)),
    'cavity/100':slow(K=>S.cavity(K,{n:32,re:100})),'cavity/400':slow(K=>S.cavity(K,{n:48,re:400,courant:1,tolerance:2e-6})),
    'stokes/16':quick(K=>S.stokesDrag(K,{n:16})),'stokes/24':slow(K=>S.stokesDrag(K,{n:24})),
    'settling':slow(K=>S.settling({...K,createWorld:async(o:{step:number;subSteps?:number;gravity?:number[]})=>pointWorld(o)})),
    'third':quick(K=>S.momentumExchange({...K,createWorld:async(o:{step:number;subSteps?:number;gravity?:number[]})=>pointWorld(o)})),
  };
}
const SPECS:Spec[]=[
  {id:'projection.divergence',title:'Projection: divergence left (walls, periodic sides, an outflow, a tilted capsule)',unit:'1',formula:'div u = 0 to the solver tolerance',runs:['projection'],measure:r=>Math.max(r.projection.projected,r.projection.stepped),reference:0,float64:upper(1.5e-10),tolerance:upper(3e-6),
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
  {id:'rest.speed',title:'Water at rest with a fixed sphere: spurious currents',unit:'1',formula:'u = 0',runs:['rest'],measure:r=>r.rest.speed/r.rest.scale,reference:0,float64:upper(1e-12),
    note:'Gravity is a gradient on the staggered grid, so the float32 projection removes it exactly too: the measured speed is 0.'},
  {id:'rest.head',title:'Water at rest: pressure head',unit:'Pa',formula:'rho g (L - h)',runs:['rest'],measure:r=>({value:r.rest.head,reference:r.rest.exactHead}),float64:relative(1e-9)},
  {id:'rest.buoyancy',title:'Water at rest: buoyancy of an immersed sphere',unit:'N',formula:'rho g (4/3) pi a^3',runs:['rest'],measure:r=>({value:r.rest.lift,reference:r.rest.buoyancy}),float64:relative(0.06)},
  {id:'stokes.drag-16',title:'Stokes drag on a sphere, 2.4 cells per radius',unit:'1',formula:'Hasimoto (1959), K = F / (6 pi mu a U)',runs:['stokes/16'],measure:r=>({value:r['stokes/16'].measured,reference:r['stokes/16'].hasimoto}),float64:relative(0.1)},
  {id:'stokes.drag-24',title:'Stokes drag on a sphere, 3.6 cells per radius',unit:'1',formula:'Hasimoto (1959)',runs:['stokes/24'],measure:r=>({value:r['stokes/24'].measured,reference:r['stokes/24'].hasimoto}),float64:relative(0.05)},
  {id:'stokes.control-surface',title:'Stokes drag: force on a control surface',unit:'N',formula:'the force the obstacle constraint takes from the fluid',runs:['stokes/16'],measure:r=>({value:r['stokes/16'].surface,reference:r['stokes/16'].force}),float64:relative(0.01)},
  {id:'coupling.terminal-velocity',title:'Coupling: terminal velocity of a settling sphere (stand-in rigid world)',unit:'m/s',formula:'U = -m g V^2 / (6 pi mu a K (V - V_b) (m / rho + V - V_b))',runs:['settling'],measure:r=>({value:r.settling.velocity,reference:r.settling.expected}),float64:relative(0.12)},
  {id:'coupling.third-law',title:'Coupling: impulse handed over (stand-in rigid world)',unit:'1',formula:'equal and opposite',runs:['third'],measure:r=>r.third.fluidSide,reference:0,float64:upper(1e-12),tolerance:upper(1e-6),
    note:'float32: every face velocity is rounded to 6e-8 of itself each step and the impulse and the momentum inside are float32 sums, so the fluid\'s momentum and the impulse it hands over agree to the rounding of the velocities (measured 6.2e-8 of the momentum exchanged), not to the float64 solver\'s 1e-16.'},
  {id:'coupling.momentum',title:'Coupling: total momentum (stand-in rigid world)',unit:'1',formula:'p = const',runs:['third'],measure:r=>r.third.total,reference:0,float64:upper(1e-6)},
];
export interface FluidCaseRun {readonly rows:GpuCaseRow[];readonly runs:Record<string,{seconds:number;result:Record<string,unknown>}>}
/** Run the cases with `K` (the exports of fluid.ts with `Fluid` replaced by a proxy class). The coupling set-ups are asynchronous (they await the stand-in world), so this is. */
export async function runFluidCases(S:Scenarios,K:Kit,options:{readonly only?:readonly string[];readonly quick?:boolean;readonly progress?:(name:string)=>void}={}):Promise<FluidCaseRun> {
  const runs=fluidRuns(S),results:Record<string,any>={},info:FluidCaseRun['runs']={};
  for(const [name,entry] of Object.entries(runs)){
    if(options.only?!options.only.includes(name):options.quick===true&&!entry.quick)continue;
    options.progress?.(name);
    const started=performance.now();results[name]=await entry.run(K);
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
