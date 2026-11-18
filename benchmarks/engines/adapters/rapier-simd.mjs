// Rapier 3D built with WASM SIMD (@dimforge/rapier3d-simd-compat). Everything else is adapters/rapier.mjs.
import {load as loadRapier, simdMeta} from './rapier.mjs';

export const meta = simdMeta;
export const load = () => loadRapier(simdMeta.package);
