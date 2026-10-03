import type { PhysicsBackend } from '../types.ts';
import type { SoftSimulationSuite, SoftSimulationTelemetry } from '../soft/simulations.ts';
import {
  EngineError, finite, integer, onlyKeys, record, validateTickBatch,
  type EngineCapabilities, type EngineRuntime, type FixedTickStep, type ModelIdentity,
} from './contracts.ts';

export const WORKBENCH_FIXED_DT = 1 / 60;
export type WorkbenchCommand =
  | { tick: number; type: 'kick'; strength: number }
  | { tick: number; type: 'explode'; center: [number, number, number]; strength: number; radius: number }
  | { tick: number; type: 'launchProjectile'; position: [number, number, number]; velocity: [number, number, number]; size: number }
  | { tick: number; type: 'spawnRain'; count: number; spread: number; height: number }
  | { tick: number; type: 'setLoadTarget'; target: number }
  | { tick: number; type: 'releaseLoad' | 'cycleLoad' }
  | { tick: number; type: 'materialStrike' | 'dentStrike'; strength: number };
export interface WorkbenchStepRequest extends FixedTickStep<WorkbenchCommand> {
  subSteps?: number;
  /** Opt in for headless recording. Normal playback retains the owner's sampling cadence. */
  captureTelemetry?: boolean;
}
export interface WorkbenchTelemetry {
  readonly tick: number;
  readonly time: number;
  readonly rigid: { readonly bodyCount: number; readonly dynamicCount: number; readonly hash: number };
  readonly soft: SoftSimulationTelemetry;
}
export interface WorkbenchStepResult {
  readonly tick: number;
  readonly completedTicks: number;
  readonly telemetry: WorkbenchTelemetry | null;
  /** Owned numeric samples at each fixed tick; no render stream construction. */
  readonly samples: readonly WorkbenchTelemetry[];
  readonly simMs: number;
  readonly capabilities: EngineCapabilities;
}
export interface WorkbenchCreateOptions {
  backend: PhysicsBackend;
  soft: SoftSimulationSuite;
  softKernelVariant?: 'javascript' | 'scalar' | 'simd' | 'unknown';
  /** Borrowing is the default so the existing workbench remains resource owner. */
  ownsResources?: boolean;
}

function vector(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new EngineError('INVALID_PAYLOAD', `${label} must have three coordinates.`);
  return value.map((n, i) => finite(n, `${label}[${i}]`, -1e6, 1e6)) as [number, number, number];
}

export function validateWorkbenchCommand(value: unknown): WorkbenchCommand {
  const c = record(value, 'command');
  const tick = integer(c.tick, 'command.tick', 1);
  const strength = () => finite(c.strength, 'command.strength', 0, 1e6);
  switch (c.type) {
    case 'kick': case 'materialStrike': case 'dentStrike':
      onlyKeys(c, ['tick', 'type', 'strength'], 'command');
      return { tick, type: c.type, strength: strength() };
    case 'explode':
      onlyKeys(c, ['tick', 'type', 'center', 'strength', 'radius'], 'command');
      return { tick, type: c.type, center: vector(c.center, 'center'), strength: strength(), radius: finite(c.radius, 'radius', .000001, 1e6) };
    case 'launchProjectile':
      onlyKeys(c, ['tick', 'type', 'position', 'velocity', 'size'], 'command');
      return { tick, type: c.type, position: vector(c.position, 'position'), velocity: vector(c.velocity, 'velocity'), size: finite(c.size, 'size', .000001, 1e6) };
    case 'spawnRain':
      onlyKeys(c, ['tick', 'type', 'count', 'spread', 'height'], 'command');
      return { tick, type: c.type, count: integer(c.count, 'count', 0, 1e5), spread: finite(c.spread, 'spread', 0, 1e6), height: finite(c.height, 'height', -1e6, 1e6) };
    case 'setLoadTarget':
      onlyKeys(c, ['tick', 'type', 'target'], 'command');
      return { tick, type: c.type, target: finite(c.target, 'target', 0, 1e6) };
    case 'releaseLoad': case 'cycleLoad':
      onlyKeys(c, ['tick', 'type'], 'command');
      return { tick, type: c.type };
    default: throw new EngineError('INVALID_PAYLOAD', 'Unknown Workbench command.');
  }
}

