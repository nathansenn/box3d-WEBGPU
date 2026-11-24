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
export function pipe(K, {n = 12, source = 'cylinder', tau} = {}) {
  const R = 0.5, h = 2 * R / n, nu = 0.02, a = 0.3, c = R + 0.5 * h; // the axis sits on a cell centre plus nothing special
  const item = source === 'mesh' ? {kind: 'mesh', ...K.flowTubeMesh([[-5, c, c], [5, c, c]], R, 48), role: 'cavity', part: 'pipe'} : {kind: 'cylinder', from: [-5, c, c], to: [5, c, c], radius: R, role: 'cavity', part: 'pipe'};
  const flow = new K.Flow({grid: {origin: [0, 0, 0], cell: h, nx: 2, ny: n + 1, nz: n + 1}, geometry: [item], fluid: {density: 1, viscosity: nu},
    // with `tau` the relaxation time is held at that value whatever n (the lattice speed falls with h): the error then
    // measures the cells, not the relaxation time, on which the wall position of bounce-back depends
    sides: {xMin: 'periodic', xMax: 'periodic'}, referenceSpeed: 1, acceleration: [a, 0, 0], ...(tau ? {latticeSpeed: (tau - 0.5) / 3 * h / nu} : {})});
  const steps = settle(flow), exact = Math.PI * R ** 4 * a / (8 * nu);
  // the wall takes what the body force gives the fluid: force on the wall over the force on the fluid
  const wall = flow.forces()[0].force[0], fluid = a * flow.fluidCells * h ** 3;
  return {n, source, steps, flowRate: flowRateX(flow), exact, error: flowRateX(flow) / exact - 1, forceBalance: wall / fluid - 1, fluidCells: flow.fluidCells, relaxationTime: flow.relaxationTime};
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

// ---------------------------------------------------------------------------------------------------------------------
// Bluff bodies: a circular cylinder in a 2D tunnel (one cell deep, periodic across), a sphere, a cube and a plate
// ---------------------------------------------------------------------------------------------------------------------
/** A two-dimensional tunnel: inflow on xMin, outflow on xMax, slip walls on y, periodic and one cell deep in z. D = 1 m,
 * U = 1 m/s, density 1; the body's centre `up` diameters from the inlet and mid-height (plus `offset` D). */
function tunnel2d(K, {n, re, length = 18, height = 12, up = 5, offset = 0, latticeSpeed = 0.08, geometry, turbulence = 'none'}) {
  const h = 1 / n, nx = Math.round(length * n), ny = Math.round(height * n);
  const centre = [up, height / 2 + offset, 0];
  return {flow: new K.Flow({grid: {origin: [0, 0, -h / 2], cell: h, nx, ny, nz: 1}, geometry: geometry(centre, h), fluid: {density: 1, viscosity: 1 / re},
    sides: {xMin: {kind: 'velocity', velocity: [1, 0, 0]}, xMax: {kind: 'pressure'}, yMin: 'slip', yMax: 'slip', zMin: 'periodic', zMax: 'periodic'},
    referenceSpeed: 1, latticeSpeed, initialVelocity: [1, 0, 0], turbulence}), depth: h, blockage: 1 / height};
}
const cylinder2d = (centre, h) => [{kind: 'cylinder', from: [centre[0], centre[1], -1], to: [centre[0], centre[1], 1], radius: 0.5, part: 'cylinder'}];
/** Steady flow past a cylinder (Re 20, 40): drag coefficient and the length of the recirculation behind it, over D. */
export function cylinderSteady(K, {re = 20, n = 8, height = 24, length = 30, up = 10, latticeSpeed = 0.08, tolerance = 1e-5, settle = 60, maxSteps = 100000} = {}) {
  const {flow, depth, blockage} = tunnel2d(K, {n, re, height, length, up, latticeSpeed, geometry: cylinder2d});
  // at least `settle` D/U, then until the drag changes by less than `tolerance` per D/U
  const every = Math.round(1 / flow.dt);
  let last = Infinity, cd = 0;
  while (flow.stepCount < maxSteps) {
    flow.step(every);
    cd = flow.takeSums().parts[0].force[0] / (0.5 * depth);
    if (flow.time >= settle && Math.abs(cd - last) < tolerance * Math.abs(cd)) break;
    last = cd;
  }
  // recirculation: where u on the centre line behind the cylinder turns positive
  const f = flow.field(), line = K.flowLine(f, [up + 0.5, height / 2, 0], [up + 10, height / 2, 0], 381, [1, 0, 0]);
  let first = 0; while (first < line.s.length && line.distance[first] <= 0) first++;
  const reattach = line.zeroCrossings.find(s => s > line.s[first]) ?? NaN;
  return {re, n, cd, recirculation: reattach, steps: flow.stepCount, blockage, cells: flow.fluidCells};
}
/** Unsteady flow past a cylinder (Re 100 to 200): mean drag coefficient and the Strouhal number of the lift. */
export function cylinderShedding(K, {re = 100, n = 10, height = 16, length = 25, up = 6, settle = 100, average = 50, latticeSpeed = 0.08} = {}) {
  // a centre 2% of D off the middle starts the shedding without a kick
  const {flow, depth, blockage} = tunnel2d(K, {n, re, height, length, up, latticeSpeed, offset: 0.02, geometry: cylinder2d});
  const unit = 1 / flow.dt, every = Math.max(1, Math.round(unit / 20)); // steps per D/U, and 20 samples per D/U
  flow.step(Math.round(settle * unit)); flow.takeSums();
  const cd = [], cl = [];
  const total = Math.round(average * unit / every);
  for (let i = 0; i < total; i++) { flow.step(every); const s = flow.takeSums().parts[0]; cd.push(s.force[0] / (0.5 * depth)); cl.push(s.force[1] / (0.5 * depth)); }
  const shedding = K.flowFrequency(cl, every * flow.dt);
  return {re, n, cd: mean(cd), clAmplitude: Math.SQRT2 * (shedding?.amplitude ?? 0), strouhal: shedding ? shedding.frequency : 0, periods: shedding?.periods ?? 0, blockage, steps: flow.stepCount, cells: flow.fluidCells};
}

// ---------------------------------------------------------------------------------------------------------------------
// Internal studies through the study document: a pipe drawn as a cylinder (the fluid), openings at its ends
// ---------------------------------------------------------------------------------------------------------------------
/** Hagen-Poiseuille through a pipe of diameter D = 1 m and length 6 D drawn as a fluid cylinder, inlet by flow rate with
 * the developed profile, outlet by pressure: the pressure drop between sections 2 D and 4 D from the inlet against
 * 128 mu L Q / (pi D^4), the peak over the mean speed on the middle section against 2, and the mass balance. */
export function pipeStudy(K, {re = 1107, cells = 15000, transits = 30, tolerance = 0.001, profile = 'developed', model, latticeSpeed, length = 6} = {}) {
  const D = 1, L = length, U = 1, nu = U * D / re, Q = Math.PI / 4 * D * D * U;
  const study = {format: 'box3d-flow-study/1', name: 'Hagen-Poiseuille', fluid: {density: 1, viscosity: nu}, mode: 'internal',
    geometry: [{kind: 'cylinder', center: [L / 2, 0, 0], length: L, rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], radius: D / 2, role: 'cavity', part: 'pipe'}],
    internal: {inlets: [{name: 'in', shape: {kind: 'disc', center: [0, 0, 0], normal: [-1, 0, 0], radius: D / 2}, flowRate: Q, profile}],
      outlets: [{name: 'out', shape: {kind: 'disc', center: [L, 0, 0], normal: [1, 0, 0], radius: D / 2}, pressure: 0}]},
    resolution: {cells, ...(latticeSpeed ? {latticeSpeed} : {})}, ...(model ? {model} : {}), run: {transits, windowTransits: 1, startupTransits: 1, tolerance},
    outputs: {sections: [{name: 'a', axis: 'x', position: L / 3}, {name: 'mid', axis: 'x', position: L / 2}, {name: 'b', axis: 'x', position: 2 * L / 3}], history: false}};
  const r = K.runFlowStudy(study);
  const [a, mid, b] = r.flow.sections, drop = a.meanPressure - b.meanPressure, exact = 128 * nu * (L / 3) * Q / (Math.PI * D ** 4);
  return {re, cells: r.setup.lattice.fluidCells, cellsAcross: D / r.setup.grid.cell, drop, exact, error: drop / exact - 1, peakOverMean: mid.maxNormalSpeed / mid.meanSpeed, flowRate: mid.flowRate / Q - 1,
    massBalance: r.flow.massBalance, steps: r.run.steps, converged: r.run.converged, turbulence: r.setup.turbulence.model};
}

