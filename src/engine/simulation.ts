/**
 * One stepping loop for every solver.
 *
 * A `Simulation` owns a rigid world and any number of registered subsystems and advances them
 * all with one `step()`. Each subsystem states the STAGE it runs in, so the order of a step is a
 * property of the subsystems, not of the caller's memory:
 *
 *     prepare (all)  ->  pre-couple  ->  couple  ->  rigid step  ->  post  ->  finish (all), events, onStep
 *
 *  - pre-couple: anything that must be in place before the couplings read the world.
 *  - couple:     solvers that exchange forces with the rigid step and must run immediately before
 *                it (structure coupling, then water coupling).
 *  - rigid:      `world.step()`. Not a subsystem stage.
 *  - post:       fields that do not act on the rigid step (heat, then the links, then solids).
 *  - events:     world events and subsystem events are delivered, then `onStep` listeners run.
 *
 * Inside a stage subsystems run by `order`, then by `id`, so registering them in any order gives
 * the same result. Every subsystem's time step is checked against the simulation's fixed step
 * when it is registered.
 *
 * The adapters at the end wrap the existing solvers without touching their numerics: a run through
 * a Simulation is bit-identical to calling the modules by hand in the documented order. SI units.
 * See docs/SIMULATION.md.
 */
import {EngineError} from './contracts.ts';
import type {WaterCoupling,CouplingShape,CouplingWorld} from './water-coupling.ts';
import {WaterCoupling as WaterCouplingClass} from './water-coupling.ts';
import {StructureCoupling,principalMoments,type StructureAttachment,type StructureInertia,type StructureWorld} from './structure-coupling.ts';
import {CompliantCableRuntime} from './compliant-cable.ts';
import {FrameRuntime} from './frame-runtime.ts';
import type {HeatSolver} from './heat.ts';
import type {SolidBody} from './solid.ts';
import {normalizeScene,sceneHasCoupling,SceneBuilder,type Scene,type SceneBody,type SceneCable,type SceneCoupledSections,type SceneFrameSection,type SceneHost,type SceneInertia,type SceneWater} from './scene-format.ts';
import type {NativeBodyHandle,NativeJointHandle} from './native-world.ts';

/** The order of one step. `rigid` and `events` belong to the Simulation; subsystems choose one of the other three. */
export const SIMULATION_STAGES=['pre-couple','couple','rigid','post','events'] as const;
export type SimulationStage=typeof SIMULATION_STAGES[number];
export type SubsystemStage='pre-couple'|'couple'|'post';

/** The default `order` of the adapters inside their stage. Lower runs first. */
export const SUBSYSTEM_ORDER=Object.freeze({structure:100,water:200,heat:100,link:200,solid:300});

/** What a Simulation needs from the rigid world. The kit's PhysicsWorld has these members. */
export interface SimulationWorld<B=unknown> {
  readonly loop:{readonly step:number};
  readonly subSteps?:number;
  /** Fixed steps since the last reset. When present, the Simulation refuses to run after the world was stepped or reset behind its back. */
  readonly tick?:number;
  step():void;
  gravity():readonly number[];
  getState(body:B):{readonly position:readonly number[];readonly rotation:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number;readonly type:string};
  isAlive?(body:B):boolean;
  /** The world's own event stream (contact, hit and sensor events). `any`: the event type is the world's. */
  onEvent?(listener:(event:any)=>void):()=>void;
}

/** A subsystem's own time step and how it must relate to the simulation's fixed step.
 *  - 'equal': it exchanges forces with the rigid step, so its dt must be the simulation step.
 *  - 'commensurate': an independent field. Its dt may be the step, a whole fraction of it (N of its
 *    steps per simulation step) or a whole multiple of it (one of its steps every N simulation steps). */
export interface SubsystemTimeStep {readonly dt:number;readonly rule:'equal'|'commensurate'}
/** How the Simulation runs a subsystem: `substeps` of its own steps on every `every`-th simulation step. One of the two is 1. */
export interface SubsystemTiming {readonly dt:number;readonly substeps:number;readonly every:number}

/** Handed to every hook. One object, reused: do not keep it. */
export interface StepContext<W=unknown> {
  readonly world:W;
  /** The step being computed: 1 for the first. */
  readonly tick:number;
  /** Time at the start of the step, (tick - 1) * dt, s. */
  readonly time:number;
  /** The simulation's fixed step, s. */
  readonly dt:number;
  /** Own steps this subsystem takes in this call (its timing's `substeps`). */
  readonly substeps:number;
  /** Queue an event for the events stage of this step. */
  emit(type:string,data?:unknown):void;
}

export interface SubsystemEnergy {
  readonly domain:'mechanical'|'thermal';
  /** Energy the subsystem holds now, J. */
  readonly total:number;
  /** Energy that has entered through its declared boundaries and sources since it was created, J. `total - exchanged` is constant for a solver without losses. */
  readonly exchanged:number;
  readonly parts:{readonly [name:string]:number};
}

/**
 * The contract every solver plugs in with.
 *
 * Per simulation step the Simulation calls, in this order: `prepare` on every subsystem (the
 * world and all fields are at time t; read, do not advance), `step` stage by stage on the
 * subsystems that are due, `world.step()` between the couple and post stages, then `finish` on
 * every subsystem (everything is at t + dt; emit events here).
 */
export interface Subsystem<W=unknown,B=unknown> {
  /** Unique in a Simulation. */
  readonly id:string;
  /** What it is, e.g. 'water-coupling'. For reports. */
  readonly kind:string;
  readonly stage:SubsystemStage;
  /** Position inside the stage; lower first, ties by id. Default 0. */
  readonly order?:number;
  /** Its time-step requirement, or null when it has none (a link that only copies data). */
  readonly timeStep:SubsystemTimeStep|null;
  /** Bodies whose kinetic and potential energy `energy()` already counts. The Simulation does not count them again. */
  readonly bodies?:Iterable<B>;
  /** Called once at registration, after the generic time-step check. Throw an EngineError to refuse. */
  validate?(info:{readonly dt:number;readonly subSteps:number|undefined;readonly timing:SubsystemTiming}):void;
  prepare?(ctx:StepContext<W>):void;
  step(ctx:StepContext<W>):void;
  finish?(ctx:StepContext<W>):void;
  energy?():SubsystemEnergy;
  diagnostics?():unknown;
  dispose?():void;
}

