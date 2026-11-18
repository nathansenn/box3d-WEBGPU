import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';

/** Prismatic Euler-Bernoulli frame. SI; iy/iz are area moments, not mass inertia. */
export interface FrameElement {
  a:number;b:number;youngModulus:number;shearModulus:number;area:number;
  iy:number;iz:number;torsionConstant:number;density:number;up:readonly [number,number,number];
}
export interface FrameElementMatrices {
  definition:FrameElement;length:number;mass:number;dofs:Uint32Array;basis:Float64Array;
  localStiffness:Float64Array;stiffness:Float64Array;massMatrix:Float64Array;
}
const zero=(x:number)=>x===0?0:x;

/** Maximum transverse slope of the cubic Hermite centreline, including its
 * interior. The squared slope is quartic; isolate all stationary points using
 * the quadratic derivative of its cubic derivative, then bisect each bracket.
 * Scaling the coefficients avoids squaring large displacements during restore.
 */
export function frameTransverseSlope(local:ArrayLike<number>,length:number):number {
  const chord=[(local[7]-local[1])/length,(local[8]-local[2])/length],start=[local[5],-local[4]],end=[local[11],-local[10]];
  const a=chord.map((v,k)=>3*(start[k]+end[k]-2*v)),b=chord.map((v,k)=>6*v-4*start[k]-2*end[k]),c=start;
  const scale=Math.max(...a.map(Math.abs),...b.map(Math.abs),...c.map(Math.abs));if(scale===0)return 0;
  for(const v of [a,b,c])for(let k=0;k<2;k++)v[k]/=scale;
  const dot=(x:number[],y:number[])=>x[0]*y[0]+x[1]*y[1],p=[dot(b,c),dot(b,b)+2*dot(a,c),3*dot(a,b),2*dot(a,a)];
  const at=(s:number)=>((p[3]*s+p[2])*s+p[1])*s+p[0],slope=(s:number)=>Math.hypot((a[0]*s+b[0])*s+c[0],(a[1]*s+b[1])*s+c[1]);
  const split=[0,1],A=3*p[3],B=2*p[2],C=p[1],add=(s:number)=>{if(s>0&&s<1)split.push(s);};
  if(A===0){if(B!==0)add(-C/B);}else{
    const discriminant=B*B-4*A*C;
    if(discriminant>=0){const q=-.5*(B+(B<0?-1:1)*Math.sqrt(discriminant));add(q/A);if(q!==0)add(C/q);}
  }
  split.sort((x,y)=>x-y);let maximum=0;
  for(const s of split)maximum=Math.max(maximum,slope(s));
  for(let i=1;i<split.length;i++){
    let lo=split[i-1],hi=split[i],flo=at(lo);if(!(flo*at(hi)<0))continue;
    for(let j=0;j<48;j++){const mid=(lo+hi)/2,fmid=at(mid);if(fmid===0){lo=hi=mid;break;}if(flo*fmid>0){lo=mid;flo=fmid;}else hi=mid;}
    maximum=Math.max(maximum,slope((lo+hi)/2));
  }
  return maximum*scale;
}

/** Cubic Hermite bending, linear axial/torsion interpolation, consistent mass.
 * Local DOFs at each end: ux, uy, uz, rx, ry, rz. Thus uz' = -ry.
 * No transverse shear, geometric stiffness or bending rotary inertia is included.
 */