/** A three-dimensional tunnel with slip walls: inflow on xMin, outflow on xMax. D = 1 m, U = 1 m/s, density 1. */
function tunnel3d(K, {n, re, length = 10, width = 5, up = 3, latticeSpeed = 0.08, geometry, turbulence = 'auto', model = {}}) {
  const h = 1 / n, nx = Math.round(length * n), ny = Math.round(width * n);
  return new K.Flow({grid: {origin: [-up, -width / 2, -width / 2], cell: h, nx, ny, nz: ny}, geometry, fluid: {density: 1, viscosity: 1 / re},
    sides: {xMin: {kind: 'velocity', velocity: [1, 0, 0]}, xMax: {kind: 'pressure'}, yMin: 'slip', yMax: 'slip', zMin: 'slip', zMax: 'slip'},
    referenceSpeed: 1, latticeSpeed, initialVelocity: [1, 0, 0], turbulence, reynolds: re, ...model});
}
/** Mean drag over `average` D/U after `settle` D/U, with the pressure referred to the mean on the inlet (the static
 * pressure of the stream) as the study runner does; area A. */
function meanDrag(K, flow, {settle, average, area}) {
  const unit = 1 / flow.dt, every = Math.max(1, Math.round(unit / 10)), wetted = flow.pressureArea()[0].force[0];
  flow.step(Math.round(settle * unit)); flow.takeSums();
  const cd = [];
  for (let i = 0, total = Math.round(average * unit / every); i < total; i++) { flow.step(every); cd.push(flow.takeSums().parts[0].force[0] / (0.5 * area)); }
  return {cd: mean(cd), wetted};
}
/** A sphere of diameter D at Reynolds number `re`: the drag coefficient. */
export function sphere(K, {re = 100, n = 8, settle = 25, average = 15, length = 10, width = 5} = {}) {
  const flow = tunnel3d(K, {n, re, length, width, geometry: [{kind: 'sphere', center: [0, 0, 0], radius: 0.5, part: 'sphere'}]});
  const {cd} = meanDrag(K, flow, {settle, average, area: Math.PI / 4});
  return {re, n, cd, blockage: Math.PI / 4 / (width * width), turbulence: flow.turbulence, steps: flow.stepCount, cells: flow.fluidCells};
}
/** A cube of side D face-on, and a square plate D x D, thickness `thickness` D, normal to the stream, at Re = 1e5. */
export function sharpBody(K, {shape = 'cube', re = 1e5, n = 8, settle = 20, average = 20, length = 10, width = 5, up = 3, thickness = 0.05, model = {}} = {}) {
  const geometry = [{kind: 'box', center: [0, 0, 0], size: shape === 'cube' ? [1, 1, 1] : [thickness, 1, 1], part: shape}];
  const flow = tunnel3d(K, {n, re, length, width, up, geometry, model});
  const {cd} = meanDrag(K, flow, {settle, average, area: 1});
  return {shape, re, n, cd, blockage: 1 / (width * width), turbulence: flow.turbulence, steps: flow.stepCount, cells: flow.fluidCells};
}