export interface SimulationEvent {
  /** The step that produced it. */
  readonly tick:number;
  /** 'world', or a subsystem id. */
  readonly source:string;
  readonly type:string;
  /** The world's event object, or what the subsystem passed to `emit`. */
  readonly data:unknown;
}

export interface SimulationEnergyEntry extends SubsystemEnergy {readonly id:string;readonly kind:string;readonly balance:number}
export interface SimulationEnergy {
  /** One entry per subsystem that reports energy, in step order, then 'rigid' for the tracked bodies. */
  readonly entries:readonly SimulationEnergyEntry[];
  /** Sum of the mechanical entries' totals, J. */
  readonly mechanical:number;
  /** Sum of the thermal entries' totals, J. */
  readonly thermal:number;
  readonly total:number;
  /** Sum of what entered through declared boundaries, J. */
  readonly exchanged:number;
  /** total - exchanged: constant when nothing is lost; it falls with drag and numerical damping. */
  readonly balance:number;
}
export interface SimulationDiagnostics {
  readonly tick:number;readonly time:number;readonly dt:number;
  readonly order:readonly {readonly stage:SimulationStage;readonly id:string;readonly kind:string;readonly order:number;readonly timing:SubsystemTiming|null}[];
  readonly energy:SimulationEnergy;
  /** Each subsystem's own `diagnostics()`, by id. */
  readonly subsystems:{readonly [id:string]:unknown};
}
export interface SimulationOptions {
  /** Most steps `update()` takes per call; the rest of the time is dropped. Default 5. */
  readonly maxSteps?:number;
}

const STAGE_INDEX:Record<SubsystemStage,number>={'pre-couple':0,couple:1,post:3};
const ID=/^[A-Za-z0-9_.:-]{1,64}$/;
const state=(message:string):EngineError=>new EngineError('INVALID_STATE',message);
const payload=(message:string):EngineError=>new EngineError('INVALID_PAYLOAD',message);

/** Decide how a subsystem with the given requirement runs on a simulation step of `dt`, or throw the stated error. */
export function resolveTiming(id:string,kind:string,timeStep:SubsystemTimeStep,dt:number):SubsystemTiming {
  const own=timeStep.dt;
  if(!(typeof own==='number'&&Number.isFinite(own)&&own>0))throw state(`Subsystem "${id}" (${kind}) has no time step: give its solver a dt before registering it.`);
  if(timeStep.rule==='equal'){
    if(Math.abs(own-dt)>1e-12)throw state(`Subsystem "${id}" (${kind}) steps at ${own} s but the simulation steps at ${dt} s. It exchanges forces with the rigid step, so the two must be equal; it cannot be sub-cycled.`);
    return {dt:own,substeps:1,every:1};
  }
  const ratio=dt/own,n=Math.round(ratio);
  if(n>=1&&Math.abs(ratio-n)<=1e-9*n)return {dt:own,substeps:n,every:1};
  const inverse=own/dt,m=Math.round(inverse);
  if(m>=2&&Math.abs(inverse-m)<=1e-9*m)return {dt:own,substeps:1,every:m};
  throw state(`Subsystem "${id}" (${kind}) steps at ${own} s, which is neither the simulation step ${dt} s, a whole fraction of it (N of its steps per simulation step) nor a whole multiple of it (one of its steps every N simulation steps).`);
}

interface Slot<W,B> {readonly subsystem:Subsystem<W,B>;readonly timing:SubsystemTiming|null;readonly stage:number;readonly order:number}
interface Tracked<B> {readonly body:B;readonly moments:[number,number,number]|null;readonly gravityScale:number}

/** One clock, one step, one energy ledger and one event stream for a rigid world and the solvers registered with it. */
export class Simulation<W extends SimulationWorld<B>,B=unknown> {
  readonly world:W;
  /** The fixed step of the world and of the simulation, s. */
  readonly dt:number;
  readonly subSteps:number|undefined;
  readonly maxSteps:number;
  private tickCount=0;
  private worldTick:number|undefined;
  private slots:Slot<W,B>[]=[];
  private before:Slot<W,B>[]=[];
  private after:Slot<W,B>[]=[];
  private readonly stepListeners=new Set<(tick:number)=>void>();
  private readonly eventListeners=new Set<(event:SimulationEvent)=>void>();
  private readonly worldEvents:unknown[]=[];
  private readonly ownEvents:SimulationEvent[]=[];
  private unsubscribeWorld:(()=>void)|null=null;
  private readonly tracked=new Map<B,Tracked<B>>();
  private accumulator=0;
  private disposed=false;
  private source='';
  private readonly ctx:{world:W;tick:number;time:number;dt:number;substeps:number;emit(type:string,data?:unknown):void};

  constructor(world:W,options:SimulationOptions={}) {
    if(!world||typeof world.step!=='function'||typeof world.gravity!=='function'||typeof world.getState!=='function'||!world.loop||!(world.loop.step>0))
      throw new TypeError('Simulation needs a world with loop.step, step(), gravity() and getState().');
    const maxSteps=options.maxSteps??5;
    if(!Number.isInteger(maxSteps)||maxSteps<1)throw new RangeError('maxSteps must be a positive integer.');
    this.world=world;this.dt=world.loop.step;this.subSteps=world.subSteps;this.maxSteps=maxSteps;this.worldTick=world.tick;
    this.ctx={world,tick:0,time:0,dt:this.dt,substeps:1,emit:(type,data)=>{if(this.eventListeners.size>0)this.ownEvents.push({tick:this.ctx.tick,source:this.source,type,data});}};
  }

