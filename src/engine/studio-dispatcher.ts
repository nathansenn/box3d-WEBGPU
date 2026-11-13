import { EngineError } from './contracts.ts';
import { StudioRuntime, type StudioRunState, type StudioStepResult } from './studio-runtime.ts';
import { snapshotTransfers, validateStudioBuffers, validateStudioWorkerRequest, type StudioSnapshotOp, type StudioWorkerResponse } from './studio-protocol.ts';
import { StudioRunLoop, createRunScheduler, type StudioRunAdvance, type StudioRunHost, type StudioRunRequest } from './studio-run.ts';
import { StudioSharedWriter, type StudioSharedWrite } from './studio-shared.ts';

/** The identical dispatcher is hosted by a browser Worker and the Node test harness. */
export function createStudioWorkerDispatcher(send: (message: StudioWorkerResponse, transfer: ArrayBuffer[]) => void, host: Partial<Pick<StudioRunHost, 'now' | 'schedule'>> = {}) {
  let runtime: StudioRuntime | undefined;
  /** The free run, its id (frames carry it) and the id of a pause waiting for its frame. */
  let run: { loop: StudioRunLoop; id: number; generation: number; pauseId: number } | undefined;
  const scheduler = createRunScheduler();
  const now = host.now ?? (() => performance.now()), schedule = host.schedule ?? scheduler.schedule;
  const stopRun = () => { run?.loop.close(); run = undefined; };
  let generation = 0, nextLoanId = 1, lastRequestId = 0;
  let disposed = false;
  let shared: StudioSharedWriter | undefined;
  const loans = new Map<number, { result: StudioStepResult; positions: number; strains: number; broken: number }>();
  const clear = () => {
    stopRun();
    shared?.close(); shared = undefined;
    runtime?.destroy();
    for (const loan of loans.values()) loan.result.release();
    loans.clear();
  };
  const publish = (id: number, op: StudioSnapshotOp, result: StudioStepResult, write?: StudioSharedWrite) => {
    if (shared && write) {
      try {
        const { positions, strains, broken, ...metadata } = result.liveSnapshot;
        write.buffers.positions.set(positions); write.buffers.strains.set(strains); write.buffers.broken.set(broken);
        const { release: _release, ...data } = result;
        const ticket = shared.publish(write, result.tick);
        send({ v: 1, id, generation, type: 'shared-snapshot', op, data: { ...data, liveSnapshot: metadata }, ticket,
          ...(op === 'reset' ? { shared: shared.descriptor } : {}) }, result.recordingSamples.flatMap(sample => snapshotTransfers(sample.snapshot)));
      } finally { result.release(); }
      return;
    }
    const loanId = nextLoanId++;
    const snapshot = result.liveSnapshot;
    loans.set(loanId, { result, positions: snapshot.positions.length, strains: snapshot.strains.length, broken: snapshot.broken.length });
    const { release: _release, ...data } = result;
    const transfer = [...snapshotTransfers(snapshot), ...result.recordingSamples.flatMap(sample => snapshotTransfers(sample.snapshot))];
    try { send({ v: 1, id, generation, type: 'snapshot', op, data, loanId }, transfer); }
    catch (error) { loans.delete(loanId); result.release(); throw error; }
  };
  /** Publishes a run frame; false (nothing changed) when every snapshot is lent. */
  const publishRun = (id: number, op: 'run' | 'pause', advance: StudioRunAdvance, state: StudioRunState): boolean => {
    const live = runtime!;
    if (shared) {
      let write;
      try { write = shared.acquire(); } catch (error) { if (error instanceof EngineError && error.code === 'BACKPRESSURE') return false; throw error; }
      let result: StudioStepResult;
      try { result = live.capture(advance, state); } catch (error) { shared.abort(write); throw error; }
      publish(id, op, result, write);
      return true;
    }
    if (!live.canLend) return false;
    publish(id, op, live.capture(advance, state));
    return true;
  };
  const startRun = (id: number, request: StudioRunRequest, runGeneration: number) => {
    const entry = { id, generation: runGeneration, pauseId: 0 } as { loop: StudioRunLoop; id: number; generation: number; pauseId: number };
    entry.loop = new StudioRunLoop(runtime!, request, {
      now, schedule,
      publish: (advance, state) => {
        if (run !== entry) return true;
        // The frame that ends the run answers a pending pause, whatever ended it.
        const pausing = entry.pauseId > 0 && !state.running;
        const published = publishRun(pausing ? entry.pauseId : entry.id, pausing ? 'pause' : 'run', advance, state);
        if (published && !state.running) run = undefined;
        return published;
      },
      fail: error => {
        if (run !== entry) return;
        run = undefined;
        send({ v: 1, id: entry.pauseId || entry.id, generation: entry.generation, type: 'error', code: 'RUNTIME_ERROR', message: error instanceof Error ? error.message : 'Studio run failed.' }, []);
      },
    });
    run = entry;
  };
  const advance = (id: number, op: 'step' | 'inspect' | 'reset', action: () => StudioStepResult) => {
    // Reserve before stepping: a full ring must reject without applying commands.
    const write = shared?.acquire();
    try { publish(id, op, action(), write); }
    catch (error) { if (write) shared?.abort(write); throw error; }
  };
  return {
    handle(value: unknown): void {
      let id = 0, replyGeneration = generation;
      try {
        const message = validateStudioWorkerRequest(value);
        id = message.id; replyGeneration = message.generation;
        if (disposed) throw new EngineError('DISPOSED', 'Worker runtime is disposed.');
        if (message.type === 'create' || message.type === 'reset') {
          if ((message.type === 'create' && runtime) || message.generation <= generation) throw new EngineError('STALE_GENERATION', 'This generation is no longer current.');
          if (message.id <= lastRequestId) throw new EngineError('STALE_REQUEST', 'Request IDs must increase.');
          const candidate = StudioRuntime.create(message.options);
          let candidateShared: StudioSharedWriter | undefined;
          try {
            if (message.snapshots === 'shared' || (message.type === 'reset' && message.snapshots === undefined && shared)) {
              const initial = candidate.inspect();
              try { candidateShared = new StudioSharedWriter({ positions: initial.liveSnapshot.positions.length, strains: initial.liveSnapshot.strains.length, broken: initial.liveSnapshot.broken.length }, message.generation); }
              finally { initial.release(); }
            }
          } catch (error) { candidate.destroy(); throw error; }
          clear();
          runtime = candidate; shared = candidateShared; generation = message.generation; lastRequestId = message.id;
          if (message.type === 'create') send({ v: 1, id, generation, type: 'ready', tick: runtime.tick, capabilities: runtime.capabilities, ...(shared ? { shared: shared.descriptor } : {}) }, []);
          else advance(id, 'reset', () => runtime!.inspect());
          return;
        }
        if (message.type === 'dispose') {
          if (message.generation < generation) throw new EngineError('STALE_GENERATION', 'Stale disposal ignored.');
          clear(); scheduler.close(); disposed = true; generation = message.generation;
          send({ v: 1, id, generation, type: 'disposed' }, []);
          return;
        }
        if (!runtime) throw new EngineError('NOT_CREATED', 'Create a runtime before using it.');
        if (message.generation !== generation) throw new EngineError('STALE_GENERATION', 'This generation is no longer current.');
        if (message.type === 'recycle') {
          if (shared) throw new EngineError('INVALID_LOAN', 'Shared snapshots are released atomically, not transferred.');
          const loan = loans.get(message.loanId);
          if (!loan) throw new EngineError('INVALID_LOAN', 'Snapshot loan was already released or belongs to another generation.');
          const buffers = validateStudioBuffers(message.buffers, loan);
          Object.assign(loan.result.liveSnapshot, buffers);
          loans.delete(message.loanId);
          loan.result.release();
          run?.loop.onCapacity();
          return;
        }
        if (message.type === 'run-update') {
          if (!run || message.id !== run.id || run.pauseId) throw new EngineError('NOT_RUNNING', 'No free run with this id is active.');
          run.loop.update(message.update);
          return;
        }
        if (message.id <= lastRequestId) throw new EngineError('STALE_REQUEST', 'Request IDs must increase.');
        if (message.type === 'pause') {
          lastRequestId = message.id;
          if (run && !run.pauseId) { run.pauseId = message.id; run.loop.pause(); return; }
          if (run) throw new EngineError('BUSY', 'A pause is already pending.');
          // No run (it already ended): the pause frame is the current state.
          const tick = runtime.tick;
          if (!publishRun(message.id, 'pause', { startTick: tick, tick, completedTicks: 0, recordingSamples: [], eventDelta: [], completionReason: null, simMs: 0 }, { running: false, stopReason: 'pause', lagSeconds: 0, overloads: 0, speed: 1 })) throw new EngineError('BACKPRESSURE', 'Release a live snapshot before pausing.');
          return;
        }
        if (run) throw new EngineError('BUSY', 'Pause the free run before stepping, inspecting or exporting.');
        if (message.type === 'run') {
          lastRequestId = message.id;
          startRun(message.id, message.request, message.generation);
          send({ v: 1, id, generation, type: 'running', tick: runtime.tick }, []);
          return;
        }
        // Runtime validation happens before either the fixed tick or the request cursor changes.
        if (message.type === 'step') advance(id, 'step', () => runtime!.step(message.request));
        else if (message.type === 'inspect') advance(id, 'inspect', () => runtime!.inspect());
        else if (message.type === 'checkpoint') send({ v: 1, id, generation, type: 'checkpoint', checkpoint: runtime.exportCheckpoint() }, []);
        lastRequestId = message.id;
      } catch (error) {
        // Recover usable routing metadata even when validation rejected the rest of the envelope.
        if (value && typeof value === 'object') {
          const m = value as Record<string, unknown>;
          if (typeof m.id === 'number' && Number.isSafeInteger(m.id) && m.id >= 0) id = m.id;
          if (typeof m.generation === 'number' && Number.isSafeInteger(m.generation) && m.generation >= 1) replyGeneration = m.generation;
        }
        send({ v: 1, id, generation: replyGeneration, type: 'error', code: error instanceof EngineError ? error.code : 'RUNTIME_ERROR', message: error instanceof Error ? error.message : 'Worker operation failed.' }, []);
      }
    },
    stats() { return { generation, disposed, outstandingLoans: shared?.diagnostics().outstanding ?? loans.size, shared: shared?.diagnostics(), tick: runtime?.tick ?? 0, pool: runtime?.poolStats() ?? { allocated: 0, free: 0, outstanding: 0 } }; },
    destroy(): void { clear(); scheduler.close(); disposed = true; },
  };
}
