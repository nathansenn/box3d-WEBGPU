// Decides whether the page runs Box3D on its worker pool and with how many workers; see docs/THREADED_ENGINE.md.
// The pthread artifact reproduces the single-threaded artifact bit for bit (scripts/threaded-determinism-test.mjs),
// so this is a performance decision only and never changes a simulation result.

export type ThreadingEnvironment = {
  readonly search: string;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency: number;
};

export type ThreadingPlan =
  | { readonly use: true; readonly workers: number }
  | { readonly use: false; readonly reason: string };

/** Workers including the calling thread; B3_MAX_WORKERS in Box3D. */
export const MAX_PHYSICS_WORKERS = 32;
/** Ceiling of the automatic choice: the measured gain flattens past 8 workers. */
export const AUTO_PHYSICS_WORKER_CEILING = 8;

/**
 * `?threads=off` (or 0 or 1) keeps the single-threaded artifact, `?threads=<n>` asks for n workers,
 * and anything else (the default) leaves two logical processors to the page, up to 8 workers.
 * The pool needs SharedArrayBuffer, which browsers expose only to cross-origin isolated pages.
 */
export function planThreading(env: ThreadingEnvironment): ThreadingPlan {
  const param = new URLSearchParams(env.search).get('threads')?.trim().toLowerCase() ?? '';
  const off = param === 'off' || param === 'false' || param === 'no';
  const requested = /^\d+$/.test(param) ? Number(param) : null;
  if (off || requested === 0 || requested === 1) return { use: false, reason: 'turned off with ?threads=' };
  if (!env.sharedArrayBuffer) return { use: false, reason: 'SharedArrayBuffer is not available' };
  if (!env.crossOriginIsolated) return { use: false, reason: 'the page is not cross-origin isolated (COOP and COEP headers)' };
  const cores = Number.isFinite(env.hardwareConcurrency) ? Math.max(1, Math.floor(env.hardwareConcurrency)) : 1;
  const workers = requested ?? Math.min(AUTO_PHYSICS_WORKER_CEILING, cores - 2);
  if (workers < 2) return { use: false, reason: `only ${cores} logical processors` };
  return { use: true, workers: Math.min(workers, MAX_PHYSICS_WORKERS) };
}
