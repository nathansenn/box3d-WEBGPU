/**
 * The GPU discrete-element algorithm (granular-wgsl.ts) on the CPU in float32: the same six passes over the same buffer
 * layouts, the same hash grid and history slots, the same operations in the same order, each rounded with Math.fround.
 * It checks the shader logic (the GPU and this agree to rounding per step) and runs the validation in the gate.
 *
 * What the algorithm does differently from the float64 solver (granular.ts), by design:
 *  - neighbours come from a hash grid of cell size 2 r_max rebuilt every step, not from a Verlet list;
 *  - every pair is evaluated from both grains (the forces are exact negatives), not once;
 *  - contact history is kept in K slots per grain; a contact that finds no free slot is evaluated without history
 *    (its tangential spring starts from zero every step) and counted in `historyOverflow`;
 *  - a hash bucket holds M grains; a grain that finds its bucket full is not seen by its neighbours that step and is
 *    counted in `bucketOverflow` (the driver treats a nonzero count as an error);
 *  - no energy ledger (dissipated work is not summed); sums over grains are taken in float64 from a readback.
 */
import {EngineError} from '../contracts.ts';
import {Granular,type GranularBackendDescription} from '../granular.ts';
import {DEM_BLOCK,DEM_EMPTY,DEM_MAX_WALLS,DEM_PARAMS,DEM_WALL,DEM_WALL_KEY} from './granular-wgsl.ts';

const f=Math.fround;
export interface DemOptions {
  /** History slots per grain, K. Default 10. Memory: capacity * K * 16 bytes (32 with rolling friction), twice. */
  readonly historySlots?:number;
  /** Grains a hash bucket holds, M. Default max(12, 4 (r_max / r_min)^3). */
  readonly bucketSlots?:number;
  /** Hash buckets: a power of two. Default the first power of two at or above twice the capacity. */
  readonly tableSize?:number;
}
/** The buffers and numbers of a float32 DEM backend, taken from a Granular (which has validated them). */
export interface DemSetup {
  readonly capacity:number;count:number;readonly K:number;readonly M:number;readonly HS:1|2;readonly T:number;readonly wallCount:number;readonly blocks:number;
  readonly rolling:boolean;readonly dt:number;readonly cell:number;
  /** (x, y, z, r), (v, mass), (omega, 1 / I), then force and torque (two vec4 per grain). */
  readonly pos:Float32Array;readonly vel:Float32Array;readonly spin:Float32Array;readonly ft:Float32Array;
  /** wallCount + 1 elements of DEM_WALL (the last holds the statistics). */
  readonly walls:ArrayBuffer;
  /** DEM_PARAMS values that do not change between steps. */
  readonly params:Record<string,number|number[]>;
}
const nextPow2=(x:number):number=>{let p=64;while(p<x)p*=2;return p;};