export class WorkbenchRuntime implements EngineRuntime<WorkbenchStepRequest, WorkbenchStepResult> {
  private backend: PhysicsBackend;
  private soft: SoftSimulationSuite;
  private options: WorkbenchCreateOptions;
  private currentTick = 0;
  private disposed = false;
  constructor(options: WorkbenchCreateOptions) {
    this.options = options;
    this.backend = options.backend;
    this.soft = options.soft;
  }
  get tick(): number { return this.currentTick; }
  get capabilities(): EngineCapabilities {
    const rigid: ModelIdentity = {
      id: this.backend.isWasm ? 'workbench-box3d-wasm-v1' : 'workbench-js-rigid-fallback-v1',
      name: this.backend.name, implementation: this.backend.isWasm ? 'wasm' : 'javascript', calibration: 'authored-comparative',
    };
    const models = [rigid];
    const kind = this.soft.kind();
    if (kind !== 'none') {
      const variant = this.options.softKernelVariant ?? 'unknown';
      models.push({
        id: `workbench-${kind === 'fracture' ? 'material-lattice' : kind === 'water' ? 'shallow-water' : `${kind}-pbd`}-v1`,
        name: this.soft.label(),
        implementation: kind === 'fracture' || variant === 'javascript' ? 'javascript' : variant === 'scalar' ? 'wasm' : variant === 'simd' ? 'wasm-simd' : 'unknown',
        calibration: 'authored-comparative',
      });
    }
    return Object.freeze({ adapter: 'workbench', models: Object.freeze(models.map(m => Object.freeze(m))), fixedDt: WORKBENCH_FIXED_DT,
      deterministicCommands: true, checkpoint: false, worker: false, gpuReadback: false, snapshotOwnership: 'numeric-copy' });
  }
  private assertAlive(): void { if (this.disposed) throw new EngineError('DISPOSED', 'Workbench runtime is destroyed.'); }
  private read(): WorkbenchTelemetry {
    const soft = this.soft.readTelemetry();
    return Object.freeze({ tick: this.tick, time: this.tick * WORKBENCH_FIXED_DT,
      rigid: Object.freeze({ bodyCount: this.backend.bodyCount(), dynamicCount: this.backend.dynamicCount(), hash: this.backend.replayHash() }),
      soft: Object.freeze({ ...soft, ...(soft.material ? { material: Object.freeze({ ...soft.material }) } : {}) }),
    });
  }
  private apply(command: WorkbenchCommand): void {
    switch (command.type) {
      case 'kick': this.backend.kick(command.strength); this.soft.kick(command.strength); break;
      case 'explode': this.backend.explode(...command.center, command.strength, command.radius); this.soft.explode(command.center, command.strength, command.radius); break;
      case 'launchProjectile': this.backend.launchProjectile(...command.position, ...command.velocity, command.size); this.soft.launchProjectile(command.position, command.velocity, command.size); break;
      case 'spawnRain': this.backend.spawnRain(command.count, command.spread, command.height); this.soft.spawnRain(command.count, command.spread, command.height); break;
      case 'setLoadTarget': this.soft.setLoadTarget(command.target); break;
      case 'releaseLoad': this.soft.releaseLoad(); break;
      case 'cycleLoad': this.soft.cycleLoad(); break;
      case 'materialStrike': this.soft.materialStrike(command.strength); break;
      case 'dentStrike': this.soft.dentStrike(command.strength); break;
    }
  }
  step(request: WorkbenchStepRequest): WorkbenchStepResult {
    this.assertAlive();
    const source = record(request, 'step');
    onlyKeys(source, ['ticks', 'commands', 'subSteps', 'captureTelemetry'], 'step');
    const batch = validateTickBatch(this.tick, source.ticks, source.commands, validateWorkbenchCommand);
    const subSteps = source.subSteps === undefined ? 1 : integer(source.subSteps, 'subSteps', 1, 64);
    if (source.captureTelemetry !== undefined && typeof source.captureTelemetry !== 'boolean') throw new EngineError('INVALID_PAYLOAD', 'captureTelemetry must be a boolean.');
    const capture = source.captureTelemetry === true;
    const start = performance.now(), samples: WorkbenchTelemetry[] = [];
    let commandIndex = 0;
    for (let i = 0; i < batch.ticks; i++) {
      while (batch.commands[commandIndex]?.tick === this.tick + 1) this.apply(batch.commands[commandIndex++]);
      this.backend.step(WORKBENCH_FIXED_DT, subSteps);
      this.soft.step(WORKBENCH_FIXED_DT, subSteps);
      this.currentTick++;
      if (capture) samples.push(this.read());
    }
    return { tick: this.tick, completedTicks: batch.ticks, telemetry: capture ? samples.at(-1) ?? this.read() : null, samples,
      simMs: performance.now() - start, capabilities: this.capabilities };
  }
  inspect(): WorkbenchStepResult { return this.step({ ticks: 0, captureTelemetry: true }); }
  /** Call after the existing owner creates/resets both injected simulations. */
  resetClock(): void { this.assertAlive(); this.currentTick = 0; }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.options.ownsResources) { this.soft.destroy(); this.backend.destroy(); }
  }
}
export const createWorkbenchRuntime = (options: WorkbenchCreateOptions): WorkbenchRuntime => new WorkbenchRuntime(options);
