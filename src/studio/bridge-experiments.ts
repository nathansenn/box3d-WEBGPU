import { BRIDGE_HANGERS, bridgeModelKey, bridgePoint, cuts, type BridgeBaseline, type BridgeControls, type BridgeModel, type BridgePoint } from './bridge-review';
import { createStudioClient, type StudioClient } from '../engine/studio-client';
import type { StudioCreateOptions, StudioStepResult } from '../engine/studio-runtime';

export const BRIDGE_EXPERIMENTS_KEY = 'box3d.bridge.experiments.v2';
export const EXPERIMENT_DURATIONS = [15, 30, 60, 120] as const;
export const EXPERIMENT_CASE_COUNTS = [3, 4, 5, 7, 9] as const;
// The SI bridge: the crowd in kN/m^2 on the east half, hangers cut on the upstream cable (whole numbers), wind in kN/m.
export const EXPERIMENT_PLANS = [
  { id: 'load', label: 'Crowd scan', axis: 'target', unit: ' kN/m²', min:0, max:5, values: [0, 1, 2, 3.7, 5], step:.0001 },
  { id: 'cuts', label: 'Hanger loss scan', axis: 'strength', unit: ' cut', min:0, max:6, values: [0, 1, 2, 4, 6], step:1 },
  { id: 'wind', label: 'Wind scan', axis: 'wind', unit: ' kN/m', min:0, max:2, values: [0, .5, 1, 1.5, 2], step:.0001 },
] as const;
export type ExperimentPlanId = typeof EXPERIMENT_PLANS[number]['id'];
export type ExperimentDuration = typeof EXPERIMENT_DURATIONS[number];
export const EXPERIMENT_PRESETS:readonly {id:string;plan:ExperimentPlanId;label:string;description:string;duration:ExperimentDuration;values:readonly number[]}[] = [
  {id:'load-overview',plan:'load',label:'Crowd overview',description:'Empty deck to the EN 1991-2 upper crowd of 5 kN/m² on the east half.',duration:30,values:EXPERIMENT_PLANS[0].values},
  {id:'load-low',plan:'load',label:'Light crowds',description:'Crowds from 0 to 1 kN/m²: the service range of a footbridge.',duration:30,values:[0,.25,.5,.75,1]},
  {id:'load-high',plan:'load',label:'Dense crowds',description:'From 3 kN/m² through the 3.7 kN/m² crowd of this span to 5 kN/m².',duration:30,values:[3,3.5,3.7,4.5,5]},
  {id:'load-extended',plan:'load',label:'Extended crowd observation',description:'Watch the response over 120 s; this is not a fatigue test.',duration:120,values:[0,1,2,3,4,4.5,5]},
  {id:'cuts-overview',plan:'cuts',label:'Hanger loss overview',description:'No hanger lost to six adjacent hangers of one cable lost.',duration:30,values:EXPERIMENT_PLANS[1].values},
  {id:'cuts-low',plan:'cuts',label:'First hangers lost',description:'None to three hangers lost at midspan.',duration:30,values:[0,1,2,3]},
  {id:'cuts-high',plan:'cuts',label:'Several hangers lost',description:'Three to six adjacent hangers lost.',duration:30,values:[3,4,5,6]},
  {id:'wind-overview',plan:'wind',label:'Wind overview',description:'No wind to a 2 kN/m lateral load on the deck.',duration:30,values:EXPERIMENT_PLANS[2].values},
  {id:'wind-low',plan:'wind',label:'Light wind',description:'Lateral loads up to 0.5 kN/m.',duration:30,values:[0,.1,.2,.35,.5]},
  {id:'wind-high',plan:'wind',label:'Strong wind',description:'The upper half of the range, 1 to 2 kN/m.',duration:60,values:[1,1.25,1.5,1.75,2]},
];
export interface ExperimentDesign { values:readonly number[]; preset:string|null }
type CaseStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
export interface BridgeExperimentCase {
  index: number;
  settings: BridgeControls;
  status: CaseStatus;
  points: BridgePoint[];
  firstRupture: number | null;
  phase: string;
}
export interface BridgeExperimentBatch {
  format: 'box3d-bridge-experiments'; version: 2;
  model: string; createdAt: string; plan: ExperimentPlanId; duration: ExperimentDuration;
  base: BridgeControls; status: Exclude<CaseStatus, 'pending'>;
  transport: 'worker' | 'sync' | null; cases: BridgeExperimentCase[];
  design?:ExperimentDesign;
}
export const experimentPlan = (id: ExperimentPlanId) => EXPERIMENT_PLANS.find(p => p.id === id)!;
const bounded = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const validControls = (s: BridgeControls) => !!s && bounded(s.target, 0, 5) && cuts(s.strength) && bounded(s.wind, 0, 2) && [.25, .5, 1, 2].includes(s.speed) && ['service', 'failure'].includes(s.program);
const copyControls = (s: BridgeControls): BridgeControls => ({ target:s.target, strength:s.strength, wind:s.wind, program:s.program, speed:s.speed });
export const experimentValue = (value:number) => value.toFixed(4).replace(/0{1,2}$/, '');
const validValues = (plan:ExperimentPlanId, values:readonly number[]):boolean => {
  const p=experimentPlan(plan);
  return !!p && Array.isArray(values) && (EXPERIMENT_CASE_COUNTS as readonly number[]).includes(values.length) &&
    values.every((v,i)=>bounded(v,p.min,p.max)&&Math.abs(v/p.step-Math.round(v/p.step))<1e-7&&(!i||v>values[i-1]));
};
const validDesign = (plan:ExperimentPlanId, design:ExperimentDesign):boolean => {
  if(!design||!validValues(plan,design.values))return false;
  if(design.preset===null){
    const start=design.values[0],end=design.values.at(-1)!;
    const p=experimentPlan(plan);
    return design.values.every((v,i)=>v===rounded(start+(end-start)*i/(design.values.length-1),p.step));
  }
  const preset=EXPERIMENT_PRESETS.find(p=>p.id===design.preset&&p.plan===plan);
  return !!preset&&preset.values.length===design.values.length&&preset.values.every((v,i)=>v===design.values[i]);
};
/** Evenly spaced, bounded settings, rounded to four decimals with distinct endpoints. */
export function experimentRange(plan:ExperimentPlanId,start:number,end:number,count:number):number[] {
  const p=experimentPlan(plan);
  if(!p||!bounded(start,p.min,p.max)||!bounded(end,p.min,p.max)||start>=end)throw new Error(`Enter an increasing range from ${p?.min??0} to ${p?.max??5}.`);
  if(!(EXPERIMENT_CASE_COUNTS as readonly number[]).includes(count))throw new Error('Choose 3, 5, 7 or 9 cases.');
  if([start,end].some(v=>Math.abs(v/p.step-Math.round(v/p.step))>1e-7))throw new Error(p.step===1?'Hangers cut are whole numbers.':'Use at most four decimal places for the range.');
  const values=Array.from({length:count},(_,i)=>rounded(start+(end-start)*i/(count-1),p.step));
  if(!validValues(plan,values))throw new Error('Widen this range or use fewer cases so every setting is distinct.');
  return values;
}

