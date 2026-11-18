/** Reference equations from WaterSimulation.solveShallowWater, without forcing or visual proxies. */
export interface LinearWaterConfig { cols:number; rows:number; dt:number; gravity:number; meanDepth:number; drag:number; dx:number; dz:number }
export interface LinearWaterArrays { eta:Float32Array; u:Float32Array; v:Float32Array; nextEta:Float32Array; nextU:Float32Array; nextV:Float32Array }
export const LINEAR_WATER_MAX_CELLS=1048576;

export function validateLinearWaterConfig(input:LinearWaterConfig):Readonly<LinearWaterConfig> {
  if(!input||typeof input!=='object')throw new TypeError('Water configuration is required.');
  const {cols,rows,dt,gravity,meanDepth,drag,dx,dz}=input;
  if(!Number.isSafeInteger(cols)||!Number.isSafeInteger(rows)||cols<3||rows<3||cols*rows>LINEAR_WATER_MAX_CELLS)throw new RangeError('Water grids require at least 3×3 and at most 1048576 cells.');
  if(![dt,gravity,meanDepth,dx,dz].every(value=>Number.isFinite(value)&&value>0)||dt>1/30||!Number.isFinite(drag)||drag<0||drag*dt>1)throw new RangeError('Invalid water timestep or physical coefficients.');
  const courant=dt*Math.sqrt(gravity*meanDepth)*Math.hypot(1/dx,1/dz);
  if(courant>.8)throw new RangeError('Water Courant number exceeds the conservative 0.8 limit; reduce the timestep.');
  if(![1-drag*dt,gravity*dt/(2*dx),gravity*dt/(2*dz),meanDepth*dt/(2*dx),meanDepth*dt/(2*dz)].every(value=>Number.isFinite(Math.fround(value))))throw new RangeError('Water coefficients exceed float32 range.');
  return Object.freeze({cols,rows,dt,gravity,meanDepth,drag,dx,dz});
}

export function createLinearWaterArrays(config:LinearWaterConfig,initial:Partial<LinearWaterArrays>={}):LinearWaterArrays {
  const {cols,rows}=validateLinearWaterConfig(config),count=cols*rows;
  const copy=(key:keyof LinearWaterArrays)=>{
    const value=initial[key];
    if(value!==undefined&&(!(value instanceof Float32Array)||value.length!==count||!value.every(Number.isFinite)))throw new RangeError(`Invalid water ${key} field.`);
    return value?.slice()??new Float32Array(count);
  };
  return {eta:copy('eta'),u:copy('u'),v:copy('v'),nextEta:copy('nextEta'),nextU:copy('nextU'),nextV:copy('nextV')};
}

/** Mutates and swaps reusable fields, preserving the original boundary update order. */
export function stepLinearWaterCpu(s:LinearWaterArrays,c:Readonly<LinearWaterConfig>):void {
  const {cols,rows,dt,gravity,meanDepth,drag,dx,dz}=c,{eta,u,v,nextEta,nextU,nextV}=s;
  const decay=1-drag*dt,px=gravity*dt*(1/(2*dx)),pz=gravity*dt*(1/(2*dz));
  const cx=meanDepth*dt*(1/(2*dx)),cz=meanDepth*dt*(1/(2*dz));
  for(let z=1;z<rows-1;z++)for(let i=z*cols+1;i<(z+1)*cols-1;i++) {
    nextU[i]=u[i]*decay-(eta[i+1]-eta[i-1])*px;
    nextV[i]=v[i]*decay-(eta[i+cols]-eta[i-cols])*pz;
  }
  for(let z=1;z<rows-1;z++)for(let i=z*cols+1;i<(z+1)*cols-1;i++) {
    const next=eta[i]-(nextU[i+1]-nextU[i-1])*cx-(nextV[i+cols]-nextV[i-cols])*cz;
    nextEta[i]=next< -1.65?-1.65:next>1.65?1.65:next;
  }
  const bottom=(rows-1)*cols,inner=(rows-2)*cols;
  for(let x=0;x<cols;x++) {
    nextEta[x]=nextEta[cols+x]*.92;nextU[x]=nextU[cols+x]*.78;nextV[x]=-nextV[cols+x]*.18;
    nextEta[bottom+x]=nextEta[inner+x]*.92;nextU[bottom+x]=nextU[inner+x]*.78;nextV[bottom+x]=-nextV[inner+x]*.18;
  }
  for(let z=0;z<rows;z++) {
    const left=z*cols,right=left+cols-1;
    nextEta[left]=nextEta[left+1]*.92;nextU[left]=-nextU[left+1]*.18;nextV[left]=nextV[left+1]*.78;
    nextEta[right]=nextEta[right-1]*.92;nextU[right]=-nextU[right-1]*.18;nextV[right]=nextV[right-1]*.78;
  }
  s.eta=nextEta;s.u=nextU;s.v=nextV;s.nextEta=eta;s.nextU=u;s.nextV=v;
}
