import { EngineError, integer, onlyKeys, record } from './contracts.ts';
import type { StudioBuffers } from './studio-protocol.ts';

/** Single writer/single reader, three immutable-until-release live snapshots.
 * No waits or polling loops: messages schedule work; atomics publish ownership.
 * A reset always gets fresh buffers. Released views must no longer be used.
 */
export const STUDIO_SHARED_SLOTS = 3;
const WORDS = 16, MAGIC = 0x42335352, MAX_SEQUENCE = 0x7fffffff;
const FREE = 0, WRITING = 1, READY = 2, READING = 3, RETIRED = 4;
const CLOSED = 4;
export interface StudioSharedShape { positions: number; strains: number; broken: number }
export interface StudioSharedDescriptor extends StudioSharedShape {
  v: 1;
  generation: number;
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
}
export interface StudioSharedTicket { generation: number; slot: number; sequence: number; tick: number }
export interface StudioSharedWrite { readonly slot: number; readonly sequence: number; readonly buffers: StudioBuffers }
export interface StudioSharedRead { readonly buffers: StudioBuffers; release(): void }

export function studioSharedMemorySupport(): { supported: boolean; reason?: string } {
  if (typeof SharedArrayBuffer === 'undefined' || typeof Atomics === 'undefined') return { supported: false, reason: 'SharedArrayBuffer or Atomics is unavailable.' };
  const scope = globalThis as typeof globalThis & { crossOriginIsolated?: boolean; isSecureContext?: boolean };
  const browser = 'document' in scope || 'importScripts' in scope || 'crossOriginIsolated' in scope;
  if (browser && (scope.crossOriginIsolated !== true || scope.isSecureContext === false)) return { supported: false, reason: 'Shared snapshots require a secure, cross-origin-isolated browser context.' };
  return { supported: true };
}

function requireSupport(): void {
  const support = studioSharedMemorySupport();
  if (!support.supported) throw new EngineError('SHARED_UNAVAILABLE', support.reason!);
}
function shape(value: StudioSharedShape): StudioSharedShape {
  const positions = integer(value.positions, 'shared.positions', 3, 150000);
  const strains = integer(value.strains, 'shared.strains', 1, 50000);
  const broken = integer(value.broken, 'shared.broken', 1, 100000);
  if (positions !== strains * 3) throw new EngineError('INVALID_PAYLOAD', 'Shared snapshot dimensions disagree.');
  return { positions, strains, broken };
}
const stride = (s: StudioSharedShape) => Math.ceil((s.positions * 4 + s.strains * 4 + s.broken) / 4) * 4;
function views(d: StudioSharedDescriptor): StudioBuffers[] {
  return Array.from({ length: STUDIO_SHARED_SLOTS }, (_, slot) => {
    const offset = slot * stride(d);
    return { positions: new Float32Array(d.data, offset, d.positions), strains: new Float32Array(d.data, offset + d.positions * 4, d.strains), broken: new Uint8Array(d.data, offset + (d.positions + d.strains) * 4, d.broken) };
  });
}
function checkDescriptor(value: unknown, generation: number): StudioSharedDescriptor {
  requireSupport();
  const d = record(value, 'shared');
  onlyKeys(d, ['v', 'generation', 'positions', 'strains', 'broken', 'control', 'data'], 'shared');
  if (d.v !== 1 || integer(d.generation, 'shared.generation', 1) !== generation) throw new EngineError('STALE_GENERATION', 'Shared snapshot generation does not match the request.');
  const dimensions = shape(d as unknown as StudioSharedShape);
  for (const key of ['control', 'data'] as const) {
    const buffer = d[key];
    if (!(buffer instanceof SharedArrayBuffer) || (buffer as SharedArrayBuffer & { growable?: boolean }).growable) throw new EngineError('INVALID_PAYLOAD', 'Shared snapshot storage must be fixed-size SharedArrayBuffers.');
  }
  const descriptor = d as unknown as StudioSharedDescriptor;
  if (descriptor.control === descriptor.data || descriptor.control.byteLength !== WORDS * (STUDIO_SHARED_SLOTS + 1) * 4 || descriptor.data.byteLength !== stride(dimensions) * STUDIO_SHARED_SLOTS) throw new EngineError('INVALID_PAYLOAD', 'Shared snapshot storage size is invalid.');
  const control = new Int32Array(descriptor.control);
  if (Atomics.load(control, 0) !== MAGIC || Atomics.load(control, 1) !== 1 || (Atomics.load(control, 2) >>> 0) + (Atomics.load(control, 3) >>> 0) * 0x100000000 !== generation) throw new EngineError('INVALID_PAYLOAD', 'Shared snapshot header is invalid.');
  if (Atomics.load(control, CLOSED) !== 0) throw new EngineError('DISPOSED', 'Shared snapshot ring is closed.');
  return Object.freeze({ ...descriptor });
}
function stats(control: Int32Array, descriptor: StudioSharedDescriptor) {
  let outstanding = 0, retired = 0;
  for (let i = 0; i < STUDIO_SHARED_SLOTS; i++) {
    const state = Atomics.load(control, WORDS * (i + 1));
    if (state === WRITING || state === READY || state === READING) outstanding++;
    if (state === RETIRED) retired++;
  }
  return { slots: STUDIO_SHARED_SLOTS, outstanding, retired, bytes: descriptor.control.byteLength + descriptor.data.byteLength, closed: Atomics.load(control, CLOSED) !== 0 };
}

