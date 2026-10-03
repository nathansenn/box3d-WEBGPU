/** Independent scalar solutions and a declared cable qualification matrix. */
export function cableProtocol() {
  const cases=[];
  for(const dt of [1/30,1/120,1/480])for(const drag of [0,2])for(const iterations of [1,4,16])cases.push({id:`spring-${Math.round(1/dt)}-${drag}-${iterations}`,kind:'spring',dt,drag,iterations,substeps:1,ticks:Math.round(2/dt),samples:20});
  for(const dt of [1/120,1/240,1/480,1/960])cases.push({id:`continuum-${Math.round(1/dt)}`,kind:'continuum',dt,drag:0,iterations:16,substeps:1,ticks:Math.round(1/dt),samples:20});
  for(const segments of [1,4,16,32])cases.push({id:`hanging-${segments}`,kind:'hanging',dt:1/60,drag:4,iterations:256,substeps:8,segments,ticks:1200,samples:20});
  cases.push({id:'underconverged-32',kind:'underconverged',dt:1/30,drag:0,iterations:1,substeps:1,segments:32,ticks:4,samples:4});
  cases.push({id:'free-axial-100s',kind:'momentum',dt:1/120,drag:0,iterations:16,substeps:1,ticks:12000,samples:150});
  return {schema:'box3d.cable-accuracy-protocol/1',backend:'cable-xpbd-js-f64-v1',cases,
    thresholds:{component:2e-9,force:2e-6,implicitForceResidual:2e-6,hangingExtension:2e-7,hangingReaction:2e-5,constitutiveResidual:1e-9,momentum:1e-8,energyGrowth:1e-8,continuumFine:.025,convergenceMinimum:1.8,convergenceMaximum:2.2},
    scope:'Axial compliant tension-only cable: implicit spring trajectory/force, distributed static extension/support load, sampled free-system momentum/energy, first-order continuum refinement, explicit under-convergence, and exact full-checkpoint continuation. No bending, contact, calibration, GPU or speedup acceptance.'};
}

export function cableCaseDefinition(spec,core) {
  const config={dt:spec.dt,drag:spec.drag,maxIterations:spec.iterations,substeps:spec.substeps,residualTolerance:spec.kind==='hanging'?1e-9:1e-12,gravity:[0,-9.81,0]};
  if(spec.kind==='hanging'||spec.kind==='underconverged')return core.hangingCableDefinition({segments:spec.segments,length:2,linearDensity:.25,tipMass:1,axialRigidity:1000,config});
  if(spec.kind==='momentum')return {config:{...config,gravity:[0,0,0]},positions:[-1,0,0,1,0,0],masses:[2,3],velocities:[.1,.2,.3,.1,.2,.3],constraints:[{a:0,b:1,restLength:1,compliance:.01}]};
  return {config,positions:[0,0,0,0,-1.4,0],masses:[1,2],pinned:[1,0],constraints:[{a:0,b:1,restLength:1,compliance:1/60}]};
}

export function plainCableState(s) {
  return {...s,positions:Array.from(s.positions),velocities:Array.from(s.velocities),tensions:Array.from(s.tensions),supportReactions:Array.from(s.supportReactions)};
}

/** Complex eigenvalue power of (I - h A)^-1, independent of projection iterations. */
function implicitSpring(h,steps,drag) {
  const omega2=30,decay=drag/2,frequency=Math.sqrt(omega2-decay*decay),a=1+h*decay,b=h*frequency;
  const radius=Math.hypot(a,b)**(-steps),phase=steps*Math.atan2(b,a),real=radius*Math.cos(phase),imag=radius*Math.sin(phase);
  const equilibrium=2*9.81/60,q0=.4-equilibrium;
  return {extension:equilibrium+real*q0+imag*decay*q0/frequency,velocity:-imag*omega2*q0/frequency};
}