/** Backward-facing step (two-dimensional): an inlet channel of height h over a step S = 0.94 h (expansion ratio 1.94,
 * as Armaly et al. 1983), Re = U_mean 2 h / nu; the reattachment length behind the step over S. */
export function backwardStep(K, {re = 100, n = 16, upstream = 3, downstream = 30, latticeSpeed = 0.06, tolerance = 0.002, every = 1000, maxSteps = 200000} = {}) {
  const hIn = 1, S = 0.9423, H = hIn + S, h = hIn / n, nu = 1 * 2 * hIn / re, ny = Math.round(H / h), nx = Math.round((upstream + downstream) / h);
  // the parabolic profile of the inlet channel, mean 1 m/s
  const profile = (x, y) => { const t = (y - S) / hIn; return [t > 0 && t < 1 ? 6 * t * (1 - t) : 0, 0, 0]; };
  const flow = new K.Flow({grid: {origin: [-upstream, 0, -h / 2], cell: h, nx, ny, nz: 1}, fluid: {density: 1, viscosity: nu},
    geometry: [{kind: 'box', center: [-upstream / 2 - 1, S / 2, 0], size: [upstream + 2, S, 1], part: 'step'}],
    sides: {xMin: {kind: 'velocity', velocity: profile}, xMax: {kind: 'pressure'}, yMin: 'wall', yMax: 'wall', zMin: 'periodic', zMax: 'periodic'},
    referenceSpeed: 1.5, latticeSpeed, turbulence: 'none'});
  const reattachment = () => {
    // u one cell above the floor, from the step on: where it turns positive
    const f = flow.field(), line = K.flowLine(f, [h, 0.5 * h, 0], [downstream - h, 0.5 * h, 0], Math.round(downstream / h) * 2, [1, 0, 0]);
    return (line.zeroCrossings[0] ?? NaN) + h;
  };
  let last = NaN, x = NaN;
  while (flow.stepCount < maxSteps) { flow.step(every); x = reattachment(); if (Math.abs(x - last) < tolerance * S) break; last = x; }
  return {re, n, reattachment: x / S, steps: flow.stepCount, cells: flow.fluidCells};
}

