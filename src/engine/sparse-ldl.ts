/**
 * Sparse LDLᵀ factorization of a symmetric matrix with 3 x 3 node blocks: the preconditioner of the tetrahedral solid's
 * conjugate gradients when `linearSolver: 'ldl'` (solid.ts, solid-contact.ts).
 *
 * - **Ordering.** Minimum degree on the node graph by explicit elimination (ties to the lowest node index, so the order is
 *   deterministic), which also gives the structure of the factor: a node's column holds its neighbours at elimination time.
 * - **Storage.** The lower triangle of the permuted matrix, column by column with the factor's structure, so the matrix is
 *   assembled straight into the factor's places and factored in place: `D` holds the diagonal, `values` the rest.
 * - **Factorization.** Left-looking, column by column. A pivot that is not clearly positive (an indefinite tangent: softening, a
 *   strongly distorted finite-strain element) is reset to the larger of its magnitude and the column's own diagonal, so the result
 *   is always a symmetric positive definite preconditioner; `modified` counts such pivots. (Raising the whole diagonal until no
 *   pivot needs resetting, Levenberg-Marquardt style, was tried: on the cracking V bend it took 15 times more inner iterations.) The conjugate gradients multiply by the true tangent, so this changes how fast they converge, never
 *   what they converge to.
 * - **Constrained components** have unit rows: `fixed` components take no entries and solve to zero.
 *
 * Self-contained. See docs/SOLID_MECHANICS.md (Linear solver).
 */
/** Fractions of the diagonal added to an indefinite matrix, in turn. */
const SHIFTS=[0,1e-6,1e-4,1e-2,1] as const;

export class SparseLDL {
  /** Number of nodes and of unknowns (3 per node). */
  readonly nodes:number;readonly size:number;
  /** Elimination position of each node, and the node at each position. */
  readonly position:Int32Array;readonly order:Int32Array;
  /** Column pointers into `rows` / `values` (dof columns in elimination order), row indices (permuted dofs), values. */
  readonly columnStart:Int32Array;readonly rows:Int32Array;readonly values:Float64Array;
  /** Diagonal D (permuted). */
  readonly D:Float64Array;
  /** Pivots changed to keep the preconditioner positive definite in the last factorization. */
  modified=0;
  /** Higher neighbours of each node column (in elimination order) and where its rows start: node a's column (dof p) has its
   * rows of node b at columnStart[3 pos(a) + p] + (2 - p) + 3 k, k the index of b in a's list. */
  private readonly upperStart:Int32Array;private readonly upperNodes:Int32Array;
  /** Row structure: for each permuted dof j the columns k < j with L(j, k) present and the index of that entry. */
  private readonly rowStart:Int32Array;private readonly rowColumn:Int32Array;private readonly rowEntry:Int32Array;
  private readonly work:Float64Array;private readonly scratch:Float64Array;
  private readonly fixed:Uint8Array;

