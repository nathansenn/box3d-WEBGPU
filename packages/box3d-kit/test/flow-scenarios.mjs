// Set-ups of the flow validation (box3d-webgpu-kit/flow, docs/FLOW.md). Each function takes the module `K` (the built
// kit's ./flow entry, or the engine sources) and returns measured numbers; the test file (v24-flow.test.mjs), the
// validation registry (validation/domains/flow.mjs) and the offline benchmark (scripts/bench-flow.mjs) all call these,
// so the three cannot drift apart. SI units. Nothing here measures or asserts wall-clock time.

const sum = values => values.reduce((a, b) => a + b, 0);
const mean = values => sum(values) / values.length;

/** A closed box as a triangle mesh (12 triangles, outward winding), from min to max. */
export function boxMesh(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const positions = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];
  return {positions, indices};
}
/** A sphere as a triangle mesh (latitude-longitude), radius r about c. */
export function sphereMesh(c, r, rings = 16, segments = 32) {
  const positions = [], indices = [];
  for (let i = 0; i <= rings; i++) {
    const phi = Math.PI * i / rings;
    for (let j = 0; j < segments; j++) { const th = 2 * Math.PI * j / segments; positions.push(c[0] + r * Math.sin(phi) * Math.cos(th), c[1] + r * Math.cos(phi), c[2] + r * Math.sin(phi) * Math.sin(th)); }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segments; j++) {
    const a = i * segments + j, b = i * segments + (j + 1) % segments, d = a + segments, e = b + segments;
    if (i > 0) indices.push(a, b, d);
    if (i < rings - 1) indices.push(b, e, d);
  }
  return {positions, indices};
}

/** Advance a periodic, force-driven flow until the mean speed along x changes by less than `tolerance` per check. */
function settle(flow, {every = 200, tolerance = 1e-9, maxSteps = 400000} = {}) {
  const L = flow.lattice;
  let last = -1;
  while (L.stepCount < maxSteps) {
    flow.step(every);
    let s = 0;
    for (let c = 0; c < L.ux.length; c++) s += L.ux[c];
    if (Math.abs(s - last) <= tolerance * Math.abs(s)) break;
    last = s;
  }
  return L.stepCount;
}
/** Volume flow rate along x of a periodic flow: the sum of u over the fluid cells of one layer times h^2. */
function flowRateX(flow) {
  const f = flow.field(), g = f.grid;
  let q = 0;
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) { const c = g.nx * (j + g.ny * k); if (f.fluid[c]) q += f.ux[c]; }
  return q * g.cell * g.cell;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ducts and pipes driven by a body force (periodic along x): the steady flow rate against the closed form
