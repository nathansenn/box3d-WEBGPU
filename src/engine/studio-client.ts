import { EngineError, integer, onlyKeys, record, type EngineCapabilities } from './contracts.ts';
import { type StudioCheckpoint } from '../studio/physics.ts';
import {
  STUDIO_CAPABILITIES, StudioRuntime, validateStudioOptions, validateStudioStep, resolveStudioBackend, studioCapabilitiesForBackend,
  type StudioCreateOptions, type StudioStepRequest, type StudioStepResult,
} from './studio-runtime.ts';
import { STUDIO_RUN_LIMITS, STUDIO_STEP_LIMITS, snapshotTransfers, validateStudioStepData, type StudioWorkerRequest, type StudioWorkerResponse } from './studio-protocol.ts';
import { StudioRunLoop, createRunScheduler, validateStudioRun, validateStudioRunUpdate, type StudioRunRequest, type StudioRunUpdate } from './studio-run.ts';
import { StudioSharedReader, studioSharedMemorySupport, type StudioSharedRead } from './studio-shared.ts';

export interface StudioWorkerLike {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: any) => void): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: any) => void): void;
  terminate(): unknown;
}
export interface StudioTransportOptions {
  mode?: 'auto' | 'worker' | 'sync';
  workerFactory?: () => StudioWorkerLike;
  timeoutMs?: number;
  /** Default transfer is compatible without browser isolation. Shared is opt-in. */
  snapshots?: 'transfer' | 'shared' | 'auto';
}
export interface StudioClient {
  readonly mode: 'worker' | 'sync';
  readonly fallbackReason?: string;
  readonly snapshotTransport: 'direct' | 'transfer' | 'shared';
  readonly snapshotFallbackReason?: string;
  readonly capabilities: EngineCapabilities;
  readonly tick: number;
  step(request: StudioStepRequest): Promise<StudioStepResult>;
  inspect(): Promise<StudioStepResult>;
  /** Invalidates pending responses immediately, before returning the Promise. */
  reset(options: StudioCreateOptions): Promise<StudioStepResult>;
  exportCheckpoint(): Promise<StudioCheckpoint>;
  /** True while a free run is active: step, inspect and exportCheckpoint are refused until pause() resolves. */
  readonly running: boolean;
  /** Starts a free run (studio-run.ts). Frames arrive through `handlers.frame`, each a loan to release; the frame that
   * ends the run by itself (completion, time limit, first rupture) has `run.running === false`. Resolves once started. */
  run(request: StudioRunRequest, handlers: StudioRunHandlers): Promise<void>;
  /** Speed or controls of the active run, applied at its next tick. */
  updateRun(update: StudioRunUpdate): void;
  /** Stops the run at its current tick and returns that state (also when the run had already ended). */
  pause(): Promise<StudioStepResult>;
  destroy(): Promise<void>;
  diagnostics(): { generation: number; inFlight: boolean; outstandingLoans: number; failed: boolean; sharedBytes?: number };
}

export interface StudioRunHandlers { frame(result: StudioStepResult): void; error?(error: EngineError): void }
const engineError = (error: unknown) => error instanceof EngineError ? error : new EngineError('RUNTIME_ERROR', error instanceof Error ? error.message : 'Studio run failed.');
/** A frame handler that throws must not break the transport; its error is reported asynchronously. */
function deliver(handlers: StudioRunHandlers, result: StudioStepResult): void {
  try { handlers.frame(result); } catch (error) { result.release(); queueMicrotask(() => { throw error; }); }
}

