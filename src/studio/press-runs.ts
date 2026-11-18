import {normalizePress,type PressSettings} from './press-settings';
import {pressDriveFor,type PressDriveId} from './press-program';
import {STUDIO_CHECKPOINT_BACKEND,STUDIO_SCALED_CHECKPOINT_BACKEND,type Snapshot,type StudioBackend} from './physics';

export const PRESS_RUN_STORAGE_KEY='box3d.press.comparisons.v1';
export const MAX_PRESS_RUNS=4,MAX_PRESS_RUN_POINTS=602,MAX_PRESS_RUN_BYTES=1024*1024;
export interface PressRunPoint {time:number;bend:number;plastic:number;broken:number;drive:number;requested:number;travel:number}
export interface PressRunMetrics {peakBend:number;finalBend:number;plastic:number;broken:number;recovery:number;firstYield:number|null;firstCrack:number|null}
export interface PressRun {
  id:string;createdAt:string;backend:StudioBackend;settings:PressSettings;drives:PressDriveId[];complete:boolean;historyComplete:boolean;
  points:PressRunPoint[];metrics:PressRunMetrics;
}
export const pressRunPoint=(s:Snapshot,requested:number):PressRunPoint=>({time:s.response.time,bend:s.response.deflection*100,plastic:s.response.plastic*100,broken:s.response.broken,drive:s.press?.pressure??0,requested,travel:s.press?.travel??0});
export function pressRunMetrics(points:readonly PressRunPoint[],historyComplete=true):PressRunMetrics {
  const last=points.at(-1),peak=Math.max(0,...points.map(p=>p.bend));
  return {peakBend:peak,finalBend:last?.bend??0,plastic:Math.max(0,...points.map(p=>p.plastic)),broken:last?.broken??0,recovery:Math.max(0,peak-(last?.bend??0)),
    firstYield:historyComplete?points.find(p=>p.plastic>0)?.time??null:null,firstCrack:historyComplete?points.find(p=>p.broken>0)?.time??null:null};
}
export function makePressRun(input:Omit<PressRun,'metrics'>):PressRun {
  return {...input,settings:{...input.settings},drives:[...input.drives],points:input.points.map(p=>({...p})),metrics:pressRunMetrics(input.points,input.historyComplete)};
}
export function addPressRun(saved:readonly PressRun[],run:PressRun):PressRun[] {
  return [makePressRun(run),...saved.filter(s=>s.id!==run.id).map(makePressRun)].slice(0,MAX_PRESS_RUNS);
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Validate stored scalars and rebuild metrics. Never trust persisted labels, markup or summary values. */
export function decodePressRuns(text:string|null):PressRun[] {
  if(!text||text.length>MAX_PRESS_RUN_BYTES)return [];
  try{
    const data:unknown=JSON.parse(text);if(!plain(data)||data.schema!=='press-runs-v1'||!Array.isArray(data.runs)||data.runs.length>MAX_PRESS_RUNS)return [];
    const result:PressRun[]=[];
    for(const raw of data.runs){
      if(!plain(raw)||typeof raw.id!=='string'||!/^[\w-]{1,80}$/.test(raw.id)||typeof raw.createdAt!=='string'||raw.createdAt.length>32||!Number.isFinite(Date.parse(raw.createdAt)))return [];
      if(raw.backend!==STUDIO_CHECKPOINT_BACKEND&&raw.backend!==STUDIO_SCALED_CHECKPOINT_BACKEND)return [];
      if(!plain(raw.settings)||!Array.isArray(raw.points)||raw.points.length<1||raw.points.length>MAX_PRESS_RUN_POINTS||typeof raw.complete!=='boolean'||typeof raw.historyComplete!=='boolean'||!Array.isArray(raw.drives)||raw.drives.length<1||raw.drives.length>4)return [];
      const rawSettings=raw.settings,settings=normalizePress(rawSettings);if(Object.entries(settings).some(([k,v])=>rawSettings[k]!==v))return [];
      if(raw.drives.some(d=>pressDriveFor(d).id!==d))return [];
      const points:PressRunPoint[]=[];let previous=-1;
      for(const p of raw.points){
        if(!plain(p)||['time','bend','plastic','broken','drive','requested','travel'].some(k=>typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0))return [];
        if((p.time as number)<=previous||(p.drive as number)>100||(p.requested as number)>100||!Number.isInteger(p.broken))return [];
        previous=p.time as number;points.push({time:p.time as number,bend:p.bend as number,plastic:p.plastic as number,broken:p.broken as number,drive:p.drive as number,requested:p.requested as number,travel:p.travel as number});
      }
      result.push(makePressRun({id:raw.id,createdAt:raw.createdAt,backend:raw.backend,settings,drives:raw.drives as PressDriveId[],points,complete:raw.complete,historyComplete:raw.historyComplete}));
    }
    return new Set(result.map(r=>r.id)).size===result.length?result:[];
  }catch{return [];}
}
export function encodePressRuns(runs:readonly PressRun[]):string {
  const text=JSON.stringify({schema:'press-runs-v1',runs});
  if(text.length>MAX_PRESS_RUN_BYTES||decodePressRuns(text).length!==runs.length)throw new RangeError('Comparison exceeds the local run-summary limits.');
  return text;
}
