import { FailureSimulation } from './physics.ts';

export const MAX_CHECKPOINT_FILE_BYTES = 16 * 1024 * 1024;

/** Accept full checkpoints, Studio evidence exports, and individual sweep results. */
export function parseStudioCheckpointFile(text: string): FailureSimulation {
  if(new TextEncoder().encode(text).byteLength>MAX_CHECKPOINT_FILE_BYTES)throw new RangeError('Saved run exceeds the 16 MiB import limit.');
  let value:unknown;
  try{value=JSON.parse(text);}catch{throw new RangeError('Saved run is not valid JSON.');}
  if(value!==null&&typeof value==='object'&&'checkpoint' in value)value=(value as {checkpoint:unknown}).checkpoint;
  // Validates schema, model revision, complete topology and full precision state
  // before the caller replaces any live solver or scene.
  return FailureSimulation.fromCheckpoint(value);
}