  /** Simulation steps taken. */
  get tick():number {return this.tickCount;}
  /** tick * dt, s. Every subsystem that steps each tick is at this time. */
  get time():number {return this.tickCount*this.dt;}

  private live():void {if(this.disposed)throw new EngineError('DISPOSED','The simulation is disposed.');}
  private rebuild():void {
    this.slots.sort((a,b)=>a.stage-b.stage||a.order-b.order||(a.subsystem.id<b.subsystem.id?-1:a.subsystem.id>b.subsystem.id?1:0));
    this.before=this.slots.filter(slot=>slot.stage<2);this.after=this.slots.filter(slot=>slot.stage>2);
  }

  /** Register a subsystem. Its time-step requirement is checked now; a subsystem that cannot run on this step is refused with an EngineError. */
  add(subsystem:Subsystem<W,B>):this {
    this.live();
    if(!subsystem||typeof subsystem!=='object'||typeof subsystem.step!=='function')throw payload('A subsystem needs id, kind, stage, timeStep and step().');
    if(typeof subsystem.id!=='string'||!ID.test(subsystem.id))throw payload('A subsystem id is 1 to 64 of A-Z a-z 0-9 _ . : -.');
    if(subsystem.id==='world'||subsystem.id==='rigid')throw payload(`The subsystem id "${subsystem.id}" is reserved.`);
    if(this.slots.some(slot=>slot.subsystem.id===subsystem.id))throw payload(`A subsystem with the id "${subsystem.id}" is already registered.`);
    if(!Object.hasOwn(STAGE_INDEX,subsystem.stage))throw payload(`Subsystem "${subsystem.id}": stage must be 'pre-couple', 'couple' or 'post' (the rigid step and the events stage belong to the simulation).`);
    const order=subsystem.order??0;
    if(!Number.isFinite(order))throw payload(`Subsystem "${subsystem.id}": order must be a finite number.`);
    const timing=subsystem.timeStep===null?null:resolveTiming(subsystem.id,subsystem.kind,subsystem.timeStep,this.dt);
    if(subsystem.bodies)for(const body of subsystem.bodies)if(this.tracked.has(body))throw state(`Subsystem "${subsystem.id}" counts the energy of a body that is already tracked: untrack it first.`);
    subsystem.validate?.({dt:this.dt,subSteps:this.subSteps,timing:timing??{dt:this.dt,substeps:1,every:1}});
    this.slots.push({subsystem,timing,stage:STAGE_INDEX[subsystem.stage],order});
    this.rebuild();
    return this;
  }
  /** Remove a subsystem. It is not disposed. Returns false for an unknown id. */
  remove(id:string):boolean {
    const index=this.slots.findIndex(slot=>slot.subsystem.id===id);
    if(index<0)return false;
    this.slots.splice(index,1);this.rebuild();return true;
  }
  get(id:string):Subsystem<W,B>|undefined {return this.slots.find(slot=>slot.subsystem.id===id)?.subsystem;}
  /** The registered subsystems in the order a step runs them. */
  subsystems():Subsystem<W,B>[] {return this.slots.map(slot=>slot.subsystem);}
  /** The plan of one step: every stage and what runs in it. */
  order():SimulationDiagnostics['order'] {
    const row=(slot:Slot<W,B>)=>({stage:slot.subsystem.stage as SimulationStage,id:slot.subsystem.id,kind:slot.subsystem.kind,order:slot.order,timing:slot.timing});
    return [...this.before.map(row),{stage:'rigid' as const,id:'world',kind:'rigid-world',order:0,timing:{dt:this.dt,substeps:1,every:1}},...this.after.map(row),{stage:'events' as const,id:'events',kind:'events',order:0,timing:null}];
  }

  private run(slots:Slot<W,B>[],tick:number):void {
    const ctx=this.ctx;
    for(let i=0;i<slots.length;i++){
      const slot=slots[i],timing=slot.timing;
      if(timing!==null){if(timing.every>1&&tick%timing.every!==0)continue;ctx.substeps=timing.substeps;}else ctx.substeps=1;
      this.source=slot.subsystem.id;slot.subsystem.step(ctx);
    }
  }

  /** Advance the world and every subsystem by exactly one fixed step, in stage order. */
  step():void {
    this.live();
    const world=this.world,ctx=this.ctx,slots=this.slots,tick=this.tickCount+1;
    if(this.worldTick!==undefined&&world.tick!==this.worldTick)
      throw state(`The world was stepped or reset outside the simulation (its tick is ${world.tick}, the simulation left it at ${this.worldTick}). Advance it with simulation.step() only, and make a new Simulation after a reset.`);
    ctx.tick=tick;ctx.time=this.tickCount*this.dt;ctx.substeps=1;
    for(let i=0;i<slots.length;i++){const s=slots[i].subsystem;if(s.prepare){this.source=s.id;s.prepare(ctx);}}
    this.run(this.before,tick);
    world.step();
    if(this.worldTick!==undefined)this.worldTick=world.tick;
    this.run(this.after,tick);
    ctx.substeps=1;
    for(let i=0;i<slots.length;i++){const s=slots[i].subsystem;if(s.finish){this.source=s.id;s.finish(ctx);}}
    this.tickCount=tick;
    if(this.eventListeners.size>0){
      const fromWorld=this.worldEvents,own=this.ownEvents;
      for(let i=0;i<fromWorld.length;i++){const kind=(fromWorld[i] as {kind?:unknown;type?:unknown}),event:SimulationEvent={tick,source:'world',type:String(kind.type??kind.kind??'event'),data:fromWorld[i]};for(const listener of this.eventListeners)listener(event);}
      for(let i=0;i<own.length;i++)for(const listener of this.eventListeners)listener(own[i]);
      fromWorld.length=0;own.length=0;
    }
    for(const listener of this.stepListeners)listener(tick);
  }

