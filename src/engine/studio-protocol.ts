import { EngineError, finite, integer, onlyKeys, record, type EngineCapabilities } from './contracts.ts';
import { FIXED_DT, type Snapshot } from '../studio/physics.ts';
import { STUDIO_CAPABILITIES, validateStudioOptions, type StudioCreateOptions, type StudioStepData, type StudioStepRequest } from './studio-runtime.ts';
import type { StudioSharedDescriptor, StudioSharedTicket } from './studio-shared.ts';

export const STUDIO_PROTOCOL_VERSION = 1;
export interface StudioBuffers { positions: Float32Array; strains: Float32Array; broken: Uint8Array }
interface Envelope { v: 1; id: number; generation: number }
export type StudioWorkerRequest = Envelope & (
  | { type: 'create' | 'reset'; options: StudioCreateOptions; snapshots?: 'transfer' | 'shared' }
  | { type: 'step'; request: StudioStepRequest }
  | { type: 'inspect' | 'checkpoint' | 'dispose' }
  | { type: 'recycle'; loanId: number; buffers: StudioBuffers }
);
export type StudioWorkerResponse = Envelope & (
  | { type: 'ready'; tick: number; capabilities: typeof STUDIO_CAPABILITIES; shared?: StudioSharedDescriptor }
  | { type: 'snapshot'; op: 'step' | 'inspect' | 'reset'; data: StudioStepData; loanId: number }
  | { type: 'shared-snapshot'; op: 'step' | 'inspect' | 'reset'; data: Omit<StudioStepData, 'liveSnapshot'> & { liveSnapshot: Omit<Snapshot, keyof StudioBuffers> }; ticket: StudioSharedTicket; shared?: StudioSharedDescriptor }
  | { type: 'checkpoint'; checkpoint: unknown }
  | { type: 'disposed' }
  | { type: 'error'; code: string; message: string }
);

export function validateStudioBuffers(value: unknown, expected?: { positions: number; strains: number; broken: number }, shared?: StudioBuffers): StudioBuffers {
  const b = record(value, 'buffers');
  onlyKeys(b, ['positions', 'strains', 'broken'], 'buffers');
  if (!(b.positions instanceof Float32Array) || !(b.strains instanceof Float32Array) || !(b.broken instanceof Uint8Array)) throw new EngineError('INVALID_PAYLOAD', 'Snapshot buffer types do not match the protocol.');
  const buffers = b as unknown as StudioBuffers;
  if (buffers.positions.length < 3 || buffers.positions.length > 150000 || buffers.positions.length !== buffers.strains.length * 3 || buffers.broken.length < 1 || buffers.broken.length > 100000) throw new EngineError('INVALID_PAYLOAD', 'Snapshot buffer dimensions are invalid.');
  const unique = new Set<ArrayBufferLike>();
  for (const key of ['positions', 'strains', 'broken'] as const) {
    const array = buffers[key];
    if (shared) {
      const owner = shared[key];
      if (array.buffer !== owner.buffer || array.byteOffset !== owner.byteOffset || array.length !== owner.length) throw new EngineError('INVALID_PAYLOAD', 'Shared snapshot views do not match the claimed ring slot.');
      continue;
    }
    if (!(array.buffer instanceof ArrayBuffer) || array.byteOffset !== 0 || array.byteLength !== array.buffer.byteLength || unique.has(array.buffer)) throw new EngineError('INVALID_PAYLOAD', 'Snapshot buffers must be distinct, complete, owned ArrayBuffers.');
    if (expected && array.length !== expected[key]) throw new EngineError('INVALID_PAYLOAD', 'Recycled buffer dimensions do not match the loan.');
    unique.add(array.buffer);
  }
  return buffers;
}

export function validateStudioWorkerRequest(value: unknown): StudioWorkerRequest {
  const m = record(value, 'message');
  if (m.v !== STUDIO_PROTOCOL_VERSION) throw new EngineError('INVALID_PAYLOAD', 'Unknown worker protocol version.');
  const base: Envelope = { v: 1, id: integer(m.id, 'id', m.type === 'recycle' ? 0 : 1), generation: integer(m.generation, 'generation', 1) };
  const envelope = ['v', 'id', 'generation', 'type'];
  switch (m.type) {
    case 'create': case 'reset':
      onlyKeys(m, [...envelope, 'options', 'snapshots'], 'message');
      if (m.snapshots !== undefined && m.snapshots !== 'transfer' && m.snapshots !== 'shared') throw new EngineError('INVALID_PAYLOAD', 'Unknown snapshot transport.');
      return { ...base, type: m.type, options: validateStudioOptions(m.options), ...(m.snapshots === undefined ? {} : { snapshots: m.snapshots }) };
    case 'step':
      onlyKeys(m, [...envelope, 'request'], 'message');
      record(m.request, 'request'); // Tick-dependent full validation is performed by the runtime before mutation.
      return { ...base, type: m.type, request: m.request as unknown as StudioStepRequest };
    case 'inspect': case 'checkpoint': case 'dispose':
      onlyKeys(m, envelope, 'message');
      return { ...base, type: m.type };
    case 'recycle':
      onlyKeys(m, [...envelope, 'loanId', 'buffers'], 'message');
      if (base.id !== 0) throw new EngineError('INVALID_PAYLOAD', 'Recycle messages do not allocate request IDs.');
      return { ...base, type: m.type, loanId: integer(m.loanId, 'loanId', 1), buffers: validateStudioBuffers(m.buffers) };
    default: throw new EngineError('INVALID_PAYLOAD', 'Unknown worker message.');
  }
}

