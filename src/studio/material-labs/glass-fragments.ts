// Released glass fragments as rigid bodies in a Box3D world (src/engine/native-world.ts, the native world the kit and the
// Physics Lab use): convex tile hulls that collide with each other, the rig's frame and tray, and the floor. See
// docs/STUDIO_MATERIAL_LABS.md (Glass impact, fragments).
import {NativeWorldPool,type NativeWorldBackend,type NativeBodyHandle,type NativeCompoundChild,type NativeContactStats} from '../../engine/native-world';
import {contactPair} from '../../engine/materials';
import {glassFixtures} from './glass-rig';

const G=9.81;
/** Box3D steps per 1/120 s tick, and sub-steps per step. Box3D finds contacts once per step and keeps them within 4 linear
 * slops (20 mm) of touching, so a step must not carry a fragment further: a shard lands at up to 7.5 m/s (2.8 m of fall),
 * 7.8 mm in 1/960 s. With one 1/120 s step of 4 sub-steps a falling shard went 40 mm into the tray before its contact was
 * found. Four sub-steps per step hold the toughened pane's pile of 567 tiles (with one, its tiles sank 7 mm into the tray). */
export const FRAGMENT_STEPS=8;
export const FRAGMENT_SUBSTEPS=4;
/** Thickness of a fragment's collision hulls, at least, m. Box3D keeps contacts within a 5 mm linear slop and finds them within
 * 20 mm; between 8 mm hulls a shard landing edge first on one lying flat went through it (overlaps of the full thickness in
 * the radial preset), with 16 mm hulls no two drawn shards overlap by more than 0.5 mm. So thin glass collides as 16 mm and
 * rests 4 mm above what it lies on. */
export const COLLISION_THICKNESS=.016;
/** Most convex children one Box3D body holds (NATIVE_COMPOUND_LIMIT). */
const CHILDREN=64;

/** Coulomb friction and restitution of the fragments' contacts, from the material library. Box3D mixes two shapes'
 * friction as sqrt(f_a f_b) and their restitution as max(e_a, e_b), so the fragments carry the glass-on-glass values and the
 * rig's bodies the numbers that give the glass-on-steel pair. */
export function fragmentContact():{glass:{friction:number;restitution:number};rig:{friction:number;restitution:number};pairs:{glassGlass:{friction:number;restitution:number|null};glassSteel:{friction:number;restitution:number}}} {
  const gg=contactPair('soda-lime-glass','soda-lime-glass'),gs=contactPair('soda-lime-glass','structural-steel-s355');
  if(gg.friction===null||gs.friction===null||gs.restitution===null)throw new Error('The material library lacks a glass contact value.');
  // Glass on glass: static friction 0.95 (no restitution in the library: 0, the fragments do not bounce off each other).
  // Glass on steel: static friction 0.6, restitution 0.71 (a glass ball on a steel plate, 3.1 to 4.4 m/s).
  return {glass:{friction:gg.friction,restitution:0},rig:{friction:gs.friction*gs.friction/gg.friction,restitution:gs.restitution},
    pairs:{glassGlass:{friction:gg.friction,restitution:gg.restitution},glassSteel:{friction:gs.friction,restitution:gs.restitution}}};
}

/** The held glass collides as tiles whose outlines are this much wider, m. Box3D lets touching shapes overlap by up to its
 * linear slop (5 mm); a shard against a crack face of the held glass overlaps it in the plane of the pane, where its hull is
 * no thicker than the glass, so without the margin a drawn shard went 2.1 mm into the drawn pane (frosted fracture). */
export const HELD_MARGIN=.0025;
/** A held tile's collision outline: its four corners (relative to its node, 12 numbers) moved out from their centre so that
 * the edges of a square tile move out by `margin`. */