  /** Advance by a variable frame time with a fixed-step accumulator: whole steps only, at most `maxSteps` per call. */
  update(frameSeconds:number):{steps:number;alpha:number;droppedSeconds:number} {
    const delta=Number.isFinite(frameSeconds)&&frameSeconds>0?frameSeconds:0;
    this.accumulator+=delta;
    let steps=0;
    while(this.accumulator>=this.dt&&steps<this.maxSteps){this.step();this.accumulator-=this.dt;steps++;}
    let droppedSeconds=0;
    if(this.accumulator>=this.dt){droppedSeconds=this.accumulator-(this.accumulator%this.dt);this.accumulator%=this.dt;}
    return {steps,alpha:this.accumulator/this.dt,droppedSeconds};
  }

  /** Call `listener(tick)` after every simulation step, when the world and every subsystem have advanced. Returns a function that removes it. */
  onStep(listener:(tick:number)=>void):()=>void {this.stepListeners.add(listener);return ()=>{this.stepListeners.delete(listener);};}
  /** Call `listener(event)` in the events stage for every world event (contact, hit, sensor) and every event a subsystem emitted in the step. */
  onEvent(listener:(event:SimulationEvent)=>void):()=>void {
    this.eventListeners.add(listener);
    if(!this.unsubscribeWorld&&typeof this.world.onEvent==='function')this.unsubscribeWorld=this.world.onEvent((event:unknown)=>{this.worldEvents.push(event);});
    return ()=>{
      this.eventListeners.delete(listener);
      if(this.eventListeners.size===0&&this.unsubscribeWorld){this.unsubscribeWorld();this.unsubscribeWorld=null;this.worldEvents.length=0;this.ownEvents.length=0;}
    };
  }

  /** Count a body in the 'rigid' entry of the energy ledger. The world reports mass but not rotational inertia, so state it.
   * Do not track a body that a subsystem already counts (the structure coupling counts the bodies attached to it). */
  trackBody(body:B,inertia:StructureInertia,options:{readonly gravityScale?:number}={}):this {
    for(const slot of this.slots)if(slot.subsystem.bodies)for(const claimed of slot.subsystem.bodies)if(claimed===body)throw state(`The energy of that body is already counted by subsystem "${slot.subsystem.id}".`);
    const s=this.world.getState(body),scale=options.gravityScale??1;
    if(!Number.isFinite(scale))throw payload('gravityScale must be finite.');
    this.tracked.set(body,{body,moments:s.type==='dynamic'?principalMoments(inertia,s.mass):null,gravityScale:scale});
    return this;
  }
  untrackBody(body:B):boolean {return this.tracked.delete(body);}

  /** The energy ledger: one entry per subsystem and one for the tracked bodies, with totals per domain. Allocates; not for the hot path. */
  energy():SimulationEnergy {
    const entries:SimulationEnergyEntry[]=[];
    for(const slot of this.slots){
      const s=slot.subsystem;if(!s.energy)continue;
      const e=s.energy();entries.push({id:s.id,kind:s.kind,domain:e.domain,total:e.total,exchanged:e.exchanged,balance:e.total-e.exchanged,parts:e.parts});
    }
    if(this.tracked.size>0){
      const g=this.world.gravity();let kinetic=0,potential=0;
      for(const t of this.tracked.values()){
        if(this.world.isAlive&&!this.world.isAlive(t.body))continue;
        const s=this.world.getState(t.body);if(s.type!=='dynamic')continue;
        const v=s.linearVelocity,w=s.angularVelocity,x=s.position,m=s.mass;
        kinetic+=.5*m*(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
        potential-=m*t.gravityScale*(Number(g[0])*x[0]+Number(g[1])*x[1]+Number(g[2])*x[2]);
        if(t.moments){
          // Angular velocity in body axes: R^T w.
          const qx=s.rotation[0],qy=s.rotation[1],qz=s.rotation[2],qw=s.rotation[3];
          const l0=(1-2*(qy*qy+qz*qz))*w[0]+2*(qx*qy+qz*qw)*w[1]+2*(qx*qz-qy*qw)*w[2];
          const l1=2*(qx*qy-qz*qw)*w[0]+(1-2*(qx*qx+qz*qz))*w[1]+2*(qy*qz+qx*qw)*w[2];
          const l2=2*(qx*qz+qy*qw)*w[0]+2*(qy*qz-qx*qw)*w[1]+(1-2*(qx*qx+qy*qy))*w[2];
          kinetic+=.5*(t.moments[0]*l0*l0+t.moments[1]*l1*l1+t.moments[2]*l2*l2);
        }
      }
      entries.push({id:'rigid',kind:'rigid-world',domain:'mechanical',total:kinetic+potential,exchanged:0,balance:kinetic+potential,parts:{kinetic,potential}});
    }
    let mechanical=0,thermal=0,exchanged=0;
    for(const e of entries){if(e.domain==='thermal')thermal+=e.total;else mechanical+=e.total;exchanged+=e.exchanged;}
    return {entries,mechanical,thermal,total:mechanical+thermal,exchanged,balance:mechanical+thermal-exchanged};
  }

  /** The clock, the step plan, the energy ledger and every subsystem's own report. Allocates; not for the hot path. */
  diagnostics():SimulationDiagnostics {
    const subsystems:{[id:string]:unknown}={};
    for(const slot of this.slots)if(slot.subsystem.diagnostics)subsystems[slot.subsystem.id]=slot.subsystem.diagnostics();
    return {tick:this.tickCount,time:this.time,dt:this.dt,order:this.order(),energy:this.energy(),subsystems};
  }

  /** Dispose every subsystem that can be disposed and stop listening to the world. The world itself is left alone. */
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    if(this.unsubscribeWorld){this.unsubscribeWorld();this.unsubscribeWorld=null;}
    for(const slot of this.slots)slot.subsystem.dispose?.();
    this.slots=[];this.before=[];this.after=[];this.stepListeners.clear();this.eventListeners.clear();this.tracked.clear();
  }
}