// ---------------------------------------------------------------------------------------------------------------------
/** Plane Poiseuille flow between the walls of a mesh-defined slot of height H = 1 m whose walls lie off the grid lines. */
export function poiseuillePlane(K, {n = 8} = {}) {
  const H = 1, h = H / n, nu = 0.02, a = 8 * nu * 1 / (H * H); // acceleration for a centre-line speed of 1 m/s
  // the slot runs from y = 0.37 h to y = 0.37 h + H: neither wall is on a cell face
  const y0 = 0.37 * h, slot = boxMesh([-10, y0, -10], [10, y0 + H, 10]);
  const flow = new K.Flow({grid: {origin: [0, 0, 0], cell: h, nx: 2, ny: n + 1, nz: 1}, geometry: [{kind: 'mesh', ...slot, role: 'cavity', part: 'slot'}], fluid: {density: 1, viscosity: nu},
    sides: {xMin: 'periodic', xMax: 'periodic', zMin: 'periodic', zMax: 'periodic'}, referenceSpeed: 1, acceleration: [a, 0, 0]});
  const steps = settle(flow);
  const exact = a * H ** 3 / (12 * nu) * h; // per depth h
  return {n, steps, flowRate: flowRateX(flow), exact, error: flowRateX(flow) / exact - 1, relaxationTime: flow.relaxationTime};
}
/** Flow rate of a square duct of side a: Q = (a^4 G / mu) [1/12 - (16 / pi^5) sum_odd tanh(n pi / 2) / n^5]. */
const squareDuctFlow = (a, gradientOverMu) => { let s = 0; for (let m = 1; m < 200; m += 2) s += Math.tanh(m * Math.PI / 2) / m ** 5; return a ** 4 * gradientOverMu * (1 / 12 - 16 / Math.PI ** 5 * s); };
/** A square duct given as a mesh, its walls off the grid lines. */
export function squareDuct(K, {n = 8} = {}) {
  const A = 1, h = A / n, nu = 0.02, a = 0.5, o = 0.37 * h, duct = boxMesh([-10, o, o], [10, o + A, o + A]);
  const flow = new K.Flow({grid: {origin: [0, 0, 0], cell: h, nx: 2, ny: n + 1, nz: n + 1}, geometry: [{kind: 'mesh', ...duct, role: 'cavity', part: 'duct'}], fluid: {density: 1, viscosity: nu},
    sides: {xMin: 'periodic', xMax: 'periodic'}, referenceSpeed: 1, acceleration: [a, 0, 0]});
  const steps = settle(flow), exact = squareDuctFlow(A, a / nu);
  return {n, steps, flowRate: flowRateX(flow), exact, error: flowRateX(flow) / exact - 1};
}
/** A circular pipe of diameter 1 m: a cylinder cavity, or a swept-tube mesh (48 sides). Q = pi R^4 G / (8 mu). */
export function pipe(K, {n = 12, source = 'cylinder'} = {}) {
  const R = 0.5, h = 2 * R / n, nu = 0.02, a = 0.3, c = R + 0.5 * h; // the axis sits on a cell centre plus nothing special
  const item = source === 'mesh' ? {kind: 'mesh', ...K.flowTubeMesh([[-5, c, c], [5, c, c]], R, 48), role: 'cavity', part: 'pipe'} : {kind: 'cylinder', from: [-5, c, c], to: [5, c, c], radius: R, role: 'cavity', part: 'pipe'};
  const flow = new K.Flow({grid: {origin: [0, 0, 0], cell: h, nx: 2, ny: n + 1, nz: n + 1}, geometry: [item], fluid: {density: 1, viscosity: nu},
    sides: {xMin: 'periodic', xMax: 'periodic'}, referenceSpeed: 1, acceleration: [a, 0, 0]});
  const steps = settle(flow), exact = Math.PI * R ** 4 * a / (8 * nu);
  // the wall takes what the body force gives the fluid: force on the wall over the force on the fluid
  const wall = flow.forces()[0].force[0], fluid = a * flow.fluidCells * h ** 3;
  return {n, source, steps, flowRate: flowRateX(flow), exact, error: flowRateX(flow) / exact - 1, forceBalance: wall / fluid - 1, fluidCells: flow.fluidCells};
}

/** A sphere in a periodic cube, the fluid pushed past it by a body force: Stokes drag against Hasimoto (1959),
 * F = 6 pi mu a U / (1 - 1.7601 c^(1/3) + c - 1.5593 c^2), c the volume fraction. */
