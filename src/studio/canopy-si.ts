/** The Canopy load study on the calibrated cloth (src/engine/cloth.ts) in SI units. See docs/STUDIO_CANOPY.md.
 *
 * Scene scale: 1 scene unit = 1 m. The canopy is the Studio's 10 m x 8 m sheet of PVC-coated polyester (library
 * `pvc-polyester-fabric`: areal density, orthotropic warp/weft stiffness, warp and weft strength), warp along x,
 * held at its four corners on the posts, with a pretensioned steel edge cable along each side. The fabric is
 * pretensioned by a stress-free shape 0.4% smaller in plan than the drawn one. Loads: its weight, a snow load on the
 * plan area (kPa) and wind by EN 1991-1-4 for a free-standing (canopy) roof: the peak velocity pressure q_p(z) of
 * section 4 (mean wind and gusts, terrain category II) and the net pressure and force coefficients of Table 7.6
 * (monopitch canopy, 0 degrees, empty, phi = 0), applied to the nodes as pressures on the plan area. Triangles tear when
 * the stress along a yarn reaches its strength.
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
/** Basic wind velocity v_b per unit of the crosswind slider, m/s (0 to 2 is 0 to 30 m/s). */
export const CANOPY_WIND_PER_UNIT=15;

// -------------------------------------------------------------------------------------------------------------------------
// Wind on a canopy by EN 1991-1-4:2005+A1:2010 (BS EN copy opened: structuraldynamics.ulb.be/DOS/en.1991.1.4.2005.pdf).
// -------------------------------------------------------------------------------------------------------------------------

/** Table 4.1: roughness length z0 and minimum height z_min, m, per terrain category. */
export const EN1991_TERRAIN={'0':{z0:.003,zmin:1},I:{z0:.01,zmin:1},II:{z0:.05,zmin:2},III:{z0:.3,zmin:5},IV:{z0:1,zmin:10}} as const;
export type TerrainCategory=keyof typeof EN1991_TERRAIN;
/** Recommended air density of 4.5 Note 2, kg/m^3. */
export const EN1991_AIR_DENSITY=1.25;
/**
 * Peak velocity pressure at height z (4.3 to 4.10 with c_o = 1 and k_I = 1, the recommended values):
 *   k_r = 0.19 (z0 / 0.05)^0.07, c_r = k_r ln(max(z, z_min) / z0), v_m = c_r v_b, I_v = 1 / ln(max(z, z_min) / z0),
 *   q_p = [1 + 7 I_v] (1/2) rho v_m^2 (the 7 is a peak factor of 3.5, Note 3: the gust factor of the code).
 * The expressions are images in the copy opened; they were written from the code's text and symbols as read.
 */