/** Pack the walls of a description into `target` (DEM_WALL elements). `state` false keeps the sums already there. */
export function packDemWalls(description:GranularBackendDescription,target:ArrayBuffer,state=true):void {
  description.walls.forEach((w,k)=>{
    const q=w.rotation,l=Math.hypot(q[0],q[1],q[2],q[3])||1,x=q[0]/l,y=q[1]/l,z=q[2]/l,s=q[3]/l;
    const values:Record<string,number|number[]>={shape:w.shape,kind:w.type,enabled:w.enabled?1:0,
      r0:[1-2*(y*y+z*z),2*(x*y-z*s),2*(x*z+y*s),0],r1:[2*(x*y+z*s),1-2*(x*x+z*z),2*(y*z-x*s),0],r2:[2*(x*z-y*s),2*(y*z+x*s),1-2*(x*x+y*y),0],
      x:[...w.position,0],v:[...w.linearVelocity,w.curved],w:[...w.angularVelocity,w.mass],dimA:w.dim.slice(0,4),dimB:[w.dim[4],w.dim[5],w.dim[6],0],
      coef:[w.alpha,w.friction,w.rollingFriction,w.gravityScale],q:[x,y,z,s],inv:[...w.invInertia,w.mass>0?1/w.mass:0],extF:[w.external[0],w.external[1],w.external[2],0],extT:[w.external[3],w.external[4],w.external[5],0]};
    if(state)Object.assign(values,{force:[...w.force,0],torque:[...w.torque,0],impulse:[...w.impulse,0],angularImpulse:[...w.angularImpulse,0]});
    DEM_WALL.write(target,values,k);
  });
}
export function demSetup(granular:Granular,options:DemOptions={}):DemSetup {
  if(!(granular instanceof Granular))throw new EngineError('INVALID_PAYLOAD','A float32 granular backend is built from a Granular.');
  const d=granular.backendDescription(),capacity=granular.capacity,n=granular.grainCount;
  if(d.walls.length>DEM_MAX_WALLS)throw new EngineError('GPU_UNAVAILABLE',`The GPU granular backend takes at most ${DEM_MAX_WALLS} walls (this set has ${d.walls.length}).`);
  const rMax=n?d.rMax:1,rMin=n?d.rMin:1,ratio=rMax/rMin;
  const K=options.historySlots??10,M=options.bucketSlots??Math.max(12,Math.ceil(4*ratio*ratio*ratio)),T=options.tableSize??nextPow2(2*capacity);
  if(!Number.isInteger(K)||K<1||K>64)throw new EngineError('INVALID_PAYLOAD','historySlots must be a whole number from 1 to 64.');
  if(!Number.isInteger(M)||M<1||M>256)throw new EngineError('INVALID_PAYLOAD','bucketSlots must be a whole number from 1 to 256.');
  if(!Number.isInteger(T)||T<64||(T&(T-1))!==0)throw new EngineError('INVALID_PAYLOAD','tableSize must be a power of two of at least 64.');
  const rolling=d.rollingFriction>0||d.walls.some(w=>w.rollingFriction>0);
  const pos=new Float32Array(4*capacity),vel=new Float32Array(4*capacity),spin=new Float32Array(4*capacity),ft=new Float32Array(8*capacity);
  const walls=DEM_WALL.create(d.walls.length+1);packDemWalls(d,walls);
  const setup:DemSetup={capacity,count:n,K,M,HS:rolling?2:1,T,wallCount:d.walls.length,blocks:Math.ceil(capacity/DEM_BLOCK),rolling,dt:granular.dt,cell:2*rMax,pos,vel,spin,ft,walls,
    params:{tableMask:T-1,tableSize:T,walls:d.walls.length,hertz:d.hertz?1:0,flags:d.bounds?1:0,invCell:1/(2*rMax),tdamp:d.tangentialDamping,kHertz:d.kHertz,kMindlin:d.kMindlin,kn:d.kn,kt:d.kt,alpha:d.alpha,mu:d.friction,mur:d.rollingFriction,
      gravity:[...granular.gravity,0],boundsMin:d.bounds?[d.bounds[0],d.bounds[1],d.bounds[2],0]:[0,0,0,0],boundsMax:d.bounds?[d.bounds[3],d.bounds[4],d.bounds[5],0]:[0,0,0,0]}};
  packDemGrains(granular,setup);
  return setup;
}
/** Copy the grains of a Granular into the buffers of a setup (positions, velocities, spins, radii, masses; forces zeroed for new grains only). */
export function packDemGrains(granular:Granular,setup:DemSetup):void {
  const n=granular.grainCount,x=granular.positions,v=granular.velocities,w=granular.angularVelocities,r=granular.radii,m=granular.masses,alive=granular.alive;
  if(n>setup.capacity)throw new EngineError('INVALID_PAYLOAD','More grains than the backend was built for.');
  for(let i=0;i<n;i++){
    const o=4*i,rr=alive[i]?r[i]:-r[i];
    setup.pos[o]=x[3*i];setup.pos[o+1]=x[3*i+1];setup.pos[o+2]=x[3*i+2];setup.pos[o+3]=rr;
    setup.vel[o]=v[3*i];setup.vel[o+1]=v[3*i+1];setup.vel[o+2]=v[3*i+2];setup.vel[o+3]=m[i];
    setup.spin[o]=w[3*i];setup.spin[o+1]=w[3*i+1];setup.spin[o+2]=w[3*i+2];setup.spin[o+3]=1/(.4*m[i]*r[i]*r[i]);
  }
  setup.count=n;
}
/** DEM_PARAMS for one evaluation with step h (0: evaluate the forces only). */
export const demParams=(setup:DemSetup,h:number):Record<string,number|number[]>=>({...setup.params,count:setup.count,blocks:Math.ceil(setup.count/DEM_BLOCK),h,hh:.5*h});

export interface DemStats {steps:number;contacts:number;wallContacts:number;overlap:number;maxOverlap:number;removed:number;bucketOverflow:number;historyOverflow:number}
/** Field offsets of DEM_WALL in float32 words. */
const WO=Object.fromEntries(DEM_WALL.fields.map(field=>[field.name,field.offset/4])) as Record<string,number>,WS=DEM_WALL.stride/4;

export class GranularF32 {
  readonly solver='granular-dem-hash-grid-f32-reference-v1';
  readonly setup:DemSetup;
  readonly pos:Float32Array;readonly vel:Float32Array;readonly spin:Float32Array;readonly ft:Float32Array;
  /** The walls as float32 words and as unsigned words (the same bytes). */
  readonly wallF:Float32Array;readonly wallU:Uint32Array;
  readonly stats:DemStats={steps:0,contacts:0,wallContacts:0,overlap:0,maxOverlap:0,removed:0,bucketOverflow:0,historyOverflow:0};
  time=0;
  private hOld:Uint32Array;private hNew:Uint32Array;private readonly bits=new Float32Array(1);private readonly word=new Uint32Array(this.bits.buffer);
  private readonly grid:Uint32Array;private readonly sums:Float32Array;
  // The parameters of the evaluation under way (float32).
  private h=0;private hh=0;private readonly P:Record<string,number>;private readonly g:Float32Array;private readonly bmin:Float32Array;private readonly bmax:Float32Array;
  private pairContacts=0;private pairOverlap=0;
  // Scratch of one contact: force, tangential force, rolling moment, new displacement and rotation.
  private readonly C=new Float32Array(15);private load=0;
  private readonly hit=new Float32Array(7);

