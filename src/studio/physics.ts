/** Shared, dependency-free reduced failure model. Y up, right handed, model units.
 * Fixed-step position-based dynamics; these authored coefficients are not material test data.
 * Failure is driven by connection strain/damage, never by the animation clock.
 */
import {CanopyContactSolver,CANOPY_CONTACT,type CanopyContactStats} from './canopy-contact.ts';
import {captureFields,restoreFields,holder,writeCheckpoint as writeStateCheckpoint,readCheckpoint as readStateCheckpoint,type FieldOptions,type StateObject,type StateValue} from '../engine/checkpoint.ts';
import {canopyRig} from './canopy-rig.ts';
import { scaledNorm3 } from './norm3.ts';
import { normalizePress, metalFor, sheetThickness, toolHeightAt, type PressSettings } from './press-settings.ts';
import { StudioPressSI, PRESS_RATED_FORCE } from './press-si.ts';
import { StudioCanopySI, CANOPY_SNOW_PER_LOAD, CANOPY_WIND_PER_UNIT } from './canopy-si.ts';
export type StudyId = 'canopy' | 'plate' | 'bridge';
export type Vec = [number, number, number];
export type LinkKind = 'warp' | 'weft' | 'shear' | 'bend' | 'cable' | 'hanger' | 'deck' | 'crossbeam';
export interface Particle { p: Vec; prev: Vec; rest: Vec; inverseMass: number; strain: number }
export interface Link {
  a: number; b: number; rest: number; original: number; stiffness: number;
  kind: LinkKind; threshold: number; damage: number; broken: boolean; plastic: number;
  dependencies: number[];
}
export interface Face { nodes: [number, number, number]; links: number[] }
/** A bridge particle crossing the river surface. Recorded once per crossing so the
 * renderer can drive splashes, rings and foam from the actual impact point,
 * vertical speed and particle mass (1/inverseMass). Not part of checkpoints. */
export interface WaterImpact { time: number; x: number; z: number; speed: number; mass: number; node: number }
/** Visual river surface in world units (RiverWater sits at this height). */
export const RIVER_SURFACE_Y = -1.48;
/** Downstream current carried by the river shader (+z, units/s). */
export const RIVER_CURRENT = .72;
export interface FailureEvent { time: number; type: 'yield' | 'break' | 'collapse'; message: string; connection: number }
export interface Response { time: number; load: number; deflection: number; strain: number; broken: number; damage: number; plastic: number; phase: string }
export interface PressTelemetry {settings:PressSettings;travel:number;velocity:number;pressure:number;contacts:number;cycle:string}
export interface Snapshot {
  study: StudyId; positions: Float32Array; broken: Uint8Array; strains: Float32Array;
  /** A revision can decrease on replay. The identity encodes the complete broken mask, not just its count. */
  topologyVersion: number; topologyIdentity: string;
  punchY: number; response: Response; press?: PressTelemetry;
  /** The SI bridge's readings (src/studio/si-bridge-study.ts); bridge study on the SI backend only. */
  si?: SiBridgeReadout;
}
/** SI readings of the suspension footbridge for one snapshot. Lengths in mm, forces in kN, stresses in MPa,
 * utilisations as fractions of the stated strengths (minimum breaking force for strands, yield for steel). */
export interface SiBridgeReadout {
  /** Crowd on the deck now, kN/m^2, and wind on the deck, kN/m. */
  crowd: number; wind: number;
  /** Hangers that have failed, and how many of them were cut by the "hangers cut" control (the rest ruptured over
   * their breaking force). */
  hangersFailed: number; hangersCut: number;
  /** Midspan deflection from the dead-load shape (down positive), the largest anywhere, and the largest sideways movement, mm. */
  midspan: number; drop: number; lateral: number;
  maxHanger: number; hangerUtilisation: number; maxMain: number; mainUtilisation: number;
  girderStress: number; girderUtilisation: number; towerUtilisation: number;
  /** Saddle displacement along the bridge (largest of the four), mm. */
  saddle: number;
  /** Hanger tensions, kN: side 0 stations 1..35, then side 1. */
  hangers: number[];
}

export const STUDIO_CHECKPOINT_VERSION = 1;
export const STUDIO_CHECKPOINT_BACKEND = 'studio-pbd-js-v1';
export const STUDIO_SCALED_CHECKPOINT_BACKEND = 'studio-pbd-scaled-norm3-js-v1';
export const STUDIO_CANOPY_CONTACT_BACKEND = 'studio-pbd-canopy-ccd-js-v1';
/** Metal press on the SI press brake: J2 solid, rigid punch and die (src/studio/press-si.ts). */
export const STUDIO_PRESS_SI_BACKEND = 'studio-press-brake-si-v1';
/** Canopy on the calibrated cloth: orthotropic fabric, edge cables, tearing, SI loads (src/studio/canopy-si.ts). */
export const STUDIO_CANOPY_SI_BACKEND = 'studio-canopy-cloth-si-v1';
/** The bridge study on the SI suspension model (src/engine/si-suspension.ts). The PBD topology is kept for drawing. */
export const STUDIO_SI_BRIDGE_BACKEND = 'studio-si-suspension-v1';
export type StudioBackend = typeof STUDIO_CHECKPOINT_BACKEND | typeof STUDIO_SCALED_CHECKPOINT_BACKEND | typeof STUDIO_CANOPY_CONTACT_BACKEND | typeof STUDIO_PRESS_SI_BACKEND | typeof STUDIO_CANOPY_SI_BACKEND | typeof STUDIO_SI_BRIDGE_BACKEND;
/** JSON-safe, full precision solver state. Render snapshots intentionally cannot resume the solver. */
export interface StudioCheckpoint {
  format: 'box3d-studio-checkpoint'; version: typeof STUDIO_CHECKPOINT_VERSION;
  backend: StudioBackend; study: StudyId;
  scene: { identity: string; constructionPress: PressSettings };
  press: PressSettings;
  controls: { load: number; targetLoad: number; strength: number; damping: number; wind: number };
  nodes: Particle[]; links: Link[]; faces: Face[]; supports: number[];
  /** SI backends: the SI solver's exact state (checkpoint.ts container, base64), see SI_STATE_KIND. */
  si?: string;
  state: {
    time: number; punchY: number; topologyVersion: number; maxStrain: number;
    peakDeflection: number; brokenCount: number; yieldedCount: number;
    pressCycle: string; ramVelocity: number; holdElapsed: number; contactCount: number;
    ramBefore: number; collapseRecorded: boolean; firstYield: boolean;
  };
  events: FailureEvent[];
}

export const STUDIES = {
  canopy: { id: 'canopy', title: 'Canopy load study', subtitle: 'Tensile membrane · pressure & wind', theme: 'precision',
    span: 10, depth: 8, supportY: 5.3, cols: 33, rows: 27, floor: 0.025,
    camera: [12.9, 12.8, 14.6] as Vec, target: [0, 3.1, 0] as Vec, fov: 43,
    secondCamera: [-12, 8, 12] as Vec, threshold: 0.22 },
  plate: { id: 'plate', title: 'Metal press lab', subtitle: '16 metals · 10 tools · controlled forming', theme: 'atelier',
    span: 5.2, depth: 4.4, supportY: 3.15, cols: 33, rows: 29, floor: 1.62,
    camera: [3.9, 6.2, 12.7] as Vec, target: [0, 3.5, 0] as Vec, fov: 38,
    secondCamera: [-7.5, 5.2, 8] as Vec, threshold: 0.30 },
  bridge: { id: 'bridge', title: 'Suspension cable study', subtitle: 'Footbridge · progressive connection failure', theme: 'observatory',
    span: 42, depth: 3.8, supportY: 4.8, cols: 37, rows: 4, floor: -1.4,
    camera: [-31, 13, 35] as Vec, target: [-4, 7, 0] as Vec, fov: 48,
    secondCamera: [30, 17, 30] as Vec, threshold: 0.005 },
} as const;

export const FIXED_DT = 1 / 120;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const cableHeight = (u: number) => 7.2 + 6.8 * (2 * u - 1) ** 2;
export function terrainHeight(x: number, z: number): number {
  const bank = Math.max(0, Math.abs(x) - 15.5);
  return -2.1 + Math.min(6, bank * .49) + Math.min(1, bank * .07) *
    (.5 * Math.sin(x * .17 + z * .22) + .27 * Math.sin(z * .41 - x * .3));
}