export function peakVelocityPressure(vb:number,z:number,terrain:TerrainCategory='II'):{qp:number;qb:number;vm:number;Iv:number;cr:number;exposure:number} {
  const {z0,zmin}=EN1991_TERRAIN[terrain],ze=Math.max(z,zmin),kr=.19*Math.pow(z0/.05,.07),log=Math.log(ze/z0);
  const cr=kr*log,vm=cr*vb,Iv=1/log,qb=.5*EN1991_AIR_DENSITY*vb*vb,qp=(1+7*Iv)*.5*EN1991_AIR_DENSITY*vm*vm;
  return {qp,qb,vm,Iv,cr,exposure:qb>0?qp/qb:(1+7*Iv)*cr*cr};
}
/** Table 7.6, monopitch canopies: per roof angle, [c_f, c_p,net zone A, B, C] for max (all phi), min phi = 0 and min phi = 1. + is downward. */
export const EN1991_TABLE_7_6:Readonly<Record<number,{max:readonly number[];min0:readonly number[];min1:readonly number[]}>>={
  0:{max:[.2,.5,1.8,1.1],min0:[-.5,-.6,-1.3,-1.4],min1:[-1.3,-1.5,-1.8,-2.2]},
  5:{max:[.4,.8,2.1,1.3],min0:[-.7,-1.1,-1.7,-1.8],min1:[-1.4,-1.6,-2.2,-2.5]},
  10:{max:[.5,1.2,2.4,1.6],min0:[-.9,-1.5,-2,-2.1],min1:[-1.4,-1.6,-2.6,-2.7]},
  15:{max:[.7,1.4,2.7,1.8],min0:[-1.1,-1.8,-2.4,-2.5],min1:[-1.4,-1.6,-2.9,-3]},
  20:{max:[.8,1.7,2.9,2.1],min0:[-1.3,-2.2,-2.8,-2.9],min1:[-1.4,-1.6,-2.9,-3]},
  25:{max:[1,2,3.1,2.3],min0:[-1.6,-2.6,-3.2,-3.2],min1:[-1.4,-1.5,-2.5,-2.8]},
  30:{max:[1.2,2.2,3.2,2.4],min0:[-1.8,-3,-3.8,-3.6],min1:[-1.4,-1.5,-2.2,-2.7]},
};
/** Which row of Table 7.6: the largest downward action, or the largest uplift of an empty (phi = 0) or blocked (phi = 1) canopy. */
export type CanopyWindCase='max'|'min0'|'min1';
/** Zone of a point of a canopy d long along the wind and b across (Table 7.6 key plan): B, strips b/10 wide along the two edges parallel to the wind; C, strips d/10 wide at the windward and leeward edges between them; A, the rest. xi in [0, 1] from the windward edge, eta in [0, 1] across. */
export const canopyZone=(xi:number,eta:number):'A'|'B'|'C'=>eta<.1||eta>.9?'B':xi<.1||xi>.9?'C':'A';
/**
 * Net pressure on the plan, Pa, at each node of a canopy for one case (+ downward), in one of two forms:
 *  - 'force': statically equivalent to the overall force coefficient: p = c_f q_p (a + b xi), with a and b chosen so
 *    that the nodal forces sum to c_f q_p A and their centre lies d/4 from the windward edge (Figure 7.16). For the
 *    continuous plan a = 2.5, b = -3; the nodal areas change them slightly.
 *  - 'local': the net pressure coefficients of zones A, B and C, the envelope of local maxima for all wind directions
 *    that the code gives for the roofing and its fixings (7.3(5)); its resultant is larger than c_f q_p A.
 * x0 is the windward edge, d the length along the wind (+x), z0 and b the other plan edge and width.
 */
