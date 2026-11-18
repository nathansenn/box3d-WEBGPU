import {
  FailureSimulation, FIXED_DT, STUDIO_CHECKPOINT_BACKEND, STUDIO_SCALED_CHECKPOINT_BACKEND, STUDIO_CANOPY_CONTACT_BACKEND,
  type FailureEvent, type Snapshot, type StudioCheckpoint, type StudyId, type StudioBackend,
} from '../studio/physics.ts';
import { METALS, PRESS_TOOLS, type PressSettings } from '../studio/press-settings.ts';
import {
  EngineError, finite, integer, onlyKeys, record, validateTickBatch,
  type EngineCapabilities, type EngineRuntime, type FixedTickStep,
} from './contracts.ts';

export const STUDIO_CAPABILITIES: EngineCapabilities = Object.freeze({
  adapter: 'studio',
  models: Object.freeze([Object.freeze({ id: STUDIO_CHECKPOINT_BACKEND, name: 'Studio reduced failure PBD', implementation: 'javascript', calibration: 'authored-comparative' })]),
  fixedDt: FIXED_DT, deterministicCommands: true, checkpoint: true, worker: true,
  gpuReadback: false, snapshotOwnership: 'explicit-loan',
});
export const STUDIO_SCALED_CAPABILITIES: EngineCapabilities = Object.freeze({
  ...STUDIO_CAPABILITIES,
  models: Object.freeze([Object.freeze({ id: STUDIO_SCALED_CHECKPOINT_BACKEND, name: 'Studio reduced failure PBD with scaled norm', implementation: 'javascript', calibration: 'authored-comparative' })]),
});
export const STUDIO_CANOPY_CONTACT_CAPABILITIES: EngineCapabilities = Object.freeze({
  ...STUDIO_CAPABILITIES,
  models: Object.freeze([Object.freeze({id:STUDIO_CANOPY_CONTACT_BACKEND,name:'Canopy PBD with continuous surface contacts',implementation:'javascript',calibration:'authored-comparative'})]),
});
export function studioCapabilitiesForBackend(backend:StudioBackend):EngineCapabilities {
  if(backend===STUDIO_CANOPY_CONTACT_BACKEND)return STUDIO_CANOPY_CONTACT_CAPABILITIES;
  return backend===STUDIO_SCALED_CHECKPOINT_BACKEND?STUDIO_SCALED_CAPABILITIES:STUDIO_CAPABILITIES;
}
export function resolveStudioBackend(options:StudioCreateOptions):StudioBackend {
  const backend=options.backend??(options.initialCheckpoint===undefined?STUDIO_CHECKPOINT_BACKEND:record(options.initialCheckpoint,'checkpoint').backend);
  if(backend!==STUDIO_CHECKPOINT_BACKEND&&backend!==STUDIO_SCALED_CHECKPOINT_BACKEND&&backend!==STUDIO_CANOPY_CONTACT_BACKEND)throw new EngineError('INVALID_PAYLOAD','Unknown Studio numerical backend.');
  if(backend===STUDIO_CANOPY_CONTACT_BACKEND&&options.study!=='canopy')throw new EngineError('INVALID_PAYLOAD','Canopy contact backend requires a canopy study.');
  return backend;
}
export const STUDIO_SAMPLE_TICKS = 12;
export const STUDIO_MAX_LIVE_LOANS = 3;

export interface StudioControls { targetLoad?: number; strength?: number; wind?: number; damping?: number }
export interface StudioCreateOptions {
  study: StudyId;
  /** A checkpoint restores its own numerical backend unless an explicit matching one is requested. */
  backend?: StudioBackend;
  press?: Partial<PressSettings>;
  controls?: StudioControls;
  /** Full-precision solver checkpoint, never a render snapshot. */
  initialCheckpoint?: unknown;
}
export interface StudioCommand { tick: number; type: 'controls'; values: StudioControls }
export interface StudioStepRequest extends FixedTickStep<StudioCommand> { stopAtTime?: number }
export interface StudioRecordingSample { readonly tick: number; readonly snapshot: Snapshot }
export interface StudioStepData {
  tick: number;
  completedTicks: number;
  /** Valid until release(). The engine never changes an outstanding loan. */
  liveSnapshot: Snapshot;
  /** Owned copies: the engine never recycles these arrays, including after reset. */
  recordingSamples: readonly StudioRecordingSample[];
  eventDelta: readonly FailureEvent[];
  completed: boolean;
  completionReason: 'press-complete' | 'time-limit' | null;
  simMs: number;
  capabilities: EngineCapabilities;
}
export interface StudioStepResult extends StudioStepData { release(): void }

