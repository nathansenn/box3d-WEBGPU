/**
 * The closed-form cases of the float64 shallow-water solver (validation/domains/shallow-water.mjs) for a float32
 * backend: the same set-ups (packages/box3d-kit/test/shallow-water-scenarios.mjs), the same closed forms, and the same
 * tolerances wherever float32 does not force a looser one. `float64` is the tolerance of the float64 case; a row whose
 * `tolerance` differs from it says why in `note`.
 * The rigid-body cases (floating box, sphere in a current) and the exact resume are not here: the GPU backend does not
 * couple bodies and has no checkpoint.
 */
import {runShallowWaterScenario,type ShallowWaterBackendFactory} from './shallow-water-validation.ts';

type Kit=Record<string,unknown>;
type Scenarios=Record<string,(...args:any[])=>any>;
export interface Tolerance {readonly kind:'upper'|'lower'|'absolute'|'relative';readonly value:number}
export interface GpuCaseRow {
  readonly id:string;readonly title:string;readonly unit:string;readonly formula:string;
  readonly value:number;readonly reference:number;readonly tolerance:Tolerance;readonly float64:Tolerance;readonly pass:boolean;readonly note?:string;
}
export interface GpuCaseRun {readonly rows:GpuCaseRow[];readonly runs:Record<string,{steps:number;substeps:number;maxCourant:number;seconds:number;volumeError:number|null}>}

const upper=(value:number):Tolerance=>({kind:'upper',value}),lower=(value:number):Tolerance=>({kind:'lower',value}),absolute=(value:number):Tolerance=>({kind:'absolute',value}),relative=(value:number):Tolerance=>({kind:'relative',value});
export function withinTolerance(value:number,reference:number,t:Tolerance):boolean {
  if(!Number.isFinite(value))return false;
  if(t.kind==='upper')return value<=t.value;
  if(t.kind==='lower')return value>=t.value;
  if(t.kind==='absolute')return Math.abs(value-reference)<=t.value;
  return Math.abs(value-reference)<=t.value*Math.abs(reference);
}
const order=(coarse:number,fine:number):number=>Math.log(coarse/fine)/Math.log(2);

interface Spec {id:string;title:string;unit:string;formula:string;runs:string[];measure:(r:Record<string,any>)=>number|{value:number;reference:number};reference?:number;float64:Tolerance;tolerance?:Tolerance;note?:string}