export function stokesSphere(K, {n = 24} = {}) {
  const Lb = 1, h = Lb / n, radius = 0.15, nu = 0.1, a = 0.01;
  const flow = new K.Flow({grid: {origin: [0, 0, 0], cell: h, nx: n, ny: n, nz: n}, geometry: [{kind: 'sphere', center: [0.5, 0.5, 0.5], radius}], fluid: {density: 1, viscosity: nu},
    sides: {xMin: 'periodic', xMax: 'periodic', yMin: 'periodic', yMax: 'periodic', zMin: 'periodic', zMax: 'periodic'}, referenceSpeed: 1, latticeSpeed: 0.1 * h / nu, acceleration: [a, 0, 0]}); // a lattice viscosity of 0.1
  const steps = settle(flow, {tolerance: 1e-7});
  // superficial velocity: the mean of u over the whole cube (zero in the sphere)
  const f = flow.field();
  let u = 0;
  for (let c = 0; c < f.ux.length; c++) u += f.ux[c];
  u /= f.ux.length;
  const phi = 4 / 3 * Math.PI * radius ** 3 / Lb ** 3, K0 = 1 / (1 - 1.7601 * Math.cbrt(phi) + phi - 1.5593 * phi * phi);
  const drag = flow.forces()[0].force[0], exact = 6 * Math.PI * nu * radius * u * K0;
  // the body force on the fluid is carried by the sphere
  return {n, steps, drag, exact, error: drag / exact - 1, forceBalance: drag / (a * flow.fluidCells * h ** 3) - 1, reynolds: u * 2 * radius / nu};
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------------
/** A sphere and a box, each as a primitive and as a mesh, voxelised on the same grid: cells whose solid/fluid state
 * differs, and the largest difference of the distance within one cell of the surface. */
export function meshAgainstPrimitive(K, {n = 24} = {}) {
  const grid = {origin: [0, 0, 0], cell: 1 / n, nx: n, ny: n, nz: n};
  const compare = (primitive, mesh) => {
    const a = K.flowVoxelize([primitive], grid), b = K.flowVoxelize([mesh], grid);
    let differ = 0, worst = 0, solid = 0;
    for (let c = 0; c < a.distance.length; c++) {
      if (a.distance[c] < 0) solid++;
      if ((a.distance[c] < 0) !== (b.distance[c] < 0)) differ++;
      if (Math.abs(a.distance[c]) < grid.cell) worst = Math.max(worst, Math.abs(a.distance[c] - b.distance[c]));
    }
    return {differ, worst: worst / grid.cell, solid};
  };
  const sphere = compare({kind: 'sphere', center: [0.5, 0.52, 0.49], radius: 0.3}, {kind: 'mesh', ...sphereMesh([0.5, 0.52, 0.49], 0.3, 48, 96)});
  const box = compare({kind: 'box', center: [0.5, 0.5, 0.5], halfExtents: [0.21, 0.33, 0.27]}, {kind: 'mesh', ...boxMesh([0.29, 0.17, 0.23], [0.71, 0.83, 0.77])});
  return {sphere, box};
}
/** A sphere mesh that is not clean: triangles with reversed winding, a duplicated vertex ring (no shared indices
 * across a seam), and three triangles removed (a hole of about one cell). The solid cells against the clean sphere. */
export function imperfectMesh(K, {n = 24} = {}) {
  const grid = {origin: [0, 0, 0], cell: 1 / n, nx: n, ny: n, nz: n}, clean = sphereMesh([0.5, 0.5, 0.5], 0.3, 24, 48);
  const reference = K.flowVoxelize([{kind: 'mesh', ...clean}], grid);
  // triangle soup: every triangle has its own vertices; every third one is flipped
  const positions = [], count = clean.indices.length / 3;
  for (let f = 0; f < count; f++) {
    const tri = [clean.indices[3 * f], clean.indices[3 * f + 1], clean.indices[3 * f + 2]];
    if (f % 3 === 0) tri.reverse();
    for (const v of tri) positions.push(clean.positions[3 * v], clean.positions[3 * v + 1], clean.positions[3 * v + 2]);
  }
  const soup = K.flowVoxelize([{kind: 'mesh', positions}], grid);
  // the same with three neighbouring triangles on the equator removed: an open mesh without a thickness
  const holed = positions.slice();
  const first = 9 * (12 * 2 * 48 - 48); // a triangle near the equator
  holed.splice(first, 27);
  const open = K.flowVoxelize([{kind: 'mesh', positions: holed}], grid);
  const differ = other => { let d = 0; for (let c = 0; c < reference.distance.length; c++) if ((reference.distance[c] < 0) !== (other.distance[c] < 0)) d++; return d; };
  return {solid: reference.solidCells, soupDiffers: differ(soup), holedDiffers: differ(open), holedWarnings: open.warnings.length, soupClosed: soup.items[0].closedComponents, holedClosed: open.items[0].closedComponents};
}
/** What the report says about thin things: a panel thinner than a cell, a thin open sheet, a slender member. */
export function thinFeatures(K) {
  const grid = {origin: [0, 0, 0], cell: 0.1, nx: 20, ny: 20, nz: 20};
  const panel = K.flowVoxelize([{kind: 'box', center: [1, 1, 1], halfExtents: [0.6, 0.6, 0.02], part: 'panel'}], grid);
  // an open square sheet (two triangles), tilted, with a thickness of 2 cm on a 10 cm grid
  const sheet = {kind: 'mesh', positions: [0.4, 0.4, 0.7, 1.6, 0.4, 1.0, 1.6, 1.6, 1.3, 0.4, 1.6, 1.0], indices: [0, 1, 2, 0, 2, 3], thickness: 0.02, part: 'sheet'};
  const shell = K.flowVoxelize([sheet], grid);
  // does the sheet block every lattice link? walk the fluid from below and see whether it reaches the top inside the footprint
  const beam = K.flowVoxelize([{kind: 'beam', from: [0.3, 1, 1], to: [1.7, 1, 1], width: 0.3, depth: 0.5, section: 'i', flange: 0.04, web: 0.03, part: 'girder'}], grid);
  let shellSolid = 0;
  for (const d of shell.distance) if (d < 0) shellSolid++;
  return {panelWarnings: panel.warnings, panelUnresolved: panel.items[0].unresolvedFraction, panelSmallest: panel.items[0].smallestDimension,
    shellWarnings: shell.warnings, shellSolid, shellArea: shell.items[0].surfaceArea, beamWarnings: beam.warnings, beamSmallest: beam.items[0].smallestDimension};
}

// ---------------------------------------------------------------------------------------------------------------------
// Tracer accuracy: streamlines through fields that are known exactly
// ---------------------------------------------------------------------------------------------------------------------
function analyticField(n, velocity) {
  const cells = n * n * n, grid = {origin: [0, 0, 0], cell: 1 / n, nx: n, ny: n, nz: n};
  const field = {grid, fluid: new Uint8Array(cells).fill(1), ux: new Float32Array(cells), uy: new Float32Array(cells), uz: new Float32Array(cells), pressure: new Float32Array(cells), distance: new Float32Array(cells).fill(1)};
  for (let k = 0, c = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++, c++) {
    const v = velocity((i + 0.5) / n, (j + 0.5) / n, (k + 0.5) / n);
    field.ux[c] = v[0]; field.uy[c] = v[1]; field.uz[c] = v[2];
  }
  return field;
}
/** A streamline of a uniform flow is straight; one of a solid-body rotation is a circle that closes on itself. */
export function tracer(K, {n = 32} = {}) {
  const uniform = analyticField(n, () => [0.6, 0.3, 0.2]);
  const [line] = K.flowStreamlines(uniform, [[0.1, 0.2, 0.3]], {maxPoints: 2000, stride: 1});
  // distance of every point from the exact line through the seed
  const d = [0.6, 0.3, 0.2], dl = Math.hypot(...d);
  let straight = 0;
  for (let p = 0; p < line.speed.length; p++) {
    const r = [line.points[3 * p] - 0.1, line.points[3 * p + 1] - 0.2, line.points[3 * p + 2] - 0.3], along = (r[0] * d[0] + r[1] * d[1] + r[2] * d[2]) / dl;
    straight = Math.max(straight, Math.hypot(r[0] - along * d[0] / dl, r[1] - along * d[1] / dl, r[2] - along * d[2] / dl));
  }
  const rotation = analyticField(n, (x, y) => [-(y - 0.5), x - 0.5, 0]);
  const radius = 0.3, [circle] = K.flowStreamlines(rotation, [[0.5 + radius, 0.5, 0.5]], {maxPoints: Math.ceil(2 * Math.PI * radius * n / 0.5), stride: 1, step: 0.5});
  let radial = 0;
  for (let p = 0; p < circle.speed.length; p++) radial = Math.max(radial, Math.abs(Math.hypot(circle.points[3 * p] - 0.5, circle.points[3 * p + 1] - 0.5) - radius));
  // after one turn (2 pi r of arc) the line is back at its seed
  const last = circle.speed.length - 1, arc = last * 0.5 / n, angle = arc / radius;
  const closure = Math.hypot(circle.points[3 * last] - (0.5 + radius * Math.cos(angle)), circle.points[3 * last + 1] - (0.5 + radius * Math.sin(angle)));
  return {points: line.speed.length, termination: line.termination, straight: straight * n, radial: radial / radius, closure: closure / radius, speedError: Math.abs(circle.speed[last] - radius) / radius};
}

// ---------------------------------------------------------------------------------------------------------------------
// Conservation, determinism, resume
// ---------------------------------------------------------------------------------------------------------------------
const hashOf = flow => { let a = 0x811c9dc5; const bytes = new Uint8Array(flow.lattice.f.buffer, flow.lattice.f.byteOffset, flow.lattice.f.byteLength); for (let i = 0; i < bytes.length; i++) { a ^= bytes[i]; a = Math.imul(a, 0x01000193); } return (a >>> 0).toString(16).padStart(8, '0'); };
function smallTunnel(K, extra = {}) {
  return new K.Flow({grid: {origin: [0, 0, 0], cell: 0.05, nx: 40, ny: 16, nz: 16}, geometry: [{kind: 'sphere', center: [0.6, 0.4, 0.4], radius: 0.15, part: 'ball'}, {kind: 'box', center: [1.3, 0.3, 0.45], halfExtents: [0.1, 0.2, 0.15], rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)], part: 'block'}],
    fluid: {density: 1.2, viscosity: 1.5e-5}, sides: {xMin: {kind: 'velocity', velocity: [8, 0, 0]}, xMax: {kind: 'pressure'}, yMin: {kind: 'wall', velocity: [8, 0, 0], part: 'ground'}, yMax: 'slip', zMin: 'slip', zMax: 'slip'},
    referenceSpeed: 8, initialVelocity: [8, 0, 0], ...extra});
}
/** Two runs of a turbulent case give the same bits; a run restored from a checkpoint continues with the same bits. */
export function determinism(K) {
  const a = smallTunnel(K), b = smallTunnel(K);
  a.step(60); b.step(60);
  const same = hashOf(a) === hashOf(b);
  // resume: save at 60, run to 120; restore into a fresh solver and run to 120
  const state = a.saveState();
  a.accumulate(); a.step(60);
  const c = smallTunnel(K);
  c.restoreState(structuredClone(state));
  c.accumulate(); c.step(60);
  const sa = a.takeSums(), sc = c.takeSums();
  return {same, hash: hashOf(b), resumed: hashOf(a) === hashOf(c), sumsEqual: JSON.stringify(sa) === JSON.stringify(sc), time: a.time === c.time, healthy: a.healthy(), turbulence: a.turbulence};
}
/** Mass: in a closed periodic box the mass does not change; with openings, what enters minus what leaves is the change
 * of the mass in the box, with interpolated walls and with half-way walls. */