  /** From a Granular (its grains, walls and settings), or from a setup made by `demSetup`. */
  constructor(source:Granular|DemSetup,options:DemOptions={}) {
    const s=this.setup=source instanceof Granular?demSetup(source,options):source;
    this.pos=s.pos;this.vel=s.vel;this.spin=s.spin;this.ft=s.ft;
    this.wallF=new Float32Array(s.walls);this.wallU=new Uint32Array(s.walls);
    this.hOld=new Uint32Array(4*s.HS*s.K*s.capacity).fill(DEM_EMPTY);this.hNew=new Uint32Array(4*s.HS*s.K*s.capacity).fill(DEM_EMPTY);
    this.grid=new Uint32Array(s.T*(1+s.M));this.sums=new Float32Array(4*(2*s.wallCount+1)*Math.ceil(s.capacity/DEM_BLOCK));
    const p=s.params,num=(key:string):number=>f(p[key] as number);
    this.P={invCell:num('invCell'),tdamp:num('tdamp'),kHertz:num('kHertz'),kMindlin:num('kMindlin'),kn:num('kn'),kt:num('kt'),alpha:num('alpha'),mu:num('mu'),mur:num('mur'),hertz:p.hertz as number,bounds:p.flags as number};
    this.g=Float32Array.from(p.gravity as number[]);this.bmin=Float32Array.from(p.boundsMin as number[]);this.bmax=Float32Array.from(p.boundsMax as number[]);
    this.time=source instanceof Granular?source.time:0;
    this.evaluate(0);
  }
  get count():number {return this.setup.count;}
  /** The setup's buffers were written from outside (grains added or removed, walls moved): evaluate the forces again. The contact histories are kept. */
  refresh():void {this.evaluate(0);}
  step(count=1):void {for(let s=0;s<count;s++){this.evaluate(this.setup.dt);this.time+=this.setup.dt;this.stats.steps++;}}

  /** The six passes with step h. */
  private evaluate(h:number):void {
    const s=this.setup,n=s.count,blocks=Math.ceil(n/DEM_BLOCK);
    this.h=f(h);this.hh=f(.5*h);
    for(let k=0;k<s.wallCount;k++)this.wallOpen(k);
    this.grid.fill(0,0,s.T);this.pairContacts=0;this.pairOverlap=0;
    for(let i=0;i<n;i++)this.integrate(i);
    for(let b=0;b<s.T;b++)this.sortBucket(b);
    for(let i=0;i<n;i++)this.pairs(i);
    for(let b=0;b<blocks;b++)this.wallContacts(b);
    for(let k=0;k<=s.wallCount;k++)this.wallClose(k,blocks);
    const swap=this.hOld;this.hOld=this.hNew;this.hNew=swap;
    const st=this.stats,stat=WS*s.wallCount+WO.force;
    st.contacts=this.pairContacts/2;st.wallContacts=this.wallF[stat+2];st.overlap=Math.max(this.pairOverlap,this.wallF[stat+1]);if(st.overlap>st.maxOverlap)st.maxOverlap=st.overlap;
    st.historyOverflow=this.pairHistoryOverflow+this.wallF[stat];
  }
  private pairHistoryOverflow=0;

  private cellOf(x:number):number {return Math.floor(f(x*this.P.invCell))|0;}
  private bucket(cx:number,cy:number,cz:number):number {return ((Math.imul(cx,73856093)^Math.imul(cy,19349663)^Math.imul(cz,83492791))&(this.setup.T-1))>>>0;}

  private integrate(i:number):void {
    const o=4*i,p=this.pos,v=this.vel,w=this.spin,F=this.ft,g=this.g,hh=this.hh,h=this.h;
    if(p[o+3]<=0)return;
    const im=f(f(1/v[o+3])*hh),ii=f(w[o+3]*hh);
    const vx=f(v[o]+f(f(F[8*i]*im)+f(g[0]*hh))),vy=f(v[o+1]+f(f(F[8*i+1]*im)+f(g[1]*hh))),vz=f(v[o+2]+f(f(F[8*i+2]*im)+f(g[2]*hh)));
    const wx=f(w[o]+f(F[8*i+4]*ii)),wy=f(w[o+1]+f(F[8*i+5]*ii)),wz=f(w[o+2]+f(F[8*i+6]*ii));
    const x=f(p[o]+f(vx*h)),y=f(p[o+1]+f(vy*h)),z=f(p[o+2]+f(vz*h));
    if(this.P.bounds&&(x<this.bmin[0]||x>this.bmax[0]||y<this.bmin[1]||y>this.bmax[1]||z<this.bmin[2]||z>this.bmax[2])){
      p[o]=x;p[o+1]=y;p[o+2]=z;p[o+3]=-p[o+3];v[o]=0;v[o+1]=0;v[o+2]=0;w[o]=0;w[o+1]=0;w[o+2]=0;this.stats.removed++;return;
    }
    p[o]=x;p[o+1]=y;p[o+2]=z;v[o]=vx;v[o+1]=vy;v[o+2]=vz;w[o]=wx;w[o+1]=wy;w[o+2]=wz;
    if(!(Math.abs(x)+Math.abs(y)+Math.abs(z)<3e38))throw new EngineError('UNSTABLE_TIME_STEP',`Grain ${i} has no finite position at t = ${this.time} s: the run diverged.`);
    const s=this.setup,b=this.bucket(this.cellOf(x),this.cellOf(y),this.cellOf(z)),slot=this.grid[b]++;
    if(slot<s.M)this.grid[s.T+b*s.M+slot]=i;else this.stats.bucketOverflow++;
  }
  private sortBucket(b:number):void {
    const s=this.setup,G=this.grid,n=Math.min(G[b],s.M),base=s.T+b*s.M;G[b]=n;
    for(let a=1;a<n;a++){const key=G[base+a];let k=a;while(k>0&&G[base+k-1]>key){G[base+k]=G[base+k-1];k--;}G[base+k]=key;}
  }
  private oldSlot(i:number,key:number):number {
    const s=this.setup,H=this.hOld,K=s.K,HS=s.HS;
    for(let k=0;k<K;k++)if(H[4*(i*K+k)*HS+3]===key)return k;
    return K;
  }
  private fromBits(u:number):number {this.word[0]=u;return this.bits[0];}
  private toBits(x:number):number {this.bits[0]=x;return this.word[0];}