/** The set-ups by name; each is run once and shared by the cases that read it. */
export function shallowWaterRuns(S:Scenarios):Record<string,(K:Kit)=>any> {
  return {
    'lake/0.25':K=>S.lakeAtRest(K,{level:0.25}),'lake/0.15':K=>S.lakeAtRest(K,{level:0.15}),
    'ritter/400':K=>S.ritter(K,{cells:400}),'ritter/200':K=>S.ritter(K,{cells:200}),'stoker/400':K=>S.stoker(K,{cells:400}),
    'thacker/100':K=>S.thacker(K,{cells:100}),'thacker/50':K=>S.thacker(K,{cells:50}),
    'bump/subcritical/200':K=>S.bump(K,'subcritical',{cells:200}),'bump/subcritical/100':K=>S.bump(K,'subcritical',{cells:100}),'bump/transcritical/200':K=>S.bump(K,'transcritical',{cells:200}),'bump/shock/200':K=>S.bump(K,'shock',{cells:200}),
    'manning/0.001':K=>S.manning(K,{slope:0.001,time:6000}),'manning/0.01':K=>S.manning(K,{slope:0.01,time:3000}),
    'rain/400':K=>S.rainOnSlope(K,{cells:400}),'ga/10':K=>S.greenAmpt(K,{dt:10}),'ga/1':K=>S.greenAmpt(K,{dt:1}),'budget':K=>S.budget(K),
  };
}
const SPECS:Spec[]=[
  {id:'lake.immersed',title:'Lake at rest over a bumpy bed (immersed)',unit:'m/s',formula:'u = 0',runs:['lake/0.25'],measure:r=>r['lake/0.25'].speed,reference:0,float64:upper(1e-12),tolerance:upper(2e-5),
    note:'float32: h + b is rounded per cell, so the level differs between cells by a unit in the last place (3e-8 m at 0.25 m) and drives flows of order sqrt(g/h) times that; measured 6e-6 m/s.'},
  {id:'lake.emerged',title:'Lake at rest (partly emerged)',unit:'m/s',formula:'u = 0 at dry-wet edges too',runs:['lake/0.15'],measure:r=>r['lake/0.15'].speed,reference:0,float64:upper(1e-12),tolerance:upper(2e-5),note:'float32 rounding of the level, as above; measured 4e-6 m/s.'},
  {id:'lake.level',title:'Lake at rest: level',unit:'m',formula:'eta = eta_0',runs:['lake/0.15'],measure:r=>r['lake/0.15'].drift,reference:0,float64:upper(1e-14),tolerance:upper(5e-7),note:'float32 resolves a level of 0.15 m to 1.5e-8 m; measured 4e-8 m after 400 steps.'},
  {id:'ritter.l1',title:"Ritter's dry dam break",unit:'1',formula:'h = (4/9g)(sqrt(g h_l) - (x - x0)/2t)^2',runs:['ritter/400'],measure:r=>r['ritter/400'].error,reference:0,float64:upper(4e-3)},
  {id:'ritter.order',title:"Ritter's dam break: convergence",unit:'1',formula:'first order at the wet-dry front',runs:['ritter/200','ritter/400'],measure:r=>order(r['ritter/200'].error,r['ritter/400'].error),reference:1,float64:lower(0.2)},
  {id:'ritter.front',title:"Ritter's dam break: wet front",unit:'m',formula:'where the exact depth is 1% of h_l',runs:['ritter/400'],measure:r=>({value:r['ritter/400'].front,reference:r['ritter/400'].xFront}),float64:absolute(0.15)},
  {id:'stoker.l1',title:"Stoker's wet dam break",unit:'1',formula:'rarefaction, plateau h_m, shock x_C',runs:['stoker/400'],measure:r=>r['stoker/400'].error,reference:0,float64:upper(4e-3)},
  {id:'stoker.shock',title:"Stoker's dam break: shock position",unit:'m',formula:'x_C = x0 + t 2 c_m^2 (sqrt(g h_l) - c_m) / (c_m^2 - g h_r)',runs:['stoker/400'],measure:r=>({value:r['stoker/400'].shock,reference:r['stoker/400'].xC}),float64:absolute(0.025)},
  {id:'thacker.l1',title:"Thacker's oscillating paraboloid",unit:'1',formula:"Thacker's exact periodic solution",runs:['thacker/100'],measure:r=>r['thacker/100'].error,reference:0,float64:upper(0.025)},
  {id:'thacker.order',title:"Thacker's paraboloid: convergence",unit:'1',formula:'between first and second order',runs:['thacker/50','thacker/100'],measure:r=>order(r['thacker/50'].error,r['thacker/100'].error),reference:1,float64:lower(0)},
  {id:'bump.subcritical',title:'Flow over a bump: subcritical',unit:'1',formula:'Bernoulli',runs:['bump/subcritical/200'],measure:r=>r['bump/subcritical/200'].error,reference:0,float64:upper(1e-4)},
  {id:'bump.subcritical-order',title:'Flow over a bump: subcritical, convergence',unit:'1',formula:'second order for smooth flow',runs:['bump/subcritical/100','bump/subcritical/200'],measure:r=>order(r['bump/subcritical/100'].error,r['bump/subcritical/200'].error),reference:2,float64:absolute(0.2)},
  {id:'bump.transcritical',title:'Flow over a bump: transcritical',unit:'1',formula:'Bernoulli through the critical depth',runs:['bump/transcritical/200'],measure:r=>r['bump/transcritical/200'].error,reference:0,float64:upper(1e-3)},
  {id:'bump.shock',title:'Flow over a bump with a hydraulic jump',unit:'1',formula:'Bernoulli on both branches, joined by Rankine-Hugoniot',runs:['bump/shock/200'],measure:r=>r['bump/shock/200'].error,reference:0,float64:upper(3e-3)},
  {id:'bump.jump',title:'Flow over a bump: position of the hydraulic jump',unit:'m',formula:'q^2 (1/h1 - 1/h2) + g/2 (h1^2 - h2^2) = 0',runs:['bump/shock/200'],measure:r=>({value:r['bump/shock/200'].jump,reference:r['bump/shock/200'].jumpExact}),float64:absolute(0.125)},
  {id:'manning.depth',title:'Manning normal depth, slope 0.001',unit:'m',formula:'h = (n q / sqrt(S))^(3/5)',runs:['manning/0.001'],measure:r=>({value:r['manning/0.001'].depth,reference:r['manning/0.001'].normal}),float64:relative(5e-4)},
  {id:'manning.steep',title:'Manning normal depth, slope 0.01',unit:'m',formula:'h = (n q / sqrt(S))^(3/5)',runs:['manning/0.01'],measure:r=>({value:r['manning/0.01'].depth,reference:r['manning/0.01'].normal}),float64:relative(2e-3)},
  {id:'rain.hydrograph',title:'Rain on a slope: outflow hydrograph',unit:'1',formula:'kinematic wave (WEPP eqs. 4.4.1-4.4.10)',runs:['rain/400'],measure:r=>r['rain/400'].rms,reference:0,float64:upper(0.05)},
  {id:'rain.equilibrium',title:'Rain on a slope: equilibrium outflow',unit:'1',formula:'q = r L',runs:['rain/400'],measure:r=>r['rain/400'].steady,reference:0,float64:upper(1e-4)},
  {id:'greenampt.cumulative',title:'Green-Ampt infiltration under rain',unit:'m',formula:'F - F_p - S ln((F+S)/(F_p+S)) = K (t - t_p)',runs:['ga/10'],measure:r=>r['ga/10'].worst,reference:0,float64:upper(1e-6)},
  {id:'greenampt.ponding',title:'Green-Ampt: ponding time',unit:'s',formula:'t_p = K S / (r (r - K))',runs:['ga/1'],measure:r=>({value:r['ga/1'].ponded,reference:r['ga/1'].pondingTime}),float64:absolute(2)},
  {id:'volume.budget',title:'Volume budget with every source and side at once',unit:'1',formula:'conservation of volume',runs:['budget'],measure:r=>r['budget'].relative,reference:0,float64:upper(1e-12),tolerance:upper(1e-6),
    note:'float32: the transport is conservative to the rounding of the increments (the depth carries its rounding), the side fluxes and the rain are summed per cell in float32; measured 4e-8.'},
];

