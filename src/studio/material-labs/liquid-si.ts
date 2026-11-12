/**
 * SI properties of the Studio's liquids, the validated free-surface flume and the pipe friction law.
 *
 * Liquids drawn from the sourced material library (src/engine/materials.ts, docs/MATERIALS.md) say so; the others carry
 * an estimate marked unverified, with the reason. The flume runs FreeSurfaceFluid (src/engine/fluid.ts, docs/FLUID.md):
 * a 3D incompressible liquid with viscosity, a lifting gate and two posts, in metres, kilograms and seconds.
 * See docs/STUDIO_FLOW_LABS.md.
 */
import {materialValue} from '../../engine/materials';
import {FreeSurfaceFluid} from '../../engine/fluid';

export interface LiquidSI {readonly density:number;readonly viscosity:number;readonly library?:string;readonly verified:boolean;readonly note:string;}
const lib=(id:string,note=''):LiquidSI=>{
  const d=materialValue(id,'density')!,m=materialValue(id,'viscosity')!;
  const verified=d.source!=='unverified'&&m.source!=='unverified';
  return {density:d.value,viscosity:m.value,library:id,verified,note:note||(verified?`Material library: ${id}.`:`Material library: ${id} (density unverified).`)};
};
const est=(density:number,viscosity:number,what:string):LiquidSI=>({density,viscosity,verified:false,note:`Unverified estimate (${what}); no source was opened for this liquid.`});
/** Newtonian density (kg/m^3) and dynamic viscosity (Pa s) at about 20 °C for each Studio liquid profile. */
export const LIQUID_SI:Readonly<Record<string,LiquidSI>>={
  water:lib('water'),freshwater:lib('water','Material library: water (fresh river water taken as pure water).'),
  oil:lib('olive-oil','Material library: olive oil (refined), 79.7 mPa s at 20 °C.'),glycerin:lib('glycerol','Material library: anhydrous glycerol, 1.412 Pa s at 20 °C.'),
  honey:lib('honey','Material library: honey, 7.43 Pa s at 20 °C (density unverified).'),
  seawater:est(1025,1.08e-3,'sea water, 35 g/kg salt'),brine:est(1200,1.8e-3,'concentrated salt solution'),coolant:est(1040,2.0e-3,'water with some glycol'),
  antifreeze:est(1070,3.5e-3,'about 50% ethylene glycol'),ink:est(1060,2.0e-3,'water-based ink'),milk:est(1030,2.0e-3,'whole milk'),
  diesel:est(840,3.0e-3,'diesel fuel'),'hydraulic-oil':est(870,0.04,'ISO VG 46 hydraulic oil near 40 °C'),emulsion:est(1080,0.05,'a light oil-in-water emulsion'),
  slurry:est(1600,0.05,'mineral slurry as a Newtonian liquid'),mud:est(1500,0.5,'mud as a Newtonian liquid; no yield stress'),'silicone-oil':est(970,0.97,'1000 cSt silicone oil'),
  syrup:est(1330,2.5,'dark syrup'),soap:est(1020,1.5,'liquid soap'),paint:est(1250,0.5,'paint at low shear'),shampoo:est(1040,5,'shampoo at low shear'),
  resin:est(1150,5,'uncured resin'),molasses:est(1420,10,'molasses'),'silicone-gel':est(1080,30,'a very thick Newtonian surrogate; no yield stress'),
};
export const liquidSI=(id:string):LiquidSI=>LIQUID_SI[id]??LIQUID_SI.water;

/**
 * Darcy friction factor of fully developed pipe flow. Laminar (Re < 2300): f = 64 / Re (Hagen-Poiseuille, exact).
 * Turbulent (Re > 4000): the Colebrook equation 1 / sqrt(f) = -2 log10(e / 3.7 D + 2.51 / (Re sqrt(f))), a correlation
 * fitted to measurements (Colebrook 1939; the Moody chart plots it), solved by fixed-point iteration. Between 2300 and
 * 4000 the flow is transitional and no law holds; f is interpolated linearly in Re between the two, a convention only.
 */
