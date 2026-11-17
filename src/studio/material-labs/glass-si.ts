// Glass impact lab in SI units: a Kirchhoff plate (src/engine/plate.ts) on six elastic clamp pads, struck by a
// rigid pendulum, cracking where its surface bending stress reaches the glass's strength. See docs/STUDIO_MATERIAL_LABS.md.
import {PlateBody,type PlateFragment} from '../../engine/plate';
import {materialProperty,contactPair} from '../../engine/materials';
import {GLASS_RIG,glassBobPosition,glassBobTangent} from './glass-rig';
import {LabModel,DT,random,type V3} from './lab-model';
import {GlassFragmentWorld,type FragmentRelease} from './glass-fragments';
import type {NativeWorldPool} from '../../engine/native-world';
import type {LabSettings} from './catalog';

const G=9.81;
/** Grid of the plate: 0.1 m cells over the 2.6 m x 2.0 m pane. */
export const GLASS_CELLS:[number,number]=[26,20];
/** Nominal PVB interlayer of a laminate, m (Stratobel xx.2, AGC sheet). */
export const PVB_THICKNESS=.76e-3;
/** Wired glass: a square steel wire mesh of 1/2 inch (12.7 mm), as AGC's wired patterned glass sheet states ("The
 * dimensions of each wire mesh element is 1/2" x 1/2"", AGC InfoSheet 2023 Wired); EN 572-6 is summarised as 12.5 or 25 mm
 * meshes (not opened). Wire diameter 0.46 mm: no opened source gives it (unverified). */
export const WIRE={diameter:.46e-3,pitch:12.7e-3};
/** Speed of the fragmentation front in thermally toughened soda-lime glass, m/s: 1466 m/s within 1 %, measured with
 * high-speed cameras by Nielsen, Olesen and Stang, "The fracture process of tempered soda-lime-silica glass", Exp. Mech.
 * 49 (2009) 855-870, as stated on DTU's tempered-glass research page (the paper itself was not opened). */
export const DICING_SPEED=1466;
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

interface RigidFragment {reach:number;nodes:Uint32Array;mass:number;x:V3;v:V3;q:[number,number,number,number];w:V3;inertia:V3;offsets:Float64Array;corners:Float64Array;resting:number;
  /** Index of its body in the Box3D fragment world, or -1 (the fragment is stepped here, without contacts between pieces). */
  body:number;}
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

