/** Independent separated-variable solutions and integral diagnostics.
 * No production solver imports: these evaluate formulas, never march its stencil.
 */
export function modeParameters(c,mode) {
  const {m,n,amplitude}=mode;
  if(!Number.isInteger(m)||!Number.isInteger(n)||m<0||n<0||m>=c.cols||n>=c.rows||m+n===0||!(amplitude>0))throw new RangeError('Invalid standing wave.');
  const kx=Math.PI*m/(c.cols*c.dx),kz=Math.PI*n/(c.rows*c.dz);
  const sx=2*Math.sin(Math.PI*m/(2*c.cols))/c.dx,sz=2*Math.sin(Math.PI*n/(2*c.rows))/c.dz;
  return {kx,kz,sx,sz,omega:Math.sqrt(c.gravity*c.meanDepth*(kx*kx+kz*kz)),omegaSpace:Math.sqrt(c.gravity*c.meanDepth*(sx*sx+sz*sz))};
}

export function standingWave(c,mode,tick,discrete=false) {
  const {kx,kz,sx,sz,omega,omegaSpace}=modeParameters(c,mode),{amplitude:A,offset=0,m,n}=mode;
  let height,flow,ux=kx,vz=kz;
  if(discrete) {
    const a=c.drag*c.dt/2,d=(1-a)/(1+a),rho=Math.sqrt(d),h2=(omegaSpace*c.dt)**2;
    const cosine=(1+d-h2/(1+a))/(2*rho);
    if(!(Math.abs(cosine)<1))throw new RangeError('This oracle case must be an underdamped discrete mode.');
    const theta=Math.acos(cosine),b=((1-h2/2)/rho-cosine)/Math.sin(theta);
    const q=n=>Math.pow(rho,n)*(Math.cos(n*theta)+b*Math.sin(n*theta));
    height=A*q(tick);flow=A*(q(tick-1)-q(tick))/(c.dt*c.meanDepth*(sx*sx+sz*sz));ux=sx;vz=sz;
  } else {
    const halfDrag=c.drag/2,frequency=Math.sqrt(omega*omega-halfDrag*halfDrag);
    if(!(frequency>0))throw new RangeError('This oracle case must be underdamped.');
    const time=tick*c.dt,velocityTime=(tick-.5)*c.dt;
    height=A*Math.exp(-halfDrag*time)*(Math.cos(frequency*time)+halfDrag/frequency*Math.sin(frequency*time));
    flow=A*c.gravity/frequency*Math.exp(-halfDrag*velocityTime)*Math.sin(frequency*velocityTime);
  }
  const count=c.cols*c.rows,eta=new Float64Array(count),u=new Float64Array(count),v=new Float64Array(count);
  for(let z=0;z<c.rows;z++)for(let x=0;x<c.cols;x++) {
    const i=z*c.cols+x,ax=Math.PI*m*(x+.5)/c.cols,az=Math.PI*n*(z+.5)/c.rows;
    eta[i]=offset+height*Math.cos(ax)*Math.cos(az);
    u[i]=x+1<c.cols?flow*ux*Math.sin(Math.PI*m*(x+1)/c.cols)*Math.cos(az):0;
    v[i]=z+1<c.rows?flow*vz*Math.cos(ax)*Math.sin(Math.PI*n*(z+1)/c.rows):0;
  }
  return {eta,u,v};
}

export function compareFields(actual,expected,scale=1) {
  let sum=0,normalized=0,maxAbsolute=0,count=0;
  for(const key of ['eta','u','v']) {
    const divisor=typeof scale==='number'?scale:scale[key];
    if(!(divisor>0))throw new RangeError('Positive per-field error scales are required.');
    if(actual[key].length!==expected[key].length)throw new RangeError('Field lengths differ.');
    for(let i=0;i<actual[key].length;i++) {
      const error=Math.abs(actual[key][i]-expected[key][i]);
      if(!Number.isFinite(error))throw new Error(`Nonfinite ${key}[${i}]`);
      maxAbsolute=Math.max(maxAbsolute,error);sum+=error*error;normalized+=(error/divisor)**2;count++;
    }
  }
  return {maxAbsolute,rms:Math.sqrt(sum/count),normalizedRms:Math.sqrt(normalized/count)};
}

/** eta scale is m; face velocity scale is m/s. The resulting error is dimensionless. */
export const waveErrorScales=(c,mode)=>({eta:mode.amplitude,u:mode.amplitude*Math.sqrt(c.gravity/c.meanDepth),v:mode.amplitude*Math.sqrt(c.gravity/c.meanDepth)});

export function integrals(s,c,mean=0) {
  let elevation=0,absoluteElevation=0,potential=0,kinetic=0,cross=0,centeredKinetic=0,maxWall=0;
  for(let z=0;z<c.rows;z++)for(let x=0;x<c.cols;x++) {
    const i=z*c.cols+x,h=s.eta[i]-mean,u=s.u[i],v=s.v[i];
    if(![h,u,v].every(Number.isFinite))throw new Error(`Nonfinite cell ${i}`);
    elevation+=s.eta[i];absoluteElevation+=Math.abs(s.eta[i]);potential+=h*h;kinetic+=u*u+v*v;
    const gx=x+1<c.cols?(s.eta[i+1]-s.eta[i])/c.dx:0,gz=z+1<c.rows?(s.eta[i+c.cols]-s.eta[i])/c.dz:0;
    cross+=u*gx+v*gz;
    const denominator=1+c.drag*c.dt/2;
    const uc=(u-c.gravity*c.dt*gx/2)/denominator,vc=(v-c.gravity*c.dt*gz/2)/denominator;
    centeredKinetic+=uc*uc+vc*vc;
    if(x+1===c.cols)maxWall=Math.max(maxWall,Math.abs(u));
    if(z+1===c.rows)maxWall=Math.max(maxWall,Math.abs(v));
  }
  const area=c.dx*c.dz;
  return {volume:elevation*area,l1Volume:absoluteElevation*area,maxWall,
    centeredEnergyPerDensity:.5*area*(c.gravity*potential+c.meanDepth*centeredKinetic),
    // Invariant only for drag=0. This includes the leapfrog cross term.
    modifiedEnergyPerDensity:.5*area*(c.gravity*potential+c.meanDepth*kinetic-c.gravity*c.meanDepth*c.dt*cross)};
}
