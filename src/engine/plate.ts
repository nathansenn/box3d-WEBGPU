// Thin plates: Kirchhoff bending on a rectangular grid (equal or graded cells), explicit dynamics, brittle fracture between nodes.
// See docs/PLATE.md. SI units throughout. float64.
import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';
import {captureFields,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';

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
  /** True: von Karman plate. Each node also has in-plane displacements u, v and the cells carry membrane forces from the
   * strains u_x + w_x^2 / 2, v_y + w_y^2 / 2, u_y + v_x + w_x w_y, so a deflection of the order of the thickness stretches
   * the middle surface and stiffens the plate. The in-plane displacements are in equilibrium at every step (their inertia is
   * neglected); `advance` then includes the membrane forces, the fracture check the membrane stress. Default false: the
   * linear Kirchhoff plate. `solveStatic` stays linear; use `relax` for the nonlinear static deflection. */
  membrane?:boolean;
  /** Node lines of a graded grid: the x offsets (from `origin`) of the cx + 1 node columns and the y offsets of the cy + 1 node
   * rows, increasing from 0 to the size. Default: equal cells. Every finite difference takes its own spacings (a curvature
   * 2 ((w+ - w) / b - (w - w-) / a) / (a + b) between spacings a and b; a twist per cell; bilinear membrane cells of their
   * own size), so a grid can be finer where cracks are to be resolved. */
  lines?:{readonly x:readonly number[];readonly y:readonly number[]};
}
export interface PlateFragment {nodes:Uint32Array;mass:number;center:[number,number,number];velocity:number;angularVelocity:[number,number];supported:boolean}

const payload=(message:string)=>new EngineError('INVALID_PAYLOAD',message);
/** Half the sum of two widths (the dual width of a node). */
const o2=(a:number,b:number)=>.5*(a+b);
/** Second difference between spacings a (behind) and b (ahead): w'' = 2 (w+ - w) / (b (a + b)) - 2 (w - w-) / (a (a + b)), first
 * order where a and b differ, second order where they are equal (then 1, -2, 1 over h^2). */
function curvature(a:number,b:number,out:Float64Array,at:number):void {out[at]=2/(a*(a+b));out[at+1]=-2/(a*b);out[at+2]=2/(b*(a+b));}
/** An exact checkpoint of a PlateBody holds every field: deflections, velocities, loads, supports, cracks, the clock and the assembled stiffness. */
const PLATE_FIELDS:FieldOptions={label:'PlateBody'};
const STENCIL=25,slot=(di:number,dj:number)=>(dj+2)*5+di+2;

/** Kirchhoff plate in the x-y plane with transverse deflection w along z. The bending energy is a sum of
 * finite-difference curvatures: per node 1/2 D A (kxx^2 + kyy^2 + 2 nu kxx kyy) with kxx = d2w/dx2 from
 * the node and its two x-neighbours, per cell D (1 - nu) kxy^2 hx hy with kxy from its four corners.
 * A crack is a broken bond between two neighbouring nodes: every curvature that spans it is dropped,
 * so the two sides carry no moment or shear across it. Forces are the exact gradient of that energy. */
export class PlateBody {
  readonly solver=PLATE_SOLVER_ID;
  readonly nx:number;readonly ny:number;readonly cx:number;readonly cy:number;
  /** Mean cell size along x and y, m (the cell size of an equal grid). */
  readonly hx:number;readonly hy:number;
  /** Node offsets from the origin along x (per column) and y (per row), and the cell widths dx (per column of cells) and dy. */
  readonly xs:Float64Array;readonly ys:Float64Array;readonly dx:Float64Array;readonly dy:Float64Array;
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
  /** Von Karman plate (`membrane: true`): in-plane displacements [u, v] per node (m), which components are held, the membrane
   * forces [Nx, Ny, Nxy] of each cell (N/m, the mean of its integration points at the last evaluation), and the work arrays
   * of the in-plane solve. Absent on a linear plate, so its checkpoints are unchanged. */
  readonly membrane:boolean=false;
  readonly uv?:Float64Array;readonly inPlaneFixed?:Uint8Array;readonly cellForce?:Float64Array;
  private mR?:Float64Array;private mP?:Float64Array;private mA?:Float64Array;private mD?:Float64Array;private mRow?:Float64Array;private cellStiffness?:Float64Array;
  /** Largest Gershgorin row of M^-1 times the membrane part of the tangent in w at the last evaluation, 1/s^2; iterations of the last in-plane solve. */
  private membraneLambda=0;membraneIterations=0;

