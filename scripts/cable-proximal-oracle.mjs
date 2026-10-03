import assert from 'node:assert/strict';

const gravity=9.81;
export const proximalConfig={dt:1/60,substeps:8,maxIterations:256,residualTolerance:1e-9,forceTolerance:1e-6,solver:'proximal',drag:4,gravity:[0,-gravity,0]};

export function spanDefinition(core,{segments=32,rigidity=1000,substeps=8,hard=false}={}) {
  const d=core.hangingCableDefinition({segments,length:4.2,linearDensity:.25,tipMass:0,axialRigidity:rigidity,config:{...proximalConfig,substeps}});
  for(let i=0;i<=segments;i++){d.positions[3*i]=-2+4*i/segments;d.positions[3*i+1]=0;}
  d.masses[segments/2]+=1;d.pinned[segments]=1;
  if(hard){d.config.maxIterations=4096;d.config.forceTolerance=1e-8;d.config.residualTolerance=1e-12;for(const edge of d.constraints)edge.compliance=0;}
  return d;
}

function bisectIncreasing(fn,target) {
  let low=0,high=1;
  for(let i=0;fn(high)<target;i++){assert.ok(i<100,'No finite root bracket');high*=2;}
  for(let i=0;i<100;i++){const middle=(low+high)/2;if(fn(middle)<target)low=middle;else high=middle;}
  return (low+high)/2;
}

/** Static force-polygon shooting, with no time integration or projections.
 * Horizontal tension is constant; vertical tension jumps by each nodal weight.
 * Hooke's law gives each segment vector directly from those forces.
 */
export function discreteSpanReference(d) {
  const n=d.constraints.length;assert.equal(d.masses.length,n+1);assert.equal(n%2,0);
  const freeWeight=Array.from(d.masses).slice(1,-1).reduce((a,b)=>a+b,0)*gravity;
  const vertical=[];let v=-freeWeight/2;
  for(let j=0;j<n;j++){vertical.push(v);v+=d.masses[j+1]*gravity;}
  const width=d.positions[3*n]-d.positions[0];
  const horizontal=bisectIncreasing(h=>d.constraints.reduce((sum,e,j)=>sum+e.restLength*h/Math.hypot(h,vertical[j])+e.compliance*h,0),width);
  const positions=Array((n+1)*3).fill(0),tensions=[];positions[0]=d.positions[0];
  for(let j=0;j<n;j++){
    const e=d.constraints[j],t=Math.hypot(horizontal,vertical[j]),factor=e.restLength/t+e.compliance;
    tensions.push(t);positions[3*(j+1)]=positions[3*j]+horizontal*factor;positions[3*(j+1)+1]=positions[3*j+1]+vertical[j]*factor;
  }
  return {positions,tensions,horizontal,sag:-positions[3*n/2+1],reaction:gravity*Array.from(d.masses).reduce((a,b)=>a+b,0)};
}

/** Exact extensible catenary integrals for this symmetric, uniform reference
 * density cable plus a central point mass. Independent of mesh resolution.
 */
export function continuumSpanReference(rigidity=1000) {
  const halfLength=2.1,w=.25*gravity,v0=gravity/2,v1=v0+w*halfLength;
  const h=bisectIncreasing(h=>h/w*(Math.asinh(v1/h)-Math.asinh(v0/h))+h*halfLength/rigidity,2);
  const sag=(Math.hypot(h,v1)-Math.hypot(h,v0))/w+(v0*halfLength+w*halfLength**2/2)/rigidity;
  return {horizontal:h,sag};
}

export function symmetricDefinition({dt=1/120,hard=false}={}) {
  return {config:{...proximalConfig,dt,substeps:1,drag:2,residualTolerance:1e-11,forceTolerance:1e-7},
    positions:[-.8,0,0,0,-.55,0,.8,0,0],masses:[.2,1,.2],pinned:[1,0,1],velocities:[0,0,0,0,-.7,0,0,0,0],
    constraints:[{a:0,b:1,restLength:1,compliance:hard?0:.01},{a:1,b:2,restLength:1,compliance:hard?0:.01}]};
}

/** Symmetry reduces the nonlinear implicit step to one strictly monotone scalar
 * equation. Bisection solves it without dual updates or runtime diagnostics.
 */
export function symmetricTrajectory(d,ticks) {
  let y=-d.positions[4],v=-d.velocities[4];const samples=[{y,v}];
  const h=d.config.dt/d.config.substeps,m=d.masses[1],r=d.config.drag,a=.8,L=1,alpha=d.constraints[0].compliance;
  for(let tick=1;tick<=ticks;tick++){
    for(let s=0;s<d.config.substeps;s++){
      const predicted=y+h*(v+h*gravity)/(1+r*h);let next;
      if(alpha===0)next=Math.max(-Math.sqrt(L*L-a*a),Math.min(Math.sqrt(L*L-a*a),predicted));
      else {
        const fn=x=>m*(1+r*h)*(x-predicted)/(h*h)+2*Math.max(Math.hypot(a,x)-L,0)/alpha*x/Math.hypot(a,x);
        let low=Math.min(0,predicted),high=Math.max(0,predicted);
        for(let i=0;i<90;i++){const middle=(low+high)/2;if(fn(middle)<0)low=middle;else high=middle;}
        next=(low+high)/2;
      }
      v=(next-y)/h;y=next;
    }
    samples.push({y,v});
  }
  return samples;
}

export function independentForceResidual(d,previous,current,forces=d.forces) {
  assert.equal(d.config.substeps,1,'This independent check needs adjacent substeps');
  const h=d.config.dt,residual=Array.from(current.positions,(_,j)=>{
    const m=d.masses[Math.floor(j/3)],velocity=(current.positions[j]-previous.positions[j])/h;
    return m*(velocity-previous.velocities[j])/h-m*d.config.gravity[j%3]-(forces?.[j]??0)+m*d.config.drag*velocity;
  });
  d.constraints.forEach((e,i)=>{
    const delta=[0,1,2].map(k=>current.positions[3*e.b+k]-current.positions[3*e.a+k]),length=Math.hypot(...delta);
    const tension=e.compliance>0?Math.max(length-e.restLength,0)/e.compliance:current.tensions[i];
    if(length)delta.forEach((value,k)=>{residual[3*e.a+k]-=tension*value/length;residual[3*e.b+k]+=tension*value/length;});
  });
  return Math.max(0,...Array.from(d.masses,(_,i)=>d.pinned?.[i]?0:Math.hypot(...residual.slice(3*i,3*i+3))));
}

export function impulseDefect(previous,current) {
  return Math.hypot(...[0,1,2].map(k=>{
    let support=0;for(let j=k;j<current.impulses.support.length;j+=3)support+=current.impulses.support[j];
    return current.diagnostics.momentum[k]-previous.diagnostics.momentum[k]-current.impulses.applied[k]-current.impulses.drag[k]-support;
  }));
}

export function plainProximalState(s) {
  return {...s,positions:Array.from(s.positions),velocities:Array.from(s.velocities),tensions:Array.from(s.tensions),supportReactions:Array.from(s.supportReactions),impulses:{...s.impulses,support:Array.from(s.impulses.support)}};
}