export function validateStudioControls(value: unknown): StudioControls {
  const source = record(value, 'controls');
  onlyKeys(source, ['targetLoad', 'strength', 'wind', 'damping'], 'controls');
  const out: StudioControls = {};
  if ('targetLoad' in source) out.targetLoad = finite(source.targetLoad, 'targetLoad', 0, 100);
  if ('strength' in source) out.strength = finite(source.strength, 'strength', .000001, 100);
  if ('wind' in source) out.wind = finite(source.wind, 'wind', -100, 100);
  if ('damping' in source) out.damping = finite(source.damping, 'damping', 0, 1);
  return out;
}

export function validateStudioOptions(value: unknown): StudioCreateOptions {
  const source = record(value, 'options');
  onlyKeys(source, ['study', 'press', 'controls', 'initialCheckpoint', 'backend'], 'options');
  if (source.study !== 'canopy' && source.study !== 'plate' && source.study !== 'bridge') throw new EngineError('INVALID_PAYLOAD', 'Unknown Studio study.');
  const result: StudioCreateOptions = { study: source.study };
  if(source.backend!==undefined){
    if(source.backend!==STUDIO_CHECKPOINT_BACKEND&&source.backend!==STUDIO_SCALED_CHECKPOINT_BACKEND&&source.backend!==STUDIO_CANOPY_CONTACT_BACKEND)throw new EngineError('INVALID_PAYLOAD','Unknown Studio numerical backend.');
    if(source.backend===STUDIO_CANOPY_CONTACT_BACKEND&&source.study!=='canopy')throw new EngineError('INVALID_PAYLOAD','Canopy contact backend requires a canopy study.');
    result.backend=source.backend;
  }
  if (source.controls !== undefined) result.controls = validateStudioControls(source.controls);
  if (source.press !== undefined) {
    const p = record(source.press, 'press');
    onlyKeys(p, ['metal', 'thickness', 'tool', 'toolScale', 'angle', 'pressure', 'strikeSpeed', 'stroke', 'hold'], 'press');
    if ('metal' in p && !METALS.some(m => m.id === p.metal)) throw new EngineError('INVALID_PAYLOAD', 'Unknown press metal.');
    if ('tool' in p && !PRESS_TOOLS.some(t => t.id === p.tool)) throw new EngineError('INVALID_PAYLOAD', 'Unknown press tool.');
    const bounds: Record<string, [number, number]> = { thickness: [.5, 20], toolScale: [.65, 1.3], angle: [0, 90], pressure: [0, 100], strikeSpeed: [2, 250], stroke: [5, 140], hold: [0, 10] };
    for (const [key, [min, max]] of Object.entries(bounds)) if (key in p) finite(p[key], `press.${key}`, min, max);
    result.press = { ...p } as Partial<PressSettings>;
  }
  if (source.initialCheckpoint !== undefined) result.initialCheckpoint = source.initialCheckpoint;
  return result;
}

export function validateStudioCommand(value: unknown): StudioCommand {
  const source = record(value, 'command');
  onlyKeys(source, ['tick', 'type', 'values'], 'command');
  if (source.type !== 'controls') throw new EngineError('INVALID_PAYLOAD', 'Unknown Studio command.');
  return { tick: integer(source.tick, 'command.tick', 1), type: 'controls', values: validateStudioControls(source.values) };
}

export function validateStudioStep(tick: number, value: unknown): StudioStepRequest & { commands: StudioCommand[] } {
  const source = record(value, 'step');
  onlyKeys(source, ['ticks', 'commands', 'stopAtTime'], 'step');
  const batch = validateTickBatch(tick, source.ticks, source.commands, validateStudioCommand);
  return { ...batch, ...(source.stopAtTime === undefined ? {} : { stopAtTime: finite(source.stopAtTime, 'stopAtTime', 0) }) };
}

/** Owned immutable-by-engine copy. Typed array contents remain readable by renderers. */
export function cloneStudioSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot, positions: snapshot.positions.slice(), strains: snapshot.strains.slice(), broken: snapshot.broken.slice(),
    response: { ...snapshot.response },
    ...(snapshot.press ? { press: { ...snapshot.press, settings: { ...snapshot.press.settings } } } : {}),
  };
}

export class StudioRuntime implements EngineRuntime<StudioStepRequest, StudioStepResult> {
  get capabilities(): EngineCapabilities { return studioCapabilitiesForBackend(this.simulation.backend); }
  private simulation: FailureSimulation;
  private currentTick = 0;
  private disposed = false;
  private eventCursor = 0;
  private pool: Snapshot[] = [];
  private allocated = 0;
  private loanEpoch = 0;

