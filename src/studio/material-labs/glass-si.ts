// Glass impact lab in SI units: a Kirchhoff plate (src/engine/plate.ts) on six elastic clamp pads, struck by a
// rigid pendulum, cracking where its surface bending stress reaches the glass's strength. See docs/STUDIO_MATERIAL_LABS.md.
import {PlateBody,type PlateFragment} from '../../engine/plate';
import {materialProperty,contactPair} from '../../engine/materials';
import {GLASS_RIG,glassBobPosition,glassBobTangent} from './glass-rig';
import {LabModel,DT,random,type V3} from './lab-model';
import type {LabSettings} from './catalog';

const G=9.81;
/** Grid of the plate: 0.1 m cells over the 2.6 m x 2.0 m pane. */
export const GLASS_CELLS:[number,number]=[26,20];
/** Nominal PVB interlayer of a laminate, m (Stratobel xx.2, AGC sheet). */
export const PVB_THICKNESS=.76e-3;
/** Wired glass: steel wire of 0.46 mm on a 12.5 mm square mesh. Typical figures, not read in an opened source (unverified). */
export const WIRE={diameter:.46e-3,pitch:12.5e-3};
/** Speed of the dicing front in toughened glass, m/s. Of the order of the terminal crack speed of soda-lime glass; not read in an opened source (unverified). */
export const DICING_SPEED=1500;
/** Fragments in a 50 mm x 50 mm square per MPa of surface compression, thin toughened glass: 0.8 to 1.2 (Efferz et al. 2024, Glass Struct. Eng.). */
export const FRAGMENTS_PER_MPA=1;
/** Rubber of the clamp pads (natural rubber, library) and their geometry from the rig: 24 mm thick, 210 mm tall, 55 mm over the pane edge. */
const PAD={thickness:.024,height:.21,overlap:.055};
/** Mass damping of the plate, 1/s: about 0.6% of critical at the first mode of the 8 mm pane. Assumed, not measured (unverified). */
export const PLATE_DAMPING=.6;

export interface GlassSpec {
  name:string;library:string;youngModulus:number;poissonRatio:number;density:number;
  /** Surface tensile strength in bending, Pa, and residual surface compression, Pa. */
  strength:number;prestress:number;
  /** Membrane E t of a layer that bridges cracks, N/m, and its extra mass per area. */
  tie:number;addedArealMass:number;dicing:boolean;notes:string;
}
/** SI properties of each Studio glass profile, from src/engine/materials.ts. */
export function glassSpec(material:string):GlassSpec {
  const p=(id:string,k:Parameters<typeof materialProperty>[1])=>materialProperty(id,k);
  const soda=(name:string,notes:string,extra:Partial<GlassSpec>={}):GlassSpec=>({name,library:'soda-lime-glass',youngModulus:p('soda-lime-glass','youngModulus'),poissonRatio:p('soda-lime-glass','poissonRatio'),density:p('soda-lime-glass','density'),strength:p('soda-lime-glass','flexuralStrength'),prestress:0,tie:0,addedArealMass:0,dicing:false,notes,...extra});
  switch(material){
    case 'tempered':return soda('Thermally toughened soda-lime','Surface compression = toughened minus annealed flexural strength of the same sheet; dicing front after the first crack.',{library:'soda-lime-glass-toughened',prestress:p('soda-lime-glass-toughened','flexuralStrength')-p('soda-lime-glass','flexuralStrength'),dicing:true});
    case 'laminated':return soda('Laminated annealed soda-lime with 0.76 mm PVB','Plies bend as one section before breaking; after it the PVB membrane bridges every crack.',{tie:p('pvb-interlayer','youngModulus')*PVB_THICKNESS,addedArealMass:p('pvb-interlayer','density')*PVB_THICKNESS});
    case 'wired':return soda('Annealed soda-lime with a steel wire mesh','The wire mesh bridges cracks as a membrane; mesh geometry unverified.',{tie:p('structural-steel-s235','youngModulus')*Math.PI*WIRE.diameter**2/4/WIRE.pitch});
    case 'borosilicate':return {name:'Borosilicate (BOROFLOAT 33)',library:'borosilicate-glass',youngModulus:p('borosilicate-glass','youngModulus'),poissonRatio:p('borosilicate-glass','poissonRatio'),density:p('borosilicate-glass','density'),strength:p('borosilicate-glass','flexuralStrength'),prestress:0,tie:0,addedArealMass:0,dicing:false,notes:'Datasheet bending strength 25 MPa.'};
    case 'acrylic':return {name:'Cast acrylic (PMMA)',library:'pmma',youngModulus:p('pmma','youngModulus'),poissonRatio:p('pmma','poissonRatio'),density:p('pmma','density'),strength:p('pmma','flexuralStrength'),prestress:0,tie:0,addedArealMass:0,dicing:false,notes:'Short-term modulus at 23 °C; treated as brittle at its flexural strength.'};
    case 'frosted':return soda('Annealed soda-lime, frosted','The surface finish is drawn only: its effect on strength is not modelled.');
    case 'tinted':return soda('Annealed soda-lime, bronze tint','Tint does not change the mechanics.');
    default:return soda('Annealed soda-lime','Flexural strength of annealed sheet, 41 MPa.');
  }
}