class SyncStudioClient implements StudioClient {
  readonly mode = 'sync' as const;
  readonly snapshotTransport = 'direct' as const;
  get capabilities():EngineCapabilities { return this.runtime.capabilities; }
  readonly fallbackReason?: string;
  private runtime: StudioRuntime;
  private generation = 1;
  private disposed = false;
  private loop?: StudioRunLoop;
  private pauseWaiter?: { resolve(result: StudioStepResult): void; reject(error: unknown): void };
  private scheduler = createRunScheduler();
  constructor(options: StudioCreateOptions, fallbackReason?: string) { this.runtime = StudioRuntime.create(options); this.fallbackReason = fallbackReason; }
  get tick(): number { return this.runtime.tick; }
  get running(): boolean { return !!this.loop; }
  private idle(): void { if (this.loop) throw new EngineError('BUSY', 'Pause the free run first.'); }
  async step(request: StudioStepRequest): Promise<StudioStepResult> { this.idle(); return this.runtime.step(request); }
  async inspect(): Promise<StudioStepResult> { this.idle(); return this.runtime.inspect(); }
  private stopRun(error: EngineError): void {
    this.loop?.close(); this.loop = undefined;
    const waiter = this.pauseWaiter; this.pauseWaiter = undefined; waiter?.reject(error);
  }
  async reset(options: StudioCreateOptions): Promise<StudioStepResult> {
    const valid = validateStudioOptions(options);
    if (valid.initialCheckpoint !== undefined) StudioRuntime.create(valid).destroy();
    this.stopRun(new EngineError('RESET', 'Run superseded by a reset.'));
    const result = this.runtime.reset(valid);
    this.generation++;
    return result;
  }
  async exportCheckpoint(): Promise<StudioCheckpoint> { this.idle(); return this.runtime.exportCheckpoint(); }
  async run(request: StudioRunRequest, handlers: StudioRunHandlers): Promise<void> {
    if (this.disposed) throw new EngineError('DISPOSED', 'Studio client is destroyed.');
    this.idle();
    const valid = validateStudioRun(request), generation = this.generation;
    const loop: StudioRunLoop = new StudioRunLoop(this.runtime, valid, {
      now: () => performance.now(), schedule: this.scheduler.schedule,
      publish: (advance, state) => {
        if (this.loop !== loop || generation !== this.generation) return true;
        if (!this.runtime.canLend) return false;
        const result = this.runtime.capture(advance, state);
        if (!state.running) {
          this.loop = undefined;
          const waiter = this.pauseWaiter; this.pauseWaiter = undefined;
          if (waiter) { waiter.resolve(result); return true; }
        }
        deliver(handlers, result);
        return true;
      },
      fail: error => { if (this.loop !== loop) return; this.stopRun(engineError(error)); handlers.error?.(engineError(error)); },
    });
    this.loop = loop;
  }
  updateRun(update: StudioRunUpdate): void {
    if (!this.loop) throw new EngineError('NOT_RUNNING', 'No free run is active.');
    this.loop.update(validateStudioRunUpdate(update));
  }
  async pause(): Promise<StudioStepResult> {
    if (this.disposed) throw new EngineError('DISPOSED', 'Studio client is destroyed.');
    if (!this.loop) {
      const tick = this.runtime.tick;
      return this.runtime.capture({ startTick: tick, tick, completedTicks: 0, recordingSamples: [], eventDelta: [], completionReason: null, simMs: 0 }, { running: false, stopReason: 'pause', lagSeconds: 0, overloads: 0, speed: 1 });
    }
    if (this.pauseWaiter) throw new EngineError('BUSY', 'A pause is already pending.');
    return new Promise((resolve, reject) => { this.pauseWaiter = { resolve, reject }; this.loop!.pause(); });
  }
  async destroy(): Promise<void> { this.stopRun(new EngineError('DISPOSED', 'Studio client was destroyed.')); this.scheduler.close(); this.runtime.destroy(); this.disposed = true; this.generation++; }
  diagnostics() { return { generation: this.generation, inFlight: false, outstandingLoans: this.runtime.poolStats().outstanding, failed: this.disposed }; }
}

