/** The Canopy load study on the calibrated cloth (src/engine/cloth.ts) in SI units. See docs/STUDIO_CANOPY.md.
 *
 * Scene scale: 1 scene unit = 1 m. The canopy is the Studio's 10 m x 8 m sheet of PVC-coated polyester (library
 * `pvc-polyester-fabric`: areal density, orthotropic warp/weft stiffness, warp and weft strength), warp along x,
 * held at its four corners on the posts, with a pretensioned steel edge cable along each side. The fabric is
 * pretensioned by a stress-free shape 0.4% smaller in plan than the drawn one. Loads: its weight, a snow load on the
 * plan area (kPa) and wind as a normal pressure from a wind speed. Triangles tear when the stress along a yarn
 * reaches its strength.
 */
import {Cloth,CLOTH_SOLVER_ID} from '../engine/cloth.ts';
import {fabricMaterial} from '../engine/materials.ts';
import type {StateObject} from '../engine/checkpoint.ts';

/** The form-found cloth state per set-up: the static solve takes 1 to 2 s (more in a loaded browser), and every reset
 * and the page's drawing copy repeat it. The cloth's exact state (Cloth.saveState) is reused, so a canopy built from the
 * cache is bit-identical to one that solved again. */
const formFound=new Map<string,StateObject>();
/** Forget the cached form-found states (tests compare a cached build with a fresh solve). */
export function clearCanopyFormCache():void {formFound.clear();}

export const CANOPY_SI_MODEL=CLOTH_SOLVER_ID;
/** Uniform load on the plan area per unit of target load, Pa (the slider's 0 to 5 is 0 to 50 kPa: snow loads are 0.5 to 3 kPa, the rest is a test to failure). */
export const CANOPY_SNOW_PER_LOAD=10000;
/** Wind speed per unit of the crosswind slider, m/s (0 to 2 is 0 to 30 m/s). */
export const CANOPY_WIND_PER_UNIT=15;
/** Edge cables: 12 mm steel wire rope, E A about 100 GPa x 85 mm^2 (a typical figure, not from the library), pretensioned 0.3%. */
export const CANOPY_CABLE={axialStiffness:8.5e6,restLengthFactor:.997};
export const CANOPY_PRESTRAIN=.004;
export const CANOPY_NOTE='SI model. Modelled: a PVC-coated polyester membrane with orthotropic warp/weft stiffness and strength from the library (shear stiffness unverified), corner supports, pretensioned steel edge cables, its weight, snow on the plan area and wind as a normal pressure, and tearing when a yarn reaches its strength. Not modelled: the fabric\'s nonlinear and creeping response, seams, wind as a flow (no suction or gusts), ponding drainage, and tear growth finer than the 0.3 m mesh.';

