/**
 * The closed-form cases of the float64 granular solver (validation/domains/granular.mjs) for a float32 backend: the same
 * set-ups (packages/box3d-kit/test/granular-scenarios.mjs) run through the proxy (granular-proxy.ts), the same closed
 * forms, and the same tolerances wherever float32 does not force a looser one. `float64` is the tolerance of the float64
 * case; a row whose `tolerance` differs from it says why in `note`.
 *
 * `quick` rows take seconds (two bodies, a grain on an incline, a column at rest, a free dynamic wall): the gate runs them
 * on the float32 CPU reference. The rest (Janssen, Beverloo, the angle of repose) run minutes: on the GPU, in the browser.
 * Not here, because the backend does not have what they read: the energy ledger rows (no dissipated work is summed), and
 * the rows through the rigid world of the kit (the coupling is checked separately, with its latency).
 */
import {withinTolerance,type GpuCaseRow,type Tolerance} from './shallow-water-cases.ts';

type Kit=Record<string,unknown>;
type Scenarios=Record<string,(...args:any[])=>any>;
const upper=(value:number):Tolerance=>({kind:'upper',value}),lower=(value:number):Tolerance=>({kind:'lower',value}),absolute=(value:number):Tolerance=>({kind:'absolute',value}),relative=(value:number):Tolerance=>({kind:'relative',value});
const error=(measured:number,reference:number):number=>measured/reference-1,order=(coarse:number,fine:number):number=>Math.log(Math.abs(coarse/fine))/Math.log(2);

interface Spec {id:string;title:string;unit:string;formula:string;runs:string[];measure:(r:Record<string,any>)=>number|{value:number;reference:number};reference?:number;float64:Tolerance;tolerance?:Tolerance;note?:string}
const REPOSE:[number,number][]=[[0.2,0],[0.5,0],[0.5,0.1],[0.5,0.3]];

