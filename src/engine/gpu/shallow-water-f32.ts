/**
 * The GPU shallow-water algorithm (shallow-water-wgsl.ts) on the CPU in float32: the same passes, the same gather per
 * cell and the same operations in the same order, each rounded to float32 with Math.fround, which is what a float32
 * addition, multiplication, division or square root gives. It exists to check the shader logic (the GPU and this agree
 * to a few units in the last place per step; they are not bit-identical, because a GPU may fuse a multiply and an add and
 * rounds pow and log differently) and to run the validation cases in the gate, where no shader can run.
 *
 * Differences from the float64 solver (shallow-water.ts), all of them properties of the GPU algorithm:
 *  - the number of substeps of a step is fixed at its start from the largest face speed of the state then (the float64
 *    solver chooses again after every substep);
 *  - the depth takes every increment (the transport step, rain, infiltration) with a per-cell carry (compensated
 *    summation): the volume is sum(h + carry), an increment below half a unit in the last place of a deep cell is not
 *    lost, and a depth that would go below zero leaves its shortfall in the carry instead of in a `clipped` ledger;
 *  - Green-Ampt is solved for the increment with ln(1 + t) by series for small t, because float32 loses the small t;
 *  - the side fluxes (with a carry), the clipped depth and the infiltrated depth are kept per cell and summed in float64
 *    when read.
 * Like the float64 solver, the leading half step of friction comes before the face speeds are measured, and the Courant
 * number reported is the first stage's.
 */
import {EngineError} from '../contracts.ts';
import {ShallowWater} from '../shallow-water.ts';
import {SW_FAR} from './shallow-water-wgsl.ts';

const f=Math.fround;
const minmod=(a:number,b:number):number=>f(a*b)<=0?0:a>0?(a<b?a:b):(a>b?a:b);

export interface ShallowWaterPlan {readonly substeps:number;readonly sub:number;readonly rate:number}
/**
 * The substeps of one step of `duration` s for the face speeds rateX, rateZ (m/s): the fewest equal substeps with
 * sub * (rateX / dx + rateZ / dz) * safety <= cfl. Throws UNSTABLE_TIME_STEP past maxSubsteps.
 */
export function planShallowWaterSubsteps(duration:number,rateX:number,rateZ:number,grid:{readonly dx:number;readonly dz:number;readonly nz:number;readonly cfl:number;readonly maxSubsteps:number},safety=1):ShallowWaterPlan {
  const rate=rateX/grid.dx+(grid.nz>1?rateZ/grid.dz:0),limit=rate>0?grid.cfl/(rate*safety):Infinity;
  const substeps=limit>=duration?1:Math.ceil(duration/limit-1e-12);
  if(!(substeps<=grid.maxSubsteps))throw new EngineError('UNSTABLE_TIME_STEP',`ShallowWater (float32): one step of ${duration} s needs ${substeps} substeps at Courant number ${grid.cfl} (largest wave speed ${Math.max(rateX,rateZ).toPrecision(4)} m/s); the limit is ${grid.maxSubsteps}.`);
  return {substeps,sub:duration/substeps,rate};
}

