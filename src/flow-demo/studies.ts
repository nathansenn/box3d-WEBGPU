/**
 * The four studies of flow-demo.html (docs/FLOW.md): a car-like body on a ground plane, the wake of a cylinder, a
 * manifold fed through a pipe bend, and a tank with three inlets and one outlet. Plain box3d-flow-study/1 documents,
 * run in a worker by the page (the same documents run unchanged by runFlowStudy on Node).
 */
import {flowTubeMesh} from '../engine/flow-geometry.ts';

type Vec3 = [number, number, number];
export interface DemoStudy {readonly id: string; readonly title: string; readonly caption: string; readonly study: Record<string, unknown>;
  /** Camera position and target. */ readonly camera: {readonly position: Vec3; readonly target: Vec3};
  readonly colorBy?: 'speed' | 'pressure'; readonly surface?: 'plain' | 'cp'; readonly surfaceOpacity?: number}

/** A closed prism: the polygon `profile` (x, y, counter-clockwise, convex) extruded from z0 to z1. */
function prism(profile: readonly (readonly [number, number])[], z0: number, z1: number): {positions: number[]; indices: number[]} {
  const n = profile.length, positions: number[] = [], indices: number[] = [];
  for (const z of [z0, z1]) for (const [x, y] of profile) positions.push(x, y, z);
  for (let i = 1; i + 1 < n; i++) { indices.push(0, i + 1, i); indices.push(n, n + i, n + i + 1); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; indices.push(i, j, n + j, i, n + j, n + i); }
  return {positions, indices};
}

// a car-like body: a rounded-off side profile 4.2 m long, 1.8 m wide, on four wheels standing on the ground
const carProfile: [number, number][] = [[0, 0.35], [0.05, 0.62], [0.35, 0.86], [1.25, 1.0], [1.85, 1.42], [3.05, 1.42], [3.85, 1.08], [4.2, 0.98], [4.2, 0.4], [4.05, 0.3], [0.2, 0.3]];
const wheels = [0.85, 3.3].flatMap(x => [-0.72, 0.72].map(z => ({kind: 'cylinder', from: [x, 0.34, z - 0.12], to: [x, 0.34, z + 0.12], radius: 0.33, part: 'wheels'})));

// a manifold: a pipe from below turns into a header along x through a 90-degree bend; three risers leave upwards
const bore = 0.05, bendPath: Vec3[] = [];
for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 * i / 12; bendPath.push([-0.15 + 0.15 * Math.sin(a), -0.15 * Math.cos(a), 0]); }
const feed: Vec3[] = [[-0.15, -0.6, 0], [-0.15, -0.15, 0]];