type DeliveredResponse = StudioWorkerResponse & { sharedLease?: StudioSharedRead };
interface PendingRequest {
  id: number;
  generation: number;
  op: StudioWorkerRequest['type'];
  expectedCapabilities:EngineCapabilities;
  startTick: number;
  ticks: number;
  handlers?: StudioRunHandlers;
  resolve(value: DeliveredResponse): void;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

class WorkerStudioClient implements StudioClient {
  readonly mode = 'worker' as const;
  private currentCapabilities:EngineCapabilities=STUDIO_CAPABILITIES;
  get capabilities():EngineCapabilities { return this.currentCapabilities; }
  readonly snapshotTransport: 'transfer' | 'shared';
  readonly snapshotFallbackReason?: string;
  private worker: StudioWorkerLike;
  private timeoutMs: number;
  private generation = 1;
  private nextId = 1;
  private currentTick = 0;
  private pending?: PendingRequest;
  private disposed = false;
  private failure?: EngineError;
  private study: StudioCreateOptions['study'];
  private loans = new Set<StudioStepResult>();
  private shared?: StudioSharedReader;
  /** The active free run: frames carry its id. */
  private active?: { id: number; handlers: StudioRunHandlers };

  constructor(worker: StudioWorkerLike, options: StudioCreateOptions, timeoutMs: number, snapshots: 'transfer' | 'shared', snapshotFallbackReason?: string) {
    this.worker = worker; this.study = options.study; this.timeoutMs = timeoutMs;
    this.currentCapabilities=studioCapabilitiesForBackend(resolveStudioBackend(options));
    this.snapshotTransport = snapshots; this.snapshotFallbackReason = snapshotFallbackReason;
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
    worker.addEventListener('messageerror', this.onMessageError);
  }
  get tick(): number { return this.currentTick; }
  async initialize(options: StudioCreateOptions): Promise<void> { await this.request({ type: 'create', options }); }

  private assertReady(): void {
    if (this.disposed) throw new EngineError('DISPOSED', 'Studio client is destroyed.');
    if (this.failure) throw this.failure;
  }
  private rejectPending(error: unknown): void {
    if (!this.pending) return;
    const pending = this.pending; this.pending = undefined;
    clearTimeout(pending.timer); pending.reject(error);
  }
  get running(): boolean { return !!this.active; }
  private fail(error: EngineError): void {
    if (this.disposed) return;
    this.failure = error; this.rejectPending(error);
    const active = this.active; this.active = undefined; active?.handlers.error?.(error);
    this.shared?.close();
    this.worker.terminate();
  }
  private onError = (event: { message?: string }) => { this.fail(new EngineError('WORKER_ERROR', event.message || 'Studio worker failed.')); };
  private onMessageError = () => { this.fail(new EngineError('WORKER_MESSAGE_ERROR', 'Studio worker response could not be decoded.')); };