const PRESS_KEYS = ['metal','thickness','tool','toolScale','angle','pressure','strikeSpeed','stroke','hold'] as const;
const PRESS_CYCLES = ['Ready','Approach','Forming','Pressure limited','Holding','Retracting','Complete'];
const LINK_KINDS = ['warp','weft','shear','bend','cable','hanger','deck','crossbeam'];
function copyPress(target: PressSettings, source: PressSettings): void {
  target.metal=source.metal; target.thickness=source.thickness; target.tool=source.tool;
  target.toolScale=source.toolScale; target.angle=source.angle; target.pressure=source.pressure;
  target.strikeSpeed=source.strikeSpeed; target.stroke=source.stroke; target.hold=source.hold;
}
function sceneIdentity(id: StudyId, press: PressSettings, backend: StudioBackend = STUDIO_CHECKPOINT_BACKEND): string {
  // Exact parameter identity, including the authored profile. Bump the backend ID when solver rules change.
  return JSON.stringify({backend,study:STUDIES[id],
    material:id==='plate'?metalFor(press.metal):null,thickness:id==='plate'?press.thickness:null,
    contact:backend===STUDIO_CANOPY_CONTACT_BACKEND?{parameters:CANOPY_CONTACT,rig:canopyRig(STUDIES.canopy.span,STUDIES.canopy.depth,STUDIES.canopy.supportY)}:undefined});
}
function checkpointAssert(condition: unknown, field: string): asserts condition {
  if(!condition) throw new RangeError(`Invalid Studio checkpoint: ${field}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return value!==null && typeof value==='object' && !Array.isArray(value);
}
function finite(value: unknown, min=-Infinity, max=Infinity): value is number {
  return typeof value==='number' && Number.isFinite(value) && value>=min && value<=max;
}
function integer(value: unknown, min=0, max=Number.MAX_SAFE_INTEGER): value is number {
  return finite(value,min,max) && Number.isSafeInteger(value);
}
function vector(value: unknown): value is Vec {
  return Array.isArray(value) && value.length===3 && value.every(v=>finite(v));
}
function validatePress(value: unknown, field: string): asserts value is PressSettings {
  checkpointAssert(record(value),field);
  const normalized=normalizePress(value);
  for(const key of PRESS_KEYS) checkpointAssert(value[key]===normalized[key],`${field}.${key}`);
}
function overlaps(a: ArrayBufferView, b: ArrayBufferView): boolean {
  return a.buffer===b.buffer && a.byteOffset<b.byteOffset+b.byteLength && b.byteOffset<a.byteOffset+a.byteLength;
}

/** The SI backends: their checkpoints carry the SI solver's exact state in `si`. */
export const STUDIO_SI_BACKENDS: readonly StudioBackend[] = [STUDIO_PRESS_SI_BACKEND, STUDIO_CANOPY_SI_BACKEND, STUDIO_SI_BRIDGE_BACKEND];
/** Kind of the checkpoint.ts container held (base64) in an SI Studio checkpoint's `si`. */
export const SI_STATE_KIND = 'box3d-studio-si';
const toBase64 = (bytes: Uint8Array): string => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
function fromBase64(text: string): Uint8Array {
  let binary: string;
  try { binary = atob(text); } catch { throw new RangeError('Invalid Studio checkpoint: si is not base64'); }
  const out = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i); return out;
}
/** Fields of the press adapter that are state; the rest is its configuration, rebuilt from the scene. */
const PRESS_SI_FIELDS: FieldOptions = { label: 'StudioPressSI', skip: ['geometry', 'material', 'speed', 'modelDt', 'press', 'supportY', 'startY', 'contactY', 'solveSeconds'], nested: { brake: holder } };
const CANOPY_SI_FIELDS: FieldOptions = { label: 'StudioCanopySI', skip: ['corners', 'settled', 'dt', 'baseStrength', 'solveSeconds'], nested: { cloth: holder } };
let siBridgeFactory: (() => FailureSimulation) | undefined;
/** si-bridge-study.ts registers its class here (it extends FailureSimulation, so this module cannot import it). */
export function registerSiBridgeStudy(factory: () => FailureSimulation): void { siBridgeFactory = factory; }

/** Clone first so validation and application operate on the same owned, plain data. */
function readCheckpoint(value: unknown): StudioCheckpoint {
  let data: unknown;
  try { data=structuredClone(value); } catch { throw new RangeError('Invalid Studio checkpoint: expected cloneable data'); }
  checkpointAssert(record(data),'record');
  checkpointAssert(data.format==='box3d-studio-checkpoint','format');
  checkpointAssert(data.version===STUDIO_CHECKPOINT_VERSION,'version');
  checkpointAssert(data.backend===STUDIO_CHECKPOINT_BACKEND||data.backend===STUDIO_SCALED_CHECKPOINT_BACKEND||data.backend===STUDIO_CANOPY_CONTACT_BACKEND||STUDIO_SI_BACKENDS.includes(data.backend as StudioBackend),'backend');
  checkpointAssert(data.study==='canopy'||data.study==='plate'||data.study==='bridge','study');
  checkpointAssert(data.backend!==STUDIO_CANOPY_CONTACT_BACKEND||data.study==='canopy','canopy contact backend study');
  checkpointAssert(data.backend!==STUDIO_CANOPY_SI_BACKEND||data.study==='canopy','SI canopy backend study');
  checkpointAssert(data.backend!==STUDIO_PRESS_SI_BACKEND||data.study==='plate','SI press backend study');
  checkpointAssert(data.backend!==STUDIO_SI_BRIDGE_BACKEND||data.study==='bridge','SI bridge backend study');
  // An SI run resumes only with its solver's state; a legacy run has none.
  checkpointAssert(STUDIO_SI_BACKENDS.includes(data.backend as StudioBackend)?typeof data.si==='string'&&data.si.length>0&&data.si.length<16*1024*1024:data.si===undefined,'si');
  const c=data as unknown as StudioCheckpoint;
  checkpointAssert(record(c.scene),'scene');
  validatePress(c.scene.constructionPress,'scene.constructionPress');
  checkpointAssert(c.scene.identity===sceneIdentity(c.study,c.scene.constructionPress,c.backend),'scene.identity');
  validatePress(c.press,'press');
  checkpointAssert(record(c.controls),'controls');
  for(const key of ['load','targetLoad','strength','damping','wind'] as const) checkpointAssert(finite(c.controls[key]),`controls.${key}`);
  checkpointAssert(Array.isArray(c.nodes)&&c.nodes.length>0,'nodes');
  for(const n of c.nodes) {
    checkpointAssert(record(n)&&vector(n.p)&&vector(n.prev)&&vector(n.rest),'node coordinates');
    checkpointAssert(finite(n.inverseMass,0)&&finite(n.strain,0),'node mass/strain');
  }
  checkpointAssert(Array.isArray(c.links)&&c.links.length>0,'links');
  let broken=0,yielded=0;
  for(const e of c.links) {
    checkpointAssert(record(e)&&integer(e.a,0,c.nodes.length-1)&&integer(e.b,0,c.nodes.length-1)&&e.a!==e.b,'link endpoints');
    checkpointAssert(LINK_KINDS.includes(e.kind),'link kind');
    checkpointAssert(finite(e.rest)&&e.rest>0&&finite(e.original)&&e.original>0,'link rest length');
    checkpointAssert(finite(e.stiffness,0,1)&&finite(e.threshold)&&e.threshold>0,'link parameters');
    checkpointAssert(finite(e.damage,0,1)&&finite(e.plastic,0)&&typeof e.broken==='boolean','link failure state');
    checkpointAssert(!e.broken||e.damage===1,'broken link damage');
    checkpointAssert(Array.isArray(e.dependencies)&&e.dependencies.every(d=>integer(d,-1,c.links.length-1)),'link dependencies');
    if(e.broken)broken++; if(e.plastic>0)yielded++;
  }
  checkpointAssert(Array.isArray(c.faces),'faces');
  for(const f of c.faces) {
    checkpointAssert(record(f)&&Array.isArray(f.nodes)&&f.nodes.length===3&&f.nodes.every(n=>integer(n,0,c.nodes.length-1)),'face nodes');
    checkpointAssert(Array.isArray(f.links)&&f.links.length===3&&f.links.every(e=>integer(e,-1,c.links.length-1)),'face links');
  }
  checkpointAssert(Array.isArray(c.supports)&&c.supports.every(n=>integer(n,0,c.nodes.length-1)),'supports');
  checkpointAssert(new Set(c.supports).size===c.supports.length&&c.supports.every(n=>c.nodes[n].inverseMass===0),'fixed supports');
  checkpointAssert(record(c.state),'state');
  const s=c.state;
  for(const key of ['time','maxStrain','peakDeflection','holdElapsed'] as const) checkpointAssert(finite(s[key],0),`state.${key}`);
  for(const key of ['punchY','ramVelocity','ramBefore'] as const) checkpointAssert(finite(s[key]),`state.${key}`);
  checkpointAssert(integer(s.brokenCount,0,c.links.length)&&s.brokenCount===broken,'state.brokenCount');
  checkpointAssert(integer(s.topologyVersion)&&s.topologyVersion===broken,'state.topologyVersion');
  checkpointAssert(integer(s.yieldedCount,0,c.links.length)&&s.yieldedCount===yielded,'state.yieldedCount');
  checkpointAssert(integer(s.contactCount,0,c.nodes.length*13),'state.contactCount');
  checkpointAssert(PRESS_CYCLES.includes(s.pressCycle),'state.pressCycle');
  // SI backends report yield and failure from their solvers, not from the drawn links' plastic strain and breaks.
  const si=STUDIO_SI_BACKENDS.includes(c.backend);
  checkpointAssert(typeof s.firstYield==='boolean'&&(si||s.firstYield===(yielded>0)),'state.firstYield');
  checkpointAssert(typeof s.collapseRecorded==='boolean','state.collapseRecorded');
  checkpointAssert(Array.isArray(c.events),'events');
  let eventTime=0,yieldEvents=0,collapseEvents=0;
  for(const e of c.events) {
    checkpointAssert(record(e)&&finite(e.time,eventTime,s.time)&&typeof e.message==='string','event time/message');
    checkpointAssert(e.type==='yield'||e.type==='break'||e.type==='collapse','event type');
    checkpointAssert(e.type==='collapse'?e.connection===-1:integer(e.connection,0,c.links.length-1),'event connection');
    if(e.type==='yield'){checkpointAssert(si||c.links[e.connection].plastic>0,'yield event state');yieldEvents++;}
    if(e.type==='break')checkpointAssert(si||c.links[e.connection].broken,'break event state');
    if(e.type==='collapse')collapseEvents++;
    eventTime=e.time;
  }
  checkpointAssert((si?yieldEvents<=1:yieldEvents===(s.firstYield?1:0))&&collapseEvents===(s.collapseRecorded?1:0),'event flags');
  return c;
}

export class FailureSimulation {
  readonly id: StudyId;
  readonly backend: StudioBackend;
  readonly nodes: Particle[] = [];
  readonly links: Link[] = [];
  readonly faces: Face[] = [];
  readonly events: FailureEvent[] = [];
  readonly supports: number[] = [];
  readonly config: typeof STUDIES[StudyId];
  time = 0;
  /** Surface crossings of falling bridge pieces, oldest first (bridge only). */
  readonly waterImpacts: WaterImpact[] = [];
  load = 0;
  targetLoad = .8;
  strength = 1;
  damping = .022;
  wind = .25;
  punchY = 3.7;
  topologyVersion = 0;
  maxStrain = 0;
  peakDeflection = 0;
  brokenCount = 0;
  yieldedCount = 0;
  readonly press:PressSettings;
  pressCycle='Ready';
  private ramVelocity=0;
  private holdElapsed=0;
  private contactCount=0;
  private ramBefore=3.85;
  private edgeMap = new Map<string, number>();
  private collapseRecorded = false;
  private firstYield = false;
  private readonly constructionPress: PressSettings;
  private readonly sceneIdentity: string;
  private snapshotTopologyVersion = -1;
  private snapshotTopologyIdentity = '';
  private activeConstraintIds = new Uint32Array(0);
  private activeConstraintLength = 0;

  private canopyContact?:CanopyContactSolver;
  private canopyBackup?:{nodes:Float64Array;links:Float64Array};
  private canopyFaces: [number,number,number][]=[];
  private canopyFacesVersion=-1;
  get canopyContactStats():Readonly<CanopyContactStats>|undefined {return this.canopyContact?.stats;}
  /** The SI press model (plate study on STUDIO_PRESS_SI_BACKEND). */
  pressSI?:StudioPressSI;
  private linkSection?:Float64Array;private siPlastic=0;private siEroded=0;
  /** The SI canopy (canopy study on STUDIO_CANOPY_SI_BACKEND). */
  canopySI?:StudioCanopySI;
  private canopyOwed=0;private canopyTris:number[]=[];private canopyUse=new Float64Array(0);private canopyTorn=0;
  /** Link index of each edge of each canopy triangle, and the triangles on each link. */
  private linkTris?:number[][];

  get activeConstraintCount(): number { return this.activeConstraintLength; }

  constructor(id: StudyId, press:Partial<PressSettings>={}, backend:StudioBackend=STUDIO_CHECKPOINT_BACKEND) {
    if(backend!==STUDIO_CHECKPOINT_BACKEND&&backend!==STUDIO_SCALED_CHECKPOINT_BACKEND&&backend!==STUDIO_CANOPY_CONTACT_BACKEND&&backend!==STUDIO_PRESS_SI_BACKEND&&backend!==STUDIO_CANOPY_SI_BACKEND&&backend!==STUDIO_SI_BRIDGE_BACKEND)throw new RangeError('Unknown Studio numerical backend');
    if(backend===STUDIO_CANOPY_SI_BACKEND&&id!=='canopy')throw new RangeError('SI canopy backend requires the canopy study');
    if(backend===STUDIO_SI_BRIDGE_BACKEND&&id!=='bridge')throw new RangeError('The SI backend is the bridge study only');
    if(backend===STUDIO_CANOPY_CONTACT_BACKEND&&id!=='canopy')throw new RangeError('Canopy contact backend requires a canopy study');
    if(backend===STUDIO_PRESS_SI_BACKEND&&id!=='plate')throw new RangeError('SI press backend requires the plate study');
    this.backend=backend;
    // Select once so saved legacy runs keep the original hot loop.
    if(backend===STUDIO_SCALED_CHECKPOINT_BACKEND)this.step=this.stepScaledNorm3;
    this.id = id;
    this.press=normalizePress(press);
    this.constructionPress={...this.press};
    this.sceneIdentity=sceneIdentity(id,this.press,this.backend);
    this.config = STUDIES[id];
    if(id==='plate')this.punchY=3.85;
    if (id === 'bridge') this.buildBridge(); else this.buildSurface();
    // The endpoint lookup is used only while authoring faces and dependencies.
    // Keep the resulting topology, without retaining thousands of temporary keys.
    this.edgeMap.clear();
    this.activeConstraintIds = new Uint32Array(this.links.length);
    this.rebuildActiveConstraints();
    if(backend===STUDIO_CANOPY_CONTACT_BACKEND){
      this.canopyContact=new CanopyContactSolver(this.nodes,this.config);
      this.canopyBackup={nodes:new Float64Array(this.nodes.length*7),links:new Float64Array(this.links.length*2)};
      this.collide=()=>{this.canopyContact!.floor();};
      this.step=this.stepCanopyContact;
    }
    if(backend===STUDIO_CANOPY_SI_BACKEND){
      this.canopyTris=this.faces.flatMap(f=>f.nodes);
      this.canopySI=new StudioCanopySI(this.nodes,this.canopyTris,this.config.cols,this.config.rows,1/60,1,this.config.floor);
      this.canopyUse=new Float64Array(this.nodes.length);
      this.linkTris=this.links.map(()=>[]);this.faces.forEach((f,t)=>{for(const l of f.links)if(l>=0)this.linkTris![l].push(t);});
      // The pretensioned sheet under its weight is the starting shape.
      for(let i=0;i<this.nodes.length;i++){const n=this.nodes[i];for(let k=0;k<3;k++){n.p[k]=n.prev[k]=this.canopySI.cloth.positions[3*i+k];}}
      this.step=this.stepCanopySI;
    }
    if(backend===STUDIO_PRESS_SI_BACKEND){
      this.pressSI=new StudioPressSI(this.press,this.config.supportY,this.punchY);this.punchY=this.pressSI.punchY;
      // Section coordinate (m) of both ends of every link, across the bend line.
      const a=this.press.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a);this.linkSection=new Float64Array(2*this.links.length);
      this.links.forEach((e,i)=>{for(const [k,n] of [[0,e.a],[1,e.b]] as const){const r=this.nodes[n].rest;this.linkSection![2*i+k]=(r[0]*c-r[2]*s)*.1;}});
      this.step=this.stepPressSI;this.placeSheetSI();
    }
  }

  /** Canopy on the SI cloth: loads ramp as before (snow kPa = load x 0.5, wind m/s = wind x 15); one cloth step per 1/60 s. */
  private stepCanopySI(dt=FIXED_DT):void {
    if(!(dt>0)||dt>.025||!Number.isFinite(dt))throw new RangeError('Use fixed simulation steps <= 0.025 s');
    const c=this.canopySI!;this.time+=dt;
    this.load+=clamp(this.targetLoad-this.load,-dt*.55,dt*.55);
    c.setStrengthScale(this.strength);
    c.setLoads(this.load*CANOPY_SNOW_PER_LOAD,this.wind*CANOPY_WIND_PER_UNIT);
    this.canopyOwed+=dt;
    while(this.canopyOwed>=c.dt-1e-12){this.canopyOwed-=c.dt;c.step();}
    const x=c.cloth.positions;
    for(let i=0;i<this.nodes.length;i++){const n=this.nodes[i];for(let k=0;k<3;k++){n.prev[k]=n.p[k];n.p[k]=x[3*i+k];}}
    c.utilisation(this.canopyUse,this.canopyTris);this.maxStrain=0;
    for(let i=0;i<this.nodes.length;i++){this.nodes[i].strain=this.canopyUse[i];this.maxStrain=Math.max(this.maxStrain,this.canopyUse[i]);}
    const torn=c.cloth.tornCount;
    if(torn>this.canopyTorn){
      const mask=c.cloth.tornMask,lt=this.linkTris!;
      // A link is drawn broken when every triangle on it has torn.
      for(let l=0;l<this.links.length;l++){const ts=lt[l];if(!this.links[l].broken&&ts.length>0&&ts.every(t=>mask[t]))this.breakLink(l,false);}
      if(this.canopyTorn===0)this.events.push({time:this.time,type:'break',message:`Fabric tears · yarn stress reached ${(c.strengthWarp/1e3).toFixed(0)} kN/m`,connection:0});
      this.canopyTorn=torn;this.firstYield=true;this.rebuildActiveConstraints();
    }
    const def=this.deflection();this.peakDeflection=Math.max(this.peakDeflection,def);
    if(!this.collapseRecorded&&torn>0&&def>2){this.collapseRecorded=true;this.events.push({time:this.time,type:'collapse',message:'Membrane torn through · fabric falling',connection:-1});}
  }
  /** Plate on the SI press brake: the ram cycle and the solved section drawn on the sheet's nodes. */
  private stepPressSI(dt=FIXED_DT):void {
    if(!(dt>0)||dt>.025||!Number.isFinite(dt))throw new RangeError('Use fixed simulation steps <= 0.025 s');
    const si=this.pressSI!;this.time+=dt;
    si.advance(dt,Math.max(0,this.targetLoad*20));
    this.punchY=si.punchY;this.load=si.force/1000;this.pressCycle=si.cycle;
    this.contactCount=si.brake.punchContacts;this.ramVelocity=si.cycle==='Approach'||si.cycle==='Forming'?-si.speed*10:si.cycle==='Retracting'?si.speed*10:0;
    this.placeSheetSI();
    let plastic=0;for(const v of si.brake.body.equivalentPlasticStrain())plastic=Math.max(plastic,v);
    this.siPlastic=plastic;
    if(plastic>0&&!this.firstYield){this.firstYield=true;this.events.push({time:this.time,type:'yield',message:`Yield at ${(si.material.yieldStress!/1e6).toFixed(0)} MPa · permanent set begins`,connection:0});}
    const eroded=si.brake.body.erodedCount;
    if(eroded>0&&this.siEroded===0)this.events.push({time:this.time,type:'break',message:`Ductile crack · plastic strain reached ${(si.material.failureStrain!*100).toFixed(1)}%`,connection:0});
    this.siEroded=eroded;
    // Links that cross a column cracked through the thickness break.
    const cracks=si.crackedIntervals();
    if(cracks.length){
      const ls=this.linkSection!;
      for(let i=0;i<this.links.length;i++){
        if(this.links[i].broken)continue;
        const a=ls[2*i],b=ls[2*i+1],lo=Math.min(a,b),hi=Math.max(a,b);
        for(const [from,to] of cracks)if((lo<=to&&hi>=from)||(lo<=-from&&hi>=-to)){this.breakLink(i,true);break;}
      }
      this.rebuildActiveConstraints();
    }
    this.peakDeflection=Math.max(this.peakDeflection,this.deflection());
  }
  private placeSheetSI():void {
    const si=this.pressSI!,a=this.press.angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),point:[number,number]=[0,0];
    this.maxStrain=0;
    for(const n of this.nodes){
      const u=(n.rest[0]*c-n.rest[2]*s),v=(n.rest[0]*s+n.rest[2]*c),sec=Math.abs(u)*.1;
      si.sectionPoint(sec,point);
      const uu=Math.sign(u)*point[0]*10,y=this.config.supportY+point[1]*10;
      n.prev[0]=n.p[0];n.prev[1]=n.p[1];n.prev[2]=n.p[2];
      n.p[0]=uu*c+v*s;n.p[1]=y;n.p[2]=-uu*s+v*c;
      n.strain=si.plasticAt(sec);this.maxStrain=Math.max(this.maxStrain,n.strain);
    }
  }

  private stepCanopyContact(dt=FIXED_DT):void {
    if(!(dt>0)||dt>.025||!Number.isFinite(dt))throw new RangeError('Use fixed simulation steps <= 0.025 s');
    const contact=this.canopyContact!,backup=this.canopyBackup!;
    // Reusable full-precision rollback storage: rejected CCD never leaves half a tick.
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i],o=i*7;for(let k=0;k<3;k++){backup.nodes[o+k]=n.p[k];backup.nodes[o+3+k]=n.prev[k];}backup.nodes[o+6]=n.strain;
    }
    for(let i=0;i<this.links.length;i++){backup.links[i*2]=this.links[i].damage;backup.links[i*2+1]=Number(this.links[i].broken);}
    const before={time:this.time,load:this.load,punchY:this.punchY,topologyVersion:this.topologyVersion,maxStrain:this.maxStrain,peakDeflection:this.peakDeflection,brokenCount:this.brokenCount,collapseRecorded:this.collapseRecorded,events:this.events.length};
    contact.begin();
    try{
      this.stepScaledNorm3(dt);
      if(this.canopyFacesVersion!==this.topologyVersion){
        this.canopyFaces=this.faces.filter(f=>f.links.every(i=>i<0||!this.links[i].broken)).map(f=>f.nodes);
        this.canopyFacesVersion=this.topologyVersion;
      }
      contact.solve(this.canopyFaces,this.topologyVersion);
      const deflection=this.deflection();this.peakDeflection=Math.max(before.peakDeflection,deflection);
      if(!before.collapseRecorded&&this.collapseRecorded&&deflection<=this.config.supportY*.58){
        const i=this.events.findIndex((e,i)=>i>=before.events&&e.type==='collapse');if(i>=0)this.events.splice(i,1);this.collapseRecorded=false;
      }
    }catch(error){
      for(let i=0;i<this.nodes.length;i++){
        const n=this.nodes[i],o=i*7;for(let k=0;k<3;k++){n.p[k]=backup.nodes[o+k];n.prev[k]=backup.nodes[o+3+k];}n.strain=backup.nodes[o+6];
      }
      for(let i=0;i<this.links.length;i++){this.links[i].damage=backup.links[i*2];this.links[i].broken=!!backup.links[i*2+1];}
      this.time=before.time;this.load=before.load;this.punchY=before.punchY;this.topologyVersion=before.topologyVersion;
      this.maxStrain=before.maxStrain;this.peakDeflection=before.peakDeflection;this.brokenCount=before.brokenCount;
      this.collapseRecorded=before.collapseRecorded;this.events.length=before.events;
      this.canopyFacesVersion=-1;contact.invalidate();this.rebuildActiveConstraints();throw error;
    }
  }

  private rebuildActiveConstraints(): void {
    let count=0;
    for(let i=0;i<this.links.length;i++)if(!this.links[i].broken)this.activeConstraintIds[count++]=i;
    this.activeConstraintLength=count;
  }

  private compactActiveConstraints(): void {
    let count=0;
    for(let i=0;i<this.activeConstraintLength;i++) {
      const id=this.activeConstraintIds[i];
      if(!this.links[id].broken)this.activeConstraintIds[count++]=id;
    }
    this.activeConstraintLength=count;
  }

  private node(x: number, y: number, z: number, fixed = false, inverseMass = 1): number {
    const i = this.nodes.length;
    this.nodes.push({ p: [x,y,z], prev: [x,y,z], rest: [x,y,z], inverseMass: fixed ? 0 : inverseMass, strain: 0 });
    if (fixed) this.supports.push(i);
    return i;
  }

  private link(a: number, b: number, kind: LinkKind, stiffness: number, threshold: number, dependencies: number[] = []): number {
    const i = this.links.length;
    const rest = distance(this.nodes[a].p, this.nodes[b].p);
    this.links.push({ a,b,rest,original:rest,kind,stiffness,threshold,damage:0,broken:false,plastic:0,dependencies });
    this.edgeMap.set([Math.min(a,b),Math.max(a,b)].join(','),i);
    return i;
  }
  private edge(a: number, b: number): number { return this.edgeMap.get([Math.min(a,b),Math.max(a,b)].join(',')) ?? -1; }

  private buildSurface(): void {
    const {cols,rows,span,depth,supportY,threshold} = this.config;
    const plate = this.id === 'plate';
    for (let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const u=i/(cols-1), v=j/(rows-1);
      const fixed=plate ? (i===0||i===cols-1||j===0||j===rows-1) :
        (i===0||i===cols-1)&&(j===0||j===rows-1);
      const sag=plate ? 0 : .85 * (1 - Math.pow(2*u-1,2)*Math.pow(2*v-1,2));
      // Shaped, concave perimeter resembles a tensioned membrane, while all four corners stay on fixtures.
      const x=(u-.5)*span*(plate?1:1-.13*Math.sin(Math.PI*v));
      const z=(v-.5)*depth*(plate?1:1-.13*Math.sin(Math.PI*u));
      this.node(x,supportY-sag+(plate?sheetThickness(this.press)/2:0),z,fixed,plate?1/(metalFor(this.press.metal).density*this.press.thickness/2):1);
    }
    for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const n=j*cols+i;
      if(i<cols-1) this.link(n,n+1,'warp',.95,threshold);
      if(j<rows-1) this.link(n,n+cols,'weft',.95,threshold);
      if(i<cols-1&&j<rows-1) {
        this.link(n,n+cols+1,'shear',plate?.72:.46,threshold*1.15);
        this.link(n+1,n+cols,'shear',plate?.72:.46,threshold*1.15);
      }
    }
    for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const n=j*cols+i;
      if(i<cols-2) this.link(n,n+2,'bend',plate?.45:.055,threshold*1.5,[this.edge(n,n+1),this.edge(n+1,n+2)]);
      if(j<rows-2) this.link(n,n+cols*2,'bend',plate?.45:.055,threshold*1.5,[this.edge(n,n+cols),this.edge(n+cols,n+cols*2)]);
      if(i<cols-1&&j<rows-1) {
        const a=n,b=n+1,c=n+cols,d=c+1;
        this.faces.push({nodes:[a,c,b],links:[this.edge(a,c),this.edge(c,b),this.edge(b,a)]});
        this.faces.push({nodes:[b,c,d],links:[this.edge(b,c),this.edge(c,d),this.edge(d,b)]});
      }
    }
    if(plate){
      const metal=metalFor(this.press.metal),t=this.press.thickness/2;
      for(const e of this.links){e.stiffness=clamp(e.stiffness*metal.stiffness*Math.pow(t,e.kind==='bend'?3:.65),.018,.99);e.threshold*=metal.rupture/.3;}
    }
  }

  private buildBridge(): void {
    const {cols,span,depth,supportY,threshold} = this.config;
    for(let i=0;i<cols;i++) {
      const u=i/(cols-1), x=(u-.5)*span, fixed=i===0||i===cols-1;
      this.node(x,supportY,-depth/2,fixed);
      this.node(x,supportY,depth/2,fixed);
      this.node(x,cableHeight(u),-depth/2,fixed,.25);
      this.node(x,cableHeight(u),depth/2,fixed,.25);
    }
    for(let i=0;i<cols;i++) {
      const n=i*4;
      this.link(n,n+1,'crossbeam',1,.65);
      for(let side=0;side<2;side++) {
        this.link(n+side,n+side+2,'hanger',.98,threshold*1.25);
        if(i<cols-1) {
          this.link(n+side+2,n+side+6,'cable',1,threshold);
          this.link(n+side,n+side+4,'deck',.95,threshold*1.6);
        }
      }
      if(i<cols-1) {
        this.link(n,n+5,'shear',.82,threshold*1.8);
        this.link(n+1,n+4,'shear',.82,threshold*1.8);
      }
    }
  }

  /** Positive load is a model acceleration (cloth/bridge), or 0–5 drive capacity (plate). */
  step(dt = FIXED_DT): void {
    if (!(dt > 0) || dt > .025 || !Number.isFinite(dt)) throw new RangeError('Use fixed simulation steps <= 0.025 s');
    this.time += dt;
    this.load += clamp(this.targetLoad-this.load,-dt*.55,dt*.55);
    const plate=this.id==='plate', bridge=this.id==='bridge';
    const yieldThreshold=plate?metalFor(this.press.metal).yield*this.strength:0;
    const angle=this.press.angle*Math.PI/180,toolCos=Math.cos(angle),toolSin=Math.sin(angle),thickness=sheetThickness(this.press);
    if(plate)this.advanceRam(dt);else this.punchY = Math.max(1.70,3.7-this.load*1.22);
    this.maxStrain=0;
    const dt2=dt*dt, drag=1-clamp(this.damping,0,.2);
    for(let i=0;i<this.nodes.length;i++) {
      const n=this.nodes[i]; n.strain=0;
      if(n.inverseMass===0) continue;
      const x=n.rest[0], z=n.rest[2];
      let ay=plate?-.2:bridge?-2.2:-1.4;
      let ax=0,az=0;
      if(bridge) {
        if(i%4<2) ay-=this.load*18*Math.exp(-(((x-2)/10)**2))*(i%4===1?1.18:1);
        az=this.wind*this.load*1.5*Math.sin(this.time*2+x*.14);
      } else if(!plate) {
        ay-=this.load*11.5*(.82+.18*Math.cos(x*.8)*Math.cos(z*.7));
        ax=this.wind*this.load*4*Math.sin(this.time*2.1+z*.25);
        az=this.wind*this.load*2*Math.cos(this.time*1.7+x*.4);
      }
      for(let k=0;k<3;k++) {
        const old=n.p[k],acceleration=k===0?ax:k===1?ay:az;
        const velocity=clamp((n.p[k]-n.prev[k])*drag,-.25,.25);
        n.p[k]+=velocity+acceleration*dt2;
        n.prev[k]=old;
      }
    }
    if(bridge)this.riverResponse(dt);
    // Contact is applied before and during projection so the punch participates in the load path.
    this.collide(toolCos,toolSin,thickness);
    for(let iteration=0;iteration<12;iteration++) {
      const topologyBefore=this.topologyVersion;
      // Alternate order reduces directional bias without randomizing reproducibility.
      // Stable original IDs preserve forward/reverse ordering and event identities.
      for(let q=0;q<this.activeConstraintLength;q++) {
        const idx=this.activeConstraintIds[iteration%2?this.activeConstraintLength-q-1:q], e=this.links[idx];
        if(e.broken) continue;
        let dependencyBroken=false;
        for(const dependency of e.dependencies)if(dependency>=0&&this.links[dependency].broken){dependencyBroken=true;break;}
        if(dependencyBroken) { this.breakLink(idx,false); continue; }
        const a=this.nodes[e.a],b=this.nodes[e.b], sum=a.inverseMass+b.inverseMass;
        if(sum===0) continue;
        const dx=b.p[0]-a.p[0],dy=b.p[1]-a.p[1],dz=b.p[2]-a.p[2];
        const length=Math.hypot(dx,dy,dz);
        if(length<1e-9) continue;
        const elastic=Math.max(0,length/e.rest-1);
        const total=Math.max(0,length/e.original-1);
        if(iteration===0) {
          const strain=plate?total:elastic;
          a.strain=Math.max(a.strain,strain); b.strain=Math.max(b.strain,strain);
          this.maxStrain=Math.max(this.maxStrain,strain);
          const threshold=e.threshold*this.strength;
          if(strain>threshold*.65) e.damage=Math.min(1,e.damage+dt*2.4*Math.pow(strain/threshold,2));
          if(strain>threshold*1.65||e.damage>=1) { this.breakLink(idx,true); continue; }
          if(plate&&elastic>yieldThreshold&&e.kind!=='bend') {
            e.rest += Math.min(length-e.rest,e.original*.006);
            if(e.plastic===0) this.yieldedCount++;
            e.plastic=e.rest/e.original-1;
            if(!this.firstYield) {
              this.firstYield=true;
              this.events.push({time:this.time,type:'yield',message:'Plastic strain begins · permanent set',connection:idx});
            }
          }
        }
        const corr=(length-e.rest)/length*e.stiffness/sum;
        a.p[0]+=dx*corr*a.inverseMass;b.p[0]-=dx*corr*b.inverseMass;
        a.p[1]+=dy*corr*a.inverseMass;b.p[1]-=dy*corr*b.inverseMass;
        a.p[2]+=dz*corr*a.inverseMass;b.p[2]-=dz*corr*b.inverseMass;
      }
      // Only compact at a projection boundary; deleting during traversal would
      // skip members and change dependent failure ordering.
      if(this.topologyVersion!==topologyBefore)this.compactActiveConstraints();
      this.collide(toolCos,toolSin,thickness);
    }
    if(plate){
      this.ramVelocity=clamp((this.punchY-this.ramBefore)/dt,-this.press.strikeSpeed/100,2.5);
      if(this.pressCycle==='Forming'&&Math.abs(this.ramVelocity)<.002&&this.contactCount>0)this.pressCycle='Pressure limited';
    }
    const def=this.deflection();
    this.peakDeflection=Math.max(this.peakDeflection,def);
    if(!this.collapseRecorded&&this.brokenCount>0&&def>this.config.supportY*(plate?.34:.58)) {
      this.collapseRecorded=true;
      this.events.push({time:this.time,type:'collapse',message:bridge?'Deck support lost · progressive collapse':plate?'Punch penetration · detached fragments':'Membrane support lost · fabric falling',connection:-1});
    }
  }

  // BEGIN GENERATED SCALED STEP
  private stepScaledNorm3(dt = FIXED_DT): void {
    if (!(dt > 0) || dt > .025 || !Number.isFinite(dt)) throw new RangeError('Use fixed simulation steps <= 0.025 s');
    this.time += dt;
    this.load += clamp(this.targetLoad-this.load,-dt*.55,dt*.55);
    const plate=this.id==='plate', bridge=this.id==='bridge';
    const yieldThreshold=plate?metalFor(this.press.metal).yield*this.strength:0;
    const angle=this.press.angle*Math.PI/180,toolCos=Math.cos(angle),toolSin=Math.sin(angle),thickness=sheetThickness(this.press);
    if(plate)this.advanceRam(dt);else this.punchY = Math.max(1.70,3.7-this.load*1.22);
    this.maxStrain=0;
    const dt2=dt*dt, drag=1-clamp(this.damping,0,.2);
    for(let i=0;i<this.nodes.length;i++) {
      const n=this.nodes[i]; n.strain=0;
      if(n.inverseMass===0) continue;
      const x=n.rest[0], z=n.rest[2];
      let ay=plate?-.2:bridge?-2.2:-1.4;
      let ax=0,az=0;
      if(bridge) {
        if(i%4<2) ay-=this.load*18*Math.exp(-(((x-2)/10)**2))*(i%4===1?1.18:1);
        az=this.wind*this.load*1.5*Math.sin(this.time*2+x*.14);
      } else if(!plate) {
        ay-=this.load*11.5*(.82+.18*Math.cos(x*.8)*Math.cos(z*.7));
        ax=this.wind*this.load*4*Math.sin(this.time*2.1+z*.25);
        az=this.wind*this.load*2*Math.cos(this.time*1.7+x*.4);
      }
      for(let k=0;k<3;k++) {
        const old=n.p[k],acceleration=k===0?ax:k===1?ay:az;
        const velocity=clamp((n.p[k]-n.prev[k])*drag,-.25,.25);
        n.p[k]+=velocity+acceleration*dt2;
        n.prev[k]=old;
      }
    }
    if(bridge)this.riverResponse(dt);
    // Contact is applied before and during projection so the punch participates in the load path.
    this.collide(toolCos,toolSin,thickness);
    for(let iteration=0;iteration<12;iteration++) {
      const topologyBefore=this.topologyVersion;
      // Alternate order reduces directional bias without randomizing reproducibility.
      // Stable original IDs preserve forward/reverse ordering and event identities.
      for(let q=0;q<this.activeConstraintLength;q++) {
        const idx=this.activeConstraintIds[iteration%2?this.activeConstraintLength-q-1:q], e=this.links[idx];
        if(e.broken) continue;
        let dependencyBroken=false;
        for(const dependency of e.dependencies)if(dependency>=0&&this.links[dependency].broken){dependencyBroken=true;break;}
        if(dependencyBroken) { this.breakLink(idx,false); continue; }
        const a=this.nodes[e.a],b=this.nodes[e.b], sum=a.inverseMass+b.inverseMass;
        if(sum===0) continue;
        const dx=b.p[0]-a.p[0],dy=b.p[1]-a.p[1],dz=b.p[2]-a.p[2];
        const length=scaledNorm3(dx,dy,dz);
        if(length<1e-9) continue;
        const elastic=Math.max(0,length/e.rest-1);
        const total=Math.max(0,length/e.original-1);
        if(iteration===0) {
          const strain=plate?total:elastic;
          a.strain=Math.max(a.strain,strain); b.strain=Math.max(b.strain,strain);
          this.maxStrain=Math.max(this.maxStrain,strain);
          const threshold=e.threshold*this.strength;
          if(strain>threshold*.65) e.damage=Math.min(1,e.damage+dt*2.4*Math.pow(strain/threshold,2));
          if(strain>threshold*1.65||e.damage>=1) { this.breakLink(idx,true); continue; }
          if(plate&&elastic>yieldThreshold&&e.kind!=='bend') {
            e.rest += Math.min(length-e.rest,e.original*.006);
            if(e.plastic===0) this.yieldedCount++;
            e.plastic=e.rest/e.original-1;
            if(!this.firstYield) {
              this.firstYield=true;
              this.events.push({time:this.time,type:'yield',message:'Plastic strain begins · permanent set',connection:idx});
            }
          }
        }
        const corr=(length-e.rest)/length*e.stiffness/sum;
        a.p[0]+=dx*corr*a.inverseMass;b.p[0]-=dx*corr*b.inverseMass;
        a.p[1]+=dy*corr*a.inverseMass;b.p[1]-=dy*corr*b.inverseMass;
        a.p[2]+=dz*corr*a.inverseMass;b.p[2]-=dz*corr*b.inverseMass;
      }
      // Only compact at a projection boundary; deleting during traversal would
      // skip members and change dependent failure ordering.
      if(this.topologyVersion!==topologyBefore)this.compactActiveConstraints();
      this.collide(toolCos,toolSin,thickness);
    }
    if(plate){
      this.ramVelocity=clamp((this.punchY-this.ramBefore)/dt,-this.press.strikeSpeed/100,2.5);
      if(this.pressCycle==='Forming'&&Math.abs(this.ramVelocity)<.002&&this.contactCount>0)this.pressCycle='Pressure limited';
    }
    const def=this.deflection();
    this.peakDeflection=Math.max(this.peakDeflection,def);
    if(!this.collapseRecorded&&this.brokenCount>0&&def>this.config.supportY*(plate?.34:.58)) {
      this.collapseRecorded=true;
      this.events.push({time:this.time,type:'collapse',message:bridge?'Deck support lost · progressive collapse':plate?'Punch penetration · detached fragments':'Membrane support lost · fabric falling',connection:-1});
    }
  }
  // END GENERATED SCALED STEP

  private advanceRam(dt:number):void {
    this.ramBefore=this.punchY;this.contactCount=0;
    const limit=Math.max(1.65+sheetThickness(this.press),this.config.supportY+sheetThickness(this.press)-this.press.stroke/100);
    if(this.targetLoad<=0||this.pressCycle==='Retracting'||this.pressCycle==='Complete'){
      this.punchY=Math.min(3.85,this.punchY+Math.max(.35,this.press.strikeSpeed/100)*dt);
      this.pressCycle=this.time<dt*2&&this.targetLoad<=0?'Ready':this.punchY>=3.85?'Complete':'Retracting';return;
    }
    if(this.punchY<=limit+.002){
      this.punchY=limit;this.holdElapsed+=dt;this.pressCycle=this.holdElapsed>=this.press.hold?'Retracting':'Holding';return;
    }
    // Dynamic ram: drive acceleration is pressure limited, velocity is independently capped.
    // Pressure-dependent contact compliance shares displacement with the ram; the sheet can push it back.
    this.ramVelocity=Math.max(-this.press.strikeSpeed/100,this.ramVelocity-dt*this.load*40);
    this.punchY=Math.max(limit,this.punchY+Math.min(0,this.ramVelocity)*dt);
    this.pressCycle=this.punchY>this.config.supportY+sheetThickness(this.press)?'Approach':'Forming';
  }

  /** Bridge pieces meet the river instead of a flat floor. Each step, after
   * integration and before projection:
   *  - a downward crossing of the surface is recorded as a WaterImpact;
   *  - submerged particles get buoyancy proportional to immersion depth
   *    (deck timber floats about 0.12 below the surface, steel cable sinks),
   *    quadratic+linear water drag, and drag toward the downstream current.
   * The velocity is changed through prev so Verlet keeps the response. */
  private riverResponse(dt:number):void {
    const W=RIVER_SURFACE_Y,g=2.2;
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i];
      if(n.inverseMass===0)continue;
      const bed=terrainHeight(n.p[0],n.p[2]);
      if(bed>=W)continue;
      const prevY=n.prev[1],y=n.p[1];
      if(prevY>=W&&y<W&&this.waterImpacts.length<4096){
        const t=(prevY-W)/Math.max(1e-6,prevY-y);
        this.waterImpacts.push({time:this.time-dt*(1-t),x:n.prev[0]+(n.p[0]-n.prev[0])*t,z:n.prev[2]+(n.p[2]-n.prev[2])*t,speed:(prevY-y)/dt,mass:1/n.inverseMass,node:i});
      }
      const depth=W-y;
      if(depth<=0)continue;
      const deck=i%4<2;
      // Deck: neutral at 0.12 immersion, saturates at 0.3 (a fully wetted plank).
      // Cable: steel, buoyancy a small fraction of weight.
      const lift=deck?g*Math.min(depth,.3)/.12:g*.13*Math.min(1,depth/.05);
      const v=[n.p[0]-n.prev[0],n.p[1]-n.prev[1],n.p[2]-n.prev[2]];
      const wet=Math.min(1,depth/.15);
      // Drag relative to the moving water; vertical drag is stronger (flat plank broadside).
      const rel=[v[0],v[1],v[2]-RIVER_CURRENT*dt];
      const speed=Math.hypot(rel[0],rel[1],rel[2])/dt;
      const k=wet*dt*(deck?2.4:1.2)*(1+speed*.8);
      const kv=Math.min(.9,k*(deck?1.6:1));
      const kh=Math.min(.9,k);
      v[0]-=rel[0]*kh;v[1]-=rel[1]*kv;v[2]-=rel[2]*kh;
      v[1]+=lift*dt*dt;
      n.prev[0]=n.p[0]-v[0];n.prev[1]=n.p[1]-v[1];n.prev[2]=n.p[2]-v[2];
    }
  }
  private collide(toolCos:number,toolSin:number,thickness:number): void {
    for(const n of this.nodes) {
      if(n.inverseMass===0) { n.p[0]=n.rest[0];n.p[1]=n.rest[1];n.p[2]=n.rest[2];continue; }
      if(this.id==='plate'){
        const h=toolHeightAt(this.press,n.p[0],n.p[2],toolCos,toolSin),overlap=n.p[1]+thickness/2-this.punchY-h;
        if(overlap>0){
          const ramMass=.006/(.1+this.load*this.load),share=n.inverseMass/(n.inverseMass+ramMass);
          n.p[1]-=overlap*share;this.punchY+=overlap*(1-share);this.contactCount++;
        }
      }
      const ground=this.id==='bridge'?(terrainHeight(n.p[0],n.p[2])<RIVER_SURFACE_Y?terrainHeight(n.p[0],n.p[2])+.08:Math.max(this.config.floor,terrainHeight(n.p[0],n.p[2])+.08)):this.config.floor+(this.id==='plate'?thickness/2:0);
      if(n.p[1]<ground) {
        n.p[1]=ground;
        n.prev[0]+=(n.p[0]-n.prev[0])*.25;
        n.prev[2]+=(n.p[2]-n.prev[2])*.25;
        n.prev[1]=ground;
      }
    }
  }
  private breakLink(index: number, event: boolean): void {
    const e=this.links[index];
    if(e.broken) return;
    e.broken=true; e.damage=1;this.brokenCount++;this.topologyVersion++;
    // Event coalescing keeps the UI useful; complete broken topology is stored in snapshots.
    const last=this.events[this.events.length-1];
    if(event&&(!last||last.type!=='break'||this.time-last.time>.22)) {
      this.events.push({time:this.time,type:'break',message:`${e.kind==='warp'||e.kind==='weft'?'Surface':e.kind[0].toUpperCase()+e.kind.slice(1)} connection ruptured`,connection:index});
    }
  }
  deflection(): number {
    let max=0;
    for(let i=0;i<this.nodes.length;i++) {
      if(this.id==='bridge'&&i%4>1) continue;
      max=Math.max(max,(this.canopySI?this.canopySI.settled[i]:this.nodes[i].rest[1])-this.nodes[i].p[1]);
    }
    return max;
  }
  /** The failure count a snapshot reports (response.broken): torn cloth links, eroded press elements, or broken links. */
  snapshotBroken(): number {return this.canopySI?this.canopySI.cloth.tornCount:this.pressSI?this.siEroded:this.brokenCount;}
  response(): Response {
    let damage=0,plastic=0;
    for(const e of this.links) { damage=Math.max(damage,e.damage);plastic=Math.max(plastic,e.plastic); }
    if(this.pressSI){damage=this.siEroded/this.pressSI.brake.body.tetCount;plastic=this.siPlastic;}
    return {time:this.time,load:this.load,deflection:this.deflection(),strain:this.maxStrain,
      broken:this.snapshotBroken(),damage,plastic,
      phase:this.responsePhase(damage)};
  }
  private responsePhase(damage: number): string {
    if(this.canopySI)return this.collapseRecorded?'Collapsed':this.canopySI.cloth.tornCount?'Tearing':this.load>.02?'Loaded · elastic':'Ready';
    if(this.pressSI)return this.brokenCount?'Cracked through':this.siEroded?'Cracking':this.firstYield?'Plastic deformation':this.load>0?'Elastic response':'Ready';
    return this.collapseRecorded?(this.id==='plate'?'Perforated':'Collapsed'):this.brokenCount?'Fracturing':this.firstYield?'Plastic deformation':damage>.05?'Damage accumulating':this.load>.02?'Elastic response':'Ready';
  }
  activeIndices(): number[] {
    const out:number[]=[];
    for(const f of this.faces) if(f.links.every(i=>i<0||!this.links[i].broken)) out.push(...f.nodes);
    return out;
  }
  /** Allocate a populated render target once per live consumer. Do not retain it as a recording. */
  createSnapshotTarget(): Snapshot {
    const target:Snapshot={study:this.id,positions:new Float32Array(this.nodes.length*3),
      broken:new Uint8Array(this.links.length),strains:new Float32Array(this.nodes.length),
      topologyVersion:0,topologyIdentity:'',punchY:0,
      response:{time:0,load:0,deflection:0,strain:0,broken:0,damage:0,plastic:0,phase:''}};
    if(this.id==='plate')target.press={settings:{...this.press},travel:0,velocity:0,pressure:0,contacts:0,cycle:''};
    return this.snapshotInto(target);
  }

  /** Fill owned, writable storage without allocating arrays or replacing nested objects. */
  snapshotInto(target: Snapshot): Snapshot {
    if(!target||target.study!==this.id ||
      !(target.positions instanceof Float32Array)||target.positions.length!==this.nodes.length*3 ||
      !(target.strains instanceof Float32Array)||target.strains.length!==this.nodes.length ||
      !(target.broken instanceof Uint8Array)||target.broken.length!==this.links.length ||
      !record(target.response)||Object.isFrozen(target)||Object.isFrozen(target.response) ||
      overlaps(target.positions,target.strains)||overlaps(target.positions,target.broken)||overlaps(target.strains,target.broken)) {
      throw new RangeError('Invalid Studio snapshot target: expected independent, writable buffers for this study');
    }
    if(this.id==='plate' ? !record(target.press)||!record(target.press.settings)||Object.isFrozen(target.press)||Object.isFrozen(target.press.settings) : target.press!==undefined) {
      throw new RangeError('Invalid Studio snapshot target: press telemetry does not match this study');
    }
    let deflection=0,damage=0,plastic=0;
    for(let i=0;i<this.nodes.length;i++) {
      const n=this.nodes[i],offset=i*3;
      target.positions[offset]=n.p[0];target.positions[offset+1]=n.p[1];target.positions[offset+2]=n.p[2];
      target.strains[i]=n.strain;
      if(this.id!=='bridge'||i%4<2)deflection=Math.max(deflection,(this.canopySI?this.canopySI.settled[i]:n.rest[1])-n.p[1]);
    }
    for(let i=0;i<this.links.length;i++) {
      const e=this.links[i];target.broken[i]=e.broken?1:0;
      damage=Math.max(damage,e.damage);plastic=Math.max(plastic,e.plastic);
    }
    if(this.snapshotTopologyVersion!==this.topologyVersion) {
      // Rebuilt only when connectivity changes. Full mask avoids equal-count and hash-collision aliases.
      let identity=`${this.id}:${this.links.length}:`;
      for(let i=0;i<this.links.length;i+=4) {
        let bits=0;
        for(let bit=0;bit<4&&i+bit<this.links.length;bit++)bits|=target.broken[i+bit]<<bit;
        identity+='0123456789abcdef'[bits];
      }
      this.snapshotTopologyIdentity=identity;this.snapshotTopologyVersion=this.topologyVersion;
    }
    target.topologyVersion=this.topologyVersion;target.topologyIdentity=this.snapshotTopologyIdentity;
    target.punchY=this.punchY;
    const r=target.response;
    r.time=this.time;r.load=this.load;r.deflection=deflection;r.strain=this.maxStrain;
    if(this.canopySI){r.broken=this.canopySI.cloth.tornCount;}
    else if(this.pressSI){r.broken=this.siEroded;damage=this.siEroded/this.pressSI.brake.body.tetCount;plastic=this.siPlastic;}
    else r.broken=this.brokenCount;
    r.damage=damage;r.plastic=plastic;r.phase=this.responsePhase(damage);
    if(target.press) {
      const p=target.press;copyPress(p.settings,this.press);
      p.travel=Math.max(0,(3.85-this.punchY)*100);p.velocity=Math.max(0,-this.ramVelocity*100);
      p.pressure=this.pressSI?this.pressSI.force/PRESS_RATED_FORCE*100:this.load*20;p.contacts=this.contactCount;p.cycle=this.pressCycle;
    }
    return target;
  }

  /** Independent fresh copy: later simulation steps and target reuse cannot mutate a recording. */
  snapshot(): Snapshot { return this.createSnapshotTarget(); }

  exportCheckpoint(): StudioCheckpoint {
    return {
      format:'box3d-studio-checkpoint',version:STUDIO_CHECKPOINT_VERSION,backend:this.backend,study:this.id,
      scene:{identity:this.sceneIdentity,constructionPress:{...this.constructionPress}},press:{...this.press},
      controls:{load:this.load,targetLoad:this.targetLoad,strength:this.strength,damping:this.damping,wind:this.wind},
      nodes:this.nodes.map(n=>({...n,p:[...n.p],prev:[...n.prev],rest:[...n.rest]})),
      links:this.links.map(e=>({...e,dependencies:[...e.dependencies]})),
      faces:this.faces.map(f=>({nodes:[...f.nodes],links:[...f.links]})),supports:[...this.supports],
      state:{time:this.time,punchY:this.punchY,topologyVersion:this.topologyVersion,maxStrain:this.maxStrain,
        peakDeflection:this.peakDeflection,brokenCount:this.brokenCount,yieldedCount:this.yieldedCount,
        pressCycle:this.pressCycle,ramVelocity:this.ramVelocity,holdElapsed:this.holdElapsed,contactCount:this.contactCount,
        ramBefore:this.ramBefore,collapseRecorded:this.collapseRecorded,firstYield:this.firstYield},
      events:this.events.map(e=>({...e})),
      ...(STUDIO_SI_BACKENDS.includes(this.backend)?{si:toBase64(writeStateCheckpoint(SI_STATE_KIND,{backend:this.backend,state:this.saveSIState()}))}:{}),
    };
  }
  /** The SI solver and adapter state an SI checkpoint carries (checkpoint.ts field walker: unknown fields throw). */
  protected saveSIState(): StateObject {
    if(this.pressSI)return {press:captureFields(this.pressSI,PRESS_SI_FIELDS),siPlastic:this.siPlastic,siEroded:this.siEroded};
    if(this.canopySI)return {canopy:captureFields(this.canopySI,CANOPY_SI_FIELDS),canopyOwed:this.canopyOwed,canopyTorn:this.canopyTorn,canopyUse:this.canopyUse.slice()};
    throw new RangeError('This Studio backend has no SI state');
  }
  protected restoreSIState(value: StateValue): void {
    const s=value as Record<string,StateValue>;
    if(this.pressSI){
      checkpointAssert(s&&typeof s==='object'&&typeof s.siPlastic==='number'&&typeof s.siEroded==='number'&&'press' in s,'si.press');
      restoreFields(this.pressSI,s.press,PRESS_SI_FIELDS);this.siPlastic=s.siPlastic as number;this.siEroded=s.siEroded as number;return;
    }
    if(this.canopySI){
      checkpointAssert(s&&typeof s==='object'&&typeof s.canopyOwed==='number'&&typeof s.canopyTorn==='number'&&s.canopyUse instanceof Float64Array&&s.canopyUse.length===this.canopyUse.length&&'canopy' in s,'si.canopy');
      restoreFields(this.canopySI,s.canopy,CANOPY_SI_FIELDS);this.canopyOwed=s.canopyOwed as number;this.canopyTorn=s.canopyTorn as number;this.canopyUse.set(s.canopyUse as Float64Array);return;
    }
    throw new RangeError('This Studio backend has no SI state');
  }
  /** Decodes and checks an SI checkpoint's solver state before anything is written. */
  private readSIState(c: StudioCheckpoint): StateValue|undefined {
    if(c.si===undefined)return undefined;
    const tree=readStateCheckpoint(fromBase64(c.si),SI_STATE_KIND) as {backend?:unknown;state?:StateValue};
    checkpointAssert(tree&&typeof tree==='object'&&tree.backend===this.backend&&tree.state!==undefined,'si.backend');
    return tree.state;
  }

  /** Restore compatible Studio state atomically. Use fromCheckpoint to construct the matching specimen. */
  restoreCheckpoint(value: unknown): void {
    const checkpoint=readCheckpoint(value),si=this.readSIState(checkpoint);
    this.applyCheckpoint(checkpoint);
    if(si!==undefined)this.restoreSIState(si);
  }

  static fromCheckpoint(value: unknown): FailureSimulation {
    const checkpoint=readCheckpoint(value);
    if(checkpoint.backend===STUDIO_SI_BRIDGE_BACKEND&&!siBridgeFactory)throw new RangeError('Invalid Studio checkpoint: import src/studio/si-bridge-study.ts to restore an SI bridge run');
    const simulation=checkpoint.backend===STUDIO_SI_BRIDGE_BACKEND?siBridgeFactory!():new FailureSimulation(checkpoint.study,checkpoint.scene.constructionPress,checkpoint.backend);
    simulation.restoreCheckpoint(checkpoint);
    return simulation;
  }

  private applyCheckpoint(c: StudioCheckpoint): void {
    this.waterImpacts.length=0;
    // Compatibility is checked in full before touching the receiver, including late link/face entries.
    checkpointAssert(c.backend===this.backend,'incompatible numerical backend');
    checkpointAssert(c.study===this.id&&c.scene.identity===this.sceneIdentity,'incompatible scene/parameters');
    checkpointAssert(c.nodes.length===this.nodes.length&&c.links.length===this.links.length&&c.faces.length===this.faces.length,'incompatible scene sizes');
    checkpointAssert(c.supports.length===this.supports.length&&c.supports.every((n,i)=>n===this.supports[i]),'incompatible supports');
    for(let i=0;i<this.links.length;i++) {
      const a=c.links[i],b=this.links[i];
      checkpointAssert(a.a===b.a&&a.b===b.b&&a.kind===b.kind&&a.original===b.original&&a.stiffness===b.stiffness&&a.threshold===b.threshold,'incompatible link parameters');
      checkpointAssert(a.dependencies.length===b.dependencies.length&&a.dependencies.every((n,j)=>n===b.dependencies[j]),'incompatible link dependencies');
    }
    for(let i=0;i<this.faces.length;i++) {
      const a=c.faces[i],b=this.faces[i];
      checkpointAssert(a.nodes.every((n,j)=>n===b.nodes[j])&&a.links.every((n,j)=>n===b.links[j]),'incompatible faces');
    }
    for(let i=0;i<this.nodes.length;i++) {
      const a=c.nodes[i],b=this.nodes[i];
      for(let k=0;k<3;k++){b.p[k]=a.p[k];b.prev[k]=a.prev[k];b.rest[k]=a.rest[k];}
      b.inverseMass=a.inverseMass;b.strain=a.strain;
    }
    for(let i=0;i<this.links.length;i++) {
      const a=c.links[i],b=this.links[i];b.rest=a.rest;b.damage=a.damage;b.broken=a.broken;b.plastic=a.plastic;
    }
    copyPress(this.constructionPress,c.scene.constructionPress);copyPress(this.press,c.press);
    this.load=c.controls.load;this.targetLoad=c.controls.targetLoad;this.strength=c.controls.strength;
    this.damping=c.controls.damping;this.wind=c.controls.wind;
    const s=c.state;
    this.time=s.time;this.punchY=s.punchY;this.topologyVersion=s.topologyVersion;this.maxStrain=s.maxStrain;
    this.peakDeflection=s.peakDeflection;this.brokenCount=s.brokenCount;this.yieldedCount=s.yieldedCount;
    this.pressCycle=s.pressCycle;this.ramVelocity=s.ramVelocity;this.holdElapsed=s.holdElapsed;this.contactCount=s.contactCount;
    this.ramBefore=s.ramBefore;this.collapseRecorded=s.collapseRecorded;this.firstYield=s.firstYield;
    this.events.length=0;for(const e of c.events)this.events.push(e);
    this.snapshotTopologyVersion=-1;this.snapshotTopologyIdentity='';
    this.rebuildActiveConstraints();
    this.canopyFacesVersion=-1;this.canopyContact?.invalidate();
  }
}