  /** turned(): a stored displacement into the tangent plane of n, keeping its length. Into C at `o`. */
  private turned(sx:number,sy:number,sz:number,nx:number,ny:number,nz:number,C:Float32Array,o:number):void {
    const d=f(f(f(sx*nx)+f(sy*ny))+f(sz*nz));
    if(d!==0){
      const before=f(f(f(sx*sx)+f(sy*sy))+f(sz*sz));
      sx=f(sx-f(d*nx));sy=f(sy-f(d*ny));sz=f(sz-f(d*nz));
      const after=f(f(f(sx*sx)+f(sy*sy))+f(sz*sz));
      if(after>0){const k=f(Math.sqrt(f(before/after)));sx=f(sx*k);sy=f(sy*k);sz=f(sz*k);}
    }
    C[o]=sx;C[o+1]=sy;C[o+2]=sz;
  }
  /** contact(): C = force (0-2), tangential force (3-5), rolling moment (6-8), new displacement (9-11), new rotation (12-14); this.load. */
  private contact(nx:number,ny:number,nz:number,vx:number,vy:number,vz:number,wx:number,wy:number,wz:number,x0:number,x1:number,x2:number,t0:number,t1:number,t2:number,delta:number,Rs:number,ms:number,alpha:number,mu:number,mur:number):void {
    const P=this.P,C=this.C,h=this.h;
    const vn=f(f(f(vx*nx)+f(vy*ny))+f(vz*nz));
    let Fe:number,cn:number,kt:number;
    if(P.hertz===1){
      const sq=f(Math.sqrt(delta)),kH=f(P.kHertz*f(Math.sqrt(Rs)));
      Fe=f(f(kH*delta)*sq);cn=f(alpha*f(Math.sqrt(f(f(ms*kH)*sq))));kt=f(f(P.kMindlin*f(Math.sqrt(Rs)))*sq);
    }else{Fe=f(P.kn*delta);cn=f(alpha*f(Math.sqrt(f(ms*P.kn))));kt=P.kt;}
    let load=f(Fe-f(cn*vn));if(!(load>0))load=0;
    const vtx=f(vx-f(vn*nx)),vty=f(vy-f(vn*ny)),vtz=f(vz-f(vn*nz));
    let fx=0,fy=0,fz=0,sx=0,sy=0,sz=0;
    if(mu>0&&load>0){
      this.turned(x0,x1,x2,nx,ny,nz,C,9);
      sx=f(C[9]+f(vtx*h));sy=f(C[10]+f(vty*h));sz=f(C[11]+f(vtz*h));
      const ct=f(f(P.tdamp*alpha)*f(Math.sqrt(f(ms*kt))));
      fx=f(f(-kt*sx)-f(ct*vtx));fy=f(f(-kt*sy)-f(ct*vty));fz=f(f(-kt*sz)-f(ct*vtz));
      const cap=f(mu*load),f2=f(f(f(fx*fx)+f(fy*fy))+f(fz*fz));
      if(f2>f(cap*cap)){const k=f(cap/f(Math.sqrt(f2)));fx=f(fx*k);fy=f(fy*k);fz=f(fz*k);sx=f(-fx/kt);sy=f(-fy/kt);sz=f(-fz/kt);}
    }
    let mx=0,my=0,mz=0,rx=0,ry=0,rz=0;
    if(mur>0&&load>0){
      const wn=f(f(f(wx*nx)+f(wy*ny))+f(wz*nz)),ax=f(wx-f(wn*nx)),ay=f(wy-f(wn*ny)),az=f(wz-f(wn*nz));
      this.turned(t0,t1,t2,nx,ny,nz,C,12);
      rx=f(C[12]+f(ax*h));ry=f(C[13]+f(ay*h));rz=f(C[14]+f(az*h));
      const kr=f(f(kt*Rs)*Rs);
      mx=f(-kr*rx);my=f(-kr*ry);mz=f(-kr*rz);
      const cap=f(f(mur*Rs)*load),m2=f(f(f(mx*mx)+f(my*my))+f(mz*mz));
      if(m2>f(cap*cap)){const k=f(cap/f(Math.sqrt(m2)));mx=f(mx*k);my=f(my*k);mz=f(mz*k);rx=f(-mx/kr);ry=f(-my/kr);rz=f(-mz/kr);}
    }
    C[0]=f(f(load*nx)+fx);C[1]=f(f(load*ny)+fy);C[2]=f(f(load*nz)+fz);C[3]=fx;C[4]=fy;C[5]=fz;C[6]=mx;C[7]=my;C[8]=mz;C[9]=sx;C[10]=sy;C[11]=sz;C[12]=rx;C[13]=ry;C[14]=rz;
    this.load=load;
  }
  private store(i:number,slot:number,key:number):void {
    const s=this.setup,H=this.hNew,C=this.C,o=4*(i*s.K+slot)*s.HS;
    H[o]=this.toBits(C[9]);H[o+1]=this.toBits(C[10]);H[o+2]=this.toBits(C[11]);H[o+3]=key;
    if(s.HS===2){H[o+4]=this.toBits(C[12]);H[o+5]=this.toBits(C[13]);H[o+6]=this.toBits(C[14]);H[o+7]=0;}
  }
  private pairs(i:number):void {
    const s=this.setup,p=this.pos,v=this.vel,w=this.spin,G=this.grid,H=this.hOld,C=this.C,P=this.P,K=s.K,HS=s.HS,M=s.M,T=s.T,o=4*i;
    let used=0,fx=0,fy=0,fz=0,tx=0,ty=0,tz=0;
    const ri=p[o+3];
    if(ri>0){
      const px=p[o],py=p[o+1],pz=p[o+2],cx=this.cellOf(px),cy=this.cellOf(py),cz=this.cellOf(pz),mi=v[o+3];
      let touching=0,deepest=0;
      for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const ax=(cx+dx)|0,ay=(cy+dy)|0,az=(cz+dz)|0,b=this.bucket(ax,ay,az),n=G[b],base=T+b*M;
        for(let q=0;q<n;q++){
          const j=G[base+q];if(j===i)continue;
          const u=4*j;
          if(this.cellOf(p[u])!==ax||this.cellOf(p[u+1])!==ay||this.cellOf(p[u+2])!==az)continue;
          const ex=f(px-p[u]),ey=f(py-p[u+1]),ez=f(pz-p[u+2]),rj=p[u+3],sum=f(ri+rj),d2=f(f(f(ex*ex)+f(ey*ey))+f(ez*ez));
          if(d2>=f(sum*sum))continue;
          const dist=f(Math.sqrt(d2)),delta=f(sum-dist),nx=f(ex/dist),ny=f(ey/dist),nz=f(ez/dist);
          const la=f(ri-f(.5*delta)),lb=f(rj-f(.5*delta));
          const sx=f(f(la*w[o])+f(lb*w[u])),sy=f(f(la*w[o+1])+f(lb*w[u+1])),sz=f(f(la*w[o+2])+f(lb*w[u+2]));
          const vx=f(f(v[o]-v[u])-f(f(sy*nz)-f(sz*ny))),vy=f(f(v[o+1]-v[u+1])-f(f(sz*nx)-f(sx*nz))),vz=f(f(v[o+2]-v[u+2])-f(f(sx*ny)-f(sy*nx)));
          const slot=this.oldSlot(i,j);let x0=0,x1=0,x2=0,t0=0,t1=0,t2=0;
          if(slot<K){const a=4*(i*K+slot)*HS;x0=this.fromBits(H[a]);x1=this.fromBits(H[a+1]);x2=this.fromBits(H[a+2]);if(HS===2){t0=this.fromBits(H[a+4]);t1=this.fromBits(H[a+5]);t2=this.fromBits(H[a+6]);}}
          const mj=v[u+3];
          this.contact(nx,ny,nz,vx,vy,vz,f(w[o]-w[u]),f(w[o+1]-w[u+1]),f(w[o+2]-w[u+2]),x0,x1,x2,t0,t1,t2,delta,f(f(ri*rj)/sum),f(f(mi*mj)/f(mi+mj)),P.alpha,P.mu,P.mur);
          if(used<K)this.store(i,used++,j);else this.pairHistoryOverflow++;
          fx=f(fx+C[0]);fy=f(fy+C[1]);fz=f(fz+C[2]);
          const c0=f(f(ny*C[5])-f(nz*C[4])),c1=f(f(nz*C[3])-f(nx*C[5])),c2=f(f(nx*C[4])-f(ny*C[3]));
          tx=f(tx+f(C[6]-f(la*c0)));ty=f(ty+f(C[7]-f(la*c1)));tz=f(tz+f(C[8]-f(la*c2)));
          touching++;const ratio=f(delta/(ri<rj?ri:rj));if(ratio>deepest)deepest=ratio;
        }
      }
      this.pairContacts+=touching;if(deepest>this.pairOverlap)this.pairOverlap=deepest;
    }
    const N=this.hNew;for(let k=used;k<K;k++)N[4*(i*K+k)*HS+3]=DEM_EMPTY;
    const F=this.ft;F[8*i]=fx;F[8*i+1]=fy;F[8*i+2]=fz;F[8*i+3]=0;F[8*i+4]=tx;F[8*i+5]=ty;F[8*i+6]=tz;F[8*i+7]=0;
  }

  /** wallDistance(): hit = distance, normal (3), nearest surface point (3). */
  private wallDistance(k:number,px:number,py:number,pz:number):void {
    const W=this.wallF,b=WS*k,r0=b+WO.r0,r1=b+WO.r1,r2=b+WO.r2,X=b+WO.x,d=b+WO.dimA,g=b+WO.dimB,shape=this.wallU[b+WO.shape],H=this.hit;
    const ex=f(px-W[X]),ey=f(py-W[X+1]),ez=f(pz-W[X+2]);
    const lx=f(f(f(W[r0]*ex)+f(W[r1]*ey))+f(W[r2]*ez)),lz=f(f(f(W[r0+2]*ex)+f(W[r1+2]*ey))+f(W[r2+2]*ez));
    let ly=f(f(f(W[r0+1]*ex)+f(W[r1+1]*ey))+f(W[r2+1]*ez));
    let nx=0,ny=0,nz=0,dist=0;
    const dot=(ax:number,ay:number,az:number,bx:number,by:number,bz:number):number=>f(f(f(ax*bx)+f(ay*by))+f(az*bz));
    if(shape===0){nx=W[d];ny=W[d+1];nz=W[d+2];dist=dot(lx,ly,lz,nx,ny,nz);}
    else if(shape===2||shape===3){
      if(shape===3){const c=ly>W[d+1]?W[d+1]:ly<-W[d+1]?-W[d+1]:ly;ly=f(ly-c);}
      const len=f(Math.sqrt(dot(lx,ly,lz,lx,ly,lz)));
      if(len>f(1e-30)){nx=f(lx/len);ny=f(ly/len);nz=f(lz/len);}else{nx=1;ny=0;nz=0;}
      dist=f(len-W[d]);
    }else if(shape===1){
      const qx=f(Math.abs(lx)-W[d]),qy=f(Math.abs(ly)-W[d+1]),qz=f(Math.abs(lz)-W[d+2]);
      if(qx<=0&&qy<=0&&qz<=0){
        if(qx>=qy&&qx>=qz){nx=lx<0?-1:1;dist=qx;}else if(qy>=qz){ny=ly<0?-1:1;dist=qy;}else{nz=lz<0?-1:1;dist=qz;}
      }else{
        const ox=qx>0?qx:0,oy=qy>0?qy:0,oz=qz>0?qz:0;dist=f(Math.sqrt(dot(ox,oy,oz,ox,oy,oz)));
        nx=f((lx<0?-ox:ox)/dist);ny=f((ly<0?-oy:oy)/dist);nz=f((lz<0?-oz:oz)/dist);
      }
    }else{
      const ax=W[d],ay=W[d+1],az=W[d+2],s=dot(lx,ly,lz,ax,ay,az);
      let rx=f(lx-f(s*ax)),ry=f(ly-f(s*ay)),rz=f(lz-f(s*az));const rho=f(Math.sqrt(dot(rx,ry,rz,rx,ry,rz)));
      if(rho>f(1e-30)){rx=f(rx/rho);ry=f(ry/rho);rz=f(rz/rho);}
      else if(Math.abs(ax)<f(0.9)){const one=f(1-f(ax*ax)),len=f(Math.sqrt(one));rx=f(one/len);ry=f(f(-ax*ay)/len);rz=f(f(-ax*az)/len);}
      else{const one=f(1-f(ay*ay)),len=f(Math.sqrt(one));rx=f(f(-ay*ax)/len);ry=f(one/len);rz=f(f(-ay*az)/len);}
      const ur=f(W[g+1]-W[d+3]),uz=f(W[g+2]-W[g]);
      let t=f(f(f(f(rho-W[d+3])*ur)+f(f(s-W[g])*uz))/f(f(ur*ur)+f(uz*uz)));t=t<0?0:t>1?1:t;
      const dr=f(rho-f(W[d+3]+f(t*ur))),ds=f(s-f(W[g]+f(t*uz)));dist=f(Math.sqrt(f(f(dr*dr)+f(ds*ds))));
      if(dist>f(1e-30)){nx=f(f(f(dr*rx)+f(ds*ax))/dist);ny=f(f(f(dr*ry)+f(ds*ay))/dist);nz=f(f(f(dr*rz)+f(ds*az))/dist);}else{nx=ax;ny=ay;nz=az;}
    }
    const wx=dot(W[r0],W[r0+1],W[r0+2],nx,ny,nz),wy=dot(W[r1],W[r1+1],W[r1+2],nx,ny,nz),wz=dot(W[r2],W[r2+1],W[r2+2],nx,ny,nz);
    H[0]=dist;H[1]=wx;H[2]=wy;H[3]=wz;H[4]=f(px-f(dist*wx));H[5]=f(py-f(dist*wy));H[6]=f(pz-f(dist*wz));
  }
  private readonly lf=new Float32Array(3*DEM_MAX_WALLS);private readonly lt=new Float32Array(3*DEM_MAX_WALLS);private readonly ll=new Float32Array(DEM_MAX_WALLS);private readonly lc=new Float32Array(DEM_MAX_WALLS);
  private wallContacts(block:number):void {
    const s=this.setup,p=this.pos,v=this.vel,w=this.spin,F=this.ft,W=this.wallF,U=this.wallU,H=this.hOld,N=this.hNew,C=this.C,hit=this.hit,K=s.K,HS=s.HS,nw=s.wallCount,g=this.g,hh=this.hh;
    const lf=this.lf,lt=this.lt,ll=this.ll,lc=this.lc;lf.fill(0);lt.fill(0);ll.fill(0);lc.fill(0);
    let overflow=0,deepest=0;
    for(let q=0;q<DEM_BLOCK;q++){
      const i=block*DEM_BLOCK+q;if(i>=s.count)break;
      const o=4*i,ri=p[o+3];if(ri<=0)continue;
      let fx=F[8*i],fy=F[8*i+1],fz=F[8*i+2],tx=F[8*i+4],ty=F[8*i+5],tz=F[8*i+6];
      let used=K;for(let k=0;k<K;k++)if(N[4*(i*K+k)*HS+3]===DEM_EMPTY){used=k;break;}
      const mi=v[o+3];
      for(let k=0;k<nw;k++){
        const b=WS*k;if(U[b+WO.enabled]===0)continue;
        this.wallDistance(k,p[o],p[o+1],p[o+2]);
        const dist=hit[0];if(dist>=ri)continue;
        const delta=f(ri-dist),la=dist,nx=hit[1],ny=hit[2],nz=hit[3];
        const ox=f(hit[4]-W[b+WO.x]),oy=f(hit[5]-W[b+WO.x+1]),oz=f(hit[6]-W[b+WO.x+2]);
        const sx=W[b+WO.w],sy=W[b+WO.w+1],sz=W[b+WO.w+2];
        const ux=f(W[b+WO.v]+f(f(sy*oz)-f(sz*oy))),uy=f(W[b+WO.v+1]+f(f(sz*ox)-f(sx*oz))),uz=f(W[b+WO.v+2]+f(f(sx*oy)-f(sy*ox)));
        const vx=f(f(v[o]-f(la*f(f(w[o+1]*nz)-f(w[o+2]*ny))))-ux),vy=f(f(v[o+1]-f(la*f(f(w[o+2]*nx)-f(w[o]*nz))))-uy),vz=f(f(v[o+2]-f(la*f(f(w[o]*ny)-f(w[o+1]*nx))))-uz);
        const key=(DEM_WALL_KEY|k)>>>0,slot=this.oldSlot(i,key);let x0=0,x1=0,x2=0,t0=0,t1=0,t2=0;
        if(slot<K){const a=4*(i*K+slot)*HS;x0=this.fromBits(H[a]);x1=this.fromBits(H[a+1]);x2=this.fromBits(H[a+2]);if(HS===2){t0=this.fromBits(H[a+4]);t1=this.fromBits(H[a+5]);t2=this.fromBits(H[a+6]);}}
        const curved=W[b+WO.v+3],mass=W[b+WO.w+3];
        const Rs=curved>0?f(f(ri*curved)/f(ri+curved)):ri,ms=U[b+WO.kind]===2?f(f(mi*mass)/f(mi+mass)):mi;
        this.contact(nx,ny,nz,vx,vy,vz,f(w[o]-sx),f(w[o+1]-sy),f(w[o+2]-sz),x0,x1,x2,t0,t1,t2,delta,Rs,ms,W[b+WO.coef],W[b+WO.coef+1],W[b+WO.coef+2]);
        if(used<K)this.store(i,used++,key);else overflow++;
        fx=f(fx+C[0]);fy=f(fy+C[1]);fz=f(fz+C[2]);
        const c0=f(f(ny*C[5])-f(nz*C[4])),c1=f(f(nz*C[3])-f(nx*C[5])),c2=f(f(nx*C[4])-f(ny*C[3]));
        tx=f(tx+f(C[6]-f(la*c0)));ty=f(ty+f(C[7]-f(la*c1)));tz=f(tz+f(C[8]-f(la*c2)));
        lf[3*k]=f(lf[3*k]-C[0]);lf[3*k+1]=f(lf[3*k+1]-C[1]);lf[3*k+2]=f(lf[3*k+2]-C[2]);
        lt[3*k]=f(lt[3*k]-f(C[6]+f(f(oy*C[2])-f(oz*C[1]))));lt[3*k+1]=f(lt[3*k+1]-f(C[7]+f(f(oz*C[0])-f(ox*C[2]))));lt[3*k+2]=f(lt[3*k+2]-f(C[8]+f(f(ox*C[1])-f(oy*C[0]))));
        ll[k]=f(ll[k]+this.load);lc[k]=lc[k]+1;
        const ratio=f(delta/ri);if(ratio>deepest)deepest=ratio;
      }
      F[8*i]=fx;F[8*i+1]=fy;F[8*i+2]=fz;F[8*i+4]=tx;F[8*i+5]=ty;F[8*i+6]=tz;
      const im=f(f(1/mi)*hh),ii=f(w[o+3]*hh);
      v[o]=f(v[o]+f(f(fx*im)+f(g[0]*hh)));v[o+1]=f(v[o+1]+f(f(fy*im)+f(g[1]*hh)));v[o+2]=f(v[o+2]+f(f(fz*im)+f(g[2]*hh)));
      w[o]=f(w[o]+f(tx*ii));w[o+1]=f(w[o+1]+f(ty*ii));w[o+2]=f(w[o+2]+f(tz*ii));
    }
    const S=this.sums,base=4*block*(2*nw+1);
    for(let k=0;k<nw;k++){S[base+8*k]=lf[3*k];S[base+8*k+1]=lf[3*k+1];S[base+8*k+2]=lf[3*k+2];S[base+8*k+3]=ll[k];S[base+8*k+4]=lt[3*k];S[base+8*k+5]=lt[3*k+1];S[base+8*k+6]=lt[3*k+2];S[base+8*k+7]=lc[k];}
    S[base+8*nw]=overflow;S[base+8*nw+1]=deepest;S[base+8*nw+2]=0;S[base+8*nw+3]=0;
  }
  private kick(k:number):void {
    const W=this.wallF,b=WS*k,hh=this.hh,Fo=b+WO.force,To=b+WO.torque,I=b+WO.impulse,L=b+WO.angularImpulse;
    for(let a=0;a<3;a++){W[I+a]=f(W[I+a]+f(hh*W[Fo+a]));W[L+a]=f(W[L+a]+f(hh*W[To+a]));}
    W[I+3]=0;W[L+3]=0;
    if(this.wallU[b+WO.kind]!==2)return;
    const im=f(W[b+WO.inv+3]*hh),s=f(W[b+WO.coef+3]*hh),g=this.g,V=b+WO.v,E=b+WO.extF,ET=b+WO.extT;
    const tx=f(W[To]+W[ET]),ty=f(W[To+1]+W[ET+1]),tz=f(W[To+2]+W[ET+2]);
    const nv0=f(W[V]+f(f(f(W[Fo]+W[E])*im)+f(g[0]*s))),nv1=f(W[V+1]+f(f(f(W[Fo+1]+W[E+1])*im)+f(g[1]*s))),nv2=f(W[V+2]+f(f(f(W[Fo+2]+W[E+2])*im)+f(g[2]*s)));
    const r0=b+WO.r0,r1=b+WO.r1,r2=b+WO.r2,J=b+WO.inv,Wv=b+WO.w;
    const lx=f(f(f(f(W[r0]*tx)+f(W[r1]*ty))+f(W[r2]*tz))*W[J]),ly=f(f(f(f(W[r0+1]*tx)+f(W[r1+1]*ty))+f(W[r2+1]*tz))*W[J+1]),lz=f(f(f(f(W[r0+2]*tx)+f(W[r1+2]*ty))+f(W[r2+2]*tz))*W[J+2]);
    const d0=f(f(f(W[r0]*lx)+f(W[r0+1]*ly))+f(W[r0+2]*lz)),d1=f(f(f(W[r1]*lx)+f(W[r1+1]*ly))+f(W[r1+2]*lz)),d2=f(f(f(W[r2]*lx)+f(W[r2+1]*ly))+f(W[r2+2]*lz));
    const nw0=f(W[Wv]+f(hh*d0)),nw1=f(W[Wv+1]+f(hh*d1)),nw2=f(W[Wv+2]+f(hh*d2));
    W[V]=nv0;W[V+1]=nv1;W[V+2]=nv2;W[Wv]=nw0;W[Wv+1]=nw1;W[Wv+2]=nw2;
  }
  private wallOpen(k:number):void {
    const W=this.wallF,b=WS*k,h=this.h;
    this.kick(k);
    if(this.wallU[b+WO.kind]===0)return;
    const X=b+WO.x,V=b+WO.v,Wv=b+WO.w,Q=b+WO.q;
    W[X]=f(W[X]+f(h*W[V]));W[X+1]=f(W[X+1]+f(h*W[V+1]));W[X+2]=f(W[X+2]+f(h*W[V+2]));W[X+3]=0;
    const wx=W[Wv],wy=W[Wv+1],wz=W[Wv+2];
    if(wx===0&&wy===0&&wz===0)return;
    const x=W[Q],y=W[Q+1],z=W[Q+2],s=W[Q+3],c=f(.5*h);
    let n0=f(x+f(c*f(f(f(wx*s)+f(wy*z))-f(wz*y)))),n1=f(y+f(c*f(f(f(wy*s)+f(wz*x))-f(wx*z)))),n2=f(z+f(c*f(f(f(wz*s)+f(wx*y))-f(wy*x)))),n3=f(s-f(c*f(f(f(wx*x)+f(wy*y))+f(wz*z))));
    const len=f(Math.sqrt(f(f(f(f(n0*n0)+f(n1*n1))+f(n2*n2))+f(n3*n3))));
    n0=f(n0/len);n1=f(n1/len);n2=f(n2/len);n3=f(n3/len);
    W[Q]=n0;W[Q+1]=n1;W[Q+2]=n2;W[Q+3]=n3;
    const r0=b+WO.r0,r1=b+WO.r1,r2=b+WO.r2;
    W[r0]=f(1-f(2*f(f(n1*n1)+f(n2*n2))));W[r0+1]=f(2*f(f(n0*n1)-f(n2*n3)));W[r0+2]=f(2*f(f(n0*n2)+f(n1*n3)));W[r0+3]=0;
    W[r1]=f(2*f(f(n0*n1)+f(n2*n3)));W[r1+1]=f(1-f(2*f(f(n0*n0)+f(n2*n2))));W[r1+2]=f(2*f(f(n1*n2)-f(n0*n3)));W[r1+3]=0;
    W[r2]=f(2*f(f(n0*n2)-f(n1*n3)));W[r2+1]=f(2*f(f(n1*n2)+f(n0*n3)));W[r2+2]=f(1-f(2*f(f(n0*n0)+f(n1*n1))));W[r2+3]=0;
  }
  private wallClose(k:number,blocks:number):void {
    const s=this.setup,W=this.wallF,S=this.sums,nw=s.wallCount,stride=4*(2*nw+1),b=WS*k;
    if(k===nw){
      let overflow=0,deepest=0,contacts=0;
      for(let q=0;q<blocks;q++){
        const a=q*stride+8*nw;overflow=f(overflow+S[a]);if(S[a+1]>deepest)deepest=S[a+1];
        for(let j=0;j<nw;j++)contacts=f(contacts+S[q*stride+8*j+7]);
      }
      const Fo=b+WO.force;W[Fo]=f(W[Fo]+overflow);W[Fo+1]=deepest;W[Fo+2]=contacts;W[Fo+3]=0;
      return;
    }
    let fx=0,fy=0,fz=0,tx=0,ty=0,tz=0,load=0,count=0;
    for(let q=0;q<blocks;q++){
      const a=q*stride+8*k;
      fx=f(fx+S[a]);fy=f(fy+S[a+1]);fz=f(fz+S[a+2]);load=f(load+S[a+3]);tx=f(tx+S[a+4]);ty=f(ty+S[a+5]);tz=f(tz+S[a+6]);count=f(count+S[a+7]);
    }
    const Fo=b+WO.force,To=b+WO.torque;
    W[Fo]=fx;W[Fo+1]=fy;W[Fo+2]=fz;W[Fo+3]=load;W[To]=tx;W[To+1]=ty;W[To+2]=tz;W[To+3]=count;
    this.kick(k);
  }
}

/** The state of wall k in a DEM_WALL buffer, as float64 numbers. */
export function readDemWall(walls:ArrayBuffer|Float32Array,k:number):{position:number[];rotation:number[];linearVelocity:number[];angularVelocity:number[];force:number[];torque:number[];impulse:number[];angularImpulse:number[];normalLoad:number;contacts:number} {
  const W=walls instanceof Float32Array?walls:new Float32Array(walls),b=WS*k,three=(o:number):number[]=>[W[b+o],W[b+o+1],W[b+o+2]];
  return {position:three(WO.x),rotation:[W[b+WO.q],W[b+WO.q+1],W[b+WO.q+2],W[b+WO.q+3]],linearVelocity:three(WO.v),angularVelocity:three(WO.w),force:three(WO.force),torque:three(WO.torque),impulse:three(WO.impulse),angularImpulse:three(WO.angularImpulse),
    normalLoad:W[b+WO.force+3],contacts:W[b+WO.torque+3]};
}
