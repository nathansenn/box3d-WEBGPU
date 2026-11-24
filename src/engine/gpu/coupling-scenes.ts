/**
 * The fluid coupling rows of the GPU flow (docs/GPU_COMPUTE.md, "Coupling through the WebAssembly world") as scenes:
 * a flow section with backend 'gpu' and a body of the Box3D world, loaded by the scene loader into a real world (the
 * kit's PhysicsWorld, or the Lab's world on the same box3d.wasm) and stepped with `stepAsync()`. Before, these rows ran
 * through a float64 stand-in world (`pointWorld` of fluid-cases.ts) because the GPU was driven from a page while the
 * set-ups ran synchronously in a worker without the WebAssembly world; as scenes they run where the GPU runs.
 *
 * The set-ups are those of packages/box3d-kit/test/fluid-scenarios.mjs (`settling`, `momentumExchange`) and the
 * buoyancy of `hydrostatic` with the sphere a static body of the world coupled to the flow instead of a fixed
 * obstacle of the fluid. The closed forms and tolerances are those of the float64 rows (validation/domains/fluid.mjs),
 * float32 ones where fluid-cases.ts says why.
 *
 * No WebGPU and no world here. The caller loads a scene (with the GPU backends, the reference, or
 * none: the float64 solver) and hands `measure*` the loaded scene and a function that takes one simulation step.
 */
import type {Scene} from '../scene-format.ts';
import {EngineError} from '../contracts.ts';
import {hasimotoDragFactor,type Fluid,type FluidCoupling} from '../fluid.ts';

const G=9.81;
const PERIODIC='periodic' as const;
const allPeriodic={xMin:PERIODIC,xMax:PERIODIC,yMin:PERIODIC,yMax:PERIODIC,zMin:PERIODIC,zMax:PERIODIC};
const header={format:'box3d-scene' as const,version:1 as const,units:'SI' as const,materials:{},joints:[]};
const flow=(backend:'gpu'|null)=>backend?{backend}:{};

/**
 * A sphere of the rigid world (radius 0.15 L, 1500 kg/m^3) settling in a periodic cube of side L = 20 mm (16^3 cells)
 * of a liquid with nu = 2e-3 m^2/s, at 2000 Hz for 0.1 s. A body force on the fluid balances the weight of fluid and
 * sphere (set by `prepareSettling` before the first step), so the cube's mean velocity stays zero and the sphere reaches
 * the terminal velocity of Hasimoto's drag on a periodic array.
 */
export function settlingScene(backend:'gpu'|null='gpu'):Scene {
  const n=16,L=0.02,rho=1000,nu=2e-3,a=0.15*L,hz=2000;
  return {...header,world:{gravity:[0,-G,0],ground:false,seed:1,step:1/hz,subSteps:4},
    bodies:[{id:'ball',shape:{kind:'sphere',radius:a},position:[L/2,L/2,L/2],density:1500,neverSleeps:true}],
    fluids:[{id:'cube',cells:[n,n,n],spacing:L/n,density:rho,viscosity:rho*nu,diffusion:'backward-euler',boundaries:allPeriodic,bodies:[{body:'ball'}],...flow(backend)}],
    meta:{title:'Settling sphere (coupling row)',description:'A sphere settling in a periodic cube of liquid, against Hasimoto.'}} as unknown as Scene;
}
/** Steps of the settling run: 0.1 s at 2000 Hz. */
export const SETTLING_STEPS=200;
/**
 * A sphere of the rigid world (radius 6 mm, 3000 kg/m^3) thrown at (0.05, 0.02, 0) m/s spinning at 3 rad/s about z
 * through a periodic cube of side 40 mm (16^3 cells) of a fluid at rest (mu = 0.1 Pa s), no gravity, explicit viscosity,
 * 120 Hz, 60 steps.
 */
export function thirdLawScene(backend:'gpu'|null='gpu'):Scene {
  const n=16,L=0.04,a=0.006;
  return {...header,world:{gravity:[0,0,0],ground:false,seed:1,step:1/120,subSteps:4},
    bodies:[{id:'ball',shape:{kind:'sphere',radius:a},position:[L/2,L/2,L/2],density:3000,neverSleeps:true,linearVelocity:[0.05,0.02,0],angularVelocity:[0,0,3]}],
    fluids:[{id:'cube',cells:[n,n,n],spacing:L/n,density:1000,viscosity:0.1,boundaries:allPeriodic,bodies:[{body:'ball'}],...flow(backend)}],
    meta:{title:'Equal and opposite (coupling row)',description:'A sphere thrown through a periodic cube of fluid at rest.'}} as unknown as Scene;
}
export const THIRD_LAW_STEPS=60;
/**
 * Water at rest (mu = 1e-3 Pa s) in a closed tank of side 0.2 m (16^3 cells, Crank-Nicolson) with a static sphere of the
 * rigid world (radius 0.03 m, 2.4 cells) at its centre, coupled to the flow: 40 steps of 0.01 s from the hydrostatic
 * pressure the loader starts a flow at rest from.
 */