// ---------------------------------------------------------------------------
// Adapters. Each one calls the module's own step and nothing else.
// ---------------------------------------------------------------------------

/** Rigid bodies <-> water (water-coupling.ts). Couple stage: `water.step()` immediately before the rigid step.
 * Requirement: `water.dt` equals the simulation step. Energy: the water's kinetic and potential energy; track the floating bodies with `trackBody`. */
export function waterSubsystem<W,B>(water:WaterCoupling<B>,options:{readonly id?:string}={}):Subsystem<W,B> {
  return {
    id:options.id??'water',kind:'water-coupling',stage:'couple',order:SUBSYSTEM_ORDER.water,timeStep:{dt:water.dt,rule:'equal'},
    step(){water.step();},
    energy(){const kinetic=water.waterKineticEnergy(),potential=water.waterPotentialEnergy();return {domain:'mechanical',total:kinetic+potential,exchanged:0,parts:{waterKinetic:kinetic,waterPotential:potential}};},
    diagnostics(){return {backend:water.backend,tick:water.tick(),attached:water.attachedCount(),waterVolume:water.waterVolume(),displacedVolume:water.displacedVolume(),meanElevation:water.meanElevation(),floorLoad:water.floorLoad(),buoyancy:water.buoyancyTotal(),verticalDrag:water.verticalDragTotal()};},
  };
}

/** Cables and frames <-> rigid bodies (structure-coupling.ts). Couple stage, before the water: `coupling.step()` steps the
 * cables and frames it holds and must run immediately before the rigid step. Requirement: `coupling.dt` equals the simulation
 * step (the coupling itself requires every cable's and frame's dt to equal its own, and frames to use one sub-step).
 * Energy: `coupling.diagnostics()`, which counts the attached bodies; pass them as `bodies` so they are not tracked twice. */
export function structureSubsystem<W,B>(coupling:StructureCoupling<B>,options:{readonly id?:string;readonly bodies?:Iterable<B>}={}):Subsystem<W,B> {
  const bodies=options.bodies?[...options.bodies]:[];
  return {
    id:options.id??'structure',kind:'structure-coupling',stage:'couple',order:SUBSYSTEM_ORDER.structure,timeStep:{dt:coupling.dt,rule:'equal'},bodies,
    step(){coupling.step();},
    energy(){
      const d=coupling.diagnostics();
      return {domain:'mechanical',total:d.total,exchanged:0,parts:{bodyKinetic:d.bodyKinetic,bodyPotential:d.bodyPotential,cableKinetic:d.cableKinetic,cableElastic:d.cableElastic,cablePotential:d.cablePotential,frameKinetic:d.frameKinetic,frameElastic:d.frameElastic,framePotential:d.framePotential}};
    },
    diagnostics(){return {backend:coupling.backend,scheme:coupling.scheme,attachments:coupling.reports.length,...coupling.diagnostics()};},
  };
}

/** Heat conduction (heat.ts). Post stage: it does not act on the rigid step. Requirement: the solver's dt is the simulation
 * step, a whole fraction of it or a whole multiple of it; with the explicit scheme the dt must also be within the solver's
 * stability limit. Energy (thermal): stored energy, with the heat that crossed the boundaries and came from sources as `exchanged`. */
export function heatSubsystem<W,B>(heat:HeatSolver,options:{readonly id?:string}={}):Subsystem<W,B> {
  const id=options.id??'heat';
  return {
    id,kind:'heat',stage:'post',order:SUBSYSTEM_ORDER.heat,timeStep:{dt:heat.dt,rule:'commensurate'},
    validate(){
      if(heat.scheme!=='explicit')return;
      const limit=heat.explicitStabilityLimit();
      if(heat.dt>limit*(1+1e-9))throw new EngineError('UNSTABLE_TIME_STEP',`Subsystem "${id}" (heat): the explicit step ${heat.dt} s is above the stability limit ${limit} s. Give the solver a smaller dt (a whole fraction of the simulation step) or use an implicit scheme.`);
    },
    step(ctx){heat.step(ctx.substeps);},
    energy(){
      let exchanged=heat.sourceEnergy;for(let i=0;i<heat.boundaryEnergy.length;i++)exchanged+=heat.boundaryEnergy[i];
      const stored=heat.storedEnergy();return {domain:'thermal',total:stored,exchanged,parts:{stored}};
    },
    diagnostics(){return heat.diagnostics();},
  };
}

/** A deformable solid (solid.ts). Post stage, after heat and the links. Requirement: the body's dt is the simulation step, a
 * whole fraction of it or a whole multiple of it; an explicit body must be within its stability limit.
 * Energy: kinetic + strain + load potential. It is not conserved while a link changes the loads or the temperature. */
export function solidSubsystem<W,B>(solid:SolidBody,options:{readonly id?:string}={}):Subsystem<W,B> {
  const id=options.id??'solid';
  return {
    id,kind:'solid',stage:'post',order:SUBSYSTEM_ORDER.solid,timeStep:{dt:solid.dt,rule:'commensurate'},
    validate(){
      if(solid.integrator!=='explicit')return;
      const limit=solid.explicitLimit().criticalTimeStep;
      if(solid.dt>limit)throw new EngineError('UNSTABLE_TIME_STEP',`Subsystem "${id}" (solid): the explicit step ${solid.dt} s is above the stability limit ${limit} s. Give the body a smaller dt (a whole fraction of the simulation step) or use an implicit integrator.`);
    },
    step(ctx){solid.step(ctx.substeps);},
    energy(){const kinetic=solid.kineticEnergy(),strain=solid.strainEnergy(),load=solid.loadPotential();return {domain:'mechanical',total:kinetic+strain+load,exchanged:0,parts:{kinetic,strain,loadPotential:load}};},
    diagnostics(){return {solver:solid.solver,model:solid.model,integrator:solid.integrator,time:solid.time,unconvergedSteps:solid.unconvergedSteps,...solid.stats};},
  };
}