/** x = A^-1 b for a symmetric 3 x 3 matrix [a00, a11, a22, a01, a02, a12] (Cramer's rule). */
function solve3(a:number[],b:number[]):[number,number,number] {
  const [m00,m11,m22,m01,m02,m12]=a,c00=m11*m22-m12*m12,c01=m02*m12-m01*m22,c02=m01*m12-m02*m11,det=m00*c00+m01*c01+m02*c02;
  const c11=m00*m22-m02*m02,c12=m01*m02-m00*m12,c22=m00*m11-m01*m01;
  return [(c00*b[0]+c01*b[1]+c02*b[2])/det,(c01*b[0]+c11*b[1]+c12*b[2])/det,(c02*b[0]+c12*b[1]+c22*b[2])/det];
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
  /** The Box3D world of the released fragments (`options.fragments`), or null: fragments fall on their own (no contact
   * between them or with the frame). */
  readonly rigid:GlassFragmentWorld|null;
  /** Largest relative difference at release, over every fragment so far, between the plate's linear (angular) momentum and
   * that of the Box3D body as Box3D holds it (float32). */
  releaseError={linear:0,angular:0};
  private friction:number;private touching:number[]=[];private bonds=0;private checked=0;private tile:{x:number;y:number}[];
  /** `cells`: the plate's grid (default GLASS_CELLS, 0.1 m). `membrane: false`: the linear Kirchhoff plate of the first version.
   * `fragments`: a loaded Box3D pool; released fragments then become rigid bodies of a Box3D world that collide with each
   * other, the frame, the tray and the floor (glass-fragments.ts). Without it they fall on their own, as before. */
  constructor(p:Partial<LabSettings>={},options:{cells?:[number,number];membrane?:boolean;fragments?:NativeWorldPool}={}){
    super('glass',p);const s=this.settings;this.spec=glassSpec(this.material.id);const cells=options.cells??GLASS_CELLS;this.thickness=s.size/1000;this.impactX=s.fill/100;
    const r=GLASS_RIG,spec=this.spec;
    this.plate=new PlateBody({size:[r.panelWidth,r.panelHeight],cells,membrane:options.membrane??true,thickness:this.thickness,origin:[-r.panelWidth/2,r.panelCenterY-r.panelHeight/2],
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
    // Contact springs a quarter as stiff as the stiffest bending row, so they cost a quarter more steps while the bob is near
    // (`reach`: they enter the stability limit only at the nodes the bob can touch within the tick).
    // The stiffest row counts a bridging layer as a string at full stiffness, 8 E t per node (the plate's stability bound
    // before 2026-11-17, which now uses the layer's tangent), so that the contact is as stiff as it was.
    plate.stableTimeStep();let most=0;const layer=spec.tie>0?8*spec.tie*Math.max(plate.hy/plate.hx,plate.hx/plate.hy):0;
    for(let n=0;n<plate.nodeCount;n++)if(plate.active[n]&&!plate.fixed[n])most=Math.max(most,(layer>0?plate.bendRow[n]+layer:plate.bendRow[n])/plate.mass[n]);
    const bare=most>0?2/Math.sqrt(most):Infinity;this.contactStiffness=new Float64Array(plate.nodeCount);
    for(let n=0;n<plate.nodeCount;n++){this.contactStiffness[n]=.25*plate.mass[n]*(2/bare)**2;}
    this.pendulumMass=s.load;const R=r.bobRadius;this.pendulumInertia=s.load*(r.pendulumLength**2+r.bobOffsetZ**2+.4*R*R);
    this.angle=Math.acos(1-s.rate/Math.hypot(r.pendulumLength,r.bobOffsetZ))-Math.atan2(r.bobOffsetZ,r.pendulumLength);
    this.impactEnergy=s.load*G*s.rate;
    // The library has no glass-on-steel friction; fragments slide with glass-on-glass kinetic friction.
    this.friction=contactPair('soda-lime-glass','soda-lime-glass').kineticFriction??0;
    // Tiles: each node owns the cell around it; inner corners are moved at random so the cracks read as glass.
    const rng=random(s.seed),cx=cells[0],cy=cells[1],hx=plate.hx,hy=plate.hy,x0=plate.origin[0],y0=plate.origin[1];
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
    this.frame.cracks=new Uint8Array(plate.bondCount);this.frame.actuator=this.angle;
    this.rigid=options.fragments?new GlassFragmentWorld(options.fragments,this.thickness):null;
    this.sync();
  }
  /** Frees the Box3D world of the fragments (the model can still be read, not stepped further with contacts). */
  dispose():void {this.rigid?.destroy();}
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
  /** The nodes the bob can touch within the next dt carry their contact springs in the plate's stability limit; the others
   * none. A node can be touched when it lies under the sphere's footprint, widened by the bob's travel, and the gap along z is
   * less than twice what the bob and the fastest node can close in dt, plus 20 mm. */
  private reach(dt:number):void {
    const plate=this.plate,c=this.bob,R=GLASS_RIG.bobRadius+this.thickness/2,travel=Math.abs(this.speed)*Math.hypot(GLASS_RIG.pendulumLength,GLASS_RIG.bobOffsetZ)*dt,wide=R+travel+.01;
    let fastest=0;for(let n=0;n<plate.nodeCount;n++)if(plate.active[n])fastest=Math.max(fastest,Math.abs(plate.v[n]));
    const gap=2*dt*(Math.abs(this.speed)*Math.hypot(GLASS_RIG.pendulumLength,GLASS_RIG.bobOffsetZ)+fastest)+.02,extra=plate.extraStiffness;let changed=false;
    for(let n=0;n<plate.nodeCount;n++){
      const dx=plate.x(n)-c[0],dy=plate.y(n)-c[1],near=plate.active[n]&&dx*dx+dy*dy<wide*wide&&c[2]-R-plate.w[n]<gap,k=near?this.contactStiffness[n]:0;
      if(extra[n]!==k){extra[n]=k;changed=true;}
    }
    if(changed)plate.setExtraStiffness([],0);
  }
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Glass step must be in (0, 0.25] seconds');
    // Equal sub-steps: symplectic Euler gains energy when its step length changes from one step to the next,
    // so the step is set once per tick and only shortened (for the rest of the tick) when a crack lowers the limit.
    const plate=this.plate,start=this.frame.time;this.reach(dt);let left=dt,h=dt/Math.ceil(dt/(.9*plate.stableTimeStep()));
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
    const anchors:number[]=[];
    for(const piece of pieces){let held=0;for(const n of piece.nodes)if(pads.has(n))held++;if(held<2)this.handOff(piece);else for(const n of piece.nodes)if(pads.has(n))anchors.push(n);}
    // What is left can still hold shards that hang from it by a hinge (a row of nodes joined through one node): the plate
    // has no stiffness against their rotation, so they are handed off too, each connected group as one piece.
    const plate=this.plate,held=plate.heldNodes(anchors),seen=new Uint8Array(plate.nodeCount),nx=plate.nx;
    for(let start=0;start<plate.nodeCount;start++){
      if(!plate.active[start]||held[start]||seen[start])continue;
      const group=[start],stack=[start];seen[start]=1;
      while(stack.length){
        const n=stack.pop()!,i=n%nx,j=Math.floor(n/nx);
        const near:[number,number][]=[];
        if(i>0)near.push([n-1,plate.bondX(i-1,j)]);if(i<plate.cx)near.push([n+1,plate.bondX(i,j)]);if(j>0)near.push([n-nx,plate.bondY(i,j-1)]);if(j<plate.cy)near.push([n+nx,plate.bondY(i,j)]);
        for(const [m,bond] of near)if(plate.active[m]&&!held[m]&&!seen[m]&&!plate.broken[bond]){seen[m]=1;group.push(m);stack.push(m);}
      }
      this.handOff(plate.fragmentOf(group.sort((a,b)=>a-b)));this.fragmentCount++;
    }
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
      w:[piece.angularVelocity[0],piece.angularVelocity[1],0],inertia:[ixx,iyy,izz],offsets,corners:Float64Array.from(corners),resting:0,body:-1};
    if(this.rigid)fragment.body=this.toRigid(piece,offsets);
    plate.detach(piece);this.fragments.push(fragment);
  }
  /** Hands a piece to the Box3D world: its mass, centre and full inertia tensor (each node's point mass plus its cell as a
   * thin lamina), its velocity, and the spin that carries the plate's angular momentum about the centre, I^-1 L; its tiles
   * as hulls. Records how far Box3D's body (float32) differs from the plate in linear and angular momentum. */
  private toRigid(piece:PlateFragment,offsets:Float64Array):number {
    const plate=this.plate,n=piece.nodes.length,I=[0,0,0,0,0,0],L=[0,0,0],tiles:Float64Array[]=[];let p=0;
    for(let k=0;k<n;k++){
      const node=piece.nodes[k],m=plate.mass[node],ox=offsets[3*k],oy=offsets[3*k+1],oz=offsets[3*k+2],v=plate.v[node];
      I[0]+=m*(oy*oy+oz*oz+(plate.hy**2+this.thickness**2)/12);I[1]+=m*(ox*ox+oz*oz+(plate.hx**2+this.thickness**2)/12);I[2]+=m*(ox*ox+oy*oy+(plate.hx**2+plate.hy**2)/12);
      I[3]-=m*ox*oy;I[4]-=m*ox*oz;I[5]-=m*oy*oz;
      // r x v with v along z: (r_y v, -r_x v, 0).
      L[0]+=m*oy*v;L[1]-=m*ox*v;p+=m*v;
      const tile=new Float64Array(12);this.pieces[node].vertices.forEach((c,i)=>{tile[3*i]=ox+c[0];tile[3*i+1]=oy+c[1];tile[3*i+2]=oz;});tiles.push(tile);
    }
    const spin=solve3(I,L),release:FragmentRelease={mass:piece.mass,center:[...piece.center],velocity:[0,0,piece.velocity],angularVelocity:spin,inertia:I as FragmentRelease['inertia'],tiles,thickness:this.thickness};
    const rigid=this.rigid!,index=rigid.add(release),state=rigid.state(index),held=rigid.world.bodyMassData(rigid.handle(index)).inertia;
    const pb=[state.mass*state.linearVelocity[0],state.mass*state.linearVelocity[1],state.mass*state.linearVelocity[2]],w=state.angularVelocity;
    const Lb=[held[0]*w[0]+held[3]*w[1]+held[4]*w[2],held[3]*w[0]+held[1]*w[1]+held[5]*w[2],held[4]*w[0]+held[5]*w[1]+held[2]*w[2]];
    const scaleP=Math.max(Math.abs(p),piece.mass*1e-3),scaleL=Math.max(Math.hypot(...L),Math.max(I[0],I[1],I[2])*1e-3);
    this.releaseError.linear=Math.max(this.releaseError.linear,Math.hypot(pb[0],pb[1],pb[2]-p)/scaleP);
    this.releaseError.angular=Math.max(this.releaseError.angular,Math.hypot(Lb[0]-L[0],Lb[1]-L[1],Lb[2]-L[2])/scaleL);
    return index;
  }
  /** With a Box3D world (`options.fragments`) the fragments are its bodies: it steps them and they are read back. Without one
   * they fall as rigid bodies onto the tray or the floor (impulses at the deepest corner, Coulomb friction, no bounce) and do
   * not collide with each other, the frame or the pendulum. */
  private stepFragments(dt:number):void {
    if(this.rigid){
      const rigid=this.rigid;rigid.step(dt);
      for(const f of this.fragments){
        const s=rigid.state(f.body);f.x=s.position;f.q=s.rotation;f.v=s.linearVelocity;f.w=s.angularVelocity;f.resting=s.awake?0:1;
      }
      return;
    }
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