/** Sudden expansion of a round pipe, D2 = 2 D1, at Re 50,000 (sub-grid model on): the static pressure rise from just
 * before the step to 8 D2 after it, against Borda-Carnot, rho U1^2 s (1 - s) with s = A1 / A2; and the mass balance. */
export function suddenExpansion(K, {cells = 40000, transits = 3, re = 5e4} = {}) {
  const D1 = 0.5, D2 = 1, U1 = 1, nu = U1 * D1 / re, up = 1.5 * D1, down = 9 * D2, x0 = up, s = (D1 / D2) ** 2;
  const along = [0, 0, -Math.SQRT1_2, Math.SQRT1_2]; // local +y to world +x
  const study = {format: 'box3d-flow-study/1', name: 'sudden expansion', fluid: {density: 1, viscosity: nu}, mode: 'internal',
    geometry: [{kind: 'cylinder', center: [up / 2, 0, 0], length: up, rotation: along, radius: D1 / 2, role: 'cavity', part: 'small'},
      {kind: 'cylinder', center: [up + down / 2, 0, 0], length: down, rotation: along, radius: D2 / 2, role: 'cavity', part: 'large'}],
    internal: {inlets: [{name: 'in', shape: {kind: 'disc', center: [0, 0, 0], normal: [-1, 0, 0], radius: D1 / 2}, speed: U1}],
      outlets: [{name: 'out', shape: {kind: 'disc', center: [up + down, 0, 0], normal: [1, 0, 0], radius: D2 / 2}}]},
    resolution: {cells}, run: {transits, windowTransits: 0.75, startupTransits: 1.5, tolerance: 0.01},
    outputs: {sections: [{name: 'before', axis: 'x', position: x0 - 0.5 * D1}, {name: 'after', axis: 'x', position: x0 + 8 * D2}], history: false}};
  const r = K.runFlowStudy(study), [a, b] = r.flow.sections;
  const rise = b.meanPressure - a.meanPressure, exact = U1 * U1 * s * (1 - s);
  return {re, cells: r.setup.lattice.fluidCells, cellsAcross: D1 / r.setup.grid.cell, rise, exact, error: rise / exact - 1, massBalance: r.flow.massBalance, steps: r.run.steps, turbulence: r.setup.turbulence.model};
}
/** A symmetric tee: a stem from below splits into two equal arms open at the same pressure. Each arm takes half by
 * symmetry; what enters leaves. */
export function teeSplit(K, {cells = 12000, transits = 4} = {}) {
  const D = 0.2, L = 0.6;
  const study = {format: 'box3d-flow-study/1', name: 'tee', fluid: 'water', mode: 'internal',
    geometry: [{kind: 'cylinder', from: [0, -L, 0], to: [0, 0, 0], radius: D / 2, role: 'cavity', part: 'stem'},
      {kind: 'cylinder', from: [-L, 0, 0], to: [L, 0, 0], radius: D / 2, role: 'cavity', part: 'run'}],
    internal: {inlets: [{name: 'stem', shape: {kind: 'disc', center: [0, -L, 0], normal: [0, -1, 0], radius: D / 2}, flowRate: 0.01, profile: 'developed'}],
      outlets: [{name: 'left', shape: {kind: 'disc', center: [-L, 0, 0], normal: [-1, 0, 0], radius: D / 2}}, {name: 'right', shape: {kind: 'disc', center: [L, 0, 0], normal: [1, 0, 0], radius: D / 2}}]},
    resolution: {cells}, run: {transits, windowTransits: 1}, outputs: {history: false}};
  const r = K.runFlowStudy(study), split = Object.fromEntries(r.flow.splits.map(sp => [sp.name, sp.fraction]));
  return {cells: r.setup.lattice.fluidCells, left: split.left, right: split.right, massBalance: r.flow.massBalance, steps: r.run.steps, turbulence: r.setup.turbulence.model};
}
/** A tank with three inlets at different flow rates and one outlet by pressure: the outflow against the sum of the
 * inflows, and the flow of each inlet against the one given. */
