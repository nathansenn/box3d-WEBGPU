/**
 * A geometric multigrid V-cycle used as the preconditioner of the conjugate-gradient pressure solve of `Fluid`
 * (fluid.ts, option `pressureSolver: 'multigrid'`). SI-free: it works on the cell-centred 7-point matrix A of the
 * projection, A x = b, given by the diagonal and the neighbour list fluid.ts builds (closed walls, p = 0 outflow
 * sides, periodic sides).
 *
 * Levels: each coarser level joins 2 x 2 x 2 blocks of cells (2 x 2 x 1 ... where an axis has one cell left; a block
 * at an odd end has one cell along that axis). The coarse matrix is the Galerkin product P^T A P with P the
 * piecewise-constant prolongation, so every boundary type carries over exactly and each level is symmetric positive
 * (semi-)definite. Smoothing: Gauss-Seidel, the cells of even (i + j + k) then odd before the coarse correction, the
 * same updates in exactly reverse order after it, so the V-cycle is a symmetric operator and CG keeps its guarantees.
 * The coarse correction is scaled by `overCorrection` (piecewise-constant prolongation under-corrects; 2 gave the fewest
 * iterations on the boxes measured in docs/FLUID.md, "Cost"). The coarsest level (at most `coarsest` cells) gets
 * `coarseSweeps` symmetric sweeps.
 * A singular problem (no outflow side: pressure defined up to a constant) has the mean taken out of the result.
 *
 * Deterministic (fixed loops, no threads). It changes the iterates of CG, not its stopping test: the projection still
 * stops at the same residual tolerance.
 */
export interface MultigridOptions {
  /** Gauss-Seidel sweeps before and after each coarse correction. Default 2. */
  readonly sweeps?:number;
  /** Scale of the coarse correction. Default 1.6. */
  readonly overCorrection?:number;
  /** Largest coarsest level, cells. Default 64. */
  readonly coarsest?:number;
  /** Symmetric sweeps on the coarsest level. Default 20. */
  readonly coarseSweeps?:number;
}

interface Level {
  readonly nx:number;readonly ny:number;readonly nz:number;readonly n:number;
  /** Per cell, 6 neighbours (-1: none) and their coupling weights w (the matrix entry is -w); the diagonal. */
  readonly nb:Int32Array;readonly w:Float64Array;readonly diag:Float64Array;
  /** Cells of even and odd i + j + k, in index order. */
  readonly red:Int32Array;readonly black:Int32Array;
  readonly x:Float64Array;readonly b:Float64Array;readonly r:Float64Array;
  /** The coarse cell of each cell (to the next level). */
  readonly parent:Int32Array;
}

const build=(nx:number,ny:number,nz:number,nb:Int32Array,w:Float64Array,diag:Float64Array):Level=>{
  const n=nx*ny*nz,red:number[]=[],black:number[]=[];
  for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++)((i+j+k)&1?black:red).push(c);
  return {nx,ny,nz,n,nb,w,diag,red:Int32Array.from(red),black:Int32Array.from(black),x:new Float64Array(n),b:new Float64Array(n),r:new Float64Array(n),parent:new Int32Array(n)};
};