/** The constant arrays and numbers a float32 backend takes from a ShallowWater (which has validated them). */
export interface ShallowWaterSetup {
  readonly nx:number;readonly nz:number;readonly dx:number;readonly dz:number;readonly origin:readonly [number,number];
  readonly gravity:number;readonly density:number;readonly cfl:number;readonly order:1|2;readonly dryDepth:number;readonly maxSubsteps:number;readonly viscosity:number;
  readonly hasManning:boolean;readonly hasSoil:boolean;readonly hasSolid:boolean;readonly skipZ:boolean;
  /** (bed, Manning n, K or -1 for a solid cell, psi * eta) per cell. */
  readonly fixed:Float32Array;
  /** (h, hu, hv, 0) per cell. */
  readonly state:Float32Array;
  /** (infiltrated, 0, 0, 0) per cell. */
  readonly aux:Float32Array;
  /** Eight vec4: per side (kind, discharge, depth, level), (span from, span to, width, 0). */
  readonly sides:Float32Array;
  readonly wetArea:number;
}
export function shallowWaterSetup(water:ShallowWater):ShallowWaterSetup {
  if(!(water instanceof ShallowWater))throw new EngineError('INVALID_PAYLOAD','A float32 shallow-water backend is built from a ShallowWater.');
  const n=water.cells,fixed=new Float32Array(4*n),state=new Float32Array(4*n),aux=new Float32Array(4*n);
  let hasManning=water.viscosity>0,hasSoil=false,hasSolid=false,open=0;
  for(let c=0;c<n;c++){
    fixed[4*c]=water.bed[c];fixed[4*c+1]=water.manning[c];fixed[4*c+2]=water.solid[c]?-1:water.soilK[c];fixed[4*c+3]=water.soilS[c];
    state[4*c]=water.h[c];state[4*c+1]=water.qx[c];state[4*c+2]=water.qz[c];aux[4*c]=water.infiltrated[c];
    if(water.manning[c]>0)hasManning=true;if(water.soilK[c]>0)hasSoil=true;if(water.solid[c])hasSolid=true;else open++;
  }
  const S=water.sideStates(),sides=new Float32Array(32),clamp=(x:number):number=>x>SW_FAR?SW_FAR:x<-SW_FAR?-SW_FAR:x;
  for(let k=0;k<4;k++)sides.set([S[k].kind,S[k].discharge,S[k].depth,S[k].level,clamp(S[k].lo),clamp(S[k].hi),S[k].width,0],8*k);
  return {nx:water.nx,nz:water.nz,dx:water.dx,dz:water.dz,origin:water.origin,gravity:water.gravity,density:water.density,cfl:water.cfl,order:water.order,dryDepth:water.dryDepth,maxSubsteps:water.maxSubsteps,viscosity:water.viscosity,
    hasManning,hasSoil,hasSolid,skipZ:water.nz===1&&S[2].kind===0&&S[3].kind===0,fixed,state,aux,sides,wetArea:open*water.dx*water.dz};
}

/** What a float32 backend reports of a run; the names follow ShallowWater. */
export interface ShallowWaterF32Stats {substeps:number;totalSubsteps:number;courant:number;maxWaveSpeed:number;wetCells:number}

interface Cell {h:number;e:number;u:number;v:number}
export class ShallowWaterF32 {
  readonly solver='shallow-water-hr-muscl-hll-f32-reference-v1';
  readonly setup:ShallowWaterSetup;readonly water:ShallowWater;
  readonly nx:number;readonly nz:number;readonly dx:number;readonly dz:number;
  /** (h, hu, hv, carry) per cell; live. */
  readonly state:Float32Array;
  /** (infiltrated depth, the first stage's depth increment, volume through the sides, the carry of that sum) per cell. */
  readonly aux:Float32Array;
  readonly fixed:Float32Array;
  readonly stats:ShallowWaterF32Stats={substeps:0,totalSubsteps:0,courant:0,maxWaveSpeed:0,wetCells:0};
  /** Rain volume added so far, m^3 (float64 sum of the float32 depths that were added). */
  rainVolume=0;
  readonly initialVolume:number;
  dt:number;time=0;steps=0;safety=1;
  private readonly stage1:Float32Array;
  private readonly sides:Float32Array;
  private readonly g:number;private readonly dry:number;private readonly fdx:number;private readonly fdz:number;private readonly ox:number;private readonly oz:number;private readonly viscosity:number;
  private lastSub=0;
  // The parameters of the substep being taken.
  private pdt=0;private rain=0;private rainU=0;private rainV=0;private leadDt=0;private trailDt=0;private countWet=false;
  private rateX=0;private rateZ=0;private measureX=0;private measureZ=0;private wet=0;private second=false;
  /** Largest face speeds of the second stages of the last step, m/s (diagnostic: the predictor of a thin film on a slope runs faster than the state). */
  secondX=0;secondZ=0;
  private src:Float32Array;
  // Scratch of the residual.
  private readonly R={rh:0,rn:0,rt:0,bf:0,speed:0};private readonly F={f0:0,f1:0,f2:0,pl:0,pr:0,s:0};private readonly T={rh:0,rx:0,rz:0,bf:0};