export class StudioSharedWriter {
  readonly descriptor: StudioSharedDescriptor;
  private control: Int32Array;
  private buffers: StudioBuffers[];
  private cursor = 0;
  private pending?: StudioSharedWrite;
  constructor(dimensions: StudioSharedShape, generation: number) {
    requireSupport();
    const s = shape(dimensions);
    integer(generation, 'generation', 1);
    this.descriptor = Object.freeze({ v: 1 as const, generation, ...s, control: new SharedArrayBuffer(WORDS * (STUDIO_SHARED_SLOTS + 1) * 4), data: new SharedArrayBuffer(stride(s) * STUDIO_SHARED_SLOTS) });
    this.control = new Int32Array(this.descriptor.control);
    Atomics.store(this.control, 0, MAGIC); Atomics.store(this.control, 1, 1);
    Atomics.store(this.control, 2, generation >>> 0); Atomics.store(this.control, 3, Math.floor(generation / 0x100000000));
    this.buffers = views(this.descriptor);
  }
  acquire(): StudioSharedWrite {
    if (Atomics.load(this.control, CLOSED)) throw new EngineError('DISPOSED', 'Shared snapshot ring is closed.');
    if (this.pending) throw new EngineError('BUSY', 'A shared snapshot is already being written.');
    for (let n = 0; n < STUDIO_SHARED_SLOTS; n++) {
      const slot = (this.cursor + n) % STUDIO_SHARED_SLOTS, base = WORDS * (slot + 1);
      if (Atomics.compareExchange(this.control, base, FREE, WRITING) !== FREE) continue;
      const sequence = Atomics.load(this.control, base + 1);
      if (sequence === MAX_SEQUENCE) { Atomics.store(this.control, base, RETIRED); continue; }
      this.cursor = (slot + 1) % STUDIO_SHARED_SLOTS;
      Atomics.store(this.control, base + 1, sequence + 1);
      return this.pending = Object.freeze({ slot, sequence: sequence + 1, buffers: this.buffers[slot] });
    }
    if (this.diagnostics().retired === STUDIO_SHARED_SLOTS) throw new EngineError('SEQUENCE_EXHAUSTED', 'Reset with a new ring before shared snapshot sequences wrap.');
    throw new EngineError('BACKPRESSURE', 'Release a shared snapshot before requesting another.');
  }
  publish(write: StudioSharedWrite, tick: number): StudioSharedTicket {
    integer(tick, 'tick');
    if (write !== this.pending) throw new EngineError('INVALID_LOAN', 'Shared writer loan is not current.');
    if (Atomics.load(this.control, CLOSED)) { this.abort(write); throw new EngineError('DISPOSED', 'Shared snapshot ring closed before publication.'); }
    const base = WORDS * (write.slot + 1);
    Atomics.store(this.control, base + 2, tick >>> 0);
    Atomics.store(this.control, base + 3, Math.floor(tick / 0x100000000));
    // The release/publication edge follows every payload and metadata write.
    Atomics.store(this.control, base, READY);
    this.pending = undefined;
    return { generation: this.descriptor.generation, slot: write.slot, sequence: write.sequence, tick };
  }
  abort(write: StudioSharedWrite): void {
    if (write !== this.pending) return;
    Atomics.store(this.control, WORDS * (write.slot + 1), FREE);
    this.pending = undefined;
  }
  close(): void { Atomics.store(this.control, CLOSED, 1); if (this.pending) this.abort(this.pending); }
  diagnostics() { return stats(this.control, this.descriptor); }
}

export class StudioSharedReader {
  readonly descriptor: StudioSharedDescriptor;
  private control: Int32Array;
  private buffers: StudioBuffers[];
  constructor(descriptor: unknown, generation: number) {
    this.descriptor = checkDescriptor(descriptor, generation);
    this.control = new Int32Array(this.descriptor.control); this.buffers = views(this.descriptor);
  }
  acquire(value: unknown): StudioSharedRead {
    const t = record(value, 'ticket');
    onlyKeys(t, ['generation', 'slot', 'sequence', 'tick'], 'ticket');
    if (integer(t.generation, 'ticket.generation', 1) !== this.descriptor.generation) throw new EngineError('STALE_GENERATION', 'Shared snapshot belongs to another generation.');
    const slot = integer(t.slot, 'ticket.slot', 0, STUDIO_SHARED_SLOTS - 1), sequence = integer(t.sequence, 'ticket.sequence', 1, MAX_SEQUENCE), tick = integer(t.tick, 'ticket.tick');
    const base = WORDS * (slot + 1), control = this.control;
    if (Atomics.load(control, CLOSED)) throw new EngineError('DISPOSED', 'Shared snapshot ring is closed.');
    if (Atomics.load(control, base) !== READY || Atomics.load(control, base + 1) !== sequence || (Atomics.load(control, base + 2) >>> 0) + (Atomics.load(control, base + 3) >>> 0) * 0x100000000 !== tick || Atomics.compareExchange(control, base, READY, READING) !== READY) throw new EngineError('STALE_SNAPSHOT', 'Shared snapshot is stale, already claimed, or not fully published.');
    let released = false;
    return { buffers: this.buffers[slot], release: () => {
      if (released) return;
      released = true;
      if (Atomics.load(control, base + 1) === sequence) Atomics.compareExchange(control, base, READING, FREE);
    } };
  }
  close(): void { Atomics.store(this.control, CLOSED, 1); }
  diagnostics() { return stats(this.control, this.descriptor); }
}
