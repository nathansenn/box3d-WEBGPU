import * as T from 'three/webgpu';
import {type PressSettings} from './press-settings';

export const PRESS_FRAME_POINTS=[...[-3.85,3.85].flatMap(x=>[.1,7.95].flatMap(y=>[-3.35,3.35].map(z=>[x,y,z]))),[5.2,4.2,2],[5.2,.1,-2.5]];

/** Lower faces match toolHeight; all tools use the same keyed quick-change coupling. */
export function pressAttachment(p:PressSettings,metal:T.Material,dark:T.Material):T.Group {
  const group=new T.Group();group.name=`press-tool-${p.tool}`;
  const mesh=(g:T.BufferGeometry,x=0,y=0,z=0)=>{const m=new T.Mesh(g,metal);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
  const lathe=(points:number[][],x=0,z=0)=>mesh(new T.LatheGeometry(points.map(v=>new T.Vector2(v[0],v[1])),96),x,0,z);
  const dome=(r:number,x=0,z=0)=>{const points=Array.from({length:33},(_,i)=>{const a=i/32*Math.PI/2;return [Math.sin(a)*r,r-Math.cos(a)*r];});points.push([r,r+.08],[0,r+.08]);lathe(points,x,z);};
  if(p.tool==='round')lathe([[0,0],[.86,0],[.86,.21],[.82,.26],[0,.26]]);
  if(p.tool==='wide')mesh(new T.BoxGeometry(2.84,.27,2.24),0,.135);
  if(p.tool==='square')mesh(new T.BoxGeometry(1.6,.32,1.6),0,.16);
  if(p.tool==='ball')dome(.88);
  if(p.tool==='cone')lathe([[0,0],[.9,.855],[.9,.96],[0,.96]]);
  if(p.tool==='ring')lathe([[.51,0],[.95,0],[.95,.35],[.51,.35],[.51,0]]);
  if(p.tool==='wedge'){
    const s=new T.Shape();s.moveTo(0,0);s.lineTo(.58,.638);s.lineTo(.58,.83);s.lineTo(-.58,.83);s.lineTo(-.58,.638);s.closePath();
    const g=new T.ExtrudeGeometry(s,{depth:3.3,bevelEnabled:false,steps:1});g.translate(0,0,-1.65);mesh(g);
  }
  if(p.tool==='bead'){const g=new T.CylinderGeometry(.36,.36,3.1,64);g.rotateX(Math.PI/2);mesh(g,0,.36);}
  if(p.tool==='cross'){mesh(new T.BoxGeometry(.54,.34,2.5),0,.17);mesh(new T.BoxGeometry(2.5,.34,.54),0,.17);}
  if(p.tool==='four-point')for(const x of [-.68,.68])for(const z of [-.68,.68])dome(.3,x,z);
  // Tool backing rises away from the sheet; the ring bore remains visible from below.
  const top=p.tool==='ball'?.96:p.tool==='cone'?.96:p.tool==='wedge'?.83:p.tool==='bead'?.72:p.tool==='four-point'?.38:.35;
  mesh(new T.CylinderGeometry(.5,.65,.16,48),0,top+.08);
  mesh(new T.CylinderGeometry(.3,.3,1.3-top,48),0,(1.3+top)/2+.16);
  const collar=new T.Mesh(new T.CylinderGeometry(.5,.5,.12,48),dark);collar.position.y=1.4;collar.castShadow=true;group.add(collar);
  group.scale.setScalar(p.toolScale);group.rotation.y=p.angle*Math.PI/180;
  return group;
}

/** A closed deforming shell: front, back and only the exposed edges of surviving triangles. */
export function updatePlateShell(g:T.BufferGeometry,positions:Float32Array,triangles:ArrayLike<number>,thickness:number,boundary?:ArrayLike<number>,triangleCount=triangles.length):void {
  const values=g.getAttribute('position'),uv=g.getAttribute('uv');let count=0;
  const edges=new Map<string,{a:number;b:number;uses:number}>();
  const vertex=(n:number,offset:number)=>{values.setXYZ(count,positions[n*3],positions[n*3+1]+offset,positions[n*3+2]);uv.setXY(count,(positions[n*3]+2.6)/5.2,(positions[n*3+2]+2.2)/4.4);count++;};
  for(let i=0;i<triangleCount;i+=3){
    const a=triangles[i],b=triangles[i+1],c=triangles[i+2];
    // Top skin is the existing surface. This mesh supplies the underside and cut walls.
    vertex(c,-thickness/2);vertex(b,-thickness/2);vertex(a,-thickness/2);
    if(!boundary)for(let j=0;j<3;j++){const x=triangles[i+j],y=triangles[i+(j+1)%3],key=x<y?`${x}:${y}`:`${y}:${x}`;const e=edges.get(key);if(e)e.uses++;else edges.set(key,{a:x,b:y,uses:1});}
  }
  const wall=(a:number,b:number)=>{vertex(a,thickness/2);vertex(a,-thickness/2);vertex(b,thickness/2);vertex(b,thickness/2);vertex(a,-thickness/2);vertex(b,-thickness/2);};
  if(boundary){for(let i=0;i<boundary.length;i+=2)wall(boundary[i],boundary[i+1]);}
  else for(const {a,b,uses} of edges.values())if(uses===1)wall(a,b);
  g.setDrawRange(0,count);values.needsUpdate=true;uv.needsUpdate=true;
  // Recompute just the live triangles. Unused capacity may include an incomplete
  // triangle and must never enter normal generation after topology shrinks.
  if(!g.getAttribute('normal'))g.setAttribute('normal',new T.BufferAttribute(new Float32Array(values.count*3),3).setUsage(T.DynamicDrawUsage));
  const normal=g.getAttribute('normal');
  for(let i=0;i<count;i+=3){
    const ax=values.getX(i)-values.getX(i+1),ay=values.getY(i)-values.getY(i+1),az=values.getZ(i)-values.getZ(i+1);
    const cx=values.getX(i+2)-values.getX(i+1),cy=values.getY(i+2)-values.getY(i+1),cz=values.getZ(i+2)-values.getZ(i+1);
    const nx=cy*az-cz*ay,ny=cz*ax-cx*az,nz=cx*ay-cy*ax,length=Math.hypot(nx,ny,nz)||1;
    for(let j=0;j<3;j++)normal.setXYZ(i+j,nx/length,ny/length,nz/length);
  }
  normal.needsUpdate=true;
}