export function snapshotTransfers(snapshot: Snapshot): ArrayBuffer[] {
  return [snapshot.positions.buffer, snapshot.strains.buffer, snapshot.broken.buffer] as ArrayBuffer[];
}

export function validateStudioSnapshot(value: unknown, shared?: StudioBuffers): Snapshot {
  const s = record(value, 'snapshot');
  onlyKeys(s, ['study', 'positions', 'broken', 'strains', 'topologyVersion', 'topologyIdentity', 'punchY', 'response', 'press'], 'snapshot');
  if (!['canopy', 'plate', 'bridge'].includes(s.study as string)) throw new EngineError('INVALID_PAYLOAD', 'Invalid snapshot study.');
  const arrays = validateStudioBuffers({ positions: s.positions, strains: s.strains, broken: s.broken }, undefined, shared);
  for (const n of arrays.positions) finite(n, 'position');
  for (const n of arrays.strains) finite(n, 'strain', 0);
  for (const n of arrays.broken) integer(n, 'broken', 0, 1);
  integer(s.topologyVersion, 'topologyVersion');
  if (typeof s.topologyIdentity !== 'string' || s.topologyIdentity.length > 200000) throw new EngineError('INVALID_PAYLOAD', 'Invalid topology identity.');
  finite(s.punchY, 'punchY');
  const r = record(s.response, 'response');
  onlyKeys(r, ['time', 'load', 'deflection', 'strain', 'broken', 'damage', 'plastic', 'phase'], 'response');
  for (const key of ['time', 'load', 'deflection', 'strain', 'damage', 'plastic']) finite(r[key], `response.${key}`, 0);
  integer(r.broken, 'response.broken', 0, arrays.broken.length);
  if (typeof r.phase !== 'string' || r.phase.length > 256) throw new EngineError('INVALID_PAYLOAD', 'Invalid response phase.');
  if (s.study === 'plate') {
    const p = record(s.press, 'press');
    onlyKeys(p, ['settings', 'travel', 'velocity', 'pressure', 'contacts', 'cycle'], 'press');
    validateStudioOptions({ study: 'plate', press: p.settings });
    for (const key of ['travel', 'velocity', 'pressure']) finite(p[key], `press.${key}`, 0);
    integer(p.contacts, 'contacts');
    if (typeof p.cycle !== 'string' || p.cycle.length > 64) throw new EngineError('INVALID_PAYLOAD', 'Invalid press cycle.');
  } else if (s.press !== undefined) throw new EngineError('INVALID_PAYLOAD', 'Unexpected press telemetry.');
  return s as unknown as Snapshot;
}

export function validateStudioStepData(value: unknown, shared?: StudioBuffers, expectedCapabilities:EngineCapabilities=STUDIO_CAPABILITIES): StudioStepData {
  const d = record(value, 'result');
  onlyKeys(d, ['tick', 'completedTicks', 'liveSnapshot', 'recordingSamples', 'eventDelta', 'completed', 'completionReason', 'simMs', 'capabilities'], 'result');
  const tick = integer(d.tick, 'tick');
  integer(d.completedTicks, 'completedTicks', 0, 120);
  finite(d.simMs, 'simMs', 0);
  if (typeof d.completed !== 'boolean' || ![null, 'press-complete', 'time-limit'].includes(d.completionReason as null)) throw new EngineError('INVALID_PAYLOAD', 'Invalid completion state.');
  if (d.completed !== (d.completionReason !== null)) throw new EngineError('INVALID_PAYLOAD', 'Completion fields disagree.');
  if (JSON.stringify(d.capabilities) !== JSON.stringify(expectedCapabilities)) throw new EngineError('MODEL_MISMATCH', 'Worker model capabilities do not match Studio.');
  const snapshot = validateStudioSnapshot(d.liveSnapshot, shared);
  if (Math.abs(snapshot.response.time / FIXED_DT - tick) > Math.max(.00001, tick * 1e-10)) throw new EngineError('INVALID_PAYLOAD', 'Snapshot time does not match its fixed tick.');
  if (!Array.isArray(d.recordingSamples) || d.recordingSamples.length > 10) throw new EngineError('INVALID_PAYLOAD', 'Invalid recording samples.');
  let previousTick = -1;
  for (const value of d.recordingSamples) {
    const sample = record(value, 'sample');
    onlyKeys(sample, ['tick', 'snapshot'], 'sample');
    const sampleTick = integer(sample.tick, 'sample.tick', 1, tick);
    if (sampleTick <= previousTick || sampleTick % 12 !== 0) throw new EngineError('INVALID_PAYLOAD', 'Recording cadence is invalid.');
    previousTick = sampleTick;
    const recorded = validateStudioSnapshot(sample.snapshot);
    if (recorded.study !== snapshot.study || Math.abs(recorded.response.time / FIXED_DT - sampleTick) > Math.max(.00001, tick * 1e-10)) throw new EngineError('INVALID_PAYLOAD', 'Recording sample does not match its tick/study.');
  }
  if (!Array.isArray(d.eventDelta) || d.eventDelta.length > 100000) throw new EngineError('INVALID_PAYLOAD', 'Invalid event delta.');
  for (const value of d.eventDelta) {
    const event = record(value, 'event');
    onlyKeys(event, ['time', 'type', 'message', 'connection'], 'event');
    finite(event.time, 'event.time', 0, snapshot.response.time);
    if (!['yield', 'break', 'collapse'].includes(event.type as string) || typeof event.message !== 'string' || event.message.length > 1024) throw new EngineError('INVALID_PAYLOAD', 'Invalid failure event.');
    integer(event.connection, 'event.connection', -1, snapshot.broken.length - 1);
  }
  return d as unknown as StudioStepData;
}