export function buoyancyScene(backend:'gpu'|null='gpu'):Scene {
  const n=16,L=0.2,a=0.03;
  return {...header,world:{gravity:[0,-G,0],ground:false,seed:1,step:0.01,subSteps:4},
    bodies:[{id:'ball',shape:{kind:'sphere',radius:a},type:'static',position:[0.1,0.1,0.1]}],
    fluids:[{id:'tank',cells:[n,n,n],spacing:L/n,density:1000,viscosity:1e-3,diffusion:'crank-nicolson',bodies:[{body:'ball'}],...flow(backend)}],
    meta:{title:'Buoyancy of a static sphere (coupling row)',description:'Water at rest around a static sphere coupled to the flow.'}} as unknown as Scene;
}
export const BUOYANCY_STEPS=40;

/** What the rows need of a loaded scene (the scene loader's result, for any world). */
export interface CouplingRowScene {
  readonly fluids:ReadonlyMap<string,{readonly kind:string;readonly flow?:Fluid;readonly coupling?:FluidCoupling<unknown>|null}>;
  readonly bodies:ReadonlyMap<string,unknown>;
  readonly simulation:{readonly world:{getState(body:unknown):{readonly position:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number}}};
}
const flowOf=(loaded:CouplingRowScene,id:string):{flow:Fluid;coupling:FluidCoupling<unknown>}=>{
  const r=loaded.fluids.get(id);
  if(!r||!r.flow||!r.coupling)throw new EngineError('INVALID_PAYLOAD',`The scene has no coupled flow "${id}".`);
  return {flow:r.flow,coupling:r.coupling};
};
/** Before the first step of the settling scene: the body force on the fluid that carries the weight of fluid and sphere. */
export function prepareSettling(loaded:CouplingRowScene):void {
  const {flow}=flowOf(loaded,'cube'),m=loaded.simulation.world.getState(loaded.bodies.get('ball')).mass,V=0.02**3,Vb=flow.obstacleVolume(0);
  flow.bodyForce[1]=G+m*G/(1000*(V-Vb));
}
/**
 * The terminal velocity after the run, and the closed form U = -m g V^2 / (6 pi mu a K (V - V_b) (m / rho + V - V_b)),
 * K Hasimoto's factor at the sphere's solid fraction (as fluid-scenarios.mjs `settling`).
 */
export function measureSettling(loaded:CouplingRowScene):{velocity:number;expected:number;responseTime:number} {
  const {flow}=flowOf(loaded,'cube'),state=loaded.simulation.world.getState(loaded.bodies.get('ball'));
  const L=0.02,a=0.15*L,mu=2,V=L**3,Vb=flow.obstacleVolume(0),m=state.mass,K=hasimotoDragFactor(4/3*Math.PI*a**3/V);
  return {velocity:state.linearVelocity[1],expected:-m*G*V*V/(6*Math.PI*mu*a*K*(V-Vb)*(m/1000+V-Vb)),responseTime:m/(6*Math.PI*mu*a*K)};
}
/**
 * The third-law run: `step` takes one simulation step and leaves the fluid's state in its float64 object (a GPU section:
 * stepAsync then pullAsync). Returns the change of the fluid's momentum plus the impulse handed to the body, and the
 * change of the total momentum of fluid and body (the body's from the world's float32 state), each over the momentum
 * exchanged (as fluid-scenarios.mjs `momentumExchange`).
 */
export async function measureThirdLaw(loaded:CouplingRowScene,step:()=>Promise<void>,steps=THIRD_LAW_STEPS):Promise<{fluidSide:number;total:number;exchanged:number;speed:number}> {
  const {flow,coupling}=flowOf(loaded,'cube'),ball=loaded.bodies.get('ball'),dt=coupling.dt;
  const fluid0=flow.momentum(),total0=coupling.diagnostics().momentum,impulse=[0,0,0];
  for(let i=0;i<steps;i++){
    // The force the coupling hands the body acts over the rigid step that follows: read it after the coupling's part of
    // the step, which the simulation runs before the world's.
    await step();
    const F=coupling.force(ball);for(let k=0;k<3;k++)impulse[k]+=F[k]*dt;
  }
  const fluid1=flow.momentum(),total1=coupling.diagnostics().momentum,exchanged=Math.hypot(...impulse);
  return {exchanged,fluidSide:Math.hypot(...[0,1,2].map(k=>fluid1[k]-fluid0[k]+impulse[k]))/exchanged,total:Math.hypot(...[0,1,2].map(k=>total1[k]-total0[k]))/exchanged,
    speed:Math.hypot(...loaded.simulation.world.getState(ball).linearVelocity)};
}
/** The vertical force of the water at rest on the static sphere after the run, and rho g (4/3) pi a^3. */
export function measureBuoyancy(loaded:CouplingRowScene):{lift:number;buoyancy:number} {
  const {coupling}=flowOf(loaded,'tank');
  return {lift:coupling.force(loaded.bodies.get('ball'))[1],buoyancy:1000*G*4/3*Math.PI*0.03**3};
}