export function tank(K, {cells = 15000, transits = 3} = {}) {
  const study = {format: 'box3d-flow-study/1', name: 'tank', fluid: 'water', mode: 'internal',
    geometry: [{kind: 'box', center: [0.5, 0.3, 0.3], size: [1, 0.6, 0.6], role: 'cavity', part: 'tank'},
      {kind: 'cylinder', from: [0.15, 0.6, 0.3], to: [0.15, 0.8, 0.3], radius: 0.06, role: 'cavity', part: 'a'},
      {kind: 'cylinder', from: [-0.2, 0.45, 0.15], to: [0, 0.45, 0.15], radius: 0.06, role: 'cavity', part: 'b'},
      {kind: 'cylinder', from: [0.55, 0.42, 0.8], to: [0.55, 0.42, 0.6], radius: 0.06, role: 'cavity', part: 'c'},
      {kind: 'cylinder', from: [1, 0.1, 0.4], to: [1.2, 0.1, 0.4], radius: 0.08, role: 'cavity', part: 'out'}],
    internal: {inlets: [{name: 'a', shape: {kind: 'disc', center: [0.15, 0.8, 0.3], normal: [0, 1, 0], radius: 0.06}, flowRate: 0.006},
      {name: 'b', shape: {kind: 'disc', center: [-0.2, 0.45, 0.15], normal: [-1, 0, 0], radius: 0.06}, flowRate: 0.004},
      {name: 'c', shape: {kind: 'disc', center: [0.55, 0.42, 0.8], normal: [0, 0, 1], radius: 0.06}, flowRate: 0.003}],
      outlets: [{name: 'out', shape: {kind: 'disc', center: [1.2, 0.1, 0.4], normal: [1, 0, 0], radius: 0.08}}]},
    resolution: {cells}, run: {transits, windowTransits: 1}, outputs: {history: false}};
  const r = K.runFlowStudy(study), flows = Object.fromEntries(r.flow.patches.map(p => [p.name, p.flowRate]));
  return {cells: r.setup.lattice.fluidCells, inflow: r.flow.inflow, outflow: r.flow.outflow, massBalance: r.flow.massBalance, inletError: Math.max(Math.abs(flows.a / 0.006 - 1), Math.abs(flows.b / 0.004 - 1), Math.abs(flows.c / 0.003 - 1)), steps: r.run.steps};
}
/** A rectangular building 20 m x 30 m x 12 m (height 30) on fixed ground in a 20 m/s wind normal to its wide face, by
 * the study runner with its defaults: drag coefficient on the frontal area and the largest surface pressure coefficient. */
export function building(K, {cells = 120000, transits = 3} = {}) {
  const study = {format: 'box3d-flow-study/1', name: 'building', fluid: 'air', mode: 'external',
    geometry: [{kind: 'box', center: [0, 15, 0], size: [12, 30, 20], part: 'building'}],
    external: {speed: 20, direction: [1, 0, 0], ground: {height: 0, type: 'fixed'}, referenceArea: 20 * 30},
    resolution: {cells}, run: {transits, windowTransits: 0.75, startupTransits: 1}, outputs: {surface: true, history: false}};
  const r = K.runFlowStudy(study), c = r.forces.coefficients;
  return {cells: r.setup.lattice.fluidCells, bodyCells: r.setup.external.bodyCells, blockage: r.setup.external.blockage, cd: c.cd, cl: c.cl, cpMax: r.surface[0].cpMax, cpMaxResolved: r.surface[0].cpMaxResolved,
    referencePressure: r.setup.external.referencePressure.value / c.dynamicPressure, steps: r.run.steps, turbulence: r.setup.turbulence.model, reynolds: r.setup.reynolds};
}

/** The largest resolved surface pressure coefficient (samples on sharp edges and in gaps left out) of a body in a free
 * stream through the study runner: a cube face-on, a sphere, both at Re 1e4 (D = 1 m, U = 10 m/s, air-like fluid);
 * for the building see building(). In incompressible flow it is 1 at the stagnation point. */
