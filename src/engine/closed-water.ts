import {createLinearWaterArrays,validateLinearWaterConfig,type LinearWaterArrays,type LinearWaterConfig} from './linear-water.ts';

/** Linear shallow water on a closed, rectangular, flat-bottom basin.
 * eta is at cell centers at t; u/v are east/north face velocities at t - dt/2.
 * The west/south exterior faces are implicit zero; stored east/north walls are zero.
 * With SI inputs: eta, meanDepth, dx, dz are m; u/v are m/s; drag is 1/s.
 * This is a small-amplitude model, without advection, breaking or wetting/drying.
 */
export const CLOSED_WATER_CPU_BACKEND='linear-water-closed-cgrid-js-f32-v1';

export function closedWaterCoefficients(input:LinearWaterConfig):Readonly<{decay:number;px:number;pz:number;cx:number;cz:number}> {
  const {dt,gravity,meanDepth,drag,dx,dz}=validateLinearWaterConfig(input);
  const a=drag*dt/2,denominator=1+a;
  const result={decay:(1-a)/denominator,px:gravity*dt/(denominator*dx),pz:gravity*dt/(denominator*dz),cx:meanDepth*dt/dx,cz:meanDepth*dt/dz};
  if(!Object.values(result).every(value=>Number.isFinite(Math.fround(value))&&Math.fround(value)>0))throw new RangeError('Closed water coefficients must remain positive and finite in float32.');
  return Object.freeze(result);
}

/** Validate/copy already staggered state, including checkpoint scratch histories. */
export function copyClosedWaterArrays(input:LinearWaterConfig,initial:Partial<LinearWaterArrays>={}):LinearWaterArrays {
  closedWaterCoefficients(input);
  const state=createLinearWaterArrays(input,initial),{cols,rows}=input;
  for(let z=0;z<rows;z++)if(state.u[z*cols+cols-1]!==0)throw new RangeError('Closed water east wall velocity must be zero.');
  for(let x=0;x<cols;x++)if(state.v[(rows-1)*cols+x]!==0)throw new RangeError('Closed water north wall velocity must be zero.');
  return state;
}

/** Start from eta and face velocities all specified at t=0. Copies caller data.
 * Converts velocities to the required negative half-time level using the centered
 * momentum equation. Use copyClosedWaterArrays for an existing staggered state.
 */
export function createClosedWaterArrays(input:LinearWaterConfig,initial:Partial<Pick<LinearWaterArrays,'eta'|'u'|'v'>>={}):LinearWaterArrays {
  if(Object.keys(initial).some(key=>!['eta','u','v'].includes(key)))throw new RangeError('Closed water initialization accepts synchronized eta/u/v only; use a checkpoint to resume.');
  const state=copyClosedWaterArrays(input,initial),{cols,rows,dt,gravity,drag,dx,dz}=input;
  const a=1+drag*dt/2,px=gravity*dt/(2*dx),pz=gravity*dt/(2*dz);
  for(let z=0;z<rows;z++)for(let x=0;x<cols;x++) {
    const i=z*cols+x;
    state.u[i]=x+1<cols?a*state.u[i]+(state.eta[i+1]-state.eta[i])*px:0;
    state.v[i]=z+1<rows?a*state.v[i]+(state.eta[i+cols]-state.eta[i])*pz:0;
  }
  if(!state.u.every(Number.isFinite)||!state.v.every(Number.isFinite))throw new RangeError('Closed water initial half-step velocity exceeds float32 range.');
  return state;
}

/** Two ordered, allocation-free updates. Every destination cell is overwritten.
 * Shared face fluxes telescope in the volume sum; only float32 roundoff remains.
 * Drag uses a centered Crank-Nicolson update and never alters elevation directly.
 * Config must first pass closedWaterCoefficients; dt remains fixed for the run.
 */
export function stepClosedWaterCpu(s:LinearWaterArrays,c:Readonly<LinearWaterConfig>):void {
  const {cols,rows,dt,gravity,meanDepth,drag,dx,dz}=c,{eta,u,v,nextEta,nextU,nextV}=s;
  const a=drag*dt/2,decay=(1-a)/(1+a),px=gravity*dt/((1+a)*dx),pz=gravity*dt/((1+a)*dz);
  const cx=meanDepth*dt/dx,cz=meanDepth*dt/dz;
  for(let z=0;z<rows;z++)for(let x=0;x<cols;x++) {
    const i=z*cols+x;
    nextU[i]=x+1<cols?u[i]*decay-(eta[i+1]-eta[i])*px:0;
    nextV[i]=z+1<rows?v[i]*decay-(eta[i+cols]-eta[i])*pz:0;
  }
  for(let z=0;z<rows;z++)for(let x=0;x<cols;x++) {
    const i=z*cols+x,west=x>0?nextU[i-1]:0,south=z>0?nextV[i-cols]:0;
    nextEta[i]=eta[i]-(nextU[i]-west)*cx-(nextV[i]-south)*cz;
  }
  s.eta=nextEta;s.u=nextU;s.v=nextV;s.nextEta=eta;s.nextU=u;s.nextV=v;
}
