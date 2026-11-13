/**
 * Free-running Studio solver: the worker advances fixed ticks toward `speed` x wall time on its own schedule and
 * publishes the latest state as a live snapshot, at most every STUDIO_RUN_PUBLISH_MS. The renderer draws whatever
 * snapshot is newest, so drawing speed no longer limits how fast the model advances.
 *
 * Determinism: every tick is the same FIXED_DT step as in a stepped run; commands (controls, a press pressure program)
 * are attached to exact ticks; recording samples are taken every STUDIO_SAMPLE_TICKS ticks and none is dropped. A run's
 * result therefore depends only on its start state and on the ticks at which control changes were applied.
 */
import { FIXED_DT } from '../studio/physics.ts';
import { PRESS_DRIVES, pressDrivePressure, type PressDriveId } from '../studio/press-program.ts';
import { FreeRunPacer } from '../perf/free-run.ts';
import { EngineError, finite, onlyKeys, record } from './contracts.ts';
import { validateStudioControls, type StudioAdvance, type StudioCommand, type StudioControls, type StudioRunState, type StudioRuntime } from './studio-runtime.ts';

export interface StudioRunRequest {
  /** Simulated seconds per wall second wanted (the playback speed). */
  speed: number;
  /** Largest backlog the run tries to catch up, in simulated seconds (default 0.25 s). */
  maxLagSeconds?: number;
  stopAtTime?: number;
  /** Applied at the first tick of the run. */
  controls?: StudioControls;
  /** A press pressure program: each tick's crowd/press load follows press-program.ts. */
  pressDrive?: { id: PressDriveId; limit: number };
  /** Stop at the tick where the first link, hanger or element fails. */
  stopOnFirstRupture?: boolean;
}
export interface StudioRunUpdate { speed?: number; controls?: StudioControls }
/** Solver work per slice before the loop yields to messages. */
export const STUDIO_RUN_SLICE_MS = 24;
/** Smallest interval between two published snapshots. */
export const STUDIO_RUN_PUBLISH_MS = 33;
/** Ticks a run may advance while no snapshot can be published (the receiver holds every loan); then it waits. */
export const STUDIO_RUN_MAX_UNPUBLISHED_TICKS = 1200;
export const STUDIO_RUN_DEFAULT_LAG = .25;

export function validateStudioRun(value: unknown): StudioRunRequest {
  const source = record(value, 'run');
  onlyKeys(source, ['speed', 'maxLagSeconds', 'stopAtTime', 'controls', 'pressDrive', 'stopOnFirstRupture'], 'run');
  const out: StudioRunRequest = { speed: finite(source.speed, 'run.speed', .01, 16) };
  if (source.maxLagSeconds !== undefined) out.maxLagSeconds = finite(source.maxLagSeconds, 'run.maxLagSeconds', FIXED_DT, 60);
  if (source.stopAtTime !== undefined) out.stopAtTime = finite(source.stopAtTime, 'run.stopAtTime', 0);
  if (source.controls !== undefined) out.controls = validateStudioControls(source.controls);
  if (source.pressDrive !== undefined) {
    const drive = record(source.pressDrive, 'run.pressDrive');
    onlyKeys(drive, ['id', 'limit'], 'run.pressDrive');
    if (!PRESS_DRIVES.some(d => d.id === drive.id)) throw new EngineError('INVALID_PAYLOAD', 'Unknown press pressure program.');
    out.pressDrive = { id: drive.id as PressDriveId, limit: finite(drive.limit, 'run.pressDrive.limit', 0, 100) };
  }
  if (source.stopOnFirstRupture !== undefined) {
    if (typeof source.stopOnFirstRupture !== 'boolean') throw new EngineError('INVALID_PAYLOAD', 'run.stopOnFirstRupture must be a boolean.');
    out.stopOnFirstRupture = source.stopOnFirstRupture;
  }
  return out;
}
export function validateStudioRunUpdate(value: unknown): StudioRunUpdate {
  const source = record(value, 'update');
  onlyKeys(source, ['speed', 'controls'], 'update');
  const out: StudioRunUpdate = {};
  if (source.speed !== undefined) out.speed = finite(source.speed, 'update.speed', .01, 16);
  if (source.controls !== undefined) out.controls = validateStudioControls(source.controls);
  return out;
}

