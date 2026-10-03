export const frameConfig={dt:1/240,substeps:1,maxIterations:256,drag:0,gravity:[0,0,0],forceTolerance:1e-8,momentTolerance:1e-8,impulseTolerance:1e-10,angularImpulseTolerance:1e-10};
export const frameSection={youngModulus:2e9,shearModulus:8e8,area:.002,iy:1e-6,iz:3e-6,torsionConstant:2e-6,density:1000,up:[0,1,0]};
export function cantileverDefinition({segments=8,length=2,config={},free=false,section={}}={}){
  const positions=new Float64Array(3*(segments+1)),fixed=new Uint8Array(6*(segments+1)),elements=[];
  for(let i=0;i<=segments;i++){positions[3*i]=length*i/segments;if(i)elements.push({...frameSection,...section,up:[0,1,0],a:i-1,b:i});}
  if(!free)fixed.fill(1,0,6);
  return {config:{...frameConfig,...config},positions,fixed,elements};
}
export function generalizedMomentum(values,positions){
  const linear=[0,0,0],angular=[0,0,0];
  for(let i=0;i<positions.length/3;i++){
    const j=6*i,p=3*i;for(let k=0;k<3;k++){linear[k]+=values[j+k];angular[k]+=values[j+3+k];}
    angular[0]+=positions[p+1]*values[j+2]-positions[p+2]*values[j+1];angular[1]+=positions[p+2]*values[j]-positions[p]*values[j+2];angular[2]+=positions[p]*values[j+1]-positions[p+1]*values[j];
  }return {linear,angular};
}
export function frameImpulseDefect(previous,current,positions){
  const net=Float64Array.from(current.impulses.support,(v,j)=>v+current.impulses.applied[j]+current.impulses.drag[j]),expected=generalizedMomentum(net,positions);
  return {linear:Math.hypot(...expected.linear.map((v,k)=>current.diagnostics.linearMomentum[k]-previous.diagnostics.linearMomentum[k]-v)),angular:Math.hypot(...expected.angular.map((v,k)=>current.diagnostics.linearizedAngularMomentum[k]-previous.diagnostics.linearizedAngularMomentum[k]-v))};
}

/** Independent integration of displacement/velocity shape functions and their
 * derivatives. This does not contain a stiffness or mass coefficient table. */
export function frameElementEnergy(local,length,section){
  const points=[-.8611363115940526,-.3399810435848563,.3399810435848563,.8611363115940526],weights=[.3478548451374539,.6521451548625461,.6521451548625461,.3478548451374539];
  let potential=0,kinetic=0;
  for(let q=0;q<4;q++){
    const s=(points[q]+1)/2,L=length,H=[1-3*s*s+2*s*s*s,L*(s-2*s*s+s*s*s),3*s*s-2*s*s*s,L*(-s*s+s*s*s)],dd=[(-6+12*s)/(L*L),(-4+6*s)/L,(6-12*s)/(L*L),(-2+6*s)/L];
    const v=[local[1],local[5],local[7],local[11]],w=[local[2],-local[4],local[8],-local[10]],dot=(a,b)=>a.reduce((sum,v,j)=>sum+v*b[j],0);
    const axial=(local[6]-local[0])/L,torsion=(local[9]-local[3])/L,vx=(1-s)*local[0]+s*local[6],omega=(1-s)*local[3]+s*local[9];
    potential+=weights[q]*L/4*(section.youngModulus*(section.area*axial**2+section.iz*dot(dd,v)**2+section.iy*dot(dd,w)**2)+section.shearModulus*section.torsionConstant*torsion**2);
    kinetic+=weights[q]*L/4*section.density*(section.area*(vx**2+dot(H,v)**2+dot(H,w)**2)+(section.iy+section.iz)*omega**2);
  }return {potential,kinetic};
}