export function makeExperimentBatch(model: BridgeModel, plan: ExperimentPlanId, duration: ExperimentDuration, base: BridgeControls, design?:ExperimentDesign): BridgeExperimentBatch {
  const p = experimentPlan(plan);
  if (!p || !EXPERIMENT_DURATIONS.includes(duration) || !validControls(base)) throw new Error('Choose a supported scan, duration and load settings.');
  design??={values:p.values,preset:`${plan}-overview`};
  if(!validDesign(plan,design))throw new Error('Choose distinct, increasing settings within the supported scan range.');
  return {
    format:'box3d-bridge-experiments', version:2, model:bridgeModelKey(model), createdAt:new Date().toISOString(),
    design:{values:[...design.values],preset:design.preset},
    plan, duration, base:copyControls(base), status:'running', transport:null,
    // Program and playback speed do not change the fixed-tick load history.
    cases:design.values.map((value,index) => ({ index, settings:{...copyControls(base), [p.axis]:value}, status:'pending', points:[], firstRupture:null, phase:'Ready' })),
  };
}
export function experimentCaseLabel(batch: BridgeExperimentBatch, c: BridgeExperimentCase): string {
  const p = experimentPlan(batch.plan);
  if (batch.plan === 'cuts') { const n=c.settings.strength; return `${n} hanger${n===1?'':'s'} cut`; }
  return `${batch.plan === 'load' ? 'Crowd' : 'Wind'} ${experimentValue(c.settings[p.axis])}${p.unit}`;
}
/** Adjacent completed observations only; do not assume a monotonic or safe failure boundary. */
export function experimentTransitions(batch:BridgeExperimentBatch) {
  if(batch.status==='running')return [];
  return batch.cases.slice(1).flatMap((upper,i)=>{
    const lower=batch.cases[i];
    if(lower.status!=='completed'||upper.status!=='completed'||lower.points.length<2||upper.points.length<2)return [];
    const lowerRuptured=lower.points.at(-1)!.broken>0,upperRuptured=upper.points.at(-1)!.broken>0;
    return lowerRuptured===upperRuptured?[]:[{lower,upper,lowerRuptured,upperRuptured}];
  });
}
export function experimentFollowUp(batch:BridgeExperimentBatch,lowerIndex:number) {
  const transition=experimentTransitions(batch).find(t=>t.lower.index===lowerIndex);
  if(!transition)throw new Error('Choose adjacent completed cases with different rupture outcomes.');
  const axis=experimentPlan(batch.plan).axis;
  return {plan:batch.plan,duration:batch.duration,base:copyControls(batch.base),
    design:{values:experimentRange(batch.plan,transition.lower.settings[axis],transition.upper.settings[axis],5),preset:null}};
}
export function experimentSummary(c: BridgeExperimentCase) {
  if (!c.points.length) return undefined;
  const peak = c.points.reduce((a,b) => b.drop > a.drop ? b : a);
  const broken=c.points.at(-1)!.broken;
  return { time:c.points.at(-1)!.time, peak:peak.drop, peakTime:peak.time, lateral:Math.max(...c.points.map(p => p.lateral)), broken, hanger:Math.max(...c.points.map(p => p.hanger)),
    outcome:c.phase === 'Beyond stated strength' ? 'Beyond stated strength' : broken ? `${broken} hanger${broken===1?'':'s'} failed` : 'No hanger failure' };
}

