// The kit as it is published: the fuzzers that go through PhysicsWorld import the built package, so they test the
// code a consumer runs. scripts/fuzz.mjs builds the kit first and removes the build afterwards.
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const dist = new URL('../../../packages/box3d-kit/dist/', import.meta.url);
if (!existsSync(fileURLToPath(new URL('index.js', dist)))) throw new Error('tests/fuzz needs the built kit: run `npm run test:fuzz` (it builds and cleans), or `npm --prefix packages/box3d-kit run build` first.');
export const kit = await import(new URL('index.js', dist).href);
export const subpath = name => import(new URL(`${name}.js`, dist).href);

/** The taxonomy check of docs/ERRORS.md, applied to anything a public call throws. */
export function taxonomy(codes) {
  return {
    problem(error) {
      if (!error || error.name !== 'EngineError' || !(error instanceof Error)) return `threw ${error?.constructor?.name ?? typeof error} ("${String(error?.message ?? error).slice(0, 120)}") instead of an EngineError`;
      if (typeof error.code !== 'string' || !(error.code in codes)) return `EngineError code ${String(error.code)} is not in the taxonomy`;
      if (typeof error.message !== 'string' || error.message.trim().length < 12) return `EngineError ${error.code} has no helpful message ("${error.message}")`;
      if (/\bundefined\b|\[object Object\]/.test(error.message) && !/got undefined|is undefined|was undefined/.test(error.message)) return `EngineError ${error.code} message leaks a formatting slip: "${error.message}"`;
      return null;
    },
  };
}
