import {LABS,materialFor,normalizeSettings,type LabId,type LabSettings,type MaterialProfile} from './catalog';
export type V3=[number,number,number];
export interface Piece {center:V3;vertices:V3[];radius:number;}
export interface LabFrame {time:number;positions:Float32Array;rotations:Float32Array;damage:Uint8Array;actuator:number;phase:string;metrics:[number,number,number];}
export const DT=1/120;
export function random(seed:number):()=>number {let v=seed>>>0;return()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
export const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export const copyFrame=(f:LabFrame):LabFrame=>({...f,positions:f.positions.slice(),rotations:f.rotations.slice(),damage:f.damage.slice(),metrics:[...f.metrics]});
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

/** Closed, flat-bed finite-volume shallow water. Every face exchanges equal mass. */
export class LiquidModel extends LabModel {
  readonly nx=56;readonly nz=20;readonly width=6;readonly depth=2;
  readonly h=new Float64Array(this.nx*this.nz);readonly qx=new Float64Array(this.h.length);readonly qz=new Float64Array(this.h.length);
  readonly solid=new Uint8Array(this.h.length);readonly delta=new Float64Array(this.h.length*3);
  readonly dx=this.width/this.nx;readonly dz=this.depth/this.nz;readonly gateColumn=18;
  readonly initialVolume:number;
  constructor(p:Partial<LabSettings>={}){
    super('liquid',p);this.frame.positions=new Float32Array(this.h.length);this.frame.rotations=new Float32Array(this.h.length*2);
    for(let z=0;z<this.nz;z++)for(let x=0;x<this.nx;x++){
      const i=z*this.nx+x,px=(x+.5)*this.dx-3,pz=(z+.5)*this.dz-1;
      this.solid[i]=Number(Math.hypot(px-1.25,pz-.48)<.2||Math.hypot(px-2,pz+.42)<.2);
      this.h[i]=this.solid[i]?0:x<this.gateColumn?this.settings.size:.008+this.settings.fill/100*.6;
      if(this.settings.mode==='pulse'&&!this.solid[i])this.h[i]=this.settings.size*.65+.08*Math.cos(px*Math.PI/3);
    }
    this.initialVolume=this.volume();if(this.settings.mode==='pulse')this.frame.actuator=1.1;this.sync();
  }
  volume():number {let total=0;for(const h of this.h)total+=h;return total*this.dx*this.dz;}
  private face(a:number,b:number,axis:0|1,dt:number,gate:number):void {
    const n=this.h.length,da=axis===0?this.dx:this.dz,g=9.81;
    const va=a>=0&&!this.solid[a],vb=b>=0&&!this.solid[b];if(!va&&!vb)return;
    const ha=va?this.h[a]:this.h[b],hb=vb?this.h[b]:this.h[a];
    const na=va?(axis===0?this.qx[a]:this.qz[a]):-(axis===0?this.qx[b]:this.qz[b]);
    const nb=vb?(axis===0?this.qx[b]:this.qz[b]):-(axis===0?this.qx[a]:this.qz[a]);
    const ta=va?(axis===0?this.qz[a]:this.qx[a]):(axis===0?this.qz[b]:this.qx[b]);
    const tb=vb?(axis===0?this.qz[b]:this.qx[b]):(axis===0?this.qz[a]:this.qx[a]);
    const ua=ha>1e-7?na/ha:0,ub=hb>1e-7?nb/hb:0;
    const c=Math.max(Math.abs(ua)+Math.sqrt(g*ha),Math.abs(ub)+Math.sqrt(g*hb));
    const fh=(na+nb-c*(hb-ha))*.5,fn=(na*ua+nb*ub+g*(ha*ha+hb*hb)*.5-c*(nb-na))*.5;
    const ft=(ta*ua+tb*ub-c*(tb-ta))*.5,k=dt/da;
    if(va){this.delta[a]-=k*fh*gate;this.delta[a+n*(axis+1)]-=k*(fn*gate+(1-gate)*g*ha*ha*.5);this.delta[a+n*(2-axis)]-=k*ft*gate;}
    if(vb){this.delta[b]+=k*fh*gate;this.delta[b+n*(axis+1)]+=k*(fn*gate+(1-gate)*g*hb*hb*.5);this.delta[b+n*(2-axis)]+=k*ft*gate;}
  }
  step(dt=DT):void {
    let left=dt;
    while(left>1e-9){
      let speed=.1;for(let i=0;i<this.h.length;i++)if(this.h[i]>1e-7)speed=Math.max(speed,Math.hypot(this.qx[i],this.qz[i])/this.h[i]+Math.sqrt(9.81*this.h[i]));
      const sub=Math.min(left,.22*Math.min(this.dx,this.dz)/speed),gate=this.released||this.settings.mode==='pulse'?1:clamp(this.frame.time*this.settings.rate/1.1,0,this.settings.load/100);
      this.delta.fill(0);
      for(let z=0;z<this.nz;z++)for(let x=0;x<=this.nx;x++)this.face(x?z*this.nx+x-1:-1,x<this.nx?z*this.nx+x:-1,0,sub,x===this.gateColumn&&this.settings.mode!=='pulse'?gate:1);
      for(let z=0;z<=this.nz;z++)for(let x=0;x<this.nx;x++)this.face(z?(z-1)*this.nx+x:-1,z<this.nz?z*this.nx+x:-1,1,sub,1);
      const damp=Math.exp(-sub*(.06+this.material.viscosity*this.settings.damping*3));
      for(let i=0;i<this.h.length;i++)if(!this.solid[i]){
        this.h[i]=Math.max(0,this.h[i]+this.delta[i]);
        this.qx[i]=(this.qx[i]+this.delta[i+this.h.length])*damp;
        this.qz[i]=(this.qz[i]+this.delta[i+this.h.length*2])*damp;
        if(this.h[i]<1e-7)this.qx[i]=this.qz[i]=0;
      }
      this.frame.time+=sub;left-=sub;this.frame.actuator=gate*1.1;
    }
    this.sync();
  }
  private sync():void {
    let peak=0,velocity=0;
    for(let i=0;i<this.h.length;i++){const h=this.h[i];this.frame.positions[i]=h;this.frame.rotations[i*2]=h>1e-6?this.qx[i]/h:0;this.frame.rotations[i*2+1]=h>1e-6?this.qz[i]/h:0;peak=Math.max(peak,h);velocity=Math.max(velocity,Math.hypot(this.frame.rotations[i*2],this.frame.rotations[i*2+1]));}
    this.frame.phase=this.frame.time===0?'Ready':velocity<.025&&this.frame.time>5?'Settling':this.frame.actuator<.3?'Gate lifting':'Flowing';
    this.frame.metrics=[peak,velocity,this.volume()];
  }
}

export class GlassModel extends LabModel {
  private velocity:Float64Array;private spin:Float64Array;
  private angle:number;private angularVelocity=0;private impactAt=-1;private severity=0;private hitCount=0;
  readonly impactX:number;readonly panelWidth=2.6;readonly panelHeight=2;readonly panelCenterY=2.45;
  constructor(p:Partial<LabSettings>={}){
    super('glass',p);this.impactX=this.settings.fill/100;const rng=random(this.settings.seed),fine=this.material.id==='tempered';
    const count=fine?42:24,rings=fine?12:7,angles=Array.from({length:count},(_,i)=>i/count*Math.PI*2+.025*(rng()-.5));
    for(const x of [-1.3,1.3])for(const y of [-1,1])angles.push((Math.atan2(y,x-this.impactX)+Math.PI*2)%(Math.PI*2));angles.sort((a,b)=>a-b);
    const points:V3[][]=[angles.map(()=>[this.impactX,0,0])];
    for(let r=1;r<=rings;r++)points.push(angles.map(a=>{const dx=Math.cos(a),dy=Math.sin(a),edge=Math.min((dx>0?1.3-this.impactX:1.3+this.impactX)/(Math.abs(dx)||1e-8),1/(Math.abs(dy)||1e-8)),f=r/rings;return [this.impactX+dx*edge*f,dy*edge*f,0];}));
    const add=(v:V3[])=>{const center:V3=[v.reduce((s,p)=>s+p[0],0)/3,v.reduce((s,p)=>s+p[1],0)/3+this.panelCenterY,0];this.pieces.push({center,vertices:v.map(p=>[p[0]-center[0],p[1]+this.panelCenterY-center[1],0]),radius:Math.max(...v.map(p=>Math.hypot(p[0]-center[0],p[1]+this.panelCenterY-center[1])))});};
    for(let r=1;r<=rings;r++)for(let i=0;i<angles.length;i++){const j=(i+1)%angles.length;add([points[r-1][i],points[r][i],points[r][j]]);if(r>1)add([points[r-1][i],points[r][j],points[r-1][j]]);}
    this.allocate(this.pieces.length);this.velocity=new Float64Array(this.pieces.length*3);this.spin=new Float64Array(this.pieces.length*3);
    this.pieces.forEach((p,i)=>{this.frame.positions.set(p.center,i*3);this.spin.set([(rng()-.5)*3,(rng()-.5)*3,(rng()-.5)*3],i*3);});
    this.angle=Math.acos(1-this.settings.rate/1.9);this.frame.actuator=this.angle;this.frame.metrics=[this.settings.load*9.81*this.settings.rate,0,0];
  }
  step(dt=DT):void {
    const f=this.frame;f.time+=dt;
    this.angularVelocity+=(-9.81/1.9*Math.sin(this.angle)-.08*this.angularVelocity)*dt;
    const previous=this.angle;this.angle+=this.angularVelocity*dt;
    if(previous>0&&this.angle<=0&&this.hitCount===0){
      this.hitCount++;this.impactAt=f.time;
      const energy=.5*this.settings.load*Math.pow(this.angularVelocity*1.9,2);
      this.severity=energy/(190*this.material.strength*Math.pow(this.settings.size/8,2)*this.settings.damping);
      this.angularVelocity=-this.angularVelocity*.27;this.angle=.015;
    }
    let broken=0,maxTravel=0;
    const age=this.impactAt<0?-1:f.time-this.impactAt;
    for(let i=0;i<this.pieces.length;i++){
      const p=this.pieces[i],k=i*3,d=Math.hypot(p.center[0]-this.impactX,p.center[1]-this.panelCenterY),reach=age*5;
      if(!f.damage[i]&&this.severity>1&&age>=0&&d<reach&&d<(this.severity-1)*1.15+.18){
        f.damage[i]=1;this.velocity[k]=(p.center[0]-this.impactX)*.38;this.velocity[k+1]=(p.center[1]-this.panelCenterY)*.25;this.velocity[k+2]=-(.2+Math.max(0,1-d)*Math.min(2,this.severity*.25));
      }
      if(f.damage[i]){
        broken++;const held=this.material.retention;
        for(let a=0;a<3;a++){
          this.velocity[k+a]+=((a===1?-9.81:0)+(held?(p.center[a]-f.positions[k+a])*held*105:0))*dt;
          this.velocity[k+a]*=Math.exp(-dt*(held?7:.15));f.positions[k+a]+=this.velocity[k+a]*dt;
          f.rotations[k+a]+=held?(this.spin[k+a]*Math.exp(-Math.max(0,age)*4)*.03-f.rotations[k+a]*4)*dt:this.spin[k+a]*dt;
        }
        // Use the rotated shard's lower surface for tray contact, then dissipate its tilt.
        const bottom=()=>{const rx=f.rotations[k],ry=f.rotations[k+1],rz=f.rotations[k+2],a=Math.cos(rx),b=Math.sin(rx),d=Math.sin(ry),e=Math.cos(rz),s=Math.sin(rz),yx=a*s+b*e*d,yy=a*e-b*s*d,yz=-b*Math.cos(ry);return Math.min(...p.vertices.map(v=>yx*v[0]+yy*v[1]))-Math.abs(yz)*this.settings.size/2000;};
        if(f.positions[k+1]+bottom()<.7){
          f.rotations[k]+=(Math.PI/2-f.rotations[k])*Math.min(1,dt*7);f.rotations[k+1]*=Math.exp(-dt*7);f.positions[k+1]=.7-bottom();
          this.velocity[k+1]=Math.abs(this.velocity[k+1])*.1;this.velocity[k]*=.9;this.velocity[k+2]*=.9;this.spin[k]*=.9;this.spin[k+1]*=.9;this.spin[k+2]*=.9;
        }
        f.positions[k]=clamp(f.positions[k],-1.55,1.55);f.positions[k+2]=clamp(f.positions[k+2],-.72,.72);
      }else if(age>=0){f.positions[k+2]=-.04*Math.min(1,this.severity)*Math.exp(-age*2)*Math.sin(age*13)*Math.max(0,1-d);}
      const rx=f.rotations[k],ry=f.rotations[k+1],rz=f.rotations[k+2],zx=Math.sin(rx)*Math.sin(rz)-Math.cos(rx)*Math.cos(rz)*Math.sin(ry),zy=Math.sin(rx)*Math.cos(rz)+Math.cos(rx)*Math.sin(rz)*Math.sin(ry);
      for(const v of p.vertices)maxTravel=Math.max(maxTravel,Math.abs(f.positions[k+2]+zx*v[0]+zy*v[1]));
    }
    f.actuator=this.angle;f.phase=this.impactAt<0?'Pendulum falling':broken?(this.material.retention?'Fractured · retained':'Fractured · releasing'):'Impact absorbed';
    f.metrics=[this.settings.load*9.81*this.settings.rate,broken/this.pieces.length*100,maxTravel*1000];
  }
}

interface Bond {a:number;b:number;rest:number;broken:boolean;strain:number;}
export class ConcreteModel extends LabModel {
  readonly bonds:Bond[]=[];readonly edge:number;private velocity:Float64Array;private old:Float64Array;
  private heights:Float64Array;private lowerExtents:Float64Array;private strain=0;
  constructor(p:Partial<LabSettings>={}){
    super('concrete',p);this.edge=1.3*this.settings.size;const n=5,cell=this.edge/n,rng=random(this.settings.seed);
    const point=(x:number,y:number,z:number):V3=>[-this.edge/2+x*cell,.95+y*cell,-this.edge/2+z*cell];
    const corners:V3[]=[];for(let z=0;z<=n;z++)for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){const v=point(x,y,z);if(x>0&&x<n)v[0]+=(rng()-.5)*cell*.3;if(y>0&&y<n)v[1]+=(rng()-.5)*cell*.3;if(z>0&&z<n)v[2]+=(rng()-.5)*cell*.3;corners.push(v);}
    const at=(x:number,y:number,z:number)=>corners[(z*(n+1)+y)*(n+1)+x];
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const verts=[at(x,y,z),at(x+1,y,z),at(x+1,y+1,z),at(x,y+1,z),at(x,y,z+1),at(x+1,y,z+1),at(x+1,y+1,z+1),at(x,y+1,z+1)];
      const center:V3=[0,0,0];for(const v of verts)for(let a=0;a<3;a++)center[a]+=v[a]/8;
      this.pieces.push({center,vertices:verts.map(v=>[v[0]-center[0],v[1]-center[1],v[2]-center[2]]),radius:cell*.5});
    }
    this.allocate(this.pieces.length);this.velocity=new Float64Array(this.pieces.length*3);this.old=new Float64Array(this.velocity.length);this.heights=new Float64Array(this.pieces.length);this.lowerExtents=new Float64Array(this.pieces.length);
    this.pieces.forEach((p,i)=>{this.frame.positions.set(p.center,i*3);this.heights[i]=Math.max(...p.vertices.map(v=>v[1]));this.lowerExtents[i]=-Math.min(...p.vertices.map(v=>v[1]));});
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const a=(z*n+y)*n+x;
      for(const [ox,oy,oz] of [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1]])if(x+ox>=0&&x+ox<n&&y+oy<n&&z+oz>=0&&z+oz<n){const b=((z+oz)*n+y+oy)*n+x+ox;this.bonds.push({a,b,rest:Math.hypot(...this.pieces[a].center.map((v,j)=>v-this.pieces[b].center[j]) as V3),broken:false,strain:0});}
    }
    this.frame.actuator=.95+this.edge;
  }
  step(dt=DT):void {
    const f=this.frame;f.time+=dt;const p=f.positions;
    const target=this.released?0:this.settings.load/100;this.strain+=clamp(target-this.strain,-this.settings.rate/100*dt,this.settings.rate/100*dt);
    const top=.95+this.edge*(1-this.strain);this.old.set(p);
    for(let i=0;i<this.pieces.length;i++)for(let a=0;a<3;a++){const k=i*3+a;this.velocity[k]+=(a===1?-9.81:0)*dt;this.velocity[k]*=.997;p[k]+=this.velocity[k]*dt;}
    let maxStrain=0;
    for(let it=0;it<7;it++){
      for(const b of this.bonds){if(b.broken)continue;const a=b.a*3,c=b.b*3,dx=p[c]-p[a],dy=p[c+1]-p[a+1],dz=p[c+2]-p[a+2],l=Math.hypot(dx,dy,dz)||1e-8,s=(l-b.rest)/b.rest;
        b.strain=Math.max(b.strain,Math.abs(s));maxStrain=Math.max(maxStrain,Math.abs(s));
        const threshold=.095*this.material.strength*(.85+(b.a%7)*.04);
        if(Math.abs(s)>threshold&&f.time>.15){b.broken=true;f.damage[b.a]=f.damage[b.b]=1;continue;}
        const q=(l-b.rest)/l*.39;
        p[a]+=dx*q;p[a+1]+=dy*q;p[a+2]+=dz*q;p[c]-=dx*q;p[c+1]-=dy*q;p[c+2]-=dz*q;
      }
      for(let i=0;i<this.pieces.length;i++){
        const k=i*3,hh=this.heights[i],rest=this.pieces[i].center;
        const low=.95+this.lowerExtents[i];p[k+1]=clamp(p[k+1],low,Math.max(low,top-hh));
        const hold=(.003+this.material.retention*.018)*this.settings.damping;p[k]+=(rest[0]-p[k])*hold;p[k+2]+=(rest[2]-p[k+2])*hold;
        for(let j=i+1;j<this.pieces.length;j++){
          const l=j*3,dx=p[l]-p[k],dy=p[l+1]-p[k+1],dz=p[l+2]-p[k+2],d2=dx*dx+dy*dy+dz*dz,r=(this.pieces[i].radius+this.pieces[j].radius)*.83;
          if(d2>1e-14&&d2<r*r){const d=Math.sqrt(d2),q=(r-d)/d*.5;p[k]-=dx*q;p[k+1]-=dy*q;p[k+2]-=dz*q;p[l]+=dx*q;p[l+1]+=dy*q;p[l+2]+=dz*q;}
        }
      }
    }
    let broken=0;for(const b of this.bonds)if(b.broken)broken++;
    for(let i=0;i<this.pieces.length;i++){
      const k=i*3;for(let a=0;a<3;a++)this.velocity[k+a]=clamp((p[k+a]-this.old[k+a])/dt,-4,4)*.965;
      const margin=this.pieces[i].radius;p[k]=clamp(p[k],-1.26+margin,1.26-margin);p[k+1]=Math.max(.95+this.lowerExtents[i],p[k+1]);p[k+2]=clamp(p[k+2],-.86+margin,.86-margin);
      if(f.damage[i]){f.rotations[k]+=(p[k+2]-this.pieces[i].center[2])*.006;f.rotations[k+2]-=(p[k]-this.pieces[i].center[0])*.006;}
    }
    f.actuator=top;f.phase=broken?'Crushing · spalling':this.strain>0?'Compressing':'Unloaded';f.metrics=[this.strain*100,broken/this.bonds.length*100,maxStrain*100];
  }
}