  constructor(water:ShallowWater) {
    const s=this.setup=shallowWaterSetup(water);this.water=water;
    this.nx=s.nx;this.nz=s.nz;this.dx=s.dx;this.dz=s.dz;this.state=s.state;this.aux=s.aux;this.fixed=s.fixed;this.sides=s.sides;
    this.stage1=new Float32Array(s.state.length);this.src=this.state;
    this.g=f(s.gravity);this.dry=f(s.dryDepth);this.fdx=f(s.dx);this.fdz=f(s.dz);this.ox=f(s.origin[0]);this.oz=f(s.origin[1]);this.viscosity=f(s.viscosity);
    this.dt=water.dt;this.time=water.time;this.initialVolume=this.volume();this.stats.wetCells=this.countWetCells();
    for(let c=0;c<this.aux.length;c+=4)this.infiltratedAtStart+=this.aux[c];
  }
  get cells():number {return this.nx*this.nz;}
  /** Depth, discharges and infiltrated depth as float64 arrays (the depth with its carry). */
  depth(c:number):number {return this.state[4*c]+this.state[4*c+3];}
  volume():number {let s=0;const U=this.state;for(let c=0;c<U.length;c+=4)s+=U[c]+U[c+3];return s*this.dx*this.dz;}
  /** inflow, infiltrated, clipped (m^3) from the per-cell sums. */
  ledger():{inflow:number;rain:number;infiltrated:number;clipped:number} {
    let a=0,b=0;const A=this.aux;for(let k=0;k<A.length;k+=4){a+=A[k+2]+A[k+3];b+=A[k];}
    const area=this.dx*this.dz;return {inflow:a,rain:this.rainVolume,infiltrated:(b-this.infiltratedAtStart)*area,clipped:0};
  }
  private infiltratedAtStart=0;
  volumeError():number {const L=this.ledger();return this.volume()-this.initialVolume-(L.inflow+L.rain-L.infiltrated+L.clipped);}
  private countWetCells():number {let w=0;const U=this.state;for(let c=0;c<U.length;c+=4)if(U[c]>this.dry)w++;return w;}

