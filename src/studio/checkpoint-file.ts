import { FailureSimulation, type StudioCheckpoint } from './physics.ts';
// Registers the SI bridge with FailureSimulation.fromCheckpoint.
import './si-bridge-study.ts';

export const MAX_CHECKPOINT_FILE_BYTES = 16 * 1024 * 1024;

/** Accept full checkpoints, Studio evidence exports, and individual sweep results. A file whose SI state is
 * gzip-packed (packStudioCheckpoint) must go through readStudioCheckpointFile, which unpacks it first. */
export function parseStudioCheckpointFile(text: string): FailureSimulation {
  return FailureSimulation.fromCheckpoint(checkpointOf(parseFile(text)));
}
/** Like parseStudioCheckpointFile, for files of every Studio version, including packed SI state. */
export async function readStudioCheckpointFile(text: string): Promise<FailureSimulation> {
  return FailureSimulation.fromCheckpoint(await unpackStudioCheckpoint(checkpointOf(parseFile(text))));
}
function parseFile(text: string): unknown {
  if(new TextEncoder().encode(text).byteLength>MAX_CHECKPOINT_FILE_BYTES)throw new RangeError('Saved run exceeds the 16 MiB import limit.');
  try{return JSON.parse(text);}catch{throw new RangeError('Saved run is not valid JSON.');}
}
function checkpointOf(value: unknown): unknown {
  // Validates schema, model revision, complete topology and full precision state
  // before the caller replaces any live solver or scene.
  return value!==null&&typeof value==='object'&&'checkpoint' in value?(value as {checkpoint:unknown}).checkpoint:value;
}

const toBase64 = (bytes: Uint8Array): string => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
function fromBase64(text: string, field: string): Uint8Array {
  let binary: string;
  try { binary = atob(text); } catch { throw new RangeError(`Invalid Studio checkpoint: ${field} is not base64`); }
  const out = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i); return out;
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader(), parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new RangeError('Invalid Studio checkpoint: unpacked SI state exceeds the import limit'); }
    parts.push(value);
  }
  const out = new Uint8Array(size); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
/** An SI checkpoint for a file: its solver state (`si`, about 12 MB for the bridge's frame matrices) gzip-packed into `siGzip`. */
export async function packStudioCheckpoint(checkpoint: StudioCheckpoint): Promise<Omit<StudioCheckpoint, 'si'> & { siGzip?: string }> {
  if (checkpoint.si === undefined) return checkpoint;
  const { si, ...rest } = checkpoint;
  return { ...rest, siGzip: toBase64(await pipe(fromBase64(si, 'si'), new CompressionStream('gzip'))) };
}
/** The checkpoint a file holds, with packed SI state unpacked; other values pass through for validation. */
export async function unpackStudioCheckpoint(value: unknown): Promise<unknown> {
  if (value === null || typeof value !== 'object' || !('siGzip' in value)) return value;
  const { siGzip, ...rest } = value as Record<string, unknown>;
  if (typeof siGzip !== 'string' || 'si' in rest) throw new RangeError('Invalid Studio checkpoint: siGzip');
  let raw: Uint8Array;
  try { raw = await pipe(fromBase64(siGzip, 'siGzip'), new DecompressionStream('gzip'), 64 * 1024 * 1024); }
  catch (error) { throw error instanceof RangeError ? error : new RangeError('Invalid Studio checkpoint: siGzip is not gzip data'); }
  return { ...rest, si: toBase64(raw) };
}
