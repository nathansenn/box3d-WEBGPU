import {materialFor,normalizeSettings,type LabId,type LabSettings,type MaterialProfile} from './catalog';
export type V3=[number,number,number];
export interface Piece {center:V3;vertices:V3[];radius:number;}
export interface HydraulicFrame {inlet:number;rainRate:number;outlet:number;added:number;rained:number;drained:number;absorbed:number;residual:number;wetArea:number;meanFilm:number;head:number;reynolds:number;supplyOn:boolean;floodArea:number;coverage:number;meanSpeed:number;overflow:number;overflowRate:number;}
export interface LabFrame {hydraulics?:HydraulicFrame;cracks?:Uint8Array;
  /** Concrete lab: the recorded stress-strain curve, [strain %, stress MPa] pairs. */
  curve?:Float32Array;status?:string;time:number;positions:Float32Array;rotations:Float32Array;damage:Uint8Array;actuator:number;phase:string;metrics:[number,number,number];collisions?:{impacts:number;contacts:number;sweptContacts:number;unresolvedSweeps:number};}
export const DT=1/120;
export function random(seed:number):()=>number {let v=seed>>>0;return()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
export const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export const copyFrame=(f:LabFrame):LabFrame=>({...f,positions:f.positions.slice(),rotations:f.rotations.slice(),damage:f.damage.slice(),metrics:[...f.metrics],...(f.cracks?{cracks:f.cracks.slice()}:{}),...(f.curve?{curve:f.curve.slice()}:{}),...(f.hydraulics?{hydraulics:{...f.hydraulics}}:{}),...(f.collisions?{collisions:{...f.collisions}}:{})});
export abstract class LabModel {
  readonly id:LabId;
  readonly settings:LabSettings;readonly material:MaterialProfile;readonly pieces:Piece[]=[];
  frame:LabFrame={time:0,positions:new Float32Array(),rotations:new Float32Array(),damage:new Uint8Array(),actuator:0,phase:'Ready',metrics:[0,0,0]};
  released=false;
  constructor(id:LabId,p:Partial<LabSettings>){this.id=id;this.settings=normalizeSettings(id,p);this.material=materialFor(id,this.settings.material);}
  abstract step(dt?:number):void;
  release():void {this.released=true;}
  snapshot():LabFrame {return copyFrame(this.frame);}
  protected allocate(n:number):void {this.frame.positions=new Float32Array(n*3);this.frame.rotations=new Float32Array(n*3);this.frame.damage=new Uint8Array(n);}
}