  private onMessage = (event: MessageEvent<unknown>) => {
    if (this.disposed || this.failure) return;
    const raw = event.data;
    if (!raw || typeof raw !== 'object') { this.fail(new EngineError('INVALID_RESPONSE', 'Worker returned a malformed message.')); return; }
    const candidate = raw as Record<string, unknown>;
    // A late response cannot update state, resolve a new request, or reclaim a current loan.
    if (candidate.generation !== this.generation) return;
    const active = this.active;
    if (active && candidate.id === active.id) { this.onRunFrame(raw, active); return; }
    const pending = this.pending;
    if (!pending || candidate.id !== pending.id) return;
    let sharedLease: StudioSharedRead | undefined;
    try {
      let m = record(raw, 'response');
      if (m.v !== 1) throw new EngineError('INVALID_RESPONSE', 'Unknown worker response protocol.');
      integer(m.id, 'response.id', 1); integer(m.generation, 'response.generation', 1);
      if (m.type === 'error') {
        onlyKeys(m, ['v', 'id', 'generation', 'type', 'code', 'message'], 'response');
        if (typeof m.code !== 'string' || typeof m.message !== 'string') throw new EngineError('INVALID_RESPONSE', 'Malformed worker error.');
        const error = new EngineError(m.code, m.message);
        if (m.code === 'RUNTIME_ERROR') this.fail(error); else this.rejectPending(error);
        return;
      }
      if (pending.op === 'create') {
        onlyKeys(m, ['v', 'id', 'generation', 'type', 'tick', 'capabilities', 'shared'], 'response');
        if (m.type !== 'ready' || JSON.stringify(m.capabilities) !== JSON.stringify(pending.expectedCapabilities)) throw new EngineError('MODEL_MISMATCH', 'Worker did not initialize the selected Studio model.');
        if (this.snapshotTransport === 'shared') {
          if (!m.shared) throw new EngineError('SHARED_UNAVAILABLE', 'Worker did not negotiate shared snapshots.');
          this.shared = new StudioSharedReader(m.shared, this.generation);
        } else if (m.shared !== undefined) throw new EngineError('INVALID_RESPONSE', 'Worker selected an unrequested shared transport.');
        this.currentTick = integer(m.tick, 'response.tick');
      } else if (pending.op === 'run') {
        onlyKeys(m, ['v', 'id', 'generation', 'type', 'tick'], 'response');
        if (m.type !== 'running' || integer(m.tick, 'response.tick') !== this.currentTick) throw new EngineError('INVALID_RESPONSE', 'Worker did not start the run at the current tick.');
        // Set before resolving: the run's first frame may be the next message.
        this.active = { id: pending.id, handlers: pending.handlers! };
      } else if (pending.op === 'checkpoint') {
        onlyKeys(m, ['v', 'id', 'generation', 'type', 'checkpoint'], 'response');
        if (m.type !== 'checkpoint') throw new EngineError('INVALID_RESPONSE', 'Expected a checkpoint.');
        const validator = StudioRuntime.create({ study: this.study, initialCheckpoint: m.checkpoint });
        try { if(JSON.stringify(validator.capabilities)!==JSON.stringify(pending.expectedCapabilities))throw new EngineError('MODEL_MISMATCH','Checkpoint backend does not match the selected model.'); if (validator.tick !== this.tick) throw new EngineError('INVALID_RESPONSE', 'Checkpoint does not match current tick.'); } finally { validator.destroy(); }
      } else {
        // A pause answers after the run's last frames, so it continues from the tick those frames reached.
        const startTick = pending.op === 'pause' ? this.currentTick : pending.startTick;
        ({ m, sharedLease } = this.decodeSnapshot(m, pending.op as 'step' | 'inspect' | 'reset' | 'pause', pending.expectedCapabilities, startTick, pending.ticks));
        if (pending.op === 'pause') this.active = undefined;
      }
      this.currentCapabilities=pending.expectedCapabilities;
      this.pending = undefined; clearTimeout(pending.timer);
      pending.resolve({ ...m, ...(sharedLease ? { sharedLease } : {}) } as unknown as DeliveredResponse);
    } catch (error) {
      sharedLease?.release();
      this.fail(error instanceof EngineError ? error : new EngineError('INVALID_RESPONSE', 'Worker response validation failed.'));
    }
  };
  /** Validates a snapshot response (stepped, run frame or pause) and advances the client tick. */
  private decodeSnapshot(raw: Record<string, unknown>, op: 'step' | 'inspect' | 'reset' | 'run' | 'pause', expectedCapabilities: EngineCapabilities, startTick: number, ticks: number): { m: Record<string, unknown>; sharedLease?: StudioSharedRead } {
    let m = raw, sharedLease: StudioSharedRead | undefined;
    const free = op === 'run' || op === 'pause', limits = free ? STUDIO_RUN_LIMITS : STUDIO_STEP_LIMITS;
    try {
      if (this.snapshotTransport === 'shared') {
        onlyKeys(m, ['v', 'id', 'generation', 'type', 'op', 'data', 'ticket', 'shared'], 'response');
        if (m.type !== 'shared-snapshot' || m.op !== op) throw new EngineError('INVALID_RESPONSE', 'Expected the negotiated shared snapshot.');
        if (op === 'reset') this.shared = new StudioSharedReader(m.shared, this.generation);
        else if (m.shared !== undefined) throw new EngineError('INVALID_RESPONSE', 'Shared buffers may only change during reset.');
        if (!this.shared) throw new EngineError('INVALID_RESPONSE', 'Shared snapshot ring was not initialized.');
        const wire = record(m.data, 'result'), metadata = record(wire.liveSnapshot, 'snapshot');
        onlyKeys(metadata, ['study', 'topologyVersion', 'topologyIdentity', 'punchY', 'response', 'press', 'si'], 'snapshot');
        if (record(m.ticket, 'ticket').tick !== wire.tick) throw new EngineError('INVALID_RESPONSE', 'Shared publication tick disagrees with its metadata.');
        sharedLease = this.shared.acquire(m.ticket);
        m = { v: m.v, id: m.id, generation: m.generation, type: 'snapshot', op: m.op, loanId: m.id,
          data: { ...wire, liveSnapshot: { ...metadata, ...sharedLease.buffers } } };
      }
      onlyKeys(m, ['v', 'id', 'generation', 'type', 'op', 'data', 'loanId'], 'response');
      if (m.type !== 'snapshot' || m.op !== op) throw new EngineError('INVALID_RESPONSE', 'Worker snapshot does not match the pending operation.');
      integer(m.loanId, 'loanId', 1);
      const data = validateStudioStepData(m.data, sharedLease?.buffers, expectedCapabilities, limits);
      if (data.liveSnapshot.study !== this.study) throw new EngineError('MODEL_MISMATCH', 'Worker returned another study.');
      if (free !== (data.run !== undefined)) throw new EngineError('INVALID_RESPONSE', 'Run state belongs to run frames only.');
      if (op !== 'reset' && (data.tick !== startTick + data.completedTicks || (!free && data.completedTicks > ticks))) throw new EngineError('INVALID_RESPONSE', 'Worker advanced an unexpected number of ticks.');
      if (op === 'step' && !data.completed && data.completedTicks !== ticks) throw new EngineError('INVALID_RESPONSE', 'Worker omitted fixed ticks.');
      if (op === 'run' && data.run!.stopReason === 'pause') throw new EngineError('INVALID_RESPONSE', 'A pause frame must answer the pause request.');
      const expectedSamples = Math.floor(data.tick / 12) - Math.floor((data.tick - data.completedTicks) / 12);
      if (data.recordingSamples.length !== expectedSamples) throw new EngineError('INVALID_RESPONSE', 'Worker omitted recording samples.');
      this.currentTick = data.tick;
      return { m, sharedLease };
    } catch (error) { sharedLease?.release(); throw error; }
  }
  private onRunFrame(raw: object, active: { id: number; handlers: StudioRunHandlers }): void {
    try {
      const m = record(raw, 'response');
      if (m.v !== 1) throw new EngineError('INVALID_RESPONSE', 'Unknown worker response protocol.');
      if (m.type === 'error') {
        onlyKeys(m, ['v', 'id', 'generation', 'type', 'code', 'message'], 'response');
        throw new EngineError(typeof m.code === 'string' ? m.code : 'RUNTIME_ERROR', typeof m.message === 'string' ? m.message : 'Studio run failed.');
      }
      const { m: frame, sharedLease } = this.decodeSnapshot(m, 'run', this.capabilities, this.currentTick, 0);
      const result = this.loan({ ...frame, ...(sharedLease ? { sharedLease } : {}) } as unknown as DeliveredResponse);
      if (!result.run!.running) this.active = undefined;
      deliver(active.handlers, result);
    } catch (error) {
      this.fail(error instanceof EngineError ? error : new EngineError('INVALID_RESPONSE', 'Worker run frame validation failed.'));
    }
  }

