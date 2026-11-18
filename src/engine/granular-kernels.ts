/**
 * The contact forces of the discrete element solver (granular.ts), as a function of a range of grains over plain typed
 * arrays, so that the same code runs on the solver's thread and on helper threads over shared memory
 * (granular-parallel.ts).
 *
 * `demContacts(ctx, i0, i1)` evaluates every candidate pair (i, j > i) and every wall candidate of the grains i in
 * [i0, i1): it advances the contact histories exactly as the serial loop did and writes, per pair and per wall
 * candidate, what that contact adds to the forces, torques, wall loads and energy ledgers. Nothing is summed here:
 * `granular.ts` adds the contributions in the order of the original single loop (pairs by index, then walls), so the
 * sums, and with them every result, are the same to the bit whatever the ranges and however many threads run them.
 * The arithmetic of each contact is the original kernel's, operation for operation.
 */

/** Numbers kept per contact history (see granular.ts). */
export const HN=13;
export const PLANE=0,BOX=1,SPHERE=2,CAPSULE=3,REVOLVED=4;
export const STATIC=0,KINEMATIC=1,DYNAMIC=2;
/** Per wall in the wall table: shape, type, rotation (9), position (3), velocity (3), spin (3), dimensions (7), curved radius, mass, damping alpha, friction, rolling friction, and the radius of a sphere about the position that holds the surface (0 for a plane). */
export const WALL_STRIDE=33;
export const W_SHAPE=0,W_TYPE=1,W_R=2,W_X=11,W_V=14,W_W=17,W_DIM=20,W_CURVED=27,W_MASS=28,W_ALPHA=29,W_MU=30,W_MUR=31,W_REACH=32;
/** Per pair out: force on i (3), torque added to i (3), torque taken from j (3), then the ledger terms. */
export const PAIR_OUT=16;
/** Per wall candidate out: force on the grain (3), torque on the grain (3), moment taken from the wall (3), F_n, the power exchanged with a moving wall, then the ledger terms. */
export const WALL_OUT=18;
/** Ledger terms, at this offset in a pair out (9) and a wall out (11): normal elastic energy, damping power, tangential elastic energy and power, rolling elastic energy and power, overlap ratio. */
export const L_EN=0,L_PD=1,L_ET1=2,L_PT1=3,L_ET2=4,L_PT2=5,L_RATIO=6;
/** Parameters: step, law (1 hertz), k_Hertz, k_Mindlin, k_n, k_t, alpha, tangential damping, mu, mu_r, the bound of grain motion since the last evaluation, the wall count, kick (1: apply the closing half kick), gravity (3). */
export const P_H=0,P_HERTZ=1,P_KHERTZ=2,P_KMINDLIN=3,P_KN=4,P_KT=5,P_ALPHA=6,P_TDAMP=7,P_MU=8,P_MUR=9,P_MOVE=10,P_WALLS=11,P_KICK=12,P_GX=13,P_GY=14,P_GZ=15,P_COUNT=16;

export interface DemContext {
  x:Float64Array;v:Float64Array;w:Float64Array;r:Float64Array;m:Float64Array;
  pairStart:Int32Array;pairJ:Int32Array;pairH:Float64Array;pairOn:Uint8Array;pairOut:Float64Array;
  wallStart:Int32Array;wallW:Int32Array;wallH:Float64Array;wallOn:Uint8Array;wallSlack:Float64Array;wallOut:Float64Array;
  /** WALL_STRIDE numbers per wall, and per wall the bound of how far its surface moved since the last evaluation. */
  walls:Float64Array;moves:Float64Array;
  params:Float64Array;
  /** For the gather: forces and torques out, the pairs where each grain is the second grain, and what the kick needs. */
  f:Float64Array;t:Float64Array;revStart:Int32Array;revK:Int32Array;alive:Uint8Array;invMass:Float64Array;invInertia:Float64Array;
}
/** The arrays of a DemContext a helper thread needs, with their element types (for sharing them). */
export const DEM_ARRAYS={x:'f64',v:'f64',w:'f64',r:'f64',m:'f64',pairStart:'i32',pairJ:'i32',pairH:'f64',pairOn:'u8',pairOut:'f64',wallStart:'i32',wallW:'i32',wallH:'f64',wallOn:'u8',wallSlack:'f64',wallOut:'f64',
  walls:'f64',moves:'f64',params:'f64',f:'f64',t:'f64',revStart:'i32',revK:'i32',alive:'u8',invMass:'f64',invInertia:'f64'} as const;