  step(count=1):void {for(let s=0;s<count;s++)this.advance(this.dt);}
  /** The largest face speeds of the present state (what the GPU's measuring pass gives). */
  measure():[number,number] {
    this.pdt=0;this.src=this.state;this.measureX=0;this.measureZ=0;
    for(let k=0;k<this.nz;k++)for(let i=0;i<this.nx;i++){const c=i+this.nx*k;if(this.fixed[4*c+2]<0)continue;this.residual(i,k,c,true);}
    return [this.measureX,this.measureZ];
  }
  advance(duration:number):void {
    // The leading half of the friction first (with the length of the last substep), as the float64 solver does it.
    const led=this.setup.hasManning&&this.lastSub>0;
    if(led)this.lead(f(.5*this.lastSub));
    const [rx,rz]=this.measure();
    const plan=planShallowWaterSubsteps(duration,rx,rz,{dx:this.dx,dz:this.dz,nz:this.nz,cfl:this.setup.cfl,maxSubsteps:this.setup.maxSubsteps},this.safety);
    this.rateX=0;this.rateZ=0;this.secondX=0;this.secondZ=0;
    for(let s=0;s<plan.substeps;s++)this.substep(plan.sub,s===plan.substeps-1,led&&s===0);
    const rate=this.rateX/this.dx+(this.nz>1?this.rateZ/this.dz:0);
    this.stats.substeps=plan.substeps;this.stats.totalSubsteps+=plan.substeps;this.stats.courant=plan.sub*rate;this.stats.maxWaveSpeed=Math.max(this.rateX,this.rateZ);this.stats.wetCells=this.wet;
    this.steps++;
  }
  /** One substep of `sub` s, as the GPU takes it: leading friction, first stage, second stage with the sources. */
  private lead(dt:number):void {const U=this.state,X=this.fixed;for(let c=0;c<this.cells;c++){if(X[4*c+2]<0)continue;this.friction(U,4*c,U[4*c],X[4*c+1],dt);}}
  substep(sub:number,last:boolean,led=false):void {
    const s=this.setup,water=this.water,rain=water.rainAt(this.time+.5*sub)*sub;
    this.pdt=f(sub);this.rain=f(rain);this.rainU=f(rain*water.rainVelocity[0]);this.rainV=f(rain*water.rainVelocity[1]);
    this.leadDt=f(.5*(this.lastSub>0?this.lastSub:sub));this.trailDt=f(.5*sub);this.countWet=last;
    const n=this.cells,U=this.state,U1=this.stage1,A=this.aux,X=this.fixed,T=this.T,dt=this.pdt,dry=this.dry,nx=this.nx;
    if(s.hasManning&&!led)this.lead(this.leadDt);
    // stage: U1 = U + dt R(U)
    this.src=U;
    for(let c=0;c<n;c++){
      const o=4*c;
      if(X[o+2]<0){U1[o]=U[o];U1[o+1]=U[o+1];U1[o+2]=U[o+2];U1[o+3]=U[o+3];continue;}
      this.residual(c%nx,(c/nx)|0,c,false);
      const d1=f(dt*T.rh);
      let h=f(U[o]+d1),qx=f(U[o+1]+f(dt*T.rx)),qz=f(U[o+2]+f(dt*T.rz));
      if(h<=dry){if(h<0)h=0;qx=0;qz=0;}
      A[o+1]=d1;
      U1[o]=h;U1[o+1]=qx;U1[o+2]=qz;U1[o+3]=f(T.bf*dt);
    }
    // finish: U = (U + U1 + dt R(U1)) / 2, then the sources. Cell c of U is read (its own) before it is written, as on the GPU.
    this.src=U1;this.wet=last?0:this.wet;this.second=true;
    const rainOn=this.rain>0;let open=0;
    for(let c=0;c<n;c++){
      const o=4*c;if(X[o+2]<0)continue;open++;
      let qx=U1[o+1],qz=U1[o+2],through=U1[o+3],grow=A[o+1];
      if(s.order===2){
        this.residual(c%nx,(c/nx)|0,c,false);
        grow=f(.5*f(A[o+1]+f(dt*T.rh)));qx=f(.5*f(f(U[o+1]+U1[o+1])+f(dt*T.rx)));qz=f(.5*f(f(U[o+2]+U1[o+2])+f(dt*T.rz)));
        through=f(f(.5*U1[o+3])+f(.5*f(T.bf*dt)));
      }
      this.settle(U[o],U[o+3],grow);
      if(this.sh<=dry){qx=0;qz=0;}
      if(through!==0||A[o+3]!==0){const y=f(through+A[o+3]),t=f(A[o+2]+y);A[o+3]=f(y-f(t-A[o+2]));A[o+2]=t;}
      if(rainOn){this.settle(this.sh,this.sc,this.rain);qx=f(qx+this.rainU);qz=f(qz+this.rainV);}
      if(s.hasSoil){
        const K=X[o+2];
        if(K>0&&this.sh>0){
          const before=this.sh,taken=this.greenAmpt(A[o],before,K,X[o+3],dt);
          if(taken>0){
            this.settle(before,this.sc,-taken);
            if(this.sh>dry){const r=f(this.sh/before);qx=f(qx*r);qz=f(qz*r);}else{qx=0;qz=0;}
            A[o]=f(A[o]+taken);
          }
        }
      }
      const h=this.sh;
      U[o]=h;U[o+1]=qx;U[o+2]=qz;U[o+3]=this.sc;
      if(s.hasManning)this.friction(U,o,h,X[o+1],this.trailDt);
      if(last&&h>dry)this.wet++;
    }
    this.second=false;
    if(rainOn)this.rainVolume+=this.rain*open*this.dx*this.dz;
    this.lastSub=sub;this.time+=sub;
  }