export class RubberModel extends LabModel {
  private strain=0;private velocity=0;private permanent=0;
  readonly initialHeight:number;readonly radius:number;
  constructor(p:Partial<LabSettings>={}){super('rubber',p);this.initialHeight=.86*this.settings.size;this.radius=.58*this.settings.size;this.allocate(1);this.frame.positions[0]=this.initialHeight;this.frame.positions[1]=this.radius;this.frame.actuator=1+this.initialHeight;this.frame.metrics=[0,100,0];}
  step(dt=DT):void {
    const f=this.frame,p=this.settings;f.time+=dt;
    const peak=p.load/100,tRamp=peak/(p.rate/100),releaseAt=tRamp+p.damping;
    const unloading=this.released||f.time>releaseAt;
    const target=unloading?this.permanent:Math.min(peak,f.time*p.rate/100);
    const k=65*this.material.strength,d=3+this.material.damping*17;
    this.velocity+=(k*(target-this.strain)-d*this.velocity)*dt;this.strain=clamp(this.strain+this.velocity*dt,0,.86);
    if(this.material.retention<.7)this.permanent=Math.max(this.permanent,(this.strain-.25)*.35*(1-this.material.retention));
    const height=this.initialHeight*(1-this.strain),volumeRatio=1-this.strain*(1-this.material.retention)*.85;
    const radius=this.radius*Math.sqrt(volumeRatio/(1-this.strain));
    f.positions[0]=height;f.positions[1]=radius;f.positions[2]=this.strain;f.actuator=1+height;
    f.phase=unloading?(Math.abs(this.strain-this.permanent)<.008?'Recovered':'Recovering'):f.time<tRamp?'Compressing':'Holding · creep';
    f.metrics=[this.strain*100,volumeRatio*100,this.permanent*100];
  }
}