export type DemArrayName=keyof typeof DEM_ARRAYS;

/**
 * One contact (the original `Granular.kernel`). In S: the normal from the other body to grain i (0-2), the velocity of
 * i's contact point relative to the other's (3-5), the relative spin (6-8). Out in S: the force on i (9-11), its
 * tangential part (12-14) and the rolling moment on i (15-17). Ledger terms into out[lo + L_*]. Returns F_n.
 */
function contact(S:Float64Array,P:Float64Array,H:Float64Array,o:number,delta:number,Rs:number,ms:number,alpha:number,mu:number,mur:number,h:number,out:Float64Array,lo:number):number {
  const nx=S[0],ny=S[1],nz=S[2];
  const vn=S[3]*nx+S[4]*ny+S[5]*nz;
  let Fe:number,cn:number,kt:number;
  if(P[P_HERTZ]===1){
    const sq=Math.sqrt(delta),kH=P[P_KHERTZ]*Math.sqrt(Rs);
    Fe=kH*delta*sq;out[lo+L_EN]=.4*Fe*delta;cn=alpha*Math.sqrt(ms*kH*sq);kt=P[P_KMINDLIN]*Math.sqrt(Rs)*sq;
  }else{const kn=P[P_KN];Fe=kn*delta;out[lo+L_EN]=.5*Fe*delta;cn=alpha*Math.sqrt(ms*kn);kt=P[P_KT];}
  let Fn=Fe-cn*vn;if(Fn<0)Fn=0;
  // Work is booked with the mean of this step's and the last step's force, as velocity Verlet does it.
  const Fd=Fn-Fe;out[lo+L_PD]=.5*(Fd+H[o+6])*vn;H[o+6]=Fd;
  const vtx=S[3]-vn*nx,vty=S[4]-vn*ny,vtz=S[5]-vn*nz;
  let ftx=0,fty=0,ftz=0;
  out[lo+L_ET1]=0;out[lo+L_ET2]=0;out[lo+L_PT2]=0;
  if(mu>0&&Fn>0){
    // Turn the stored displacement into the tangent plane, keeping its length, then add this step's slip.
    let sx=H[o],sy=H[o+1],sz=H[o+2];
    const dot=sx*nx+sy*ny+sz*nz;
    if(dot!==0){
      const before=sx*sx+sy*sy+sz*sz;sx-=dot*nx;sy-=dot*ny;sz-=dot*nz;
      const after=sx*sx+sy*sy+sz*sz;
      if(after>0){const s=Math.sqrt(before/after);sx*=s;sy*=s;sz*=s;}
    }
    sx+=vtx*h;sy+=vty*h;sz+=vtz*h;
    const ct=P[P_TDAMP]*alpha*Math.sqrt(ms*kt);
    ftx=-kt*sx-ct*vtx;fty=-kt*sy-ct*vty;ftz=-kt*sz-ct*vtz;
    const cap=mu*Fn,f2=ftx*ftx+fty*fty+ftz*ftz;
    if(f2>cap*cap){const s=cap/Math.sqrt(f2);ftx*=s;fty*=s;ftz*=s;sx=-ftx/kt;sy=-fty/kt;sz=-ftz/kt;}
    H[o]=sx;H[o+1]=sy;H[o+2]=sz;
    out[lo+L_ET1]=.5*kt*(sx*sx+sy*sy+sz*sz);
  }else{H[o]=0;H[o+1]=0;H[o+2]=0;}
  out[lo+L_PT1]=.5*((ftx+H[o+7])*vtx+(fty+H[o+8])*vty+(ftz+H[o+9])*vtz);H[o+7]=ftx;H[o+8]=fty;H[o+9]=ftz;
  let mx=0,my=0,mz=0;
  if(mur>0&&Fn>0){
    const wn=S[6]*nx+S[7]*ny+S[8]*nz,wx=S[6]-wn*nx,wy=S[7]-wn*ny,wz=S[8]-wn*nz;
    let sx=H[o+3],sy=H[o+4],sz=H[o+5];
    const dot=sx*nx+sy*ny+sz*nz;
    if(dot!==0){
      const before=sx*sx+sy*sy+sz*sz;sx-=dot*nx;sy-=dot*ny;sz-=dot*nz;
      const after=sx*sx+sy*sy+sz*sz;
      if(after>0){const s=Math.sqrt(before/after);sx*=s;sy*=s;sz*=s;}
    }
    sx+=wx*h;sy+=wy*h;sz+=wz*h;
    const kr=kt*Rs*Rs;
    mx=-kr*sx;my=-kr*sy;mz=-kr*sz;
    const cap=mur*Rs*Fn,m2=mx*mx+my*my+mz*mz;
    if(m2>cap*cap){const s=cap/Math.sqrt(m2);mx*=s;my*=s;mz*=s;sx=-mx/kr;sy=-my/kr;sz=-mz/kr;}
    H[o+3]=sx;H[o+4]=sy;H[o+5]=sz;
    out[lo+L_ET2]=.5*kr*(sx*sx+sy*sy+sz*sz);
    out[lo+L_PT2]=.5*((mx+H[o+10])*wx+(my+H[o+11])*wy+(mz+H[o+12])*wz);H[o+10]=mx;H[o+11]=my;H[o+12]=mz;
  }else{H[o+3]=0;H[o+4]=0;H[o+5]=0;H[o+10]=0;H[o+11]=0;H[o+12]=0;}
  S[9]=Fn*nx+ftx;S[10]=Fn*ny+fty;S[11]=Fn*nz+ftz;S[12]=ftx;S[13]=fty;S[14]=ftz;S[15]=mx;S[16]=my;S[17]=mz;
  return Fn;
}

