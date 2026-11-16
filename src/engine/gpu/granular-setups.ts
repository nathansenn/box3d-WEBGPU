/**
 * Grain set-ups shared by the GPU checks (probe.ts), the gate's tests of the float32 reference and the Lab example at
 * scale. Each returns a fresh float64 Granular with its grains and walls: the backends are built from it.
 */
import {Granular,granularLattice,type GranularMaterial} from '../granular.ts';

const R=0.005,D=2*R,MASS=2500*Math.PI/6*D*D*D;
/** Linear springs of k_n = 4000 m g / d: the stiffness of the float64 solver's silo validation. */
const SOFT={law:'linear' as const,normalStiffness:4000*MASS*9.81/D};
function stepOf(material:GranularMaterial,config:Record<string,unknown>,radius:number,fraction:number):number {
  return fraction*new Granular({material,config:{...config,dt:1e-12,capacity:1}}).criticalTimeFor(radius);
}

/** Beads of 9 to 11 mm dropped into an open box: linear law, friction and rolling resistance, five planes. */
export function beadBox(n:readonly [number,number,number]=[6,10,6],seed=7):Granular {
  const material={density:2500,restitution:0.3,friction:0.5,rollingFriction:0.05},pitch=2.2*R,w=n[0]*pitch,d=n[2]*pitch;
  const lattice=granularLattice({min:[0,0.5*R,0],max:[w,0.5*R+n[1]*pitch,d],radius:[0.9*R,1.1*R],gap:0,jitter:1,seed});
  const g=new Granular({material,config:{...SOFT,dt:stepOf(material,SOFT,0.9*R,0.12),capacity:lattice.count}});
  g.addWall({shape:{kind:'plane',normal:[0,1,0]}});
  g.addWall({shape:{kind:'plane',normal:[1,0,0]}});g.addWall({shape:{kind:'plane',normal:[-1,0,0]},position:[w,0,0]});
  g.addWall({shape:{kind:'plane',normal:[0,0,1]}});g.addWall({shape:{kind:'plane',normal:[0,0,-1]},position:[0,0,d]});
  g.addGrains(lattice.positions,lattice.radii);
  return g;
}
/**
 * Every wall shape at once, with the Hertz law: a cylinder on a conical hopper over a ring, a turning box and a lying
 * capsule (kinematic), a free sphere (dynamic) dropped on the fill, and bounds below the outlet that remove the grains
 * that fall through.
 */
export function hopperMixer(seed=3):Granular {
  const material={density:2500,youngModulus:5e6,poissonRatio:0.3,restitution:0.5,friction:0.4,rollingFriction:0.1};
  const lattice=granularLattice({min:[-0.04,0.06,-0.04],max:[0.04,0.17,0.04],radius:[0.9*R,1.1*R],gap:0,jitter:1,seed,inside:(x,_y,z)=>x*x+z*z<0.033*0.033});
  const g=new Granular({material,config:{dt:stepOf(material,{},0.9*R,0.15),capacity:lattice.count,bounds:{min:[-0.1,-0.03,-0.1],max:[0.1,1,0.1]}}});
  g.addWall({shape:{kind:'cylinder',radius:0.04,from:0.03,to:0.4}});
  g.addWall({shape:{kind:'frustum',r0:0.04,z0:0.03,r1:0.014,z1:0}});
  g.addWall({shape:{kind:'annulus',innerRadius:0.008,outerRadius:0.02},friction:0.3});
  g.addWall({shape:{kind:'box',halfExtents:[0.03,0.004,0.004]},type:'kinematic',position:[0,0.05,0],angularVelocity:[0,6,0]});
  g.addWall({shape:{kind:'capsule',radius:0.004,halfLength:0.02},type:'kinematic',position:[0,0.1,0],rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2],angularVelocity:[0,-4,0]});
  g.addWall({shape:{kind:'sphere',radius:0.012},type:'dynamic',mass:0.02,position:[0.004,0.2,0.002],restitution:0.4});
  g.addGrains(lattice.positions,lattice.radii);
  return g;
}

/**
 * A sand avalanche at scale: `count` coarse grains (to the lattice's rounding) of 7.2 to 8.8 mm released behind a gate on
 * a slope of 30 degrees between two side walls. The heap is about four times as wide and long as it is deep. Linear
 * springs, as stiff as the step allows: the step is set so that a grain at the bottom of the heap overlaps its
 * neighbours by about 5% of its radius under the weight above (softer and the heap would squash; stiffer needs a
 * smaller step). The gate is the last wall: disable it to release the heap. Written in the frame of the slope: the
 * slope is the plane y = 0 and gravity is tilted.
 */
export function sandAvalanche(count:number,seed=11):{granular:Granular;gate:number;slope:number;width:number;length:number;height:number;radius:number;stepsPerSecond:number} {
  const r=0.004,material={density:2650,restitution:0.2,friction:0.6,rollingFriction:0.15},mass=2650*4/3*Math.PI*r*r*r,pitch=2.2*r,slope=Math.PI/6;
  const side=Math.max(4,Math.round(Math.cbrt(4*count))),ny=Math.max(2,Math.round(count/(side*side)));
  // Overlap over radius at the bottom = layers * m g / (k r) = 5%, with k = (m / 2) (pi / t_c)^2: t_c^2 = 0.05 pi^2 r / (2 layers g).
  const contact=Math.sqrt(0.05*Math.PI*Math.PI*r/(2*ny*9.81)),stepsPerSecond=Math.ceil(1/(0.18*contact)/60)*60,dt=1/stepsPerSecond;
  // The lightest pair (two grains of 0.9 r) sets the contact duration the step is 17% of.
  const kn=.5*0.729*mass*(Math.PI*0.17/dt)**2;
  const width=side*pitch,length=side*pitch,height=ny*pitch;
  const lattice=granularLattice({min:[0,0,0],max:[length,height,width],radius:[0.9*r,1.1*r],gap:0,jitter:1,seed});
  const g=new Granular({material,config:{law:'linear',normalStiffness:kn,dt,capacity:lattice.count,gravity:[9.81*Math.sin(slope),-9.81*Math.cos(slope),0],bounds:{min:[-length,-1,-width],max:[60*length,100*height+1,2*width]}}});
  g.addWall({shape:{kind:'plane',normal:[0,1,0]},rollingFriction:0.3});
  g.addWall({shape:{kind:'plane',normal:[1,0,0]}});
  g.addWall({shape:{kind:'plane',normal:[0,0,1]},friction:0});g.addWall({shape:{kind:'plane',normal:[0,0,-1]},position:[0,0,width],friction:0});
  const gate=g.addWall({shape:{kind:'plane',normal:[-1,0,0]},position:[length,0,0]});
  g.addGrains(lattice.positions,lattice.radii);
  return {granular:g,gate,slope,width,length,height,radius:r,stepsPerSecond};
}
export const GRANULAR_SETUPS:Record<string,()=>{granular:Granular;steps:number}>={
  'bead-box':()=>({granular:beadBox(),steps:500}),
  'hopper-mixer':()=>({granular:hopperMixer(),steps:500}),
};