export function continuumCantileverMode(x,length){
  const beta=1.875104068711961,ratio=(Math.cosh(beta)+Math.cos(beta))/(Math.sinh(beta)+Math.sin(beta)),s=beta*x/length;
  const shape=Math.cosh(s)-Math.cos(s)-ratio*(Math.sinh(s)-Math.sin(s));
  const slope=beta/length*(Math.sinh(s)+Math.sin(s)-ratio*(Math.cosh(s)-Math.cos(s)));
  const tip=Math.cosh(beta)-Math.cos(beta)-ratio*(Math.sinh(beta)-Math.sin(beta));return {value:shape/tip,slope:slope/tip};
}
export function cantileverFrequency(length,section=frameSection){return 1.875104068711961**2/(length*length)*Math.sqrt(section.youngModulus*section.iz/(section.density*section.area));}
export function plainFrameSnapshot(s){
  return {...s,positions:Array.from(s.positions),displacements:Array.from(s.displacements),velocities:Array.from(s.velocities),supportReactions:Array.from(s.supportReactions),elementElasticForces:Array.from(s.elementElasticForces),impulses:Object.fromEntries(Object.entries(s.impulses).map(([k,v])=>[k,Array.from(v)]))};
}

/** Independent small-system oracle. Integrate physical shape gradients by
 * Gaussian quadrature, assemble dense global matrices, and use Cholesky instead
 * of the production element tables and matrix-free conjugate-gradient solve. */