  /** `adjacency(node, visit)` calls `visit` for every node coupled to `node` (either order; duplicates and itself are ignored). */
  constructor(nodes:number,adjacency:(node:number,visit:(other:number)=>void)=>void){
    this.nodes=nodes;this.size=3*nodes;
    // Explicit elimination on the node graph: neighbour sets, minimum degree first.
    const sets:Set<number>[]=Array.from({length:nodes},()=>new Set<number>());
    for(let a=0;a<nodes;a++)adjacency(a,b=>{if(b!==a&&b>=0&&b<nodes){sets[a].add(b);sets[b].add(a);}});
    const position=this.position=new Int32Array(nodes).fill(-1),order=this.order=new Int32Array(nodes);
    const upper:number[][]=new Array(nodes);
    // Buckets of nodes by degree, scanned from the lowest; the lowest node index wins a tie.
    const degree=new Int32Array(nodes);let maxDegree=0;
    for(let a=0;a<nodes;a++){degree[a]=sets[a].size;if(degree[a]>maxDegree)maxDegree=degree[a];}
    const done=new Uint8Array(nodes);
    for(let step=0;step<nodes;step++){
      let best=-1,bestDegree=Infinity;
      for(let a=0;a<nodes;a++)if(!done[a]&&degree[a]<bestDegree){best=a;bestDegree=degree[a];if(bestDegree===0)break;}
      const a=best;done[a]=1;position[a]=step;order[step]=a;
      const neighbours=Array.from(sets[a]);upper[a]=neighbours;
      for(const b of neighbours){
        const s=sets[b];s.delete(a);
        for(const c of neighbours)if(c!==b)s.add(c);
        degree[b]=s.size;
      }
      sets[a].clear();
    }
    // Column structure: per node column, its higher neighbours sorted by elimination position.
    const upperStart=this.upperStart=new Int32Array(nodes+1);
    for(let a=0;a<nodes;a++){upper[a].sort((p,q)=>position[p]-position[q]);upperStart[a+1]=upperStart[a]+upper[a].length;}
    const upperNodes=this.upperNodes=new Int32Array(upperStart[nodes]);
    for(let a=0;a<nodes;a++)upperNodes.set(upper[a],upperStart[a]);
    const columnStart=this.columnStart=new Int32Array(this.size+1);
    for(let s=0;s<nodes;s++){const a=order[s],h=upper[a].length;for(let p=0;p<3;p++)columnStart[3*s+p+1]=columnStart[3*s+p]+(2-p)+3*h;}
    const nnz=columnStart[this.size],rows=this.rows=new Int32Array(nnz);this.values=new Float64Array(nnz);
    const rowCount=new Int32Array(this.size+1);
    for(let s=0;s<nodes;s++){
      const a=order[s];
      for(let p=0;p<3;p++){
        let o=columnStart[3*s+p];
        for(let q=p+1;q<3;q++)rows[o++]=3*s+q;
        for(const b of upper[a]){const t=3*position[b];rows[o++]=t;rows[o++]=t+1;rows[o++]=t+2;}
      }
    }
    for(let k=0;k<nnz;k++)rowCount[rows[k]+1]++;
    const rowStart=this.rowStart=new Int32Array(this.size+1);
    for(let j=0;j<this.size;j++)rowStart[j+1]=rowStart[j]+rowCount[j+1];
    const fill=rowStart.slice(0,this.size),rowColumn=this.rowColumn=new Int32Array(nnz),rowEntry=this.rowEntry=new Int32Array(nnz);
    for(let k=0;k<this.size;k++)for(let e=columnStart[k];e<columnStart[k+1];e++){const j=rows[e],o=fill[j]++;rowColumn[o]=k;rowEntry[o]=e;}
    this.D=new Float64Array(this.size);this.work=new Float64Array(this.size);this.scratch=new Float64Array(this.size);
    this.fixed=new Uint8Array(this.size);
  }
  /** Entries of the factor (strictly below the diagonal). */
  get entries():number {return this.rows.length;}
  /** Clears the matrix and takes the constrained components (1 = constrained, original dof numbering). */
  begin(fixed:Uint8Array):void {
    this.values.fill(0);this.D.fill(0);
    for(let a=0;a<this.nodes;a++){const s=3*this.position[a];for(let p=0;p<3;p++)this.fixed[s+p]=fixed[3*a+p];}
  }
  /** Index of node b's rows in node a's column (dof 0), or -1 when b is not a higher neighbour of a. */
  private find(a:number,b:number):number {
    const lo0=this.upperStart[a],target=this.position[b];let lo=lo0,hi=this.upperStart[a+1]-1;
    while(lo<=hi){const mid=(lo+hi)>>1,v=this.position[this.upperNodes[mid]];if(v===target)return this.columnStart[3*this.position[a]]+2+3*(mid-lo0);if(v<target)lo=mid+1;else hi=mid-1;}
    return -1;
  }
  /** Adds the 3 x 3 block M[3p + q] = d^2 E / (d u_{a,p} d u_{b,q}) for a node pair. Give each unordered pair of different
   * nodes once (either order) and each node's own block once. */
  addBlock(a:number,b:number,M:ArrayLike<number>,offset=0):void {
    const fixed=this.fixed,values=this.values;
    if(a===b){
      const s=3*this.position[a];
      for(let p=0;p<3;p++){
        if(fixed[s+p])continue;
        this.D[s+p]+=M[offset+4*p];
        const o=this.columnStart[s+p];
        for(let q=p+1;q<3;q++)if(!fixed[s+q])values[o+q-p-1]+=M[offset+3*p+q];
      }
      return;
    }
    let lowCol=a,high=b,transposed=false;
    if(this.position[a]>this.position[b]){lowCol=b;high=a;transposed=true;}
    const base=this.find(lowCol,high);if(base<0)throw new Error('SparseLDL: the pair is not in the structure.');
    const s=3*this.position[lowCol],t=3*this.position[high];
    for(let p=0;p<3;p++){
      if(fixed[s+p])continue;
      const o=base+(this.columnStart[s+p]-this.columnStart[s])-p;
      for(let q=0;q<3;q++){if(fixed[t+q])continue;values[o+q]+=transposed?M[offset+3*q+p]:M[offset+3*p+q];}
    }
  }
  /** Adds `value` to the diagonal of every unknown of `node` (a lumped mass term). */
  addDiagonal(node:number,value:number):void {const s=3*this.position[node];for(let p=0;p<3;p++)if(!this.fixed[s+p])this.D[s+p]+=value;}
  /** Adds a full 3 x 3 node block of the original numbering to node a's own block (both triangles given). */
  addNodeBlock(node:number,M:ArrayLike<number>,offset=0):void {this.addBlock(node,node,M,offset);}
  /** Factors the assembled matrix. When it is not positive definite (an indefinite tangent: softening, a strongly distorted
   * finite-strain element), its diagonal is raised by a growing fraction `shift` of itself (1e-6, 1e-4, 1e-2, 1) until no pivot needs
   * resetting, as a Levenberg-Marquardt step does; the last attempt keeps whatever pivots it has to reset. The assembled matrix is
   * kept, so the shifted attempts need no new assembly. */
  factor():void {
    if(this.saved.length!==this.values.length){this.saved=new Float64Array(this.values.length);this.savedD=new Float64Array(this.size);}
    this.saved.set(this.values);this.savedD.set(this.D);
    for(let k=0;k<SHIFTS.length;k++){
      if(k>0){this.values.set(this.saved);const s=1+SHIFTS[k];for(let j=0;j<this.size;j++)this.D[j]=this.savedD[j]*s;}
      this.shift=SHIFTS[k];this.factorOnce();
      if(this.modified===0)break;
    }
  }
  /** Fraction of its own diagonal the last factorization added (0 for a positive definite matrix). */
  shift=0;
  private saved=new Float64Array(0);private savedD=new Float64Array(0);
  private factorOnce():void {
    const n=this.size,D=this.D,values=this.values,rows=this.rows,cs=this.columnStart,x=this.work,fixed=this.fixed;
    const rs=this.rowStart,rc=this.rowColumn,re=this.rowEntry;let modified=0,largest=0;
    for(let j=0;j<n;j++)if(!fixed[j])largest=Math.max(largest,Math.abs(D[j]));
    const tiny=1e-12*largest||1;
    for(let j=0;j<n;j++){
      if(fixed[j]){D[j]=1;for(let e=cs[j];e<cs[j+1];e++)values[e]=0;continue;}
      const start=cs[j],end=cs[j+1],diagonal=D[j];
      for(let e=start;e<end;e++)x[rows[e]]=values[e];
      let d=diagonal;
      for(let r=rs[j];r<rs[j+1];r++){
        const k=rc[r],entry=re[r],ljk=values[entry];if(ljk===0)continue;
        const f=ljk*D[k];d-=ljk*f;
        for(let e=entry+1;e<cs[k+1];e++)x[rows[e]]-=values[e]*f;
      }
      // A pivot that is not clearly positive is reset to the larger of its magnitude and the column's own diagonal, so the
      // result is positive definite whatever the matrix.
      if(!(d>1e-6*Math.abs(diagonal))||!(d>tiny)){d=Math.max(Math.abs(d),Math.abs(diagonal),tiny);modified++;}
      D[j]=d;const inv=1/d;
      for(let e=start;e<end;e++){const i=rows[e];values[e]=x[i]*inv;x[i]=0;}
    }
    this.modified=modified;
  }
  /** z = (L D L^T)^-1 r, original dof numbering. r and z may be the same array. */
  solve(r:ArrayLike<number>,z:Float64Array):void {
    const n=this.size,y=this.scratch,values=this.values,rows=this.rows,cs=this.columnStart,D=this.D,order=this.order,fixed=this.fixed;
    for(let s=0;s<this.nodes;s++){const a=3*order[s];y[3*s]=r[a];y[3*s+1]=r[a+1];y[3*s+2]=r[a+2];}
    for(let j=0;j<n;j++){if(fixed[j])y[j]=0;const v=y[j];if(v!==0)for(let e=cs[j];e<cs[j+1];e++)y[rows[e]]-=values[e]*v;}
    for(let j=0;j<n;j++)y[j]/=D[j];
    for(let j=n-1;j>=0;j--){let v=y[j];for(let e=cs[j];e<cs[j+1];e++)v-=values[e]*y[rows[e]];y[j]=fixed[j]?0:v;}
    for(let s=0;s<this.nodes;s++){const a=3*order[s];z[a]=y[3*s];z[a+1]=y[3*s+1];z[a+2]=y[3*s+2];}
  }
}