export const EXPERIMENT_METRICS = [
  { id:'drop', label:'Deck drop', title:'Recorded deck drop', unit:'mm' },
  { id:'lateral', label:'Sideways', title:'Recorded sideways movement', unit:'mm' },
  { id:'hanger', label:'Hanger', title:'Recorded largest hanger tension', unit:'kN' },
  { id:'broken', label:'Hangers failed', title:'Recorded failed hangers', unit:'hangers' },
] as const;
export type ExperimentMetric = typeof EXPERIMENT_METRICS[number]['id'];

/** Probe only an actual 10 Hz sample. Never interpolate or extend a partial record. */
export function experimentSample(c: BridgeExperimentCase, time: number): BridgePoint | undefined {
  if (!Number.isFinite(time) || time < 0) return;
  const point=c.points[Math.round(time*10)];
  return point && Math.abs(point.time-time)<1e-7 ? point : undefined;
}
export function experimentPeak(c: BridgeExperimentCase, metric: ExperimentMetric): number | undefined {
  if (c.points.length<2) return;
  return Math.max(...c.points.map(point=>point[metric]));
}
/** Milestones refer to retained samples, not interpolated geometry or event times. */
export function experimentProbeTargets(c: BridgeExperimentCase): { first?:BridgePoint; peak?:BridgePoint; end?:BridgePoint } {
  if(c.points.length<2)return {};
  return {
    first:c.points.find(point=>point.broken>0),
    peak:c.points.reduce((a,b)=>b.drop>a.drop?b:a),
    end:c.points.at(-1),
  };
}
/** Compare like-for-like readings. Peaks need equal recording windows; probes need both exact samples. */
export function experimentComparison(current: BridgeExperimentCase, reference: BridgeExperimentCase, time: number | null) {
  const recorded=current.points.length>1&&reference.points.length>1;
  const currentEnd=current.points.at(-1)?.time??0,referenceEnd=reference.points.at(-1)?.time??0;
  const sharedEnd=recorded?Math.round(Math.min(currentEnd,referenceEnd)*10)/10:undefined;
  const currentPoint=time===null?undefined:experimentSample(current,time);
  const referencePoint=time===null?undefined:experimentSample(reference,time);
  const status=current.status==='running'||reference.status==='running'?'running':!recorded?'missing':
    time===null?(Math.abs(currentEnd-referenceEnd)<1e-7?'ready':'duration-mismatch'):
    currentPoint&&referencePoint?'ready':'missing';
  const readings=EXPERIMENT_METRICS.map(metric=>{
    const value=time===null?experimentPeak(current,metric.id):currentPoint?.[metric.id];
    const base=time===null?experimentPeak(reference,metric.id):referencePoint?.[metric.id];
    return {metric:metric.id,current:value,reference:base,delta:status==='ready'&&value!==undefined&&base!==undefined?value-base:undefined};
  });
  return {status,sharedEnd,currentEnd,referenceEnd,readings};
}
export function experimentOverview(batch: BridgeExperimentBatch) {
  const recorded=batch.cases.filter(c=>c.points.length>1);
  const ruptured=recorded.filter(c=>(c.points.at(-1)?.broken??0)>0);
  const earliest=ruptured.filter(c=>c.firstRupture!==null).reduce<BridgeExperimentCase|undefined>((a,c)=>
    !a || c.firstRupture!<a.firstRupture! ? c : a,undefined);
  return { completed:batch.cases.filter(c=>c.status==='completed').length, recorded:recorded.length, ruptured:ruptured.length, earliest };
}
export function experimentBaseline(batch: BridgeExperimentBatch, c: BridgeExperimentCase): BridgeBaseline | undefined {
  if (c.points.length < 2 || c.status === 'pending' || c.status === 'running') return;
  return { format:'box3d-bridge-baseline', version:2, model:batch.model, savedAt:new Date().toISOString(),
    name:`${experimentCaseLabel(batch,c)} / ${c.points.at(-1)!.time.toFixed(1)} s${c.status === 'completed' ? '' : ' partial'}`,
    settings:copyControls(c.settings), changes:[{time:0,...copyControls(c.settings)}], points:c.points.map(p => ({...p})), historyComplete:true };
}