export function stagnation(K, {shape = 'cube', cells = 120000, transits = 4} = {}) {
  const geometry = [shape === 'sphere' ? {kind: 'sphere', center: [0, 0, 0], radius: 0.5, part: shape} : {kind: 'box', center: [0, 0, 0], size: [1, 1, 1], part: shape}];
  const study = {format: 'box3d-flow-study/1', name: shape, fluid: {density: 1.2, viscosity: 1e-3}, mode: 'external', geometry,
    external: {speed: 10, direction: [1, 0, 0], referenceLength: 1}, resolution: {cells}, run: {transits, windowTransits: 0.75, startupTransits: 1},
    outputs: {surface: true, history: false}};
  const r = K.runFlowStudy(study), sf = r.surface[0];
  return {shape, cells: r.setup.lattice.fluidCells, cellsAcross: 1 / r.setup.grid.cell, cpMax: sf.cpMax, cpMaxResolved: sf.cpMaxResolved, flagged: sf.flagged, vertices: sf.flags.length,
    cellCpMax: r.extremes.pressureMax.cp, cellCpMaxResolved: r.extremes.pressureMaxResolved?.cp ?? null, referencePressure: r.setup.external.referencePressure.value / r.forces.coefficients.dynamicPressure,
    cd: r.forces.coefficients.cd, blockage: r.setup.external.blockage, converged: r.run.converged};
}

/** Sparse storage (FlowOptions.storage 'sparse', tiles of 8^3 cells): (1) an L of two pipes with a sphere at the corner, a
 * baffle, a parabolic inlet and a pressure outlet, in a box that fits dense storage too, run both ways: the populations,
 * the fields and the sums must be the same bits; (2) a long thin L of pipes whose box is about three times the dense
 * limit of 2^25 cells, run sparse only: set-up, stored cells, the speed and the mass ledger. Bytes per cell of the box
 * arrays are counted from the arrays the Flow and its field keep. */