export function heldOutline(corners:ArrayLike<number>,margin=HELD_MARGIN):Float64Array {
  const out=Float64Array.from(corners as ArrayLike<number>);let cx=0,cy=0;for(let k=0;k<12;k+=3){cx+=corners[k]/4;cy+=corners[k+1]/4;}
  for(let k=0;k<12;k+=3){const dx=corners[k]-cx,dy=corners[k+1]-cy,l=Math.hypot(dx,dy);if(l>0){out[k]+=dx/l*margin*Math.SQRT2;out[k+1]+=dy/l*margin*Math.SQRT2;}}
  return out;
}
/** Collision categories of the fragments' world. Fragments collide with everything; the rig (floor, tray, frame), the clamps
 * (the pads and the glass still held in the frame) and the pendulum's bob only with fragments. */
export const CATEGORY={fragment:1n,rig:2n,clamp:4n,bob:8n} as const;
const EVERYTHING=CATEGORY.fragment|CATEGORY.rig|CATEGORY.clamp|CATEGORY.bob;

/** The rig's boxes the fragments collide with (half extents and centres, m): the tray and its walls, the frame's posts, feet
 * and header (glassFixtures, as drawn). The clamp pads are `padColliders`. */
export function rigColliders(thickness:number):{halfExtents:[number,number,number];position:[number,number,number]}[] {
  return glassFixtures(thickness).filter(f=>f.material!=='chrome'&&f.material!=='rubber').map(f=>({halfExtents:[f.size[0]/2,f.size[1]/2,f.size[2]/2],position:[f.position[0],f.position[1],f.position[2]]}));
}
/** The clamp pads as drawn (glassFixtures: the chrome blocks and rubber faces on both faces of the pane): they press on the
 * pane, so a shard released from under one starts inside it (GlassFragmentWorld.add, `clearOf`). */
export function padColliders(thickness:number):{halfExtents:[number,number,number];position:[number,number,number]}[] {
  return glassFixtures(thickness).filter(f=>f.material==='chrome'||f.material==='rubber').map(f=>({halfExtents:[f.size[0]/2,f.size[1]/2,f.size[2]/2],position:[f.position[0],f.position[1],f.position[2]]}));
}

type P3=[number,number,number];
/** Rotates v by the unit quaternion q = [x, y, z, w]. */
export function rotateVector(q:readonly number[],v:readonly number[]):P3 {
  const [x,y,z,w]=q,tx=2*(y*v[2]-z*v[1]),ty=2*(z*v[0]-x*v[2]),tz=2*(x*v[1]-y*v[0]);
  return [v[0]+w*tx+y*tz-z*ty,v[1]+w*ty+z*tx-x*tz,v[2]+w*tz+x*ty-y*tx];
}
/** Quaternion [x, y, z, w] of XYZ Euler angles (three.js order: the drawn tiles' rotation). */
export function eulerQuaternion(a:number,b:number,c:number):[number,number,number,number] {
  const c1=Math.cos(a/2),s1=Math.sin(a/2),c2=Math.cos(b/2),s2=Math.sin(b/2),c3=Math.cos(c/2),s3=Math.sin(c/2);
  return [s1*c2*c3+c1*s2*s3,c1*s2*c3-s1*c2*s3,c1*c2*s3+s1*s2*c3,c1*c2*c3-s1*s2*s3];
}
/** The 8 corners of a tile prism: its 4 outline corners (relative to the pose, in the pose's x-y plane) at -half and +half along
 * the pose's z, in world coordinates. */
export function tilePrism(corners:ArrayLike<number>,offset:number,position:readonly number[],rotation:readonly number[],half:number):P3[] {
  const out:P3[]=[];
  for(const dz of [-half,half])for(let c=0;c<4;c++){const i=offset+3*c,p=rotateVector(rotation,[corners[i],corners[i+1],corners[i+2]+dz]);out.push([position[0]+p[0],position[1]+p[1],position[2]+p[2]]);}
  return out;
}
/** The 8 corners of a box. */
export function boxPrism(halfExtents:readonly number[],position:readonly number[]):P3[] {
  const out:P3[]=[];for(const z of [-1,1])for(const [x,y] of [[-1,-1],[1,-1],[1,1],[-1,1]])out.push([position[0]+x*halfExtents[0],position[1]+y*halfExtents[1],position[2]+z*halfExtents[2]]);return out;
}
const PRISM_EDGES=[[0,1],[1,2],[2,3],[3,0],[0,4]],PRISM_FACES=[[0,1,2],[0,1,5],[1,2,6],[2,3,7],[3,0,4]];
const sub=(a:P3,b:P3):P3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a:P3,b:P3):P3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
/** Overlap of two prisms of `tilePrism`/`boxPrism` layout (convex; a quadrilateral outline extruded along an edge), m: the
 * smallest overlap of their projections over the separating-axis candidates (face normals and edge cross products); 0 when
 * they are apart. */