/**
 * Distance from a point to a wall's surface (negative inside a solid), the original `Granular.wallDistance` on the
 * wall table; leaves the outward normal in G[0..2] and the nearest surface point in G[3..5].
 */
export function demWallDistance(T:Float64Array,b:number,px:number,py:number,pz:number,G:Float64Array):number {
  const R=W_R+b,o=W_X+b,d=W_DIM+b;
  const ex=px-T[o],ey=py-T[o+1],ez=pz-T[o+2];
  let lx=T[R]*ex+T[R+3]*ey+T[R+6]*ez,ly=T[R+1]*ex+T[R+4]*ey+T[R+7]*ez,lz=T[R+2]*ex+T[R+5]*ey+T[R+8]*ez;
  let nx:number,ny:number,nz:number,dist:number;
  const shape=T[b+W_SHAPE];
  if(shape===PLANE){nx=T[d];ny=T[d+1];nz=T[d+2];dist=lx*nx+ly*ny+lz*nz;}
  else if(shape===SPHERE||shape===CAPSULE){
    let cy=0;
    if(shape===CAPSULE){cy=ly>T[d+1]?T[d+1]:ly<-T[d+1]?-T[d+1]:ly;ly-=cy;}
    const l=Math.sqrt(lx*lx+ly*ly+lz*lz);
    if(l>1e-300){nx=lx/l;ny=ly/l;nz=lz/l;}else{nx=1;ny=0;nz=0;}
    dist=l-T[d];
  }else if(shape===BOX){
    const qx=Math.abs(lx)-T[d],qy=Math.abs(ly)-T[d+1],qz=Math.abs(lz)-T[d+2];
    if(qx<=0&&qy<=0&&qz<=0){
      nx=ny=nz=0;
      if(qx>=qy&&qx>=qz){nx=lx<0?-1:1;dist=qx;}
      else if(qy>=qz){ny=ly<0?-1:1;dist=qy;}
      else{nz=lz<0?-1:1;dist=qz;}
    }else{
      const ox=qx>0?qx:0,oy=qy>0?qy:0,oz=qz>0?qz:0;dist=Math.sqrt(ox*ox+oy*oy+oz*oz);
      nx=(lx<0?-ox:ox)/dist;ny=(ly<0?-oy:oy)/dist;nz=(lz<0?-oz:oz)/dist;
    }
  }else{
    // Shell of revolution: nearest point of the generating line in the meridian half plane of the grain.
    const ax=T[d],ay=T[d+1],az=T[d+2],s=lx*ax+ly*ay+lz*az;
    let rx=lx-s*ax,ry=ly-s*ay,rz=lz-s*az;const rho=Math.sqrt(rx*rx+ry*ry+rz*rz);
    if(rho>1e-300){rx/=rho;ry/=rho;rz/=rho;}
    else if(Math.abs(ax)<.9){const l=Math.sqrt(1-ax*ax);rx=(1-ax*ax)/l;ry=-ax*ay/l;rz=-ax*az/l;}
    else{const l=Math.sqrt(1-ay*ay);rx=-ay*ax/l;ry=(1-ay*ay)/l;rz=-ay*az/l;}
    const ur=T[d+5]-T[d+3],uz=T[d+6]-T[d+4];
    let t=((rho-T[d+3])*ur+(s-T[d+4])*uz)/(ur*ur+uz*uz);t=t<0?0:t>1?1:t;
    const dr=rho-(T[d+3]+t*ur),ds=s-(T[d+4]+t*uz);dist=Math.sqrt(dr*dr+ds*ds);
    if(dist>1e-300){nx=(dr*rx+ds*ax)/dist;ny=(dr*ry+ds*ay)/dist;nz=(dr*rz+ds*az)/dist;}
    else{nx=ax;ny=ay;nz=az;}
  }
  const wx=T[R]*nx+T[R+1]*ny+T[R+2]*nz,wy=T[R+3]*nx+T[R+4]*ny+T[R+5]*nz,wz=T[R+6]*nx+T[R+7]*ny+T[R+8]*nz;
  G[0]=wx;G[1]=wy;G[2]=wz;G[3]=px-dist*wx;G[4]=py-dist*wy;G[5]=pz-dist*wz;
  return dist;
}