// ---------------------------------------------------------------------------
// Links between solvers. One-way unless a line says otherwise.
// ---------------------------------------------------------------------------

/** Temperature rise at the nodes of a box mesh from the cell temperatures of a co-located heat grid.
 * Heat cell (i, j, k) is at index i + nx (j + ny k) and node (i, j, k) at i + (nx + 1) (j + (ny + 1) k).
 * A node takes the mean of the cells that touch it (one at a corner, eight inside), minus `reference`. */
export function cellTemperaturesToNodes(temperature:ArrayLike<number>,cells:readonly [number,number,number],reference:number,out:number[]|Float64Array):number[]|Float64Array {
  const [nx,ny,nz]=cells;
  for(let k=0,n=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++,n++){
    let sum=0,count=0;
    for(let c=k>0?k-1:0;c<=k&&c<nz;c++)for(let b=j>0?j-1:0;b<=j&&b<ny;b++)for(let a=i>0?i-1:0;a<=i&&a<nx;a++){sum+=temperature[a+nx*(b+ny*c)];count++;}
    out[n]=sum/count-reference;
  }
  return out;
}

/** ONE-WAY thermal -> solid: the heat solver's temperature becomes the solid's thermal load (eigenstrain alpha_T dT).
 * The solid does not act on the temperature. Co-located grids only: the solid must be a `boxMesh` whose cells are the heat
 * grid's cells (same counts, same cell size, every heat cell solid). Mapping: `cellTemperaturesToNodes`, then the solid takes
 * the mean of an element's four nodes. Post stage, between the heat solver and the solid, after every heat step.
 * `reference` is the stress-free temperature. The solid module allocates one array per update. */
export function thermalSolidLink<W,B>(heat:HeatSolver,solid:SolidBody,options:{readonly id?:string;readonly reference:number}):Subsystem<W,B> {
  const id=options.id??'thermal-solid',reference=options.reference,cells:[number,number,number]=[heat.nx,heat.ny,heat.nz];
  if(!Number.isFinite(reference))throw payload(`Link "${id}": reference must be the stress-free temperature, a finite number.`);
  const nodes=(heat.nx+1)*(heat.ny+1)*(heat.nz+1);
  if(solid.nodeCount!==nodes)throw payload(`Link "${id}": the solid has ${solid.nodeCount} nodes but a box mesh on the ${heat.nx} x ${heat.ny} x ${heat.nz} heat grid has ${nodes}. The grids must be co-located.`);
  for(let i=0;i<heat.cells;i++)if(!heat.solid[i])throw payload(`Link "${id}": heat cell ${i} is not solid. The link needs a full box.`);
  const p=solid.referencePositions,spacing=[heat.dx,heat.dy,heat.dz],stride=[1,heat.nx+1,(heat.nx+1)*(heat.ny+1)];
  for(let axis=0;axis<3;axis++){
    const edge=p[3*stride[axis]+axis]-p[axis];
    if(Math.abs(edge-spacing[axis])>1e-9*spacing[axis])throw payload(`Link "${id}": the solid's cells are ${edge} m along axis ${axis} but the heat cells are ${spacing[axis]} m. The grids must be co-located.`);
  }
  const rise=new Array<number>(nodes).fill(0);
  let seen=-1;
  return {
    id,kind:'thermal-solid-link',stage:'post',order:SUBSYSTEM_ORDER.link,timeStep:null,
    step(){
      if(heat.steps===seen)return;
      seen=heat.steps;
      solid.setTemperatureChange(cellTemperaturesToNodes(heat.temperature,cells,reference,rise) as number[]);
    },
    diagnostics(){return {direction:'heat -> solid, one-way',reference,heatSteps:seen};},
  };
}

/** ONE-WAY rigid -> solid: the weight of a rigid body, m g, is put on solid nodes as a dead load. The solid's deflection
 * does not move the body, and nothing here holds the body up: support it in the rigid world. There is no contact.
 * With `faces` the weight is spread as a uniform traction over those boundary faces (each node of a face takes a third of
 * the face's share by area); with `nodes` it is shared equally. The link owns the point forces of those nodes: it replaces
 * them. The mass and gravity are read from the world each step; a destroyed body takes its weight away. Post stage, before the solid. */
export function deadLoadLink<W extends SimulationWorld<B>,B>(body:B,solid:SolidBody,options:{readonly id?:string;readonly faces?:ArrayLike<number>;readonly nodes?:ArrayLike<number>}):Subsystem<W,B> {
  const id=options.id??'dead-load',share=new Map<number,number>();
  if((options.faces===undefined)===(options.nodes===undefined))throw payload(`Link "${id}": give faces or nodes, not both.`);
  if(options.faces){
    const faces=solid.faces,p=solid.referencePositions;let total=0;
    for(const f of Array.from(options.faces)){
      if(!Number.isInteger(f)||f<0||3*f>=faces.length)throw payload(`Link "${id}": face ${f} is out of range.`);
      const a=3*faces[3*f],b=3*faces[3*f+1],c=3*faces[3*f+2],ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
      const area=.5*Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);total+=area;
      for(let q=0;q<3;q++){const n=faces[3*f+q];share.set(n,(share.get(n)??0)+area/3);}
    }
    if(!(total>0))throw payload(`Link "${id}": the faces have no area.`);
    for(const [n,w] of share)share.set(n,w/total);
  }else{
    const list=Array.from(options.nodes!);
    if(list.length===0)throw payload(`Link "${id}": nodes is empty.`);
    for(const n of list){if(!Number.isInteger(n)||n<0||n>=solid.nodeCount)throw payload(`Link "${id}": node ${n} is out of range.`);if(share.has(n))throw payload(`Link "${id}": node ${n} is listed twice.`);share.set(n,1/list.length);}
  }
  const nodes=[...share.keys()],weights=nodes.map(n=>share.get(n)!),applied=[NaN,NaN,NaN],force:[number,number,number]=[0,0,0];
  return {
    id,kind:'dead-load-link',stage:'post',order:SUBSYSTEM_ORDER.link,timeStep:null,
    step(ctx){
      const world=ctx.world;let wx=0,wy=0,wz=0;
      if(world.isAlive===undefined||world.isAlive(body)){const g=world.gravity(),m=world.getState(body).mass;wx=m*Number(g[0]);wy=m*Number(g[1]);wz=m*Number(g[2]);}
      if(wx===applied[0]&&wy===applied[1]&&wz===applied[2])return;
      applied[0]=wx;applied[1]=wy;applied[2]=wz;
      for(let i=0;i<nodes.length;i++){force[0]=weights[i]*wx;force[1]=weights[i]*wy;force[2]=weights[i]*wz;solid.setNodalForce(nodes[i],force);}
    },
    diagnostics(){return {direction:'rigid -> solid, one-way',weight:[applied[0],applied[1],applied[2]],nodes:nodes.length};},
  };
}

