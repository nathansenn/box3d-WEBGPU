/**
 * Sparse LDLᵀ factorization of a symmetric matrix with 3 x 3 node blocks: the preconditioner of the tetrahedral solid's
 * conjugate gradients when `linearSolver: 'ldl'` (solid.ts, solid-contact.ts).
 *
 * - **Ordering.** Minimum degree on the node graph by explicit elimination (ties to the lowest node index, so the order is
 *   deterministic), which also gives the structure of the factor: a node's column holds its neighbours at elimination time.
 *   Reverse Cuthill-McKee is formed too and kept when its factor is smaller (a long strip such as the press section; `ordering`).
 * - **Storage.** The lower triangle of the permuted matrix, column by column with the factor's structure, so the matrix is
 *   assembled straight into the factor's places and factored in place: `D` holds the diagonal, `values` the rest.
 * - **Factorization.** Left-looking, a node's three columns at a time (each earlier column that reaches the node is read once
 *   for all three); the substitutions also work by node. Every entry receives its updates in the column-by-column order, so
 *   the numbers are those of a column-by-column factorization to the bit. A pivot that is not clearly positive (an indefinite tangent: softening, a
 *   strongly distorted finite-strain element) is reset to the larger of its magnitude and the column's own diagonal, so the result
 *   is always a symmetric positive definite preconditioner; `modified` counts such pivots. (Raising the whole diagonal until no
 *   pivot needs resetting, Levenberg-Marquardt style, was tried: on the cracking V bend it took 15 times more inner iterations.) The conjugate gradients multiply by the true tangent, so this changes how fast they converge, never
 *   what they converge to.
 * - **Isolated unknowns** (a zero row and column, such as a node whose elements have all eroded) are pivoted on their own
 *   diagonal, which is exact for them however small it is, and do not count as reset pivots.
 * - **Constrained components** have unit rows: `fixed` components take no entries and solve to zero.
 * - **Plane sections:** a component constrained at every node (`planar`, the press brake's z) is skipped by the kernels, with
 *   the same numbers.
 *
 * Self-contained. See docs/SOLID_MECHANICS.md (Linear solver).
 */
/** Fractions of the diagonal added to an indefinite matrix, in turn. */
const SHIFTS=[0,1e-6,1e-4,1e-2,1] as const;

/** Explicit elimination in a given order: each node's neighbours at its elimination (its column's higher nodes). */
function eliminate(graph:readonly number[][],order:ArrayLike<number>):number[][] {
  const sets=graph.map(list=>new Set(list)),upper:number[][]=new Array(graph.length);
  for(let k=0;k<order.length;k++){
    const a=order[k],neighbours=Array.from(sets[a]);upper[a]=neighbours;
    for(const b of neighbours){const set=sets[b];set.delete(a);for(const c of neighbours)if(c!==b)set.add(c);}
    sets[a].clear();
  }
  return upper;
}
/** Reverse Cuthill-McKee: breadth first from a node of least degree (lowest index on a tie), neighbours by degree, then index;
 * each further component from its own least-degree node; the whole order reversed. */
function reverseCuthillMcKee(graph:readonly number[][]):Int32Array {
  const n=graph.length,seen=new Uint8Array(n),out=new Int32Array(n);let count=0;
  while(count<n){
    let start=-1;for(let a=0;a<n;a++)if(!seen[a]&&(start<0||graph[a].length<graph[start].length))start=a;
    seen[start]=1;out[count++]=start;
    for(let head=count-1;head<count;head++){
      const next=graph[out[head]].filter(b=>!seen[b]).sort((p,q)=>graph[p].length-graph[q].length||p-q);
      for(const b of next){seen[b]=1;out[count++]=b;}
    }
  }
  return out.reverse();
}

export class SparseLDL {
  /** The fill-reducing order in use: minimum degree, or reverse Cuthill-McKee where it fills less. */
  ordering:'minimum-degree'|'reverse-cuthill-mckee'='minimum-degree';
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
  /** The same lists as permuted dof indices: 3 x the elimination position of each higher neighbour. */
  private readonly upperRows:Int32Array;
  /** Row structure: for each permuted dof j the columns k < j with L(j, k) present and the index of that entry. */
  private readonly rowStart:Int32Array;private readonly rowColumn:Int32Array;private readonly rowEntry:Int32Array;
  private readonly work:Float64Array;private readonly work1:Float64Array;private readonly work2:Float64Array;private readonly scratch:Float64Array;
  private readonly fixed:Uint8Array;private readonly isolated:Uint8Array;