/** Scratch of one thread: the contact's in and out (18) and a wall distance's normal and point (6). */
export interface DemScratch {readonly S:Float64Array;readonly G:Float64Array}
export const demScratch=():DemScratch=>({S:new Float64Array(18),G:new Float64Array(6)});

/** Evaluate the pairs and wall candidates of grains [i0, i1). Writes pairOn / wallOn (1: touching now) and the outs. */
export function demContacts(c:DemContext,i0:number,i1:number,scratch:DemScratch):void {
  const x=c.x,v=c.v,w=c.w,r=c.r,m=c.m,P=c.params,S=scratch.S,G=scratch.G,h=P[P_H],alpha=P[P_ALPHA],mu=P[P_MU],mur=P[P_MUR];
  const pairStart=c.pairStart,pairJ=c.pairJ,pairH=c.pairH,pairOn=c.pairOn,PO=c.pairOut;
  for(let i=i0;i<i1;i++){
    const s=pairStart[i],e=pairStart[i+1];if(s===e)continue;
    const a=3*i,px=x[a],py=x[a+1],pz=x[a+2],ri=r[i];
    for(let k=s;k<e;k++){
      const j=pairJ[k],b=3*j,dx=px-x[b],dy=py-x[b+1],dz=pz-x[b+2],sum=ri+r[j],d2=dx*dx+dy*dy+dz*dz;
      if(d2>=sum*sum){if(pairOn[k]){pairOn[k]=0;pairH.fill(0,HN*k,HN*k+HN);}continue;}
      const dist=Math.sqrt(d2),delta=sum-dist,nx=dx/dist,ny=dy/dist,nz=dz/dist,rj=r[j];
      // Lever arms to the middle of the overlap.
      const la=ri-.5*delta,lb=rj-.5*delta;
      const sx=la*w[a]+lb*w[b],sy=la*w[a+1]+lb*w[b+1],sz=la*w[a+2]+lb*w[b+2];
      S[0]=nx;S[1]=ny;S[2]=nz;
      S[3]=v[a]-v[b]-(sy*nz-sz*ny);S[4]=v[a+1]-v[b+1]-(sz*nx-sx*nz);S[5]=v[a+2]-v[b+2]-(sx*ny-sy*nx);
      S[6]=w[a]-w[b];S[7]=w[a+1]-w[b+1];S[8]=w[a+2]-w[b+2];
      const mi=m[i],mj=m[j],o=PAIR_OUT*k;
      contact(S,P,pairH,HN*k,delta,ri*rj/sum,mi*mj/(mi+mj),alpha,mu,mur,h,PO,o+9);
      pairOn[k]=1;
      PO[o+9+L_RATIO]=delta/(ri<rj?ri:rj);
      const cx=ny*S[14]-nz*S[13],cy=nz*S[12]-nx*S[14],cz=nx*S[13]-ny*S[12];
      PO[o]=S[9];PO[o+1]=S[10];PO[o+2]=S[11];
      PO[o+3]=S[15]-la*cx;PO[o+4]=S[16]-la*cy;PO[o+5]=S[17]-la*cz;
      PO[o+6]=S[15]+lb*cx;PO[o+7]=S[16]+lb*cy;PO[o+8]=S[17]+lb*cz;
    }
  }
  const wallStart=c.wallStart,wallW=c.wallW,wallH=c.wallH,wallOn=c.wallOn,slack=c.wallSlack,WO=c.wallOut,T=c.walls,moves=c.moves,grainMove=P[P_MOVE];
  for(let i=i0;i<i1;i++){
    const s=wallStart[i],e=wallStart[i+1];if(s===e)continue;
    const a=3*i,px=x[a],py=x[a+1],pz=x[a+2],ri=r[i],mi=m[i];
    for(let k=s;k<e;k++){
      const wk=wallW[k],left=slack[k]-grainMove-moves[wk];
      // Still out of reach: what a measurement would give (dist >= ri, no contact, wallOn[k] already 0).
      if(left>0){slack[k]=left;continue;}
      const b=WALL_STRIDE*wk,dist=demWallDistance(T,b,px,py,pz,G),ox0=T[b+W_X],oy0=T[b+W_X+1],oz0=T[b+W_X+2];
      if(dist>=ri){
        if(wallOn[k]){wallOn[k]=0;wallH.fill(0,HN*k,HN*k+HN);}
        // Room for the rounding of two measurements of dist: far below a micrometre at the scale of the coordinates.
        slack[k]=dist-ri-1e-12*(Math.abs(px)+Math.abs(py)+Math.abs(pz)+Math.abs(ox0)+Math.abs(oy0)+Math.abs(oz0)+T[b+W_REACH]+ri+Math.abs(dist));
        continue;
      }
      slack[k]=-Infinity;
      const delta=ri-dist,nx=G[0],ny=G[1],nz=G[2],la=dist;
      // Velocity of the wall at the contact point.
      const ox=G[3]-ox0,oy=G[4]-oy0,oz=G[5]-oz0,V=b+W_V,Wv=b+W_W,wx0=T[Wv],wy0=T[Wv+1],wz0=T[Wv+2];
      const ux=T[V]+wy0*oz-wz0*oy,uy=T[V+1]+wz0*ox-wx0*oz,uz=T[V+2]+wx0*oy-wy0*ox;
      S[0]=nx;S[1]=ny;S[2]=nz;
      S[3]=v[a]-la*(w[a+1]*nz-w[a+2]*ny)-ux;S[4]=v[a+1]-la*(w[a+2]*nx-w[a]*nz)-uy;S[5]=v[a+2]-la*(w[a]*ny-w[a+1]*nx)-uz;
      S[6]=w[a]-wx0;S[7]=w[a+1]-wy0;S[8]=w[a+2]-wz0;
      const curved=T[b+W_CURVED],mass=T[b+W_MASS],o=WALL_OUT*k;
      const Fn=contact(S,P,wallH,HN*k,delta,curved>0?ri*curved/(ri+curved):ri,T[b+W_TYPE]===DYNAMIC?mi*mass/(mi+mass):mi,T[b+W_ALPHA],T[b+W_MU],T[b+W_MUR],h,WO,o+11);
      wallOn[k]=1;
      WO[o+11+L_RATIO]=delta/ri;
      const cx=ny*S[14]-nz*S[13],cy=nz*S[12]-nx*S[14],cz=nx*S[13]-ny*S[12];
      WO[o]=S[9];WO[o+1]=S[10];WO[o+2]=S[11];
      WO[o+3]=S[15]-la*cx;WO[o+4]=S[16]-la*cy;WO[o+5]=S[17]-la*cz;
      WO[o+6]=S[15]+oy*S[11]-oz*S[10];WO[o+7]=S[16]+oz*S[9]-ox*S[11];WO[o+8]=S[17]+ox*S[10]-oy*S[9];
      WO[o+9]=Fn;
      WO[o+10]=S[9]*ux+S[10]*uy+S[11]*uz+S[15]*wx0+S[16]*wy0+S[17]*wz0;
    }
  }
}