export type StudioRunAdvance = Omit<StudioAdvance, 'ruptured'>;
export interface StudioRunHost {
  now(): number;
  /** Runs `task` after `delayMs` (0: as soon as pending messages are handled); returns a cancel function. */
  schedule(task: () => void, delayMs: number): () => void;
  /** Publishes the merged advance as a live snapshot; returns false, having changed nothing, when no snapshot can be lent. */
  publish(advance: StudioRunAdvance, state: StudioRunState): boolean;
  fail(error: unknown): void;
}

/** One free run of a StudioRuntime. Stepping, publication and backpressure live here; transport lives in the host. */
export class StudioRunLoop {
  private readonly pacer: FreeRunPacer;
  private readonly request: StudioRunRequest;
  private pending?: StudioRunAdvance;
  /** Controls applied at the next tick (and kept as the base of a pressure program). */
  private queued?: StudioControls;
  private base: StudioControls = {};
  private finished: StudioRunState['stopReason'] = null;
  private cancel?: () => void;
  private lastPublish = -Infinity;
  private costPerTick = 1;
  private closed = false;
  private readonly runtime: StudioRuntime;
  private readonly host: StudioRunHost;
  constructor(runtime: StudioRuntime, request: StudioRunRequest, host: StudioRunHost) {
    this.runtime = runtime; this.host = host;
    this.request = validateStudioRun(request);
    this.pacer = new FreeRunPacer(FIXED_DT, { speed: this.request.speed, maxLagSeconds: this.request.maxLagSeconds ?? STUDIO_RUN_DEFAULT_LAG, tick: runtime.tick, nowMs: host.now() });
    this.queued = this.request.controls;
    this.wake(0);
  }
  get active(): boolean { return !this.closed; }
  state(): StudioRunState {
    return { running: this.finished === null, stopReason: this.finished, lagSeconds: this.pacer.lagSeconds, overloads: this.pacer.overloads, speed: this.pacer.speed };
  }
  update(value: StudioRunUpdate): void {
    if (this.closed || this.finished) return;
    const update = validateStudioRunUpdate(value);
    if (update.speed !== undefined) this.pacer.retime(this.host.now(), this.runtime.tick, update.speed);
    if (update.controls) this.queued = { ...this.queued, ...update.controls };
  }
  /** Stops stepping at the current tick; the next publication is the pause frame. */
  pause(): void {
    if (this.closed) return;
    if (!this.finished) this.finished = 'pause';
    this.wake(0, true);
  }
  /** A loan came back: retry a publication that met backpressure. */
  onCapacity(): void { if (!this.closed) this.wake(0, true); }
  /** Ends the run without publishing (reset or disposal). */
  close(): void { this.closed = true; this.cancel?.(); this.cancel = undefined; }