export interface CanopyNodeView {readonly rest:readonly number[]}
export class StudioCanopySI {
  readonly cloth:Cloth;readonly corners:number[];readonly area:Float64Array;
  /** Rest (equilibrium under weight and pretension) height of every node, m. */
  readonly settled:Float64Array;
  readonly dt:number;
  /** Tensile strength along warp and weft, N/m (library value times the Studio's strength factor). */
  strengthWarp:number;strengthWeft:number;
  private readonly baseStrength:[number,number];private strengthScale:number;
  solveSeconds=0;modelSeconds=0;
  private snow=0;private windSpeed=0;
  constructor(nodes:readonly CanopyNodeView[],triangles:readonly number[],cols:number,rows:number,dt:number,strengthScale=1,floorY=0){
    const n=nodes.length,positions=new Float64Array(3*n),rest=new Float64Array(3*n);
    let cx=0,cz=0;for(const p of nodes){cx+=p.rest[0]/n;cz+=p.rest[2]/n;}
    nodes.forEach((p,i)=>{for(let k=0;k<3;k++)positions[3*i+k]=p.rest[k];rest[3*i]=cx+(p.rest[0]-cx)*(1-CANOPY_PRESTRAIN);rest[3*i+1]=p.rest[1];rest[3*i+2]=cz+(p.rest[2]-cz)*(1-CANOPY_PRESTRAIN);});
    const corner=(i:number,j:number)=>j*cols+i;
    this.corners=[corner(0,0),corner(cols-1,0),corner(0,rows-1),corner(cols-1,rows-1)];
    const base=fabricMaterial('pvc-polyester-fabric',{warpDirection:[1,0,0],allowUnverified:true});
    const material={...base,strength:{warp:base.strength.warp*strengthScale,weft:base.strength.weft*strengthScale}};
    this.strengthWarp=material.strength.warp;this.strengthWeft=material.strength.weft;this.baseStrength=[base.strength.warp,base.strength.weft];this.strengthScale=strengthScale;
    const side=(list:number[])=>({nodes:list,...CANOPY_CABLE});
    const row=(j:number)=>Array.from({length:cols},(_,i)=>corner(i,j)),col=(i:number)=>Array.from({length:rows},(_,j)=>corner(i,j));
    this.dt=dt;
    this.cloth=new Cloth({positions,restPositions:rest,triangles,material,pinned:this.corners,cables:[side(row(0)),side(row(rows-1)),side(col(0)),side(col(cols-1))],
      config:{dt,gravity:[0,-9.81,0],drag:1.5,maxNewtonIterations:60},contact:{offset:.01}});
    this.cloth.addBody({shape:{kind:'plane',normal:[0,1,0]},type:'static',position:[0,floorY,0],rotation:[0,0,0,1],friction:.3});
    // Plan area per node: a third of each triangle's horizontal projection.
    this.area=new Float64Array(n);
    for(let t=0;t<triangles.length;t+=3){
      const a=triangles[t],b=triangles[t+1],c=triangles[t+2],A=Math.abs((positions[3*b]-positions[3*a])*(positions[3*c+2]-positions[3*a+2])-(positions[3*c]-positions[3*a])*(positions[3*b+2]-positions[3*a+2]))/2;
      this.area[a]+=A/3;this.area[b]+=A/3;this.area[c]+=A/3;
    }
    // Form finding: the pretensioned sheet under its own weight (once per set-up and realm, see formFound).
    const key=JSON.stringify([cols,rows,dt,strengthScale,floorY,triangles.length,Array.from(positions)]),found=formFound.get(key);
    if(found)this.cloth.restoreState(found);else{this.cloth.solveStatic();formFound.set(key,this.cloth.saveState());}
    this.settled=Float64Array.from({length:n},(_,i)=>this.cloth.positions[3*i+1]);
  }
  /** Snow load on the plan area, Pa, and wind speed along x, m/s. Applied from the next step. */
  setLoads(snow:number,windSpeed:number):void {
    if(snow!==this.snow){this.snow=snow;for(let i=0;i<this.area.length;i++)this.cloth.setNodalForce(i,[0,-snow*this.area[i],0]);}
    if(windSpeed!==this.windSpeed){this.windSpeed=windSpeed;this.cloth.setWind(windSpeed>0?{velocity:[windSpeed,0,.3*windSpeed],airDensity:1.204,coefficient:1}:null);}
  }
  get snowLoad():number {return this.snow;}
  /** Fabric strength as a multiple of the library's. */
  setStrengthScale(scale:number):void {
    if(scale===this.strengthScale)return;this.strengthScale=scale;
    this.strengthWarp=this.baseStrength[0]*scale;this.strengthWeft=this.baseStrength[1]*scale;this.cloth.setStrength({warp:this.strengthWarp,weft:this.strengthWeft});
  }
  step():void {
    const start=performance.now();
    // Snow on fabric that has torn away from every triangle round a node slides off: its node keeps only its own weight.
    if(this.cloth.tornCount>this.tornSeen){
      this.tornSeen=this.cloth.tornCount;const mask=this.cloth.tornMask,alive=new Uint8Array(this.area.length),tri=this.cloth.triangles;
      for(let t=0;t<mask.length;t++)if(!mask[t])for(let q=0;q<3;q++)alive[tri[3*t+q]]=1;
      for(let i=0;i<alive.length;i++)if(!alive[i]&&this.area[i]>0){this.area[i]=0;this.cloth.setNodalForce(i,[0,0,0]);}
    }
    this.cloth.step();this.solveSeconds+=(performance.now()-start)/1000;this.modelSeconds+=this.dt;
  }
  private tornSeen=0;
  /** Total vertical support reaction at the four corners, N (up positive). */
  supportReaction():number {const r=this.cloth.reactions;let s=0;for(const c of this.corners)s+=r[3*c+1];return s;}
  /** Utilisation of the most stressed yarn at each node: the largest yarn stress over strength of the triangles around it. */
  utilisation(out:Float64Array,triangles:readonly number[]):Float64Array {
    out.fill(0);const y=[0,0],warp=this.strengthWarp,weft=this.strengthWeft;
    for(let t=0;t<triangles.length/3;t++){
      if(this.cloth.tornMask[t]){continue;}
      this.cloth.yarnStress(t,y);const u=Math.max(y[0]/warp,y[1]/weft,0);
      for(let q=0;q<3;q++){const i=triangles[3*t+q];if(u>out[i])out[i]=u;}
    }
    return out;
  }
  get realTimeFactor():number {return this.solveSeconds>0?this.modelSeconds/this.solveSeconds:0;}
}