interface RunOptions {
  signal: AbortSignal;
  progress: (batch: BridgeExperimentBatch) => void;
  createClient?: (options: StudioCreateOptions) => Promise<StudioClient>;
  yieldTask?: () => Promise<void>;
}
/** Uses the production engine in isolation. Never steps, resets or retains loans from the live scene. */
export async function runBridgeExperiments(batch: BridgeExperimentBatch, model: BridgeModel, options: RunOptions): Promise<BridgeExperimentBatch> {
  if (batch.model !== bridgeModelKey(model) || batch.status !== 'running' || batch.cases.some(c => c.status !== 'pending')) throw new Error('Experiments need a fresh matching model.');
  let client: StudioClient | undefined, active: BridgeExperimentCase | undefined, destroyed = false;
  const destroy = async () => { if (client && !destroyed) { destroyed=true; await client.destroy(); } };
  const abort = () => { void destroy().catch(() => {}); };
  const checkAbort = () => { if (options.signal.aborted) throw new Error('Experiment cancelled.'); };
  const consume = (result: StudioStepResult, c: BridgeExperimentCase, initial = false) => {
    try {
      if (initial) c.points.push(bridgePoint(model,result.liveSnapshot));
      else for (const sample of result.recordingSamples) c.points.push(bridgePoint(model,sample.snapshot));
      c.firstRupture ??= result.eventDelta.find(e => e.type === 'break')?.time ?? null;
      c.phase=result.liveSnapshot.response.phase;
    } finally { result.release(); }
  };
  options.signal.addEventListener('abort',abort,{once:true});
  try {
    for (const c of batch.cases) {
      checkAbort(); active=c; c.status='running'; options.progress(batch);
      const s=c.settings, setup:StudioCreateOptions={study:'bridge',backend:model.backend,controls:{targetLoad:s.target,wind:s.wind,cuts:Math.round(s.strength)}};
      if (!client) {
        client=await (options.createClient ?? createStudioClient)(setup);
        checkAbort(); batch.transport=client.mode; consume(await client.inspect(),c,true);
      } else consume(await client.reset(setup),c,true);
      checkAbort();
      const ticks=batch.duration*120;
      while (client.tick < ticks) {
        checkAbort();
        consume(await client.step({ticks:Math.min(120,ticks-client.tick)}),c);
        options.progress(batch);
        // An explicit task boundary also keeps the synchronous fallback cancellable.
        await (options.yieldTask ?? (() => new Promise<void>(resolve => setTimeout(resolve,0))))();
      }
      checkAbort(); c.status='completed'; options.progress(batch); active=undefined;
    }
    batch.status='completed';
  } catch (error) {
    batch.status=options.signal.aborted ? 'cancelled' : 'failed';
    if (active) active.status=batch.status;
    if (!options.signal.aborted && error instanceof Error) console.warn('Bridge experiments stopped:',error.message);
  } finally {
    options.signal.removeEventListener('abort',abort);
    await destroy(); options.progress(batch);
  }
  return batch;
}