export function frictionFactor(reynolds:number,relativeRoughness=0):number {
  if(!(reynolds>0))return 0;
  const colebrook=(re:number)=>{let x=1/Math.sqrt(.02);for(let i=0;i<40;i++){const next=-2*Math.log10(relativeRoughness/3.7+2.51*x/re);if(Math.abs(next-x)<1e-12){x=next;break;}x=next;}return 1/(x*x);};
  if(reynolds<2300)return 64/reynolds;
  if(reynolds>4000)return colebrook(reynolds);
  const t=(reynolds-2300)/1700;return (1-t)*64/2300+t*colebrook(4000);
}

// -------------------------------------------------------------------------------------------------------------------------
// The flume.
// -------------------------------------------------------------------------------------------------------------------------

export interface FlumeSettings {
  /** Reservoir depth behind the gate, m. */depth:number;
  /** Largest gate lift, m, and lift speed, m/s. */lift:number;liftSpeed:number;
  /** Initial depth downstream of the gate, m. */downstream:number;
  /** Bed slope, % (taken as a tilt of gravity). */slope:number;
  density:number;viscosity:number;
  /** Gate opened fully at the start and a cosine surface (the "reflected wave" case). */pulse:boolean;
}
/** Flume interior: x from -3 to 3 m, z from -1 to 1 m, bed at y = 0 (the scene adds its datum), walls 1.1 m high. */
export const FLUME={length:6,width:2,height:1.125,gateX:-3+27*6/84,gateThickness:.1,posts:[[1.25,.48],[2,-.42]] as [number,number][],postRadius:.2,cell:.125};
export const FLUME_SOLVER_STEP=1/60;