export function prismOverlap(A:P3[],B:P3[]):number {
  const axes:P3[]=[];
  const add=(n:P3)=>{const l=Math.hypot(n[0],n[1],n[2]);if(l>1e-12)axes.push([n[0]/l,n[1]/l,n[2]/l]);};
  for(const P of [A,B])for(const [a,b,c] of PRISM_FACES)add(cross(sub(P[b],P[a]),sub(P[c],P[a])));
  for(const [a1,a2] of PRISM_EDGES)for(const [b1,b2] of PRISM_EDGES)add(cross(sub(A[a2],A[a1]),sub(B[b2],B[b1])));
  let best=Infinity;
  for(const n of axes){
    let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity;
    for(const p of A){const d=p[0]*n[0]+p[1]*n[1]+p[2]*n[2];if(d<a0)a0=d;if(d>a1)a1=d;}
    for(const p of B){const d=p[0]*n[0]+p[1]*n[1]+p[2]*n[2];if(d<b0)b0=d;if(d>b1)b1=d;}
    const o=Math.min(a1,b1)-Math.max(a0,b0);if(o<=0)return 0;if(o<best)best=o;
  }
  return best;
}
/** How deep a point lies inside a prism of `tilePrism` layout (its distance to the nearest face), m; 0 or less outside. */
export function depthInPrism(p:readonly number[],P:P3[]):number {
  let depth=Infinity;const centre:P3=[0,0,0];for(const v of P){centre[0]+=v[0]/8;centre[1]+=v[1]/8;centre[2]+=v[2]/8;}
  for(const [a,b,c] of [...PRISM_FACES,[4,6,5]]){
    const n=cross(sub(P[b],P[a]),sub(P[c],P[a])),l=Math.hypot(n[0],n[1],n[2]);if(l<1e-15)continue;
    // Outward normal: away from the centre.
    const s=(n[0]*(P[a][0]-centre[0])+n[1]*(P[a][1]-centre[1])+n[2]*(P[a][2]-centre[2]))>0?1/l:-1/l;
    const d=-s*(n[0]*(p[0]-P[a][0])+n[1]*(p[1]-P[a][1])+n[2]*(p[2]-P[a][2]));if(d<depth)depth=d;
  }
  return depth;
}
/** Nearest point of a prism of `tilePrism` layout to a point, for a convex outline extruded perpendicular to its plane (a tile),
 * and their distance (0 inside). */
export function nearestOnTile(p:readonly number[],P:P3[]):{point:P3;distance:number} {
  const o=P[0],ex=sub(P[1],P[0]),lx=Math.hypot(...ex),u:P3=[ex[0]/lx,ex[1]/lx,ex[2]/lx],up=sub(P[4],P[0]),h=Math.hypot(...up),n:P3=[up[0]/h,up[1]/h,up[2]/h],v=cross(n,u);
  const local=(q:readonly number[])=>{const d=[q[0]-o[0],q[1]-o[1],q[2]-o[2]];return [d[0]*u[0]+d[1]*u[1]+d[2]*u[2],d[0]*v[0]+d[1]*v[1]+d[2]*v[2],d[0]*n[0]+d[1]*n[1]+d[2]*n[2]];};
  const q=local(p),poly=[0,1,2,3].map(k=>local(P[k]));
  let inside=true,best=Infinity,bx=q[0],by=q[1],sign=0;
  for(let k=0;k<4;k++){
    const a=poly[k],b=poly[(k+1)%4],ex2=b[0]-a[0],ey2=b[1]-a[1],cr=ex2*(q[1]-a[1])-ey2*(q[0]-a[0]);
    if(sign===0&&cr!==0)sign=Math.sign(cr);else if(cr*sign<0)inside=false;
    const t=Math.max(0,Math.min(1,((q[0]-a[0])*ex2+(q[1]-a[1])*ey2)/(ex2*ex2+ey2*ey2||1))),d=Math.hypot(q[0]-a[0]-t*ex2,q[1]-a[1]-t*ey2);
    if(d<best){best=d;bx=a[0]+t*ex2;by=a[1]+t*ey2;}
  }
  if(inside){bx=q[0];by=q[1];}
  const bz=Math.max(0,Math.min(h,q[2])),point:P3=[o[0]+bx*u[0]+by*v[0]+bz*n[0],o[1]+bx*u[1]+by*v[1]+bz*n[1],o[2]+bx*u[2]+by*v[2]+bz*n[2]];
  return {point,distance:Math.hypot(point[0]-p[0],point[1]-p[1],point[2]-p[2])};
}

