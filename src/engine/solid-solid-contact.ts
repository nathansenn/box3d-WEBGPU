/**
 * Contact and friction between deformable solids (solid.ts), and of a solid with itself.
 *
 * `SolidSolidContact` advances several `SolidBody` meshes by backward Euler in one Newton solve. One step minimises
 *
 *     Phi = sum_bodies [ W(u) - f_ext.u + sum m |u - u_free|^2 / (2 h^2) ]      each solid's own step
 *         + sum_contacts k <-gap>^2 / 2                                         one-sided springs
 *         + sum_contacts friction(|slip|)                                       a stick spring capped at mu N
 *
 * over the nodal displacements of all the bodies. Every contact is one row gap = n . sum_m w_m x_m over a few nodes m of
 * the two bodies, with weights w that sum to zero, frozen with the normal n for the step: the energy is a function of
 * the displacements alone, its tangent is symmetric and the contact forces sum to zero exactly.
 *
 * - `method: 'mortar'` (default): a segment-to-segment mortar integral after Puso, Laursen and Solberg (ECCOMAS 2004,
 *   eqs. 3, 4, 6; UCRL-JRNL-203338): each boundary triangle of body A is intersected with the triangles of body B
 *   projected onto its plane, the overlap is cut into triangles and integrated exactly (three-point rule), and every
 *   surface node a of A gets the row g_a = n_a . (sum_c (n_ac / W_a) x_c - sum_b (n_ab / W_a) x_b), c the nodes of A,
 *   b those of B, n_ab = integral of N_a N_b over the overlap, W_a = integral of N_a, n_a the mean normal of the overlap
 *   (from B into A). The pressure is then a field over the surface, and a uniform one passes the contact patch test on
 *   meshes that do not match. The row's stiffness is k W_a; its friction state is kept per node as before.
 * - `method: 'node-face'`: each surface node against the closest point of a triangle of the other body (version 1).
 *
 * Every pair of bodies is searched both ways. With `edges` (default with the mortar), sharp convex edges of the two
 * surfaces that cross get a point contact along the common normal of the two edges. Fixed planes act on the nodes in the
 * same solve. Friction is the capped stick spring of solid-contact.ts with the limit mu N taken from the previous pass.
 * Candidates come from a spatial hash of the other body's triangles (and edges), rebuilt every step.
 *
 * SI units, float64. See docs/SOLID_CONTACT.md (Deformable against deformable) for the validation and the limits.
 */
