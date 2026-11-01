import {FIXED_DT} from './physics';
import type {StudioCommand,StudioControls} from '../engine/studio-runtime';

export type PressDriveId='steady'|'soft-start'|'two-stage'|'pulse';
export const PRESS_DRIVES:{id:PressDriveId;name:string;description:string}[]=[
  {id:'steady',name:'Steady',description:'Hold the selected pressure request throughout the stroke.'},
  {id:'soft-start',name:'Soft start',description:'Begin at 25% of the selected limit; reach the limit over 8 seconds.'},
  {id:'two-stage',name:'Two-stage',description:'Request 35% of the limit for 4 seconds, then the full limit.'},
  {id:'pulse',name:'Pulse',description:'Alternate 40% and 100% of the limit every 3 seconds.'},
];
export const pressDriveFor=(id:unknown)=>PRESS_DRIVES.find(p=>p.id===id)??PRESS_DRIVES[0];
/** Absolute simulation time, quantized to the solver clock. Pausing playback does not advance a program. */
export function pressDrivePressure(id:PressDriveId,time:number,limit:number):number {
  const t=Math.round(Math.max(0,Number.isFinite(time)?time:0)/FIXED_DT)*FIXED_DT,peak=Math.max(0,Math.min(100,Number.isFinite(limit)?limit:0));
  const fraction=id==='soft-start'?.25+.75*Math.min(1,t/8):id==='two-stage'?(t<4?.35:1):id==='pulse'?(t%6<3?.4:1):1;
  return peak*fraction;
}
/** Commands are attached to exact ticks, so worker batch size cannot change the pressure recipe. */
export function pressDriveCommands(id:PressDriveId,startTick:number,ticks:number,limit:number,controls:StudioControls):StudioCommand[] {
  if(!Number.isSafeInteger(startTick)||startTick<0||!Number.isSafeInteger(ticks)||ticks<0||ticks>64)throw new RangeError('Pressure programs support 0 to 64 commands per batch.');
  return Array.from({length:ticks},(_,i)=>({tick:startTick+i+1,type:'controls',values:{...controls,targetLoad:pressDrivePressure(id,(startTick+i+1)*FIXED_DT,limit)/20}}));
}
export interface PressDriveEnvelope {schema:'press-drive-v1';id:PressDriveId;limit:number}
/** Optional app-level schedule metadata; the full solver checkpoint is validated separately. */
export function readPressDriveEnvelope(value:unknown):PressDriveEnvelope|undefined {
  if(!value||typeof value!=='object')return;
  const p=value as Record<string,unknown>;
  if(p.schema!=='press-drive-v1'||!PRESS_DRIVES.some(d=>d.id===p.id)||typeof p.limit!=='number'||!Number.isFinite(p.limit)||p.limit<0||p.limit>100)return;
  return {schema:'press-drive-v1',id:p.id as PressDriveId,limit:p.limit};
}
