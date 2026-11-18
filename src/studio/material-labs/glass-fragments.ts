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

/** The rig's boxes the fragments collide with (half extents and centres, m): the tray and its walls, the frame's posts, feet
 * and header (glassFixtures, as drawn). Not the clamp pads: they press on the pane's faces, so a shard released from under one
 * would start inside it. */
export function rigColliders(thickness:number):{halfExtents:[number,number,number];position:[number,number,number]}[] {
  return glassFixtures(thickness).filter(f=>f.material!=='chrome'&&f.material!=='rubber').map(f=>({halfExtents:[f.size[0]/2,f.size[1]/2,f.size[2]/2],position:[f.position[0],f.position[1],f.position[2]]}));
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

/** Box3D world of the glass rig. Static bodies: the floor (top at y = 0) and rigColliders: the tray, the frame's posts, feet
 * and header. Fragments are dynamic compound bodies of tile hulls. The
 * pendulum and the glass still held in the frame are not in this world. */
export class GlassFragmentWorld {
  readonly world:NativeWorldBackend;readonly contact=fragmentContact();
  private bodies:NativeBodyHandle[]=[];
  /** Largest overlap of any contact point after a tick (m), and the contact statistics of the last tick. */
  deepest=0;last:NativeContactStats|null=null;
  constructor(pool:NativeWorldPool,thickness:number){
    this.world=pool.createWorld();
    try{
      const w=this.world,rig=this.contact.rig;w.resetWorld({ground:false,gravity:[0,-G,0]});
      const fixed=(halfExtents:[number,number,number],position:[number,number,number],restitution=rig.restitution)=>w.createBody({shape:{kind:'box',halfExtents},type:'static',position,friction:rig.friction,restitution});
      // The floor is not steel and the library has no glass-on-concrete pair: it takes the glass-on-steel friction
      // (unverified for concrete) and no restitution, so shards land and slide as on the old floor instead of bouncing.
      fixed([40,.5,40],[0,-.5,0],0);
      for(const f of rigColliders(thickness))fixed(f.halfExtents,f.position);
    }catch(error){this.world.destroy();throw error;}
  }
  get count():number {return this.bodies.length;}
  /** Adds a released fragment; returns its index. Its mass, centre and inertia are the plate's (explicit mass data), so its
   * momentum and angular momentum at release are the plate's; the hulls only collide. */
  add(f:FragmentRelease):number {
    const t=Math.max(f.thickness,COLLISION_THICKNESS)/2,hull=(corners:ArrayLike<number>)=>{const p:number[]=[];for(let k=0;k<corners.length;k+=3)p.push(corners[k],corners[k+1],corners[k+2]-t,corners[k],corners[k+1],corners[k+2]+t);return p;};
    let groups=f.tiles.map(tile=>Array.from(tile));
    // More tiles than a body can hold: neighbouring tiles (in release order, the plate's node order) are merged into one
    // hull, which covers their union and the gaps between their outlines.
    if(groups.length>CHILDREN){const per=Math.ceil(groups.length/CHILDREN),merged:number[][]=[];for(let k=0;k<groups.length;k+=per)merged.push(groups.slice(k,k+per).flat());groups=merged;}
    const glass=this.contact.glass;
    const shape=groups.length===1?{kind:'hull' as const,points:hull(groups[0])}:{kind:'compound' as const,shapes:groups.map((g):NativeCompoundChild=>({shape:{kind:'hull',points:hull(g)}}))};
    const body=this.world.createBody({shape,position:f.center,...(f.rotation?{rotation:f.rotation}:{}),linearVelocity:f.velocity,angularVelocity:f.angularVelocity,friction:glass.friction,restitution:glass.restitution,bullet:(globalThis as {__bullet?:boolean}).__bullet===true,
      massData:{mass:f.mass,center:[0,0,0],inertia:f.inertia}});
    if(!body)throw new Error('The fragment world is full.');
    this.bodies.push(body);return this.bodies.length-1;
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