/** A reload or view teardown preserves recorded samples, never an apparently running batch. */
export function interruptedExperiments(batch: BridgeExperimentBatch): BridgeExperimentBatch {
  return {...batch, status:batch.status === 'running' ? batch.cases.every(c=>c.status==='completed')?'completed':'cancelled' : batch.status,
    cases:batch.cases.map(c => ({...c,status:c.status === 'running' ? 'cancelled' : c.status}))};
}

export function parseBridgeExperiments(raw: string | null, model: string): BridgeExperimentBatch | undefined {
  if (!raw || raw.length > 3_000_000) return;
  try {
    const b=JSON.parse(raw) as BridgeExperimentBatch, p=experimentPlan(b.plan);
    if (b.format !== 'box3d-bridge-experiments' || b.version !== 2 || b.model !== model || !p || !EXPERIMENT_DURATIONS.includes(b.duration) || !validControls(b.base)) return;
    if(!b.design||!validDesign(b.plan,b.design))return;
    const values=b.design.values;
    if (typeof b.createdAt !== 'string' || !Number.isFinite(Date.parse(b.createdAt)) || !['completed','cancelled','failed'].includes(b.status) || ![null,'worker','sync'].includes(b.transport)) return;
    if (!Array.isArray(b.cases) || b.cases.length !== values.length) return;
    let stopped=false, pendingSeen=false, partials=0;
    for (let i=0;i<b.cases.length;i++) {
      const c=b.cases[i], expected={...b.base,[p.axis]:values[i]};
      if (!c || c.index !== i || !validControls(c.settings) || Object.keys(expected).some(key => c.settings[key as keyof BridgeControls] !== expected[key as keyof BridgeControls])) return;
      if (!['pending','completed','cancelled','failed'].includes(c.status) || (stopped && c.status === 'completed')) return;
      if (c.status !== 'completed') stopped=true;
      if (c.status === 'cancelled' || c.status === 'failed') { if (pendingSeen || ++partials > 1 || c.status !== b.status) return; }
      if (c.status === 'pending') pendingSeen=true;
      if (!['Ready','Elastic response','Hangers failed','Beyond stated strength'].includes(c.phase)) return;
      if (!Array.isArray(c.points) || c.points.length > b.duration*10+1 || (c.status === 'pending' && c.points.length) || (c.status === 'completed' && c.points.length !== b.duration*10+1)) return;
      for (let j=0;j<c.points.length;j++) {
        const pt=c.points[j];
        if (!pt || !bounded(pt.time,0,b.duration+1e-7) || Math.abs(pt.time-j/10)>1e-7 || !bounded(pt.load,0,5) || !bounded(pt.drop,0,1e6) || !bounded(pt.lateral,0,1e6) || !bounded(pt.hanger,0,1e5) || !Number.isInteger(pt.broken) || pt.broken<0 || pt.broken>BRIDGE_HANGERS || (j>0 && pt.broken<c.points[j-1].broken)) return;
      }
      if (c.points.length && (c.points[0].broken !== 0 || c.points[0].load !== 0)) return;
      const firstBroken=c.points.findIndex(pt => pt.broken>0);
      if (firstBroken<0 ? c.firstRupture !== null : !bounded(c.firstRupture,Math.max(0,c.points[firstBroken].time-.1-1e-7),c.points[firstBroken].time+1e-7)) return;
    }
    if ((b.status === 'completed') !== b.cases.every(c => c.status === 'completed')) return;
    return b;
  } catch { return; }
}

