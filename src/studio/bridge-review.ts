import type { FailureSimulation, FailureEvent, Snapshot, Vec } from './physics';

// The bridge study runs on the SI suspension model (si-bridge-study.ts). Its snapshots keep the drawn particles and links;
// the readings here are in SI: drop and lateral movement in mm, hanger tension in kN, crowd in kN/m^2, wind in kN/m.
export type BridgeModel = Pick<FailureSimulation, 'nodes' | 'links' | 'backend'>;
/** The SI model's members: hangers fail; main cables, backstays and girders are reported, they do not break. */
export const BRIDGE_GROUPS = [
  ['hanger', 'Hangers', 70], ['cable', 'Main cable segments', 72], ['backstay', 'Backstays', 4], ['deck', 'Girder panels', 72],
] as const;
export const BRIDGE_HANGERS = 70;
/** `strength` is the number of hangers cut on the upstream cable (0 to 6); target is the crowd in kN/m^2, wind in kN/m. */
export interface BridgeControls { target:number; strength:number; wind:number; program:string; speed:number }
/** One recorded sample: crowd kN/m^2, largest deck drop and sideways movement in mm, hangers failed, largest hanger tension kN. */
export interface BridgePoint { time:number; load:number; drop:number; lateral:number; broken:number; hanger:number }
export interface BridgeMilestone { key:string; label:string; time:number; index:number; sampleTime?:number; detail:string }
export interface BridgeBaseline {
  format:'box3d-bridge-baseline'; version:2; name:string; savedAt:string; model:string;
  settings:BridgeControls; changes:{time:number;target:number;strength:number;wind:number;program:string}[];
  points:BridgePoint[]; historyComplete:boolean;
}
export const BRIDGE_BASELINE_KEY = 'box3d.bridge.baseline.v2';
const clampZone=(n:number)=>Math.max(0,Math.min(5,n));
export const bridgeZone=(x:number)=>clampZone(Math.floor((x+21)/7));
export const bridgeZoneLabel=(zone:number)=>`${['West approach','West span','West midspan','East midspan','East span','East approach'][zone]} · ${zone+1}`;

