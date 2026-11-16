/**
 * Contact and friction between deformable solids (solid.ts), and of a solid with itself.
 *
 * `SolidSolidContact` advances several `SolidBody` meshes by backward Euler in one Newton solve. One step minimises
 *
 *     Phi = sum_bodies [ W(u) - f_ext.u + sum m |u - u_free|^2 / (2 h^2) ]      each solid's own step
 *         + sum_contacts k <-gap>^2 / 2                                         one-sided springs, node against face
 *         + sum_contacts friction(|slip|)                                       a stick spring capped at mu N
 *
 * over the nodal displacements of all the bodies. A contact joins a surface node of one body (or of the same body:
 * self-contact) to the point of a boundary triangle of the other that was closest to it at the start of the step:
 * gap = n . (x_node - sum xi_i x_i), with the triangle's outward normal n and the point's barycentric weights xi frozen
 * for the step. The energy is then a function of the displacements alone, its tangent is symmetric, and what the node
 * feels the three triangle nodes get back with the weights xi: the contact forces sum to zero exactly. Every pair of
 * bodies is searched both ways (each body's nodes against the other's faces). Fixed planes act on the nodes in the same
 * solve. Friction is the capped stick spring of solid-contact.ts with the limit mu N taken from the previous pass.
 *
 * SI units, float64. See docs/SOLID_CONTACT.md (Deformable against deformable) for the validation and the limits.
 */