interface RigidFragment {reach:number;nodes:Uint32Array;mass:number;x:V3;v:V3;q:[number,number,number,number];w:V3;inertia:V3;offsets:Float64Array;corners:Float64Array;resting:number;}
const rotate=(q:number[],x:number,y:number,z:number,out:number[]|Float64Array,o=0)=>{
  const [qx,qy,qz,qw]=q,tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
  out[o]=x+qw*tx+qy*tz-qz*ty;out[o+1]=y+qw*ty+qz*tx-qx*tz;out[o+2]=z+qw*tz+qx*ty-qy*tx;
};
const euler=(q:number[],out:Float32Array,o:number)=>{
  // XYZ Euler angles of a unit quaternion (three.js order).
  const [x,y,z,w]=q,m11=1-2*(y*y+z*z),m12=2*(x*y-z*w),m13=2*(x*z+y*w),m22=1-2*(x*x+z*z),m23=2*(y*z-x*w),m33=1-2*(x*x+y*y),m32=2*(y*z+x*w);
  const b=Math.asin(Math.max(-1,Math.min(1,m13)));out[o+1]=b;
  if(Math.abs(m13)<.9999999){out[o]=Math.atan2(-m23,m33);out[o+2]=Math.atan2(-m12,m11);}else{out[o]=Math.atan2(m32,m22);out[o+2]=0;}
};

/** World inverse inertia of a fragment applied to a vector (body principal axes are the plate axes). */
function inverseInertia(f:RigidFragment,x:number,y:number,z:number,out:number[]):void {
  const [qx,qy,qz,qw]=f.q,b=[0,0,0];rotate([-qx,-qy,-qz,qw],x,y,z,b);rotate(f.q,b[0]/f.inertia[0],b[1]/f.inertia[1],b[2]/f.inertia[2],out);
}
const scratch=[0,0,0];
/** 1 / m + n . ((I^-1 (r x n)) x r): the inverse effective mass at arm r along unit n. */
function effectiveMass(f:RigidFragment,r:number[],nx:number,ny:number,nz:number):number {
  inverseInertia(f,r[1]*nz-r[2]*ny,r[2]*nx-r[0]*nz,r[0]*ny-r[1]*nx,scratch);const [a,b,c]=scratch;
  return 1/f.mass+nx*(b*r[2]-c*r[1])+ny*(c*r[0]-a*r[2])+nz*(a*r[1]-b*r[0]);
}
function impulse(f:RigidFragment,r:number[],jx:number,jy:number,jz:number):void {
  f.v[0]+=jx/f.mass;f.v[1]+=jy/f.mass;f.v[2]+=jz/f.mass;
  inverseInertia(f,r[1]*jz-r[2]*jy,r[2]*jx-r[0]*jz,r[0]*jy-r[1]*jx,scratch);f.w[0]+=scratch[0];f.w[1]+=scratch[1];f.w[2]+=scratch[2];
}

/** The pendulum is one rotation about the pivot (inertia m (L^2 + offset^2 + 2/5 R^2), a solid bob). It touches the
 * plate's nodes through penalty springs on the sphere surface; the springs enter the plate's stability limit. */