export function sparseStorage(K, {n = 80, steps = 300, length = 3000, bigSteps = 400} = {}) {
  const c = 6, R = 3.2, L = n - 4, h = 1;
  const geometry = [{kind: 'cylinder', from: [2, c, c], to: [L, c, c], radius: R, role: 'cavity', part: 'a'}, {kind: 'cylinder', from: [L, c, c], to: [L, L, c], radius: R, role: 'cavity', part: 'b'},
    {kind: 'sphere', center: [L, c, c], radius: R, role: 'cavity', part: 'b'}, {kind: 'box', center: [L / 2, c, c], size: [2, 1, 1], part: 'baffle'}];
  const options = storage => ({grid: {origin: [0, 0, 0], cell: h, nx: n, ny: n, nz: 13}, geometry, fluid: {density: 1, viscosity: 0.05}, referenceSpeed: 1, latticeSpeed: 0.05, turbulence: 'smagorinsky', storage,
    patches: [{name: 'in', kind: 'inlet', shape: {kind: 'disc', center: [2, c, c], normal: [-1, 0, 0], radius: R}, flowRate: Math.PI * R * R * 0.5, profile: 'parabolic'},
      {name: 'out', kind: 'outlet', shape: {kind: 'disc', center: [L, L, c], normal: [0, 1, 0], radius: R}, pressure: 0}]});
  const dense = new K.Flow(options('dense')), sparse = new K.Flow(options('sparse'));
  dense.step(steps); sparse.step(steps);
  let populations = 0;
  for (let i = 0; i < dense.lattice.f.length; i++) if (!Object.is(dense.lattice.f[i], sparse.lattice.f[i])) populations++;
  const fa = dense.field(), fb = sparse.field(), g = dense.grid;
  let fields = 0;
  for (let k = 0, q = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++, q++) {
    const s = sparse.tiles.slot(i, j, k);
    if (fa.fluid[q] !== fb.fluid[s] || !Object.is(fa.ux[q], fb.ux[s]) || !Object.is(fa.uy[q], fb.uy[s]) || !Object.is(fa.uz[q], fb.uz[s]) || !Object.is(fa.pressure[q], fb.pressure[s]) || !Object.is(fa.distance[q], fb.distance[s])) fields++;
  }
  const sa = dense.takeSums(), sb = sparse.takeSums(), same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const small = {box: g.nx * g.ny * g.nz, stored: sparse.tiles.slots, fluidCells: dense.fluidCells, populations, fields, sums: same(sa, sb), steps};
  // the long L: box (length + 2)^2 x 11 cells
  const r = 2.6, e = 4, nz = 9, t0 = performance.now();
  const big = new K.Flow({grid: {origin: [0, 0, 0], cell: 1, nx: length, ny: length, nz}, fluid: {density: 1, viscosity: 0.02}, referenceSpeed: 1, latticeSpeed: 0.05, turbulence: 'none',
    geometry: [{kind: 'cylinder', from: [1, e, e], to: [length - e, e, e], radius: r, role: 'cavity', part: 'leg1'}, {kind: 'cylinder', from: [length - e, e, e], to: [length - e, length - 1, e], radius: r, role: 'cavity', part: 'leg2'},
      {kind: 'sphere', center: [length - e, e, e], radius: r, role: 'cavity', part: 'leg2'}],
    patches: [{name: 'in', kind: 'inlet', shape: {kind: 'disc', center: [1, e, e], normal: [-1, 0, 0], radius: r}, speed: 0.5, profile: 'parabolic'},
      {name: 'out', kind: 'outlet', shape: {kind: 'disc', center: [length - e, length - 1, e], normal: [0, 1, 0], radius: r}, pressure: 0}]});
  const t1 = performance.now(), mass0 = big.excessVolume();
  big.step(bigSteps);
  const t2 = performance.now(), sums = big.takeSums(), mass1 = big.excessVolume();
  // what came in through the openings and the walls over the run, against what the box gained (m^3, cell = 1 m)
  const through = (sums.flowRates[0] + sums.flowRates[1] + sums.wallFlowRate) * sums.steps * big.dt;
  const box = big.grid.nx * big.grid.ny * big.grid.nz;
  // bytes per cell of the box arrays: kind 1, owner 2, distance 4, part 2, activeOf 4, the cavity field and its parts
  // 4 + 2, the flood fill 1, and the field's fluid 1, ux uy uz pressure 16 and opening 2
  const bytesPerCell = 1 + 2 + 4 + 2 + 4 + 6 + 1 + 1 + 16 + 2;
  return {small, big: {box, overDenseLimit: box / K.FLOW_MAX_CELLS, stored: big.tiles.slots, blocks: big.tiles.blocks - 1, fluidCells: big.fluidCells, setupSeconds: (t1 - t0) / 1000,
    cellUpdatesPerSecond: big.fluidCells * bigSteps / ((t2 - t1) / 1000), healthy: big.healthy(), inflow: sums.flowRates[0], massError: (mass1 - mass0) - through,
    denseBytes: box * bytesPerCell, sparseBytes: big.tiles.slots * bytesPerCell, latticeBytes: big.fluidCells * (19 * 16 + 4 * 8)}};
}

/** Closed boxes whose six walls are 0.02 m thick on a grid of 0.11 m cells (0.18 cells), given five ways: as closed
 * meshes, rotated meshes, thin boxes, rotated thin boxes and open quads with thickness 0. A walk over the lattice links
 * from a corner of the grid must not reach the centre of the box. */
export function thinWallLeak(K) {
  const h = 0.11, n = 20, grid = {origin: [0, 0, 0], cell: h, nx: n, ny: n, nz: n}, t = 0.02, a = 0.53, b = 1.61, c = (a + b) / 2;
  const walls = [[[a, a, a], [b, b, a + t]], [[a, a, b - t], [b, b, b]], [[a, a, a], [b, a + t, b]], [[a, b - t, a], [b, b, b]], [[a, a, a], [a + t, b, b]], [[b - t, a, a], [b, b, b]]];
  const angle = 0.5, q = [0, Math.sin(angle / 2) * 0.6, Math.sin(angle / 2) * 0.8, Math.cos(angle / 2)];
  const rotate = v => { const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]); return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]; };
  const sets = {
    meshes: walls.map(([lo, hi], i) => ({kind: 'mesh', ...boxMesh(lo, hi), part: `w${i}`})),
    rotatedMeshes: walls.map(([lo, hi], i) => ({kind: 'mesh', ...boxMesh(lo.map(v => v - c), hi.map(v => v - c)), rotation: q, position: [c, c, c], part: `w${i}`})),
    boxes: walls.map(([lo, hi], i) => ({kind: 'box', center: lo.map((v, k) => (v + hi[k]) / 2), size: lo.map((v, k) => hi[k] - v), part: `w${i}`})),
    rotatedBoxes: walls.map(([lo, hi], i) => ({kind: 'box', center: rotate(lo.map((v, k) => (v + hi[k]) / 2 - c)).map(v => v + c), size: lo.map((v, k) => hi[k] - v), rotation: q, part: `w${i}`})),
    openQuads: walls.map(([lo, hi], i) => { const m = boxMesh(lo, hi), face = [0, 6, 12, 18, 30, 24][i]; return {kind: 'mesh', positions: m.positions, indices: m.indices.slice(face, face + 6), thickness: 0, part: `w${i}`}; }),
  };
  const links = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1], [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]];
  const out = {leaking: 0, thickened: {}, closedCells: {}};
  for (const [name, items] of Object.entries(sets)) {
    const v = K.flowVoxelize(items, grid), seen = new Uint8Array(n * n * n), stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const cell = stack.pop(), i = cell % n, j = Math.floor(cell / n) % n, k = Math.floor(cell / (n * n));
      for (const [dx, dy, dz] of links) {
        const x = i + dx, y = j + dy, z = k + dz;
        if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) continue;
        const e = x + n * (y + n * z);
        if (seen[e] || v.distance[e] < 0) continue;
        seen[e] = 1; stack.push(e);
      }
    }
    const centre = Math.floor(c / h), inside = centre + n * (centre + n * centre);
    if (v.distance[inside] >= 0 && seen[inside]) out.leaking++;
    out.thickened[name] = v.largestThickening; out.closedCells[name] = v.closedCells;
  }
  return out;
}