export function granularRuns(S:Scenarios):Record<string,{quick:boolean;run:(K:Kit)=>any}> {
  const quick=(run:(K:Kit)=>any)=>({quick:true,run}),slow=(run:(K:Kit)=>any)=>({quick:false,run});
  return {
    'head/hertz/0.02':quick(K=>S.headOn(K,{fraction:0.02})),'head/hertz/0.16':quick(K=>S.headOn(K,{fraction:0.16})),'head/hertz/0.08':quick(K=>S.headOn(K,{fraction:0.08})),
    'head/linear':quick(K=>S.headOn(K,{law:'linear',fraction:0.01})),
    'head/e0.9':quick(K=>S.headOn(K,{law:'hertz',restitution:0.9,speed:0.1,fraction:0.01})),'head/e0.5':quick(K=>S.headOn(K,{law:'hertz',restitution:0.5,speed:0.1,fraction:0.01})),
    'head/e0.2-fast':quick(K=>S.headOn(K,{law:'hertz',restitution:0.2,speed:1,fraction:0.01})),'head/linear-e0.5':quick(K=>S.headOn(K,{law:'linear',restitution:0.5,speed:0.1,fraction:0.002})),
    'oblique/sliding':quick(K=>S.oblique(K,{psi:5,restitution:0.7})),'oblique/sliding-linear':quick(K=>S.oblique(K,{law:'linear',psi:6,restitution:0.6,friction:0.4})),
    'oblique/sticking':quick(K=>S.oblique(K,{law:'linear',psi:1,friction:10,tangentialDamping:0,fraction:0.005})),'oblique/sticking-half':quick(K=>S.oblique(K,{law:'linear',psi:1,friction:10,ratio:1/7,tangentialDamping:0,fraction:0.005})),
    'incline/sliding':quick(K=>S.incline(K,{law:'hertz',friction:0.1})),'incline/rolling':quick(K=>S.incline(K,{law:'hertz',friction:0.5})),'incline/rolling-linear':quick(K=>S.incline(K,{law:'linear',friction:0.5})),
    'column':quick(K=>S.column(K)),'free-wall':quick(K=>S.freeCollisionSolver(K)),
    'janssen':slow(K=>S.janssen(K)),'beverloo':slow(K=>S.beverloo(K)),
    ...Object.fromEntries(REPOSE.map(([mu,mur])=>[`repose/${mu}/${mur}`,slow((K:Kit)=>S.repose(K,{friction:mu,rollingFriction:mur}))])),
  };
}
const SPECS:Spec[]=[
  {id:'hertz.duration',title:'Two grains head on: Hertz contact duration',unit:'s',formula:'t = 2.943 (15 m* v^2 / (16 E* sqrt(R*)))^(2/5) / v',runs:['head/hertz/0.02'],measure:r=>({value:r['head/hertz/0.02'].duration,reference:r['head/hertz/0.02'].hertzDuration}),float64:relative(5e-5),tolerance:relative(2e-4),
    note:'float32: the overlap (at most 2e-5 m between grains at 5e-3 m) is resolved to 5e-10 m, 2e-5 of itself; measured 5e-5.'},
  {id:'hertz.duration-order',title:'Two grains head on: convergence of the duration',unit:'1',formula:'velocity Verlet is second order',runs:['head/hertz/0.16','head/hertz/0.08'],
    measure:r=>order(error(r['head/hertz/0.16'].duration,r['head/hertz/0.16'].hertzDuration),error(r['head/hertz/0.08'].duration,r['head/hertz/0.08'].hertzDuration)),reference:2,float64:absolute(0.3),tolerance:absolute(0.5),
    note:'float32: between steps of 16% and 8% of the Rayleigh time (the float64 case uses 8% and 4%, where the float32 error of the duration is already the rounding).'},
  {id:'linear.duration',title:'Two grains head on: linear-spring contact duration',unit:'s',formula:'t = pi sqrt(m* / k_n)',runs:['head/linear'],measure:r=>({value:r['head/linear'].duration,reference:r['head/linear'].linearDuration}),float64:relative(2e-4)},
  {id:'momentum.impact',title:'Two grains head on: momentum',unit:'1',formula:'p = const',runs:['head/e0.5'],measure:r=>r['head/e0.5'].momentum,reference:0,float64:upper(1e-13)},
  {id:'restitution.hertz-09',title:'Restitution, Hertz law, e = 0.9',unit:'1',formula:'e as set',runs:['head/e0.9'],measure:r=>r['head/e0.9'].restitution,reference:0.9,float64:absolute(1e-3)},
  {id:'restitution.hertz-05',title:'Restitution, Hertz law, e = 0.5',unit:'1',formula:'e as set',runs:['head/e0.5'],measure:r=>r['head/e0.5'].restitution,reference:0.5,float64:absolute(1e-3)},
  {id:'restitution.hertz-02-fast',title:'Restitution, Hertz law, e = 0.2, ten times faster',unit:'1',formula:'e as set, at any speed',runs:['head/e0.2-fast'],measure:r=>r['head/e0.2-fast'].restitution,reference:0.2,float64:absolute(1e-3)},
  {id:'restitution.linear-05',title:'Restitution, linear law, e = 0.5',unit:'1',formula:'e as set',runs:['head/linear-e0.5'],measure:r=>r['head/linear-e0.5'].restitution,reference:0.5,float64:absolute(2e-3)},
  {id:'oblique.sliding',title:'Oblique impact on a plane: sliding regime (Hertz)',unit:'1',formula:'psi2 = psi1 - (7/2) mu (1 + e)',runs:['oblique/sliding'],measure:r=>({value:r['oblique/sliding'].psi2,reference:r['oblique/sliding'].sliding}),float64:absolute(5e-3)},
  {id:'oblique.sliding-linear',title:'Oblique impact on a plane: sliding regime (linear)',unit:'1',formula:'psi2 = psi1 - (7/2) mu (1 + e)',runs:['oblique/sliding-linear'],measure:r=>({value:r['oblique/sliding-linear'].psi2,reference:r['oblique/sliding-linear'].sliding}),float64:absolute(5e-3)},
  {id:'oblique.sticking',title:'Oblique impact on a plane: sticking, k_t = 2/7 k_n',unit:'1',formula:'psi2 = psi1 cos(pi sqrt(7 k_t / (2 k_n))) = -psi1',runs:['oblique/sticking'],measure:r=>r['oblique/sticking'].psi2,reference:-1,float64:absolute(2e-3)},
  {id:'oblique.sticking-half',title:'Oblique impact on a plane: sticking, k_t = 1/7 k_n',unit:'1',formula:'psi2 = psi1 cos(pi sqrt(1/2))',runs:['oblique/sticking-half'],measure:r=>({value:r['oblique/sticking-half'].psi2,reference:r['oblique/sticking-half'].sticking}),float64:absolute(5e-3)},
  {id:'incline.sliding',title:'Grain sliding down an incline',unit:'m/s^2',formula:'a = g (sin theta - mu cos theta)',runs:['incline/sliding'],measure:r=>({value:r['incline/sliding'].acceleration,reference:r['incline/sliding'].sliding}),float64:relative(1e-9),tolerance:relative(2e-3),
    note:'float32: 43 850 steps of 14 microseconds each add 5.5e-5 m/s to a velocity of 1 to 2.4 m/s, which float32 holds to 2.4e-7 m/s; the same increment is rounded the same way step after step, so the error does not average out. Measured -4.4e-4. Larger steps (softer grains) lose less.'},
  {id:'incline.rolling',title:'Grain rolling down an incline',unit:'m/s^2',formula:'a = (5/7) g sin theta',runs:['incline/rolling'],measure:r=>({value:r['incline/rolling'].acceleration,reference:r['incline/rolling'].rolling}),float64:relative(1e-3)},
  {id:'incline.rolling-linear',title:'Grain rolling down an incline (linear law)',unit:'m/s^2',formula:'a = (5/7) g sin theta',runs:['incline/rolling-linear'],measure:r=>({value:r['incline/rolling-linear'].acceleration,reference:r['incline/rolling-linear'].rolling}),float64:relative(1e-3)},
  {id:'column.floor',title:'Column of 300 beads at rest',unit:'N',formula:'F = M g',runs:['column'],measure:r=>({value:-r['column'].floor,reference:r['column'].weight}),float64:relative(1e-3)},
  {id:'free-wall.momentum',title:'Beads striking a free dynamic sphere (the solver alone): total momentum',unit:'1',formula:'p = const',runs:['free-wall'],measure:r=>r['free-wall'].change,reference:0,float64:upper(1e-12),tolerance:upper(2e-6),
    note:'float32: the sphere and the beads are integrated in float32, and the sphere takes the sum of the contact forces rounded per block; the float64 solver conserves this to 1e-13.'},
  {id:'janssen.share',title:'Janssen: floor load of a full silo',unit:'1',formula:'a fluid gives 1; Janssen W_s / W for a tall fill',runs:['janssen'],measure:r=>r['janssen'].hydrostatic,reference:0,float64:upper(0.2)},
  {id:'janssen.fit',title:'Janssen: floor load against weight poured, eight fills',unit:'1',formula:'F = W_s (1 - exp(-W / W_s))',runs:['janssen'],measure:r=>r['janssen'].residual,reference:0,float64:upper(0.1)},
  {id:'janssen.plateau',title:'Janssen: saturation',unit:'N',formula:'the fitted W_s',runs:['janssen'],measure:r=>({value:r['janssen'].plateau,reference:r['janssen'].saturation}),float64:relative(0.1)},
  {id:'janssen.stress-ratio',title:'Janssen: stress ratio K',unit:'1',formula:'mean wall pressure over floor pressure of the full silo',runs:['janssen'],measure:r=>({value:r['janssen'].stressRatio,reference:r['janssen'].stressRatioDirect}),float64:relative(0.25)},
  {id:'beverloo.fit',title:'Beverloo: discharge through four orifices',unit:'1',formula:'W = C rho_b sqrt(g) (D - k d)^(5/2)',runs:['beverloo'],measure:r=>r['beverloo'].misfit,reference:0,float64:upper(0.15)},
  {id:'beverloo.c',title:'Beverloo: coefficient C',unit:'1',formula:'typical literature values 0.55 to 0.65, from memory; the middle',runs:['beverloo'],measure:r=>r['beverloo'].C,reference:0.6,float64:absolute(0.25)},
  {id:'beverloo.k',title:'Beverloo: empty-annulus factor k',unit:'1',formula:'typical literature values 1 to 2, from memory; the middle',runs:['beverloo'],measure:r=>r['beverloo'].k,reference:1.5,float64:absolute(1)},
  {id:'beverloo.height',title:'Beverloo: independence of the fill height',unit:'1',formula:'1 (a liquid would give 0.90)',runs:['beverloo'],measure:r=>r['beverloo'].heightRatio,reference:1,float64:absolute(0.12)},
  {id:'repose.trend',title:'Angle of repose: trend with friction and rolling resistance',unit:'deg',formula:'steeper by at least 6 degrees (a trend check, no closed form)',runs:['repose/0.5/0.3','repose/0.2/0'],measure:r=>r['repose/0.5/0.3'].angle-r['repose/0.2/0'].angle,reference:6,float64:lower(0)},
  {id:'repose.retained',title:'Angle of repose: mass left on the ledge',unit:'pairs',formula:'monotonic',runs:REPOSE.map(([mu,mur])=>`repose/${mu}/${mur}`),
    measure:r=>{const kept=REPOSE.map(([mu,mur])=>r[`repose/${mu}/${mur}`].retained as number);return kept.slice(1).filter((m,i)=>m<=kept[i]).length;},reference:0,float64:upper(0)},
];