// ---------------------------------------------------------------------------
// Scenes: a `box3d-scene` with water, cable and frame sections becomes a ready Simulation.
// ---------------------------------------------------------------------------

type Body=NativeBodyHandle;
/** What building a coupled scene needs from the world: a SceneHost that can also take forces and impulses. The kit's PhysicsWorld is one. */
export type SimulationSceneWorld=SceneHost&SimulationWorld<Body>&CouplingWorld<Body>&StructureWorld<Body>;

export interface LoadedSimulationScene<W extends SimulationSceneWorld=SimulationSceneWorld> {
  readonly bodies:Map<string,Body>;
  readonly joints:Map<string,NativeJointHandle>;
  readonly builder:SceneBuilder<W>;
  /** The scene in normal form, as it was built. */
  readonly scene:Scene;
  /** Steps the world and everything the scene describes. Use `simulation.step()`, not `world.step()`. */
  readonly simulation:Simulation<W,Body>;
  /** By basin id. Each is registered under its id. */
  readonly water:Map<string,WaterCoupling<Body>>;
  readonly cables:Map<string,CompliantCableRuntime>;
  readonly frames:Map<string,FrameRuntime>;
  /** The one coupling that holds every cable and frame of the scene (subsystem id 'structure'), or null. */
  readonly structure:StructureCoupling<Body>|null;
  /** Live attachment reports, keyed '<cable or frame id>:<index in its attachments>'. */
  readonly attachments:Map<string,StructureAttachment>;
}

const named=(kind:string,id:string,error:unknown):EngineError=>
  new EngineError(error instanceof EngineError?error.code:error instanceof RangeError||error instanceof TypeError?'INVALID_PAYLOAD':'INTERNAL',`Scene ${kind} "${id}": ${error instanceof Error?error.message:String(error)}`);

function shapeInertia(body:SceneBody,explicit:SceneInertia|undefined):StructureInertia {
  if(explicit)return explicit as StructureInertia;
  const shape=body.shape;
  if(shape.kind==='box')return {kind:'box',halfExtents:shape.halfExtents};
  if(shape.kind==='sphere')return {kind:'sphere',radius:shape.radius};
  if(shape.kind==='capsule')return {kind:'capsule',radius:shape.radius,halfLength:shape.halfLength};
  return {kind:'locked'};   // unreachable for a validated scene
}

/**
 * Build the water, cable and frame sections of a scene whose bodies and joints `builder` has already
 * built, and return the Simulation that steps them. Build order: frames, then cables (file order),
 * one StructureCoupling with the cables' attachments (cable by cable, in file order) and then the
 * frames' attachments; then the basins and their bodies. A rigid-only scene gives a Simulation with
 * no subsystems, whose step is `world.step()`. On a failure the world is reset and the error names the id.
 */
