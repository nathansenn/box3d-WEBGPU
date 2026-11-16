/**
 * Fluid set-ups shared by the GPU checks (probe.ts), the gate's tests and the Lab example. Each returns a fresh float64
 * Fluid with its starting state and a number of steps; the backends are built from it.
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
export const FLUID_SETUPS:Record<string,()=>{fluid:Fluid;steps:number}>={
  'taylor-green':()=>({fluid:taylorGreenFluid(),steps:20}),
  'cavity-3d':()=>({fluid:cavity3d(),steps:12}),
  'open-channel':()=>({fluid:openChannel(),steps:20}),
};