import {EngineError} from './contracts.ts';
import {captureFields,checkpointError,restoreFields,type FieldHandler,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {SolidBody,type SolidKernel} from './solid.ts';
import type {Subsystem} from './simulation.ts';

/** The solver id of the default (mortar) method recorded in results and checkpoints: segment-to-segment mortar penalty
 * contact with edge-to-edge contact, solved with the solids in one Newton solve (PCG), float64. */
export const SOLID_SOLID_CONTACT_SOLVER_ID='solid-solid-contact-mortar-penalty-newton-pcg-js-f64-v2';
/** The solver id of `method: 'node-face'`: node-to-face penalty contact (the first version). */
export const SOLID_SOLID_CONTACT_NODE_FACE_SOLVER_ID='solid-solid-contact-node-face-penalty-newton-pcg-js-f64-v1';
/** How a contact between two surfaces is discretised: `mortar` (segment to segment) or `node-face` (node against face). */
export type SolidSolidContactMethod='mortar'|'node-face';

/** Settings of a SolidSolidContact: method, contact stiffness, skin, friction, which bodies collide with themselves, and the friction passes. */
export interface SolidSolidContactOptions {
  /** `mortar` (default): segment-to-segment integrals, passes the contact patch test. `node-face`: node against face (version 1). */
  readonly method?:SolidSolidContactMethod;
  /** Contact between crossing sharp edges of two surfaces (or of one surface with itself). Default: on with the mortar method. */
  readonly edges?:boolean;
  /** Contact springs are this many times stiffer than one layer of elements of the softer body of a pair:
   * k = stiffnessScale (lambda + 2 mu) / l per unit of contact area, l the mean element size. Default 100. */
  readonly stiffnessScale?:number;
  /** Surfaces closer than this at the start of a step, plus the distance they can close in the step, get a contact.
   * Default: half the smallest mean element size. */
  readonly skin?:number;
  /** Coulomb coefficient between every pair of bodies (and of a body with itself). Default 0. `setFriction` changes one pair. */
  readonly friction?:number;
  /** Bodies (indices) that also collide with themselves, or true for all. Default: none. */
  readonly selfContact?:boolean|readonly number[];
  /** Most solves per step while the friction limits mu N settle. Default 12. */
  readonly frictionPasses?:number;
  /** The limits have settled when none changes by more than this fraction of the largest. Default 1e-4. */
  readonly frictionTolerance?:number;
}
/** What the last step of a SolidSolidContact did: convergence, Newton and linear iterations, the residual against its reference, friction passes and the number of contacts. */
export interface SolidSolidContactStats {
  converged:boolean;newtonIterations:number;linearIterations:number;residual:number;reference:number;frictionPasses:number;
  /** Steps that stopped at an iteration limit, or with friction limits still changing, since construction. */
  unconvergedSteps:number;
  /** Contact rows (surface nodes, crossing edges, nodes on planes) pressing after the last solve. */
  contacts:number;
  /** Of those, edge-to-edge contacts. */
  edgeContacts:number;
}
/** The result of SolidSolidContact.solveStatic: whether it converged, the passes it took, the final residual and the last change of the friction limits. */
export interface SolidSolidStaticResult {converged:boolean;passes:number;residual:number;change:number}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
function num(value:unknown,label:string,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be a number from ${min} to ${max}.`);
  return value as number;
}
/** A contact needs the two surfaces' outward normals to be opposed by at least this cosine. */
const FACING=.2;
/** The node-face contact normal at a point of a face is the weighted mean of its three vertex normals, each the area-weighted
 * mean of the faces around the vertex that lie within this cosine of the face (so a sharp edge is not rounded). An edge
 * between two boundary faces whose normals differ by more than this is a sharp edge (if convex) for edge contact. */
const CREASE=Math.cos(Math.PI/6);
/** Edge contact: the common normal of two crossing edges must lie inside the normal cone of each edge, more than 10°
 * from either face normal (closer to a face, the face contact is the one that acts). */
const EDGE_CONE=Math.cos(Math.PI/18);
/** Self-contact: a surface deeper behind a face of its own body than this fraction of the mean element size is not in contact with it. */
const SELF_DEPTH=.25;
/** Node-face: a node whose closest point of a face lies off the face by more than this fraction of the element size is not over that face. */
const LATERAL=1e-3;
/** Three-point rule on a triangle, exact for quadratics: the points (1/6, 1/6), (2/3, 1/6), (1/6, 2/3), each a third of the area. */
const GAUSS=[1/6,1/6,2/3,1/6,1/6,2/3];
const holders:FieldHandler={
  capture:value=>(value as SolidBody[]).map(s=>s.saveState()),
  restore:(value,state)=>{
    const live=value as SolidBody[],saved=state as StateValue[];
    if(!Array.isArray(saved)||saved.length!==live.length)throw checkpointError(`SolidSolidContact: the checkpoint has ${Array.isArray(saved)?saved.length:'no'} solids, this solver ${live.length}.`);
    for(let i=0;i<live.length;i++)live[i].restoreState(saved[i]);
  },
};
/** Constants of the meshes and scratch space of the search: not state. */
const FIELDS:FieldOptions={label:'SolidSolidContact',nested:{solids:holders},skip:['k','vertexFaceStart','vertexFaces','surfaceIndex','edgeNodes','edgeFaces',
  'faceUnit','hStart','hItems','hBox','stamp','cand','tS','tM','tW','tCount','tOrder','accW','accN','mNode','mWeight','px','py','qx','qy','w3','v2','n3']};

/** Closest point of triangle abc to p: barycentric weights into w (clamped to the triangle). After Ericson, Real-Time Collision Detection 5.1.5. */
function closestOnTriangle(px:number,py:number,pz:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number,cx:number,cy:number,cz:number,w:Float64Array):void {
  const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az,apx=px-ax,apy=py-ay,apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
  if(d1<=0&&d2<=0){w[0]=1;w[1]=0;w[2]=0;return;}
  const bpx=px-bx,bpy=py-by,bpz=pz-bz,d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
  if(d3>=0&&d4<=d3){w[0]=0;w[1]=1;w[2]=0;return;}
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);w[0]=1-v;w[1]=v;w[2]=0;return;}
  const cpx=px-cx,cpy=py-cy,cpz=pz-cz,d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
  if(d6>=0&&d5<=d6){w[0]=0;w[1]=0;w[2]=1;return;}
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0){const v=d2/(d2-d6);w[0]=1-v;w[1]=0;w[2]=v;return;}
  const va=d3*d6-d5*d4;
  if(va<=0&&d4-d3>=0&&d5-d6>=0){const v=(d4-d3)/((d4-d3)+(d5-d6));w[0]=0;w[1]=1-v;w[2]=v;return;}
  const denom=1/(va+vb+vc),v=vb*denom,u=vc*denom;w[0]=1-v-u;w[1]=v;w[2]=u;
}
const grown=<T extends Float64Array|Int32Array|Uint8Array>(a:T,length:number):T=>{if(a.length>=length)return a;const b=new (a.constructor as new(n:number)=>T)(Math.max(length,2*a.length,64));b.set(a);return b;};

/** Contact between deformable solids, of a solid with itself and with planes: mortar (or node-face) contact both ways and
 * edge-to-edge contact, with Coulomb friction, solved together with the solids in one Newton solve. See docs/SOLID_CONTACT.md. */
export class SolidSolidContact {
  /** Everything a later step reads, the solids included, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,FIELDS);}
  /** Put back a state from `saveState()` of a solver set up the same way (same solids, planes and options). */
  restoreState(state:StateValue):void {restoreFields(this,state,FIELDS);}

  readonly solver:string;readonly method:SolidSolidContactMethod;readonly edges:boolean;
  readonly solids:SolidBody[];readonly dt:number;readonly stiffnessScale:number;readonly skin:number;readonly frictionPasses:number;readonly frictionTolerance:number;
  readonly stats:SolidSolidContactStats={converged:true,newtonIterations:0,linearIterations:0,residual:0,reference:0,frictionPasses:0,unconvergedSteps:0,contacts:0,edgeContacts:0};
  /** Work of the contact and friction forces on the solids since construction, J (negative: dissipated by friction). */
  contactWork=0;
  private readonly k:SolidKernel[];
  /** First unknown of each body in the global vector, and the total. */
  private readonly offset:Int32Array;private readonly size:number;
  /** Per body: surface nodes (and each node's index among them, -1 inside), the mean element size and the contact stiffness per unit area, N/m^3. */
  private readonly surfaceNodes:Uint32Array[]=[];private readonly surfaceIndex:Int32Array[]=[];private readonly elementSize:number[]=[];private readonly kArea:number[]=[];
  /** Per body: the median longest edge of its boundary triangles (the cell of the spatial hash). */
  private readonly faceSize:number[]=[];
  /** Per body: sharp convex edges of the boundary (two nodes each) and the two faces beside each. */
  private readonly edgeNodes:Int32Array[]=[];private readonly edgeFaces:Int32Array[]=[];
  /** Self-contact: per body, for each node the sorted list of nodes that share a boundary face with it (CSR), or null. */
  private readonly ringStart:(Int32Array|null)[]=[];private readonly ringNodes:(Int32Array|null)[]=[];
  /** Ordered pairs (slave body, master body); master -1 - p is plane p. Each has a block of slots, one per surface node of the slave. */
  private pairSlave:number[]=[];private pairMaster:number[]=[];private pairFriction:number[]=[];private pairStart:number[]=[0];
  private readonly planes:{normal:[number,number,number];point:[number,number,number];friction:number}[]=[];
  private sealed=false;
  /** Per slot (persistent between steps): the friction spring's stretch at the end of the last step and the normal force. */
  private anchor=new Float64Array(0);private slotForce=new Float64Array(0);private marked=new Uint8Array(0);
  /** Per slot: the face the node was paired with last (node-face; -1: none). A node keeps its face while no other is closer by more than rounding. */
  private slotFace=new Int32Array(0);
  /** The contacts of the present step: rows (entries cStart[c] to cStart[c + 1] of cIdx, the global dof of a node, and cW,
   * its weight), the slot (-1: an edge contact, whose friction state is kept by its key), the two bodies (B < 0: a plane), normal,
   * start gap, stiffness, friction limit and coefficient, the friction spring's start. */
  private count=0;private entries=0;private cStart=new Int32Array(1);private cIdx=new Int32Array(0);private cW=new Float64Array(0);
  private cSlot=new Int32Array(0);private cA=new Int32Array(0);private cB=new Int32Array(0);private cN=new Float64Array(0);
  private cGap=new Float64Array(0);private cK=new Float64Array(0);private cCap=new Float64Array(0);private cMu=new Float64Array(0);private cF0=new Float64Array(0);
  /** Per contact after the last solve: normal force and the friction spring's stretch. Per edge contact: its key (bodies and edges). */
  private cForce=new Float64Array(0);private cTan=new Float64Array(0);private cKey=new Float64Array(0);
  /** Edge contacts pressing at the end of the last step (persistent, sorted by key): key, friction spring's stretch, normal force. */
  private eCount=0;private eKey=new Float64Array(0);private eAnchor=new Float64Array(0);private eForce=new Float64Array(0);
  /** One more than the most sharp edges of a body: the radix of the edge keys. */
  private readonly edgeRadix:number;
  /** What the Hessian needs from the last evaluation: pressing, friction mode (0 none, 1 stick, 2 slide), slip direction and length. */
  private act=new Uint8Array(0);private fmode=new Uint8Array(0);private fs=new Float64Array(0);private fsl=new Float64Array(0);
  private readonly z:Float64Array;private G:Float64Array;private Gt:Float64Array;private readonly trial:Float64Array;private readonly cgX:Float64Array;private readonly cgR:Float64Array;private readonly cgZ:Float64Array;private readonly cgP:Float64Array;private readonly cgA:Float64Array;private readonly diag:Float64Array;
  private readonly fint:Float64Array;private readonly u0:Float64Array;private readonly target:Float64Array;private readonly work:Float64Array;private readonly work2:Float64Array;private readonly fext:Float64Array;
  /** Force the contacts put on each node in the last solve, N (global vector: body after body). */
  readonly nodeForce:Float64Array;
  private readonly areaVector:Float64Array;private readonly xNow:Float64Array;
  /** Per body: the unit outward normal of every boundary face at the positions of the present search (scratch). */
  private readonly faceUnit:Float64Array[]=[];
  private h=0;private cm=0;private cd:number[]=[];private reference=0;private referenceInertia=0;private staticMode=false;
  private readonly w3=new Float64Array(3);private readonly v2=[0,0];
  /** Per body: the boundary faces around each node (CSR), constants of the mesh. */
  private readonly vertexFaceStart:Int32Array[]=[];private readonly vertexFaces:Int32Array[]=[];private readonly n3=new Float64Array(3);
  /** Spatial hash (scratch): bucket starts, items, item boxes, the query stamp per item and the candidates of a query. */
  private hStart=new Int32Array(0);private hItems=new Int32Array(0);private hBox=new Float64Array(0);private stamp=new Int32Array(0);private cand=new Int32Array(0);
  private hMask=0;private hInv=0;private hGrow=0;private hStamp=0;
  /** Mortar (scratch): triplets (slave surface index, master node, weight), their order by slave, and per slave surface node the weight and normal sums. */
  private tS=new Int32Array(0);private tM=new Int32Array(0);private tW=new Float64Array(0);private tCount=new Int32Array(0);private tOrder=new Int32Array(0);
  private accW=new Float64Array(0);private accN=new Float64Array(0);private mNode=new Int32Array(64);private mWeight=new Float64Array(64);
  private readonly px=new Float64Array(16);private readonly py=new Float64Array(16);private readonly qx=new Float64Array(16);private readonly qy=new Float64Array(16);

  constructor(solids:readonly SolidBody[],options:SolidSolidContactOptions={}) {
    if(!Array.isArray(solids)||solids.length<1)fail('SolidSolidContact needs at least one SolidBody.');
    for(const s of solids){
      if(!(s instanceof SolidBody))throw new EngineError('INVALID_PAYLOAD','SolidSolidContact needs SolidBody objects.');
      if(s.integrator!=='backward-euler')fail('A solid in contact needs the backward-euler integrator.');
      if(s.dt!==solids[0].dt)fail('Solids in contact with each other need the same time step.');
    }
    if(new Set(solids).size!==solids.length)fail('A solid is listed twice.');
    const method=options.method??'mortar';if(method!=='mortar'&&method!=='node-face')fail('method is mortar or node-face.');
    this.method=method;this.solver=method==='mortar'?SOLID_SOLID_CONTACT_SOLVER_ID:SOLID_SOLID_CONTACT_NODE_FACE_SOLVER_ID;
    if(options.edges!==undefined&&typeof options.edges!=='boolean')fail('edges is true or false.');
    this.edges=options.edges??method==='mortar';
    this.solids=solids.slice();this.dt=solids[0].dt;this.k=this.solids.map(s=>s.kernel());
    this.stiffnessScale=options.stiffnessScale===undefined?100:num(options.stiffnessScale,'stiffnessScale',1e-3,1e9);
    this.frictionPasses=options.frictionPasses===undefined?12:num(options.frictionPasses,'frictionPasses',1,1000);
    this.frictionTolerance=options.frictionTolerance===undefined?1e-4:num(options.frictionTolerance,'frictionTolerance',0,1);
    const friction=options.friction===undefined?0:num(options.friction,'friction',0,10);
    const offset=this.offset=new Int32Array(this.solids.length+1);let smallest=Infinity,items=0;
    this.solids.forEach((solid,b)=>{
      offset[b+1]=offset[b]+3*solid.nodeCount;
      const X=solid.referencePositions,faces=solid.faces,area=new Float64Array(solid.nodeCount),longest:number[]=[],normal=new Float64Array(faces.length);
      for(let f=0;f<faces.length;f+=3){
        const a=3*faces[f],c1=3*faces[f+1],c2=3*faces[f+2],ux=X[c1]-X[a],uy=X[c1+1]-X[a+1],uz=X[c1+2]-X[a+2],vx=X[c2]-X[a],vy=X[c2+1]-X[a+1],vz=X[c2+2]-X[a+2];
        const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nl=Math.hypot(nx,ny,nz),share=nl/6;area[faces[f]]+=share;area[faces[f+1]]+=share;area[faces[f+2]]+=share;
        normal[f]=nx/nl;normal[f+1]=ny/nl;normal[f+2]=nz/nl;
        longest.push(Math.max(Math.hypot(ux,uy,uz),Math.hypot(vx,vy,vz),Math.hypot(X[c2]-X[c1],X[c2+1]-X[c1+1],X[c2+2]-X[c1+2])));
      }
      longest.sort((p,q)=>p-q);this.faceSize.push(longest.length?longest[longest.length>>1]:0);
      const surface:number[]=[],index=new Int32Array(solid.nodeCount).fill(-1);for(let i=0;i<solid.nodeCount;i++)if(area[i]>0){index[i]=surface.length;surface.push(i);}
      const vs=new Int32Array(solid.nodeCount+1);for(let f=0;f<faces.length;f++)vs[faces[f]+1]++;
      for(let n=0;n<solid.nodeCount;n++)vs[n+1]+=vs[n];
      const fill=vs.slice(0,solid.nodeCount),vf=new Int32Array(faces.length);for(let f=0;f<faces.length;f++)vf[fill[faces[f]]++]=(f-f%3)/3;
      this.vertexFaceStart.push(vs);this.vertexFaces.push(vf);
      this.surfaceNodes.push(Uint32Array.from(surface));this.surfaceIndex.push(index);this.faceUnit.push(new Float64Array(faces.length));
      // Sharp convex edges: two boundary faces whose normals differ by more than the crease angle, the far node of one behind the other.
      const seen=new Map<number,number>(),en:number[]=[],ef:number[]=[];
      for(let f=0;f<faces.length;f+=3)for(let q=0;q<3;q++){
        const u=faces[f+q],v=faces[f+(q+1)%3],lo=Math.min(u,v),hi=Math.max(u,v),key=lo*solid.nodeCount+hi,other=seen.get(key);
        if(other===undefined){seen.set(key,f);continue;}
        if(normal[f]*normal[other]+normal[f+1]*normal[other+1]+normal[f+2]*normal[other+2]>=CREASE)continue;
        let w=faces[f];for(let r=0;r<3;r++)if(faces[f+r]!==u&&faces[f+r]!==v)w=faces[f+r];
        if((X[3*w]-X[3*u])*normal[other]+(X[3*w+1]-X[3*u+1])*normal[other+1]+(X[3*w+2]-X[3*u+2])*normal[other+2]>=0)continue;
        en.push(lo,hi);ef.push(other/3,f/3);
      }
      this.edgeNodes.push(Int32Array.from(en));this.edgeFaces.push(Int32Array.from(ef));
      items=Math.max(items,faces.length/3,en.length/2);
      const l=Math.cbrt(6*solid.referenceVolume/solid.tetCount);this.elementSize.push(l);smallest=Math.min(smallest,l);
      this.kArea.push(this.stiffnessScale*(solid.lambda+2*solid.mu)/l);this.cd.push(0);
      this.ringStart.push(null);this.ringNodes.push(null);
    });
    this.stamp=new Int32Array(items);this.cand=new Int32Array(items);this.edgeRadix=Math.max(1,...this.edgeNodes.map(e=>e.length/2+1));
    this.skin=options.skin===undefined?.5*smallest:num(options.skin,'skin',0,1e6);
    const self=options.selfContact===true?this.solids.map((s,b)=>b):options.selfContact?Array.from(options.selfContact):[];
    for(const b of self){if(!Number.isInteger(b)||b<0||b>=this.solids.length)fail('selfContact lists body indices.');this.buildRing(b);}
    for(let a=0;a<this.solids.length;a++)for(let b=0;b<this.solids.length;b++)if(a!==b||self.includes(a))this.addPair(a,b,friction);
    const size=this.size=offset[this.solids.length],f=()=>new Float64Array(size);
    this.z=f();this.G=f();this.Gt=f();this.trial=f();this.cgX=f();this.cgR=f();this.cgZ=f();this.cgP=f();this.cgA=f();this.diag=f();
    this.fint=f();this.u0=f();this.target=f();this.work=f();this.work2=f();this.fext=f();this.nodeForce=f();this.areaVector=f();this.xNow=f();
  }
  private addPair(slave:number,master:number,friction:number):void {
    this.pairSlave.push(slave);this.pairMaster.push(master);this.pairFriction.push(friction);
    this.pairStart.push(this.pairStart[this.pairStart.length-1]+this.surfaceNodes[slave].length);
  }
  /** Nodes that share a boundary face with each node: a node does not collide with the faces around it. */
  private buildRing(b:number):void {
    const solid=this.solids[b],faces=solid.faces,lists:Set<number>[]=[];for(let n=0;n<solid.nodeCount;n++)lists.push(new Set());
    for(let f=0;f<faces.length;f+=3)for(let i=0;i<3;i++)for(let j=0;j<3;j++)lists[faces[f+i]].add(faces[f+j]);
    const start=new Int32Array(solid.nodeCount+1);for(let n=0;n<solid.nodeCount;n++)start[n+1]=start[n]+lists[n].size;
    const nodes=new Int32Array(start[solid.nodeCount]);for(let n=0;n<solid.nodeCount;n++)nodes.set([...lists[n]].sort((x,y)=>x-y),start[n]);
    this.ringStart[b]=start;this.ringNodes[b]=nodes;
  }
  /** Self-contact: whether node m shares a boundary face with node n of body b (or is n). */
  private inRing(b:number,n:number,m:number):boolean {const rs=this.ringStart[b]!,rn=this.ringNodes[b]!;for(let q=rs[n];q<rs[n+1];q++)if(rn[q]===m)return true;return false;}
  /** A fixed plane every body collides with: the half space behind `normal` through `point`. Add planes before the first step. */
  addPlane(options:{readonly normal:readonly [number,number,number];readonly point?:readonly [number,number,number];readonly friction?:number}):number {
    if(this.sealed)fail('Add planes before the first step.');
    const n=[num(options.normal[0],'normal',-1e6,1e6),num(options.normal[1],'normal',-1e6,1e6),num(options.normal[2],'normal',-1e6,1e6)],length=Math.hypot(n[0],n[1],n[2]);
    if(!(length>0))fail('A plane needs a normal.');
    const p=options.point??[0,0,0],friction=options.friction===undefined?0:num(options.friction,'friction',0,10);
    this.planes.push({normal:[n[0]/length,n[1]/length,n[2]/length],point:[num(p[0],'point',-1e9,1e9),num(p[1],'point',-1e9,1e9),num(p[2],'point',-1e9,1e9)],friction});
    for(let b=0;b<this.solids.length;b++)this.addPair(b,-this.planes.length,friction);
    return this.planes.length-1;
  }
  get planeCount():number {return this.planes.length;}
  /** Coulomb coefficient between bodies a and b (both search directions); a === b for a body with itself. */
  setFriction(a:number,b:number,friction:number):void {
    num(friction,'friction',0,10);let found=false;
    for(let p=0;p<this.pairSlave.length;p++)if((this.pairSlave[p]===a&&this.pairMaster[p]===b)||(this.pairSlave[p]===b&&this.pairMaster[p]===a)){this.pairFriction[p]=friction;found=true;}
    if(!found)fail('These two bodies are not a contact pair.');
  }
  private seal():void {
    if(this.sealed)return;this.sealed=true;
    const slots=this.pairStart[this.pairStart.length-1];this.anchor=new Float64Array(3*slots);this.slotForce=new Float64Array(slots);this.marked=new Uint8Array(slots);this.slotFace=new Int32Array(slots).fill(-1);
  }
  private reserve(n:number):void {
    this.cStart=grown(this.cStart,n+1);
    if(this.cSlot.length>=n)return;
    const m=Math.max(n,2*this.cSlot.length,64),grow=<T extends Float64Array|Int32Array|Uint8Array>(a:T,per:number):T=>{const b=new (a.constructor as new(n:number)=>T)(per*m);b.set(a);return b;};
    this.cSlot=grow(this.cSlot,1);this.cA=grow(this.cA,1);this.cB=grow(this.cB,1);this.cN=grow(this.cN,3);this.cGap=grow(this.cGap,1);this.cK=grow(this.cK,1);
    this.cCap=grow(this.cCap,1);this.cMu=grow(this.cMu,1);this.cF0=grow(this.cF0,3);this.cForce=grow(this.cForce,1);this.cTan=grow(this.cTan,3);this.cKey=grow(this.cKey,1);
    this.act=grow(this.act,1);this.fmode=grow(this.fmode,1);this.fs=grow(this.fs,3);this.fsl=grow(this.fsl,1);
  }
  /** Start a contact row; its entries follow with `entry`, and `close` ends it. */
  private open():number {const c=this.count++;this.reserve(this.count);this.cStart[c]=this.entries;return c;}
  private entry(dof:number,weight:number):void {const q=this.entries++;if(q>=this.cIdx.length){this.cIdx=grown(this.cIdx,q+1);this.cW=grown(this.cW,q+1);}this.cIdx[q]=dof;this.cW[q]=weight;}
  private close(c:number,slot:number,A:number,B:number,nx:number,ny:number,nz:number,gap:number,k:number,mu:number):void {
    this.cStart[c+1]=this.entries;this.cSlot[c]=slot;this.cA[c]=A;this.cB[c]=B;this.cN[3*c]=nx;this.cN[3*c+1]=ny;this.cN[3*c+2]=nz;this.cGap[c]=gap;this.cK[c]=k;this.cMu[c]=mu;
  }

  // ---- Contact search ----

  /** Current positions of every node (reference + y) into xNow, each node's outward area vector into areaVector and each face's unit normal into faceUnit. */
  private geometry(y:Float64Array):void {
    const x=this.xNow,av=this.areaVector;av.fill(0);
    this.solids.forEach((solid,b)=>{
      const o=this.offset[b],X=solid.referencePositions,faces=solid.faces,unit=this.faceUnit[b];
      for(let j=0;j<3*solid.nodeCount;j++)x[o+j]=X[j]+y[o+j];
      for(let f=0;f<faces.length;f+=3){
        const a=o+3*faces[f],c1=o+3*faces[f+1],c2=o+3*faces[f+2],ux=x[c1]-x[a],uy=x[c1+1]-x[a+1],uz=x[c1+2]-x[a+2],vx=x[c2]-x[a],vy=x[c2+1]-x[a+1],vz=x[c2+2]-x[a+2];
        const nx=(uy*vz-uz*vy)/6,ny=(uz*vx-ux*vz)/6,nz=(ux*vy-uy*vx)/6,l=Math.hypot(nx,ny,nz);
        for(const i of [a,c1,c2]){av[i]+=nx;av[i+1]+=ny;av[i+2]+=nz;}
        unit[f]=nx/l;unit[f+1]=ny/l;unit[f+2]=nz/l;
      }
    });
  }
  /** Unit outward normal of face f of body b at the positions of the present search, into n3 (false when the face has no area). */
  private faceNormal(b:number,f:number):boolean {
    const unit=this.faceUnit[b],nx=unit[3*f];this.n3[0]=nx;this.n3[1]=unit[3*f+1];this.n3[2]=unit[3*f+2];return nx===nx;
  }
  /** The smoothed outward unit normal of body b at the point with weights w0, w1, w2 of face f (whose unit normal is nx, ny, nz), into n3. */
  private smoothNormal(b:number,f:number,w0:number,w1:number,w2:number,nx:number,ny:number,nz:number):void {
    const x=this.xNow,o=this.offset[b],faces=this.solids[b].faces,vs=this.vertexFaceStart[b],vf=this.vertexFaces[b],out=this.n3;let sx=0,sy=0,sz=0;
    for(let q=0;q<3;q++){
      const w=q===0?w0:q===1?w1:w2;if(!(w>0))continue;
      const v=faces[3*f+q];let mx=0,my=0,mz=0;
      for(let k=vs[v];k<vs[v+1];k++){
        const g=vf[k],a=o+3*faces[3*g],c1=o+3*faces[3*g+1],c2=o+3*faces[3*g+2],ux=x[c1]-x[a],uy=x[c1+1]-x[a+1],uz=x[c1+2]-x[a+2],vx=x[c2]-x[a],vy=x[c2+1]-x[a+1],vz=x[c2+2]-x[a+2];
        const ax=uy*vz-uz*vy,ay=uz*vx-ux*vz,az=ux*vy-uy*vx,al=Math.hypot(ax,ay,az);
        if(g===f||ax*nx+ay*ny+az*nz>=CREASE*al){mx+=ax;my+=ay;mz+=az;}
      }
      const ml=Math.hypot(mx,my,mz);sx+=w*mx/ml;sy+=w*my/ml;sz+=w*mz/ml;
    }
    const sl=Math.hypot(sx,sy,sz);out[0]=sx/sl;out[1]=sy/sl;out[2]=sz/sl;
  }
  /** The boxes (6 numbers each) of body b's faces (edges: false) or sharp edges (true) at the present positions, into hBox. */
  private boxes(b:number,edges:boolean):number {
    const x=this.xNow,o=this.offset[b],list=edges?this.edgeNodes[b]:this.solids[b].faces,per=edges?2:3,n=list.length/per;this.hBox=grown(this.hBox,6*n);const box=this.hBox;
    for(let i=0;i<n;i++)for(let c=0;c<3;c++){
      let lo=Infinity,hi=-Infinity;for(let q=0;q<per;q++){const v=x[o+3*list[per*i+q]+c];if(v<lo)lo=v;if(v>hi)hi=v;}
      box[6*i+c]=lo;box[6*i+3+c]=hi;
    }
    return n;
  }
  /** Fill the spatial hash with the `n` boxes of hBox, each grown by `grow`, in cells of size `cell`: every item in the bucket
   * of every cell its box touches (counting sort: no allocation once the arrays have grown; items in ascending order). */
  private hashFill(n:number,cell:number,grow:number):void {
    const box=this.hBox,inv=this.hInv=1/cell;this.hGrow=grow;let total=0;
    for(let i=0;i<n;i++){
      const o=6*i;total+=(Math.floor((box[o+3]+grow)*inv)-Math.floor((box[o]-grow)*inv)+1)*(Math.floor((box[o+4]+grow)*inv)-Math.floor((box[o+1]-grow)*inv)+1)*(Math.floor((box[o+5]+grow)*inv)-Math.floor((box[o+2]-grow)*inv)+1);
    }
    let size=64;while(size<2*total)size*=2;
    this.hMask=size-1;this.hStart=grown(this.hStart,size+1);this.hItems=grown(this.hItems,total);
    const start=this.hStart,items=this.hItems;start.fill(0,0,size+1);
    for(let pass=0;pass<2;pass++){
      for(let i=0;i<n;i++){
        const o=6*i,i0=Math.floor((box[o]-grow)*inv),i1=Math.floor((box[o+3]+grow)*inv),j0=Math.floor((box[o+1]-grow)*inv),j1=Math.floor((box[o+4]+grow)*inv),k0=Math.floor((box[o+2]-grow)*inv),k1=Math.floor((box[o+5]+grow)*inv);
        for(let a=i0;a<=i1;a++)for(let b=j0;b<=j1;b++)for(let c=k0;c<=k1;c++){const h=((a*73856093)^(b*19349663)^(c*83492791))&this.hMask;if(pass===0)start[h+1]++;else items[start[h]++]=i;}
      }
      if(pass===0)for(let h=0;h<size;h++)start[h+1]+=start[h];
    }
    // The fill moved every start to the next bucket's: shift back.
    for(let h=size;h>0;h--)start[h]=start[h-1];start[0]=0;
    this.stamp.fill(0);this.hStamp=0;
  }
  /** The items whose grown box meets the box (x0, y0, z0)-(x1, y1, z1), each once, into cand; returns how many. */
  private hashQuery(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number):number {
    const inv=this.hInv,g=this.hGrow,box=this.hBox,start=this.hStart,items=this.hItems,stamp=this.stamp,cand=this.cand,s=++this.hStamp;let n=0;
    const i0=Math.floor(x0*inv),i1=Math.floor(x1*inv),j0=Math.floor(y0*inv),j1=Math.floor(y1*inv),k0=Math.floor(z0*inv),k1=Math.floor(z1*inv);
    for(let a=i0;a<=i1;a++)for(let b=j0;b<=j1;b++)for(let c=k0;c<=k1;c++){
      const h=((a*73856093)^(b*19349663)^(c*83492791))&this.hMask;
      for(let q=start[h];q<start[h+1];q++){
        const it=items[q],o=6*it;if(stamp[it]===s)continue;stamp[it]=s;
        if(box[o]-g>x1||box[o+3]+g<x0||box[o+1]-g>y1||box[o+4]+g<y0||box[o+2]-g>z1||box[o+5]+g<z0)continue;
        cand[n++]=it;
      }
    }
    return n;
  }
  /** The contacts of a step that starts at y and may move the nodes by `closing` (per body) towards each other. */
  private detect(y:Float64Array,closing:number[]):void {
    this.seal();this.geometry(y);this.count=0;this.entries=0;this.cStart[0]=0;
    const x=this.xNow,av=this.areaVector,box=(b:number):number[]=>{
      const o=this.offset[b],n=this.solids[b].nodeCount,r=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      for(let i=0;i<n;i++)for(let c=0;c<3;c++){const v=x[o+3*i+c];if(v<r[c])r[c]=v;if(v>r[3+c])r[3+c]=v;}return r;
    },boxes=this.solids.map((s,b)=>box(b));
    for(let p=0;p<this.pairSlave.length;p++){
      const A=this.pairSlave[p],B=this.pairMaster[p],oA=this.offset[A],surface=this.surfaceNodes[A],start=this.pairStart[p],mu=this.pairFriction[p];
      if(B<0){
        // A fixed plane.
        const plane=this.planes[-1-B],[nx,ny,nz]=plane.normal,reach=this.skin+closing[A],k=this.kArea[A];
        for(let s=0;s<surface.length;s++){
          const i=oA+3*surface[s],gap=nx*(x[i]-plane.point[0])+ny*(x[i+1]-plane.point[1])+nz*(x[i+2]-plane.point[2]);
          if(gap>reach)continue;
          const facing=av[i]*nx+av[i+1]*ny+av[i+2]*nz;if(facing>=0)continue;
          const c=this.open();this.entry(i,1);this.close(c,start+s,A,B,nx,ny,nz,gap,k*-facing,mu);
        }
        continue;
      }
      // How far behind a face a surface may be and still belong to it. Between two bodies: an element size. Within one body
      // the far side of a thin part faces it too, through the material: a quarter of an element size.
      const lA=this.elementSize[A],lB=this.elementSize[B],reach=this.skin+closing[A]+closing[B],deep=A===B?SELF_DEPTH*lA:Math.max(reach,Math.min(lA,lB));
      const a=boxes[A],b=boxes[B],far=Math.max(reach,deep),kPair=Math.min(this.kArea[A],this.kArea[B]);
      if(a[0]>b[3]+far||b[0]>a[3]+far||a[1]>b[4]+far||b[1]>a[4]+far||a[2]>b[5]+far||b[2]>a[5]+far)continue;
      this.hashFill(this.boxes(B,false),Math.max(this.faceSize[B],far),far);
      if(this.method==='mortar')this.mortar(A,B,start,reach,deep,kPair,mu);else this.nodeFace(A,B,start,reach,deep,far,kPair,mu,b);
      if(this.edges&&A<=B&&this.edgeNodes[A].length&&this.edgeNodes[B].length)this.edgeContacts(A,B,reach,deep,far,kPair*Math.min(lA,lB)**2,mu);
    }
    // Friction: each contact starts from its slot's spring stretch (projected on the new plane) and the last normal force.
    for(let c=0;c<this.count;c++){
      // An edge contact finds the state of the same two edges at the end of the last step, if they were pressing then.
      const slot=this.cSlot[c];let held=-1;
      if(slot<0){let lo=0,hi=this.eCount-1;const key=this.cKey[c];while(lo<=hi){const mid=(lo+hi)>>1,k=this.eKey[mid];if(k===key){held=mid;break;}if(k<key)lo=mid+1;else hi=mid-1;}}
      const anchor=slot<0?this.eAnchor:this.anchor,at=slot<0?held:slot;
      if(at<0){this.cF0[3*c]=this.cF0[3*c+1]=this.cF0[3*c+2]=0;this.cCap[c]=0;continue;}
      const nx=this.cN[3*c],ny=this.cN[3*c+1],nz=this.cN[3*c+2],ex=anchor[3*at],ey=anchor[3*at+1],ez=anchor[3*at+2],along=ex*nx+ey*ny+ez*nz;
      this.cF0[3*c]=ex-along*nx;this.cF0[3*c+1]=ey-along*ny;this.cF0[3*c+2]=ez-along*nz;this.cCap[c]=this.cMu[c]*(slot<0?this.eForce[held]:this.slotForce[slot]);
    }
  }
  /** Node against face (version 1): each surface node of A against the closest point of the faces of B in the hash. */
  private nodeFace(A:number,B:number,start:number,reach:number,deep:number,far:number,kPair:number,mu:number,b:number[]):void {
    const x=this.xNow,av=this.areaVector,w=this.w3,oA=this.offset[A],oB=this.offset[B],surface=this.surfaceNodes[A],faces=this.solids[B].faces,lB=this.elementSize[B],self=A===B,rs=this.ringStart[A],rn=this.ringNodes[A];
    for(let s=0;s<surface.length;s++){
      const node=surface[s],i=oA+3*node,px=x[i],py=x[i+1],pz=x[i+2];
      if(px<b[0]-far||px>b[3]+far||py<b[1]-far||py>b[4]+far||pz<b[2]-far||pz>b[5]+far)continue;
      const ax=av[i],ay=av[i+1],az=av[i+2],an=Math.hypot(ax,ay,az);if(!(an>0))continue;
      const nc=this.hashQuery(px,py,pz,px,py,pz);
      let best=-1,bestD=Infinity,bg=0,b0=0,b1=0,b2=0,bnx=0,bny=0,bnz=0,bFacing=0;const last=this.slotFace[start+s],keep=1e-9*lB;
      for(let q=0;q<nc;q++){
        const f=this.cand[q],n0=faces[3*f],n1=faces[3*f+1],n2=faces[3*f+2];
        if(self){
          // Not the faces around the node, nor a face that shares a node with one of them.
          let near=false;for(let r=rs![node];r<rs![node+1]&&!near;r++){const m=rn![r];near=m===n0||m===n1||m===n2;}
          if(near)continue;
        }
        const fa=oB+3*n0,fb=oB+3*n1,fc=oB+3*n2;
        const ux=x[fb]-x[fa],uy=x[fb+1]-x[fa+1],uz=x[fb+2]-x[fa+2],vx=x[fc]-x[fa],vy=x[fc+1]-x[fa+1],vz=x[fc+2]-x[fa+2];
        let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const nl=Math.hypot(nx,ny,nz);if(!(nl>0))continue;nx/=nl;ny/=nl;nz/=nl;
        const facing=ax*nx+ay*ny+az*nz;if(facing>-FACING*an)continue;
        closestOnTriangle(px,py,pz,x[fa],x[fa+1],x[fa+2],x[fb],x[fb+1],x[fb+2],x[fc],x[fc+1],x[fc+2],w);
        const dx=px-(w[0]*x[fa]+w[1]*x[fb]+w[2]*x[fc]),dy=py-(w[0]*x[fa+1]+w[1]*x[fb+1]+w[2]*x[fc+1]),dz=pz-(w[0]*x[fa+2]+w[1]*x[fb+2]+w[2]*x[fc+2]);
        const g=dx*nx+dy*ny+dz*nz,d=Math.hypot(dx,dy,dz);
        if(g>reach||g<-deep)continue;
        // Over the face: the closest point is the foot of the normal.
        if(Math.sqrt(Math.max(0,d*d-g*g))>LATERAL*lB)continue;
        // The face of the last search wins a tie (a node over an edge or a vertex of the other mesh), then the lower index.
        const dk=f===last?d-keep:d;
        if(dk<bestD||(dk===bestD&&f<best)){best=f;bestD=dk;bg=g;b0=w[0];b1=w[1];b2=w[2];bnx=nx;bny=ny;bnz=nz;bFacing=-facing;}
      }
      this.slotFace[start+s]=best;
      if(best<0)continue;
      // The gap is measured along the smoothed normal, from the same foot point.
      this.smoothNormal(B,best,b0,b1,b2,bnx,bny,bnz);
      {const mx=this.n3[0],my=this.n3[1],mz=this.n3[2],cos=mx*bnx+my*bny+mz*bnz;bg*=cos;bFacing=-(ax*mx+ay*my+az*mz);bnx=mx;bny=my;bnz=mz;if(!(bFacing>0))continue;}
      const c=this.open();this.entry(i,1);this.entry(oB+3*faces[3*best],-b0);this.entry(oB+3*faces[3*best+1],-b1);this.entry(oB+3*faces[3*best+2],-b2);
      this.close(c,start+s,A,B,bnx,bny,bnz,bg,kPair*bFacing,mu);
    }
  }
  /** Mortar: every boundary triangle of A against the triangles of B in the hash, intersected in A's plane and integrated;
   * then one row per surface node of A that the integrals reach. See the header. */
  private mortar(A:number,B:number,start:number,reach:number,deep:number,kPair:number,mu:number):void {
    const x=this.xNow,oA=this.offset[A],oB=this.offset[B],facesA=this.solids[A].faces,facesB=this.solids[B].faces,index=this.surfaceIndex[A],surface=this.surfaceNodes[A],nS=surface.length,self=A===B;
    this.accW=grown(this.accW,nS);this.accN=grown(this.accN,3*nS);const accW=this.accW,accN=this.accN;accW.fill(0,0,nS);accN.fill(0,0,3*nS);
    const PX=this.px,PY=this.py,QX=this.qx,QY=this.qy,Wl=[0,0,0],Dl=[0,0,0,0,0,0,0,0,0],Ml=[0,0,0,0,0,0,0,0,0],P=[0,0,0,0,0,0],H=[0,0,0];let nt=0;
    for(let f=0;f<facesA.length/3;f++){
      const s0=facesA[3*f],s1=facesA[3*f+1],s2=facesA[3*f+2],ia=oA+3*s0,ib=oA+3*s1,ic=oA+3*s2;
      const xa=x[ia],ya=x[ia+1],za=x[ia+2],ux=x[ib]-xa,uy=x[ib+1]-ya,uz=x[ib+2]-za,vx=x[ic]-xa,vy=x[ic+1]-ya,vz=x[ic+2]-za;
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const area2=Math.hypot(nx,ny,nz),L=Math.hypot(ux,uy,uz);if(!(area2>0&&L>0))continue;nx/=area2;ny/=area2;nz/=area2;
      // A frame in the face's plane: e1 along the first edge, e2 = n x e1. The face is (0, 0), (L, 0), (Cx, Cy), Cy > 0.
      const e1x=ux/L,e1y=uy/L,e1z=uz/L,e2x=ny*e1z-nz*e1y,e2y=nz*e1x-nx*e1z,e2z=nx*e1y-ny*e1x,Cx=vx*e1x+vy*e1y+vz*e1z,Cy=vx*e2x+vy*e2y+vz*e2z;
      const nc=this.hashQuery(Math.min(xa,x[ib],x[ic]),Math.min(ya,x[ib+1],x[ic+1]),Math.min(za,x[ib+2],x[ic+2]),Math.max(xa,x[ib],x[ic]),Math.max(ya,x[ib+1],x[ic+1]),Math.max(za,x[ib+2],x[ic+2]));
      for(let q=0;q<nc;q++){
        const g=this.cand[q],m0=facesB[3*g],m1=facesB[3*g+1],m2=facesB[3*g+2];
        // Self-contact: not a face that shares a node with a face around this one.
        if(self&&(this.inRing(A,s0,m0)||this.inRing(A,s0,m1)||this.inRing(A,s0,m2)||this.inRing(A,s1,m0)||this.inRing(A,s1,m1)||this.inRing(A,s1,m2)||this.inRing(A,s2,m0)||this.inRing(A,s2,m1)||this.inRing(A,s2,m2)))continue;
        if(!this.faceNormal(B,g)||nx*this.n3[0]+ny*this.n3[1]+nz*this.n3[2]>-FACING)continue;
        // B's triangle in A's plane (projected along A's normal), with the heights of its nodes above that plane.
        for(let r=0;r<3;r++){const j=oB+3*(r===0?m0:r===1?m1:m2),dx=x[j]-xa,dy=x[j+1]-ya,dz=x[j+2]-za;P[2*r]=dx*e1x+dy*e1y+dz*e1z;P[2*r+1]=dx*e2x+dy*e2y+dz*e2z;H[r]=dx*nx+dy*ny+dz*nz;}
        // The gaps over the overlap lie between the heights; the projection must meet A's triangle.
        if(Math.min(H[0],H[1],H[2])>reach||Math.max(H[0],H[1],H[2])<-deep)continue;
        if(Math.max(P[0],P[2],P[4])<Math.min(0,Cx)||Math.min(P[0],P[2],P[4])>Math.max(L,Cx)||Math.max(P[1],P[3],P[5])<0||Math.min(P[1],P[3],P[5])>Cy)continue;
        const det=(P[2]-P[0])*(P[5]-P[1])-(P[3]-P[1])*(P[4]-P[0]);if(!(Math.abs(det)>1e-12*area2))continue;
        // Clip B's triangle (counter-clockwise) by the three edges of A's (Sutherland-Hodgman).
        let n=3;if(det>0){PX[0]=P[0];PY[0]=P[1];PX[1]=P[2];PY[1]=P[3];PX[2]=P[4];PY[2]=P[5];}else{PX[0]=P[0];PY[0]=P[1];PX[1]=P[4];PY[1]=P[5];PX[2]=P[2];PY[2]=P[3];}
        for(let e=0;e<3&&n>=3;e++){
          const ex0=e===0?0:e===1?L:Cx,ey0=e===0?0:e===1?0:Cy,ex1=e===0?L:e===1?Cx:0,ey1=e===0?0:e===1?Cy:0,dx=ex1-ex0,dy=ey1-ey0;let m=0;
          for(let v=0;v<n;v++){
            const w=(v+1)%n,sv=dx*(PY[v]-ey0)-dy*(PX[v]-ex0),sw=dx*(PY[w]-ey0)-dy*(PX[w]-ex0);
            if(sv>=0){QX[m]=PX[v];QY[m]=PY[v];m++;}
            if((sv>=0)!==(sw>=0)){const t=sv/(sv-sw);QX[m]=PX[v]+t*(PX[w]-PX[v]);QY[m]=PY[v]+t*(PY[w]-PY[v]);m++;}
          }
          for(let v=0;v<m;v++){PX[v]=QX[v];PY[v]=QY[v];}n=m;
        }
        if(n<3)continue;
        // Integrate N_a, N_a N_c (A) and N_a N_b (B) over the overlap: a fan of triangles, three points each.
        Wl[0]=Wl[1]=Wl[2]=0;Dl.fill(0);Ml.fill(0);let gmin=Infinity,gmax=-Infinity,total=0;
        for(let v=1;v+1<n;v++){
          const ax=PX[v]-PX[0],ay=PY[v]-PY[0],bx=PX[v+1]-PX[0],by=PY[v+1]-PY[0],part=.5*(ax*by-ay*bx);if(!(part>0))continue;total+=part;
          for(let r=0;r<6;r+=2){
            const qx=PX[0]+GAUSS[r]*ax+GAUSS[r+1]*bx,qy=PY[0]+GAUSS[r]*ay+GAUSS[r+1]*by,wt=part/3;
            const l2=qy/Cy,l1=(qx-Cx*l2)/L,l0=1-l1-l2;
            const k1=((qx-P[0])*(P[5]-P[1])-(qy-P[1])*(P[4]-P[0]))/det,k2=((P[2]-P[0])*(qy-P[1])-(P[3]-P[1])*(qx-P[0]))/det,k0=1-k1-k2;
            const gap=k0*H[0]+k1*H[1]+k2*H[2];if(gap<gmin)gmin=gap;if(gap>gmax)gmax=gap;
            for(let i=0;i<3;i++){const wi=wt*(i===0?l0:i===1?l1:l2);Wl[i]+=wi;Dl[3*i]+=wi*l0;Dl[3*i+1]+=wi*l1;Dl[3*i+2]+=wi*l2;Ml[3*i]+=wi*k0;Ml[3*i+1]+=wi*k1;Ml[3*i+2]+=wi*k2;}
          }
        }
        if(!(total>1e-12*area2)||gmin>reach||gmax<-deep)continue;
        if(nt+18>this.tS.length){this.tS=grown(this.tS,nt+18);this.tM=grown(this.tM,nt+18);this.tW=grown(this.tW,nt+18);}
        // Triplets: a node of B is its index, a node of A is -1 - its index.
        for(let i=0;i<3;i++){
          const s=index[i===0?s0:i===1?s1:s2];accW[s]+=Wl[i];accN[3*s]+=Wl[i]*nx;accN[3*s+1]+=Wl[i]*ny;accN[3*s+2]+=Wl[i]*nz;
          for(let r=0;r<3;r++){this.tS[nt]=s;this.tM[nt]=-1-(r===0?s0:r===1?s1:s2);this.tW[nt]=-Dl[3*i+r];nt++;this.tS[nt]=s;this.tM[nt]=r===0?m0:r===1?m1:m2;this.tW[nt]=Ml[3*i+r];nt++;}
        }
      }
    }
    if(nt===0)return;
    // The triplets by slave node (counting sort, stable), then one row per node: sum_c (n_ac / W_a) x_c - sum_b (n_ab / W_a) x_b along n_a.
    this.tCount=grown(this.tCount,nS+1);this.tOrder=grown(this.tOrder,nt);const cnt=this.tCount,order=this.tOrder;cnt.fill(0,0,nS+1);
    for(let t=0;t<nt;t++)cnt[this.tS[t]+1]++;
    for(let s=0;s<nS;s++)cnt[s+1]+=cnt[s];
    for(let t=0;t<nt;t++)order[cnt[this.tS[t]]++]=t;
    for(let s=nS;s>0;s--)cnt[s]=cnt[s-1];cnt[0]=0;
    const least=1e-9*this.elementSize[A]**2;
    for(let s=0;s<nS;s++){
      const W=accW[s];if(!(W>least))continue;
      let m=0;
      for(let q=cnt[s];q<cnt[s+1];q++){
        const t=order[q],node=this.tM[t];let r=0;while(r<m&&this.mNode[r]!==node)r++;
        if(r===m){if(m>=this.mNode.length){this.mNode=grown(this.mNode,m+1);this.mWeight=grown(this.mWeight,m+1);}this.mNode[m]=node;this.mWeight[m]=0;m++;}
        this.mWeight[r]+=this.tW[t];
      }
      // The normal points from B into A: against A's outward normal.
      let nx=accN[3*s],ny=accN[3*s+1],nz=accN[3*s+2];const nl=-Math.hypot(nx,ny,nz);if(!(nl<0))continue;nx/=nl;ny/=nl;nz/=nl;
      let gx=0,gy=0,gz=0;const c=this.open();
      for(let r=0;r<m;r++){const v=this.mNode[r],j=v<0?oA+3*(-1-v):oB+3*v,w=-this.mWeight[r]/W;gx+=w*x[j];gy+=w*x[j+1];gz+=w*x[j+2];this.entry(j,w);}
      this.close(c,start+s,A,B,nx,ny,nz,nx*gx+ny*gy+nz*gz,kPair*W,mu);
    }
  }
  /** Edge against edge: sharp convex edges of A and B (A <= B) that cross, closer than reach and shallower than deep, along
   * the common normal of the two edges when it lies inside the normal cone of both. A point spring of stiffness `k`. */
  private edgeContacts(A:number,B:number,reach:number,deep:number,far:number,k:number,mu:number):void {
    const x=this.xNow,oA=this.offset[A],oB=this.offset[B],eA=this.edgeNodes[A],eB=this.edgeNodes[B],fA=this.edgeFaces[A],fB=this.edgeFaces[B],self=A===B,n3=this.n3;
    const nA=this.boxes(A,true),boxA=this.hBox.slice(0,6*nA);
    this.hashFill(this.boxes(B,true),Math.max(this.faceSize[B],far),far);
    const cone=(b:number,f1:number,f2:number,nx:number,ny:number,nz:number):boolean=>{
      this.faceNormal(b,f1);const ax=n3[0],ay=n3[1],az=n3[2];this.faceNormal(b,f2);
      const c1=nx*ax+ny*ay+nz*az,c2=nx*n3[0]+ny*n3[1]+nz*n3[2],c12=ax*n3[0]+ay*n3[1]+az*n3[2];
      return c1>c12&&c2>c12&&c1<EDGE_CONE&&c2<EDGE_CONE;
    };
    for(let e=0;e<nA;e++){
      const a0=eA[2*e],a1=eA[2*e+1],ia=oA+3*a0,ib=oA+3*a1,nc=this.hashQuery(boxA[6*e],boxA[6*e+1],boxA[6*e+2],boxA[6*e+3],boxA[6*e+4],boxA[6*e+5]);
      for(let q=0;q<nc;q++){
        const g=this.cand[q];if(self&&g<=e)continue;
        const b0=eB[2*g],b1=eB[2*g+1];
        if(self&&(this.inRing(A,a0,b0)||this.inRing(A,a0,b1)||this.inRing(A,a1,b0)||this.inRing(A,a1,b1)))continue;
        const ja=oB+3*b0,jb=oB+3*b1;
        const d1x=x[ib]-x[ia],d1y=x[ib+1]-x[ia+1],d1z=x[ib+2]-x[ia+2],d2x=x[jb]-x[ja],d2y=x[jb+1]-x[ja+1],d2z=x[jb+2]-x[ja+2],rx=x[ia]-x[ja],ry=x[ia+1]-x[ja+1],rz=x[ia+2]-x[ja+2];
        const aa=d1x*d1x+d1y*d1y+d1z*d1z,ee=d2x*d2x+d2y*d2y+d2z*d2z,bb=d1x*d2x+d1y*d2y+d1z*d2z,cc=d1x*rx+d1y*ry+d1z*rz,ff=d2x*rx+d2y*ry+d2z*rz,den=aa*ee-bb*bb;
        // Not nearly parallel edges (less than 3°): their contact is the faces'.
        if(!(den>2.7e-3*aa*ee))continue;
        const s=(bb*ff-cc*ee)/den,t=(aa*ff-bb*cc)/den;
        if(!(s>1e-9&&s<1-1e-9&&t>1e-9&&t<1-1e-9))continue;
        let nx=d1y*d2z-d1z*d2y,ny=d1z*d2x-d1x*d2z,nz=d1x*d2y-d1y*d2x;const nl=Math.hypot(nx,ny,nz);nx/=nl;ny/=nl;nz/=nl;
        // Outward from B's edge.
        this.faceNormal(B,fB[2*g]);let ox=n3[0],oy=n3[1],oz=n3[2];this.faceNormal(B,fB[2*g+1]);ox+=n3[0];oy+=n3[1];oz+=n3[2];
        if(nx*ox+ny*oy+nz*oz<0){nx=-nx;ny=-ny;nz=-nz;}
        if(!cone(B,fB[2*g],fB[2*g+1],nx,ny,nz)||!cone(A,fA[2*e],fA[2*e+1],-nx,-ny,-nz))continue;
        const gap=nx*(rx+s*d1x-t*d2x)+ny*(ry+s*d1y-t*d2y)+nz*(rz+s*d1z-t*d2z);
        if(gap>reach||gap<-deep)continue;
        const c=this.open();this.entry(ia,1-s);this.entry(ib,s);this.entry(ja,t-1);this.entry(jb,-t);this.close(c,-1,A,B,nx,ny,nz,gap,k,mu);
        this.cKey[c]=((A*this.solids.length+B)*this.edgeRadix+e)*this.edgeRadix+g;
      }
    }
  }

  // ---- The objective, its gradient and Hessian ----

  /** Energy of the contact and friction springs at y; adds its gradient to G and records what the Hessian needs. */
  private springs(y:Float64Array,G:Float64Array|null):number {
    const u0=this.u0,N=this.cN,S=this.cStart,I=this.cIdx,W=this.cW;let energy=0;
    for(let c=0;c<this.count;c++){
      const o=3*c,k=this.cK[c];let px=0,py=0,pz=0;
      for(let q=S[c];q<S[c+1];q++){const m=I[q],w=W[q];px+=w*(y[m]-u0[m]);py+=w*(y[m+1]-u0[m+1]);pz+=w*(y[m+2]-u0[m+2]);}
      const nx=N[o],ny=N[o+1],nz=N[o+2],gap=this.cGap[c]+nx*px+ny*py+nz*pz;let wx=0,wy=0,wz=0;
      if(gap<0){this.act[c]=1;energy+=.5*k*gap*gap;const w=k*gap;wx=w*nx;wy=w*ny;wz=w*nz;}else this.act[c]=0;
      const cap=this.cCap[c];
      if(cap>0){
        let sx=this.cF0[o]+px,sy=this.cF0[o+1]+py,sz=this.cF0[o+2]+pz;const along=nx*sx+ny*sy+nz*sz;sx-=along*nx;sy-=along*ny;sz-=along*nz;
        const slip=Math.hypot(sx,sy,sz);
        if(k*slip<=cap){this.fmode[c]=1;energy+=.5*k*slip*slip;wx+=k*sx;wy+=k*sy;wz+=k*sz;}
        else{this.fmode[c]=2;energy+=cap*slip-.5*cap*cap/k;const inv=1/slip;this.fs[o]=sx*inv;this.fs[o+1]=sy*inv;this.fs[o+2]=sz*inv;this.fsl[c]=slip;wx+=cap*sx*inv;wy+=cap*sy*inv;wz+=cap*sz*inv;}
      }else this.fmode[c]=0;
      if(G&&(wx!==0||wy!==0||wz!==0))for(let q=S[c];q<S[c+1];q++){const m=I[q],w=W[q];G[m]+=w*wx;G[m+1]+=w*wy;G[m+2]+=w*wz;}
    }
    return energy;
  }
  /** Phi at y and its gradient on the free unknowns. Infinity when an element is inverted. */
  private objective(y:Float64Array,G:Float64Array):number {
    const cm=this.cm;let phi=0,internal=0,external=0;
    for(let b=0;b<this.solids.length;b++){
      const k=this.k[b],o=this.offset[b],n3=this.offset[b+1]-o,mass=this.solids[b].nodalMass,cd=this.cd[b],alpha=k.massDamping,beta=k.stiffnessDamping;
      const yu=y.subarray(o,o+n3),fint=this.fint.subarray(o,o+n3),e=k.energy(yu,fint,true);
      if(!(e<Infinity))return Infinity;
      phi+=e;
      for(let j=0;j<n3;j++){const f=this.fext[o+j];phi-=f*yu[j];G[o+j]=fint[j]-f;internal+=fint[j]*fint[j];external+=f*f;}
      if(cm>0)for(let j=0;j<n3;j++){const d=yu[j]-this.target[o+j],md=cm*mass[(j-j%3)/3]*d;phi+=.5*md*d;G[o+j]+=md;}
      if(cd>0){
        const d=this.work.subarray(o,o+n3);for(let j=0;j<n3;j++)d[j]=yu[j]-this.u0[o+j];
        if(alpha>0)for(let j=0;j<n3;j++){const md=cd*alpha*mass[(j-j%3)/3]*d[j];phi+=.5*md*d[j];G[o+j]+=md;}
        if(beta>0){const kd=this.work2.subarray(o,o+n3);k.dampingProduct(d,kd);for(let j=0;j<n3;j++){const w=cd*beta*kd[j];phi+=.5*w*d[j];G[o+j]+=w;}}
      }
    }
    phi+=this.springs(y,G);
    for(let b=0;b<this.solids.length;b++){const fixed=this.k[b].fixed,o=this.offset[b];for(let j=0;j<fixed.length;j++)if(fixed[j])G[o+j]=0;}
    this.reference=Math.max(Math.sqrt(internal),Math.sqrt(external),this.referenceInertia);
    return phi;
  }
  private kScale(b:number):number {return 1+this.cd[b]*this.k[b].stiffnessDamping;}
  private mScale(b:number):number {return this.cm+this.cd[b]*this.k[b].massDamping;}
  /** out = H p: each solid's tangent, inertia and damping, and the springs. */
  private product(p:Float64Array,out:Float64Array):void {
    for(let b=0;b<this.solids.length;b++){
      const o=this.offset[b],n3=this.offset[b+1]-o,ks=this.kScale(b),ms=this.mScale(b),mass=this.solids[b].nodalMass,ou=out.subarray(o,o+n3);
      this.k[b].tangentProduct(p.subarray(o,o+n3),ou);
      for(let j=0;j<n3;j++)ou[j]=ks*ou[j]+ms*mass[(j-j%3)/3]*p[o+j];
    }
    const N=this.cN,S=this.cStart,I=this.cIdx,W=this.cW;
    for(let c=0;c<this.count;c++){
      const mode=this.fmode[c];if(!this.act[c]&&!mode)continue;
      const o=3*c,k=this.cK[c];let dx=0,dy=0,dz=0;
      for(let q=S[c];q<S[c+1];q++){const m=I[q],w=W[q];dx+=w*p[m];dy+=w*p[m+1];dz+=w*p[m+2];}
      const nx=N[o],ny=N[o+1],nz=N[o+2],dn=nx*dx+ny*dy+nz*dz;let wx=0,wy=0,wz=0;
      if(this.act[c]){wx=k*dn*nx;wy=k*dn*ny;wz=k*dn*nz;}
      if(mode){
        let tx=dx-dn*nx,ty=dy-dn*ny,tz=dz-dn*nz;
        if(mode===1){wx+=k*tx;wy+=k*ty;wz+=k*tz;}
        else{const sx=this.fs[o],sy=this.fs[o+1],sz=this.fs[o+2],ds=sx*tx+sy*ty+sz*tz,r=this.cCap[c]/this.fsl[c];tx-=ds*sx;ty-=ds*sy;tz-=ds*sz;wx+=r*tx;wy+=r*ty;wz+=r*tz;}
      }
      for(let q=S[c];q<S[c+1];q++){const m=I[q],w=W[q];out[m]+=w*wx;out[m+1]+=w*wy;out[m+2]+=w*wz;}
    }
    for(let b=0;b<this.solids.length;b++){const fixed=this.k[b].fixed,o=this.offset[b];for(let j=0;j<fixed.length;j++)if(fixed[j])out[o+j]=0;}
  }
  /** Diagonal of H. */
  private precondition():void {
    const diag=this.diag;
    for(let b=0;b<this.solids.length;b++){
      const o=this.offset[b],n3=this.offset[b+1]-o,ks=this.kScale(b),ms=this.mScale(b),mass=this.solids[b].nodalMass,kd=this.k[b].stiffnessDiagonal;
      for(let j=0;j<n3;j++)diag[o+j]=ks*kd[j]+ms*mass[(j-j%3)/3];
    }
    const N=this.cN,S=this.cStart,I=this.cIdx,W=this.cW;
    for(let c=0;c<this.count;c++){
      const mode=this.fmode[c];if(!this.act[c]&&!mode)continue;
      const o=3*c,k=this.cK[c];
      for(let q=0;q<3;q++){
        const n=N[o+q];let d=this.act[c]?k*n*n:0;
        if(mode===1)d+=k*(1-n*n);else if(mode===2){const s=this.fs[o+q];d+=this.cCap[c]/this.fsl[c]*Math.max(0,1-n*n-s*s);}
        for(let e=S[c];e<S[c+1];e++)diag[I[e]+q]+=W[e]*W[e]*d;
      }
    }
  }
  private norm(G:Float64Array):number {let s=0;for(let j=0;j<this.size;j++)s+=G[j]*G[j];return Math.sqrt(s);}
  /** Preconditioned conjugate gradients for H x = -G. Returns the iteration count, negative when it met a direction without curvature. */
  private conjugateGradient(G:Float64Array,target:number,limit:number):number {
    const x=this.cgX,r=this.cgR,z=this.cgZ,p=this.cgP,ap=this.cgA,diag=this.diag,size=this.size;let rz=0,iterations=0;
    for(let j=0;j<size;j++){x[j]=0;r[j]=-G[j];z[j]=p[j]=r[j]/diag[j];rz+=r[j]*z[j];}
    while(iterations<limit){
      let rr=0;for(let j=0;j<size;j++)rr+=r[j]*r[j];if(Math.sqrt(rr)<=target)break;
      this.product(p,ap);let pap=0;for(let j=0;j<size;j++)pap+=p[j]*ap[j];
      if(!(pap>0)){if(iterations===0)for(let j=0;j<size;j++)x[j]=z[j];return -(iterations+1);}
      const step=rz/pap;let next=0;
      for(let j=0;j<size;j++){x[j]+=step*p[j];r[j]-=step*ap[j];z[j]=r[j]/diag[j];next+=r[j]*z[j];}
      const ratio=next/rz;rz=next;iterations++;
      for(let j=0;j<size;j++)p[j]=z[j]+ratio*p[j];
    }
    return iterations;
  }
  /** Newton's method on Phi from the present z. Adds to the iteration counts in `stats`. */
  private minimise():boolean {
    const st=this.stats,size=this.size,z=this.z;let tol=Infinity,ftol=Infinity,maxNewton=0,maxLinear=0,volume=0;
    this.solids.forEach((s,b)=>{const k=this.k[b];tol=Math.min(tol,k.tolerance);ftol=Math.min(ftol,k.forceTolerance);maxNewton=Math.max(maxNewton,k.maxNewtonIterations);maxLinear=Math.max(maxLinear,k.maxLinearIterations);volume+=s.mu*s.referenceVolume;});
    let phi=this.objective(z,this.G),residual=this.norm(this.G),iterations=0;const first=this.reference;
    if(!(phi<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted at the start of the solve. Use a smaller time step or a softer contact.');
    st.converged=false;
    for(;;){
      // The contact forces belong to the force scale: a block at rest on another carries its weight through them.
      let spring=0;for(let c=0;c<this.count;c++)if(this.act[c]){const w=this.cK[c]*this.contactGap(c,z);spring+=w*w;}
      const reference=Math.max(first,this.reference,Math.sqrt(spring)),tolerance=ftol+tol*reference;st.residual=residual;st.reference=reference;
      if(residual<=tolerance){st.converged=true;break;}
      if(iterations>=maxNewton)break;
      iterations++;st.newtonIterations++;
      this.precondition();
      const inner=this.conjugateGradient(this.G,Math.max(.1*tolerance,Math.min(.1,Math.sqrt(residual/reference))*residual),maxLinear);
      st.linearIterations+=Math.abs(inner);
      const x=this.cgX;let slope=0;for(let j=0;j<size;j++)slope+=this.G[j]*x[j];
      if(!(slope<0))break;
      let accepted=false,trialPhi=0,trialResidual=0;
      for(let search=0,t=1;search<48;search++,t*=.5){
        for(let j=0;j<size;j++)this.trial[j]=z[j]+t*x[j];
        trialPhi=this.objective(this.trial,this.Gt);
        if(!(trialPhi<Infinity))continue;
        trialResidual=this.norm(this.Gt);
        if(trialPhi<=phi+1e-4*t*slope||(trialResidual<residual&&Math.abs(trialPhi-phi)<=1e-10*Math.max(Math.abs(phi),Math.abs(trialPhi))+1e-14*volume)){accepted=true;break;}
      }
      if(!accepted)break;
      if(!Number.isFinite(trialPhi)||!Number.isFinite(trialResidual))throw new EngineError('NUMERICAL_FAILURE','The contact solve produced a nonfinite state.');
      z.set(this.trial);const swap=this.G;this.G=this.Gt;this.Gt=swap;phi=trialPhi;residual=trialResidual;
    }
    // Leave the stored tangents and modes at z (the last evaluation may have been a rejected trial).
    this.objective(z,this.Gt);
    return st.converged;
  }
  /** Gap of contact c at y. */
  private contactGap(c:number,y:Float64Array):number {
    const u0=this.u0,o=3*c,N=this.cN;let px=0,py=0,pz=0;
    for(let q=this.cStart[c];q<this.cStart[c+1];q++){const m=this.cIdx[q],w=this.cW[q];px+=w*(y[m]-u0[m]);py+=w*(y[m+1]-u0[m+1]);pz+=w*(y[m+2]-u0[m+2]);}
    return this.cGap[c]+N[o]*px+N[o+1]*py+N[o+2]*pz;
  }
  /** Normal forces of the present z, and how far the friction limits mu N are from the ones in use (v2: largest change, largest limit). With `apply` the new limits replace them. */
  private updateCaps(apply:boolean):void {
    let change=0,largest=0;
    for(let c=0;c<this.count;c++){
      const gap=this.contactGap(c,this.z),force=gap<0?-this.cK[c]*gap:0,cap=this.cMu[c]*force;
      change=Math.max(change,Math.abs(cap-this.cCap[c]));largest=Math.max(largest,cap);if(apply)this.cCap[c]=cap;
    }
    this.v2[0]=change;this.v2[1]=largest;
  }
  private solve():boolean {
    const st=this.stats;st.newtonIterations=0;st.linearIterations=0;st.frictionPasses=0;
    let ok=true,settled=false,friction=false;for(let c=0;c<this.count&&!friction;c++)friction=this.cMu[c]>0;
    for(let pass=0;pass<this.frictionPasses;pass++){
      ok=this.minimise();st.frictionPasses++;
      this.updateCaps(false);
      if(!friction||this.v2[0]<=this.frictionTolerance*this.v2[1]+1e-300){settled=true;break;}
      if(pass+1<this.frictionPasses)this.updateCaps(true);
    }
    return ok&&settled;
  }
  /** Forces on the nodes from the springs of the converged state; the friction springs of the slots are left where the contacts are (sliding ones dragged along), the others relaxed. */
  private collect():void {
    const z=this.z,u0=this.u0,N=this.cN,S=this.cStart,I=this.cIdx,W=this.cW,out=this.nodeForce;out.fill(0);
    const marked=this.marked;marked.fill(0);let contacts=0,edges=0,work=0;
    for(let c=0;c<this.count;c++){
      const o=3*c,k=this.cK[c],slot=this.cSlot[c];let px=0,py=0,pz=0;
      for(let q=S[c];q<S[c+1];q++){const m=I[q],w=W[q];px+=w*(z[m]-u0[m]);py+=w*(z[m+1]-u0[m+1]);pz+=w*(z[m+2]-u0[m+2]);}
      const nx=N[o],ny=N[o+1],nz=N[o+2],gap=this.cGap[c]+nx*px+ny*py+nz*pz;let fx=0,fy=0,fz=0,sx=0,sy=0,sz=0;
      const force=gap<0?-k*gap:0;this.cForce[c]=force;
      if(gap<0){fx=force*nx;fy=force*ny;fz=force*nz;contacts++;if(slot<0)edges++;}
      const cap=this.cCap[c];
      if(cap>0&&gap<0){
        sx=this.cF0[o]+px;sy=this.cF0[o+1]+py;sz=this.cF0[o+2]+pz;const along=nx*sx+ny*sy+nz*sz;sx-=along*nx;sy-=along*ny;sz-=along*nz;
        const slip=Math.hypot(sx,sy,sz);
        if(k*slip>cap){const r=cap/(k*slip);sx*=r;sy*=r;sz*=r;}
        fx-=k*sx;fy-=k*sy;fz-=k*sz;
      }
      this.cTan[o]=sx;this.cTan[o+1]=sy;this.cTan[o+2]=sz;
      if(slot>=0){marked[slot]=1;this.slotForce[slot]=force;this.anchor[3*slot]=sx;this.anchor[3*slot+1]=sy;this.anchor[3*slot+2]=sz;}
      work+=fx*px+fy*py+fz*pz;
      for(let q=S[c];q<S[c+1];q++){const m=I[q],w=W[q];out[m]+=w*fx;out[m+1]+=w*fy;out[m+2]+=w*fz;}
    }
    for(let s=0;s<marked.length;s++)if(!marked[s]){this.slotForce[s]=0;this.anchor[3*s]=0;this.anchor[3*s+1]=0;this.anchor[3*s+2]=0;}
    // The edge contacts that press, sorted by key, for the next step.
    const pressing:number[]=[];for(let c=0;c<this.count;c++)if(this.cSlot[c]<0&&this.cForce[c]>0)pressing.push(c);
    pressing.sort((p,q)=>this.cKey[p]-this.cKey[q]);
    this.eCount=pressing.length;this.eKey=grown(this.eKey,edges);this.eAnchor=grown(this.eAnchor,3*edges);this.eForce=grown(this.eForce,edges);
    pressing.forEach((c,i)=>{this.eKey[i]=this.cKey[c];this.eForce[i]=this.cForce[c];for(let q=0;q<3;q++)this.eAnchor[3*i+q]=this.cTan[3*c+q];});
    this.stats.contacts=contacts;this.stats.edgeContacts=edges;this.contactWork+=work;
  }
  private loads():void {
    for(let b=0;b<this.solids.length;b++){const f=this.k[b].loads();this.fext.set(f,this.offset[b]);this.k[b].applyConstraints();}
  }

  /** Advance every solid by `count` backward-Euler steps of the common dt. */
  step(count=1):void {
    if(!Number.isInteger(count)||count<0)fail('count must be a whole number.');
    const h=this.dt,z=this.z;this.loads();
    for(let s=0;s<count;s++){
      this.h=h;this.staticMode=false;this.cm=1/(h*h);let inertia=0;const closing:number[]=[];
      for(let b=0;b<this.solids.length;b++){
        const solid=this.solids[b],k=this.k[b],o=this.offset[b],u=solid.displacements,v=solid.velocities,mass=solid.nodalMass;let fastest=0;
        this.cd[b]=k.massDamping>0||k.stiffnessDamping>0?1/h:0;
        for(let j=0;j<u.length;j++){this.u0[o+j]=u[j];this.target[o+j]=u[j]+h*v[j];const mv=this.cm*mass[(j-j%3)/3]*h*v[j];inertia+=mv*mv;z[o+j]=u[j];}
        for(let n=0;n<solid.nodeCount;n++)fastest=Math.max(fastest,Math.hypot(v[3*n],v[3*n+1],v[3*n+2]));
        closing.push(h*fastest+.5*h*h*Math.hypot(k.gravity[0],k.gravity[1],k.gravity[2]));
        k.holdDampingTangent();
      }
      this.referenceInertia=Math.sqrt(inertia);
      this.detect(this.u0,closing);
      const ok=this.solve();if(!ok)this.stats.unconvergedSteps++;
      for(let b=0;b<this.solids.length;b++){
        const solid=this.solids[b],k=this.k[b],o=this.offset[b],u=solid.displacements,v=solid.velocities;
        for(let j=0;j<u.length;j++){u[j]=z[o+j];v[j]=k.fixed[j]?0:(z[o+j]-this.u0[o+j])/h;if(!Number.isFinite(u[j]))throw new EngineError('NUMERICAL_FAILURE','The contact step produced a nonfinite state.');}
      }
      this.collect();
      for(let b=0;b<this.solids.length;b++)this.k[b].advance(this.stats.converged);
    }
  }
  /** Static equilibrium of the solids under the present loads, constraints and contacts: Newton solves with the contact
   * geometry found again from each answer, until the displacements change by less than `tolerance` of the largest. Bodies
   * that nothing but contact holds are singular: support each one (constraints, symmetry planes). */
  solveStatic(options:{readonly maxPasses?:number;readonly tolerance?:number}={}):SolidSolidStaticResult {
    const maxPasses=options.maxPasses===undefined?30:num(options.maxPasses,'maxPasses',1,1e4),tolerance=options.tolerance===undefined?1e-8:num(options.tolerance,'tolerance',0,1);
    const z=this.z,closing=this.solids.map(()=>0);this.loads();this.h=0;this.staticMode=true;this.cm=0;this.referenceInertia=0;
    for(let b=0;b<this.solids.length;b++){this.cd[b]=0;z.set(this.solids[b].displacements,this.offset[b]);}
    let passes=0,change=Infinity,ok=false;const st=this.stats;let newton=0,linear=0;
    while(passes<maxPasses){
      passes++;this.u0.set(z);this.detect(this.u0,closing);
      // Statics has no step to lag over: the friction limits follow the normal forces of the solve before.
      ok=this.solve();newton+=st.newtonIterations;linear+=st.linearIterations;
      let d=0,largest=0;for(let j=0;j<this.size;j++){d=Math.max(d,Math.abs(z[j]-this.u0[j]));largest=Math.max(largest,Math.abs(z[j]));}
      change=largest>0?d/largest:0;
      this.collect();
      if(ok&&change<=tolerance)break;
    }
    st.newtonIterations=newton;st.linearIterations=linear;
    for(let b=0;b<this.solids.length;b++){const solid=this.solids[b],o=this.offset[b];solid.displacements.set(z.subarray(o,o+3*solid.nodeCount));solid.velocities.fill(0);this.k[b].commit();}
    const converged=ok&&change<=tolerance;if(!converged)st.unconvergedSteps++;
    return {converged,passes,residual:st.residual,change};
  }

  // ---- Results ----

  /** Net force (N) that body `a` got in the last solve from its contacts with body `b` (a plane is -1 - its index; leave `b`
   * out for everything that touches `a`). Self-contact adds nothing: its forces are internal to the body. */
  contactForce(a:number,b?:number,out:number[]=[0,0,0]):number[] {
    out[0]=out[1]=out[2]=0;
    for(let c=0;c<this.count;c++){
      const A=this.cA[c],B=this.cB[c];
      if(A===B||!((A===a&&(b===undefined||B===b))||(B===a&&(b===undefined||A===b))))continue;
      const force=this.cForce[c];if(!(force>0))continue;
      const o=3*c,k=this.cK[c],sign=A===a?1:-1;
      out[0]+=sign*(force*this.cN[o]-k*this.cTan[o]);out[1]+=sign*(force*this.cN[o+1]-k*this.cTan[o+1]);out[2]+=sign*(force*this.cN[o+2]-k*this.cTan[o+2]);
    }
    return out;
  }
  /** Depth of the deepest contact after the last solve, m (for the mortar, of the weighted gap of a node). */
  maxPenetration():number {let deepest=0;for(let c=0;c<this.count;c++)deepest=Math.max(deepest,-this.contactGap(c,this.z));return deepest;}
  /** Energy stored in the contact and friction springs after the last solve, J. */
  contactEnergy():number {return this.springs(this.z,null);}
  /** Linear momentum of all the solids, kg m/s. */
  linearMomentum(out:number[]=[0,0,0]):number[] {
    out[0]=out[1]=out[2]=0;
    for(const solid of this.solids){const v=solid.velocities,m=solid.nodalMass;for(let n=0;n<solid.nodeCount;n++)for(let c=0;c<3;c++)out[c]+=m[n]*v[3*n+c];}
    return out;
  }
  /** Angular momentum of all the solids about the origin, kg m^2/s. */
  angularMomentum(out:number[]=[0,0,0]):number[] {
    out[0]=out[1]=out[2]=0;
    for(const solid of this.solids){
      const v=solid.velocities,m=solid.nodalMass,X=solid.referencePositions,u=solid.displacements;
      for(let n=0;n<solid.nodeCount;n++){const x=X[3*n]+u[3*n],y=X[3*n+1]+u[3*n+1],zz=X[3*n+2]+u[3*n+2],w=m[n];out[0]+=w*(y*v[3*n+2]-zz*v[3*n+1]);out[1]+=w*(zz*v[3*n]-x*v[3*n+2]);out[2]+=w*(x*v[3*n+1]-y*v[3*n]);}
    }
    return out;
  }
  /** Kinetic plus strain energy of all the solids, J. */
  energy():{kinetic:number;strain:number} {
    let kinetic=0,strain=0;for(const solid of this.solids){kinetic+=solid.kineticEnergy();strain+=solid.strainEnergy();}
    return {kinetic,strain};
  }
}

/** Where the solid–solid contact subsystem runs in a Simulation step, among the other subsystems' orders. */
export const SOLID_SOLID_CONTACT_SUBSYSTEM_ORDER=300;
/**
 * Solids in contact with each other as one subsystem of the stepping loop (simulation.ts): post stage, where a lone
 * `solidSubsystem` runs; its dt may be the step or a whole fraction of it. Do not also register its solids with
 * `solidSubsystem` or `solidContactSubsystem`: they would be stepped twice. Energy: kinetic + strain + load potential of
 * every solid plus the energy in the contact springs. Event: 'unconverged' with {residual, reference}.
 */
export function solidSolidContactSubsystem<W,B>(target:SolidSolidContact,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  if(!(target instanceof SolidSolidContact))throw new EngineError('INVALID_PAYLOAD','solidSolidContactSubsystem needs a SolidSolidContact.');
  let unconverged=target.stats.unconvergedSteps;
  return {
    id:options.id??'solid-solid-contact',kind:'solid-solid-contact',stage:'post',order:options.order??SOLID_SOLID_CONTACT_SUBSYSTEM_ORDER,
    timeStep:{dt:target.dt,rule:'commensurate'},
    validate(info){if(info.timing.every>1)throw new EngineError('INVALID_STATE','Solids in contact cannot step less often than the simulation.');},
    step(ctx){target.step(ctx.substeps);},
    checkpoint(){return {state:target.saveState(),unconverged};},
    restore(state){
      const s=state as {state?:StateValue;unconverged?:unknown}|null;
      if(!s||!s.state||typeof s.unconverged!=='number')throw checkpointError(`Subsystem "${options.id??'solid-solid-contact'}": the saved state is malformed.`);
      target.restoreState(s.state);unconverged=s.unconverged;
    },
    finish(ctx){if(target.stats.unconvergedSteps!==unconverged){unconverged=target.stats.unconvergedSteps;ctx.emit('unconverged',{residual:target.stats.residual,reference:target.stats.reference});}},
    energy(){
      let kinetic=0,strain=0,potential=0;for(const solid of target.solids){kinetic+=solid.kineticEnergy();strain+=solid.strainEnergy();potential+=solid.loadPotential();}
      const springs=target.contactEnergy();
      return {domain:'mechanical',total:kinetic+strain+potential+springs,exchanged:0,parts:{kinetic,strain,loadPotential:potential,contact:springs}};
    },
    diagnostics(){return {solver:target.solver,method:target.method,solids:target.solids.length,nodes:target.solids.reduce((n,s)=>n+s.nodeCount,0),elements:target.solids.reduce((n,s)=>n+s.tetCount,0),planes:target.planeCount,time:target.solids[0].time,maxPenetration:target.maxPenetration(),...target.stats};},
  };
}