/**
 * Force and torque on grains [q0, q1): as the second grain of earlier pairs (list order), then its own pairs, then its
 * walls; with params[P_KICK] = 1, the closing half kick of velocity Verlet too: v += (h / 2) (f / m + g), w += (h / 2) t / I.
 * The order is the one of a single loop over the pairs and then the walls, so every component is the same sum.
 */
export function demGather(c:DemContext,q0:number,q1:number):void {
  const PO=c.pairOut,WO=c.wallOut,pairStart=c.pairStart,pairOn=c.pairOn,revStart=c.revStart,revK=c.revK,wallStart=c.wallStart,wallOn=c.wallOn,f=c.f,t=c.t;
  const P=c.params,kick=P[P_KICK]===1,hh=.5*P[P_H],gx=P[P_GX],gy=P[P_GY],gz=P[P_GZ],v=c.v,w=c.w,alive=c.alive,invMass=c.invMass,invInertia=c.invInertia;
  for(let q=q0;q<q1;q++){
    let fx=0,fy=0,fz=0,tx=0,ty=0,tz=0;
    for(let p=revStart[q],e=revStart[q+1];p<e;p++){
      const k=revK[p];if(!pairOn[k])continue;
      const o=PAIR_OUT*k;
      fx-=PO[o];fy-=PO[o+1];fz-=PO[o+2];tx-=PO[o+6];ty-=PO[o+7];tz-=PO[o+8];
    }
    for(let k=pairStart[q],e=pairStart[q+1];k<e;k++){
      if(!pairOn[k])continue;
      const o=PAIR_OUT*k;
      fx+=PO[o];fy+=PO[o+1];fz+=PO[o+2];tx+=PO[o+3];ty+=PO[o+4];tz+=PO[o+5];
    }
    for(let k=wallStart[q],e=wallStart[q+1];k<e;k++){
      if(!wallOn[k])continue;
      const o=WALL_OUT*k;
      fx+=WO[o];fy+=WO[o+1];fz+=WO[o+2];tx+=WO[o+3];ty+=WO[o+4];tz+=WO[o+5];
    }
    const a=3*q;f[a]=fx;f[a+1]=fy;f[a+2]=fz;t[a]=tx;t[a+1]=ty;t[a+2]=tz;
    if(kick&&alive[q]){
      const im=invMass[q]*hh,ii=invInertia[q]*hh;
      v[a]+=fx*im+gx*hh;v[a+1]+=fy*im+gy*hh;v[a+2]+=fz*im+gz*hh;
      w[a]+=tx*ii;w[a+1]+=ty*ii;w[a+2]+=tz*ii;
    }
  }
}

