// Thin plates: Kirchhoff bending on a regular grid, explicit dynamics, brittle fracture between nodes.
// See docs/PLATE.md. SI units throughout. float64.
import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';

export const PLATE_SOLVER_ID='plate-kirchhoff-fd-explicit-js-f64-v1';

export interface PlateMaterial {youngModulus:number;poissonRatio:number;density:number}
export interface PlateFracture {
  /** Tensile strength of the surface in bending, Pa (the flexural strength of the annealed material). */
  strength:number;
  /** Compressive residual stress at the surfaces (tempered glass), Pa. A face cracks when the bending stress minus this reaches the strength. Default 0. */
  prestress?:number;
  /** After the first crack every intact bond within dicingSpeed * (t - t0) of its origin breaks (tempered glass), m/s. Default 0: off. */
  dicingSpeed?:number;
  /** Membrane stiffness E t per unit width (N/m) of a layer bonded to the plate that bridges cracks (a laminate's interlayer, a wire mesh).
   * It acts on every bond as a string of that stiffness with the in-plane displacements neglected. Default 0: none. */
  tie?:number;
}
export interface PlateDefinition {
  /** Plate size [a, b] in m along x and y. */
  size:readonly [number,number];
  /** Cells [nx, ny]; nodes are the (nx + 1)(ny + 1) grid points. */
  cells:readonly [number,number];
  thickness:number;
  material:PlateMaterial;
  /** Position of node (0, 0), m. Default [0, 0]. */
  origin?:readonly [number,number];
  /** Mass per area added to the plate's own rho t (an interlayer), kg/m^2. Default 0. */
  addedArealMass?:number;
  /** Mass-proportional damping, 1/s. Default 0. */
  massDamping?:number;
  fracture?:PlateFracture;
}
export interface PlateFragment {nodes:Uint32Array;mass:number;center:[number,number,number];velocity:number;angularVelocity:[number,number];supported:boolean}

const payload=(message:string)=>new EngineError('INVALID_PAYLOAD',message);
const STENCIL=25,slot=(di:number,dj:number)=>(dj+2)*5+di+2;

/** Kirchhoff plate in the x-y plane with transverse deflection w along z. The bending energy is a sum of
 * finite-difference curvatures: per node 1/2 D A (kxx^2 + kyy^2 + 2 nu kxx kyy) with kxx = d2w/dx2 from
 * the node and its two x-neighbours, per cell D (1 - nu) kxy^2 hx hy with kxy from its four corners.
 * A crack is a broken bond between two neighbouring nodes: every curvature that spans it is dropped,
 * so the two sides carry no moment or shear across it. Forces are the exact gradient of that energy. */
export class PlateBody {
  readonly solver=PLATE_SOLVER_ID;
  readonly nx:number;readonly ny:number;readonly cx:number;readonly cy:number;readonly hx:number;readonly hy:number;
  readonly thickness:number;readonly material:Readonly<PlateMaterial>;readonly rigidity:number;readonly origin:readonly [number,number];
  readonly nodeCount:number;readonly bondCount:number;
  readonly area:Float64Array;readonly mass:Float64Array;
  readonly w:Float64Array;readonly v:Float64Array;readonly force:Float64Array;
  /** Support springs to w = 0, N/m per node. */
  readonly support:Float64Array;
  /** Nodes held at w = 0. */
  readonly fixed:Uint8Array;
  /** Nodes still part of the plate. A detached fragment's nodes are inactive. */
  readonly active:Uint8Array;
  readonly broken:Uint8Array;
  readonly fracture:Required<PlateFracture>|null;
  massDamping:number;
  /** Additional stiffness per node the caller will apply explicitly (contact springs), N/m; enters the stability limit. */
  readonly extraStiffness:Float64Array;
  /** Dashpots per node to a moving reference (contact damping), N s/m, and the reference velocities, m/s. Applied implicitly; reset by the caller. */
  readonly drag:Float64Array;readonly dragVelocity:Float64Array;
  time=0;breakTime=-1;
  /** Largest mid-bond principal surface stress seen by the fracture check up to the first crack, Pa. */
  peakStress=0;
 readonly breakOrigin:[number,number]=[0,0];
  private couplings:[number,number,number][]=[];
  private K:Float64Array;private hasX:Uint8Array;private hasY:Uint8Array;private cellOn:Uint8Array;private twistSum?:Float64Array;private stale=true;private limit=0;private kineticLost=0;
  private readonly tieWidth:Float64Array;