export function buildSceneSimulation<W extends SimulationSceneWorld>(world:W,builder:SceneBuilder<W>,scene:Scene):LoadedSimulationScene<W> {
  const bodies=builder.bodies(),joints=builder.joints(),step=world.loop.step,g=scene.world?.gravity??[0,-9.81,0];
  const gravity:[number,number,number]=[g[0],g[1],g[2]];
  const descriptions=new Map<string,SceneBody>(scene.bodies.map(body=>[body.id,body]));
  const water=new Map<string,WaterCoupling<Body>>(),cables=new Map<string,CompliantCableRuntime>(),frames=new Map<string,FrameRuntime>(),attachments=new Map<string,StructureAttachment>();
  const carried=new Set<Body>();
  let structure:StructureCoupling<Body>|null=null;
  const simulation=new Simulation<W,Body>(world);
  if(!sceneHasCoupling(scene))return {bodies,joints,builder,scene,simulation,water,cables,frames,structure,attachments};
  const attachOptions=(id:string,att:{inertia?:SceneInertia;localPoint?:readonly [number,number,number]})=>{
    const description=descriptions.get(id)!;
    return {inertia:shapeInertia(description,att.inertia),...(att.localPoint?{localPoint:att.localPoint}:{}),...(description.gravityScale!==undefined?{gravityScale:description.gravityScale}:{})};
  };
  try{
    for(const f of scene.frames??[]){
      try{
        frames.set(f.id,new FrameRuntime({
          config:{dt:step,substeps:1,maxIterations:f.maxIterations??1024,drag:f.drag??0,gravity,forceTolerance:f.forceTolerance??1e-9,momentTolerance:f.momentTolerance??1e-9,impulseTolerance:f.impulseTolerance??1e-10,angularImpulseTolerance:f.angularImpulseTolerance??1e-10},
          positions:f.nodes as number[],elements:f.elements.map(e=>({...e,up:[e.up[0],e.up[1],e.up[2]] as const})),
          ...(f.fixed?{fixed:f.fixed as number[]}:{}),...(f.pointMasses?{pointMasses:f.pointMasses as number[]}:{}),...(f.pointInertias?{pointInertias:f.pointInertias as number[]}:{}),
          ...(f.displacements?{displacements:f.displacements as number[]}:{}),...(f.velocities?{velocities:f.velocities as number[]}:{}),
        }));
      }catch(error){throw named('frame',f.id,error);}
    }
    for(const c of scene.cables??[]){
      try{
        const proximal=c.solver!=='xpbd';
        cables.set(c.id,new CompliantCableRuntime({
          config:{dt:step,substeps:c.substeps??1,maxIterations:c.maxIterations??64,residualTolerance:c.residualTolerance??1e-10,drag:c.drag??0,gravity,...(proximal?{solver:'proximal' as const,forceTolerance:c.forceTolerance??1e-6}:{})},
          positions:c.nodes as number[],masses:c.masses as number[],...(c.pinned?{pinned:c.pinned as number[]}:{}),...(c.velocities?{velocities:c.velocities as number[]}:{}),
          constraints:c.segments.map(s=>({a:s.a,b:s.b,restLength:s.restLength,compliance:s.compliance})),
        }));
      }catch(error){throw named('cable',c.id,error);}
    }
    if(cables.size+frames.size>0){
      const coupling=structure=new StructureCoupling<Body>(world);
      // Hand over every cable and frame, attached or not: the coupling steps them.
      for(const c of scene.cables??[])try{coupling.addCable(cables.get(c.id)!);}catch(error){throw named('cable',c.id,error);}
      for(const f of scene.frames??[])try{coupling.addFrame(frames.get(f.id)!);}catch(error){throw named('frame',f.id,error);}
      for(const c of scene.cables??[]){
        const cable=cables.get(c.id)!;
        (c.attachments??[]).forEach((att,index)=>{
          try{
            if(att.body!==undefined){const body=bodies.get(att.body)!;attachments.set(`${c.id}:${index}`,coupling.attachCableToBody(cable,att.node,body,attachOptions(att.body,att)));carried.add(body);}
            else attachments.set(`${c.id}:${index}`,coupling.attachCableToFrame(cable,att.node,frames.get(att.frame!)!,att.frameNode!));
          }catch(error){throw named('cable',c.id,error);}
        });
      }
      for(const f of scene.frames??[]){
        const frame=frames.get(f.id)!;
        (f.attachments??[]).forEach((att,index)=>{
          try{const body=bodies.get(att.body)!;attachments.set(`${f.id}:${index}`,coupling.attachFrameToBody(frame,att.node,body,{mode:att.mode??'pinned',...attachOptions(att.body,att)}));carried.add(body);}
          catch(error){throw named('frame',f.id,error);}
        });
      }
      simulation.add(structureSubsystem<W,Body>(coupling,{id:'structure',bodies:carried}));
    }
    for(const basin of scene.water??[]){
      try{
        const coupling=new WaterCouplingClass<Body>(world,{cols:basin.cols,rows:basin.rows,dx:basin.dx,dz:basin.dz,restDepth:basin.restDepth,origin:[basin.origin[0],basin.origin[1],basin.origin[2]],
          ...(basin.density!==undefined?{density:basin.density}:{}),...(basin.waterDrag!==undefined?{waterDrag:basin.waterDrag}:{}),...(basin.eta?{eta:basin.eta}:{})});
        // The constructor starts the face velocities half a step ahead of a given surface; a saved scene carries the ones it had.
        if(basin.eta||basin.u||basin.v){coupling.u.fill(0);coupling.v.fill(0);if(basin.u)coupling.u.set(basin.u);if(basin.v)coupling.v.set(basin.v);}
        for(const entry of basin.bodies??[]){
          const body=bodies.get(entry.body)!,description=descriptions.get(entry.body)!;
          coupling.attach(body,description.shape as CouplingShape,{dragCoefficient:entry.dragCoefficient,referenceArea:entry.referenceArea,linearDrag:entry.linearDrag,angularDrag:entry.angularDrag});
          if(!carried.has(body))simulation.trackBody(body,shapeInertia(description,undefined),{gravityScale:description.gravityScale});
        }
        water.set(basin.id,coupling);
        simulation.add(waterSubsystem<W,Body>(coupling,{id:basin.id}));
      }catch(error){throw error instanceof EngineError&&error.message.startsWith('Scene ')?error:named('water',basin.id,error);}
    }
  }catch(error){
    for(const cable of cables.values())cable.destroy();
    for(const frame of frames.values())frame.destroy();
    builder.resetWorld();
    throw error;
  }
  // A save writes the sections back with the fields the solvers hold now. Masses come from the description: an attached
  // cable node borrows its carrier's effective mass while it is attached.
  builder.coupledCapture=():SceneCoupledSections=>({
    water:scene.water?.map((basin:SceneWater)=>{const w=water.get(basin.id)!;return {...basin,eta:Array.from(w.eta),u:Array.from(w.u),v:Array.from(w.v)};}),
    cables:scene.cables?.map((c:SceneCable)=>{const views=cables.get(c.id)!.couplingViews();return {...c,nodes:Array.from(views.positions),velocities:Array.from(views.velocities)};}),
    frames:scene.frames?.map((f:SceneFrameSection)=>{const views=frames.get(f.id)!.couplingViews();return {...f,displacements:Array.from(views.displacements),velocities:Array.from(views.velocities)};}),
  });
  return {bodies,joints,builder,scene,simulation,water,cables,frames,structure,attachments};
}

/**
 * Validate a scene, reset the world to its settings, build its bodies and joints and then its water,
 * cable and frame sections, and return everything with a ready Simulation. The rules of `loadScene`
 * hold: an invalid scene leaves the world untouched, and a body, joint, cable, frame or basin the
 * engine refuses leaves it reset and empty, with the id in the error.
 */
export function loadSimulationScene<W extends SimulationSceneWorld>(world:W,scene:unknown):LoadedSimulationScene<W> {
  const normal=normalizeScene(scene);
  const builder=new SceneBuilder<W>(world,{world:normal.world,materials:normal.materials,meta:normal.meta,extensions:normal.extensions}).populate(normal);
  return buildSceneSimulation(world,builder,normal);
}