/** Something that runs a kernel over ranges of grains on several threads and returns when all are done (granular-parallel.ts). */
export interface DemExecutor {
  readonly threads:number;
  /** A shared-memory copy of an array (what the helper threads can see). */
  share<T extends Float64Array|Int32Array|Uint8Array>(array:T):T;
  /** demContacts then demGather over grains [0, n), split between the threads; blocking. The context's arrays must be shared. */
  run(task:'contacts'|'gather',context:DemContext,n:number):void;
  dispose():void;
}

/** Sums of a serial evaluation: ledger (normal and tangential elastic energy, damping and tangential power), counts, largest overlap ratio, power exchanged with moving walls; then per wall force (3), moment (3), normal load and contacts. */
export const SUM_EN=0,SUM_ET=1,SUM_PD=2,SUM_PT=3,SUM_CONTACTS=4,SUM_WALL_CONTACTS=5,SUM_OVERLAP=6,SUM_EXCHANGE=7,SUM_WALLS=8,WALL_SUM=8;

/**
 * The single loop of the original solver, on one thread: every pair (grain by grain, list order), then every wall
 * candidate, adding each contact's force, torque and ledger terms as it goes (into c.f, c.t, which start at zero, and
 * `sums`). The same arithmetic in the same order as demContacts + demGather + the ordered sums, without the per-contact
 * slots: cheaper when there is only one thread.
 */