/** A scene loaded for the rows: what the measures read, how to step it, and how to release it. */
export interface CouplingRowLoad extends CouplingRowScene {
  readonly simulation:CouplingRowScene['simulation']&{readonly isAsync:boolean;step():void;stepAsync():Promise<void>;pullAsync():Promise<void>};
  dispose():void;
}
export interface CouplingRowsResult {
  readonly settling:{velocity:number;expected:number;responseTime:number};
  readonly thirdLaw:{fluidSide:number;total:number;exchanged:number;speed:number};
  readonly buoyancy:{lift:number;buoyancy:number};
  readonly seconds:{settling:number;thirdLaw:number;buoyancy:number};
}
/**
 * Run the three rows: `load(scene)` loads a scene (with the GPU backends for a GPU run; the scene's flow says
 * backend 'gpu' unless `backend` is null) into a world of its own. A GPU section is pulled after every step, so the
 * measures read the flow the device holds.
 */
export async function runCouplingRows(load:(scene:Scene)=>CouplingRowLoad|Promise<CouplingRowLoad>,options:{readonly backend?:'gpu'|null;readonly progress?:(text:string)=>void}={}):Promise<CouplingRowsResult> {
  const backend=options.backend===undefined?'gpu':options.backend,progress=options.progress??(()=>{});
  const run=async<T>(name:string,scene:Scene,steps:number,before:((l:CouplingRowLoad)=>void)|null,measure:(l:CouplingRowLoad,step:()=>Promise<void>,steps:number)=>Promise<T>):Promise<{value:T;seconds:number}> => {
    progress(`coupling rows: ${name}`);
    const loaded=await load(scene),started=performance.now();
    try{
      before?.(loaded);
      const step=async():Promise<void>=>{if(loaded.simulation.isAsync){await loaded.simulation.stepAsync();await loaded.simulation.pullAsync();}else loaded.simulation.step();};
      return {value:await measure(loaded,step,steps),seconds:(performance.now()-started)/1000};
    }finally{loaded.dispose();}
  };
  const steps=async(step:()=>Promise<void>,n:number):Promise<void>=>{for(let i=0;i<n;i++)await step();};
  const thirdLaw=await run('third law',thirdLawScene(backend),THIRD_LAW_STEPS,null,(l,step,n)=>measureThirdLaw(l,step,n));
  const buoyancy=await run('buoyancy',buoyancyScene(backend),BUOYANCY_STEPS,null,async(l,step,n)=>{await steps(step,n);return measureBuoyancy(l);});
  const settling=await run('settling',settlingScene(backend),SETTLING_STEPS,prepareSettling,async(l,step,n)=>{await steps(step,n);return measureSettling(l);});
  return {settling:settling.value,thirdLaw:thirdLaw.value,buoyancy:buoyancy.value,seconds:{settling:settling.seconds,thirdLaw:thirdLaw.seconds,buoyancy:buoyancy.seconds}};
}
/** The rows with their references and tolerances (those of fluid-cases.ts; the float64 ones where float32 does not force looser). */
export function couplingRowChecks(r:CouplingRowsResult):{id:string;title:string;value:number;reference:number;tolerance:string;pass:boolean}[] {
  const rel=(v:number,ref:number,t:number)=>Math.abs(v-ref)<=t*Math.abs(ref);
  return [
    {id:'coupling.terminal-velocity-wasm',title:'Terminal velocity of a settling sphere (WebAssembly world)',value:r.settling.velocity,reference:r.settling.expected,tolerance:'12 % relative',pass:rel(r.settling.velocity,r.settling.expected,0.12)},
    {id:'coupling.third-law-wasm',title:'Impulse handed over, equal and opposite (WebAssembly world)',value:r.thirdLaw.fluidSide,reference:0,tolerance:'<= 1e-6',pass:r.thirdLaw.fluidSide<=1e-6},
    {id:'coupling.momentum-wasm',title:'Total momentum of fluid and body (WebAssembly world)',value:r.thirdLaw.total,reference:0,tolerance:'<= 1e-6',pass:r.thirdLaw.total<=1e-6},
    {id:'coupling.buoyancy-wasm',title:'Buoyancy of a static sphere coupled to water at rest (WebAssembly world)',value:r.buoyancy.lift,reference:r.buoyancy.buoyancy,tolerance:'6 % relative',pass:rel(r.buoyancy.lift,r.buoyancy.buoyancy,0.06)},
  ];
}