export class GlassModel extends LabModel {
  readonly spec:GlassSpec;readonly plate:PlateBody;readonly thickness:number;
  readonly impactX:number;readonly panelWidth=GLASS_RIG.panelWidth;readonly panelHeight=GLASS_RIG.panelHeight;readonly panelCenterY=GLASS_RIG.panelCenterY;
  readonly pendulumMass:number;readonly pendulumInertia:number;readonly impactEnergy:number;
  readonly contactStiffness:Float64Array;readonly supportNodes:Uint32Array;
  angle:number;speed=0;
  peakForce=0;peakStress=0;force=0;throwDistance=0;retained=1;fragments:RigidFragment[]=[];fragmentCount=1;substeps=0;
  private friction:number;private touching:number[]=[];private bonds=0;private checked=0;private tile:{x:number;y:number}[];
  constructor(p:Partial<LabSettings>={}){
    super('glass',p);const s=this.settings;this.spec=glassSpec(this.material.id);this.thickness=s.size/1000;this.impactX=s.fill/100;
    const r=GLASS_RIG,spec=this.spec;
    this.plate=new PlateBody({size:[r.panelWidth,r.panelHeight],cells:GLASS_CELLS,thickness:this.thickness,origin:[-r.panelWidth/2,r.panelCenterY-r.panelHeight/2],
      material:{youngModulus:spec.youngModulus,poissonRatio:spec.poissonRatio,density:spec.density},addedArealMass:spec.addedArealMass,massDamping:PLATE_DAMPING,
      fracture:{strength:spec.strength,prestress:spec.prestress,dicingSpeed:spec.dicing?DICING_SPEED:0,tie:spec.tie}});
    const plate=this.plate,pads:number[]=[];
    // Rubber pads on both faces at x = +-1.32 m, y = 1.6, 2.45, 3.3 m: two springs E A / t in parallel per pad, shared by the nodes under it.
    const padStiffness=2*materialProperty('natural-rubber','youngModulus')*PAD.overlap*PAD.height/PAD.thickness*s.damping;
    for(const sx of [-1,1])for(const y of [1.6,2.45,3.3]){
      const nodes=plate.selectNodes((x,yy)=>sx*x>=r.panelWidth/2-PAD.overlap-1e-9&&Math.abs(yy-y)<=PAD.height/2+1e-9);
      plate.addSupport(nodes,padStiffness/nodes.length);pads.push(...nodes);
      // The pads also resist rotation of the clamped strip: two rubber faces as a Winkler bed, k = 2 E H b^3 / (12 t) per pad,
      // as a spring on the slope between each clamped node and its inner neighbour.
      const rotation=2*materialProperty('natural-rubber','youngModulus')*PAD.height*PAD.overlap**3/(12*PAD.thickness)*s.damping;
      for(const n of nodes)plate.addCoupling(n,n-sx,rotation/(plate.hx*plate.hx)/nodes.length);
    }
    this.supportNodes=Uint32Array.from(pads);
    // Contact springs a quarter as stiff as the stiffest bending row, so they cost a quarter more steps.
    const bare=plate.stableTimeStep();this.contactStiffness=new Float64Array(plate.nodeCount);
    for(let n=0;n<plate.nodeCount;n++){this.contactStiffness[n]=.25*plate.mass[n]*(2/bare)**2;}
    for(let n=0;n<plate.nodeCount;n++)plate.extraStiffness[n]=this.contactStiffness[n];plate.setExtraStiffness([],0);
    this.pendulumMass=s.load;const R=r.bobRadius;this.pendulumInertia=s.load*(r.pendulumLength**2+r.bobOffsetZ**2+.4*R*R);
    this.angle=Math.acos(1-s.rate/Math.hypot(r.pendulumLength,r.bobOffsetZ))-Math.atan2(r.bobOffsetZ,r.pendulumLength);
    this.impactEnergy=s.load*G*s.rate;
    // The library has no glass-on-steel friction; fragments slide with glass-on-glass kinetic friction.
    this.friction=contactPair('soda-lime-glass','soda-lime-glass').kineticFriction??0;
    // Tiles: each node owns the cell around it; inner corners are moved at random so the cracks read as glass.
    const rng=random(s.seed),cx=GLASS_CELLS[0],cy=GLASS_CELLS[1],hx=plate.hx,hy=plate.hy,x0=plate.origin[0],y0=plate.origin[1];
    const corner=new Float64Array((cx+2)*(cy+2)*2);
    for(let j=0;j<=cy+1;j++)for(let i=0;i<=cx+1;i++){
      const k=2*(j*(cx+2)+i),edgeX=i===0||i===cx+1,edgeY=j===0||j===cy+1;
      corner[k]=Math.min(x0+cx*hx,Math.max(x0,x0+(i-.5)*hx+(edgeX?0:(rng()-.5)*.55*hx)));
      corner[k+1]=Math.min(y0+cy*hy,Math.max(y0,y0+(j-.5)*hy+(edgeY?0:(rng()-.5)*.55*hy)));
    }
    this.tile=[];this.allocate(plate.nodeCount);
    for(let n=0;n<plate.nodeCount;n++){
      const i=n%plate.nx,j=Math.floor(n/plate.nx),X=plate.x(n),Y=plate.y(n),at=(a:number,b:number):V3=>{const k=2*(b*(cx+2)+a);return [corner[k]-X,corner[k+1]-Y,0];};
      const vertices=[at(i,j),at(i+1,j),at(i+1,j+1),at(i,j+1)];
      this.pieces.push({center:[X,Y,0],vertices,radius:Math.max(...vertices.map(v=>Math.hypot(v[0],v[1])))});this.tile.push({x:X,y:Y});
      this.frame.positions.set([X,Y,0],n*3);
    }
    this.frame.cracks=new Uint8Array(plate.bondCount);this.frame.actuator=this.angle;this.sync();
  }
  get bob():V3 {return glassBobPosition(this.angle,this.impactX);}
  /** Contact of the bob with the plate nodes: forces into plate.force; returns the generalized force on the pendulum. */
  private contact():number {
    const plate=this.plate,c=this.bob,R=GLASS_RIG.bobRadius+this.thickness/2,t=glassBobTangent(this.angle),bobVelocity=t.map(x=>x*this.speed);let total=0;
    plate.force.fill(0);for(const n of this.touching){plate.drag[n]=0;plate.dragVelocity[n]=0;}this.touching.length=0;
    const i0=Math.max(0,Math.floor((c[0]-R-plate.origin[0])/plate.hx)),i1=Math.min(plate.cx,Math.ceil((c[0]+R-plate.origin[0])/plate.hx));
    const j0=Math.max(0,Math.floor((c[1]-R-plate.origin[1])/plate.hy)),j1=Math.min(plate.cy,Math.ceil((c[1]+R-plate.origin[1])/plate.hy));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const n=j*plate.nx+i;if(!plate.active[n])continue;
      // The node moves only along z, so the contact is measured along z: the node must stay in front of the
      // sphere's surface (the bob comes from +z). A spring plus a critically damped dashpot on the closing
      // speed (an inelastic, crushing contact), never pulling. A node beside or behind the bob's centre has
      // been passed (the glass there would have been pushed aside) and is left alone.
      const r2=(plate.x(n)-c[0])**2+(plate.y(n)-c[1])**2;if(r2>=R*R)continue;
      const depth=plate.w[n]-(c[2]-Math.sqrt(R*R-r2));if(depth<=0||plate.w[n]>=c[2])continue;
      const k=this.contactStiffness[n];plate.force[n]-=k*depth;plate.drag[n]=2*Math.sqrt(k*plate.mass[n]);plate.dragVelocity[n]=bobVelocity[2];this.touching.push(n);total+=k*depth;
    }
    this.force=total;return total*t[2];
  }
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Glass step must be in (0, 0.25] seconds');
    // Equal sub-steps: symplectic Euler gains energy when its step length changes from one step to the next,
    // so the step is set once per tick and only shortened (for the rest of the tick) when a crack lowers the limit.
    const plate=this.plate,start=this.frame.time;let left=dt,h=dt/Math.ceil(dt/(.9*plate.stableTimeStep()));
    while(left>1e-12){
      if(h>.9*plate.stableTimeStep())h=left/Math.ceil(left/(.9*plate.stableTimeStep()));
      h=Math.min(h,left);
      const tangent=glassBobTangent(this.angle);
      // Gravity on the bob: potential m g y(angle), so the generalized force is -m g dy/dangle.
      const spring=this.contact(),tangentZ=glassBobTangent(this.angle)[2];
      this.bonds+=plate.advance(h);this.substeps++;
      // The dashpots' force is the one the plate saw over the step, from the nodes' new velocities.
      let damper=0;for(const n of this.touching)damper+=plate.drag[n]*(plate.dragVelocity[n]-plate.v[n]);
      this.force=Math.max(0,this.force-damper);
      this.speed+=h*(spring-damper*tangentZ-this.pendulumMass*G*tangent[1])/this.pendulumInertia;this.angle+=h*this.speed;
      left-=h;this.peakForce=Math.max(this.peakForce,this.force);
    }
    this.frame.time=start+dt;
    if(this.bonds!==this.checked){this.checked=this.bonds;this.detachFragments();}
    this.stepFragments(dt);
    this.peakStress=plate.peakStress;
    this.sync();
  }
  private detachFragments():void {
    const pieces=this.plate.fragments();this.fragmentCount=pieces.length+this.fragments.length;
    // A piece is held when at least two of its nodes sit under the pads; otherwise it is free to fall.
    const pads=new Set(this.supportNodes);
    for(const piece of pieces){let held=0;for(const n of piece.nodes)if(pads.has(n))held++;if(held<2)this.handOff(piece);}
  }
  private handOff(piece:PlateFragment):void {
    const plate=this.plate,n=piece.nodes.length,offsets=new Float64Array(3*n),corners:number[]=[];let ixx=0,iyy=0,izz=0;
    for(let k=0;k<n;k++){
      const node=piece.nodes[k],ox=plate.x(node)-piece.center[0],oy=plate.y(node)-piece.center[1],oz=plate.w[node]-piece.center[2],m=plate.mass[node];
      offsets.set([ox,oy,oz],3*k);
      // Each node carries its own cell as a thin lamina: its point mass plus the cell's own moments of inertia.
      ixx+=m*(oy*oy+oz*oz+(plate.hy**2+this.thickness**2)/12);iyy+=m*(ox*ox+oz*oz+(plate.hx**2+this.thickness**2)/12);izz+=m*(ox*ox+oy*oy+(plate.hx**2+plate.hy**2)/12);
      for(const v of this.pieces[node].vertices)corners.push(ox+v[0],oy+v[1],oz);
    }
    let reach=0;for(let k=0;k<corners.length;k+=3)reach=Math.max(reach,Math.hypot(corners[k],corners[k+1],corners[k+2]));
    const fragment:RigidFragment={reach,nodes:piece.nodes,mass:piece.mass,x:[...piece.center] as V3,v:[0,0,piece.velocity],q:[0,0,0,1],
      w:[piece.angularVelocity[0],piece.angularVelocity[1],0],inertia:[ixx,iyy,izz],offsets,corners:Float64Array.from(corners),resting:0};
    plate.detach(piece);this.fragments.push(fragment);
  }
  /** Fragments fall as rigid bodies onto the tray or the floor (impulses at the deepest corner, Coulomb friction, no bounce).
   * They do not collide with each other, the frame or the pendulum. */
  private stepFragments(dt:number):void {
    const steps=Math.max(1,Math.ceil(dt/(1/1920))),h=dt/steps,p=[0,0,0],tray=GLASS_RIG;
    for(const f of this.fragments){
      if(f.resting>.5)continue;
      for(let s=0;s<steps;s++){
        f.v[1]-=G*h;for(let a=0;a<3;a++)f.x[a]+=h*f.v[a];
        const [wx,wy,wz]=f.w,[qx,qy,qz,qw]=f.q;
        const nq0=qx+.5*h*(wx*qw+wy*qz-wz*qy),nq1=qy+.5*h*(wy*qw+wz*qx-wx*qz),nq2=qz+.5*h*(wz*qw+wx*qy-wy*qx),nq3=qw-.5*h*(wx*qx+wy*qy+wz*qz),ql=Math.hypot(nq0,nq1,nq2,nq3);
        f.q[0]=nq0/ql;f.q[1]=nq1/ql;f.q[2]=nq2/ql;f.q[3]=nq3/ql;
        // Nothing to touch while the whole piece is above the tray: skip the corner search.
        if(f.x[1]-f.reach>tray.trayTop)continue;
        // Every corner below the ground takes a normal impulse (restitution 0) and a friction impulse capped at mu j_n, in turn;
        // then the piece is lifted out by the deepest penetration.
        let deepest=0;
        for(let k=0;k<f.corners.length;k+=3){
          rotate(f.q,f.corners[k],f.corners[k+1],f.corners[k+2],p);
          const X=f.x[0]+p[0],Y=f.x[1]+p[1],Z=f.x[2]+p[2],ground=Math.abs(X)<tray.trayWidth/2&&Math.abs(Z)<tray.trayDepth/2?tray.trayTop:0,depth=ground-Y;
          if(depth<=0)continue;deepest=Math.max(deepest,depth);
          const vn=f.v[1]+f.w[2]*p[0]-f.w[0]*p[2];if(vn>=0)continue;
          const jn=-vn/effectiveMass(f,p,0,1,0);impulse(f,p,0,jn,0);
          const ux=f.v[0]+f.w[1]*p[2]-f.w[2]*p[1],uz=f.v[2]+f.w[0]*p[1]-f.w[1]*p[0],speed=Math.hypot(ux,uz);
          if(speed>1e-9){const dx=ux/speed,dz=uz/speed,jt=Math.min(speed/effectiveMass(f,p,dx,0,dz),this.friction*jn);impulse(f,p,-dx*jt,0,-dz*jt);}
        }
        if(deepest<=0)continue;
        f.x[1]+=deepest;
        if(Math.hypot(f.v[0],f.v[1],f.v[2])<.02&&Math.hypot(f.w[0],f.w[1],f.w[2])<.3)f.resting+=h;else f.resting=0;
        if(f.resting>.5){f.v=[0,0,0];f.w=[0,0,0];break;}
      }
    }
  }
  private sync():void {
    const f=this.frame,plate=this.plate,pos=f.positions,rot=f.rotations,d=f.damage;let travel=0;
    for(let n=0;n<plate.nodeCount;n++){
      if(!plate.active[n])continue;const i=n%plate.nx,j=Math.floor(n/plate.nx),w=plate.w;
      const gx=i>0&&i<plate.cx?(w[n+1]-w[n-1])/(2*plate.hx):i===0?(w[n+1]-w[n])/plate.hx:(w[n]-w[n-1])/plate.hx;
      const gy=j>0&&j<plate.cy?(w[n+plate.nx]-w[n-plate.nx])/(2*plate.hy):j===0?(w[n+plate.nx]-w[n])/plate.hy:(w[n]-w[n-plate.nx])/plate.hy;
      pos[3*n]=this.tile[n].x;pos[3*n+1]=this.tile[n].y;pos[3*n+2]=w[n];rot[3*n]=gy;rot[3*n+1]=-gx;rot[3*n+2]=0;travel=Math.max(travel,Math.abs(w[n]));
    }
    const out=[0,0,0];let throwDistance=0,held=0;
    for(let n=0;n<plate.nodeCount;n++)if(plate.active[n])held+=plate.area[n];
    for(const g of this.fragments){for(let k=0;k<g.nodes.length;k++){
      const n=g.nodes[k];rotate(g.q,g.offsets[3*k],g.offsets[3*k+1],g.offsets[3*k+2],out);
      pos[3*n]=g.x[0]+out[0];pos[3*n+1]=g.x[1]+out[1];pos[3*n+2]=g.x[2]+out[2];euler(g.q,rot,3*n);
    }throwDistance=Math.max(throwDistance,Math.abs(g.x[2]));}
    this.throwDistance=throwDistance;this.retained=held/(this.panelWidth*this.panelHeight);
    d.fill(0);
    for(let b=0;b<plate.bondCount;b++)if(plate.broken[b]){const [p,q]=plate.bondNodes(b);d[p]=d[q]=1;}
    for(const g of this.fragments)for(const n of g.nodes)d[n]=1;
    f.cracks!.set(plate.broken);f.actuator=this.angle;
    const broken=plate.breakTime>=0,falling=this.fragments.filter(g=>g.resting<=.5).length;
    f.phase=!broken?(this.frame.time===0?'Ready':this.peakForce>0?'Impact absorbed · intact':'Pendulum falling'):this.spec.tie>0?'Fractured · retained by interlayer':falling?'Fractured · fragments falling':'Fractured · fragments at rest';
    f.metrics=[this.peakForce/1000,this.peakStress/1e6,travel*1000];
    const limit=(this.spec.strength+this.spec.prestress)/1e6;
    f.status=!broken?`Impact ${this.impactEnergy.toFixed(0)} J · cracks at ${limit.toFixed(0)} MPa surface stress`:`${this.fragmentCount} pieces · ${(this.retained*100).toFixed(0)}% of the pane held`+(this.fragments.length?` · farthest fragment ${this.throwDistance.toFixed(2)} m`:'')+(this.spec.dicing?` · dicing ≈ ${Math.round(FRAGMENTS_PER_MPA*this.spec.prestress/1e6)} fragments per 50 mm square`:'');
  }
}