  /** `adjacency(node, visit)` calls `visit` for every node coupled to `node` (either order; duplicates and itself are ignored). */
  constructor(nodes:number,adjacency:(node:number,visit:(other:number)=>void)=>void){
    this.nodes=nodes;this.size=3*nodes;
    // Explicit elimination on the node graph: neighbour sets, minimum degree first.
    const sets:Set<number>[]=Array.from({length:nodes},()=>new Set<number>());
    for(let a=0;a<nodes;a++)adjacency(a,b=>{if(b!==a&&b>=0&&b<nodes){sets[a].add(b);sets[b].add(a);}});
    const graph:number[][]=sets.map(set=>Array.from(set).sort((p,q)=>p-q));
    let position=this.position=new Int32Array(nodes).fill(-1),order=this.order=new Int32Array(nodes);
    let upper:number[][]=new Array(nodes);
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
    // Reverse Cuthill-McKee as well: on a long strip (the press section) it fills less than minimum degree. The order with
    // the smaller factor is kept (minimum degree on a tie).
    let fillMD=0;for(let a=0;a<nodes;a++)fillMD+=upper[a].length;
    const rcm=reverseCuthillMcKee(graph),rcmUpper=eliminate(graph,rcm);let fillRCM=0;for(let a=0;a<nodes;a++)fillRCM+=rcmUpper[a].length;
    if(fillRCM<fillMD){
      upper=rcmUpper;order.set(rcm);for(let k=0;k<nodes;k++)position[order[k]]=k;this.ordering='reverse-cuthill-mckee';
    }
    // Column structure: per node column, its higher neighbours sorted by elimination position.
    const upperStart=this.upperStart=new Int32Array(nodes+1);
    for(let a=0;a<nodes;a++){upper[a].sort((p,q)=>position[p]-position[q]);upperStart[a+1]=upperStart[a]+upper[a].length;}
    const upperNodes=this.upperNodes=new Int32Array(upperStart[nodes]);
    for(let a=0;a<nodes;a++)upperNodes.set(upper[a],upperStart[a]);
    const upperRows=this.upperRows=new Int32Array(upperNodes.length);for(let k=0;k<upperNodes.length;k++)upperRows[k]=3*position[upperNodes[k]];
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
    this.D=new Float64Array(this.size);this.work=new Float64Array(this.size);this.work1=new Float64Array(this.size);this.work2=new Float64Array(this.size);this.scratch=new Float64Array(this.size);
    this.fixed=new Uint8Array(this.size);this.isolated=new Uint8Array(this.size);
  }
  /** Entries of the factor (strictly below the diagonal). */
  get entries():number {return this.rows.length;}
  /** Clears the matrix and takes the constrained components (1 = constrained, original dof numbering). */
  begin(fixed:Uint8Array):void {
    this.values.fill(0);this.D.fill(0);
    for(let a=0;a<this.nodes;a++){const s=3*this.position[a];for(let p=0;p<3;p++)this.fixed[s+p]=fixed[3*a+p];}
    // A component constrained at every node (a plane-strain section) has zero rows and columns throughout: the kernels then
    // skip it (planar), with the same numbers, since every entry it would touch is zero or set to zero.
    this.planar=-1;
    for(let c=2;c>=0&&this.planar<0;c--){let all=this.nodes>0;for(let s=0;s<this.nodes&&all;s++)if(!this.fixed[3*s+c])all=false;if(all)this.planar=c;}
  }
  /** The component constrained at every node (0, 1 or 2), or -1: the kernels skip it. */
  planar=-1;
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
    this.findIsolated();
    for(let k=0;k<SHIFTS.length;k++){
      if(k>0){this.values.set(this.saved);const s=1+SHIFTS[k];for(let j=0;j<this.size;j++)this.D[j]=this.savedD[j]*s;}
      this.shift=SHIFTS[k];this.factorOnce();
      if(this.modified===0)break;
    }
  }
  /** Free unknowns of the last factorization whose row and column of the assembled matrix are zero (`isolatedUnknowns`). */
  isolatedUnknowns=0;
  /** Marks the free unknowns whose row and column of the assembled matrix are zero: an unknown coupled to nothing, such as a
   * node whose elements have all eroded and that keeps only its lumped mass. Elimination never reaches it (its row and column
   * of the factor stay zero), so its own diagonal is its exact pivot, however small: factorOnce takes it as it is and does not
   * count it as a reset pivot. (Resetting it, as an indefinite pivot is reset, sent every factorization with such an unknown
   * through all the shifts to a doubled diagonal.) */
  private findIsolated():void {
    const n=this.size,values=this.values,cs=this.columnStart,rs=this.rowStart,re=this.rowEntry,fixed=this.fixed,iso=this.isolated;let count=0;
    for(let j=0;j<n;j++){
      iso[j]=0;if(fixed[j])continue;
      let empty=true;
      for(let e=cs[j];e<cs[j+1]&&empty;e++)if(values[e]!==0)empty=false;
      for(let r=rs[j];r<rs[j+1]&&empty;r++)if(values[re[r]]!==0)empty=false;
      if(empty){iso[j]=1;count++;}
    }
    this.isolatedUnknowns=count;
  }
  /** Fraction of its own diagonal the last factorization added (0 for a positive definite matrix). */
  shift=0;
  private saved=new Float64Array(0);private savedD=new Float64Array(0);
  /** One left-looking factorization of the assembled matrix in place, a node's three columns at a time: each earlier column
   * that reaches the node is read once for all three (x0, x1, x2 gather them). Every entry and pivot receives its updates in
   * the same order as a column-by-column factorization gives them (earlier columns first, in order), so the factor is the
   * same to the bit. */
  private factorOnce():void {
    if(this.planar>=0){this.factorPlanar(this.planar);return;}
    const N=this.nodes,D=this.D,values=this.values,rows=this.rows,cs=this.columnStart,fixed=this.fixed;
    const rs=this.rowStart,rc=this.rowColumn,re=this.rowEntry,iso=this.isolated,x0=this.work,x1=this.work1,x2=this.work2;let modified=0,largest=0;
    for(let j=0;j<this.size;j++)if(!fixed[j])largest=Math.max(largest,Math.abs(D[j]));
    const tiny=1e-12*largest||1;
    // A pivot that is not clearly positive is reset to the larger of its magnitude and the column's own diagonal, so the
    // result is positive definite whatever the matrix. An isolated unknown keeps its own diagonal (findIsolated).
    const pivot=(j:number,d:number,diagonal:number):number=>{
      if(iso[j]){if(!(d>0))d=Math.max(Math.abs(d),tiny);}
      else if(!(d>1e-6*Math.abs(diagonal))||!(d>tiny)){d=Math.max(Math.abs(d),Math.abs(diagonal),tiny);modified++;}
      return d;
    };
    for(let s=0;s<N;s++){
      const j0=3*s,j1=j0+1,j2=j0+2,a0=!fixed[j0],a1=!fixed[j1],a2=!fixed[j2],c0=cs[j0],c1=cs[j1],c2=cs[j2],end=cs[j2+1];
      const diag0=D[j0],diag1=D[j1],diag2=D[j2];let d0=diag0,d1=diag1,d2=diag2;
      if(a0)for(let e=c0;e<c1;e++)x0[rows[e]]=values[e];
      if(a1)for(let e=c1;e<c2;e++)x1[rows[e]]=values[e];
      if(a2)for(let e=c2;e<end;e++)x2[rows[e]]=values[e];
      // Earlier columns: rows j0, j1, j2 of a column are consecutive, and the rows after them are the node's higher rows.
      for(let r=rs[j0];r<rs[j1];r++){
        const k=rc[r],entry=re[r],stop=cs[k+1],Dk=D[k];
        const l0=a0?values[entry]:0,l1=a1?values[entry+1]:0,l2=a2?values[entry+2]:0;
        let f0=0,f1=0,f2=0;
        if(l0!==0){f0=l0*Dk;d0-=l0*f0;x0[j1]-=values[entry+1]*f0;x0[j2]-=values[entry+2]*f0;}
        if(l1!==0){f1=l1*Dk;d1-=l1*f1;x1[j2]-=values[entry+2]*f1;}
        if(l2!==0){f2=l2*Dk;d2-=l2*f2;}
        if(l0!==0&&l1!==0&&l2!==0){
          for(let e=entry+3;e<stop;e++){const i=rows[e],v=values[e];x0[i]-=v*f0;x1[i]-=v*f1;x2[i]-=v*f2;}
        }else{
          if(l0!==0)for(let e=entry+3;e<stop;e++)x0[rows[e]]-=values[e]*f0;
          if(l1!==0)for(let e=entry+3;e<stop;e++)x1[rows[e]]-=values[e]*f1;
          if(l2!==0)for(let e=entry+3;e<stop;e++)x2[rows[e]]-=values[e]*f2;
        }
      }
      // Column j0, then its updates of j1 and j2; column j1, then its update of j2; column j2.
      if(!a0){D[j0]=1;for(let e=c0;e<c1;e++)values[e]=0;}
      else{d0=pivot(j0,d0,diag0);D[j0]=d0;const inv=1/d0;for(let e=c0;e<c1;e++){const i=rows[e];values[e]=x0[i]*inv;x0[i]=0;}}
      {
        const l1=a1?values[c0]:0,l2=a2?values[c0+1]:0,Dk=D[j0];
        if(l1!==0){const f=l1*Dk;d1-=l1*f;x1[j2]-=values[c0+1]*f;for(let e=c0+2;e<c1;e++)x1[rows[e]]-=values[e]*f;}
        if(l2!==0){const f=l2*Dk;d2-=l2*f;for(let e=c0+2;e<c1;e++)x2[rows[e]]-=values[e]*f;}
      }
      if(!a1){D[j1]=1;for(let e=c1;e<c2;e++)values[e]=0;}
      else{d1=pivot(j1,d1,diag1);D[j1]=d1;const inv=1/d1;for(let e=c1;e<c2;e++){const i=rows[e];values[e]=x1[i]*inv;x1[i]=0;}}
      {
        const l2=a2?values[c1]:0;
        if(l2!==0){const f=l2*D[j1];d2-=l2*f;for(let e=c1+1;e<c2;e++)x2[rows[e]]-=values[e]*f;}
      }
      if(!a2){D[j2]=1;for(let e=c2;e<end;e++)values[e]=0;}
      else{d2=pivot(j2,d2,diag2);D[j2]=d2;const inv=1/d2;for(let e=c2;e<end;e++){const i=rows[e];values[e]=x2[i]*inv;x2[i]=0;}}
    }
    this.modified=modified;
  }
  /** factorOnce for a component c constrained at every node: the same operations on the two free components a < b, without
   * the updates of c's rows, which are zero and stay zero (and are set to zero at the end of the pass, as factorOnce leaves them). */
  private factorPlanar(c:number):void {
    const N=this.nodes,D=this.D,values=this.values,rows=this.rows,cs=this.columnStart,fixed=this.fixed;
    const rs=this.rowStart,rc=this.rowColumn,re=this.rowEntry,iso=this.isolated,xa=this.work,xb=this.work1;let modified=0,largest=0;
    const a=c===0?1:0,b=c===2?1:2;
    for(let j=0;j<this.size;j++)if(!fixed[j])largest=Math.max(largest,Math.abs(D[j]));
    const tiny=1e-12*largest||1;
    const pivot=(j:number,d:number,diagonal:number):number=>{
      if(iso[j]){if(!(d>0))d=Math.max(Math.abs(d),tiny);}
      else if(!(d>1e-6*Math.abs(diagonal))||!(d>tiny)){d=Math.max(Math.abs(d),Math.abs(diagonal),tiny);modified++;}
      return d;
    };
    for(let s=0;s<N;s++){
      const j0=3*s,ja=j0+a,jb=j0+b,jc=j0+c,aa=!fixed[ja],ab=!fixed[jb],ca=cs[ja],cb=cs[jb],cEnd=cs[ja+1],bEnd=cs[jb+1];
      const diagA=D[ja],diagB=D[jb];let da=diagA,db=diagB;
      if(aa)for(let e=ca;e<cEnd;e++)xa[rows[e]]=values[e];
      if(ab)for(let e=cb;e<bEnd;e++)xb[rows[e]]=values[e];
      // Row jb in column ja: offset b - a - 1 among ja's intra rows.
      const abOff=b-a-1;
      for(let r=rs[j0];r<rs[j0+1];r++){
        const k=rc[r],entry=re[r],stop=cs[k+1],Dk=D[k];
        const la=aa?values[entry+a]:0,lb=ab?values[entry+b]:0;
        if(la===0&&lb===0)continue;
        let fa=0,fb=0;
        if(la!==0){fa=la*Dk;da-=la*fa;if(b>a)xa[jb]-=values[entry+b]*fa;}
        if(lb!==0){fb=lb*Dk;db-=lb*fb;}
        if(la!==0&&lb!==0){
          for(let e=entry+3;e<stop;e+=3){const t=rows[e],va=values[e+a],vb=values[e+b];xa[t+a]-=va*fa;xb[t+a]-=va*fb;xa[t+b]-=vb*fa;xb[t+b]-=vb*fb;}
        }else if(la!==0){
          for(let e=entry+3;e<stop;e+=3){const t=rows[e];xa[t+a]-=values[e+a]*fa;xa[t+b]-=values[e+b]*fa;}
        }else{
          for(let e=entry+3;e<stop;e+=3){const t=rows[e];xb[t+a]-=values[e+a]*fb;xb[t+b]-=values[e+b]*fb;}
        }
      }
      // Column ja, its update of jb; column jb; column jc (constrained).
      if(!aa){D[ja]=1;for(let e=ca;e<cEnd;e++)values[e]=0;}
      else{da=pivot(ja,da,diagA);D[ja]=da;const inv=1/da;for(let e=ca;e<cEnd;e++){const i=rows[e];values[e]=xa[i]*inv;xa[i]=0;}}
      {
        const lb=ab?values[ca+abOff]:0;
        if(lb!==0){
          const f=lb*D[ja];db-=lb*f;
          // Rows of column ja after jb: its remaining intra rows (c, when c > b) and the higher nodes' rows.
          const first=ca+(2-a);
          for(let e=first;e<cEnd;e+=3){const t=rows[e];xb[t+a]-=values[e+a]*f;xb[t+b]-=values[e+b]*f;}
        }
      }
      if(!ab){D[jb]=1;for(let e=cb;e<bEnd;e++)values[e]=0;}
      else{db=pivot(jb,db,diagB);D[jb]=db;const inv=1/db;for(let e=cb;e<bEnd;e++){const i=rows[e];values[e]=xb[i]*inv;xb[i]=0;}}
      D[jc]=1;for(let e=cs[jc];e<cs[jc+1];e++)values[e]=0;
    }
    this.modified=modified;
  }
  /** solve for a component c constrained at every node: the same operations on the two free components. */
  private solvePlanar(r:ArrayLike<number>,z:Float64Array,c:number):void {
    const N=this.nodes,y=this.scratch,L=this.values,cs=this.columnStart,D=this.D,order=this.order,fixed=this.fixed,us=this.upperStart,up=this.upperRows;
    const a=c===0?1:0,b=c===2?1:2,abOff=b-a-1;
    for(let s=0;s<N;s++){const o=3*order[s];y[3*s]=r[o];y[3*s+1]=r[o+1];y[3*s+2]=r[o+2];}
    for(let s=0;s<N;s++){
      const j=3*s,ja=j+a,jb=j+b,o=order[s],k0=us[o],k1=us[o+1];
      if(fixed[ja])y[ja]=0;const va=y[ja];
      if(va!==0)y[jb]-=L[cs[ja]+abOff]*va;
      if(fixed[jb])y[jb]=0;const vb=y[jb];
      y[j+c]=0;
      let ea=cs[ja]+(2-a)+a,eb=cs[jb]+(2-b)+a;const db=b-a;
      if(va!==0&&vb!==0){
        for(let k=k0;k<k1;k++,ea+=3,eb+=3){const t=up[k];y[t+a]=y[t+a]-L[ea]*va-L[eb]*vb;y[t+b]=y[t+b]-L[ea+db]*va-L[eb+db]*vb;}
      }else if(va!==0){
        for(let k=k0;k<k1;k++,ea+=3){const t=up[k];y[t+a]-=L[ea]*va;y[t+b]-=L[ea+db]*va;}
      }else if(vb!==0){
        for(let k=k0;k<k1;k++,eb+=3){const t=up[k];y[t+a]-=L[eb]*vb;y[t+b]-=L[eb+db]*vb;}
      }
    }
    for(let j=0;j<this.size;j++)y[j]/=D[j];
    for(let s=N-1;s>=0;s--){
      const j=3*s,ja=j+a,jb=j+b,o=order[s],k0=us[o],k1=us[o+1],db=b-a;
      let e=cs[jb]+(2-b)+a,v=y[jb];
      for(let k=k0;k<k1;k++,e+=3){const t=up[k];v-=L[e]*y[t+a];v-=L[e+db]*y[t+b];}
      y[jb]=fixed[jb]?0:v;
      e=cs[ja];v=y[ja];v-=L[e+abOff]*y[jb];e+=(2-a)+a;
      for(let k=k0;k<k1;k++,e+=3){const t=up[k];v-=L[e]*y[t+a];v-=L[e+db]*y[t+b];}
      y[ja]=fixed[ja]?0:v;
      y[j+c]=0;
    }
    for(let s=0;s<N;s++){const o=3*order[s];z[o]=y[3*s];z[o+1]=y[3*s+1];z[o+2]=y[3*s+2];}
  }
  /** z = (L D L^T)^-1 r, original dof numbering. r and z may be the same array. Node-blocked: a node's three columns share
   * their rows of each higher neighbour (`upperRows`), so one index serves nine entries. Every entry of y receives its
   * updates in the same order as a column-by-column substitution would give them, so the result is the same to the bit. */
  solve(r:ArrayLike<number>,z:Float64Array):void {
    if(this.planar>=0){this.solvePlanar(r,z,this.planar);return;}
    const N=this.nodes,y=this.scratch,L=this.values,cs=this.columnStart,D=this.D,order=this.order,fixed=this.fixed,us=this.upperStart,up=this.upperRows;
    for(let s=0;s<N;s++){const a=3*order[s];y[3*s]=r[a];y[3*s+1]=r[a+1];y[3*s+2]=r[a+2];}
    // Forward: L y = r, the three columns of a node at once.
    for(let s=0;s<N;s++){
      const j=3*s,a=order[s],k0=us[a],k1=us[a+1];
      if(fixed[j])y[j]=0;const v0=y[j];let e0=cs[j];
      if(v0!==0){y[j+1]-=L[e0]*v0;y[j+2]-=L[e0+1]*v0;}
      e0+=2;
      if(fixed[j+1])y[j+1]=0;const v1=y[j+1];let e1=cs[j+1];
      if(v1!==0)y[j+2]-=L[e1]*v1;
      e1++;
      if(fixed[j+2])y[j+2]=0;const v2=y[j+2];let e2=cs[j+2];
      if(k0===k1)continue;
      if(v0!==0&&v1!==0&&v2!==0){
        for(let k=k0;k<k1;k++,e0+=3,e1+=3,e2+=3){
          const t=up[k];
          y[t]=y[t]-L[e0]*v0-L[e1]*v1-L[e2]*v2;
          y[t+1]=y[t+1]-L[e0+1]*v0-L[e1+1]*v1-L[e2+1]*v2;
          y[t+2]=y[t+2]-L[e0+2]*v0-L[e1+2]*v1-L[e2+2]*v2;
        }
      }else{
        // A zero value adds nothing (and is skipped, as a column-by-column substitution skips it).
        if(v0!==0)for(let k=k0;k<k1;k++,e0+=3){const t=up[k];y[t]-=L[e0]*v0;y[t+1]-=L[e0+1]*v0;y[t+2]-=L[e0+2]*v0;}
        if(v1!==0)for(let k=k0;k<k1;k++,e1+=3){const t=up[k];y[t]-=L[e1]*v1;y[t+1]-=L[e1+1]*v1;y[t+2]-=L[e1+2]*v1;}
        if(v2!==0)for(let k=k0;k<k1;k++,e2+=3){const t=up[k];y[t]-=L[e2]*v2;y[t+1]-=L[e2+1]*v2;y[t+2]-=L[e2+2]*v2;}
      }
    }
    for(let j=0;j<this.size;j++)y[j]/=D[j];
    // Backward: L^T z = y, column by column (each sum in the order of its column's rows).
    for(let s=N-1;s>=0;s--){
      const j=3*s,a=order[s],k0=us[a],k1=us[a+1];
      let e=cs[j+2],v=y[j+2];
      for(let k=k0;k<k1;k++,e+=3){const t=up[k];v-=L[e]*y[t];v-=L[e+1]*y[t+1];v-=L[e+2]*y[t+2];}
      y[j+2]=fixed[j+2]?0:v;
      e=cs[j+1];v=y[j+1];v-=L[e]*y[j+2];e++;
      for(let k=k0;k<k1;k++,e+=3){const t=up[k];v-=L[e]*y[t];v-=L[e+1]*y[t+1];v-=L[e+2]*y[t+2];}
      y[j+1]=fixed[j+1]?0:v;
      e=cs[j];v=y[j];v-=L[e]*y[j+1];v-=L[e+1]*y[j+2];e+=2;
      for(let k=k0;k<k1;k++,e+=3){const t=up[k];v-=L[e]*y[t];v-=L[e+1]*y[t+1];v-=L[e+2]*y[t+2];}
      y[j]=fixed[j]?0:v;
    }
    for(let s=0;s<N;s++){const a=3*order[s];z[a]=y[3*s];z[a+1]=y[3*s+1];z[a+2]=y[3*s+2];}
  }
}