export class GranularModel extends LabModel {
  readonly radius:number;readonly count:number;private velocity:Float64Array;private previous:Float64Array;private next:Int32Array;readonly initialMass:number;
  private heads:Int32Array;private neighborOffsets:Int32Array;private strideX:number;private strideY:number;
  constructor(p:Partial<LabSettings>={}){
    super('granular',p);this.radius=this.settings.size*.005;const r=this.radius,cols=Math.min(12,Math.floor(1.5/(r*2.06))),rows=Math.min(8,Math.floor(1.5/(r*2.06))),layers=Math.round(this.settings.fill/100*Math.min(14,1.4/(r*2.02))),rng=random(this.settings.seed);
    this.count=cols*rows*layers;this.allocate(this.count);this.velocity=new Float64Array(this.count*3);this.previous=new Float64Array(this.count*3);this.next=new Int32Array(this.count);
    const cell=r*2.1;this.strideY=Math.ceil(2.6/cell)+4;this.strideX=(Math.ceil(4/cell)+4)*this.strideY;
    this.heads=new Int32Array((Math.ceil(7/cell)+4)*this.strideX);this.neighborOffsets=new Int32Array(27);
    let neighbor=0;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)this.neighborOffsets[neighbor++]=dx*this.strideX+dy*this.strideY+dz;
    let i=0;for(let y=0;y<layers&&i<this.count;y++)for(let z=0;z<rows&&i<this.count;z++)for(let x=0;x<cols&&i<this.count;x++,i++)this.frame.positions.set([-2.75+r+x*r*2.06+(rng()-.5)*.003,.58+r+y*r*2.02,-.78+r+z*r*2.06],i*3);
    this.initialMass=this.count*4/3*Math.PI*r**3*this.material.density;this.frame.metrics=[0,layers*r*2.02,this.count];
  }
  step(dt=DT):void {
    const f=this.frame,p=f.positions,r=this.radius;f.time+=dt;this.previous.set(p);
    const gate=this.released?1.5:Math.min(this.settings.load/100*1.5,f.time*this.settings.rate),friction=clamp(this.material.friction*this.settings.damping,0,1);
    for(let i=0;i<this.count;i++){const k=i*3;this.velocity[k+1]-=9.81*dt;for(let a=0;a<3;a++)p[k+a]+=this.velocity[k+a]*dt;}
    const diameter=r*2,cell=diameter*1.05;
    for(let iteration=0;iteration<4;iteration++){
      this.heads.fill(-1);
      for(let i=0;i<this.count;i++){
        const k=i*3,x=Math.floor((p[k]+3.5)/cell)+2,y=Math.floor(p[k+1]/cell)+2,z=Math.floor((p[k+2]+1.3)/cell)+2,key=x*this.strideX+y*this.strideY+z;
        for(let neighbor=0;neighbor<27;neighbor++){
          let j=this.heads[key+this.neighborOffsets[neighbor]];
          while(j>=0){const l=j*3,vx=p[k]-p[l],vy=p[k+1]-p[l+1],vz=p[k+2]-p[l+2],len2=vx*vx+vy*vy+vz*vz;if(len2>1e-14&&len2<diameter*diameter){const len=Math.sqrt(len2),q=(diameter-len)/len*.5;p[k]+=vx*q;p[k+1]+=vy*q;p[k+2]+=vz*q;p[l]-=vx*q;p[l+1]-=vy*q;p[l+2]-=vz*q;}j=this.next[j];}
        }
        this.next[i]=this.heads[key];this.heads[key]=i;
      }
      for(let i=0;i<this.count;i++){
        const k=i*3;p[k]=clamp(p[k],-2.85+r,2.85-r);p[k+1]=Math.max(.58+r,p[k+1]);p[k+2]=clamp(p[k+2],-.85+r,.85-r);
        if(p[k+1]+r>.58+gate&&this.previous[k]<-1.15-r)p[k]=Math.min(p[k],-1.15-r);
        const dx=p[k]-1,zz=p[k+2],d=Math.hypot(dx,zz),radius=.27+r;
        if(p[k+1]<1.18+r&&d<radius){if(d>1e-8){p[k]=1+dx/d*radius;p[k+2]=zz/d*radius;}else p[k]=1+radius;}
      }
    }
    let front=-3,height=0,energy=0;
    for(let i=0;i<this.count;i++){
      const k=i*3;for(let a=0;a<3;a++)this.velocity[k+a]=clamp((p[k+a]-this.previous[k+a])/dt,-6,6)*(.996-this.material.damping*.018);
      if(p[k+1]<.58+r+.004){this.velocity[k]*=1-friction*.2;this.velocity[k+2]*=1-friction*.2;}
      else {this.velocity[k]*=1-friction*.012;this.velocity[k+2]*=1-friction*.012;}
      front=Math.max(front,p[k]+r);height=Math.max(height,p[k+1]+r-.58);energy+=this.velocity[k]**2+this.velocity[k+1]**2+this.velocity[k+2]**2;
    }
    f.actuator=gate;f.phase=gate<.2?'Gate lifting':energy/this.count<.002&&f.time>4?'Settled':'Avalanching';f.metrics=[Math.max(0,front+1.15),height,this.count];
  }
}
export function createModel(id:LabId,p:Partial<LabSettings>={}):LabModel {
  return id==='liquid'?new LiquidModel(p):id==='glass'?new GlassModel(p):id==='concrete'?new ConcreteModel(p):id==='rubber'?new RubberModel(p):new GranularModel(p);
}
export const METRIC_LABELS:Record<LabId,[string,string,string]>={liquid:['Peak depth · m','Peak speed · m/s','Fluid volume · m³'],glass:['Potential energy · J','Fractured pieces · %','Out-of-plane · mm'],concrete:['Compression · %','Broken bonds · %','Peak local strain · %'],rubber:['Compression · %','Retained volume · %','Permanent set · %'],granular:['Runout · model m','Pile height · model m','Grains retained']};