export function frameElementMatrices(value:unknown,positions:ArrayLike<number>):FrameElementMatrices {
  const e=record(value,'element');onlyKeys(e,['a','b','youngModulus','shearModulus','area','iy','iz','torsionConstant','density','up'],'element');
  const count=integer(positions.length/3,'node count',2,4096),a=integer(e.a,'a',0,count-1),b=integer(e.b,'b',0,count-1);
  if(a===b)throw new EngineError('INVALID_PAYLOAD','A frame element needs different endpoints.');
  const material={youngModulus:finite(e.youngModulus,'youngModulus',1,1e13),shearModulus:finite(e.shearModulus,'shearModulus',1,1e13),area:finite(e.area,'area',1e-10,1e4),iy:finite(e.iy,'iy',1e-16,1e8),iz:finite(e.iz,'iz',1e-16,1e8),torsionConstant:finite(e.torsionConstant,'torsionConstant',1e-16,1e8),density:finite(e.density,'density',1e-6,1e6)};
  if(!Array.isArray(e.up)||e.up.length!==3)throw new EngineError('INVALID_PAYLOAD','Element up needs three components.');
  const up=e.up.map((v,i)=>zero(finite(v,`up[${i}]`,-1,1))) as [number,number,number];
  const x=[0,1,2].map(k=>finite(positions[3*b+k],'position',-1e6,1e6)-finite(positions[3*a+k],'position',-1e6,1e6));
  const L=finite(Math.hypot(...x),'element length',1e-5,1e6);for(let k=0;k<3;k++)x[k]/=L;
  const dot=x.reduce((s,v,k)=>s+v*up[k],0),y=up.map((v,k)=>v-dot*x[k]),norm=Math.hypot(...y);
  if(norm<1e-8)throw new EngineError('INVALID_PAYLOAD','Element up must not be parallel to its axis.');
  for(let k=0;k<3;k++)y[k]/=norm;
  const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]],basis=Float64Array.from([...x,...y,...z],zero);
  const K=new Float64Array(144),M=new Float64Array(144),{youngModulus:E,shearModulus:G,area:A,iy:Iy,iz:Iz,torsionConstant:J,density:rho}=material;
  const block=(out:Float64Array,ids:number[],values:number[],factor:number,signs=ids.map(()=>1))=>{
    for(let i=0;i<ids.length;i++)for(let j=0;j<ids.length;j++)out[12*ids[i]+ids[j]]+=factor*signs[i]*signs[j]*values[i*ids.length+j];
  };
  const axial=[1,-1,-1,1],linearMass=[2,1,1,2];
  block(K,[0,6],axial,E*A/L);block(K,[3,9],axial,G*J/L);
  block(M,[0,6],linearMass,rho*A*L/6);block(M,[3,9],linearMass,rho*(Iy+Iz)*L/6);
  const bending=[12,6*L,-12,6*L,6*L,4*L*L,-6*L,2*L*L,-12,-6*L,12,-6*L,6*L,2*L*L,-6*L,4*L*L];
  const mass=[156,22*L,54,-13*L,22*L,4*L*L,13*L,-3*L*L,54,13*L,156,-22*L,-13*L,-3*L*L,-22*L,4*L*L];
  block(K,[1,5,7,11],bending,E*Iz/(L*L*L));block(K,[2,4,8,10],bending,E*Iy/(L*L*L),[1,-1,1,-1]);
  block(M,[1,5,7,11],mass,rho*A*L/420);block(M,[2,4,8,10],mass,rho*A*L/420,[1,-1,1,-1]);
  const transform=(local:Float64Array)=>{
    const global=new Float64Array(144);
    for(let i=0;i<12;i++)for(let j=i;j<12;j++){
      let sum=0;const ib=i-i%3,jb=j-j%3;
      for(let r=0;r<3;r++)for(let s=0;s<3;s++)sum+=basis[3*r+i%3]*local[12*(ib+r)+jb+s]*basis[3*s+j%3];
      global[12*i+j]=global[12*j+i]=zero(sum);
    }
    if(!global.every(Number.isFinite))throw new EngineError('INVALID_PAYLOAD','Element matrix exceeds finite representation.');return global;
  };
  return {definition:{a:zero(a),b:zero(b),...material,up},length:L,mass:rho*A*L,dofs:Uint32Array.from(Array.from({length:12},(_,i)=>6*(i<6?a:b)+i%6)),basis,localStiffness:K,stiffness:transform(K),massMatrix:transform(M)};
}