  static create(options: StudioCreateOptions): StudioRuntime { return new StudioRuntime(options); }
  constructor(options: StudioCreateOptions) {
    this.simulation = this.construct(options);
    this.currentTick = Math.round(this.simulation.time / FIXED_DT);
  }
  get tick(): number { return this.currentTick; }

  private construct(options: StudioCreateOptions): FailureSimulation {
    const valid = validateStudioOptions(options);
    // Restore validates the complete checkpoint against this fresh model before any live state changes.
    const checkpoint = valid.initialCheckpoint;
    let press = valid.press;
    const backend=resolveStudioBackend(valid);
    if (checkpoint !== undefined && press === undefined) {
      const data = record(checkpoint, 'checkpoint');
      const scene = record(data.scene, 'checkpoint.scene');
      press = validateStudioOptions({ study: valid.study, press: scene.constructionPress }).press;
    }
    const simulation = new FailureSimulation(valid.study, press, backend);
    if (checkpoint !== undefined) simulation.restoreCheckpoint(checkpoint);
    if (valid.controls) Object.assign(simulation, valid.controls);
    return simulation;
  }
  private assertAlive(): void { if (this.disposed) throw new EngineError('DISPOSED', 'Studio runtime is destroyed.'); }

  private acquire(): Snapshot {
    const target = this.pool.pop();
    if (target) return target;
    if (this.allocated >= STUDIO_MAX_LIVE_LOANS) throw new EngineError('BACKPRESSURE', 'Release a live snapshot before requesting another.');
    this.allocated++;
    return this.simulation.createSnapshotTarget();
  }

  step(request: StudioStepRequest): StudioStepResult {
    this.assertAlive();
    const valid = validateStudioStep(this.tick, request);
    // Acquire first: backpressure must never partially advance a rejected batch.
    const target = this.acquire();
    const start = performance.now(), startTick = this.tick;
    const samples: StudioRecordingSample[] = [];
    let commandIndex = 0;
    let completionReason: StudioStepData['completionReason'] = null;
    const completed = () => {
      if (this.simulation.id === 'plate' && this.simulation.pressCycle === 'Complete') return 'press-complete' as const;
      if (valid.stopAtTime !== undefined && this.simulation.time >= valid.stopAtTime) return 'time-limit' as const;
      return null;
    };
    try {
      for (let i = 0; i < valid.ticks; i++) {
        if ((completionReason = completed())) break;
        const next = this.tick + 1;
        while (valid.commands[commandIndex]?.tick === next) Object.assign(this.simulation, valid.commands[commandIndex++].values);
        this.simulation.step(FIXED_DT);
        this.currentTick++;
        if (this.tick % STUDIO_SAMPLE_TICKS === 0) samples.push({ tick: this.tick, snapshot: this.simulation.snapshot() });
      }
      completionReason = completed();
      this.simulation.snapshotInto(target);
    } catch (error) {
      this.pool.push(target);
      throw error;
    }
    const eventDelta = this.simulation.events.slice(this.eventCursor).map(event => ({ ...event }));
    this.eventCursor = this.simulation.events.length;
    const epoch = this.loanEpoch;
    let released = false;
    return {
      tick: this.tick, completedTicks: this.tick - startTick, liveSnapshot: target,
      recordingSamples: samples, eventDelta, completed: completionReason !== null, completionReason,
      simMs: performance.now() - start, capabilities: this.capabilities,
      release: () => {
        if (released) return;
        released = true;
        if (!this.disposed && this.loanEpoch === epoch) this.pool.push(target);
      },
    };
  }
  inspect(): StudioStepResult { return this.step({ ticks: 0 }); }
  exportCheckpoint(): StudioCheckpoint { this.assertAlive(); return this.simulation.exportCheckpoint(); }
  reset(options: StudioCreateOptions): StudioStepResult {
    this.assertAlive();
    const next = this.construct(options);
    this.simulation = next;
    this.currentTick = Math.round(next.time / FIXED_DT);
    this.eventCursor = 0;
    this.pool = [];
    this.allocated = 0;
    this.loanEpoch++;
    return this.inspect();
  }
  destroy(): void { this.disposed = true; this.pool = []; this.allocated = 0; this.loanEpoch++; }
  /** Allocation counters describe live targets only; recorded/exported copies are caller-owned. */
  poolStats(): { allocated: number; free: number; outstanding: number } {
    return { allocated: this.allocated, free: this.pool.length, outstanding: this.allocated - this.pool.length };
  }
}

export const createStudioRuntime = (options: StudioCreateOptions): StudioRuntime => StudioRuntime.create(options);