  private wake(delayMs: number, replace = false): void {
    if (this.closed) return;
    if (this.cancel) { if (!replace) return; this.cancel(); }
    this.cancel = this.host.schedule(this.pump, delayMs);
  }
  private commands(ticks: number): StudioCommand[] {
    const next = this.runtime.tick + 1, drive = this.request.pressDrive;
    if (this.queued) { this.base = { ...this.base, ...this.queued }; }
    if (drive) {
      this.queued = undefined;
      return Array.from({ length: ticks }, (_, i) => ({ tick: next + i, type: 'controls' as const, values: { ...this.base, targetLoad: pressDrivePressure(drive.id, (next + i) * FIXED_DT, drive.limit) / 20 } }));
    }
    if (!this.queued) return [];
    const values = this.queued; this.queued = undefined;
    return [{ tick: next, type: 'controls', values }];
  }
  private merge(a: StudioAdvance): void {
    const p = this.pending;
    if (!p) { const { ruptured: _ruptured, ...rest } = a; this.pending = rest; return; }
    p.tick = a.tick; p.completedTicks += a.completedTicks; p.recordingSamples.push(...a.recordingSamples); p.eventDelta.push(...a.eventDelta);
    p.completionReason = a.completionReason; p.simMs += a.simMs;
  }
  private readonly pump = (): void => {
    this.cancel = undefined;
    if (this.closed) return;
    try {
      const sliceStart = this.host.now();
      if (!this.finished) {
        let due = this.pacer.due(sliceStart, this.runtime.tick);
        while (due > 0 && (this.pending?.completedTicks ?? 0) < STUDIO_RUN_MAX_UNPUBLISHED_TICKS) {
          const room = STUDIO_RUN_MAX_UNPUBLISHED_TICKS - (this.pending?.completedTicks ?? 0);
          const ticks = Math.max(1, Math.min(due, room, 64, Math.floor(STUDIO_RUN_SLICE_MS / 2 / this.costPerTick)));
          const before = this.host.now();
          const advance = this.runtime.advance({ ticks, commands: this.commands(ticks), ...(this.request.stopAtTime === undefined ? {} : { stopAtTime: this.request.stopAtTime }) }, { stopOnFirstRupture: this.request.stopOnFirstRupture });
          const now = this.host.now();
          if (advance.completedTicks) this.costPerTick = Math.max(.05, .7 * this.costPerTick + .3 * (now - before) / advance.completedTicks);
          this.merge(advance);
          if (advance.completionReason) { this.finished = advance.completionReason; break; }
          if (advance.ruptured) { this.finished = 'first-rupture'; break; }
          if (now - sliceStart >= STUDIO_RUN_SLICE_MS) break;
          due = this.pacer.due(now, this.runtime.tick);
        }
      }
      const now = this.host.now(), unpublished = this.pending?.completedTicks ?? 0;
      if (this.finished || (this.pending && (now - this.lastPublish >= STUDIO_RUN_PUBLISH_MS || unpublished >= STUDIO_RUN_MAX_UNPUBLISHED_TICKS))) {
        const tick = this.runtime.tick;
        const advance = this.pending ?? { startTick: tick, tick, completedTicks: 0, recordingSamples: [], eventDelta: [], completionReason: null, simMs: 0 };
        if (this.host.publish(advance, this.state())) {
          this.pending = undefined; this.lastPublish = now;
          if (this.finished) { this.close(); return; }
        } else {
          // Every loan is out. Shared rings are released without a message, so poll briefly; recycled loans wake us sooner.
          this.wake(4); return;
        }
      }
      if (this.finished) { this.wake(0); return; }
      if (this.pacer.due(now, this.runtime.tick) > 0) { this.wake(0); return; }
      const nextTick = this.pacer.nextDueMs(this.runtime.tick) - now;
      const nextPublish = this.pending ? this.lastPublish + STUDIO_RUN_PUBLISH_MS - now : Infinity;
      this.wake(Math.max(1, Math.min(nextTick, nextPublish, 100)));
    } catch (error) {
      this.close();
      this.host.fail(error);
    }
  };
}

/** Schedules immediate tasks through a MessageChannel (no timer clamping in workers); delayed ones with setTimeout. */
export function createRunScheduler(): { schedule(task: () => void, delayMs: number): () => void; close(): void } {
  let channel: MessageChannel | undefined;
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    schedule(task, delayMs) {
      if (delayMs > 0 || typeof MessageChannel === 'undefined') { const timer = setTimeout(task, Math.max(0, delayMs)); return () => clearTimeout(timer); }
      if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = (event: MessageEvent<number>) => { const run = queue.get(event.data); queue.delete(event.data); run?.(); };
      }
      const id = next++; queue.set(id, task); channel.port2.postMessage(id);
      return () => { queue.delete(id); };
    },
    close() { queue.clear(); channel?.port1.close(); channel?.port2.close(); channel = undefined; },
  };
}
