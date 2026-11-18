import * as T from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The same recorded station frame drives boards, steelwork, posts and rail ends. */
export class DeckFrameStorage {
  readonly frames:T.Matrix4[];
  readonly a=new T.Vector3();readonly b=new T.Vector3();readonly x=new T.Vector3();readonly y=new T.Vector3();readonly z=new T.Vector3();
  constructor(cols:number){this.frames=Array.from({length:cols},()=>new T.Matrix4());}
}
export function bridgeDeckFrames(positions:ArrayLike<number>,cols:number,storage=new DeckFrameStorage(cols)):T.Matrix4[] {
  const {a,b,x,y,z,frames}=storage;
  if(frames.length!==cols)throw new RangeError('Deck frame storage does not match station count');
  for(let i=0;i<cols;i++){
    a.fromArray(positions,i*12);b.fromArray(positions,i*12+3);z.copy(b).sub(a).normalize();
    x.fromArray(positions,Math.min(i+1,cols-1)*12);y.fromArray(positions,Math.max(0,i-1)*12);x.sub(y).normalize();
    y.crossVectors(z,x).normalize();x.crossVectors(y,z).normalize();
    frames[i].makeBasis(x,y,z).setPosition(a.add(b).multiplyScalar(.5));
  }
  return frames;
}

export function bridgeRailPoint(positions:ArrayLike<number>,station:number,side:number,height:number,frame:T.Matrix4,target:[number,number,number]=[0,0,0]):[number,number,number] {
  const p=(station*4+side)*3,e=frame.elements;
  target[0]=positions[p]+e[4]*height;target[1]=positions[p+1]+e[5]*height;target[2]=positions[p+2]+e[6]*height;return target;
}

/** Local steelwork moves with each recorded deck station, including after failure. */
export function deckSupportGeometry(station:number,depth:number):T.BufferGeometry {
  const parts:T.BufferGeometry[]=[];
  const box=(w:number,h:number,d:number,x:number,y:number,z:number)=>parts.push(new T.BoxGeometry(w,h,d).translate(x,y,z));
  for(const side of [-1,1]){
    const z=side*depth/2;
    // Shallow edge I girder, with visible web and two flanges.
    for(const y of [-.1025,-.43])box(station-.014,.045,.25,0,y,z);
    box(station-.014,.32,.035,0,-.27,z);
    for(const dx of [-.07,.07])box(.045,.46,.18,dx,-.02,z);
    const pin=new T.CylinderGeometry(.045,.045,.23,8);pin.rotateZ(Math.PI/2);pin.translate(0,.12,z);parts.push(pin);
    for(const y of [-.19,-.34])box(.055,.045,.31,0,y,z);
  }
  box(.14,.2,depth+.24,0,-.49,0);
  for(const z of [-.65,.65])box(station-.016,.2,.075,0,-.18,z);
  const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());return g;
}