export class FlumeSI {
  readonly fluid:FreeSurfaceFluid;readonly gate:number;readonly settings:FlumeSettings;readonly viscous:boolean;readonly noSlip:boolean;
  /** Liquid volume per solver column (m) over x, z: nx * nz. */
  readonly columns:Float64Array;readonly columnU:Float64Array;readonly columnW:Float64Array;
  time=0;private lastSpeed=0;
  constructor(settings:FlumeSettings){
    this.settings=settings;const h=FLUME.cell,nx=Math.round(FLUME.length/h),ny=Math.round(FLUME.height/h),nz=Math.round(FLUME.width/h);
    const angle=Math.atan(settings.slope/100),g=9.81;
    // Viscosity whose diffusion over one cell in one solver step, nu dt / h^2, is below 1e-5 changes the velocity by less
    // than that fraction per step: it is left out (water and the light liquids at this cell size).
    this.viscous=settings.viscosity/settings.density*FLUME_SOLVER_STEP/(h*h)>=1e-5;
    // A no-slip wall interpolates the particles' velocity to zero over the half cell next to it. That is right only when
    // the viscous boundary layer, sqrt(nu t), reaches half a cell within the run (18 s): nu >= h^2 / (4 * 18 s). Thinner
    // layers are not resolved on this grid and the walls are free-slip (wall friction left out).
    this.noSlip=this.viscous&&settings.viscosity/settings.density>=h*h/(4*18);
    this.fluid=new FreeSurfaceFluid({cells:[nx,ny,nz],spacing:h,origin:[-3,0,-1],density:settings.density,viscosity:this.viscous?settings.viscosity:0,walls:this.noSlip?'no-slip':'free-slip',dt:FLUME_SOLVER_STEP,gravity:[g*Math.sin(angle),-g*Math.cos(angle),0],cflLimit:1});
    for(const [x,z] of FLUME.posts)this.fluid.addObstacle({shape:{kind:'cylinder',radius:FLUME.postRadius,halfLength:FLUME.height},position:[x,0,z]});
    this.gate=this.fluid.addObstacle({shape:{kind:'box',halfExtents:[FLUME.gateThickness/2,FLUME.height,FLUME.width]},position:this.gatePosition(0)});
    const gx=FLUME.gateX;
    if(settings.pulse)this.fluid.addLiquid((x,y)=>y<settings.depth*.65+.08*Math.cos((x+3)*Math.PI/3));
    else this.fluid.addLiquid((x,y)=>x<gx-FLUME.gateThickness/2?y<settings.depth:x>gx+FLUME.gateThickness/2&&y<settings.downstream);
    this.columns=new Float64Array(nx*nz);this.columnU=new Float64Array(nx*nz);this.columnW=new Float64Array(nx*nz);this.measure();
  }
  /** Gate lift at a time, m. */
  lift(time:number,released=false):number {return this.settings.pulse||released?FLUME.height*2:Math.min(this.settings.lift,time*this.settings.liftSpeed);}
  private gatePosition(lift:number):[number,number,number] {return [FLUME.gateX,FLUME.height+lift,0];}
  /** Advance by dt seconds in substeps of at most 1/60 s and a Courant number of 0.8. */
  step(dt:number,released=false):void {
    const h=FLUME.cell;let left=dt;
    while(left>1e-12){
      const limit=Math.min(FLUME_SOLVER_STEP,.8*h/Math.max(this.lastSpeed,1e-6)),n=Math.ceil(left/limit-1e-9),sub=left/n;
      const lift=this.lift(this.time+sub,released),moving=!released&&!this.settings.pulse&&lift<this.settings.lift;
      this.fluid.moveObstacle(this.gate,this.gatePosition(lift),[0,moving?this.settings.liftSpeed:0,0]);
      this.fluid.setTimeStep(sub);this.fluid.step();this.time+=sub;left-=sub;
      this.lastSpeed=this.fluid.stats.cfl*h/sub;
    }
    this.measure();
  }
  /**
   * Column depths and mean horizontal velocities from the particles. A cell counts as full when it holds its seeded share of
   * particles (8) or more, partly full in proportion below that; the depth is the sum over the column. Particles crowded
   * against a wall therefore do not raise the drawn surface above the cells they occupy.
   */
  private measure():void {
    const f=this.fluid,h=f.h,nx=f.nx,ny=f.ny,nz=f.nz,X=f.positions,V=f.velocities,share=f.perAxis**3,count=this.cellCount??=new Uint16Array(nx*ny*nz);
    this.columns.fill(0);this.columnU.fill(0);this.columnW.fill(0);count.fill(0);
    const n=new Float64Array(nx*nz);
    for(let p=0;p<f.count;p++){
      const i=Math.min(nx-1,Math.max(0,Math.floor((X[3*p]+3)/h))),j=Math.min(ny-1,Math.max(0,Math.floor(X[3*p+1]/h))),k=Math.min(nz-1,Math.max(0,Math.floor((X[3*p+2]+1)/h))),c=k*nx+i;
      count[i+nx*(j+ny*k)]++;n[c]++;this.columnU[c]+=V[3*p];this.columnW[c]+=V[3*p+2];
    }
    for(let k=0;k<nz;k++)for(let i=0;i<nx;i++){
      const c=k*nx+i;let d=0;for(let j=0;j<ny;j++)d+=Math.min(1,count[i+nx*(j+ny*k)]/share);
      this.columns[c]=d*h;if(n[c]>0){this.columnU[c]/=n[c];this.columnW[c]/=n[c];}
    }
  }
  private cellCount?:Uint16Array;
  /** Bilinear depth and velocity at a plan position (x in [-3, 3], z in [-1, 1]), from the column fields. */
  sample(x:number,z:number):[number,number,number] {
    const f=this.fluid,h=f.h,nx=f.nx,nz=f.nz,sx=Math.min(nx-1,Math.max(0,(x+3)/h-.5)),sz=Math.min(nz-1,Math.max(0,(z+1)/h-.5));
    const i=Math.min(nx-2,Math.floor(sx)),k=Math.min(nz-2,Math.floor(sz)),fx=sx-i,fz=sz-k;let d=0,u=0,w=0;
    for(const [di,dk,wt] of [[0,0,(1-fx)*(1-fz)],[1,0,fx*(1-fz)],[0,1,(1-fx)*fz],[1,1,fx*fz]] as const){const c=(k+dk)*nx+i+di;d+=wt*this.columns[c];u+=wt*this.columnU[c]*this.columns[c];w+=wt*this.columnW[c]*this.columns[c];}
    return [d,d>1e-9?u/d:0,d>1e-9?w/d:0];
  }
  peakDepth():number {let m=0;for(const d of this.columns)m=Math.max(m,d);return m;}
  /** Largest depth-averaged horizontal speed of a column holding at least 1 cm of liquid, m/s. */
  peakSpeed():number {let m=0;for(let c=0;c<this.columns.length;c++)if(this.columns[c]>.01)m=Math.max(m,Math.hypot(this.columnU[c],this.columnW[c]));return m;}
  volume():number {return this.fluid.particleVolume();}
}
