// PhysX 5 with the TGS (temporal Gauss-Seidel) solver, which the PhysX guide recommends for joints and high mass
// ratios. Everything else is adapters/physx.mjs.
import {load as loadPhysX, meta as base} from './physx.mjs';

export const meta = {...base, id: 'physx-tgs', name: 'PhysX (TGS)', label: 'NVIDIA PhysX 5 (physx-js-webidl), TGS solver', defaults: 'TGS solver, 4 position and 1 velocity iteration per body'};
export const load = () => loadPhysX('tgs');
