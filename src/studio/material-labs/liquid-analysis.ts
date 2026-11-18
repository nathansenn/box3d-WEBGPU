import {LABS,normalizeSettings,type LabSettings} from './catalog';
import {LIQUID_NUMBERS,liquidSettings} from './liquid-config';
import {DT,LiquidModel,type HydraulicFrame,type LabFrame} from './models';

export const PROBE_NAMES=['A','B','C'] as const;
export interface SectionCell {z:number;bed:number;depth:number;vx:number;speed:number;blocked:boolean;}
export interface SectionReading {distance:number;column:number;flow:number;cells:SectionCell[];probes:SectionCell[];}
type Grid=Pick<LiquidModel,'nx'|'nz'|'dx'|'dz'|'elevation'|'solid'>;
/** Read the recorded cell-centred field, never the current solver's evolving state. */
export function measureSection(grid:Grid,frame:LabFrame,distance:number):SectionReading {
  const column=Math.max(0,Math.min(grid.nx-1,Math.floor((Number.isFinite(distance)?distance:3)/grid.dx)));
  const cells:SectionCell[]=[];let flow=0;
  for(let row=0;row<grid.nz;row++){
    const i=row*grid.nx+column,blocked=Boolean(grid.solid[i]),depth=blocked?0:frame.positions[i],vx=blocked?0:frame.rotations[i*2],vz=blocked?0:frame.rotations[i*2+1];
    cells.push({z:(row+.5)*grid.dz-1,bed:grid.elevation[i],depth,vx,speed:Math.hypot(vx,vz),blocked});
    if(!blocked)flow+=depth*vx*grid.dz;
  }
  return {distance:(column+.5)*grid.dx,column,flow,cells,probes:[-.65,0,.65].map(z=>cells[Math.min(grid.nz-1,Math.max(0,Math.floor((z+1)/grid.dz)))])};
}
export interface AnalysisSample {time:number;metrics:[number,number,number];hydraulics:HydraulicFrame;flow:number;probes:SectionCell[];}
export function measurementSample(grid:Grid,frame:LabFrame,distance:number):AnalysisSample {
  if(!frame.hydraulics)throw new Error('This frame has no liquid measurements.');
  const section=measureSection(grid,frame,distance);
  return {time:frame.time,metrics:[...frame.metrics],hydraulics:{...frame.hydraulics},flow:section.flow,probes:section.probes};
}
export interface StudyParameter {key:keyof LabSettings;label:string;unit:string;min:number;max:number;step:number;}
export function studyParameters(p:LabSettings):StudyParameter[] {
  const rig=p.rig??'flume',keys=rig==='flume'?['size','rate','load','damping']:rig==='river'?['bankHeight','channelWidth','meander','inflow','slope','drain']:rig==='rain'?['rain','relief','slope','drain','fill','damping']:rig==='pipes'?['bore','head','valve','inflow','pipeLength','damping']:['damping','fill','relief','slope','inflow','drain'];
  const all=[...LIQUID_NUMBERS,...LABS.liquid.controls];
  return keys.filter(k=>k!=='relief'||p.terrain!=='flat').map(key=>({...all.find(c=>c.key===key)!,key:key as keyof LabSettings,...(key==='fill'&&rig!=='flume'?{label:'Initial film depth',unit:'mm'}:{})}));
}
export function suggestedValues(p:LabSettings,key:StudyParameter):number[] {
  const v=Number(p[key.key]),span=Math.max(key.step,Math.round((key.max-key.min)*.2/key.step)*key.step);
  const values=v<=key.min?[v,v+span,v+span*2]:v>=key.max?[v-span*2,v-span,v]:[Math.max(key.min,v-span),v,Math.min(key.max,v+span)];
  return values.map(n=>Number(n.toFixed(4)));
}
export function studyCases(base:LabSettings,parameter:StudyParameter,values:number[]):LabSettings[] {
  if(values.length!==3||values.some(v=>!Number.isFinite(v)||v<parameter.min||v>parameter.max))throw new Error(`Enter three values between ${parameter.min} and ${parameter.max} ${parameter.unit}.`);
  const cases=values.map(v=>normalizeSettings('liquid',{...base,[parameter.key]:v}));
  if(new Set(cases.map(p=>p[parameter.key])).size!==3)throw new Error('Use three different values to compare.');
  return cases;
}
export interface StudyPeak {depth:number;speed:number;volume:number;floodArea:number;coverage:number;balanceError:number;}
export interface StudyResult {index:number;value:number;settings:LabSettings;section:number;samples:AnalysisSample[];peak:StudyPeak;phase:string;}
export interface StudyRequest {cases:LabSettings[];key:keyof LabSettings;section:number;}
export type StudyMessage={type:'progress';index:number;time:number;duration:number}|{type:'result';result:StudyResult}|{type:'complete'}|{type:'error';message:string};
/** Bounded generator used by both the worker and numerical tests. Peaks include every solver tick. */
export function* runStudyCase(settings:LabSettings,index:number,key:keyof LabSettings,section:number):Generator<number,StudyResult> {
  const model=new LiquidModel(settings),duration=model.liquid.runSeconds,reading=measureSection(model,model.frame,section),samples=[measurementSample(model,model.frame,section)];
  const peak:StudyPeak={depth:0,speed:0,volume:0,floodArea:0,coverage:0,balanceError:0};
  const updatePeak=()=>{const f=model.frame,h=f.hydraulics!;peak.depth=Math.max(peak.depth,f.metrics[0]);peak.speed=Math.max(peak.speed,f.metrics[1]);peak.volume=Math.max(peak.volume,f.metrics[2]);peak.floodArea=Math.max(peak.floodArea,h.floodArea);peak.coverage=Math.max(peak.coverage,h.coverage);peak.balanceError=Math.max(peak.balanceError,Math.abs(h.residual));};
  updatePeak();const interval=Math.max(.1,duration/300);let nextSample=interval,nextProgress=.25;
  while(model.frame.time<duration-1e-8){
    model.step(Math.min(DT,duration-model.frame.time));updatePeak();
    if(model.frame.metrics.some(v=>!Number.isFinite(v)))throw new Error('Non-finite solver output; comparison stopped.');
    if(model.frame.time>=nextSample-1e-8){samples.push(measurementSample(model,model.frame,section));nextSample+=interval;}
    if(model.frame.time>=nextProgress){yield model.frame.time;nextProgress+=.25;}
  }
  if(samples.at(-1)!.time<model.frame.time-1e-8)samples.push(measurementSample(model,model.frame,section));
  return {index,value:Number(model.settings[key]),settings:model.settings,section:reading.distance,samples,peak,phase:model.frame.phase};
}
export function recordedSamples(grid:Grid,frames:LabFrame[],distance:number):AnalysisSample[] {
  const samples:AnalysisSample[]=[];
  for(const frame of frames){if(!frame.hydraulics)continue;const sample=measurementSample(grid,frame,distance),last=samples.at(-1);if(last&&Math.abs(last.time-frame.time)<1e-8)samples[samples.length-1]=sample;else if(!last||frame.time>last.time)samples.push(sample);}
  return samples;
}
const csvCell=(value:string|number)=>typeof value==='number'?String(value):`"${value.replace(/"/g,'""')}"`;
/** SI fields have explicit units; probe depths/velocities are empty inside solid obstacles. */
export function measurementCsv(cases:Pick<StudyResult,'index'|'settings'|'section'|'samples'>[],parameter?:StudyParameter):string {
  const headers=['case','rig','material','parameter','parameter_value','parameter_unit','program_s','cutoff_s','section_from_inlet_m','time_s','section_flow_m3_s','peak_depth_m','peak_speed_m_s','volume_m3','supply_m3_s','rain_mm_h','outlet_m3_s','supplied_m3','rain_input_m3','collected_and_overflow_m3','overflow_m3','infiltrated_m3','balance_error_m3','wet_coverage_pct','floodplain_wet_m2','supply_on',...PROBE_NAMES.flatMap(p=>[`${p}_z_m`,`${p}_bed_m`,`${p}_blocked`,`${p}_depth_m`,`${p}_speed_m_s`,`${p}_vx_m_s`]),'settings_json'];
  const rows:(string|number)[][]=[headers];
  for(const c of cases){const p=liquidSettings(c.settings);for(const s of c.samples){const h=s.hydraulics;rows.push([c.index+1,p.rig,c.settings.material,parameter?.key??'',parameter?Number(c.settings[parameter.key]):'',parameter?.unit??'',p.runSeconds,p.cutoff,c.section,s.time,s.flow,...s.metrics,h.inlet,h.rainRate,h.outlet,h.added,h.rained,h.drained,h.overflow,h.absorbed,h.residual,h.coverage,h.floodArea,Number(h.supplyOn),...s.probes.flatMap(v=>[v.z,v.bed,Number(v.blocked),v.blocked?'':v.depth,v.blocked?'':v.speed,v.blocked?'':v.vx])]);}}
  for(let row=1;row<rows.length;row++)rows[row].push(JSON.stringify(cases.find(c=>c.index+1===rows[row][0])!.settings));
  return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