export const DEMO_STUDIES: readonly DemoStudy[] = [
  {id: 'car', title: 'Car-like body on a ground plane', caption: 'Air at 30 m/s around a 4.2 m body on its wheels over a moving ground (a rolling road). Streamlines from a rake ahead of the body, coloured by speed; the body by pressure coefficient.',
    camera: {position: [-1.6, 3.4, 4.7], target: [2.3, 0.5, 0]}, surface: 'cp',
    study: {format: 'box3d-flow-study/1', name: 'car-like body', fluid: 'air', mode: 'external',
      geometry: [{kind: 'mesh', ...prism(carProfile, -0.9, 0.9), part: 'body'}, ...wheels],
      external: {speed: 30, direction: [1, 0, 0], ground: {height: 0, type: 'moving'}, margins: {upstream: 1.5, downstream: 3, side: 2.2, top: 2.2}},
      resolution: {cells: 600000}, run: {transits: 10, startupTransits: 1, windowTransits: 1, tolerance: 0.02},
      outputs: {surface: true, streamlines: {seeds: [{kind: 'plane', origin: [-1.6, 0.15, -0.7], u: [0, 0, 1.4], v: [0, 1.55, 0], nu: 7, nv: 7}], maxPoints: 600}}}},
  {id: 'cylinder', title: 'Cylinder wake, Re 100', caption: 'A cylinder 0.1 m across in a stream of 0.1 m/s (nu = 1e-4 m²/s): the vortex street of the instantaneous field, a slice coloured by speed and streamlines through it.',
    camera: {position: [0.72, 0.35, 2.55], target: [0.72, 0, 0]},
    study: {format: 'box3d-flow-study/1', name: 'cylinder wake', fluid: {density: 1, viscosity: 1e-4}, mode: 'external',
      geometry: [{kind: 'cylinder', from: [0, 0, -0.05], to: [0, 0, 0.05], radius: 0.05, part: 'cylinder'}],
      external: {speed: 0.1, direction: [1, 0, 0], domain: {min: [-0.4, -0.6, -0.03], max: [1.9, 0.6, 0.03]}, referenceLength: 0.1},
      resolution: {cells: 70000, latticeSpeed: 0.1}, run: {transits: 5, startupTransits: 3.5, windowTransits: 1, tolerance: 0},
      outputs: {surface: true, slices: [{axis: 'z', position: 0, field: 'instant'}], streamlines: {field: 'instant', seeds: [{kind: 'rake', from: [-0.35, -0.3, 0], to: [-0.35, 0.3, 0], count: 25}], maxPoints: 900}}}},
  {id: 'manifold', title: 'Pipe bend and manifold', caption: 'Water at 2 litres per second up a 100 mm pipe, through a 90-degree bend into a header with three risers at the same pressure; the flow splits unevenly.',
    camera: {position: [0.35, 0.55, 1.35], target: [0.35, 0.0, 0]}, surfaceOpacity: 0.22,
    study: {format: 'box3d-flow-study/1', name: 'manifold', fluid: 'water', mode: 'internal',
      geometry: [
        {kind: 'mesh', ...flowTubeMesh([...feed.slice(0, 1), ...bendPath], bore, 32), role: 'cavity', part: 'bend'},
        {kind: 'cylinder', from: [0, 0, 0], to: [0.95, 0, 0], radius: bore, role: 'cavity', part: 'header'},
        ...[0.25, 0.5, 0.75].map((x, i) => ({kind: 'cylinder', from: [x, 0, 0], to: [x, 0.45, 0], radius: 0.035, role: 'cavity', part: `riser-${i + 1}`}))],
      internal: {inlets: [{name: 'feed', shape: {kind: 'disc', center: [-0.15, -0.6, 0], normal: [0, -1, 0], radius: bore}, flowRate: 0.002, profile: 'developed'}],
        outlets: [0.25, 0.5, 0.75].map((x, i) => ({name: `riser-${i + 1}`, shape: {kind: 'disc', center: [x, 0.45, 0], normal: [0, 1, 0], radius: 0.035}, pressure: 0}))},
      resolution: {cells: 60000}, run: {transits: 6, windowTransits: 1},
      outputs: {surface: true, streamlines: {count: 48, maxPoints: 900}, sections: [{name: 'header', axis: 'x', position: 0.12}]}}},
  {id: 'tank', title: 'Tank with three inlets and one outlet', caption: 'Water into a 1 m tank through three pipes at 3, 2 and 1.5 litres per second; it leaves through one outlet near the floor. Flow rates at the openings, streamlines by speed.',
    camera: {position: [1.6, 1.15, 1.9], target: [0.5, 0.25, 0.3]}, surfaceOpacity: 0.18,
    study: {format: 'box3d-flow-study/1', name: 'tank', fluid: 'water', mode: 'internal',
      geometry: [
        {kind: 'box', center: [0.5, 0.3, 0.3], size: [1, 0.6, 0.6], role: 'cavity', part: 'tank'},
        {kind: 'cylinder', from: [0.15, 0.6, 0.3], to: [0.15, 0.85, 0.3], radius: 0.04, role: 'cavity', part: 'inlet-a'},
        {kind: 'cylinder', from: [-0.25, 0.45, 0.15], to: [0, 0.45, 0.15], radius: 0.035, role: 'cavity', part: 'inlet-b'},
        {kind: 'cylinder', from: [0.55, 0.42, 0.85], to: [0.55, 0.42, 0.6], radius: 0.03, role: 'cavity', part: 'inlet-c'},
        {kind: 'cylinder', from: [1, 0.1, 0.4], to: [1.25, 0.1, 0.4], radius: 0.05, role: 'cavity', part: 'outlet'}],
      internal: {inlets: [
        {name: 'inlet A', shape: {kind: 'disc', center: [0.15, 0.85, 0.3], normal: [0, 1, 0], radius: 0.04}, flowRate: 0.003},
        {name: 'inlet B', shape: {kind: 'disc', center: [-0.25, 0.45, 0.15], normal: [-1, 0, 0], radius: 0.035}, flowRate: 0.002},
        {name: 'inlet C', shape: {kind: 'disc', center: [0.55, 0.42, 0.85], normal: [0, 0, 1], radius: 0.03}, flowRate: 0.0015}],
        outlets: [{name: 'outlet', shape: {kind: 'disc', center: [1.25, 0.1, 0.4], normal: [1, 0, 0], radius: 0.05}, pressure: 0}]},
      resolution: {cells: 90000}, run: {transits: 4, windowTransits: 1},
      outputs: {surface: true, streamlines: {count: 60, maxPoints: 1200}}}},
];
