import { EngineError } from './contracts.ts';
import { StudioRuntime, type StudioStepResult } from './studio-runtime.ts';
import { snapshotTransfers, validateStudioBuffers, validateStudioWorkerRequest, type StudioWorkerResponse } from './studio-protocol.ts';

/** The identical dispatcher is hosted by a browser Worker and the Node test harness. */
export function createStudioWorkerDispatcher(send: (message: StudioWorkerResponse, transfer: ArrayBuffer[]) => void) {
  let runtime: StudioRuntime | undefined;
  let generation = 0, nextLoanId = 1, lastRequestId = 0;
  let disposed = false;
  const loans = new Map<number, { result: StudioStepResult; positions: number; strains: number; broken: number }>();
  const clear = () => {
    runtime?.destroy();
    for (const loan of loans.values()) loan.result.release();
    loans.clear();
  };
  const publish = (id: number, op: 'step' | 'inspect' | 'reset', result: StudioStepResult) => {
    const loanId = nextLoanId++;
    const snapshot = result.liveSnapshot;
    loans.set(loanId, { result, positions: snapshot.positions.length, strains: snapshot.strains.length, broken: snapshot.broken.length });
    const { release: _release, ...data } = result;
    const transfer = [...snapshotTransfers(snapshot), ...result.recordingSamples.flatMap(sample => snapshotTransfers(sample.snapshot))];
    try { send({ v: 1, id, generation, type: 'snapshot', op, data, loanId }, transfer); }
    catch (error) { loans.delete(loanId); result.release(); throw error; }
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
          clear();
          runtime = candidate; generation = message.generation; lastRequestId = message.id;
          if (message.type === 'create') send({ v: 1, id, generation, type: 'ready', tick: runtime.tick, capabilities: runtime.capabilities }, []);
          else publish(id, 'reset', runtime.inspect());
          return;
        }
        if (message.type === 'dispose') {
          if (message.generation < generation) throw new EngineError('STALE_GENERATION', 'Stale disposal ignored.');
          clear(); disposed = true; generation = message.generation;
          send({ v: 1, id, generation, type: 'disposed' }, []);
          return;
        }
        if (!runtime) throw new EngineError('NOT_CREATED', 'Create a runtime before using it.');
        if (message.generation !== generation) throw new EngineError('STALE_GENERATION', 'This generation is no longer current.');
        if (message.type === 'recycle') {
          const loan = loans.get(message.loanId);
          if (!loan) throw new EngineError('INVALID_LOAN', 'Snapshot loan was already released or belongs to another generation.');
          const buffers = validateStudioBuffers(message.buffers, loan);
          Object.assign(loan.result.liveSnapshot, buffers);
          loans.delete(message.loanId);
          loan.result.release();
          return;
        }
        if (message.id <= lastRequestId) throw new EngineError('STALE_REQUEST', 'Request IDs must increase.');
        // Runtime validation happens before either the fixed tick or the request cursor changes.
        if (message.type === 'step') publish(id, 'step', runtime.step(message.request));
        else if (message.type === 'inspect') publish(id, 'inspect', runtime.inspect());
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
    stats() { return { generation, disposed, outstandingLoans: loans.size, tick: runtime?.tick ?? 0, pool: runtime?.poolStats() ?? { allocated: 0, free: 0, outstanding: 0 } }; },
    destroy(): void { clear(); disposed = true; },
  };
}