export function canopyNetPressure(form:'force'|'local',windCase:CanopyWindCase,qp:number,plan:{x:ArrayLike<number>;z:ArrayLike<number>;area:ArrayLike<number>},box:{x0:number;d:number;z0:number;b:number},angle=0):Float64Array {
  const row=EN1991_TABLE_7_6[angle];if(!row)throw new RangeError('Table 7.6 is tabulated at 0, 5, ..., 30 degrees.');
  const c=row[windCase],n=plan.area.length,out=new Float64Array(n);
  if(form==='local'){
    for(let i=0;i<n;i++){const zone=canopyZone((plan.x[i]-box.x0)/box.d,(plan.z[i]-box.z0)/box.b);out[i]=qp*(zone==='A'?c[1]:zone==='B'?c[2]:c[3]);}
    return out;
  }
  // Solve sum A (a + b xi) = A_total and sum A xi (a + b xi) = A_total / 4 on the nodes.
  let s0=0,s1=0,s2=0;for(let i=0;i<n;i++){const xi=(plan.x[i]-box.x0)/box.d,A=plan.area[i];s0+=A;s1+=A*xi;s2+=A*xi*xi;}
  const det=s0*s2-s1*s1,a=(s0*s2-s0*s1/4)/det,b=(s0*s0/4-s1*s0)/det;
  for(let i=0;i<n;i++){const xi=(plan.x[i]-box.x0)/box.d;out[i]=c[0]*qp*(a+b*xi);}
  return out;
}
/** Edge cables: 12 mm steel wire rope, E A about 100 GPa x 85 mm^2 (a typical figure, not from the library), pretensioned 0.3%. */
export const CANOPY_CABLE={axialStiffness:8.5e6,restLengthFactor:.997};
export const CANOPY_PRESTRAIN=.004;
export const CANOPY_NOTE='SI model. Modelled: a PVC-coated polyester membrane with orthotropic warp/weft stiffness and strength from the library (shear stiffness unverified), corner supports, pretensioned steel edge cables, its weight, snow on the plan area, wind uplift by EN 1991-1-4 (peak velocity pressure with its gust factor, terrain II; canopy force coefficient of Table 7.6 placed d/4 from the windward edge), and tearing when a yarn reaches its strength. Not modelled: the fabric\'s nonlinear and creeping response, seams, wind as a flow around the deforming sheet (no flutter, no gust time history), ponding drainage, and tear growth finer than the 0.3 m mesh.';

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
  /** Wind: the plan position of every node, the plan box, the case of Table 7.6 and the pressure form; the peak velocity pressure applied now and its target, Pa. */
  readonly planX:Float64Array;readonly planZ:Float64Array;readonly plan:{x0:number;d:number;z0:number;b:number};readonly height:number;
  windCase:CanopyWindCase='min0';windForm:'force'|'local'='force';
  private qTarget=0;private qNow=0;private readonly windForce:Float64Array;
  /** Rate the wind pressure rises or falls to its target, Pa/s (the snow load ramps at 5.5 kPa/s). */
  static readonly WIND_RAMP=1000;
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
    // Plan position and box (the drawn shape), and the height of the roof above the floor for q_p(z).
    this.planX=Float64Array.from(nodes,p=>p.rest[0]);this.planZ=Float64Array.from(nodes,p=>p.rest[2]);
    {let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(let i=0;i<n;i++){x0=Math.min(x0,this.planX[i]);x1=Math.max(x1,this.planX[i]);z0=Math.min(z0,this.planZ[i]);z1=Math.max(z1,this.planZ[i]);}this.plan={x0,d:x1-x0,z0,b:z1-z0};}
    this.height=this.corners.reduce((sum,c)=>sum+nodes[c].rest[1],0)/4-floorY;
    this.windForce=new Float64Array(n);
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
  /** Snow load on the plan area, Pa, and basic wind velocity v_b along +x, m/s. Snow applies from the next step; the wind pressure ramps to its target at WIND_RAMP. */
  setLoads(snow:number,windSpeed:number):void {
    if(windSpeed!==this.windSpeed){this.windSpeed=windSpeed;this.qTarget=windSpeed>0?peakVelocityPressure(windSpeed,this.height).qp:0;}
    if(snow!==this.snow){this.snow=snow;this.applyLoads();}
  }
  get snowLoad():number {return this.snow;}
  /** Peak velocity pressure applied now and its target, Pa. */
  get windPressure():number {return this.qNow;}
  get windTarget():number {return this.qTarget;}
  /** Nodal wind forces now (vertical, + up), N. */
  get windForces():Float64Array {return this.windForce;}
  /** The vertical resultant of the applied wind, N (+ up), and its centre along the wind measured from the windward edge, m. */
  windResultant():{force:number;centre:number} {let f=0,m=0;for(let i=0;i<this.windForce.length;i++){f+=this.windForce[i];m+=this.windForce[i]*(this.planX[i]-this.plan.x0);}return {force:f,centre:f!==0?m/f:NaN};}
  /** Nodal forces: snow down on the plan area, wind as net pressure on the plan (+ c_p,net down) at the current q. */
  private applyLoads():void {
    const p=this.qNow>0?canopyNetPressure(this.windForm,this.windCase,this.qNow,{x:this.planX,z:this.planZ,area:this.area},this.plan):null;
    for(let i=0;i<this.area.length;i++){this.windForce[i]=p?-p[i]*this.area[i]:0;this.cloth.setNodalForce(i,[0,-this.snow*this.area[i]+this.windForce[i],0]);}
  }
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
      let changed=false;for(let i=0;i<alive.length;i++)if(!alive[i]&&this.area[i]>0){this.area[i]=0;changed=true;}
      if(changed)this.applyLoads();
    }
    if(this.qNow!==this.qTarget){const r=StudioCanopySI.WIND_RAMP*this.dt;this.qNow=Math.abs(this.qTarget-this.qNow)<=r?this.qTarget:this.qNow+Math.sign(this.qTarget-this.qNow)*r;this.applyLoads();}
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