export class PoissonMultigrid {
  readonly levels:Level[]=[];
  readonly sweeps:number;readonly overCorrection:number;readonly coarseSweeps:number;readonly singular:boolean;
  /**
   * @param dims cells along x, y, z (index i + nx (j + ny k)).
   * @param nbr six neighbours per cell in the order -x, +x, -y, +y, -z, +z: a cell index, or a negative number for none.
   * @param diag the diagonal of A (the off-diagonal entries are -1 for each neighbour >= 0).
   */
  constructor(dims:readonly [number,number,number],nbr:Int32Array,diag:Float64Array,singular:boolean,options:MultigridOptions={}) {
    this.sweeps=options.sweeps??2;this.overCorrection=options.overCorrection??2;this.coarseSweeps=options.coarseSweeps??20;this.singular=singular;
    const coarsest=options.coarsest??64;
    let [nx,ny,nz]=dims;const n0=nx*ny*nz;
    const nb0=new Int32Array(6*n0),w0=new Float64Array(6*n0);
    for(let q=0;q<6*n0;q++){const m=nbr[q];if(m>=0&&m!==Math.floor(q/6)){nb0[q]=m;w0[q]=1;}else{nb0[q]=-1;w0[q]=0;}}
    let level=build(nx,ny,nz,nb0,w0,Float64Array.from(diag));this.levels.push(level);
    while(level.n>coarsest&&(nx>1||ny>1||nz>1)){
      const cx=Math.ceil(nx/2),cy=Math.ceil(ny/2),cz=Math.ceil(nz/2),cn=cx*cy*cz;
      const parent=level.parent;
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++)parent[c]=(i>>1)+cx*((j>>1)+cy*(k>>1));
      // Galerkin P^T A P: diagonal = sum of the block's diagonals less its internal couplings (each counted from both
      // ends); a coupling between two blocks adds to their coupling along the same direction.
      const cdiag=new Float64Array(cn),cnb=new Int32Array(6*cn).fill(-1),cw=new Float64Array(6*cn);
      for(let c=0;c<level.n;c++){
        const I=parent[c];cdiag[I]+=level.diag[c];
        for(let q=0;q<6;q++){
          const m=level.nb[6*c+q];if(m<0)continue;
          const J=parent[m],wt=level.w[6*c+q];
          if(J===I){cdiag[I]-=wt;continue;}
          const slot=6*I+q;
          if(cnb[slot]>=0&&cnb[slot]!==J)throw new Error('multigrid: a block couples to two blocks along one direction.');
          cnb[slot]=J;cw[slot]+=wt;
        }
      }
      nx=cx;ny=cy;nz=cz;
      level=build(nx,ny,nz,cnb,cw,cdiag);this.levels.push(level);
    }
  }
  /** Gauss-Seidel updates of the listed cells, in list order (step 1) or reverse (step -1). */
  private static sweep(L:Level,list:Int32Array,step:1|-1):void {
    const nb=L.nb,w=L.w,x=L.x,b=L.b,diag=L.diag,count=list.length;
    for(let q=step===1?0:count-1,e=step===1?count:-1;q!==e;q+=step){
      const c=list[q],d=diag[c];
      if(!(d>0))continue;
      const o=6*c;let s=b[c];
      let m=nb[o];if(m>=0)s+=w[o]*x[m];
      m=nb[o+1];if(m>=0)s+=w[o+1]*x[m];
      m=nb[o+2];if(m>=0)s+=w[o+2]*x[m];
      m=nb[o+3];if(m>=0)s+=w[o+3]*x[m];
      m=nb[o+4];if(m>=0)s+=w[o+4]*x[m];
      m=nb[o+5];if(m>=0)s+=w[o+5]*x[m];
      x[c]=s/d;
    }
  }
  private static forward(L:Level):void {PoissonMultigrid.sweep(L,L.red,1);PoissonMultigrid.sweep(L,L.black,1);}
  private static backward(L:Level):void {PoissonMultigrid.sweep(L,L.black,-1);PoissonMultigrid.sweep(L,L.red,-1);}
  private cycle(l:number):void {
    const L=this.levels[l];L.x.fill(0);
    if(l===this.levels.length-1){for(let s=0;s<this.coarseSweeps;s++){PoissonMultigrid.forward(L);PoissonMultigrid.backward(L);}return;}
    for(let s=0;s<this.sweeps;s++)PoissonMultigrid.forward(L);
    // Residual, restricted (P^T: the sum over each block).
    const C=this.levels[l+1],nb=L.nb,w=L.w,x=L.x,r=L.r,parent=L.parent;
    for(let c=0;c<L.n;c++){
      let s=L.b[c]-L.diag[c]*x[c];
      for(let q=0;q<6;q++){const m=nb[6*c+q];if(m>=0)s+=w[6*c+q]*x[m];}
      r[c]=s;
    }
    C.b.fill(0);for(let c=0;c<L.n;c++)C.b[parent[c]]+=r[c];
    this.cycle(l+1);
    const scale=this.overCorrection,xc=C.x;
    for(let c=0;c<L.n;c++)x[c]+=scale*xc[parent[c]];
    for(let s=0;s<this.sweeps;s++)PoissonMultigrid.backward(L);
  }
  /** z = M^-1 r: one V-cycle from zero. */
  apply(r:Float64Array,z:Float64Array):void {
    const L=this.levels[0];L.b.set(r.subarray(0,L.n));
    this.cycle(0);
    if(this.singular){let mean=0;for(let c=0;c<L.n;c++)mean+=L.x[c];mean/=L.n;for(let c=0;c<L.n;c++)z[c]=L.x[c]-mean;}
    else z.set(L.x);
  }
}