export function independentFrameMatrices(d){
  const size=d.positions.length*2;if(size>240)throw new Error('Dense frame oracle is limited to 40 nodes.');
  const K=new Float64Array(size*size),M=new Float64Array(size*size),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=v=>v.map(x=>x/Math.hypot(...v));
  const points=[-.8611363115940526,-.3399810435848563,.3399810435848563,.8611363115940526],weights=[.3478548451374539,.6521451548625461,.6521451548625461,.3478548451374539];
  for(let i=0;i<size;i++)M[size*i+i]=(i%6<3?d.pointMasses?.[Math.floor(i/6)]:d.pointInertias?.[3*Math.floor(i/6)+i%6-3])??0;
  for(const e of d.elements){
    const edge=[0,1,2].map(k=>d.positions[3*e.b+k]-d.positions[3*e.a+k]),L=Math.hypot(...edge),x=unit(edge),z=unit(cross(x,e.up)),y=cross(z,x),axes=[x,y,z],ids=Array.from({length:12},(_,i)=>6*(i<6?e.a:e.b)+i%6);
    const gradient=(entries)=>{const local=Array(12).fill(0);for(const [i,v] of entries)local[i]=v;return local.map((_,i)=>axes.reduce((sum,axis,k)=>sum+axis[i%3]*local[i-i%3+k],0));};
    const accumulate=(out,terms,weight)=>{for(let i=0;i<12;i++)for(let j=0;j<12;j++)out[size*ids[i]+ids[j]]+=weight*terms.reduce((sum,[factor,v])=>sum+factor*v[i]*v[j],0);};
    for(let q=0;q<4;q++){
      const s=(points[q]+1)/2,H=[1-3*s*s+2*s**3,L*(s-2*s*s+s**3),3*s*s-2*s**3,L*(-s*s+s**3)],dd=[(-6+12*s)/L**2,(-4+6*s)/L,(6-12*s)/L**2,(-2+6*s)/L];
      const on=(ids,v,signs=[1,1,1,1])=>gradient(ids.map((id,i)=>[id,v[i]*signs[i]]));
      accumulate(K,[[e.youngModulus*e.area,on([0,6],[-1/L,1/L])],[e.youngModulus*e.iz,on([1,5,7,11],dd)],[e.youngModulus*e.iy,on([2,4,8,10],dd,[1,-1,1,-1])],[e.shearModulus*e.torsionConstant,on([3,9],[-1/L,1/L])]],weights[q]*L/2);
      accumulate(M,[[e.density*e.area,on([0,6],[1-s,s])],[e.density*e.area,on([1,5,7,11],H)],[e.density*e.area,on([2,4,8,10],H,[1,-1,1,-1])],[e.density*(e.iy+e.iz),on([3,9],[1-s,s])]],weights[q]*L/2);
    }
  }
  const g=Float64Array.from({length:size},(_,i)=>i%6<3?d.config.gravity[i%6]:0);
  return {K,M,size,gravity:frameMatrixVector(M,g)};
}
export function frameMatrixVector(A,x){const n=x.length;return Float64Array.from({length:n},(_,i)=>x.reduce((sum,v,j)=>sum+A[n*i+j]*v,0));}
export function frameDenseFactor(A,fixed){
  const size=fixed.length,free=Array.from({length:size},(_,i)=>i).filter(i=>!fixed[i]),n=free.length,L=new Float64Array(n*n),scale=free.map(i=>Math.sqrt(A[size*i+i]));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
    let v=A[size*free[i]+free[j]]/(scale[i]*scale[j]);for(let k=0;k<j;k++)v-=L[n*i+k]*L[n*j+k];
    if(i===j){if(!(v>0))throw new Error('Independent frame matrix is not positive definite.');L[n*i+j]=Math.sqrt(v);}else L[n*i+j]=v/L[n*j+j];
  }
  return rhs=>{
    const x=new Float64Array(n),out=new Float64Array(size);
    for(let i=0;i<n;i++){x[i]=rhs[free[i]]/scale[i];for(let j=0;j<i;j++)x[i]-=L[n*i+j]*x[j];x[i]/=L[n*i+i];}
    for(let i=n-1;i>=0;i--){for(let j=i+1;j<n;j++)x[i]-=L[n*j+i]*x[j];x[i]/=L[n*i+i];out[free[i]]=x[i]/scale[i];}
    return out;
  };
}
export function independentFrameTrajectory(d){
  const matrices=independentFrameMatrices(d),{M,K,size,gravity}=matrices,h=d.config.dt/d.config.substeps,fixed=d.fixed??new Uint8Array(size),solve=frameDenseFactor(Float64Array.from(M,(v,i)=>(1+d.config.drag*h/2)*v+h*h/4*K[i]),fixed),impulse=frameDenseFactor(M,fixed);
  let u=Float64Array.from(d.displacements??new Float64Array(size)),v=Float64Array.from(d.velocities??new Float64Array(size)),forces=Float64Array.from(d.forces??new Float64Array(size));
  return {matrices,inspect:()=>({displacements:u.slice(),velocities:v.slice()}),step(commands=[]){
    for(const c of commands){if(c.type==='force')forces.set(c.value,6*c.node);else{const J=new Float64Array(size);J.set(c.value,6*c.node);const dv=impulse(J);v=v.map((value,j)=>value+dv[j]);}}
    for(let s=0;s<d.config.substeps;s++){
      const Mv=frameMatrixVector(M,v),Ku=frameMatrixVector(K,u),mid=solve(Mv.map((value,j)=>value+h/2*(forces[j]+gravity[j]-Ku[j])));
      u=u.map((value,j)=>value+h*mid[j]);v=v.map((value,j)=>2*mid[j]-value);
    }
    return this.inspect();
  }};
}
export function independentFrameImpulseDefect(matrices,previous,current,positions){
  const dv=Float64Array.from(current.velocities,(v,i)=>v-previous.velocities[i]),dp=frameMatrixVector(matrices.M,dv),defect=dp.map((v,i)=>v-current.impulses.support[i]-current.impulses.applied[i]-current.impulses.drag[i]),total=generalizedMomentum(defect,positions);
  return {linear:Math.hypot(...total.linear),angular:Math.hypot(...total.angular)};
}
export function rotatedFrameDefinition(d){
  // A proper 3D rotation plus translation. The material up and every generalized
  // vector rotate; isotropic point masses/inertias in these cases are invariant.
  const Q=[[.36,-.48,.8],[.8,.6,0],[-.48,.64,.6]],rotate=v=>Q.map(row=>row.reduce((sum,c,i)=>sum+c*v[i],0));
  const out=structuredClone(d);out.positions=Float64Array.from(out.positions,(v,i)=>rotate(Array.from(d.positions).slice(i-i%3,i-i%3+3))[i%3]+[.3,-.2,.4][i%3]);out.elements=out.elements.map(e=>({...e,up:rotate(e.up)}));out.config.gravity=rotate(d.config.gravity);
  for(const name of ['displacements','velocities','forces'])if(d[name])out[name]=Float64Array.from(d[name],(_,i)=>rotate(Array.from(d[name]).slice(i-i%3,i-i%3+3))[i%3]);
  return {definition:out,rotate};
}