  constructor(input:PlateDefinition){
    const o=record(input,'plate');onlyKeys(o,['size','cells','thickness','material','origin','addedArealMass','massDamping','fracture','membrane','lines'],'plate');
    const size=o.size as number[],cells=o.cells as number[];
    if(!Array.isArray(size)||size.length!==2||!Array.isArray(cells)||cells.length!==2)throw payload('plate.size and plate.cells take two numbers.');
    const a=finite(size[0],'plate.size[0]',1e-6,1e4),b=finite(size[1],'plate.size[1]',1e-6,1e4);
    this.cx=integer(cells[0],'plate.cells[0]',2,2000);this.cy=integer(cells[1],'plate.cells[1]',2,2000);
    this.nx=this.cx+1;this.ny=this.cy+1;this.hx=a/this.cx;this.hy=b/this.cy;
    this.xs=new Float64Array(this.nx);this.ys=new Float64Array(this.ny);
    if(o.lines===undefined){for(let i=0;i<this.nx;i++)this.xs[i]=i*this.hx;for(let j=0;j<this.ny;j++)this.ys[j]=j*this.hy;}
    else{
      const lines=record(o.lines,'plate.lines');onlyKeys(lines,['x','y'],'plate.lines');
      for(const [key,list,count,end] of [['x',lines.x,this.nx,a],['y',lines.y,this.ny,b]] as const){
        if(!Array.isArray(list)||list.length!==count)throw payload(`plate.lines.${key} takes ${count} offsets (cells + 1).`);
        const out=key==='x'?this.xs:this.ys;
        for(let k=0;k<count;k++){out[k]=finite(list[k],`plate.lines.${key}[${k}]`,0,end);if(k>0&&!(out[k]>out[k-1]))throw payload(`plate.lines.${key} must increase.`);}
        if(out[0]!==0||Math.abs(out[count-1]-end)>1e-12*end)throw payload(`plate.lines.${key} runs from 0 to the size.`);
        out[count-1]=end;
      }
    }
    this.dx=new Float64Array(this.cx);this.dy=new Float64Array(this.cy);
    for(let i=0;i<this.cx;i++)this.dx[i]=o.lines===undefined?this.hx:this.xs[i+1]-this.xs[i];
    for(let j=0;j<this.cy;j++)this.dy[j]=o.lines===undefined?this.hy:this.ys[j+1]-this.ys[j];
    this.curveX=new Float64Array(3*this.nx);this.curveY=new Float64Array(3*this.ny);
    for(let i=1;i<this.cx;i++)curvature(this.dx[i-1],this.dx[i],this.curveX,3*i);
    for(let j=1;j<this.cy;j++)curvature(this.dy[j-1],this.dy[j],this.curveY,3*j);
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
    this.broken=new Uint8Array(this.bondCount);this.K=new Float64Array(N*STENCIL);this.bendRow=new Float64Array(N);this.tieRow=new Float64Array(N);this.hasX=new Uint8Array(N);this.hasY=new Uint8Array(N);this.cellOn=new Uint8Array(this.cx*this.cy);this.tieWidth=new Float64Array(this.bondCount);
    const areal=this.material.density*t+added;
    for(let j=0;j<this.ny;j++)for(let i=0;i<this.nx;i++){
      const A=this.dualX(i)*this.dualY(j),n=j*this.nx+i;this.area[n]=A;this.mass[n]=areal*A;
    }
    if(o.membrane!==undefined&&typeof o.membrane!=='boolean')throw payload('plate.membrane must be true or false.');
    if(o.membrane===true){
      this.membrane=true;this.uv=new Float64Array(2*N);this.inPlaneFixed=new Uint8Array(2*N);this.cellForce=new Float64Array(3*this.cx*this.cy);
      this.mR=new Float64Array(2*N);this.mP=new Float64Array(2*N);this.mA=new Float64Array(2*N);this.mD=new Float64Array(2*N);this.mRow=new Float64Array(N);
      // The in-plane stiffness of a cell of each size: 8 x 8 on [u00, v00, u10, v10, u01, v01, u11, v11], 2 x 2 Gauss points.
      // cellKind[cell] picks the 64 entries of its size in cellStiffness (one kind on an equal grid).
      const kinds=new Map<string,number>(),sizes:[number,number][]=[];this.cellKind=new Uint16Array(this.cx*this.cy);
      for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){const key=this.dx[i]+','+this.dy[j];let k=kinds.get(key);if(k===undefined){k=sizes.length;kinds.set(key,k);sizes.push([this.dx[i],this.dy[j]]);}this.cellKind[j*this.cx+i]=k;}
      const all=this.cellStiffness=new Float64Array(64*sizes.length),C=E*t/(1-nu*nu),G=.5*C*(1-nu),g0=.5-.5/Math.sqrt(3),g1=.5+.5/Math.sqrt(3);
      sizes.forEach(([hx,hy],kind)=>{
        const Ke=all.subarray(64*kind,64*kind+64);
        for(let q=0;q<4;q++){
          const xi=q&1?g1:g0,eta=q&2?g1:g0,dx=[-(1-eta)/hx,(1-eta)/hx,-eta/hx,eta/hx],dy=[-(1-xi)/hy,-xi/hy,(1-xi)/hy,xi/hy],wt=.25*hx*hy;
          for(let a=0;a<4;a++)for(let b=0;b<4;b++){
            Ke[8*(2*a)+2*b]+=wt*(C*dx[a]*dx[b]+G*dy[a]*dy[b]);Ke[8*(2*a)+2*b+1]+=wt*(C*nu*dx[a]*dy[b]+G*dy[a]*dx[b]);
            Ke[8*(2*a+1)+2*b]+=wt*(C*nu*dy[a]*dx[b]+G*dx[a]*dy[b]);Ke[8*(2*a+1)+2*b+1]+=wt*(C*dy[a]*dy[b]+G*dx[a]*dx[b]);
          }
        }
      });
    }
    for(let j=0;j<this.ny;j++)for(let i=0;i<this.cx;i++)this.tieWidth[j*this.cx+i]=this.dualY(j);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.nx;i++)this.tieWidth[this.cx*this.ny+j*this.nx+i]=this.dualX(i);
  }
  /** Width along x (y) of the strip a node column i (row j) stands for: half of each neighbouring cell. */
  dualX(i:number):number {return o2(i>0?this.dx[i-1]:0,i<this.cx?this.dx[i]:0);}
  dualY(j:number):number {return o2(j>0?this.dy[j-1]:0,j<this.cy?this.dy[j]:0);}
  /** Coefficients of the second difference at each node column (row): w'' = c0 w- + c1 w + c2 w+. */
  private readonly curveX:Float64Array;private readonly curveY:Float64Array;
  /** Which in-plane cell stiffness (cellStiffness[64 k ..]) each cell uses. */
  private cellKind?:Uint16Array;
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,PLATE_FIELDS);}
  /** Put back a state from `saveState()` of a plate with the same grid, material and options. */
  restoreState(state:StateValue):void {restoreFields(this,state,PLATE_FIELDS);}
  node(i:number,j:number):number {return j*this.nx+i;}
  x(n:number):number {return this.origin[0]+this.xs[n%this.nx];}
  y(n:number):number {return this.origin[1]+this.ys[Math.floor(n/this.nx)];}
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
  /** Sets the extra stiffness of the given nodes (and takes note of direct writes to `extraStiffness`): only the stability
   * limit is formed again, not the bending stiffness. */
  setExtraStiffness(nodes:ArrayLike<number>,stiffness:number):void {finite(stiffness,'extra stiffness',0,1e15);for(let k=0;k<nodes.length;k++)this.extraStiffness[nodes[k]]=stiffness;this.rowsStale=true;}
  private rowsStale=true;
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
    const K=this.K,D=this.rigidity,nu=this.material.poissonRatio,nx=this.nx;K.fill(0);
    this.hasX.fill(0);this.hasY.fill(0);this.cellOn.fill(0);
    const add=(n:number,di:number,dj:number,value:number)=>{K[n*STENCIL+slot(di,dj)]+=value;};
    const gx=[0,0,0],gy=[0,0,0];
    for(let j=0;j<this.ny;j++)for(let i=0;i<nx;i++){
      const c=j*nx+i;if(!this.active[c])continue;
      for(let p=0;p<3;p++){gx[p]=this.curveX[3*i+p];gy[p]=this.curveY[3*j+p];}
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
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      const twist=2*D*(1-nu)/(this.dx[i]*this.dy[j]);
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
    this.stale=false;this.membraneStale=true;this.formRows();
  }
  /** Gershgorin rows of the bending stiffness plus supports and extra stiffness, and the bending limit. */
  private formRows():void {
    const K=this.K,bendRow=this.bendRow;let lambda=0;
    for(let n=0;n<this.nodeCount;n++){
      if(!this.active[n]||this.fixed[n]){bendRow[n]=0;continue;}let row=0;for(let k=0;k<STENCIL;k++)row+=Math.abs(K[n*STENCIL+k]);
      row+=this.support[n]+this.extraStiffness[n];bendRow[n]=row;
      lambda=Math.max(lambda,row/this.mass[n]);
    }
    this.limit=lambda>0?2/Math.sqrt(lambda):Infinity;this.bound=-1;this.rowsStale=false;
  }
  /** Largest stable time step of the explicit scheme for the current cracks, s: 2 / sqrt(max Gershgorin row of M^-1 K).
   * On a von Karman plate, or with a bridging layer, K is the tangent of the present state: each node's row is its bending row
   * plus the membrane's and the layer's rows of the last evaluation, and the largest of their sums over the mass decides. */
  stableTimeStep():number {
    if(this.stale)this.assemble();else if(this.rowsStale)this.formRows();
    const tie=(this.fracture?.tie??0)>0,membrane=this.membrane&&this.membraneLambda>0;
    if(!tie&&!membrane)return this.limit;
    if(this.bound<0){
      const B=this.bendRow,T=this.tieRow,R=this.mRow;let lambda=0;
      for(let n=0;n<this.nodeCount;n++){if(!this.active[n]||this.fixed[n])continue;const row=B[n]+(tie?T[n]:0)+(membrane?R![n]:0);if(row>lambda*this.mass[n])lambda=row/this.mass[n];}
      this.bound=lambda;
    }
    return this.bound>0?2/Math.sqrt(this.bound):Infinity;
  }
  /** Gershgorin rows of the bending stiffness (with supports, couplings and the caller's extra stiffness; read only) and of
   * the bridging layer's tangent at the last evaluation, N/m; the largest row sum over the mass of the present state (-1: not yet formed). */
  readonly bendRow:Float64Array;private readonly tieRow:Float64Array;private bound=-1;
  /** Holds the in-plane displacement components of nodes at zero (`membrane: true`): [u, v]. */
  holdInPlane(nodes:ArrayLike<number>,axes:readonly [boolean,boolean]=[true,true]):void {
    if(!this.membrane)throw payload('holdInPlane needs a plate with membrane: true.');
    for(let k=0;k<nodes.length;k++){const n=nodes[k];if(axes[0]){this.inPlaneFixed![2*n]=1;this.uv![2*n]=0;}if(axes[1]){this.inPlaneFixed![2*n+1]=1;this.uv![2*n+1]=0;}}
    this.stale=true;
  }
  /** Makes one in-plane displacement component (0: u, 1: v) the same at all the given nodes, whatever its value: an edge
   * that stays straight but may move (`membrane: true`). The nodes must not be held in that component. */
  tieInPlane(nodes:ArrayLike<number>,axis:0|1):void {
    if(!this.membrane)throw payload('tieInPlane needs a plate with membrane: true.');
    if(axis!==0&&axis!==1)throw payload('tieInPlane takes axis 0 (u) or 1 (v).');
    const list=Int32Array.from(Array.from(nodes),n=>2*integer(n,'node',0,this.nodeCount-1)+axis);
    if(list.length<2)throw payload('A tie joins at least two nodes.');
    for(const k of list)if(this.inPlaneFixed![k])throw payload('A tied component is held.');
    (this.inPlaneTies??=[]).push(list);let mean=0;for(const k of list)mean+=this.uv![k]/list.length;for(const k of list)this.uv![k]=mean;
    this.membraneStale=true;
  }
  private inPlaneTies?:Int32Array[];
  /** Projects a vector of in-plane components on the tied space: every tied group takes its mean. */
  private tie(x:Float64Array):void {
    if(!this.inPlaneTies)return;
    for(const list of this.inPlaneTies){let mean=0;for(let q=0;q<list.length;q++)mean+=x[list[q]];mean/=list.length;for(let q=0;q<list.length;q++)x[list[q]]=mean;}
  }
  /** The gradient in the in-plane displacements of the membrane energy at zero in-plane displacement (the load of the
   * in-plane solve), added to fa: `membraneEnergy(w, 0, fa, ...)` without its other work, to the same bits. */
  private inPlaneLoad(w:Float64Array,fa:Float64Array):void {
    const nx=this.nx,nu=this.material.poissonRatio,C=this.material.youngModulus*this.thickness/(1-nu*nu),G=.5*C*(1-nu);
    const g0=.5-.5/Math.sqrt(3),g1=.5+.5/Math.sqrt(3);let steepest=0;
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      if(!this.cellOn[j*this.cx+i])continue;const hx=this.dx[i],hy=this.dy[j],wt=.25*hx*hy;
      const n00=j*nx+i,n10=n00+1,n01=n00+nx,n11=n01+1,w00=w[n00],w10=w[n10],w01=w[n01],w11=w[n11];
      for(let q=0;q<4;q++){
        const xi=q&1?g1:g0,eta=q&2?g1:g0,ax=(1-eta)/hx,bx=eta/hx,ay=(1-xi)/hy,by=xi/hy;
        const wx=ax*(w10-w00)+bx*(w11-w01),wy=ay*(w01-w00)+by*(w11-w10);
        // With zero in-plane displacement u_x = v_y = u_y + v_x = 0 exactly, so these are the strains of membraneEnergy.
        const ex=0+.5*wx*wx,ey=0+.5*wy*wy,gxy=0+0+wx*wy,Nx=C*(ex+nu*ey),Ny=C*(ey+nu*ex),Nxy=G*gxy;
        if(wx*wx+wy*wy>steepest)steepest=wx*wx+wy*wy;
        const px=wt*Nx,py=wt*Ny,pxy=wt*Nxy;
        fa[2*n00]+=-ax*px-ay*pxy;fa[2*n10]+=ax*px-by*pxy;fa[2*n01]+=-bx*px+ay*pxy;fa[2*n11]+=bx*px+by*pxy;
        fa[2*n00+1]+=-ay*py-ax*pxy;fa[2*n10+1]+=-by*py+ax*pxy;fa[2*n01+1]+=ay*py-bx*pxy;fa[2*n11+1]+=by*py+bx*pxy;
      }
    }
    this.membraneLoad=C*steepest;
  }
  /** Membrane energy of the intact cells for deflections w and in-plane displacements a (bilinear on each cell, 2 x 2 Gauss
   * points). Adds its gradient in a to `fa` and in w to `fw`. `linear`: the part that is quadratic in a alone (w taken as
   * zero), for the in-plane solve. With `record` the cells' mean membrane forces and the stability row sums are stored. */
  private membraneEnergy(w:Float64Array,a:Float64Array,fa:Float64Array|null,fw:Float64Array|null,linear:boolean,record:boolean):number {
    const nx=this.nx,nu=this.material.poissonRatio,C=this.material.youngModulus*this.thickness/(1-nu*nu),G=.5*C*(1-nu);
    const g0=.5-.5/Math.sqrt(3),g1=.5+.5/Math.sqrt(3),row=this.mRow!,cellForce=this.cellForce!;let energy=0,steepest=0;
    if(record)row.fill(0);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      const cell=j*this.cx+i;if(!this.cellOn[cell]){if(record){cellForce[3*cell]=0;cellForce[3*cell+1]=0;cellForce[3*cell+2]=0;}continue;}
      const n00=j*nx+i,n10=n00+1,n01=n00+nx,n11=n01+1,hx=this.dx[i],hy=this.dy[j],wt=.25*hx*hy;
      const u00=a[2*n00],u10=a[2*n10],u01=a[2*n01],u11=a[2*n11],v00=a[2*n00+1],v10=a[2*n10+1],v01=a[2*n01+1],v11=a[2*n11+1];
      const w00=linear?0:w[n00],w10=linear?0:w[n10],w01=linear?0:w[n01],w11=linear?0:w[n11];
      let sx=0,sy=0,sxy=0;
      for(let q=0;q<4;q++){
        const xi=q&1?g1:g0,eta=q&2?g1:g0;
        // d/dx of the four shape functions is (-(1 - eta), 1 - eta, -eta, eta) / hx; d/dy is (-(1 - xi), -xi, 1 - xi, xi) / hy.
        const ax=(1-eta)/hx,bx=eta/hx,ay=(1-xi)/hy,by=xi/hy;
        const ux=ax*(u10-u00)+bx*(u11-u01),uy=ay*(u01-u00)+by*(u11-u10),vx=ax*(v10-v00)+bx*(v11-v01),vy=ay*(v01-v00)+by*(v11-v10);
        const wx=ax*(w10-w00)+bx*(w11-w01),wy=ay*(w01-w00)+by*(w11-w10);
        const ex=ux+.5*wx*wx,ey=vy+.5*wy*wy,gxy=uy+vx+wx*wy,Nx=C*(ex+nu*ey),Ny=C*(ey+nu*ex),Nxy=G*gxy;
        if(wx*wx+wy*wy>steepest)steepest=wx*wx+wy*wy;
        energy+=.5*wt*(Nx*ex+Ny*ey+Nxy*gxy);
        if(fa){
          const px=wt*Nx,py=wt*Ny,pxy=wt*Nxy;
          fa[2*n00]+=-ax*px-ay*pxy;fa[2*n10]+=ax*px-by*pxy;fa[2*n01]+=-bx*px+ay*pxy;fa[2*n11]+=bx*px+by*pxy;
          fa[2*n00+1]+=-ay*py-ax*pxy;fa[2*n10+1]+=-by*py+ax*pxy;fa[2*n01+1]+=ay*py-bx*pxy;fa[2*n11+1]+=by*py+bx*pxy;
        }
        if(fw){
          const qx=wt*(Nx*wx+Nxy*wy),qy=wt*(Ny*wy+Nxy*wx);
          fw[n00]+=-ax*qx-ay*qy;fw[n10]+=ax*qx-by*qy;fw[n01]+=-bx*qx+ay*qy;fw[n11]+=bx*qx+by*qy;
        }
        if(record){
          sx+=.25*Nx;sy+=.25*Ny;sxy+=.25*Nxy;
          // The membrane's tangent in w at this point is grad(dw)' (N + G) grad(dw), G = B' C B the material part (B the rows
          // w_x d/dx, w_y d/dy, w_y d/dx + w_x d/dy). It is at most grad(dw)' S grad(dw) with S = N+ + G positive semidefinite
          // (N+: N without its compressive principal part). For such S, |grad N_k' S grad N_j| <= sqrt(a_k a_j) with
          // a_k = grad N_k' S grad N_k (Cauchy-Schwarz), so node k's Gershgorin row gains wt sqrt(a_k) sum_j sqrt(a_j).
          let pxx=Nx,pyy=Ny,pxy=Nxy;const mean=.5*(Nx+Ny),radius=Math.sqrt(.25*(Nx-Ny)*(Nx-Ny)+Nxy*Nxy),low=mean-radius,high=mean+radius;
          if(low<0){if(high>0){const f=high/(2*radius);pxx=f*(Nx-low);pyy=f*(Ny-low);pxy=f*Nxy;}else{pxx=0;pyy=0;pxy=0;}}
          const Sxx=pxx+C*wx*wx+G*wy*wy,Syy=pyy+C*wy*wy+G*wx*wx,Sxy=pxy+(C*nu+G)*wx*wy;
          const s0=Math.sqrt(Math.max(0,Sxx*ax*ax+2*Sxy*ax*ay+Syy*ay*ay)),s1=Math.sqrt(Math.max(0,Sxx*ax*ax-2*Sxy*ax*by+Syy*by*by));
          const s2=Math.sqrt(Math.max(0,Sxx*bx*bx-2*Sxy*bx*ay+Syy*ay*ay)),s3=Math.sqrt(Math.max(0,Sxx*bx*bx+2*Sxy*bx*by+Syy*by*by)),f=wt*(s0+s1+s2+s3);
          row[n00]+=f*s0;row[n10]+=f*s1;row[n01]+=f*s2;row[n11]+=f*s3;
        }
      }
      if(record){cellForce[3*cell]=sx;cellForce[3*cell+1]=sy;cellForce[3*cell+2]=sxy;}
    }
    if(!linear)this.membraneLoad=C*steepest;
    if(record){let lambda=0;for(let n=0;n<this.nodeCount;n++)if(this.active[n]&&!this.fixed[n])lambda=Math.max(lambda,row[n]/this.mass[n]);this.membraneLambda=lambda;this.bound=-1;}
    return energy;
  }
  /** out += K p for the in-plane stiffness of the intact cells. */
  private inPlaneProduct(p:Float64Array,out:Float64Array):void {
    const Ke=this.cellStiffness!,kind=this.cellKind!,nx=this.nx;
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      if(!this.cellOn[j*this.cx+i])continue;
      const a=2*(j*nx+i),b=a+2,c=a+2*nx,d=c+2,p0=p[a],p1=p[a+1],p2=p[b],p3=p[b+1],p4=p[c],p5=p[c+1],p6=p[d],p7=p[d+1],e=64*kind[j*this.cx+i];
      for(let r=0;r<8;r++){const o=e+8*r,v=Ke[o]*p0+Ke[o+1]*p1+Ke[o+2]*p2+Ke[o+3]*p3+Ke[o+4]*p4+Ke[o+5]*p5+Ke[o+6]*p6+Ke[o+7]*p7;out[(r<2?a:r<4?b:r<6?c:d)+(r&1)]+=v;}
    }
  }
  /** Sparse Cholesky factor of the in-plane stiffness of the intact cells, formed again after every crack. The unknowns are
   * ordered by nested dissection of the node grid (`inPlaneOrdering`): a 27 x 21 grid's factor has 35,625 entries against the
   * 65,772 of the band it replaced (rows of the grid in turn), so a solve does about half the work. The structure is that of the
   * whole grid (a cracked cell leaves zeros), found once; columns are stored with their diagonal first and rows ascending.
   * Held and unconnected components are unit rows. A piece that nothing holds in its plane has rigid in-plane motions, which
   * strain nothing: the diagonal is raised by 1e-10 of itself so that the factor exists, and the self-equilibrated membrane
   * loads leave those motions at rounding. Left-looking, column by column. */
  private factorInPlane():void {
    if(!this.ipStart)this.inPlaneStructure();
    const start=this.ipStart!,rows=this.ipRows!,L=this.ipValues!,slots=this.ipCellSlots!,pos=this.ipPosition!,Ke=this.cellStiffness!,kind=this.cellKind!,fixed=this.inPlaneFixed!,M=2*this.nodeCount;L.fill(0);
    for(let cell=0;cell<this.cx*this.cy;cell++){
      if(!this.cellOn[cell])continue;const o=36*cell,e=64*kind[cell];let k=0;
      for(let r=0;r<8;r++)for(let c=0;c<=r;c++)L[slots[o+k++]]+=Ke[e+8*r+c];
    }
    // Unit rows: held components, and components that no intact cell reaches. A unit column's entries and its row's entries go.
    const unit=this.ipWork??=new Float64Array(M);unit.fill(0);
    for(let d=0;d<M;d++){const j=pos[d],diag=L[start[j]];if(fixed[d]||!(diag>0))unit[j]=1;}
    for(let j=0;j<M;j++){
      if(unit[j]){for(let p=start[j]+1;p<start[j+1];p++)L[p]=0;L[start[j]]=1;continue;}
      L[start[j]]*=1+1e-10;for(let p=start[j]+1;p<start[j+1];p++)if(unit[rows[p]])L[p]=0;
    }
    // Left-looking: column j takes the updates of the columns k < j whose factor has a row j (rowStart / rowEntry), then is scaled.
    const w=unit,rowStart=this.ipRowStart!,rowEntry=this.ipRowEntry!,rowColumn=this.ipRowColumn!;w.fill(0);
    for(let j=0;j<M;j++){
      const a=start[j],b=start[j+1];for(let p=a;p<b;p++)w[rows[p]]=L[p];
      for(let e=rowStart[j];e<rowStart[j+1];e++){
        const q=rowEntry[e],end=start[rowColumn[e]+1],ljk=L[q];if(ljk===0)continue;
        for(let p=q;p<end;p++)w[rows[p]]-=L[p]*ljk;
      }
      const d=w[j];if(!(d>0))throw new EngineError('NUMERICAL_FAILURE','The in-plane stiffness of the plate is not positive definite.');
      const root=Math.sqrt(d);L[a]=root;w[j]=0;
      for(let p=a+1;p<b;p++){L[p]=w[rows[p]]/root;w[rows[p]]=0;}
    }
  }
  /** Nested dissection of the node grid: the longer side is cut at its middle grid line, which separates the two halves of a
   * grid of bilinear cells; each half is ordered the same way and the line comes after both. Unknowns u, v of a node are
   * consecutive. Returns the position of each unknown. */
  private inPlaneOrdering():Int32Array {
    const nx=this.nx,nodes:number[]=[];
    const split=(i0:number,i1:number,j0:number,j1:number):void=>{
      const w=i1-i0+1,h=j1-j0+1;if(w<=0||h<=0)return;
      if(w<=2&&h<=2){for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)nodes.push(j*nx+i);return;}
      if(w>=h){const m=(i0+i1)>>1;split(i0,m-1,j0,j1);split(m+1,i1,j0,j1);for(let j=j0;j<=j1;j++)nodes.push(j*nx+m);}
      else{const m=(j0+j1)>>1;split(i0,i1,j0,m-1);split(i0,i1,m+1,j1);for(let i=i0;i<=i1;i++)nodes.push(m*nx+i);}
    };
    split(0,this.cx,0,this.cy);
    const pos=new Int32Array(2*this.nodeCount);nodes.forEach((n,k)=>{pos[2*n]=2*k;pos[2*n+1]=2*k+1;});return pos;
  }
  /** The factor's structure for the whole grid (symbolic elimination on the node graph), the slots of each cell's lower
   * triangle in it, and the row lists of the left-looking factorization. */
  private inPlaneStructure():void {
    const N=this.nodeCount,M=2*N,nx=this.nx,pos=this.ipPosition=this.inPlaneOrdering();
    // Node graph in elimination positions: the nodes of a common cell are coupled.
    const adj:Set<number>[]=Array.from({length:N},()=>new Set<number>());
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      const c=[j*nx+i,j*nx+i+1,(j+1)*nx+i,(j+1)*nx+i+1].map(n=>pos[2*n]>>1);for(const a of c)for(const b of c)if(a!==b)adj[a].add(b);
    }
    const below:number[][]=new Array(N),children:number[][]=Array.from({length:N},()=>[]);let count=0;
    for(let k=0;k<N;k++){
      const set=new Set<number>();for(const b of adj[k])if(b>k)set.add(b);for(const c of children[k])for(const b of below[c])if(b>k)set.add(b);
      const list=[...set].sort((a,b)=>a-b);below[k]=list;if(list.length)children[list[0]].push(k);count+=3+4*list.length;
    }
    const start=this.ipStart=new Int32Array(M+1),rows=this.ipRows=new Int32Array(count);this.ipValues=new Float64Array(count);
    let p=0;
    for(let k=0;k<N;k++)for(let q=0;q<2;q++){
      const j=2*k+q;start[j]=p;rows[p++]=j;if(q===0)rows[p++]=j+1;for(const b of below[k]){rows[p++]=2*b;rows[p++]=2*b+1;}
    }
    start[M]=p;
    // Where entry (r, c), r >= c, of the permuted matrix sits: a binary search in column c.
    const find=(r:number,c:number):number=>{let lo=start[c],hi=start[c+1]-1;while(lo<hi){const m=(lo+hi)>>1;if(rows[m]<r)lo=m+1;else hi=m;}if(rows[lo]!==r)throw new EngineError('INTERNAL','plate: in-plane factor structure');return lo;};
    const slots=this.ipCellSlots=new Int32Array(36*this.cx*this.cy);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      const n=j*nx+i,dofs=[2*n,2*n+1,2*n+2,2*n+3,2*(n+nx),2*(n+nx)+1,2*(n+nx)+2,2*(n+nx)+3].map(d=>pos[d]);let k=36*(j*this.cx+i);
      for(let r=0;r<8;r++)for(let c=0;c<=r;c++){const a=dofs[r],b=dofs[c];slots[k++]=find(Math.max(a,b),Math.min(a,b));}
    }
    // Row lists: for each column j, the columns k < j with an entry in row j, and that entry.
    const rowCount=new Int32Array(M+1);for(let c=0;c<M;c++)for(let e=start[c]+1;e<start[c+1];e++)rowCount[rows[e]+1]++;
    for(let r=0;r<M;r++)rowCount[r+1]+=rowCount[r];
    this.ipRowStart=Int32Array.from(rowCount);const fill=rowCount.slice(),column=this.ipRowColumn=new Int32Array(rowCount[M]),entry=this.ipRowEntry=new Int32Array(rowCount[M]);
    for(let c=0;c<M;c++)for(let e=start[c]+1;e<start[c+1];e++){const r=rows[e];column[fill[r]]=c;entry[fill[r]++]=e;}
  }
  private ipPosition?:Int32Array;private ipStart?:Int32Array;private ipRows?:Int32Array;private ipValues?:Float64Array;private ipCellSlots?:Int32Array;
  private ipRowStart?:Int32Array;private ipRowColumn?:Int32Array;private ipRowEntry?:Int32Array;private ipWork?:Float64Array;private ipSolve?:Float64Array;
  /** x = K^-1 x with the sparse factor: permute, forward and back substitution reading the columns in order, permute back.
   * The two columns of a node hold the same rows below the node (pairs u, v of the nodes below), so they are swept together;
   * every entry of y takes its products in the same order as column by column. */
  private solveFactor(x:Float64Array):void {
    const M=2*this.nodeCount,start=this.ipStart!,rows=this.ipRows!,L=this.ipValues!,pos=this.ipPosition!,y=this.ipSolve??=new Float64Array(M);
    for(let d=0;d<M;d++)y[pos[d]]=x[d];
    for(let j=0;j<M;j+=2){
      const a=start[j],c=start[j+1],end=start[j+2],v0=y[j]/L[a];y[j]=v0;
      const v1=(y[j+1]-L[a+1]*v0)/L[c];y[j+1]=v1;
      for(let p=a+2,q=c+1;q<end;p+=2,q+=2){const r=rows[q];y[r]=y[r]-L[p]*v0-L[q]*v1;y[r+1]=y[r+1]-L[p+1]*v0-L[q+1]*v1;}
    }
    for(let j=M-2;j>=0;j-=2){
      const a=start[j],c=start[j+1],end=start[j+2];
      let s1=y[j+1];for(let q=c+1;q<end;q+=2){const r=rows[q];s1=s1-L[q]*y[r]-L[q+1]*y[r+1];}
      const v1=s1/L[c];y[j+1]=v1;
      let s0=y[j]-L[a+1]*v1;for(let p=a+2,q=c+1;q<end;p+=2,q+=2){const r=rows[q];s0=s0-L[p]*y[r]-L[p+1]*y[r+1];}
      y[j]=s0/L[a];
    }
    for(let d=0;d<M;d++)x[d]=y[pos[d]];
  }
  /** In-plane equilibrium for the deflections w. Without ties: one solve with the sparse factor of the in-plane stiffness
   * (the load is the gradient at zero in-plane displacement). With ties (`tieInPlane`): conjugate gradients, below. */
  private solveInPlane(w:Float64Array):void {
    if(this.inPlaneTies){this.solveInPlaneIterative(w);return;}
    const a=this.uv!,fixed=this.inPlaneFixed!,M=2*this.nodeCount;
    if(this.membraneStale){this.factorInPlane();this.membraneStale=false;}
    const r=this.mR!;r.fill(0);this.inPlaneLoad(w,r);
    for(let k=0;k<M;k++)a[k]=fixed[k]?0:-r[k];
    this.solveFactor(a);this.membraneIterations=1;
  }
  /** In-plane equilibrium for the deflections w: conjugate gradients on the in-plane stiffness (constant between cracks),
   * diagonally preconditioned, from the displacements of the last solve, to 1e-11 of the membrane load. A piece of the
   * plate that nothing holds in its plane has rigid in-plane motions; the membrane loads are self-equilibrated, so the
   * solve leaves them where they are. */
  private solveInPlaneIterative(w:Float64Array):void {
    const a=this.uv!,r=this.mR!,p=this.mP!,Ap=this.mA!,d=this.mD!,fixed=this.inPlaneFixed!,M=2*this.nodeCount,Ke=this.cellStiffness!;
    if(this.membraneStale){
      d.fill(0);
      for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
        if(!this.cellOn[j*this.cx+i])continue;const n=2*(j*this.nx+i),m=n+2*this.nx,e=64*this.cellKind![j*this.cx+i];
        for(let q=0;q<2;q++){d[n+q]+=Ke[e+9*q];d[n+2+q]+=Ke[e+9*(2+q)];d[m+q]+=Ke[e+9*(4+q)];d[m+2+q]+=Ke[e+9*(6+q)];}
      }
      this.tie(d);this.membraneStale=false;
    }
    // Residual: -(the gradient in a at the present a and w). Its size at a = 0 is the load; a scale for it comes from the slopes.
    r.fill(0);this.membraneEnergy(w,a,r,null,false,false);this.tie(r);
    let rz=0,first=0,free=0;
    for(let k=0;k<M;k++){if(fixed[k]||!(d[k]>0)){r[k]=0;p[k]=0;continue;}r[k]=-r[k];p[k]=r[k]/d[k];rz+=r[k]*p[k];first+=r[k]*r[k];free++;}
    let widest=0;for(const h of this.dx)widest=Math.max(widest,h);for(const h of this.dy)widest=Math.max(widest,h);
    const load=this.membraneLoad*widest,target=1e-22*Math.max(free*load*load,first*1e-6);let iterations=0;
    for(;iterations<4*M;iterations++){
      let rr=0;for(let k=0;k<M;k++)rr+=r[k]*r[k];if(rr<=target)break;
      Ap.fill(0);this.inPlaneProduct(p,Ap);this.tie(Ap);
      let pAp=0;for(let k=0;k<M;k++){if(fixed[k]||!(d[k]>0))Ap[k]=0;pAp+=p[k]*Ap[k];}
      if(!(pAp>0))break;
      const alpha=rz/pAp;let next=0;
      for(let k=0;k<M;k++){a[k]+=alpha*p[k];r[k]-=alpha*Ap[k];if(d[k]>0)next+=r[k]*r[k]/d[k];}
      const beta=next/rz;rz=next;for(let k=0;k<M;k++)p[k]=(d[k]>0&&!fixed[k]?r[k]/d[k]:0)+beta*p[k];
    }
    this.membraneIterations=iterations;
  }
  /** C times the largest squared slope of the last membrane evaluation, N/m: the scale of the membrane forces. */
  private membraneLoad=0;
  private membraneStale=true;
  /** Membrane forces [Nx, Ny, Nxy] at node n, N/m: the mean of the intact cells around it (zero on a linear plate). */
  membraneForces(n:number):[number,number,number] {
    if(!this.membrane)return [0,0,0];
    const i=n%this.nx,j=Math.floor(n/this.nx),F=this.cellForce!;let a=0,b=0,c=0,count=0;
    for(const [ci,cj] of [[i-1,j-1],[i,j-1],[i-1,j],[i,j]]){if(ci<0||cj<0||ci>=this.cx||cj>=this.cy)continue;const cell=cj*this.cx+ci;if(!this.cellOn[cell])continue;a+=F[3*cell];b+=F[3*cell+1];c+=F[3*cell+2];count++;}
    return count?[a/count,b/count,c/count]:[0,0,0];
  }
  /** In-plane equilibrium and the membrane forces of the present deflections; adds the membrane forces on w to `out`. Returns the membrane energy. */
  private membraneForce(w:Float64Array,out:Float64Array|null):number {
    if(this.stale)this.assemble();
    // A plate deflected by less than 1e-4 of its thickness has membrane forces below 1e-8 of its bending forces: skip the solve.
    let most=0;for(let n=0;n<this.nodeCount;n++)if(this.active[n]){const v=Math.abs(w[n]);if(v>most)most=v;}
    if(most<1e-4*this.thickness&&this.membraneFlat){return 0;}
    this.membraneFlat=most<1e-4*this.thickness;
    if(this.membraneFlat){this.uv!.fill(0);this.cellForce!.fill(0);this.membraneLambda=0;this.bound=-1;this.membraneLoad=0;this.membraneIterations=0;return 0;}
    this.solveInPlane(w);return this.membraneEnergy(w,this.uv!,null,out,false,true);
  }
  /** True while the plate is flat to within 1e-4 of its thickness and the in-plane state has been cleared. */
  private membraneFlat=false;
  /** Internal force K w (plus the bridging membranes and supports) into out. Returns the strain energy. `record`: w is the
   * plate's state, and the bridging layer's tangent rows are kept for the stability limit. */
  internalForce(w:Float64Array,out:Float64Array,record=false):number {
    if(this.stale)this.assemble();
    const K=this.K,nx=this.nx,ny=this.ny;let energy=0;out.fill(0);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const n=j*nx+i;if(!this.active[n])continue;let f=0;const base=n*STENCIL;
      for(let dj=-2;dj<=2;dj++){const jj=j+dj;if(jj<0||jj>=ny)continue;for(let di=-2;di<=2;di++){const k=K[base+slot(di,dj)];if(k!==0)f+=k*w[n+dj*nx+di];}}
      f+=this.support[n]*w[n];out[n]+=f;energy+=.5*f*w[n];
    }
    const tie=this.fracture?.tie??0,T=this.tieRow;
    if(tie>0&&record){T.fill(0);this.bound=-1;}
    const xBonds=this.cx*this.ny,active=this.active,width=this.tieWidth,cx=this.cx;
    if(tie>0)for(let b=0;b<this.bondCount;b++){
      // The nodes of bond b (bondNodes without the array).
      const p=b<xBonds?Math.floor(b/cx)*nx+b%cx:b-xBonds,q=b<xBonds?p+1:p+nx;if(!active[p]||!active[q])continue;
      const L=b<xBonds?this.dx[b%cx]:this.dy[Math.floor((b-xBonds)/this.nx)],k=tie*width[b]/L,d=w[q]-w[p],len=Math.sqrt(L*L+d*d),s=len-L,f=k*s*d/len;
      out[q]+=f;out[p]-=f;energy+=.5*k*s*s;
      // The string's tangent along w: df / dd = k (1 - (L / len)^3), on the rows of both nodes twice (diagonal and coupling).
      if(record){const r=L/len,kt=2*k*(1-r*r*r);T[p]+=kt;T[q]+=kt;}
    }
    return energy;
  }
  /** Bending moments per unit length at node n, Kirchhoff's convention M = -D (w_xx + nu w_yy): [Mxx, Myy, Mxy] (N m / m). */
  moments(n:number,w:Float64Array=this.w):[number,number,number] {
    const i=n%this.nx,j=Math.floor(n/this.nx),nx=this.nx,D=this.rigidity,nu=this.material.poissonRatio;
    const hasX=i>0&&i<this.cx&&this.intactX(i-1,j)&&this.intactX(i,j)&&this.active[n-1]&&this.active[n+1];
    const hasY=j>0&&j<this.cy&&this.intactY(i,j-1)&&this.intactY(i,j)&&this.active[n-nx]&&this.active[n+nx];
    const X=this.curveX,Y=this.curveY,kx=hasX?X[3*i]*w[n-1]+X[3*i+1]*w[n]+X[3*i+2]*w[n+1]:0,ky=hasY?Y[3*j]*w[n-nx]+Y[3*j+1]*w[n]+Y[3*j+2]*w[n+nx]:0;
    let twist=0,cells=0;
    for(const [ci,cj] of [[i-1,j-1],[i,j-1],[i-1,j],[i,j]]){
      if(ci<0||cj<0||ci>=this.cx||cj>=this.cy)continue;const n00=cj*nx+ci;
      if(!(this.intactX(ci,cj)&&this.intactX(ci,cj+1)&&this.intactY(ci,cj)&&this.intactY(ci+1,cj)))continue;
      if(!(this.active[n00]&&this.active[n00+1]&&this.active[n00+nx]&&this.active[n00+nx+1]))continue;
      twist+=(w[n00+nx+1]-w[n00+1]-w[n00+nx]+w[n00])/(this.dx[ci]*this.dy[cj]);cells++;
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
    const f=this.scratch(),w=this.w,v=this.v,c=this.massDamping;this.internalForce(w,f,true);
    if(this.membrane)this.membraneForce(w,f);
    const limit=this.stableTimeStep();
    if(h>limit)throw new EngineError('UNSTABLE_TIME_STEP',`Plate step ${h} s exceeds the stability limit ${limit} s.`);
    for(let n=0;n<this.nodeCount;n++){
      if(!this.active[n]||this.fixed[n])continue;
      // Mass damping and the caller's dashpots (drag towards dragVelocity) are taken implicitly, so they never limit the step.
      const m=this.mass[n],g=this.drag[n],vn=(v[n]+h*(this.force[n]-f[n]+g*this.dragVelocity[n])/m)/(1+c*h+h*g/m);
      this.kineticLost+=c*h*m*vn*vn+h*g*(vn-this.dragVelocity[n])**2;v[n]=vn;w[n]+=h*vn;
      if(!Number.isFinite(w[n]))throw new EngineError('NUMERICAL_FAILURE','The plate step produced a nonfinite state.');
    }
    this.time+=h;return this.fracture?this.checkFracture():0;
  }
  private work?:Float64Array;private momentWork?:Float64Array;private nodeForce?:Float64Array;private nodeCells?:Uint8Array;
  private scratch():Float64Array {return this.work??=new Float64Array(this.nodeCount);}
  /** Moments [Mxx, Myy, Mxy] of every active node into M (3 per node), as `moments` computes them. */
  private fillMoments(w:Float64Array,M:Float64Array):void {
    if(this.stale)this.assemble();
    const nx=this.nx,D=this.rigidity,nu=this.material.poissonRatio,X=this.curveX,Y=this.curveY,T=this.twistSum??=new Float64Array(2*this.nodeCount);T.fill(0);
    for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
      if(!this.cellOn[j*this.cx+i])continue;const n=j*nx+i,k=(w[n+nx+1]-w[n+1]-w[n+nx]+w[n])/(this.dx[i]*this.dy[j]);
      T[2*n]+=k;T[2*n+1]++;T[2*n+2]+=k;T[2*n+3]++;T[2*(n+nx)]+=k;T[2*(n+nx)+1]++;T[2*(n+nx+1)]+=k;T[2*(n+nx+1)+1]++;
    }
    for(let n=0;n<this.nodeCount;n++){
      const i=3*(n%nx),j=3*Math.floor(n/nx),kx=this.hasX[n]?X[i]*w[n-1]+X[i+1]*w[n]+X[i+2]*w[n+1]:0,ky=this.hasY[n]?Y[j]*w[n-nx]+Y[j+1]*w[n]+Y[j+2]*w[n+nx]:0;
      M[3*n]=-D*(kx+nu*ky);M[3*n+1]=-D*(ky+nu*kx);M[3*n+2]=T[2*n+1]?-D*(1-nu)*T[2*n]/T[2*n+1]:0;
    }
  }
  /** Breaks every intact bond whose mid-point principal surface stress, less the prestress, reaches the strength,
   * when that principal direction is within 45 degrees of the bond. With dicing, also every bond within reach of the front. */
  checkFracture():number {
    const F=this.fracture!,limit=F.strength+F.prestress,t2=this.thickness*this.thickness,list:number[]=[];
    const M=this.momentWork??=new Float64Array(3*this.nodeCount);
    this.fillMoments(this.w,M);const xBonds=this.cx*this.ny;
    // Membrane forces at the nodes (the mean of the intact cells around each), from the evaluation of this step.
    let NF:Float64Array|null=null;
    if(this.membrane&&!this.membraneFlat){
      NF=this.nodeForce??=new Float64Array(3*this.nodeCount);NF.fill(0);
      const count=this.nodeCells??=new Uint8Array(this.nodeCount),C=this.cellForce!,nx=this.nx;count.fill(0);
      for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++){
        const cell=j*this.cx+i;if(!this.cellOn[cell])continue;const a=C[3*cell],b=C[3*cell+1],c=C[3*cell+2],n=j*nx+i;
        for(let q=0;q<4;q++){const m=n+(q&1)+(q&2?nx:0);NF[3*m]+=a;NF[3*m+1]+=b;NF[3*m+2]+=c;count[m]++;}
      }
      for(let n=0;n<this.nodeCount;n++)if(count[n]>1){const r=1/count[n];NF[3*n]*=r;NF[3*n+1]*=r;NF[3*n+2]*=r;}
    }
    for(let b=0;b<this.bondCount;b++){
      if(this.broken[b])continue;
      let p:number,q:number;if(b<xBonds){p=Math.floor(b/this.cx)*this.nx+b%this.cx;q=p+1;}else{p=b-xBonds;q=p+this.nx;}
      if(!this.active[p]||!this.active[q])continue;
      const a=.5*(M[3*p]+M[3*q]),d=.5*(M[3*p+1]+M[3*q+1]),c=.5*(M[3*p+2]+M[3*q+2]);
      let sigma:number,phi:number;
      if(NF){
        // Von Karman plate: the surface stress is the membrane stress N / t plus or minus the bending stress 6 M / t^2. The
        // larger of the two surfaces' largest principal stresses decides, and gives the direction.
        const nxx=.5*(NF[3*p]+NF[3*q])/this.thickness,nyy=.5*(NF[3*p+1]+NF[3*q+1])/this.thickness,nxy=.5*(NF[3*p+2]+NF[3*q+2])/this.thickness;
        // Either face's largest principal stress is at most |s_x| + |s_y| + |s_xy|: a bond whose bound is below the strength
        // (and, before the first crack, below the peak seen) cannot crack or raise the peak, and is skipped.
        const bound=(Math.abs(nxx)+Math.abs(nyy)+Math.abs(nxy)+6*(Math.abs(a)+Math.abs(d)+Math.abs(c))/t2)*(1+1e-12);
        if(bound<limit&&(this.breakTime>=0||bound<=this.peakStress))continue;
        sigma=-Infinity;phi=0;
        for(let side=1;side>=-1;side-=2){
          const sx=nxx+side*6*a/t2,sy=nyy+side*6*d/t2,sxy=nxy+side*6*c/t2,one=.5*(sx+sy)+Math.hypot(.5*(sx-sy),sxy);
          if(one>sigma){sigma=one;phi=.5*Math.atan2(2*sxy,sx-sy);}
        }
      }else{
        const mean=.5*(a+d),r=Math.hypot(.5*(a-d),c),big=Math.abs(mean+r)>=Math.abs(mean-r),principal=big?mean+r:mean-r;sigma=6*Math.abs(principal)/t2;
        // Direction of that principal moment: angle phi from x.
        phi=.5*Math.atan2(2*c,a-d);if(!big)phi+=Math.PI/2;
      }
      if(this.breakTime<0&&sigma>this.peakStress)this.peakStress=sigma;
      if(sigma<limit)continue;
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
    return [...groups.values()].map(nodes=>this.fragmentOf(nodes));
  }
  /** The rigid-body summary of a set of nodes: mass, centre, and the least-squares rigid fit of their velocities. */
  fragmentOf(list:ArrayLike<number>):PlateFragment {
    const nodes=Array.from(list);
    {
      let m=0,cx=0,cy=0,cz=0,p=0,supported=false;
      for(const n of nodes){const mn=this.mass[n];m+=mn;cx+=mn*this.x(n);cy+=mn*this.y(n);cz+=mn*this.w[n];p+=mn*this.v[n];if(this.fixed[n]||this.support[n]>0)supported=true;}
      cx/=m;cy/=m;cz/=m;const vz=p/m;
      // Rigid fit of the transverse velocities: v - vz = wx (y - cy) - wy (x - cx), least squares.
      let sxx=0,syy=0,sxy=0,bx=0,by=0;
      for(const n of nodes){const mn=this.mass[n],rx=this.x(n)-cx,ry=this.y(n)-cy,dv=this.v[n]-vz;sxx+=mn*ry*ry;syy+=mn*rx*rx;sxy+=-mn*rx*ry;bx+=mn*ry*dv;by+=-mn*rx*dv;}
      const det=sxx*syy-sxy*sxy,wx=det>1e-300?(bx*syy-by*sxy)/det:0,wy=det>1e-300?(sxx*by-sxy*bx)/det:0;
      return {nodes:Uint32Array.from(nodes),mass:m,center:[cx,cy,cz],velocity:vz,angularVelocity:[wx,wy],supported};
    }
  }
  /** Which nodes the given anchors hold, through the terms of the bending energy: a node is held when some term (a
   * curvature of three nodes in a line, the twist of a cell, a coupling, a bridging tie) has all its other nodes held, so that
   * the term fixes its deflection. Returns 1 per held node. An active node that is not held hangs from the plate by a hinge
   * (a row of nodes joined to the rest through one node only): the linear plate has no stiffness against its rotation, and
   * the caller should treat it as detached. The test is sufficient, not necessary: a piece held only by several such
   * links together is reported as loose. */
  heldNodes(anchors:ArrayLike<number>):Uint8Array {
    if(this.stale)this.assemble();
    const nx=this.nx,held=new Uint8Array(this.nodeCount);for(let k=0;k<anchors.length;k++)if(this.active[anchors[k]])held[anchors[k]]=1;
    for(let n=0;n<this.nodeCount;n++)if(this.active[n]&&this.fixed[n])held[n]=1;
    const tie=(this.fracture?.tie??0)>0;let changed=true;
    const three=(a:number,b:number,c:number):void=>{const k=held[a]+held[b]+held[c];if(k===2){held[a]=held[b]=held[c]=1;changed=true;}};
    while(changed){
      changed=false;
      for(let n=0;n<this.nodeCount;n++){if(this.hasX[n])three(n-1,n,n+1);if(this.hasY[n])three(n-nx,n,n+nx);}
      for(let j=0;j<this.cy;j++)for(let i=0;i<this.cx;i++)if(this.cellOn[j*this.cx+i]){const n=j*nx+i;if(held[n]+held[n+1]+held[n+nx]+held[n+nx+1]===3){held[n]=held[n+1]=held[n+nx]=held[n+nx+1]=1;changed=true;}}
      for(const [p,q] of this.couplings)if(this.active[p]&&this.active[q]&&held[p]!==held[q]){held[p]=held[q]=1;changed=true;}
      if(tie)for(let b=0;b<this.bondCount;b++){const [p,q]=this.bondNodes(b);if(this.active[p]&&this.active[q]&&held[p]!==held[q]){held[p]=held[q]=1;changed=true;}}
    }
    return held;
  }
  /** Removes a fragment's nodes from the plate (it is handed to a rigid model). */
  detach(fragment:PlateFragment):void {for(const n of fragment.nodes){this.active[n]=0;this.force[n]=0;}this.stale=true;}
  kineticEnergy():number {let e=0;for(let n=0;n<this.nodeCount;n++)if(this.active[n])e+=.5*this.mass[n]*this.v[n]*this.v[n];return e;}
  strainEnergy():number {const bending=this.internalForce(this.w,this.scratch());return this.membrane?bending+this.membraneForce(this.w,null):bending;}
  /** Static deflection of the nonlinear (or linear) plate under `force` by dynamic relaxation: explicit steps at `safety`
   * of the stability limit with the kinetic energy removed at each of its peaks, until the largest unbalanced nodal force
   * is below `tolerance` of the largest applied one. No fracture check. Returns the steps taken and that ratio. */
  relax(options:{tolerance?:number;maxSteps?:number;safety?:number}={}):{steps:number;residual:number;converged:boolean} {
    const o=record(options,'relax options');onlyKeys(o,['tolerance','maxSteps','safety'],'relax options');
    const tol=o.tolerance===undefined?1e-8:finite(o.tolerance,'tolerance',0,1),max=o.maxSteps===undefined?2e6:integer(o.maxSteps,'maxSteps',1,1e9),safety=o.safety===undefined?.5:finite(o.safety,'safety',1e-3,.95);
    const f=this.scratch(),w=this.w,v=this.v,N=this.nodeCount;let scale=0;for(let n=0;n<N;n++)if(this.active[n]&&!this.fixed[n])scale=Math.max(scale,Math.abs(this.force[n]));
    v.fill(0);let last=0,residual=Infinity,steps=0;
    for(;steps<max;steps++){
      if(this.stale)this.assemble();
      this.internalForce(w,f,true);if(this.membrane)this.membraneForce(w,f);
      residual=0;for(let n=0;n<N;n++)if(this.active[n]&&!this.fixed[n])residual=Math.max(residual,Math.abs(this.force[n]-f[n]));
      if(residual<=tol*scale){residual=scale>0?residual/scale:0;return {steps,residual,converged:true};}
      const h=safety*this.stableTimeStep();let kinetic=0;
      for(let n=0;n<N;n++){if(!this.active[n]||this.fixed[n])continue;v[n]+=h*(this.force[n]-f[n])/this.mass[n];kinetic+=this.mass[n]*v[n]*v[n];}
      // Kinetic damping: past a peak of the kinetic energy the plate is near equilibrium; stop it there.
      if(kinetic<last){v.fill(0);last=0;continue;}
      last=kinetic;for(let n=0;n<N;n++)if(this.active[n]&&!this.fixed[n])w[n]+=h*v[n];
    }
    return {steps,residual:scale>0?residual/scale:residual,converged:false};
  }
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