export interface GranularCaseRun {readonly rows:GpuCaseRow[];readonly runs:Record<string,{seconds:number;result:Record<string,unknown>}>}
/**
 * Run the cases with `K` (the exports of granular.ts with `Granular` replaced by a proxy class). Synchronous: the proxy
 * blocks on its backend. `only` restricts the set-ups; `quick` true runs the quick ones only.
 */
export function runGranularCases(S:Scenarios,K:Kit,options:{readonly only?:readonly string[];readonly quick?:boolean;readonly progress?:(name:string)=>void}={}):GranularCaseRun {
  const runs=granularRuns(S),results:Record<string,any>={},info:GranularCaseRun['runs']={};
  for(const [name,entry] of Object.entries(runs)){
    if(options.only?!options.only.includes(name):options.quick===true&&!entry.quick)continue;
    options.progress?.(name);
    const started=performance.now();results[name]=entry.run(K);
    info[name]={seconds:(performance.now()-started)/1000,result:Object.fromEntries(Object.entries(results[name]).filter(([,v])=>typeof v==='number'||typeof v==='boolean'||v===null))};
  }
  const rows:GpuCaseRow[]=[];
  for(const spec of SPECS){
    if(!spec.runs.every(name=>name in results))continue;
    const m=spec.measure(results),value=typeof m==='number'?m:m.value,reference=typeof m==='number'?spec.reference??0:m.reference,tolerance=spec.tolerance??spec.float64;
    rows.push({id:`granular.${spec.id}`,title:spec.title,unit:spec.unit,formula:spec.formula,value,reference,tolerance,float64:spec.float64,pass:withinTolerance(value,reference,tolerance),...(spec.note?{note:spec.note}:{})});
  }
  return {rows,runs:info};
}