  private request(body: { type: 'create' | 'reset'; options: StudioCreateOptions } | { type: 'step'; request: StudioStepRequest } | { type: 'run'; request: StudioRunRequest } | { type: 'inspect' | 'checkpoint' | 'pause' }, handlers?: StudioRunHandlers): Promise<DeliveredResponse> {
    this.assertReady();
    if (this.pending) return Promise.reject(new EngineError('BUSY', 'Only one Studio worker operation may be in flight.'));
    if (this.active && body.type !== 'pause' && body.type !== 'reset') return Promise.reject(new EngineError('BUSY', 'Pause the free run first.'));
    const expectedCapabilities=body.type==='create'||body.type==='reset'?studioCapabilitiesForBackend(resolveStudioBackend(body.options)):this.capabilities;
    const id = this.nextId++, generation = this.generation;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new EngineError('WORKER_TIMEOUT', 'Studio worker timed out; reset or recreate explicitly before continuing.')), this.timeoutMs);
      this.pending = { id, generation, op: body.type, expectedCapabilities, startTick: this.tick, ticks: body.type === 'step' ? body.request.ticks : 0, ...(handlers ? { handlers } : {}), resolve, reject, timer };
      try { this.worker.postMessage({ v: 1, id, generation, ...body,
        ...((body.type === 'create' || body.type === 'reset') && this.snapshotTransport === 'shared' ? { snapshots: 'shared' } : {}) }, []); }
      catch (error) { this.fail(new EngineError('WORKER_SEND_ERROR', error instanceof Error ? error.message : 'Could not send a worker request.')); }
    });
  }

  private loan(response: DeliveredResponse): StudioStepResult {
    if (response.type !== 'snapshot') throw new EngineError('INVALID_RESPONSE', 'Expected a live snapshot.');
    const generation = response.generation, loanId = response.loanId;
    let released = false;
    const result: StudioStepResult = {
      ...response.data, capabilities: this.capabilities,
      release: () => {
        if (released) return;
        released = true; this.loans.delete(result);
        if (response.sharedLease) { response.sharedLease.release(); return; }
        if (this.disposed || this.failure || generation !== this.generation) return;
        const snapshot = result.liveSnapshot;
        try {
          this.worker.postMessage({ v: 1, id: 0, generation, type: 'recycle', loanId,
            buffers: { positions: snapshot.positions, strains: snapshot.strains, broken: snapshot.broken } }, snapshotTransfers(snapshot));
        } catch (error) { this.fail(new EngineError('WORKER_RECYCLE_ERROR', error instanceof Error ? error.message : 'Snapshot recycling failed.')); }
      },
    };
    this.loans.add(result);
    return result;
  }
  async step(request: StudioStepRequest): Promise<StudioStepResult> {
    const valid = validateStudioStep(this.tick, request);
    const response = await this.request({ type: 'step', request: valid });
    if (response.generation !== this.generation) { response.sharedLease?.release(); throw new EngineError('RESET', 'Step was superseded by a reset.'); }
    return this.loan(response);
  }
  async inspect(): Promise<StudioStepResult> {
    const response = await this.request({ type: 'inspect' });
    if (response.generation !== this.generation) { response.sharedLease?.release(); throw new EngineError('RESET', 'Inspection was superseded by a reset.'); }
    return this.loan(response);
  }
  async reset(options: StudioCreateOptions): Promise<StudioStepResult> {
    this.assertReady();
    const valid = validateStudioOptions(options);
    resolveStudioBackend(valid);
    // Validate checkpoint setup before invalidating the client's live generation.
    if (valid.initialCheckpoint !== undefined) { const validator = StudioRuntime.create(valid); validator.destroy(); }
    this.rejectPending(new EngineError('RESET', 'Operation superseded by a reset.'));
    this.active = undefined;
    this.shared?.close(); this.shared = undefined;
    this.generation++; this.study = valid.study; this.loans.clear();
    const response = await this.request({ type: 'reset', options: valid });
    if (response.generation !== this.generation) { response.sharedLease?.release(); throw new EngineError('RESET', 'Reset was superseded by another reset.'); }
    return this.loan(response);
  }
  async run(request: StudioRunRequest, handlers: StudioRunHandlers): Promise<void> {
    const valid = validateStudioRun(request);
    const response = await this.request({ type: 'run', request: valid }, handlers);
    if (response.generation !== this.generation) throw new EngineError('RESET', 'Run was superseded by a reset.');
  }
  updateRun(update: StudioRunUpdate): void {
    this.assertReady();
    if (!this.active) throw new EngineError('NOT_RUNNING', 'No free run is active.');
    const valid = validateStudioRunUpdate(update);
    try { this.worker.postMessage({ v: 1, id: this.active.id, generation: this.generation, type: 'run-update', update: valid }, []); }
    catch (error) { this.fail(new EngineError('WORKER_SEND_ERROR', error instanceof Error ? error.message : 'Could not send a run update.')); }
  }
  async pause(): Promise<StudioStepResult> {
    const response = await this.request({ type: 'pause' });
    if (response.generation !== this.generation) { response.sharedLease?.release(); throw new EngineError('RESET', 'Pause was superseded by a reset.'); }
    return this.loan(response);
  }
  async exportCheckpoint(): Promise<StudioCheckpoint> {
    const response = await this.request({ type: 'checkpoint' });
    if (response.type !== 'checkpoint' || response.generation !== this.generation) throw new EngineError('RESET', 'Checkpoint was superseded by a reset.');
    return response.checkpoint as StudioCheckpoint;
  }
  async destroy(): Promise<void> {
    if (this.disposed) return;
    this.rejectPending(new EngineError('DISPOSED', 'Studio client was destroyed.'));
    this.active = undefined;
    this.disposed = true; this.generation++; this.loans.clear();
    this.shared?.close(); this.shared = undefined;
    try { this.worker.postMessage({ v: 1, id: this.nextId++, generation: this.generation, type: 'dispose' }, []); } catch { /* Termination also releases worker-owned resources. */ }
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.removeEventListener('messageerror', this.onMessageError);
    await this.worker.terminate();
  }
  diagnostics() { return { generation: this.generation, inFlight: !!this.pending, outstandingLoans: this.loans.size, failed: !!this.failure || this.disposed, ...(this.shared ? { sharedBytes: this.shared.diagnostics().bytes } : {}) }; }
}

