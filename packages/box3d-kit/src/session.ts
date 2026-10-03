/**
 * Save files. The current native bridge cannot serialize solver state, so a
 * saved session is a replay log plus the identity of the build that made it;
 * loading replays it and proves the result is bit-identical. The envelope
 * refuses to load on a different WASM, where replays are not guaranteed.
 */
import {EngineError} from './core/contracts.js';
import {BUILD_INFO} from './core/build-info.js';
import {NATIVE_WORLD_API_VERSION} from './core/native-world.js';
import type {PhysicsWorld, ReplayLog, ReplayReport} from './world.js';

export interface SavedSession {
  readonly format: 'box3d-kit-session';
  readonly version: 1;
  readonly kitVersion: string;
  readonly nativeApiVersion: number;
  readonly wasmSha256: string;
  /** ISO time the session was saved; informational. */
  readonly savedAt: string;
  readonly log: ReplayLog;
}

/** Wrap a finished recording (world.stopRecording()) in a versioned, self-describing envelope. JSON-safe. */
export function saveSession(log: ReplayLog, savedAt = new Date().toISOString()): SavedSession {
  return {format: 'box3d-kit-session', version: 1, kitVersion: BUILD_INFO.kitVersion, nativeApiVersion: NATIVE_WORLD_API_VERSION, wasmSha256: BUILD_INFO.wasmSha256, savedAt, log};
}

/**
 * Restore a saved session into `world` by replaying it. Throws
 * INCOMPATIBLE_SAVE when the file came from another WASM build or native ABI
 * (pass {allowOtherBuild: true} to try anyway; `matches` then tells you whether it held).
 */
export function loadSession(world: PhysicsWorld, saved: unknown, options: {allowOtherBuild?: boolean} = {}): ReplayReport {
  const s = saved as Partial<SavedSession> | null;
  if (!s || s.format !== 'box3d-kit-session' || s.version !== 1 || !s.log) throw new EngineError('INVALID_PAYLOAD', 'Not a box3d-kit session file.');
  if (!options.allowOtherBuild) {
    if (s.nativeApiVersion !== NATIVE_WORLD_API_VERSION) throw new EngineError('INCOMPATIBLE_SAVE', `Saved with native ABI ${String(s.nativeApiVersion)}, this build is ${NATIVE_WORLD_API_VERSION}.`);
    if (s.wasmSha256 !== BUILD_INFO.wasmSha256) throw new EngineError('INCOMPATIBLE_SAVE', `Saved with a different box3d.wasm (${String(s.wasmSha256).slice(0, 12)}…); replays are only exact on the same build.`);
  }
  return world.replayDetailed(s.log);
}