/** Fingerprint canonical topology, authored coefficients and backend, never the broken mask. */
export function bridgeModelKey(model:BridgeModel):string {
  const source=JSON.stringify([model.backend,model.nodes.map(n=>[...n.rest,n.inverseMass]),model.links.map(l=>[l.a,l.b,l.kind,l.original,l.stiffness,l.threshold])]);
  let hash=2166136261;for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
  return `bridge-review-v1:${model.backend}:${(hash>>>0).toString(16)}`;
}
export function bridgePoint(model:BridgeModel,snapshot:Snapshot):BridgePoint {
  const si=snapshot.si;
  if(si)return {time:snapshot.response.time,load:snapshot.response.load,drop:si.drop,lateral:si.lateral,broken:si.hangersFailed,hanger:si.maxHanger};
  let lateral=0;
  for(let i=0;i<model.nodes.length;i++)if(i%4<2)lateral=Math.max(lateral,Math.abs(snapshot.positions[i*3+2]-model.nodes[i].rest[2]));
  return {time:snapshot.response.time,load:snapshot.response.load,drop:snapshot.response.deflection*1e3,lateral:lateral*1e3,broken:snapshot.broken.reduce((a,b)=>a+Number(b!==0),0),hanger:0};
}
/** A hanger link of the drawing that is an SI hanger (the tower stations have none). */
const isHanger=(model:BridgeModel,index:number)=>{const link=model.links[index],station=Math.floor(link.a/4);return link.kind==='hanger'&&station>0&&station<36;};
export function bridgeInspection(model:BridgeModel,snapshot:Snapshot,selected:number|null) {
  const zones=Array.from({length:6},(_,index)=>({index,total:0,broken:0,drop:0,hanger:0}));
  const groups=BRIDGE_GROUPS.map(([kind,label,total])=>({kind,label,total:total as number,broken:0,peak:0}));
  const hangers=snapshot.si?.hangers;
  model.links.forEach((link,index)=>{
    if(!isHanger(model,index))return;
    const station=Math.floor(link.a/4),side=link.a%4,zone=bridgeZone(model.nodes[link.a].rest[0]),broken=Number(snapshot.broken[index]!==0),tension=hangers?hangers[side*35+station-1]:0;
    zones[zone].total++;zones[zone].broken+=broken;zones[zone].hanger=Math.max(zones[zone].hanger,tension);
    if(selected===null||zone===selected){groups[0].broken+=broken;groups[0].peak=Math.max(groups[0].peak,tension);}
  });
  if(selected!==null)groups[0].total=zones[selected].total;
  if(snapshot.si){groups[1].peak=snapshot.si.maxMain;groups[3].peak=snapshot.si.girderStress;}
  model.nodes.forEach((n,index)=>{if(index%4<2){const zone=zones[bridgeZone(n.rest[0])];zone.drop=Math.max(zone.drop,(n.rest[1]-snapshot.positions[index*3+1])*1e3);}});
  return {zones,groups,point:bridgePoint(model,snapshot)};
}
export function bridgeZoneTarget(model:BridgeModel,snapshot:Snapshot,zone:number):Vec {
  const indices=model.nodes.flatMap((n,i)=>i%4<2&&bridgeZone(n.rest[0])===zone?[i]:[]);
  const p:Vec=[0,0,0];for(const i of indices)for(let axis=0;axis<3;axis++)p[axis]+=snapshot.positions[i*3+axis]/indices.length;
  return p;
}
/** A milestone must resolve to a real nearby sample, not across an evicted history gap. */
export function bridgeSampleIndex(points:readonly BridgePoint[],time:number,after=false):number {
  let index=-1,distance=.111;
  points.forEach((p,i)=>{const d=Math.abs(p.time-time);if((!after||p.time>=time-1e-7)&&d<distance){index=i;distance=d;}});
  return index;
}
export function bridgeMilestones(points:readonly BridgePoint[],events:readonly FailureEvent[],historyComplete:boolean):BridgeMilestone[] {
  if(!points.length)return [];
  const first=events.find(e=>e.type==='break'),peak=points.reduce((a,b)=>b.drop>a.drop?b:a),last=points.at(-1)!;
  const make=(key:string,label:string,time:number,detail:string,after=false):BridgeMilestone=>{
    const index=bridgeSampleIndex(points,time,after);return {key,label,time,index,sampleTime:points[index]?.time,detail};
  };
  const results:BridgeMilestone[]=[];
  if(first){
    const before=points.filter(p=>p.time<first.time-1e-7&&first.time-p.time<=.111&&p.broken===0).at(-1);
    if(before)results.push(make('before','Before rupture',before.time,'Last intact recorded sample'));
    results.push(make('first','First rupture',first.time,first.message,true));
  }else if(!historyComplete&&points[0].broken>0)results.push({...make('unknown','First rupture',points[0].time,'Occurred before imported history'),index:-1,sampleTime:undefined});
  results.push(make('peak','Largest recorded drop',peak.time,`${peak.drop.toFixed(1)} mm${historyComplete?'':' · retained history'}`));
  results.push(make('latest','Latest sample',last.time,`${last.broken} of ${BRIDGE_HANGERS} hangers failed`));
  return results;
}
export function bridgeComparison(points:readonly BridgePoint[],time:number):BridgePoint|undefined {
  // Do not extrapolate beyond the saved run, including the initial-to-recent gap.
  if(!points.length||time<points[0].time-1e-7||time>points.at(-1)!.time+1e-7)return;
  const index=bridgeSampleIndex(points,time);return index<0?undefined:points[index];
}
const finite=(value:unknown,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
/** Hangers cut: an integer from 0 to 6. */
export const cuts=(value:unknown)=>finite(value,0,6)&&Number.isInteger(value);
export function parseBridgeBaseline(raw:string|null,model:string):BridgeBaseline|undefined {
  if(!raw||raw.length>500_000)return;
  try{
    const b=JSON.parse(raw) as BridgeBaseline,s=b.settings;
    if(b.format!=='box3d-bridge-baseline'||b.version!==2||b.model!==model||typeof b.name!=='string'||b.name.length>60||!b.name.trim()||typeof b.savedAt!=='string'||!Number.isFinite(Date.parse(b.savedAt))||typeof b.historyComplete!=='boolean')return;
    if(!s||!finite(s.target,0,5)||!cuts(s.strength)||!finite(s.wind,0,2)||![.25,.5,1,2].includes(s.speed)||!['failure','service'].includes(s.program))return;
    if(!Array.isArray(b.points)||b.points.length<2||b.points.length>1202)return;
    let previous=-1;for(const p of b.points){if(!p||!finite(p.time,0,1e9)||p.time<=previous||!finite(p.load,0,10)||!finite(p.drop,0,1e6)||!finite(p.lateral,0,1e6)||!finite(p.hanger,0,1e5)||!Number.isInteger(p.broken)||p.broken<0||p.broken>BRIDGE_HANGERS)return;previous=p.time;}
    if(!Array.isArray(b.changes)||b.changes.length>2000)return;
    previous=-1;for(const c of b.changes){if(!c||!finite(c.time,0,1e9)||c.time<previous||!finite(c.target,0,5)||!cuts(c.strength)||!finite(c.wind,0,2)||!['failure','service'].includes(c.program))return;previous=c.time;}
    return b;
  }catch{return;}
}

/** Pauses on the first returned batch with a broken connection, never re-arms on resume. */
export const shouldPauseBridge=(enabled:boolean,before:Snapshot,after:Snapshot)=>enabled&&before.response.broken===0&&after.response.broken>0;