const BASIS='SI suspension model on validated solvers (docs/SI_BRIDGE.md); not calibrated against a built bridge';
const rounded=(value:number,step:number)=>step===1?Math.round(value):Math.round(value*10000)/10000;
const csvCell=(value:string|number|null)=>`"${String(value ?? '').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')}"`;
export function experimentCSV(batch: BridgeExperimentBatch): string {
  const headers=['case','scan','status','crowd_kN_per_m2','hangers_cut','wind_kN_per_m','planned_seconds','recorded_seconds','outcome_observed','first_hanger_failure_seconds','peak_deck_drop_mm','peak_drop_seconds','peak_lateral_mm','peak_hanger_tension_kN','hangers_failed','model','created_at','basis'];
  const rows=batch.cases.map(c => { const s=experimentSummary(c); return [experimentCaseLabel(batch,c),batch.plan,c.status,c.settings.target,c.settings.strength,c.settings.wind,batch.duration,s?.time??null,s?.outcome??'',c.firstRupture,s?.peak??null,s?.peakTime??null,s?.lateral??null,s?.hanger??null,s?.broken??null,batch.model,batch.createdAt,BASIS]; });
  return [headers,...rows].map(row => row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function experimentSamplesCSV(batch:BridgeExperimentBatch):string {
  const headers=['case','scan','status','seconds','crowd_kN_per_m2','deck_drop_mm','sideways_mm','largest_hanger_kN','hangers_failed','target_crowd_kN_per_m2','hangers_cut','wind_kN_per_m','planned_seconds','model','created_at','basis'];
  const rows=batch.cases.flatMap(c=>c.points.map(p=>[experimentCaseLabel(batch,c),batch.plan,c.status,p.time,p.load,p.drop,p.lateral,p.hanger,p.broken,c.settings.target,c.settings.strength,c.settings.wind,batch.duration,batch.model,batch.createdAt,BASIS]));
  return [headers,...rows].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
export function experimentExport(batch: BridgeExperimentBatch) {
  return {...batch, exportedAt:new Date().toISOString(), units:{time:'s',drop:'mm',lateral:'mm',hanger:'kN',load:'kN/m² crowd on the east half',wind:'kN/m on the deck',strength:'hangers cut on the upstream cable'},
    basis:{fixedHz:120,sampleHz:10,initialState:'intact bridge at rest under its dead load',loadHistory:'crowd builds up at 0.5 kN/m² per second to its target; wind and cuts act from the start',calibration:BASIS,speed:'Playback speed does not affect fixed-tick experiments.',water:'Visual surroundings do not apply river forces.',geometry:'Response samples and settings only; load a case and rerun to inspect geometry.'},
    summaries:batch.cases.map(c => ({index:c.index,label:experimentCaseLabel(batch,c),status:c.status,firstRupture:c.firstRupture,...experimentSummary(c)}))};
}
