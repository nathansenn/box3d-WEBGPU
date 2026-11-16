/**
 * Shallow-water set-ups shared by the GPU checks (probe.ts), the gate's tests of the float32 reference and the Lab
 * example at scale. Each returns the options of a float64 ShallowWater: the backends are built from one.
 */
import {thackerBed,thackerDepth,thackerFrequency,type ShallowWaterOptions} from '../shallow-water.ts';

const LOAM={conductivity:0.34/100/3600,suction:0.0889,moistureDeficit:0.434*0.7};
/** Set-ups for the agreement, repeatability and device-loss checks. */
export const SHALLOW_WATER_SETUPS:Record<string,()=>{options:ShallowWaterOptions;steps:number}>={
  // Thacker's paraboloid: a moving shoreline in two dimensions.
  thacker:()=>{const P={h0:0.1,a:1,r0:0.8,centre:[2,2] as const};return {steps:40,options:{cells:[64,64],spacing:4/64,bed:(x,z)=>thackerBed(x,z,P),depth:(x,z)=>thackerDepth(x,z,0,P),dt:2*Math.PI/thackerFrequency(P.h0,P.a)/100}};},
  // Everything at once: an inflow, an open side, rain, infiltration on half the cells, friction, wetting and drying.
  everything:()=>{const nx=48,nz=32;return {steps:120,options:{cells:[nx,nz],spacing:0.25,bed:(x,z)=>0.02*(12-x)+0.15*Math.sin(z)**2,depth:(x,_z,b)=>(x<3?Math.max(0,0.3-b):0),manning:0.03,
    soil:Array.from({length:nx*nz},(_,c)=>(c%nx<nx/2?LOAM:null)),rain:1e-4,dt:0.05,boundaries:{xMin:{type:'inflow',discharge:0.2},xMax:'open'}}};},
  // A dam break over a dry bed in one dimension.
  ritter:()=>({steps:40,options:{cells:[200,1],spacing:0.05,depth:x=>(x<=5?0.005:0),dt:0.1,boundaries:{xMax:'open'}}}),
  // Solid cells (a pier) in a channel with a stage outlet.
  pier:()=>{const nx=60,nz=24,solid=new Uint8Array(nx*nz);for(let k=9;k<15;k++)for(let i=20;i<26;i++)solid[i+nx*k]=1;
    return {steps:80,options:{cells:[nx,nz],spacing:0.1,bed:x=>0.01*(6-x),level:0.25,solid,manning:0.02,dt:0.02,boundaries:{xMin:{type:'inflow',discharge:0.3},xMax:{type:'stage',level:0.2}}}};},
};

/** A valley with a river bed and side slopes, a reservoir behind where a dam stood, Manning friction, an open foot. */
export function floodValley(n:number,length=1000):ShallowWaterOptions {
  const dx=length/n;
  const bed=(x:number,z:number):number=>{
    const t=x/length,c=length*(.5+.18*Math.sin(5*t)),across=(z-c)/length;
    return 30*(1-t)+90*across*across*4+2.5*Math.sin(.031*x)*Math.cos(.027*z)+1.2*Math.sin(.11*x+.07*z);
  };
  return {cells:[n,n],spacing:dx,bed,depth:(x,_z,b)=>(x<.22*length?Math.max(0,34-b):0),manning:0.035,dt:1/60*Math.max(1,length/1000),boundaries:{xMax:'open'},maxSubsteps:4096};
}