/**
 * Run the cases on a backend. `only` restricts the set-ups (a case whose set-ups were not all run is left out).
 * Also reports, per set-up, the steps, substeps, the largest first-stage Courant number, the seconds it took and the
 * relative volume budget error where the set-up measures one.
 */
export async function runShallowWaterCases(S:Scenarios,backend:ShallowWaterBackendFactory,options:{readonly only?:readonly string[];readonly progress?:(name:string)=>void}={}):Promise<GpuCaseRun> {
  const runs=shallowWaterRuns(S),results:Record<string,any>={},info:GpuCaseRun['runs']={};
  for(const [name,scenario] of Object.entries(runs)){
    if(options.only&&!options.only.includes(name))continue;
    options.progress?.(name);
    const run=await runShallowWaterScenario(scenario,backend);
    results[name]=run.result;
    const v=(run.result as {volumeError?:number;relative?:number}).volumeError??(run.result as {relative?:number}).relative;
    info[name]={steps:run.steps,substeps:run.substeps,maxCourant:run.maxCourant,seconds:run.seconds,volumeError:typeof v==='number'?v:null};
  }
  const rows:GpuCaseRow[]=[];
  for(const spec of SPECS){
    if(!spec.runs.every(name=>name in results))continue;
    const m=spec.measure(results),value=typeof m==='number'?m:m.value,reference=typeof m==='number'?spec.reference??0:m.reference,tolerance=spec.tolerance??spec.float64;
    rows.push({id:`shallow-water.${spec.id}`,title:spec.title,unit:spec.unit,formula:spec.formula,value,reference,tolerance,float64:spec.float64,pass:withinTolerance(value,reference,tolerance),...(spec.note?{note:spec.note}:{})});
  }
  return {rows,runs:info};
}