/** What a fragment brings from the plate: its mass, centre, velocity and spin, its inertia tensor about the centre, and the
 * outlines of its tiles (each a quadrilateral at its node's deflection, relative to the centre), all in metres and SI units. */
export interface FragmentRelease {
  mass:number;center:[number,number,number];velocity:[number,number,number];angularVelocity:[number,number,number];
  /** [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] about the centre, kg m^2 (products as matrix entries). */
  inertia:[number,number,number,number,number,number];
  /** Per tile: 4 corners (x, y, z) relative to the centre; the tile is `thickness` thick about them. */
  tiles:Float64Array[];thickness:number;
  /** Orientation of the body frame, [x, y, z, w]. Default: the plate's (identity). */
  rotation?:[number,number,number,number];
}

/** Box3D world of the glass rig. Static bodies: the floor (top at y = 0), rigColliders (the tray, the frame's posts, feet and
 * header) and padColliders (the clamp pads). Fragments are dynamic compound bodies of tile hulls. The glass still held in the
 * frame is one kinematic hull per tile (`holdTile`, moved with the plate), and the pendulum's bob a dynamic sphere driven by
 * the pendulum each tick (`addBob`, `driveBob`, `bobReaction`). */
export class GlassFragmentWorld {
  readonly world:NativeWorldBackend;readonly contact=fragmentContact();
  private bodies:NativeBodyHandle[]=[];
  /** Largest overlap of any contact point after a tick (m), and the contact statistics of the last tick. */
  deepest=0;last:NativeContactStats|null=null;
  /** Fragments that do not yet collide with the clamps (they started inside a pad or the held glass): index -> true. */
  readonly ignoring=new Set<number>();
  /** Thickness of the hulls of the fragments and of the held glass, m. */
  readonly hull:number;
  private held=new Map<number,NativeBodyHandle>();
  private bob:NativeBodyHandle|null=null;private bobMass=0;private bobInertia=0;private bobSet:{v:P3;w:number}={v:[0,0,0],w:0};
  constructor(pool:NativeWorldPool,thickness:number){
    this.world=pool.createWorld();this.hull=Math.max(thickness,COLLISION_THICKNESS);
    try{
      const w=this.world,rig=this.contact.rig;w.resetWorld({ground:false,gravity:[0,-G,0]});
      if(w.capacityInfo().capacity<4096&&w.capacityInfo().growable)w.reserveBodyCapacity(4096);
      const fixed=(halfExtents:[number,number,number],position:[number,number,number],restitution:number,category:bigint)=>w.createBody({shape:{kind:'box',halfExtents},type:'static',position,friction:rig.friction,restitution,filter:{categoryBits:category,maskBits:CATEGORY.fragment}});
      // The floor is not steel and the library has no glass-on-concrete pair: it takes the glass-on-steel friction
      // (unverified for concrete) and no restitution, so shards land and slide as on the old floor instead of bouncing.
      fixed([40,.5,40],[0,-.5,0],0,CATEGORY.rig);
      for(const f of rigColliders(thickness))fixed(f.halfExtents,f.position,rig.restitution,CATEGORY.rig);
      // The pads: chrome blocks and rubber faces, with the glass-on-steel values (no glass-on-rubber pair in the library).
      for(const f of padColliders(thickness))fixed(f.halfExtents,f.position,rig.restitution,CATEGORY.clamp);
    }catch(error){this.world.destroy();throw error;}
  }
  get count():number {return this.bodies.length;}
  /** Adds a released fragment; returns its index. Its mass, centre and inertia are the plate's (explicit mass data), so its
   * momentum and angular momentum at release are the plate's; the hulls only collide. `clamps: false`: it starts inside a
   * clamp (a pad or the held glass) and collides with none until `collideWithClamps`. */
  add(f:FragmentRelease,clamps=true):number {
    const t=this.hull/2,hull=(corners:ArrayLike<number>)=>{const p:number[]=[];for(let k=0;k<corners.length;k+=3)p.push(corners[k],corners[k+1],corners[k+2]-t,corners[k],corners[k+1],corners[k+2]+t);return p;};
    let groups=f.tiles.map(tile=>Array.from(tile));
    // More tiles than a body can hold: neighbouring tiles (in release order, the plate's node order) are merged into one
    // hull, which covers their union and the gaps between their outlines.
    if(groups.length>CHILDREN){const per=Math.ceil(groups.length/CHILDREN),merged:number[][]=[];for(let k=0;k<groups.length;k+=per)merged.push(groups.slice(k,k+per).flat());groups=merged;}
    const glass=this.contact.glass;
    const shape=groups.length===1?{kind:'hull' as const,points:hull(groups[0])}:{kind:'compound' as const,shapes:groups.map((g):NativeCompoundChild=>({shape:{kind:'hull',points:hull(g)}}))};
    const body=this.world.createBody({shape,position:f.center,...(f.rotation?{rotation:f.rotation}:{}),linearVelocity:f.velocity,angularVelocity:f.angularVelocity,friction:glass.friction,restitution:glass.restitution,bullet:(globalThis as {__bullet?:boolean}).__bullet===true,
      massData:{mass:f.mass,center:[0,0,0],inertia:f.inertia},filter:{categoryBits:CATEGORY.fragment,maskBits:clamps?EVERYTHING:EVERYTHING&~CATEGORY.clamp}});
    if(!body)throw new Error('The fragment world is full.');
    this.bodies.push(body);if(!clamps)this.ignoring.add(this.bodies.length-1);return this.bodies.length-1;
  }
  /** A fragment that started inside a clamp collides with the clamps from now on. */
  collideWithClamps(index:number):void {if(this.ignoring.delete(index))this.world.setBodyFilter(this.bodies[index],CATEGORY.fragment,EVERYTHING);}
  /** The tile of a node of the glass still held in the frame, as a kinematic hull (its four corners relative to the pose, in
   * the pose's x-y plane, widened by HELD_MARGIN, `hull` thick) that collides with fragments only. Glass on glass. */
  holdTile(node:number,corners:ArrayLike<number>,position:P3,rotation:[number,number,number,number]):void {
    if(this.held.has(node))return;const t=this.hull/2,points:number[]=[];corners=heldOutline(corners);
    for(let k=0;k<12;k+=3)points.push(corners[k],corners[k+1],corners[k+2]-t,corners[k],corners[k+1],corners[k+2]+t);
    const glass=this.contact.glass,body=this.world.createBody({shape:{kind:'hull',points},type:'kinematic',position,rotation,friction:glass.friction,restitution:glass.restitution,filter:{categoryBits:CATEGORY.clamp,maskBits:CATEGORY.fragment}});
    if(!body)throw new Error('The fragment world is full.');this.held.set(node,body);
  }
  /** Moves a held tile to a pose over `seconds` (its velocity for the next step), or at once with no velocity (`seconds` 0). */
  moveTile(node:number,position:P3,rotation:[number,number,number,number],seconds:number):void {
    const body=this.held.get(node);if(!body)return;
    if(seconds>0)this.world.setBodyTarget(body,position,rotation,seconds);else{this.world.setBodyTransform(body,position,rotation);this.world.setBodyVelocity(body,[0,0,0],[0,0,0]);}
  }
  /** Stops a held tile where it is. */
  stopTile(node:number):void {const body=this.held.get(node);if(body)this.world.setBodyVelocity(body,[0,0,0],[0,0,0]);}
  /** Removes a held tile (its node has left the plate). */
  dropTile(node:number):void {const body=this.held.get(node);if(body){this.world.destroyBody(body);this.held.delete(node);}}
  isHeld(node:number):boolean {return this.held.has(node);}
  /** The pendulum's bob: a dynamic sphere of the bob's mass and its own moment of inertia about its centre, free only to move in
   * the y-z plane and turn about x (the pendulum's plane), without gravity (the pendulum carries it); it collides with
   * fragments only. Glass-on-steel friction; no restitution: the bob crushes the glass it strikes, as its contact with the
   * pane does (glass-si.ts: a critically damped, never pulling contact), rather than bouncing shards off at 1.7 times its speed. */
  addBob(mass:number,radius:number,position:P3):void {
    if(this.bob)return;const I=.4*mass*radius*radius,rig=this.contact.rig;this.bobMass=mass;this.bobInertia=I;
    const body=this.world.createBody({shape:{kind:'sphere',radius},position,gravityScale:0,neverSleeps:true,friction:rig.friction,restitution:0,
      massData:{mass,center:[0,0,0],inertia:[I,I,I,0,0,0]},filter:{categoryBits:CATEGORY.bob,maskBits:CATEGORY.fragment}});
    if(!body)throw new Error('The fragment world is full.');
    this.world.setBodyMotionLocks(body,{linearX:true,angularY:true,angularZ:true});this.bob=body;
  }
  get hasBob():boolean {return this.bob!==null;}
  /** Puts the bob at a pose with a velocity and a spin about x for the next step. */
  driveBob(position:P3,velocity:P3,spinX:number):void {
    if(!this.bob)return;this.world.setBodyTransform(this.bob,position,[0,0,0,1]);this.world.setBodyVelocity(this.bob,velocity,[spinX,0,0]);this.bobSet={v:[...velocity] as P3,w:spinX};
  }
  /** What the fragments did to the bob over the last step: the impulse m (v' - v) through its centre and the angular impulse
   * about x I (w' - w), from the change of its velocities. */
  bobReaction():{impulse:P3;angularX:number} {
    if(!this.bob)return {impulse:[0,0,0],angularX:0};
    const s=this.world.bodyState(this.bob),v=this.bobSet.v;
    return {impulse:[this.bobMass*(s.linearVelocity[0]-v[0]),this.bobMass*(s.linearVelocity[1]-v[1]),this.bobMass*(s.linearVelocity[2]-v[2])],angularX:this.bobInertia*(s.angularVelocity[0]-this.bobSet.w)};
  }
  step(dt:number):void {
    if(!this.bodies.length)return;
    for(let k=0;k<FRAGMENT_STEPS;k++){this.world.step(dt/FRAGMENT_STEPS,FRAGMENT_SUBSTEPS);this.last=this.world.contactStats();this.deepest=Math.max(this.deepest,this.last.deepestPenetration);}
  }
  state(index:number){return this.world.bodyState(this.bodies[index]);}
  handle(index:number):NativeBodyHandle {return this.bodies[index];}
  /** Total normal force of the contacts in the last sub-step, N. */
  normalForce(dt:number):number {return (this.last?.totalImpulse??0)/(dt/FRAGMENT_STEPS/FRAGMENT_SUBSTEPS);}
  destroy():void {this.world.destroy();}
}
/** Loads box3d.js and box3d.wasm (URLs, as the page serves them) into a pool for the glass worker. */
export async function loadFragmentPool(moduleUrl:string,wasmUrl:string):Promise<NativeWorldPool> {
  const imported=await import(/* @vite-ignore */ moduleUrl) as {default?:(o:object)=>Promise<unknown>};
  if(typeof imported.default!=='function')throw new Error('box3d.js did not export an Emscripten module factory.');
  return new NativeWorldPool(await imported.default({locateFile:()=>wasmUrl}));
}