/** Auto falls back only during initialization, before any command has run. Later faults never rewind a run silently. */
export async function createStudioClient(options: StudioCreateOptions, transport: StudioTransportOptions = {}): Promise<StudioClient> {
  const valid = validateStudioOptions(options);
  resolveStudioBackend(valid);
  const mode = transport.mode ?? 'auto';
  if (!['auto', 'worker', 'sync'].includes(mode)) throw new EngineError('INVALID_PAYLOAD', 'Unknown Studio transport mode.');
  const timeoutMs = transport.timeoutMs === undefined ? 30000 : integer(transport.timeoutMs, 'timeoutMs', 1, 120000);
  const snapshots = transport.snapshots ?? 'transfer';
  if (!['transfer', 'shared', 'auto'].includes(snapshots)) throw new EngineError('INVALID_PAYLOAD', 'Unknown Studio snapshot transport.');
  if (snapshots === 'shared' && mode === 'sync') throw new EngineError('INVALID_PAYLOAD', 'Shared snapshots require a worker.');
  const support = studioSharedMemorySupport();
  if (snapshots === 'shared' && !support.supported) throw new EngineError('SHARED_UNAVAILABLE', support.reason!);
  if (mode === 'sync') return new SyncStudioClient(valid);
  let selected: 'shared' | 'transfer' = snapshots === 'shared' || (snapshots === 'auto' && support.supported) ? 'shared' : 'transfer';
  let snapshotFallbackReason = snapshots === 'auto' && !support.supported ? support.reason : undefined;
  let client: WorkerStudioClient | undefined;
  const start = async () => {
    const worker = transport.workerFactory ? transport.workerFactory() : new Worker(new URL('./studio-worker.ts', import.meta.url), { type: 'module', name: 'box3d-studio-engine' });
    client = new WorkerStudioClient(worker, valid, timeoutMs, selected, snapshotFallbackReason);
    await client.initialize(valid);
    return client;
  };
  try {
    try { return await start(); }
    catch (error) {
      await client?.destroy();
      if (snapshots !== 'auto' || selected !== 'shared' || !(error instanceof EngineError) || error.code !== 'SHARED_UNAVAILABLE') throw error;
      selected = 'transfer'; snapshotFallbackReason = error.message;
      return await start();
    }
  } catch (error) {
    await client?.destroy();
    if (mode === 'worker' || snapshots === 'shared') throw error;
    return new SyncStudioClient(valid, error instanceof Error ? error.message : 'Worker initialization unavailable.');
  }
}