/** A round pipe at Reynolds number `re` (mean speed, diameter), `n` cells across, one cell long and periodic, driven by
 * the Hagen-Poiseuille pressure gradient and started from the exact parabola: after `viscousTimes` times R^2 / (5.78 nu)
 * the flow rate over the exact one, and the largest secondary (cross-section) speed over the mean. Above a cell Reynolds
 * number of about 50 (peak speed) the lattice grows a spurious secondary flow that flattens the profile; below it the
 * parabola holds. */
export function laminarPipe(K, {re = 1000, n = 48, viscousTimes = 3, latticeSpeed = 0.06} = {}) {
  const R = 0.5, h = 2 * R / n, U = 1, nu = U * 2 * R / re, a = 8 * nu * U / (R * R), c = R + 0.5 * h;
  const flow = new K.Flow({grid: {origin: [0, 0, 0], cell: h, nx: 1, ny: n + 1, nz: n + 1}, geometry: [{kind: 'cylinder', from: [-5, c, c], to: [5, c, c], radius: R, role: 'cavity', part: 'pipe'}],
    fluid: {density: 1, viscosity: nu}, sides: {xMin: 'periodic', xMax: 'periodic'}, referenceSpeed: 2 * U, latticeSpeed, acceleration: [a, 0, 0], turbulence: 'none'});
  const L = flow.lattice, g = L, vs = flow.cell / flow.dt, grid = flow.grid;
  // the exact parabola as the starting state (equilibrium populations, lattice units)
  for (let q = 0; q < L.fluidCells; q++) {
    const cell = L.cellOf[q], j = Math.floor(cell / grid.nx) % grid.ny, k = Math.floor(cell / (grid.nx * grid.ny));
    const y = grid.origin[1] + (j + 0.5) * h - c, z = grid.origin[2] + (k + 0.5) * h - c, u = Math.max(0, 2 * U * (1 - (y * y + z * z) / (R * R))) / vs;
    for (let d = 0; d < 19; d++) { const cu = K.FLOW_CX[d] * u; L.f[q * 19 + d] = K.FLOW_WEIGHT[d] * (3 * cu + 4.5 * cu * cu - 1.5 * u * u); }
    L.ux[q] = u;
  }
  const nuLattice = nu * flow.dt / (h * h), steps = Math.round(viscousTimes * (R / h) ** 2 / (5.78 * nuLattice));
  flow.step(steps);
  let sum = 0, secondary = 0;
  for (let q = 0; q < L.fluidCells; q++) { sum += g.ux[q]; secondary = Math.max(secondary, Math.hypot(g.uy[q], g.uz[q])); }
  const flowRate = sum * vs * h * h, exact = Math.PI * R ** 4 * a / (8 * nu);
  return {re, n, cellReynolds: 2 * U * h / nu, relaxationTime: flow.relaxationTime, steps, flowRate, exact, error: flowRate / exact - 1, secondary: secondary * vs / U, fluidCells: L.fluidCells,
    warned: flow.warnings.some(w => /secondary flow/.test(w))};
}
