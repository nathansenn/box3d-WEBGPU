/**
 * Fluid set-ups shared by the GPU checks (probe.ts), the gate's tests and the Lab example. Each returns a fresh float64
 * Fluid with its starting state and a number of steps; the backends are built from it. A set-up with a moving obstacle
 * has `beforeStep`, which poses it on the fluid before each step (a backend built from that fluid takes the pose).
 */
import {Fluid,taylorGreenVelocity} from '../fluid.ts';

const P='periodic',ALL={xMin:P,xMax:P,yMin:P,yMax:P,zMin:P,zMax:P} as const,FLAT={zMin:P,zMax:P} as const;
/** The Taylor-Green vortex of the float64 validation, 32 x 32, explicit viscosity, central advection. */
export function taylorGreenFluid(n=32):Fluid {
  const L=2*Math.PI,nu=0.01,h=L/n,f=new Fluid({cells:[n,n,1],spacing:h,density:1,viscosity:nu,dt:0.4*h/2,gravity:[0,0,0],boundaries:ALL});
  f.setVelocity((x,y)=>taylorGreenVelocity(x,y,0,{nu}));return f;
}
/** A cubic lid-driven cavity, Re = 100 on the side, backward Euler, n^3 cells (a 3D flow with walls on every side). */
export function cavity3d(n=16,re=100):Fluid {
  const h=1/n;return new Fluid({cells:[n,n,n],spacing:h,density:1,viscosity:1/re,dt:0.5*h,gravity:[0,0,0],diffusion:'backward-euler',boundaries:{yMax:{type:'no-slip',velocity:[1,0,0]}},cflLimit:2});
}
/** A 2D channel with a parabolic inflow (Re 10) and an outflow, Crank-Nicolson, upwind advection. (Gravity is left out: with a p = 0 outflow it would drain the channel.) */
export function openChannel(n=12):Fluid {
  const H=0.02,h=H/n,peak=0.05;
  return new Fluid({cells:[4*n,n,1],spacing:h,density:900,viscosity:0.09,dt:0.02,gravity:[0,0,0],advection:'upwind',diffusion:'crank-nicolson',
    boundaries:{xMin:{type:'inflow',velocity:(_x,y)=>[4*peak*y*(H-y)/(H*H),0,0]},xMax:'outflow',...FLAT}});
}
/** A 2D channel (Re 20 on the cylinder) with a parabolic inflow, an outflow and a fixed cylinder across it a quarter of the way along, Crank-Nicolson, upwind. */
export function cylinderChannel(n=16):Fluid {
  const H=0.04,h=H/n,peak=0.02,f=new Fluid({cells:[3*n,n,1],spacing:h,density:1000,viscosity:0.004,dt:0.25*h/peak,gravity:[0,0,0],advection:'upwind',diffusion:'crank-nicolson',
    boundaries:{xMin:{type:'inflow',velocity:(_x,y)=>[4*peak*y*(H-y)/(H*H),0,0]},xMax:'outflow',...FLAT}});
  f.addObstacle({shape:{kind:'cylinder',radius:0.1*H,halfLength:h},position:[0.75*H,0.5*H+0.1*h,0.5*h],rotation:[Math.SQRT1_2,0,0,Math.SQRT1_2]});
  return f;
}
/** A sphere moving and turning through water in a closed 16^3 box under gravity (explicit viscosity, central advection); moveSphere sets its pose for step k. */
export function movingSphere(n=16):Fluid {
  const L=0.08,h=L/n,f=new Fluid({cells:[n,n,n],spacing:h,density:1000,viscosity:2e-3,dt:2e-3,gravity:[0,-9.81,0]});
  f.addObstacle({shape:{kind:'sphere',radius:0.12*L},position:[0.35*L,0.5*L,0.5*L]});
  f.setPressure((_x,y)=>1000*9.81*(L-y));
  return f;
}
export function moveSphere(f:Fluid,step:number):void {
  const L=0.08,v=[0.05,0.02,-0.01],t=step*f.dt,angle=8*t;
  f.setObstacleState(0,{position:[0.35*L+v[0]*t,0.5*L+v[1]*t,0.5*L+v[2]*t],rotation:[0,Math.sin(angle/2),0,Math.cos(angle/2)],linearVelocity:v,angularVelocity:[0,8,0]});
}
/** Flow through a simple cubic array of spheres (the Stokes-drag set-up): a fixed sphere of radius 0.15 L in a periodic cube of n^3 cells, driven by a body force, backward Euler. */
export function sphereArray(n=16):Fluid {
  const L=0.02,h=L/n,f=new Fluid({cells:[n,n,n],spacing:h,density:1000,viscosity:1,dt:5*h*h/1e-3,gravity:[0,0,0],bodyForce:[0.1,0,0],diffusion:'backward-euler',boundaries:ALL});
  f.addObstacle({shape:{kind:'sphere',radius:0.15*L},position:[L/2,L/2,L/2]});
  return f;
}
export interface FluidSetup {fluid:Fluid;steps:number;
  /** Called before step k (from 0) with the fluid the backend was built from: moves its obstacles. */
  beforeStep?:(fluid:Fluid,step:number)=>void}
export const FLUID_SETUPS:Record<string,()=>FluidSetup>={
  'taylor-green':()=>({fluid:taylorGreenFluid(),steps:20}),
  'cavity-3d':()=>({fluid:cavity3d(),steps:12}),
  'open-channel':()=>({fluid:openChannel(),steps:20}),
  'cylinder-channel':()=>({fluid:cylinderChannel(),steps:20}),
  'moving-sphere':()=>({fluid:movingSphere(),steps:12,beforeStep:moveSphere}),
};