export function demSerial(c:DemContext,n:number,scratch:DemScratch,sums:Float64Array,terms:Float64Array):void {
  const x=c.x,v=c.v,w=c.w,r=c.r,m=c.m,P=c.params,S=scratch.S,G=scratch.G,h=P[P_H],alpha=P[P_ALPHA],mu=P[P_MU],mur=P[P_MUR],f=c.f,t=c.t;
  const pairStart=c.pairStart,pairJ=c.pairJ,pairH=c.pairH,pairOn=c.pairOn;
  f.fill(0,0,3*n);t.fill(0,0,3*n);
  let eNormal=0,eTangent=0,pDamp=0,pTangent=0,contacts=0,wallContacts=0,overlap=0,exchange=0;
  for(let i=0;i<n;i++){
    const s=pairStart[i],e=pairStart[i+1];if(s===e)continue;
    const a=3*i,px=x[a],py=x[a+1],pz=x[a+2],ri=r[i];
    for(let k=s;k<e;k++){
      const j=pairJ[k],b=3*j,dx=px-x[b],dy=py-x[b+1],dz=pz-x[b+2],sum=ri+r[j],d2=dx*dx+dy*dy+dz*dz;
      if(d2>=sum*sum){if(pairOn[k]){pairOn[k]=0;pairH.fill(0,HN*k,HN*k+HN);}continue;}
      const dist=Math.sqrt(d2),delta=sum-dist,nx=dx/dist,ny=dy/dist,nz=dz/dist,rj=r[j];
      const la=ri-.5*delta,lb=rj-.5*delta;
      const sx=la*w[a]+lb*w[b],sy=la*w[a+1]+lb*w[b+1],sz=la*w[a+2]+lb*w[b+2];
      S[0]=nx;S[1]=ny;S[2]=nz;
      S[3]=v[a]-v[b]-(sy*nz-sz*ny);S[4]=v[a+1]-v[b+1]-(sz*nx-sx*nz);S[5]=v[a+2]-v[b+2]-(sx*ny-sy*nx);
      S[6]=w[a]-w[b];S[7]=w[a+1]-w[b+1];S[8]=w[a+2]-w[b+2];
      const mi=m[i],mj=m[j];
      contact(S,P,pairH,HN*k,delta,ri*rj/sum,mi*mj/(mi+mj),alpha,mu,mur,h,terms,0);
      eNormal+=terms[L_EN];pDamp-=terms[L_PD];eTangent+=terms[L_ET1];pTangent+=terms[L_PT1];eTangent+=terms[L_ET2];pTangent+=terms[L_PT2];
      pairOn[k]=1;contacts++;
      const ratio=delta/(ri<rj?ri:rj);if(ratio>overlap)overlap=ratio;
      f[a]+=S[9];f[a+1]+=S[10];f[a+2]+=S[11];f[b]-=S[9];f[b+1]-=S[10];f[b+2]-=S[11];
      const cx=ny*S[14]-nz*S[13],cy=nz*S[12]-nx*S[14],cz=nx*S[13]-ny*S[12];
      t[a]+=S[15]-la*cx;t[a+1]+=S[16]-la*cy;t[a+2]+=S[17]-la*cz;
      t[b]-=S[15]+lb*cx;t[b+1]-=S[16]+lb*cy;t[b+2]-=S[17]+lb*cz;
    }
  }
  const wallStart=c.wallStart,wallW=c.wallW,wallH=c.wallH,wallOn=c.wallOn,slack=c.wallSlack,T=c.walls,moves=c.moves,grainMove=P[P_MOVE],nw=P[P_WALLS];
  sums.fill(0,0,SUM_WALLS+WALL_SUM*nw);
  for(let i=0;i<n;i++){
    const s=wallStart[i],e=wallStart[i+1];if(s===e)continue;
    const a=3*i,px=x[a],py=x[a+1],pz=x[a+2],ri=r[i],mi=m[i];
    for(let k=s;k<e;k++){
      const wk=wallW[k],left=slack[k]-grainMove-moves[wk];
      if(left>0){slack[k]=left;continue;}
      const b=WALL_STRIDE*wk,dist=demWallDistance(T,b,px,py,pz,G),ox0=T[b+W_X],oy0=T[b+W_X+1],oz0=T[b+W_X+2];
      if(dist>=ri){
        if(wallOn[k]){wallOn[k]=0;wallH.fill(0,HN*k,HN*k+HN);}
        slack[k]=dist-ri-1e-12*(Math.abs(px)+Math.abs(py)+Math.abs(pz)+Math.abs(ox0)+Math.abs(oy0)+Math.abs(oz0)+T[b+W_REACH]+ri+Math.abs(dist));
        continue;
      }
      slack[k]=-Infinity;
      const delta=ri-dist,nx=G[0],ny=G[1],nz=G[2],la=dist;
      const ox=G[3]-ox0,oy=G[4]-oy0,oz=G[5]-oz0,V=b+W_V,Wv=b+W_W,wx0=T[Wv],wy0=T[Wv+1],wz0=T[Wv+2];
      const ux=T[V]+wy0*oz-wz0*oy,uy=T[V+1]+wz0*ox-wx0*oz,uz=T[V+2]+wx0*oy-wy0*ox;
      S[0]=nx;S[1]=ny;S[2]=nz;
      S[3]=v[a]-la*(w[a+1]*nz-w[a+2]*ny)-ux;S[4]=v[a+1]-la*(w[a+2]*nx-w[a]*nz)-uy;S[5]=v[a+2]-la*(w[a]*ny-w[a+1]*nx)-uz;
      S[6]=w[a]-wx0;S[7]=w[a+1]-wy0;S[8]=w[a+2]-wz0;
      const curved=T[b+W_CURVED],mass=T[b+W_MASS];
      const Fn=contact(S,P,wallH,HN*k,delta,curved>0?ri*curved/(ri+curved):ri,T[b+W_TYPE]===DYNAMIC?mi*mass/(mi+mass):mi,T[b+W_ALPHA],T[b+W_MU],T[b+W_MUR],h,terms,0);
      eNormal+=terms[L_EN];pDamp-=terms[L_PD];eTangent+=terms[L_ET1];pTangent+=terms[L_PT1];eTangent+=terms[L_ET2];pTangent+=terms[L_PT2];
      const q=SUM_WALLS+WALL_SUM*wk;
      wallOn[k]=1;wallContacts++;sums[q+7]++;sums[q+6]+=Fn;
      const ratio=delta/ri;if(ratio>overlap)overlap=ratio;
      f[a]+=S[9];f[a+1]+=S[10];f[a+2]+=S[11];
      const cx=ny*S[14]-nz*S[13],cy=nz*S[12]-nx*S[14],cz=nx*S[13]-ny*S[12];
      t[a]+=S[15]-la*cx;t[a+1]+=S[16]-la*cy;t[a+2]+=S[17]-la*cz;
      sums[q]-=S[9];sums[q+1]-=S[10];sums[q+2]-=S[11];
      sums[q+3]-=S[15]+oy*S[11]-oz*S[10];sums[q+4]-=S[16]+oz*S[9]-ox*S[11];sums[q+5]-=S[17]+ox*S[10]-oy*S[9];
      if(T[b+W_TYPE]!==STATIC)exchange+=S[9]*ux+S[10]*uy+S[11]*uz+S[15]*wx0+S[16]*wy0+S[17]*wz0;
    }
  }
  sums[SUM_EN]=eNormal;sums[SUM_ET]=eTangent;sums[SUM_PD]=pDamp;sums[SUM_PT]=pTangent;sums[SUM_CONTACTS]=contacts;sums[SUM_WALL_CONTACTS]=wallContacts;sums[SUM_OVERLAP]=overlap;sums[SUM_EXCHANGE]=exchange;
}