  /** h + inc with the carry, into sh (depth) and sc (carry); a depth that would go below zero is zero and the shortfall stays in the carry. */
  private sh=0;private sc=0;
  private settle(h0:number,carry:number,inc:number):void {
    const y=f(inc+carry),t=f(h0+y);let c=f(y-f(t-h0)),h=t;
    if(h<0){c=f(c+h);h=0;}
    this.sh=h;this.sc=c;
  }
  private friction(U:Float32Array,o:number,d:number,m:number,dt:number):void {
    const laminar=f(f(3*this.viscosity)*dt);
    if(d<=this.dry||!(m>0||laminar>0))return;
    const qx=U[o+1],qz=U[o+2],mag=f(Math.sqrt(f(f(qx*qx)+f(qz*qz))));
    if(mag===0)return;
    const dd=f(d*d),a=f(1+f(laminar/dd)),b=f(f(f(f(dt*this.g)*m)*m)/f(dd*f(Math.cbrt(d))));
    const factor=f(2/f(a+f(Math.sqrt(f(f(a*a)+f(f(4*b)*mag))))));
    U[o+1]=f(qx*factor);U[o+2]=f(qz*factor);
  }
  private log1p(t:number):number {
    if(Math.abs(t)<f(0.03))return f(t*f(1-f(t*f(.5-f(t*f(f(1/3)-f(t*f(.25-f(t*f(.2))))))))));
    return f(Math.log(f(1+t)));
  }
  private greenAmpt(F:number,available:number,K:number,S:number,dt:number):number {
    const kdt=f(K*dt);
    if(available<=kdt)return available;
    if(!(S>0))return available<kdt?available:kdt;
    const fs=f(F+S);
    if(f(f(available-f(S*this.log1p(f(available/fs))))-kdt)<=0)return available;
    let lo=kdt,up=available,x=up;
    for(let it=0;it<40;it++){
      const gx=f(f(x-f(S*this.log1p(f(x/fs))))-kdt);
      if(gx>0)up=x;else lo=x;
      const dg=f(f(F+x)/f(fs+x));
      let next=f(x-f(gx/(dg>f(1e-30)?dg:f(1e-30))));
      if(!(next>lo&&next<up))next=f(.5*f(lo+up));
      const done=Math.abs(f(next-x))<=f(f(1e-7)*Math.abs(x));
      x=next;if(done)break;
    }
    return x<0?0:x>available?available:x;
  }