  constructor(input:PlateDefinition){
    const o=record(input,'plate');onlyKeys(o,['size','cells','thickness','material','origin','addedArealMass','massDamping','fracture'],'plate');
    const size=o.size as number[],cells=o.cells as number[];
    if(!Array.isArray(size)||size.length!==2||!Array.isArray(cells)||cells.length!==2)throw payload('plate.size and plate.cells take two numbers.');
    const a=finite(size[0],'plate.size[0]',1e-6,1e4),b=finite(size[1],'plate.size[1]',1e-6,1e4);
    this.cx=integer(cells[0],'plate.cells[0]',2,2000);this.cy=integer(cells[1],'plate.cells[1]',2,2000);
    this.nx=this.cx+1;this.ny=this.cy+1;this.hx=a/this.cx;this.hy=b/this.cy;
    this.thickness=finite(o.thickness,'plate.thickness',1e-6,10);
    const m=record(o.material,'plate.material');onlyKeys(m,['youngModulus','poissonRatio','density'],'plate.material');
    this.material=Object.freeze({youngModulus:finite(m.youngModulus,'youngModulus',1,1e13),poissonRatio:finite(m.poissonRatio,'poissonRatio',-.99,.4999),density:finite(m.density,'density',1e-6,1e5)});
    const E=this.material.youngModulus,nu=this.material.poissonRatio,t=this.thickness;
    this.rigidity=E*t*t*t/(12*(1-nu*nu));
    const origin=(o.origin??[0,0]) as number[];this.origin=[finite(origin[0],'origin[0]'),finite(origin[1],'origin[1]')];
    const added=o.addedArealMass===undefined?0:finite(o.addedArealMass,'addedArealMass',0,1e6);
    this.massDamping=o.massDamping===undefined?0:finite(o.massDamping,'massDamping',0,1e6);
    if(o.fracture!==undefined){
      const f=record(o.fracture,'plate.fracture');onlyKeys(f,['strength','prestress','dicingSpeed','tie'],'plate.fracture');
      this.fracture={strength:finite(f.strength,'strength',1,1e12),prestress:f.prestress===undefined?0:finite(f.prestress,'prestress',0,1e12),dicingSpeed:f.dicingSpeed===undefined?0:finite(f.dicingSpeed,'dicingSpeed',0,1e5),tie:f.tie===undefined?0:finite(f.tie,'tie',0,1e12)};
    }else this.fracture=null;
    const N=this.nodeCount=this.nx*this.ny;this.bondCount=this.cx*this.ny+this.nx*this.cy;
    this.area=new Float64Array(N);this.mass=new Float64Array(N);this.w=new Float64Array(N);this.v=new Float64Array(N);this.force=new Float64Array(N);
    this.support=new Float64Array(N);this.fixed=new Uint8Array(N);this.active=new Uint8Array(N).fill(1);this.extraStiffness=new Float64Array(N);this.drag=new Float64Array(N);this.dragVelocity=new Float64Array(N);
    this.broken=new Uint8Array(this.bondCount);this.K=new Float64Array(N*STENCIL);this.hasX=new Uint8Array(N);this.hasY=new Uint8Array(N);this.cellOn=new Uint8Array(this.cx*this.cy);this.tieWidth=new Float64Array(this.bondCount);
    const areal=this.material.density*t+added;
    for(let j=0;j<this.ny;j++)for(let i=0;i<this.nx;i++){
      const A=this.hx*this.hy*(i===0||i===this.cx?.5:1)*(j===0||j===this.cy?.5:1),n=j*this.nx+i;this.area[n]=A;this.mass[n]=areal*A;
    }
    for(let j=0;j<this.ny;j++)for(let i=0;i<this.cx;i++)this.tieWidth[j*this.cx+i]=this.hy*(j===0||j===this.cy?.5:1);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.nx;i++)this.tieWidth[this.cx*this.ny+j*this.nx+i]=this.hx*(i===0||i===this.cx?.5:1);
  }
  node(i:number,j:number):number {return j*this.nx+i;}
  x(n:number):number {return this.origin[0]+(n%this.nx)*this.hx;}
  y(n:number):number {return this.origin[1]+Math.floor(n/this.nx)*this.hy;}
  /** Bond between (i, j) and (i + 1, j). */
  bondX(i:number,j:number):number {return j*this.cx+i;}
  /** Bond between (i, j) and (i, j + 1). */
  bondY(i:number,j:number):number {return this.cx*this.ny+j*this.nx+i;}
  /** The two nodes of a bond. */
  bondNodes(b:number):[number,number] {
    if(b<this.cx*this.ny){const j=Math.floor(b/this.cx),i=b%this.cx,n=j*this.nx+i;return [n,n+1];}
    const k=b-this.cx*this.ny,n=k;return [n,n+this.nx];
  }
  selectNodes(predicate:(x:number,y:number)=>boolean):Uint32Array {const out:number[]=[];for(let n=0;n<this.nodeCount;n++)if(predicate(this.x(n),this.y(n)))out.push(n);return Uint32Array.from(out);}
  hold(nodes:ArrayLike<number>):void {for(let k=0;k<nodes.length;k++){const n=nodes[k];this.fixed[n]=1;this.w[n]=0;this.v[n]=0;}}
  addSupport(nodes:ArrayLike<number>,stiffness:number):void {finite(stiffness,'support stiffness',0,1e15);for(let k=0;k<nodes.length;k++)this.support[nodes[k]]+=stiffness;this.stale=true;}
  setExtraStiffness(nodes:ArrayLike<number>,stiffness:number):void {finite(stiffness,'extra stiffness',0,1e15);for(let k=0;k<nodes.length;k++)this.extraStiffness[nodes[k]]=stiffness;this.stale=true;}
  /** A linear spring of stiffness k (N/m) on w_q - w_p between two nodes at most two cells apart (a rotational restraint of a clamp). */
  addCoupling(p:number,q:number,k:number):void {
    integer(p,'node',0,this.nodeCount-1);integer(q,'node',0,this.nodeCount-1);finite(k,'coupling stiffness',0,1e15);
    const di=q%this.nx-p%this.nx,dj=Math.floor(q/this.nx)-Math.floor(p/this.nx);
    if(p===q||Math.abs(di)>2||Math.abs(dj)>2)throw payload('A coupling joins two different nodes at most two cells apart.');
    this.couplings.push([p,q,k]);this.stale=true;
  }
  breakBonds(bonds:ArrayLike<number>):void {for(let k=0;k<bonds.length;k++)this.broken[bonds[k]]=1;this.stale=true;}

  private intactX(i:number,j:number):boolean {return i>=0&&i<this.cx&&!this.broken[j*this.cx+i];}
  private intactY(i:number,j:number):boolean {return j>=0&&j<this.cy&&!this.broken[this.cx*this.ny+j*this.nx+i];}
  /** Assembles the bending stiffness as a 5 x 5 stencil per node (rows of active nodes only). */
  private assemble():void {
    const K=this.K,D=this.rigidity,nu=this.material.poissonRatio,hx2=this.hx*this.hx,hy2=this.hy*this.hy,nx=this.nx;K.fill(0);
    this.hasX.fill(0);this.hasY.fill(0);this.cellOn.fill(0);
    const add=(n:number,di:number,dj:number,value:number)=>{K[n*STENCIL+slot(di,dj)]+=value;};
    const gx=[1/hx2,-2/hx2,1/hx2],gy=[1/hy2,-2/hy2,1/hy2];
    for(let j=0;j<this.ny;j++)for(let i=0;i<nx;i++){
      const c=j*nx+i;if(!this.active[c])continue;
      const hasX=i>0&&i<this.cx&&this.intactX(i-1,j)&&this.intactX(i,j)&&this.active[c-1]&&this.active[c+1];
      const hasY=j>0&&j<this.cy&&this.intactY(i,j-1)&&this.intactY(i,j)&&this.active[c-nx]&&this.active[c+nx];
      this.hasX[c]=hasX?1:0;this.hasY[c]=hasY?1:0;
      const A=D*this.area[c],terms:[number,number,number][]=[];
      // energy 1/2 A D (kx^2 + ky^2 + 2 nu kx ky): Hessian A D (gx gx' + gy gy' + nu (gx gy' + gy gx'))
      if(hasX)for(let p=0;p<3;p++)terms.push([p-1,0,gx[p]]);
      const xs=terms.length;
      if(hasY)for(let p=0;p<3;p++)terms.push([0,p-1,gy[p]]);
      for(let p=0;p<terms.length;p++)for(let q=0;q<terms.length;q++){
        const sameX=p<xs,sameQ=q<xs,weight=sameX===sameQ?1:nu,[ai,aj,av]=terms[p],[bi,bj,bv]=terms[q];
        add(c+aj*nx+ai,bi-ai,bj-aj,A*weight*av*bv);
      }
    }
    const twist=2*D*(1-nu)/(this.hx*this.hy);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      const n00=j*nx+i,n10=n00+1,n01=n00+nx,n11=n01+1;
      if(!(this.active[n00]&&this.active[n10]&&this.active[n01]&&this.active[n11]))continue;
      if(!(this.intactX(i,j)&&this.intactX(i,j+1)&&this.intactY(i,j)&&this.intactY(i+1,j)))continue;
      this.cellOn[j*this.cx+i]=1;
      // energy D (1 - nu) kxy^2 hx hy, kxy = (w11 - w10 - w01 + w00) / (hx hy)
      const c:[number,number,number][]=[[0,0,1],[1,0,-1],[0,1,-1],[1,1,1]];
      for(const [ai,aj,av] of c)for(const [bi,bj,bv] of c)add(n00+aj*nx+ai,bi-ai,bj-aj,twist*av*bv);
    }
    for(const [p,q,k] of this.couplings){
      if(!this.active[p]||!this.active[q])continue;const di=q%nx-p%nx,dj=Math.floor(q/nx)-Math.floor(p/nx);
      add(p,0,0,k);add(q,0,0,k);add(p,di,dj,-k);add(q,-di,-dj,-k);
    }
    let lambda=0;
    for(let n=0;n<this.nodeCount;n++){
      if(!this.active[n]||this.fixed[n])continue;let row=0;for(let k=0;k<STENCIL;k++)row+=Math.abs(K[n*STENCIL+k]);
      row+=this.support[n]+this.extraStiffness[n];
      if(this.fracture&&this.fracture.tie>0)row+=8*this.fracture.tie*Math.max(this.hy/this.hx,this.hx/this.hy);
      lambda=Math.max(lambda,row/this.mass[n]);
    }
    this.limit=lambda>0?2/Math.sqrt(lambda):Infinity;this.stale=false;
  }
  /** Largest stable time step of the explicit scheme for the current cracks, s: 2 / sqrt(max Gershgorin row of M^-1 K). */
  stableTimeStep():number {if(this.stale)this.assemble();return this.limit;}
  /** Internal force K w (plus the bridging membranes and supports) into out. Returns the strain energy. */
  internalForce(w:Float64Array,out:Float64Array):number {
    if(this.stale)this.assemble();
    const K=this.K,nx=this.nx,ny=this.ny;let energy=0;out.fill(0);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const n=j*nx+i;if(!this.active[n])continue;let f=0;const base=n*STENCIL;
      for(let dj=-2;dj<=2;dj++){const jj=j+dj;if(jj<0||jj>=ny)continue;for(let di=-2;di<=2;di++){const k=K[base+slot(di,dj)];if(k!==0)f+=k*w[n+dj*nx+di];}}
      f+=this.support[n]*w[n];out[n]+=f;energy+=.5*f*w[n];
    }
    const tie=this.fracture?.tie??0;
    if(tie>0)for(let b=0;b<this.bondCount;b++){
      const [p,q]=this.bondNodes(b);if(!this.active[p]||!this.active[q])continue;
      const L=b<this.cx*this.ny?this.hx:this.hy,k=tie*this.tieWidth[b]/L,d=w[q]-w[p],len=Math.sqrt(L*L+d*d),s=len-L,f=k*s*d/len;
      out[q]+=f;out[p]-=f;energy+=.5*k*s*s;
    }
    return energy;
  }
  /** Bending moments per unit length at node n, Kirchhoff's convention M = -D (w_xx + nu w_yy): [Mxx, Myy, Mxy] (N m / m). */
  moments(n:number,w:Float64Array=this.w):[number,number,number] {
    const i=n%this.nx,j=Math.floor(n/this.nx),nx=this.nx,D=this.rigidity,nu=this.material.poissonRatio;
    const hasX=i>0&&i<this.cx&&this.intactX(i-1,j)&&this.intactX(i,j)&&this.active[n-1]&&this.active[n+1];
    const hasY=j>0&&j<this.cy&&this.intactY(i,j-1)&&this.intactY(i,j)&&this.active[n-nx]&&this.active[n+nx];
    const kx=hasX?(w[n-1]-2*w[n]+w[n+1])/(this.hx*this.hx):0,ky=hasY?(w[n-nx]-2*w[n]+w[n+nx])/(this.hy*this.hy):0;
    let twist=0,cells=0;
    for(const [ci,cj] of [[i-1,j-1],[i,j-1],[i-1,j],[i,j]]){
      if(ci<0||cj<0||ci>=this.cx||cj>=this.cy)continue;const n00=cj*nx+ci;
      if(!(this.intactX(ci,cj)&&this.intactX(ci,cj+1)&&this.intactY(ci,cj)&&this.intactY(ci+1,cj)))continue;
      if(!(this.active[n00]&&this.active[n00+1]&&this.active[n00+nx]&&this.active[n00+nx+1]))continue;
      twist+=(w[n00+nx+1]-w[n00+1]-w[n00+nx]+w[n00])/(this.hx*this.hy);cells++;
    }
    return [-D*(kx+nu*ky),-D*(ky+nu*kx),cells?-D*(1-nu)*twist/cells:0];
  }
  /** Largest tensile bending stress at either surface of node n, Pa: 6 max |principal moment| / t^2. */
  surfaceStress(n:number,w:Float64Array=this.w):number {
    const [a,b,c]=this.moments(n,w),m=.5*(a+b),r=Math.hypot(.5*(a-b),c);return 6*Math.max(Math.abs(m+r),Math.abs(m-r))/(this.thickness*this.thickness);
  }
  /** One explicit step (symplectic Euler) of length h under the current `force`. Breaks bonds afterwards; returns how many. */
  advance(h:number):number {
    finite(h,'step',0,1);if(this.stale)this.assemble();
    if(h>this.limit)throw new EngineError('UNSTABLE_TIME_STEP',`Plate step ${h} s exceeds the stability limit ${this.limit} s.`);
    const f=this.scratch(),w=this.w,v=this.v,c=this.massDamping;this.internalForce(w,f);
    for(let n=0;n<this.nodeCount;n++){
      if(!this.active[n]||this.fixed[n])continue;
      // Mass damping and the caller's dashpots (drag towards dragVelocity) are taken implicitly, so they never limit the step.
      const m=this.mass[n],g=this.drag[n],vn=(v[n]+h*(this.force[n]-f[n]+g*this.dragVelocity[n])/m)/(1+c*h+h*g/m);
      this.kineticLost+=c*h*m*vn*vn+h*g*(vn-this.dragVelocity[n])**2;v[n]=vn;w[n]+=h*vn;
      if(!Number.isFinite(w[n]))throw new EngineError('NUMERICAL_FAILURE','The plate step produced a nonfinite state.');
    }
    this.time+=h;return this.fracture?this.checkFracture():0;
  }
  private work?:Float64Array;private momentWork?:Float64Array;
  private scratch():Float64Array {return this.work??=new Float64Array(this.nodeCount);}
  /** Moments [Mxx, Myy, Mxy] of every active node into M (3 per node), as `moments` computes them. */
  private fillMoments(w:Float64Array,M:Float64Array):void {
    if(this.stale)this.assemble();
    const nx=this.nx,D=this.rigidity,nu=this.material.poissonRatio,ihx=1/(this.hx*this.hx),ihy=1/(this.hy*this.hy),ixy=1/(this.hx*this.hy),T=this.twistSum??=new Float64Array(2*this.nodeCount);T.fill(0);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      if(!this.cellOn[j*this.cx+i])continue;const n=j*nx+i,k=(w[n+nx+1]-w[n+1]-w[n+nx]+w[n])*ixy;
      T[2*n]+=k;T[2*n+1]++;T[2*n+2]+=k;T[2*n+3]++;T[2*(n+nx)]+=k;T[2*(n+nx)+1]++;T[2*(n+nx+1)]+=k;T[2*(n+nx+1)+1]++;
    }
    for(let n=0;n<this.nodeCount;n++){
      const kx=this.hasX[n]?(w[n-1]-2*w[n]+w[n+1])*ihx:0,ky=this.hasY[n]?(w[n-nx]-2*w[n]+w[n+nx])*ihy:0;
      M[3*n]=-D*(kx+nu*ky);M[3*n+1]=-D*(ky+nu*kx);M[3*n+2]=T[2*n+1]?-D*(1-nu)*T[2*n]/T[2*n+1]:0;
    }
  }
  /** Breaks every intact bond whose mid-point principal surface stress, less the prestress, reaches the strength,
   * when that principal direction is within 45 degrees of the bond. With dicing, also every bond within reach of the front. */
  checkFracture():number {
    const F=this.fracture!,limit=F.strength+F.prestress,t2=this.thickness*this.thickness,list:number[]=[];
    const M=this.momentWork??=new Float64Array(3*this.nodeCount);
    this.fillMoments(this.w,M);const xBonds=this.cx*this.ny;
    for(let b=0;b<this.bondCount;b++){
      if(this.broken[b])continue;
      let p:number,q:number;if(b<xBonds){p=Math.floor(b/this.cx)*this.nx+b%this.cx;q=p+1;}else{p=b-xBonds;q=p+this.nx;}
      if(!this.active[p]||!this.active[q])continue;
      const a=.5*(M[3*p]+M[3*q]),d=.5*(M[3*p+1]+M[3*q+1]),c=.5*(M[3*p+2]+M[3*q+2]),mean=.5*(a+d),r=Math.hypot(.5*(a-d),c);
      const big=Math.abs(mean+r)>=Math.abs(mean-r),principal=big?mean+r:mean-r,sigma=6*Math.abs(principal)/t2;
      if(this.breakTime<0&&sigma>this.peakStress)this.peakStress=sigma;
      if(sigma<limit)continue;
      // Direction of that principal moment: angle phi from x.
      let phi=.5*Math.atan2(2*c,a-d);if(!big)phi+=Math.PI/2;
      const alongX=b<this.cx*this.ny,cos=Math.abs(Math.cos(phi));
      if(alongX?cos>=Math.SQRT1_2-1e-12:cos<=Math.SQRT1_2+1e-12)list.push(b);
    }
    if(list.length&&this.breakTime<0){
      this.breakTime=this.time;const [p,q]=this.bondNodes(list[0]);this.breakOrigin[0]=.5*(this.x(p)+this.x(q));this.breakOrigin[1]=.5*(this.y(p)+this.y(q));
    }
    if(F.dicingSpeed>0&&this.breakTime>=0){
      const reach=F.dicingSpeed*(this.time-this.breakTime);
      for(let b=0;b<this.bondCount;b++){
        if(this.broken[b])continue;const [p,q]=this.bondNodes(b);
        if(Math.hypot(.5*(this.x(p)+this.x(q))-this.breakOrigin[0],.5*(this.y(p)+this.y(q))-this.breakOrigin[1])<=reach)list.push(b);
      }
    }
    if(!list.length)return 0;
    for(const b of list)this.broken[b]=1;this.stale=true;return new Set(list).size;
  }
  /** Connected pieces of active nodes: joined by a shared curvature term, or across a crack by a bridging tie. */
  fragments():PlateFragment[] {
    const parent=new Int32Array(this.nodeCount);for(let n=0;n<this.nodeCount;n++)parent[n]=n;
    const find=(n:number):number=>{while(parent[n]!==n){parent[n]=parent[parent[n]];n=parent[n];}return n;};
    const join=(p:number,q:number)=>{const rp=find(p),rq=find(q);if(rp!==rq)parent[Math.max(rp,rq)]=Math.min(rp,rq);};
    // Nodes are joined by the curvature terms that couple them, not by bonds alone: a node whose curvatures were all
    // cut carries no load from its neighbours even if one bond to them is intact.
    if(this.stale)this.assemble();const nx=this.nx;
    for(let n=0;n<this.nodeCount;n++){if(this.hasX[n]){join(n-1,n);join(n,n+1);}if(this.hasY[n]){join(n-nx,n);join(n,n+nx);}}
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++)if(this.cellOn[j*this.cx+i]){const n=j*nx+i;join(n,n+1);join(n,n+nx);join(n,n+nx+1);}
    // A bridging layer (a laminate's interlayer) joins every pair of neighbours, cracked or not.
    if((this.fracture?.tie??0)>0)for(let b=0;b<this.bondCount;b++){const [p,q]=this.bondNodes(b);if(this.active[p]&&this.active[q])join(p,q);}
    const groups=new Map<number,number[]>();
    for(let n=0;n<this.nodeCount;n++)if(this.active[n]){const r=find(n);let g=groups.get(r);if(!g)groups.set(r,g=[]);g.push(n);}
    return [...groups.values()].map(nodes=>{
      let m=0,cx=0,cy=0,cz=0,p=0,supported=false;
      for(const n of nodes){const mn=this.mass[n];m+=mn;cx+=mn*this.x(n);cy+=mn*this.y(n);cz+=mn*this.w[n];p+=mn*this.v[n];if(this.fixed[n]||this.support[n]>0)supported=true;}
      cx/=m;cy/=m;cz/=m;const vz=p/m;
      // Rigid fit of the transverse velocities: v - vz = wx (y - cy) - wy (x - cx), least squares.
      let sxx=0,syy=0,sxy=0,bx=0,by=0;
      for(const n of nodes){const mn=this.mass[n],rx=this.x(n)-cx,ry=this.y(n)-cy,dv=this.v[n]-vz;sxx+=mn*ry*ry;syy+=mn*rx*rx;sxy+=-mn*rx*ry;bx+=mn*ry*dv;by+=-mn*rx*dv;}
      const det=sxx*syy-sxy*sxy,wx=det>1e-300?(bx*syy-by*sxy)/det:0,wy=det>1e-300?(sxx*by-sxy*bx)/det:0;
      return {nodes:Uint32Array.from(nodes),mass:m,center:[cx,cy,cz],velocity:vz,angularVelocity:[wx,wy],supported};
    });
  }
  /** Removes a fragment's nodes from the plate (it is handed to a rigid model). */
  detach(fragment:PlateFragment):void {for(const n of fragment.nodes){this.active[n]=0;this.force[n]=0;}this.stale=true;}
  kineticEnergy():number {let e=0;for(let n=0;n<this.nodeCount;n++)if(this.active[n])e+=.5*this.mass[n]*this.v[n]*this.v[n];return e;}
  strainEnergy():number {return this.internalForce(this.w,this.scratch());}
  /** Energy taken out by mass damping and the dashpots so far, J. */
  get dampingLoss():number {return this.kineticLost;}
  /** Static deflection under `force` (no bridging membranes): conjugate gradients on K w = f over the free active nodes. */
  solveStatic(options:{tolerance?:number;maxIterations?:number}={}):{iterations:number;residual:number} {
    const o=record(options,'static options');onlyKeys(o,['tolerance','maxIterations'],'static options');
    const tol=o.tolerance===undefined?1e-12:finite(o.tolerance,'tolerance',0,1),max=o.maxIterations===undefined?20000:integer(o.maxIterations,'maxIterations',1,1e7);
    const N=this.nodeCount,free=(n:number)=>this.active[n]&&!this.fixed[n],x=this.w,r=new Float64Array(N),p=new Float64Array(N),Ap=new Float64Array(N);
    x.fill(0);let rr=0,fn=0;for(let n=0;n<N;n++){r[n]=free(n)?this.force[n]:0;p[n]=r[n];rr+=r[n]*r[n];fn+=r[n]*r[n];}
    const target=tol*tol*fn;let k=0;
    for(;k<max&&rr>target;k++){
      this.internalForce(p,Ap);let pAp=0;for(let n=0;n<N;n++){if(!free(n))Ap[n]=0;pAp+=p[n]*Ap[n];}
      const alpha=rr/pAp;let next=0;for(let n=0;n<N;n++){x[n]+=alpha*p[n];r[n]-=alpha*Ap[n];next+=r[n]*r[n];}
      const beta=next/rr;rr=next;for(let n=0;n<N;n++)p[n]=r[n]+beta*p[n];
    }
    this.v.fill(0);return {iterations:k,residual:Math.sqrt(rr/Math.max(fn,1e-300))};
  }
}