export function evaluateCableCase(spec,samples,thresholds) {
  const issues=[],require=(condition,message)=>{if(!condition)issues.push(message);};
  let maxComponentError=0,maxForceError=0,maxImplicitForceResidual=0,maxMomentumError=0,maxEnergyGrowth=0;
  const first=samples[0],energy=s=>s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy;
  let previousEnergy=energy(first);
  for(const s of samples) {
    require(s.backend==='cable-xpbd-js-f64-v1','Backend identity');
    require([...s.positions,...s.velocities,...s.tensions,...s.supportReactions,...Object.values(s.diagnostics).flat()].every(Number.isFinite),'Nonfinite state/diagnostics');
    require(s.tensions.every(v=>v>=0),'Compression in a tension-only model');
    if(!s.tick)continue; // Initial multipliers have not been solved yet.
    maxImplicitForceResidual=Math.max(maxImplicitForceResidual,s.diagnostics.maxImplicitForceResidual);
    if(spec.kind==='spring'||spec.kind==='continuum') {
      const expected=implicitSpring(spec.dt/spec.substeps,s.tick*spec.substeps,spec.drag);
      maxComponentError=Math.max(maxComponentError,Math.abs(-s.positions[4]-1-expected.extension),Math.abs(-s.velocities[4]-expected.velocity));
      maxForceError=Math.max(maxForceError,Math.abs(s.tensions[0]-60*expected.extension),Math.abs(s.supportReactions[1]-9.81-60*expected.extension));
      require(s.diagnostics.unconvergedSubsteps===0,'Unconverged spring solve');
    }
    if(spec.kind==='momentum') {
      maxMomentumError=Math.max(maxMomentumError,...s.diagnostics.momentum.map((v,k)=>Math.abs(v-[.5,1,1.5][k])));
      maxEnergyGrowth=Math.max(maxEnergyGrowth,energy(s)-previousEnergy);previousEnergy=energy(s);
    }
  }
  require(maxComponentError<=thresholds.component,'Implicit spring trajectory error');require(maxForceError<=thresholds.force,'Spring force error');
  require(maxImplicitForceResidual<=thresholds.implicitForceResidual,'Implicit force-balance residual');
  require(maxMomentumError<=thresholds.momentum,'Linear momentum error');require(maxEnergyGrowth<=thresholds.energyGrowth,'Unforced axial energy growth');
  const last=samples.at(-1),result={id:spec.id,status:'passed',issues,maxComponentError,maxForceError,maxImplicitForceResidual,maxMomentumError,maxEnergyGrowth};
  if(spec.kind==='hanging') {
    result.extension=-last.positions.at(-2)-2;result.expectedExtension=.024525;result.reaction=last.supportReactions[1];result.expectedReaction=14.715;
    require(Math.abs(result.extension-result.expectedExtension)<=thresholds.hangingExtension,'Distributed extension');require(Math.abs(result.reaction-result.expectedReaction)<=thresholds.hangingReaction,'Support reaction');
    require(Math.abs(last.diagnostics.mass-1.5)<1e-12,'Distributed total mass');require(last.diagnostics.maxResidual<=thresholds.constitutiveResidual&&last.diagnostics.unconvergedSubsteps===0,'Final hanging solve convergence');
  }
  if(spec.kind==='underconverged')require(samples.slice(1).some(s=>s.diagnostics.unconvergedSubsteps>0),'Missing under-convergence warning');
  if(spec.kind==='continuum') {
    const omega=Math.sqrt(30),amplitude=.4-2*9.81/60,time=last.tick*spec.dt;
    result.continuumError=Math.hypot((-last.positions[4]-1-2*9.81/60)/amplitude-Math.cos(omega*time),-last.velocities[4]/(amplitude*omega)+Math.sin(omega*time));
  }
  result.status=issues.length?'failed':'passed';return result;
}

export function evaluateCableCampaign(records,p) {
  const checks=records.map(r=>evaluateCableCase(r.spec,r.samples,p.thresholds));
  const errors=checks.filter(c=>c.continuumError!==undefined).map(c=>c.continuumError),ratios=errors.slice(1).map((v,i)=>errors[i]/v);
  const convergencePassed=errors.length===4&&errors.at(-1)<=p.thresholds.continuumFine&&ratios.every(r=>r>=p.thresholds.convergenceMinimum&&r<=p.thresholds.convergenceMaximum);
  return {status:checks.every(c=>c.status==='passed')&&convergencePassed?'passed':'failed',cases:checks.length,samples:records.reduce((n,r)=>n+r.samples.length,0),checks,continuum:{errors,ratios,status:convergencePassed?'passed':'failed'},speedupClaim:false,scope:p.scope};
}