import {EngineError} from './contracts.ts';
import {captureFields,checkpointError,restoreFields,type FieldHandler,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {SolidBody,type SolidKernel} from './solid.ts';
import type {Subsystem} from './simulation.ts';

/** The solver id recorded in results and checkpoints: node-to-face penalty contact solved with the solids in one Newton solve (PCG), float64. */
export const SOLID_SOLID_CONTACT_SOLVER_ID='solid-solid-contact-node-face-penalty-newton-pcg-js-f64-v1';

/** Settings of a SolidSolidContact: contact stiffness, skin, friction, which bodies collide with themselves, and the friction passes. */
export interface SolidSolidContactOptions {
  /** Contact springs are this many times stiffer than one layer of elements of the softer body of a pair:
   * k = stiffnessScale (lambda + 2 mu) A / l per node, A the node's share of its surface and l the mean element size. Default 100. */
  readonly stiffnessScale?:number;
  /** Nodes closer to a face than this at the start of a step, plus the distance they can close in the step, get a contact.
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
  /** Node-to-face and node-to-plane contacts pressing after the last solve. */
  contacts:number;
}
/** The result of SolidSolidContact.solveStatic: whether it converged, the passes it took, the final residual and the last change of the friction limits. */
export interface SolidSolidStaticResult {converged:boolean;passes:number;residual:number;change:number}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
function num(value:unknown,label:string,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be a number from ${min} to ${max}.`);
  return value as number;
}
/** A contact needs the face's outward normal and the node's outward normal to be opposed by at least this cosine. */
const FACING=.2;
/** The contact normal at a point of a face is the weighted mean of its three vertex normals, each the area-weighted mean of the
 * faces around the vertex that lie within this cosine of the face (so a sharp edge is not rounded): continuous from facet to facet
 * of a curved surface, the facet's own normal on a flat one. */
const CREASE=Math.cos(Math.PI/6);
/** Self-contact: a node deeper behind a face of its own body than this fraction of the mean element size is not in contact with it. */
const SELF_DEPTH=.25;
/** A node whose closest point of a face lies off the face by more than this fraction of the element size is not over that face. */
const LATERAL=1e-3;
const holders:FieldHandler={
  capture:value=>(value as SolidBody[]).map(s=>s.saveState()),
  restore:(value,state)=>{
    const live=value as SolidBody[],saved=state as StateValue[];
    if(!Array.isArray(saved)||saved.length!==live.length)throw checkpointError(`SolidSolidContact: the checkpoint has ${Array.isArray(saved)?saved.length:'no'} solids, this solver ${live.length}.`);
    for(let i=0;i<live.length;i++)live[i].restoreState(saved[i]);
  },
};
const FIELDS:FieldOptions={label:'SolidSolidContact',skip:['k','grid','vertexFaceStart','vertexFaces'],nested:{solids:holders}};

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

/** Contact between deformable solids, of a solid with itself and with planes: node against face both ways, with Coulomb friction, solved together with the solids in one Newton solve. See docs/SOLID_CONTACT.md. */
export class SolidSolidContact {
  /** Everything a later step reads, the solids included, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,FIELDS);}
  /** Put back a state from `saveState()` of a solver set up the same way (same solids, planes and options). */
  restoreState(state:StateValue):void {restoreFields(this,state,FIELDS);}

  readonly solver=SOLID_SOLID_CONTACT_SOLVER_ID;
  readonly solids:SolidBody[];readonly dt:number;readonly stiffnessScale:number;readonly skin:number;readonly frictionPasses:number;readonly frictionTolerance:number;
  readonly stats:SolidSolidContactStats={converged:true,newtonIterations:0,linearIterations:0,residual:0,reference:0,frictionPasses:0,unconvergedSteps:0,contacts:0};
  /** Work of the contact and friction forces on the solids since construction, J (negative: dissipated by friction). */
  contactWork=0;
  private readonly k:SolidKernel[];
  /** First unknown of each body in the global vector, and the total. */
  private readonly offset:Int32Array;private readonly size:number;
  /** Per body: surface nodes, the mean element size and the contact stiffness per unit of facing area, N/m^3. */
  private readonly surfaceNodes:Uint32Array[]=[];private readonly elementSize:number[]=[];private readonly kArea:number[]=[];
  /** Self-contact: per body, for each node the sorted list of nodes that share a boundary face with it (CSR), or null. */
  private readonly ringStart:(Int32Array|null)[]=[];private readonly ringNodes:(Int32Array|null)[]=[];
  /** Ordered pairs (slave body, master body); master -1 - p is plane p. Each has a block of slots, one per surface node of the slave. */
  private pairSlave:number[]=[];private pairMaster:number[]=[];private pairFriction:number[]=[];private pairStart:number[]=[0];
  private readonly planes:{normal:[number,number,number];point:[number,number,number];friction:number}[]=[];
  private sealed=false;
  /** Per slot (persistent between steps): the friction spring's stretch at the end of the last step and the normal force. */
  private anchor=new Float64Array(0);private slotForce=new Float64Array(0);private marked=new Uint8Array(0);
  /** Per slot: the face the node was paired with last (-1: none). A node keeps its face while no other is closer by more than rounding. */
  private slotFace=new Int32Array(0);
  /** The contacts of the present step (compact lists): slot, global dof of the node and of the three face nodes (-1: a plane), weights, normal, start gap, stiffness, friction limit and coefficient. */
  private count=0;private cSlot=new Int32Array(0);private cNode=new Int32Array(0);private cFace=new Int32Array(0);private cXi=new Float64Array(0);private cN=new Float64Array(0);
  private cGap=new Float64Array(0);private cK=new Float64Array(0);private cCap=new Float64Array(0);private cMu=new Float64Array(0);private cF0=new Float64Array(0);
  /** What the Hessian needs from the last evaluation: pressing, friction mode (0 none, 1 stick, 2 slide), slip direction and length. */
  private act=new Uint8Array(0);private fmode=new Uint8Array(0);private fs=new Float64Array(0);private fsl=new Float64Array(0);
  private readonly z:Float64Array;private G:Float64Array;private Gt:Float64Array;private readonly trial:Float64Array;private readonly cgX:Float64Array;private readonly cgR:Float64Array;private readonly cgZ:Float64Array;private readonly cgP:Float64Array;private readonly cgA:Float64Array;private readonly diag:Float64Array;
  private readonly fint:Float64Array;private readonly u0:Float64Array;private readonly target:Float64Array;private readonly work:Float64Array;private readonly work2:Float64Array;private readonly fext:Float64Array;
  /** Force the contacts put on each node in the last solve, N (global vector: body after body). */
  readonly nodeForce:Float64Array;
  private readonly areaVector:Float64Array;private readonly xNow:Float64Array;
  private h=0;private cm=0;private cd:number[]=[];private reference=0;private referenceInertia=0;private staticMode=false;
  private readonly w3=new Float64Array(3);private readonly v2=[0,0];
  private grid:Map<number,number[]>=new Map();
  /** Per body: the boundary faces around each node (CSR), constants of the mesh. */
  private readonly vertexFaceStart:Int32Array[]=[];private readonly vertexFaces:Int32Array[]=[];private readonly n3=new Float64Array(3);

  constructor(solids:readonly SolidBody[],options:SolidSolidContactOptions={}) {
    if(!Array.isArray(solids)||solids.length<1)fail('SolidSolidContact needs at least one SolidBody.');
    for(const s of solids){
      if(!(s instanceof SolidBody))throw new EngineError('INVALID_PAYLOAD','SolidSolidContact needs SolidBody objects.');
      if(s.integrator!=='backward-euler')fail('A solid in contact needs the backward-euler integrator.');
      if(s.dt!==solids[0].dt)fail('Solids in contact with each other need the same time step.');
    }
    if(new Set(solids).size!==solids.length)fail('A solid is listed twice.');
    this.solids=solids.slice();this.dt=solids[0].dt;this.k=this.solids.map(s=>s.kernel());
    this.stiffnessScale=options.stiffnessScale===undefined?100:num(options.stiffnessScale,'stiffnessScale',1e-3,1e9);
    this.frictionPasses=options.frictionPasses===undefined?12:num(options.frictionPasses,'frictionPasses',1,1000);
    this.frictionTolerance=options.frictionTolerance===undefined?1e-4:num(options.frictionTolerance,'frictionTolerance',0,1);
    const friction=options.friction===undefined?0:num(options.friction,'friction',0,10);
    const offset=this.offset=new Int32Array(this.solids.length+1);let smallest=Infinity;
    this.solids.forEach((solid,b)=>{
      offset[b+1]=offset[b]+3*solid.nodeCount;
      const X=solid.referencePositions,faces=solid.faces,area=new Float64Array(solid.nodeCount);
      for(let f=0;f<faces.length;f+=3){
        const a=3*faces[f],c1=3*faces[f+1],c2=3*faces[f+2],ux=X[c1]-X[a],uy=X[c1+1]-X[a+1],uz=X[c1+2]-X[a+2],vx=X[c2]-X[a],vy=X[c2+1]-X[a+1],vz=X[c2+2]-X[a+2];
        const share=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/6;area[faces[f]]+=share;area[faces[f+1]]+=share;area[faces[f+2]]+=share;
      }
      const surface:number[]=[];for(let i=0;i<solid.nodeCount;i++)if(area[i]>0)surface.push(i);
      const vs=new Int32Array(solid.nodeCount+1);for(let f=0;f<faces.length;f++)vs[faces[f]+1]++;
      for(let n=0;n<solid.nodeCount;n++)vs[n+1]+=vs[n];
      const fill=vs.slice(0,solid.nodeCount),vf=new Int32Array(faces.length);for(let f=0;f<faces.length;f++)vf[fill[faces[f]]++]=(f-f%3)/3;
      this.vertexFaceStart.push(vs);this.vertexFaces.push(vf);
      this.surfaceNodes.push(Uint32Array.from(surface));
      const l=Math.cbrt(6*solid.referenceVolume/solid.tetCount);this.elementSize.push(l);smallest=Math.min(smallest,l);
      this.kArea.push(this.stiffnessScale*(solid.lambda+2*solid.mu)/l);this.cd.push(0);
      this.ringStart.push(null);this.ringNodes.push(null);
    });
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
    if(this.cSlot.length>=n)return;
    const m=Math.max(n,2*this.cSlot.length,64),grow=<T extends Float64Array|Int32Array|Uint8Array>(a:T,per:number):T=>{const b=new (a.constructor as new(n:number)=>T)(per*m);b.set(a);return b;};
    this.cSlot=grow(this.cSlot,1);this.cNode=grow(this.cNode,1);this.cFace=grow(this.cFace,3);this.cXi=grow(this.cXi,3);this.cN=grow(this.cN,3);this.cGap=grow(this.cGap,1);this.cK=grow(this.cK,1);
    this.cCap=grow(this.cCap,1);this.cMu=grow(this.cMu,1);this.cF0=grow(this.cF0,3);this.act=grow(this.act,1);this.fmode=grow(this.fmode,1);this.fs=grow(this.fs,3);this.fsl=grow(this.fsl,1);
  }

  // ---- Contact search ----

  /** Current positions of every node (reference + y) into xNow, and each node's outward area vector into areaVector. */
  private geometry(y:Float64Array):void {
    const x=this.xNow,av=this.areaVector;av.fill(0);
    this.solids.forEach((solid,b)=>{
      const o=this.offset[b],X=solid.referencePositions,faces=solid.faces;
      for(let j=0;j<3*solid.nodeCount;j++)x[o+j]=X[j]+y[o+j];
      for(let f=0;f<faces.length;f+=3){
        const a=o+3*faces[f],c1=o+3*faces[f+1],c2=o+3*faces[f+2],ux=x[c1]-x[a],uy=x[c1+1]-x[a+1],uz=x[c1+2]-x[a+2],vx=x[c2]-x[a],vy=x[c2+1]-x[a+1],vz=x[c2+2]-x[a+2];
        const nx=(uy*vz-uz*vy)/6,ny=(uz*vx-ux*vz)/6,nz=(ux*vy-uy*vx)/6;
        for(const i of [a,c1,c2]){av[i]+=nx;av[i+1]+=ny;av[i+2]+=nz;}
      }
    });
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
  private static key(i:number,j:number,k:number):number {return ((i*73856093)^(j*19349663)^(k*83492791))|0;}
  /** The faces of body b in a grid of cells of size `cell`, each face in every cell its box (grown by `reach`) touches. */
  private fillGrid(b:number,cell:number,reach:number):void {
    const grid=this.grid;grid.clear();const x=this.xNow,o=this.offset[b],faces=this.solids[b].faces,inv=1/cell;
    for(let f=0;f<faces.length;f+=3){
      const a=o+3*faces[f],c1=o+3*faces[f+1],c2=o+3*faces[f+2];
      const i0=Math.floor((Math.min(x[a],x[c1],x[c2])-reach)*inv),i1=Math.floor((Math.max(x[a],x[c1],x[c2])+reach)*inv);
      const j0=Math.floor((Math.min(x[a+1],x[c1+1],x[c2+1])-reach)*inv),j1=Math.floor((Math.max(x[a+1],x[c1+1],x[c2+1])+reach)*inv);
      const k0=Math.floor((Math.min(x[a+2],x[c1+2],x[c2+2])-reach)*inv),k1=Math.floor((Math.max(x[a+2],x[c1+2],x[c2+2])+reach)*inv);
      for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(let k=k0;k<=k1;k++){const key=SolidSolidContact.key(i,j,k);let list=grid.get(key);if(!list){list=[];grid.set(key,list);}list.push(f/3);}
    }
  }
  /** The contacts of a step that starts at y and may move the nodes by `closing` (per body) towards each other. */
  private detect(y:Float64Array,closing:number[]):void {
    this.seal();this.geometry(y);this.count=0;
    const x=this.xNow,av=this.areaVector,w=this.w3,box=(b:number):number[]=>{
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
          const c=this.count++;this.reserve(this.count);
          this.cSlot[c]=start+s;this.cNode[c]=i;this.cFace[3*c]=this.cFace[3*c+1]=this.cFace[3*c+2]=-1;this.cXi[3*c]=this.cXi[3*c+1]=this.cXi[3*c+2]=0;
          this.cN[3*c]=nx;this.cN[3*c+1]=ny;this.cN[3*c+2]=nz;this.cGap[c]=gap;this.cK[c]=k*-facing;this.cMu[c]=mu;
        }
        continue;
      }
      // How far behind a face a node may be and still belong to it. Between two bodies: an element size. Within one body the
      // far side of a thin part faces the node too, through the material: a quarter of an element size.
      const oB=this.offset[B],faces=this.solids[B].faces,lA=this.elementSize[A],lB=this.elementSize[B],reach=this.skin+closing[A]+closing[B],deep=A===B?SELF_DEPTH*lA:Math.max(reach,Math.min(lA,lB));
      const a=boxes[A],b=boxes[B];
      const far=Math.max(reach,deep);
      if(a[0]>b[3]+far||b[0]>a[3]+far||a[1]>b[4]+far||b[1]>a[4]+far||a[2]>b[5]+far||b[2]>a[5]+far)continue;
      const cell=Math.max(2*lB,far),inv=1/cell,kPair=Math.min(this.kArea[A],this.kArea[B]),self=A===B,rs=this.ringStart[A],rn=this.ringNodes[A];
      this.fillGrid(B,cell,far);
      for(let s=0;s<surface.length;s++){
        const node=surface[s],i=oA+3*node,px=x[i],py=x[i+1],pz=x[i+2];
        if(px<b[0]-far||px>b[3]+far||py<b[1]-far||py>b[4]+far||pz<b[2]-far||pz>b[5]+far)continue;
        const list=this.grid.get(SolidSolidContact.key(Math.floor(px*inv),Math.floor(py*inv),Math.floor(pz*inv)));if(!list)continue;
        const ax=av[i],ay=av[i+1],az=av[i+2],an=Math.hypot(ax,ay,az);if(!(an>0))continue;
        let best=-1,bestD=Infinity,bg=0,b0=0,b1=0,b2=0,bnx=0,bny=0,bnz=0,bFacing=0;const last=this.slotFace[start+s],keep=1e-9*lB;
        for(const f of list){
          const n0=faces[3*f],n1=faces[3*f+1],n2=faces[3*f+2];
          if(self){
            // Not the faces around the node, nor a face that shares a node with one of them.
            let near=false;for(let q=rs![node];q<rs![node+1]&&!near;q++){const m=rn![q];near=m===n0||m===n1||m===n2;}
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
        const c=this.count++;this.reserve(this.count);
        this.cSlot[c]=start+s;this.cNode[c]=i;this.cFace[3*c]=oB+3*faces[3*best];this.cFace[3*c+1]=oB+3*faces[3*best+1];this.cFace[3*c+2]=oB+3*faces[3*best+2];
        this.cXi[3*c]=b0;this.cXi[3*c+1]=b1;this.cXi[3*c+2]=b2;this.cN[3*c]=bnx;this.cN[3*c+1]=bny;this.cN[3*c+2]=bnz;this.cGap[c]=bg;this.cK[c]=kPair*bFacing;this.cMu[c]=mu;
      }
    }
    // Friction: each contact starts from its slot's spring stretch (projected on the new plane) and the last normal force.
    for(let c=0;c<this.count;c++){
      const slot=this.cSlot[c],nx=this.cN[3*c],ny=this.cN[3*c+1],nz=this.cN[3*c+2],ex=this.anchor[3*slot],ey=this.anchor[3*slot+1],ez=this.anchor[3*slot+2],along=ex*nx+ey*ny+ez*nz;
      this.cF0[3*c]=ex-along*nx;this.cF0[3*c+1]=ey-along*ny;this.cF0[3*c+2]=ez-along*nz;this.cCap[c]=this.cMu[c]*this.slotForce[slot];
    }
  }

  // ---- The objective, its gradient and Hessian ----

  /** Energy of the contact and friction springs at y; adds its gradient to G and records what the Hessian needs. */
  private springs(y:Float64Array,G:Float64Array|null):number {
    const u0=this.u0,N=this.cN,F=this.cFace,XI=this.cXi;let energy=0;
    for(let c=0;c<this.count;c++){
      const i=this.cNode[c],o=3*c,k=this.cK[c],m0=F[o],m1=F[o+1],m2=F[o+2],x0=XI[o],x1=XI[o+1],x2=XI[o+2];
      let px=y[i]-u0[i],py=y[i+1]-u0[i+1],pz=y[i+2]-u0[i+2];
      if(m0>=0){
        px-=x0*(y[m0]-u0[m0])+x1*(y[m1]-u0[m1])+x2*(y[m2]-u0[m2]);py-=x0*(y[m0+1]-u0[m0+1])+x1*(y[m1+1]-u0[m1+1])+x2*(y[m2+1]-u0[m2+1]);pz-=x0*(y[m0+2]-u0[m0+2])+x1*(y[m1+2]-u0[m1+2])+x2*(y[m2+2]-u0[m2+2]);
      }
      const nx=N[o],ny=N[o+1],nz=N[o+2],gap=this.cGap[c]+nx*px+ny*py+nz*pz;let wx=0,wy=0,wz=0;
      if(gap<0){this.act[c]=1;energy+=.5*k*gap*gap;const w=k*gap;wx=w*nx;wy=w*ny;wz=w*nz;}else this.act[c]=0;
      const cap=this.cCap[c];
      if(cap>0){
        let sx=this.cF0[o]+px,sy=this.cF0[o+1]+py,sz=this.cF0[o+2]+pz;const along=nx*sx+ny*sy+nz*sz;sx-=along*nx;sy-=along*ny;sz-=along*nz;
        const slip=Math.hypot(sx,sy,sz);
        if(k*slip<=cap){this.fmode[c]=1;energy+=.5*k*slip*slip;wx+=k*sx;wy+=k*sy;wz+=k*sz;}
        else{this.fmode[c]=2;energy+=cap*slip-.5*cap*cap/k;const inv=1/slip;this.fs[o]=sx*inv;this.fs[o+1]=sy*inv;this.fs[o+2]=sz*inv;this.fsl[c]=slip;wx+=cap*sx*inv;wy+=cap*sy*inv;wz+=cap*sz*inv;}
      }else this.fmode[c]=0;
      if(G&&(wx!==0||wy!==0||wz!==0)){
        G[i]+=wx;G[i+1]+=wy;G[i+2]+=wz;
        if(m0>=0){G[m0]-=x0*wx;G[m0+1]-=x0*wy;G[m0+2]-=x0*wz;G[m1]-=x1*wx;G[m1+1]-=x1*wy;G[m1+2]-=x1*wz;G[m2]-=x2*wx;G[m2+1]-=x2*wy;G[m2+2]-=x2*wz;}
      }
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
    const N=this.cN,F=this.cFace,XI=this.cXi;
    for(let c=0;c<this.count;c++){
      const mode=this.fmode[c];if(!this.act[c]&&!mode)continue;
      const i=this.cNode[c],o=3*c,k=this.cK[c],m0=F[o],m1=F[o+1],m2=F[o+2],x0=XI[o],x1=XI[o+1],x2=XI[o+2];
      let dx=p[i],dy=p[i+1],dz=p[i+2];
      if(m0>=0){dx-=x0*p[m0]+x1*p[m1]+x2*p[m2];dy-=x0*p[m0+1]+x1*p[m1+1]+x2*p[m2+1];dz-=x0*p[m0+2]+x1*p[m1+2]+x2*p[m2+2];}
      const nx=N[o],ny=N[o+1],nz=N[o+2],dn=nx*dx+ny*dy+nz*dz;let wx=0,wy=0,wz=0;
      if(this.act[c]){wx=k*dn*nx;wy=k*dn*ny;wz=k*dn*nz;}
      if(mode){
        let tx=dx-dn*nx,ty=dy-dn*ny,tz=dz-dn*nz;
        if(mode===1){wx+=k*tx;wy+=k*ty;wz+=k*tz;}
        else{const sx=this.fs[o],sy=this.fs[o+1],sz=this.fs[o+2],ds=sx*tx+sy*ty+sz*tz,r=this.cCap[c]/this.fsl[c];tx-=ds*sx;ty-=ds*sy;tz-=ds*sz;wx+=r*tx;wy+=r*ty;wz+=r*tz;}
      }
      out[i]+=wx;out[i+1]+=wy;out[i+2]+=wz;
      if(m0>=0){out[m0]-=x0*wx;out[m0+1]-=x0*wy;out[m0+2]-=x0*wz;out[m1]-=x1*wx;out[m1+1]-=x1*wy;out[m1+2]-=x1*wz;out[m2]-=x2*wx;out[m2+1]-=x2*wy;out[m2+2]-=x2*wz;}
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
    const N=this.cN,F=this.cFace,XI=this.cXi;
    for(let c=0;c<this.count;c++){
      const mode=this.fmode[c];if(!this.act[c]&&!mode)continue;
      const i=this.cNode[c],o=3*c,k=this.cK[c];
      for(let q=0;q<3;q++){
        const n=N[o+q];let d=this.act[c]?k*n*n:0;
        if(mode===1)d+=k*(1-n*n);else if(mode===2){const s=this.fs[o+q];d+=this.cCap[c]/this.fsl[c]*Math.max(0,1-n*n-s*s);}
        diag[i+q]+=d;
        if(F[o]>=0)for(let m=0;m<3;m++)diag[F[o+m]+q]+=XI[o+m]*XI[o+m]*d;
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
    const u0=this.u0,i=this.cNode[c],o=3*c,F=this.cFace,XI=this.cXi,N=this.cN;let px=y[i]-u0[i],py=y[i+1]-u0[i+1],pz=y[i+2]-u0[i+2];
    if(F[o]>=0)for(let m=0;m<3;m++){const j=F[o+m],w=XI[o+m];px-=w*(y[j]-u0[j]);py-=w*(y[j+1]-u0[j+1]);pz-=w*(y[j+2]-u0[j+2]);}
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
    const z=this.z,u0=this.u0,N=this.cN,F=this.cFace,XI=this.cXi,out=this.nodeForce;out.fill(0);
    const marked=this.marked;marked.fill(0);let contacts=0,work=0;
    for(let c=0;c<this.count;c++){
      const i=this.cNode[c],o=3*c,k=this.cK[c],slot=this.cSlot[c],m0=F[o],m1=F[o+1],m2=F[o+2],x0=XI[o],x1=XI[o+1],x2=XI[o+2];
      let px=z[i]-u0[i],py=z[i+1]-u0[i+1],pz=z[i+2]-u0[i+2];
      if(m0>=0){px-=x0*(z[m0]-u0[m0])+x1*(z[m1]-u0[m1])+x2*(z[m2]-u0[m2]);py-=x0*(z[m0+1]-u0[m0+1])+x1*(z[m1+1]-u0[m1+1])+x2*(z[m2+1]-u0[m2+1]);pz-=x0*(z[m0+2]-u0[m0+2])+x1*(z[m1+2]-u0[m1+2])+x2*(z[m2+2]-u0[m2+2]);}
      const nx=N[o],ny=N[o+1],nz=N[o+2],gap=this.cGap[c]+nx*px+ny*py+nz*pz;let fx=0,fy=0,fz=0;
      marked[slot]=1;
      if(gap<0){const w=-k*gap;fx=w*nx;fy=w*ny;fz=w*nz;this.slotForce[slot]=w;contacts++;}else this.slotForce[slot]=0;
      const cap=this.cCap[c];
      if(cap>0&&gap<0){
        let sx=this.cF0[o]+px,sy=this.cF0[o+1]+py,sz=this.cF0[o+2]+pz;const along=nx*sx+ny*sy+nz*sz;sx-=along*nx;sy-=along*ny;sz-=along*nz;
        const slip=Math.hypot(sx,sy,sz);
        if(k*slip>cap){const r=cap/(k*slip);sx*=r;sy*=r;sz*=r;}
        fx-=k*sx;fy-=k*sy;fz-=k*sz;this.anchor[3*slot]=sx;this.anchor[3*slot+1]=sy;this.anchor[3*slot+2]=sz;
      }else{this.anchor[3*slot]=0;this.anchor[3*slot+1]=0;this.anchor[3*slot+2]=0;}
      work+=fx*px+fy*py+fz*pz;
      out[i]+=fx;out[i+1]+=fy;out[i+2]+=fz;
      if(m0>=0){out[m0]-=x0*fx;out[m0+1]-=x0*fy;out[m0+2]-=x0*fz;out[m1]-=x1*fx;out[m1+1]-=x1*fy;out[m1+2]-=x1*fz;out[m2]-=x2*fx;out[m2+1]-=x2*fy;out[m2+2]-=x2*fz;}
    }
    for(let s=0;s<marked.length;s++)if(!marked[s]){this.slotForce[s]=0;this.anchor[3*s]=0;this.anchor[3*s+1]=0;this.anchor[3*s+2]=0;}
    this.stats.contacts=contacts;this.contactWork+=work;
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
    for(let c=0,p=0;c<this.count;c++){
      const slot=this.cSlot[c];while(this.pairStart[p+1]<=slot)p++;
      const A=this.pairSlave[p],B=this.pairMaster[p];
      if(A===B||!((A===a&&(b===undefined||B===b))||(B===a&&(b===undefined||A===b))))continue;
      const force=this.slotForce[slot];if(!(force>0))continue;
      const o=3*c,k=this.cK[c],sign=A===a?1:-1;
      out[0]+=sign*(force*this.cN[o]-k*this.anchor[3*slot]);out[1]+=sign*(force*this.cN[o+1]-k*this.anchor[3*slot+1]);out[2]+=sign*(force*this.cN[o+2]-k*this.anchor[3*slot+2]);
    }
    return out;
  }
  /** Depth of the deepest contact after the last solve, m. */
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
    diagnostics(){return {solver:target.solver,solids:target.solids.length,nodes:target.solids.reduce((n,s)=>n+s.nodeCount,0),elements:target.solids.reduce((n,s)=>n+s.tetCount,0),planes:target.planeCount,time:target.solids[0].time,maxPenetration:target.maxPenetration(),...target.stats};},
  };
}