export function massLedger(K) {
  const ledger = walls => {
    const flow = smallTunnel(K, {walls});
    flow.step(40); flow.takeSums();
    const before = flow.excessVolume();
    flow.step(200);
    const sums = flow.takeSums(), entered = (sum(sums.flowRates) + sums.wallFlowRate) * 200 * flow.dt, through = Math.abs(sums.flowRates[0]) * 200 * flow.dt;
    return {error: (flow.excessVolume() - before - entered) / through, wall: sums.wallFlowRate / sums.flowRates[0]};
  };
  const closed = new K.Flow({grid: {origin: [0, 0, 0], cell: 0.05, nx: 20, ny: 20, nz: 20}, geometry: [{kind: 'sphere', center: [0.5, 0.5, 0.5], radius: 0.2}], fluid: {density: 1, viscosity: 1e-3},
    sides: {xMin: 'periodic', xMax: 'periodic', yMin: 'periodic', yMax: 'periodic', zMin: 'periodic', zMax: 'periodic'}, referenceSpeed: 1, acceleration: [2, 0.5, 0]});
  const m0 = closed.lattice.excessMass();
  closed.step(300);
  return {interpolated: ledger('interpolated'), halfway: ledger('halfway'), closed: Math.abs(closed.lattice.excessMass() - m0) / closed.fluidCells};
}
export {mean, sum};