  private cell(c:number,axis:number,out:Cell):Cell {
    const U=this.src,o=4*c,h=U[o];out.h=h;out.e=f(h+this.fixed[o]);out.u=0;out.v=0;
    if(h>this.dry){if(axis===0){out.u=f(U[o+1]/h);out.v=f(U[o+2]/h);}else{out.u=f(U[o+2]/h);out.v=f(U[o+1]/h);}}
    return out;
  }
  private readonly ca:Cell={h:0,e:0,u:0,v:0};private readonly cm:Cell={h:0,e:0,u:0,v:0};private readonly cb:Cell={h:0,e:0,u:0,v:0};
  private readonly cn:Cell={h:0,e:0,u:0,v:0};
  private readonly sa=new Float32Array(4);private readonly sm=new Float32Array(4);private readonly sb=new Float32Array(4);
  private solidAt(c:number):boolean {return this.fixed[4*c+2]<0;}
  private edgeSlope(c:number,j:number,count:number,step:number,side:number):number {
    if(count<2)return 0;
    const X=this.fixed,U=this.src,solids=this.setup.hasSolid;
    if(j===0&&this.sides[8*side]===1){
      const b=c+step;if(solids&&(this.solidAt(c)||this.solidAt(b)))return 0;
      return minmod(f(X[4*b]-X[4*c]),f(f(U[4*b]+X[4*b])-f(U[4*c]+X[4*c])));
    }
    if(j===count-1&&this.sides[8*(side+1)]===1){
      const a=c-step;if(solids&&(this.solidAt(c)||this.solidAt(a)))return 0;
      return minmod(f(f(U[4*c]+X[4*c])-f(U[4*a]+X[4*a])),f(X[4*c]-X[4*a]));
    }
    return 0;
  }
  private slope(c:number,j:number,count:number,step:number,axis:number,out:Float32Array):Float32Array {
    out[0]=0;out[1]=0;out[2]=0;out[3]=0;
    if(this.setup.order<2)return out;
    let edge=j===0||j===count-1;
    if(!edge&&this.setup.hasSolid)edge=this.solidAt(c)||this.solidAt(c-step)||this.solidAt(c+step);
    if(edge){out[1]=this.edgeSlope(c,j,count,step,2*axis);return out;}
    const a=this.cell(c-step,axis,this.ca),m=this.cell(c,axis,this.cn),b=this.cell(c+step,axis,this.cb);
    out[0]=minmod(f(m.h-a.h),f(b.h-m.h));out[1]=minmod(f(m.e-a.e),f(b.e-m.e));out[2]=minmod(f(m.u-a.u),f(b.u-m.u));out[3]=minmod(f(m.v-a.v),f(b.v-m.v));
    return out;
  }
  private hll(hL:number,eL:number,uL:number,vL:number,hR:number,eR:number,uR:number,vR:number):void {
    const g=this.g,F=this.F,bL=f(eL-hL),bR=f(eR-hR),bs=bL>bR?bL:bR;
    let hl=f(eL-bs),hr=f(eR-bs);if(!(hl>0))hl=0;if(!(hr>0))hr=0;
    const hg=f(.5*g);
    F.pl=f(hg*f(f(hL*hL)-f(hl*hl)));F.pr=f(hg*f(f(hR*hR)-f(hr*hr)));F.f0=0;F.f1=0;F.f2=0;F.s=0;
    if(hl<=0&&hr<=0)return;
    const cl=f(Math.sqrt(f(g*hl))),cr=f(Math.sqrt(f(g*hr)));
    let sL:number,sR:number;
    if(hl<=0){sL=f(uR-f(2*cr));sR=f(uR+cr);}
    else if(hr<=0){sL=f(uL-cl);sR=f(uL+f(2*cl));}
    else{const a=f(uL-cl),b=f(uR-cr),c=f(uL+cl),d=f(uR+cr);sL=a<b?a:b;sR=c>d?c:d;}
    const qL=f(hl*uL),qR=f(hr*uR),fL=f(f(qL*uL)+f(f(hg*hl)*hl)),fR=f(f(qR*uR)+f(f(hg*hr)*hr));
    if(sL>=0){F.f0=qL;F.f1=fL;}
    else if(sR<=0){F.f0=qR;F.f1=fR;}
    else{
      const k=f(1/f(sR-sL)),ss=f(sL*sR);
      F.f0=f(f(f(f(sR*qL)-f(sL*qR))+f(ss*f(hr-hl)))*k);
      F.f1=f(f(f(f(sR*fL)-f(sL*fR))+f(ss*f(qR-qL)))*k);
    }
    F.f2=f(F.f0*(F.f0>=0?vL:vR));
    F.s=-sL>sR?-sL:sR;
  }
  private interior(a:Cell,sa:Float32Array,b:Cell,sb:Float32Array):void {
    const hL=f(a.h+f(.5*sa[0])),hR=f(b.h-f(.5*sb[0]));
    let uL=0,vL=0,uR=0,vR=0;
    if(hL>this.dry){uL=f(a.u+f(.5*sa[2]));vL=f(a.v+f(.5*sa[3]));}
    if(hR>this.dry){uR=f(b.u-f(.5*sb[2]));vR=f(b.v-f(.5*sb[3]));}
    this.hll(hL,f(a.e+f(.5*sa[1])),uL,vL,hR,f(b.e-f(.5*sb[1])),uR,vR);
  }
  private boundaryFace(m:Cell,sm:Float32Array,sgn:number,side:number,c:number,axis:number,k:number):void {
    const R=this.R,F=this.F,g=this.g,S=this.sides,half=f(sgn*.5);
    const hi=f(m.h+f(half*sm[0])),ei=f(m.e+f(half*sm[1]));
    let ui=0,vi=0;
    if(hi>this.dry){ui=f(sgn*f(m.u+f(half*sm[2])));vi=f(m.v+f(half*sm[3]));}
    let kind=0,A0=0,A1=0,A2=0,A3=0,B0=0,B1=0,B2=0;
    if(side>=0){A0=S[8*side];A1=S[8*side+1];A2=S[8*side+2];A3=S[8*side+3];B0=S[8*side+4];B1=S[8*side+5];B2=S[8*side+6];kind=A0;}
    if(kind===2){
      const t=axis===0?f(this.oz+f(f(((c/this.nx)|0)+.5)*this.fdz)):f(this.ox+f(f(c%this.nx+.5)*this.fdx));
      if(t<B0||t>B1)kind=0;
    }
    const width=kind===2?B2:axis===0?f(this.fdz*this.nz):f(this.fdx*this.nx);
    let gh=hi,ge=ei,gu=ui,gv=vi;const bed=f(ei-hi);
    if(kind===0)gu=-ui;
    else if(kind===2){
      const q=f(A1/width);
      if(A2>0){gh=A2;ge=f(bed+A2);gu=f(-q/A2);gv=0;}
      else if(q<=0){gu=0;gv=0;}
      else{
        const goal=f(-ui-f(2*f(Math.sqrt(f(g*(hi>0?hi:0))))));
        const fn=(x:number):number=>f(f(f(q/x)-f(2*f(Math.sqrt(f(g*x)))))-goal);
        let lo=f(1e-12),up=hi>f(1e-6)?hi:f(1e-6);
        for(let it=0;it<64;it++){if(fn(up)>0&&up<1e6)up=f(up*2);else break;}
        for(let it=0;it<48;it++){const mid=f(.5*f(lo+up));if(fn(mid)>0)lo=mid;else up=mid;}
        const hg=f(.5*f(lo+up));gh=hg;ge=f(bed+hg);gu=f(-q/hg);gv=0;
      }
    }else if(kind===3){
      const cc=f(Math.sqrt(f(g*(hi>0?hi:0))));
      if(!(hi>this.dry&&ui>=cc)){
        const d=f(A3-bed),hg=d>0?d:0,cg=f(Math.sqrt(f(g*hg)));
        gh=hg;ge=f(bed+hg);gv=vi;gu=hg>0?f(ui+f(2*f(cc-cg))):0;
      }
    }
    this.hll(hi,ei,ui,vi,gh,ge,gu,gv);
    if(kind===2){F.f0=f(-A1/width);F.f2=0;}
    R.rh=f(R.rh-f(F.f0*k));R.rn=f(R.rn-f(f(sgn*f(F.f1+F.pl))*k));R.rt=f(R.rt-f(F.f2*k));
    if(side>=0)R.bf=f(R.bf-f(F.f0*(axis===0?this.fdz:this.fdx)));
    if(F.s>R.speed)R.speed=F.s;
  }
  private axisResidual(c:number,j:number,count:number,step:number,axis:number,d:number):void {
    const R=this.R,F=this.F,solids=this.setup.hasSolid,k=f(1/d);
    R.rh=0;R.rn=0;R.rt=0;R.bf=0;R.speed=0;
    const sm=this.slope(c,j,count,step,axis,this.sm),m=this.cell(c,axis,this.cm);
    if(this.setup.order>=2&&m.h>0)R.rn=f(R.rn+f(f(f(this.g/d)*m.h)*f(sm[0]-sm[1])));
    if(j===0)this.boundaryFace(m,sm,-1,2*axis,c,axis,k);
    else if(solids&&this.solidAt(c-step))this.boundaryFace(m,sm,-1,-1,c,axis,k);
    else{
      const sa=this.slope(c-step,j-1,count,step,axis,this.sa),a=this.cell(c-step,axis,this.ca);
      this.interior(a,sa,m,sm);
      R.rh=f(R.rh+f(F.f0*k));R.rn=f(R.rn+f(f(F.f1+F.pr)*k));R.rt=f(R.rt+f(F.f2*k));if(F.s>R.speed)R.speed=F.s;
    }
    if(j===count-1)this.boundaryFace(m,sm,1,2*axis+1,c,axis,k);
    else if(solids&&this.solidAt(c+step))this.boundaryFace(m,sm,1,-1,c,axis,k);
    else{
      const sb=this.slope(c+step,j+1,count,step,axis,this.sb),b=this.cell(c+step,axis,this.cb);
      this.interior(m,sm,b,sb);
      R.rh=f(R.rh-f(F.f0*k));R.rn=f(R.rn-f(f(F.f1+F.pl)*k));R.rt=f(R.rt-f(F.f2*k));if(F.s>R.speed)R.speed=F.s;
    }
  }
  private residual(i:number,k:number,c:number,measuring:boolean):void {
    const T=this.T,R=this.R;
    this.axisResidual(c,i,this.nx,1,0,this.fdx);
    T.rh=R.rh;T.rx=R.rn;T.rz=R.rt;T.bf=R.bf;
    if(measuring){if(R.speed>this.measureX)this.measureX=R.speed;}else if(this.second){if(R.speed>this.secondX)this.secondX=R.speed;}else if(R.speed>this.rateX)this.rateX=R.speed;
    if(!this.setup.skipZ){
      this.axisResidual(c,k,this.nz,this.nx,1,this.fdz);
      T.rh=f(T.rh+R.rh);T.rz=f(T.rz+R.rn);T.rx=f(T.rx+R.rt);T.bf=f(T.bf+R.bf);
      if(measuring){if(R.speed>this.measureZ)this.measureZ=R.speed;}else if(this.second){if(R.speed>this.secondZ)this.secondZ=R.speed;}else if(R.speed>this.rateZ)this.rateZ=R.speed;
    }
  }
}
