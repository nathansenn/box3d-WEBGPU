import {LIQUID_KEYS,LIQUID_DEFAULTS} from './liquid-config';
import {isLab, LABS, MATERIALS, normalizeSettings, type LabId, type LabSettings} from './catalog';

export const RUN_STORAGE_KEY = 'box3d.material-runs.v1';
export const MAX_SAVED_RUNS = 24;
export const MAX_TRACE_SAMPLES = 320;
export type Metrics = [number, number, number];
export interface Measurement {time:number; metrics:Metrics;}
export interface RunEvent {time:number; action:'release';}
export interface SavedRun {
  id:string; study:LabId; name:string; savedAt:string; experiment:string;
  settings:LabSettings; metricLabels:[string,string,string]; duration:number;
  complete:boolean; phase:string; events:RunEvent[]; samples:Measurement[];
  minimum:Metrics; maximum:Metrics; final:Metrics;
}
export interface RunDraft {
  study:LabId; name:string; experiment:string; settings:LabSettings;
  metricLabels:readonly string[]; complete:boolean; phase:string;
  events:RunEvent[]; frames:readonly Measurement[];
}
export interface RunStorage {getItem(key:string):string|null; setItem(key:string,value:string):void;}
export interface LibraryState {runs:SavedRun[]; warning:string; writable:boolean;}
export type LibraryMutation = {ok:true; runs:SavedRun[]}|{ok:false; message:string};
const record = (v:unknown):v is Record<string,unknown> => Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const finite = (v:unknown):v is number => typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
const metrics = (v:unknown):v is Metrics => Array.isArray(v)&&v.length===3&&v.every(finite);
const copy = (v:readonly number[]):Metrics => [v[0],v[1],v[2]];

export function createSavedRun(draft:RunDraft, identity:{id:string; savedAt:string}):SavedRun {
  // Same-time snapshots occur at program completion. Keep the newest measurement.
  const trace:Measurement[]=[];
  for(const frame of draft.frames) {
    if(!finite(frame.time)||frame.time<0||frame.time>3600||!metrics(frame.metrics)) throw new Error('This run contains an invalid measurement. Reset the experiment and try again.');
    const last=trace.at(-1), next={time:frame.time,metrics:copy(frame.metrics)};
    if(last&&frame.time<last.time) throw new Error('Recorded times are out of order. Reset the experiment and try again.');
    if(last&&frame.time===last.time) trace[trace.length-1]=next; else trace.push(next);
  }
  if(trace.length<2||trace.at(-1)!.time<=0) throw new Error('Run the experiment before saving a result.');
  const minimum=copy(trace[0].metrics),maximum=copy(trace[0].metrics);
  for(const frame of trace) for(let i=0;i<3;i++) {minimum[i]=Math.min(minimum[i],frame.metrics[i]);maximum[i]=Math.max(maximum[i],frame.metrics[i]);}
  // Compact traces preserve both endpoints. Summary extrema use every recorded sample.
  const count=Math.min(trace.length,MAX_TRACE_SAMPLES);
  const samples=Array.from({length:count},(_,i)=>trace[Math.round(i*(trace.length-1)/(count-1))]);
  return {
    ...identity, study:draft.study, name:draft.name.trim().slice(0,80)||LABS[draft.study].title,
    experiment:draft.experiment, settings:normalizeSettings(draft.study,draft.settings),
    metricLabels:[draft.metricLabels[0],draft.metricLabels[1],draft.metricLabels[2]],
    duration:trace.at(-1)!.time, complete:draft.complete, phase:draft.phase.slice(0,120),
    events:draft.events.map(e=>({...e})), samples, minimum, maximum, final:copy(trace.at(-1)!.metrics),
  };
}

