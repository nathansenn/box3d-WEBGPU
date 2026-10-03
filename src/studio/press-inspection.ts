import {metalFor,type PressSettings} from './press-settings';
import type {FailureSimulation,Snapshot} from './physics';
import {pressDrivePressure,type PressDriveId} from './press-program';

export type SectionAxis='x'|'z';
export interface PressDriveEvent {time:number;press?:{pressure:number};pressDrive?:PressDriveId}
export function pressDriveAt(time:number,history:readonly PressDriveEvent[],initialDrive:PressDriveId='steady'):PressDriveId {
  for(let i=history.length-1;i>=0;i--)if(history[i].time<=time&&history[i].press)return history[i].pressDrive??'steady';
  return initialDrive;
}
/** Recorded requested pressure, distinct from the solver's ramped drive level. */
export function pressPressureAt(time:number,initial:number,history:readonly PressDriveEvent[],initialDrive:PressDriveId='steady'):number {
  for(let i=history.length-1;i>=0;i--)if(history[i].time<=time&&history[i].press)return pressDrivePressure(history[i].pressDrive??'steady',time,history[i].press!.pressure);
  return pressDrivePressure(initialDrive,time,initial);
}
export function pressStrainHue(strain:number,p:PressSettings,strength=1):number {
  const m=metalFor(p.metal),yieldAt=m.yield*strength,rupture=m.rupture*strength;
  // Use the material's nominal in-plane thresholds. Shear/bending links have their own multipliers.
  return strain<=yieldAt?.52-.14*Math.max(0,strain)/yieldAt:
    .38*(1-Math.min(1,(strain-yieldAt)/(rupture-yieldAt)));
}
export function sheetRimEdge(a:number,b:number,cols:number,rows:number):boolean {
  return (a<cols&&b<cols)||(a>=(rows-1)*cols&&b>=(rows-1)*cols)||
    (a%cols===0&&b%cols===0)||(a%cols===cols-1&&b%cols===cols-1);
}
export interface PressSection {points:{node:number;position:number;displacement:number;connected:boolean}[];span:number;gaps:number;offset:number;limit:number;index:number;slices:number}
/** Plans use immutable connectivity; values always come from the displayed snapshot, including replay. */
export class PressSectionSampler {
  private plans:Record<SectionAxis,{node:number;faces:number[][]}[][]>;
  private sim:FailureSimulation;
  constructor(sim:FailureSimulation){
    this.sim=sim;
    const {cols,rows}=sim.config;
    const edgeFaces=new Map<string,number[][]>(),key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
    for(const face of sim.faces)for(let i=0;i<3;i++){
      const k=key(face.nodes[i],face.nodes[(i+1)%3]),faces=edgeFaces.get(k)??[];faces.push(face.links);edgeFaces.set(k,faces);
    }
    const make=(axis:SectionAxis)=>Array.from({length:axis==='x'?rows:cols},(_,slice)=>{
      const ids=Array.from({length:axis==='x'?cols:rows},(_,i)=>axis==='x'?slice*cols+i:i*cols+slice);
      return ids.map((node,i)=>({node,faces:i===0?[]:edgeFaces.get(key(node,ids[i-1]))??[]}));
    });
    this.plans={x:make('x'),z:make('z')};
  }
  sample(s:Snapshot,axis:SectionAxis,offset=0):PressSection {
    let gaps=0;const dimension=axis==='x'?0:2,slices=this.plans[axis].length;
    const limit=(axis==='x'?this.sim.config.depth:this.sim.config.span)*50;
    const index=Math.round((Math.max(-limit,Math.min(limit,Number.isFinite(offset)?offset:0))/limit+1)*(slices-1)/2);
    const plan=this.plans[axis][index],actualOffset=this.sim.nodes[plan[0].node].rest[axis==='x'?2:0]*100;
    const points=plan.map(({node,faces},i)=>{
      const connected=i>0&&faces.some(links=>links.every(e=>e<0||s.broken[e]===0));
      if(i>0&&!connected)gaps++;
      return {node,position:this.sim.nodes[node].rest[dimension]*100,displacement:(s.positions[node*3+1]-this.sim.nodes[node].rest[1])*100,connected};
    });
    return {points,span:(axis==='x'?this.sim.config.span:this.sim.config.depth)*100,gaps,offset:actualOffset,limit,index,slices};
  }
}
export function pressInspectionValues(s:Snapshot){
  return {stage:s.response.broken>0?'Cracking':s.response.plastic>0?'Permanent set':s.response.time===0?'Ready':'Elastic',
    deflection:s.response.deflection*100,plastic:s.response.plastic*100,strain:s.response.strain*100,broken:s.response.broken};
}