/** Natural frequency of mode (m, n) of a simply supported a x b Kirchhoff plate, Hz. */
export function plateFrequency(a:number,b:number,D:number,arealMass:number,m:number,n:number):number {
  return Math.PI/2*((m/a)**2+(n/b)**2)*Math.sqrt(D/arealMass);
}
/** The same mode of the finite-difference grid (cells hx, hy), Hz: exact for this discretisation. */
export function plateGridFrequency(a:number,b:number,cells:readonly [number,number],D:number,arealMass:number,m:number,n:number):number {
  const hx=a/cells[0],hy=b/cells[1],lx=4/(hx*hx)*Math.sin(m*Math.PI*hx/(2*a))**2,ly=4/(hy*hy)*Math.sin(n*Math.PI*hy/(2*b))**2;
  return (lx+ly)*Math.sqrt(D/arealMass)/(2*Math.PI);
}
/** Navier series for a simply supported a x b plate under uniform pressure q: centre deflection and centre moments. */
export function navierUniform(a:number,b:number,D:number,nu:number,q:number,terms=199):{deflection:number;mx:number;my:number} {
  let w=0,mx=0,my=0;
  for(let m=1;m<=terms;m+=2)for(let n=1;n<=terms;n+=2){
    const s=Math.sin(m*Math.PI/2)*Math.sin(n*Math.PI/2),am=m*Math.PI/a,bn=n*Math.PI/b,c=16*q/(Math.PI**2*m*n)*s/(D*(am*am+bn*bn)**2);
    w+=c;mx+=D*c*(am*am+nu*bn*bn);my+=D*c*(bn*bn+nu*am*am);
  }
  return {deflection:w,mx,my};
}