function validRun(value:unknown):value is SavedRun {
  if(!record(value)||typeof value.study!=='string'||!isLab(value.study)) return false;
  const id=value.study;
  if(typeof value.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)||typeof value.name!=='string'||!value.name.trim()||value.name.length>80) return false;
  if(typeof value.savedAt!=='string'||!Number.isFinite(Date.parse(value.savedAt))||typeof value.experiment!=='string'||value.experiment.length>100) return false;
  const settings=value.settings;
  if(!record(settings)||!MATERIALS[id].some(m=>m.id===settings.material)) return false;
  const normalized=normalizeSettings(id,settings);
  if(Object.keys(normalized).some(key=>normalized[key as keyof LabSettings]!==settings[key]&&!(id==='liquid'&&LIQUID_KEYS.includes(key as keyof typeof LIQUID_DEFAULTS)&&settings[key]===undefined))) return false;
  if(!Array.isArray(value.metricLabels)||value.metricLabels.length!==3||!value.metricLabels.every(s=>typeof s==='string'&&s.length>0&&s.length<100)) return false;
  if(!finite(value.duration)||value.duration<=0||value.duration>3600||typeof value.complete!=='boolean'||typeof value.phase!=='string'||value.phase.length>120) return false;
  const duration=value.duration;
  if(!Array.isArray(value.events)||value.events.length>1000||value.events.some(e=>!record(e)||e.action!=='release'||!finite(e.time)||e.time<0||e.time>duration)) return false;
  if(!metrics(value.minimum)||!metrics(value.maximum)||!metrics(value.final)||!Array.isArray(value.samples)||value.samples.length<2||value.samples.length>MAX_TRACE_SAMPLES) return false;
  let previous=-1;
  for(const frame of value.samples) {
    if(!record(frame)||!finite(frame.time)||frame.time<=previous||frame.time<0||frame.time>value.duration||!metrics(frame.metrics)) return false;
    for(let i=0;i<3;i++) if(frame.metrics[i]<value.minimum[i]||frame.metrics[i]>value.maximum[i]) return false;
    previous=frame.time;
  }
  const last=value.samples.at(-1)!;
  const maximum=value.maximum;
  return previous===value.duration&&value.minimum.every((n,i)=>n<=maximum[i])&&value.final.every((n,i)=>n===last.metrics[i]);
}

export function readRunLibrary(storage:RunStorage):LibraryState {
  try {
    const text=storage.getItem(RUN_STORAGE_KEY);
    if(!text) return {runs:[],warning:'',writable:true};
    if(text.length>3_000_000) throw new Error('oversize');
    const data:unknown=JSON.parse(text);
    if(!record(data)||data.version!==1||!Array.isArray(data.runs)||data.runs.length>MAX_SAVED_RUNS) throw new Error('unsupported');
    const ids=new Set<string>(),runs:SavedRun[]=[];
    for(const run of data.runs) if(validRun(run)&&!ids.has(run.id)) {ids.add(run.id);runs.push({...run,settings:normalizeSettings(run.study,run.settings)});}
    return {runs,warning:runs.length===data.runs.length?'':'Some saved results could not be read. Valid results are still available.',writable:true};
  } catch {
    return {runs:[],warning:'Saved results are unavailable in this browser. Export the current run to keep its data.',writable:false};
  }
}

function mutate(storage:RunStorage, change:(runs:SavedRun[])=>SavedRun[]):LibraryMutation {
  // Read again for every write instead of persisting a stale in-memory list.
  const state=readRunLibrary(storage);
  if(!state.writable) return {ok:false,message:state.warning};
  try {
    const runs=change(state.runs);
    if(runs.length>MAX_SAVED_RUNS) return {ok:false,message:`The library holds ${MAX_SAVED_RUNS} results. Remove a result before saving another.`};
    storage.setItem(RUN_STORAGE_KEY,JSON.stringify({version:1,runs}));
    return {ok:true,runs};
  } catch {
    return {ok:false,message:'This browser could not save the change. Export the current run to keep its data.'};
  }
}
export function storeRun(storage:RunStorage, run:SavedRun):LibraryMutation {
  if(!validRun(run)) return {ok:false,message:'This result could not be saved because its measurements are invalid.'};
  return mutate(storage,runs=>runs.some(r=>r.id===run.id)?runs:[run,...runs]);
}
export function removeRun(storage:RunStorage,id:string):LibraryMutation {return mutate(storage,runs=>runs.filter(r=>r.id!==id));}
export function compatibleRuns(a:SavedRun,b:SavedRun):boolean {return a.study===b.study&&a.metricLabels.every((label,i)=>label===b.metricLabels[i]);}
export function comparisonExport(runs:SavedRun[]):object {
  if(runs.length!==2||!compatibleRuns(runs[0],runs[1])) throw new Error('Choose two results from the same study.');
  return {format:'box3d-material-comparison-v1',calibrated:false,description:'Recorded metric traces and settings. Loading a setup starts a fresh specimen; this file is not a solver checkpoint.',runs};
}
