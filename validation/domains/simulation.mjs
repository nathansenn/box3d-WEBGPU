// One stepping loop (box3d-webgpu-kit/simulation): coupled scenes and the links between solvers, against closed forms.
// Set-ups are those of packages/box3d-kit/test/v14-simulation.test.mjs: SI units, 240 Hz, 4 sub-steps unless stated.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, ROOT} from '../lib.mjs';

const G = 9.81, HZ = 240, SUB = 4, DT = 1 / HZ;
const FILE = 'packages/box3d-kit/test/v14-simulation.test.mjs';
const T = {
  combined: 'bit-identity, combined: water + structure + heat + solid with the thermal link, registered in any order, equal the hand-driven sequence',
  thermal: 'thermal -> solid link: a free block expands by alpha dT with zero stress; a restrained bar reaches -E alpha dT as the heat solver brings it to a uniform temperature',
  dead: 'rigid -> solid dead load (one-way): a block under a resting body shortens by m g L / (E A) with stress -m g / A; the body is not moved',
  rest: 'moored buoy at rest: cable tension = rho g V_sub - weight, the draught follows, and the floor and the anchor carry the total weight',
  release: 'moored buoy released 0.4 m to the side: bounded, decaying with the drag, back at the equilibrium; the ledger with drag only falls',
  deck: 'cable-stayed deck: stay tensions and deflection match the hand statics through the Simulation, from the scene JSON and from a share link, with the same bits',
  energy: 'energy ledger, undamped: conserved to the stated order of the integrators and never growing',
  resume: 'determinism: a coupled scene repeats bit for bit; save -> load -> continue starts from the same fields and stays within a stated bound',
};

const modules = () => memo('simulation/modules', async () => {
  const [index, simulation, scene, coupling, structure, cable, frame, heat, solid] = await Promise.all(['index', 'simulation', 'scene', 'coupling', 'structure', 'cable', 'frame', 'heat', 'solid'].map(kit));
  return {...index, ...simulation, ...scene, ...coupling, ...structure, ...cable, ...frame, ...heat, ...solid};
});
const bits = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
const open = async scene => { const m = await modules(), world = await m.createWorld(m.sceneWorldOptions(scene)); return {world, ...m.loadScene(world, scene)}; };
const cableConfig = (overrides = {}) => ({dt: DT, substeps: 1, maxIterations: 2048, residualTolerance: 1e-10, drag: 0, gravity: [0, -G, 0], solver: 'proximal', forceTolerance: 1e-6, ...overrides});
const steel = {youngModulus: 2e11, shearModulus: 8e10, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 7850, up: [0, 1, 0]};
const COPPER = {conductivity: 401, density: 8960, specificHeat: 385};
const STEEL_SOLID = {youngModulus: 200e9, poissonRatio: 0.3, density: 7850, thermalExpansion: 12e-6};

// ---- Moored buoy ----

const capVolume = (R, d) => d <= 0 ? 0 : d >= 2 * R ? 4 / 3 * Math.PI * R ** 3 : Math.PI * d * d * (3 * R - d) / 3;
const BUOY = {R: 0.4, H: 3, L0: 2.75, EA: 5e4, A: 64, rho: 1000};

/** The example scene with more drag, at rest: half-second means after 8 s, and the closed-form equilibrium. */
const buoyAtRest = () => memo('simulation/buoy-rest', async () => {
  const m = await modules(), {R, H, L0, EA, A, rho} = BUOY, scene = m.mooredBuoyScene({linearDrag: 2000, waterDrag: 2}), loaded = await open(scene), {world, simulation} = loaded;
  try {
    const buoy = loaded.bodies.get('buoy'), water = loaded.water.get('basin'), cable = loaded.cables.get('mooring'), attachment = loaded.attachments.get('mooring:0');
    const g = -world.gravity()[1], mass = world.getState(buoy).mass, node = scene.cables[0].masses[1], V0 = capVolume(R, H - (world.getState(buoy).position[1] - R));
    // Stretch s: centre at L0 + s, level H + (V - V0) / A, E A s / L0 = rho g V - (m + m_n) g.
    const balance = s => { let V = capVolume(R, H - (L0 + s - R)); for (let i = 0; i < 60; i++) V = capVolume(R, H + (V - V0) / A - (L0 + s - R)); return {V, residual: EA * s / L0 - (rho * g * V - (mass + node) * g)}; };
    let lo = 0, hi = 0.5; for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (balance(mid).residual > 0) hi = mid; else lo = mid; }
    const stretch = (lo + hi) / 2, V = balance(stretch).V, closed = {tension: EA * stretch / L0, draught: H + (V - V0) / A - (L0 + stretch - R)};
    const steps = 8 * HZ, window = HZ / 2, mean = {tension: 0, force: 0, y: 0, V: 0, anchor: 0, floor: 0, level: 0};
    for (let i = 0; i < steps; i++) {
      simulation.step();
      if (i < steps - window) continue;
      const s = world.getState(buoy), snapshot = cable.inspect();
      mean.tension += snapshot.tensions[0] / window; mean.force += attachment.force[1] / window; mean.y += s.position[1] / window; mean.V += water.report(buoy).submergedVolume / window;
      mean.anchor += snapshot.supportReactions[1] / window; mean.floor += water.floorLoad() / window; mean.level += water.elevationAt(s.position[0], s.position[2]) / window;
    }
    const B = rho * g * mean.V;
    return {force: -mean.force, net: B - mass * g, tension: mean.tension, netWithNode: B - (mass + node) * g, draught: H + mean.level - (mean.y - R), closed,
      ground: mean.floor + mean.anchor, total: rho * g * water.waterVolume() + (mass + 2 * node) * g, bias: node * B / (mass + node)};
  } finally { world.dispose(); }
});

/** The example scene as it ships, released `offset` to the side: where it ends after 24 s, and the energy ledger from the first step on. */
const buoyRun = offset => memo(`simulation/buoy-run-${offset}`, async () => {
  const m = await modules(), loaded = await open(m.mooredBuoyScene({offset})), {world, simulation} = loaded;
  try {
    const buoy = loaded.bodies.get('buoy'), water = loaded.water.get('basin');
    simulation.step();
    const start = simulation.energy().balance; let top = start, speed = 0, far = 0;
    for (let i = 1; i < 24 * HZ; i++) {
      simulation.step();
      const s = world.getState(buoy); far = Math.max(far, Math.hypot(s.position[0], s.position[2])); speed = Math.max(speed, Math.hypot(...s.linearVelocity));
      if (i % 4 === 0) top = Math.max(top, simulation.energy().balance);
    }
    const s = world.getState(buoy);
    return {x: Math.hypot(s.position[0], s.position[2]), y: s.position[1], far, excess: top - start, drop: start - simulation.energy().balance, bound: water.report(buoy).buoyancy[1] * speed * DT};
  } finally { world.dispose(); }
});

/** The moored buoy built from the modules and driven by hand in the documented order, against the Simulation of the scene file. */
const buoyIdentity = () => memo('simulation/buoy-identity', async () => {
  const m = await modules(), scene = m.mooredBuoyScene({offset: 0.4}), loaded = await open(scene), hand = await m.createWorld(m.sceneWorldOptions(scene));
  try {
    hand.reset({ground: false, gravity: [0, -G, 0], seed: 1});
    const [bed, float] = scene.bodies, basin = scene.water[0], line = scene.cables[0];
    hand.createBody({shape: bed.shape, type: 'static', position: bed.position, color: bed.color});
    const buoy = hand.createBody({shape: float.shape, position: float.position, density: float.density, neverSleeps: true, color: float.color});
    const cable = new m.CompliantCableRuntime({config: cableConfig({maxIterations: 64, residualTolerance: 1e-12, forceTolerance: 1e-9}), positions: line.nodes, masses: line.masses, pinned: line.pinned,
      constraints: line.segments.map(s => ({...s}))});
    const coupling = new m.StructureCoupling(hand);
    coupling.attachCableToBody(cable, 1, buoy, {inertia: {kind: 'sphere', radius: float.shape.radius}, localPoint: [0, 0, 0]});
    const water = new m.WaterCoupling(hand, {cols: basin.cols, rows: basin.rows, dx: basin.dx, dz: basin.dz, restDepth: basin.restDepth, origin: basin.origin, waterDrag: basin.waterDrag});
    water.attach(buoy, float.shape, {linearDrag: basin.bodies[0].linearDrag});
    m.linkWaterToStructure(water, coupling);   // the scene loader does the same: the interface solve counts the water's force
    const views = [cable.couplingViews(), loaded.cables.get('mooring').couplingViews()], other = loaded.water.get('basin');
    let different = 0;
    for (let i = 1; i <= 480; i++) {
      coupling.step(); water.step(); hand.step();   // structure, water, rigid: the order the Simulation fixes
      loaded.simulation.step();
      if (i % 60 === 0 && (hand.exactHash() !== loaded.world.exactHash() || bits(water.eta, water.u, water.v, views[0].positions, views[0].velocities) !== bits(other.eta, other.u, other.v, views[1].positions, views[1].velocities))) different++;
    }
    return different;
  } finally { loaded.world.dispose(); hand.dispose(); }
});

// ---- Cable-stayed deck ----

const SPAN = {L: 8, segments: 8, towerX: 4, towerY: 3, stayEA: 5e6, stayRho: 0.2, radius: 0.15};
/** Hand statics by the flexibility method (derived in packages/box3d-kit/test/v11-structure.test.mjs). */
function stayStatics(mass, loadX) {
  const {L, towerX, towerY, stayEA, stayRho} = SPAN, EI = steel.youngModulus * steel.iz, EA = steel.youngModulus * steel.area, w = steel.density * steel.area * G;
  const influence = (x, a) => { const b = L - a; return x <= a ? b * x * (L * L - b * b - x * x) / (6 * L * EI) : a * (L - x) * (L * L - a * a - (L - x) ** 2) / (6 * L * EI); };
  const self = x => w * x * (L ** 3 - 2 * L * x * x + x ** 3) / (24 * EI);
  const stays = [2, 6].map(x => { const length = Math.hypot(x - towerX, towerY); return {x, length, cx: (towerX - x) / length, cy: towerY / length, end: stayRho * length / 2 * G}; });
  const A = [[0, 0], [0, 0]], b = [0, 0];
  for (let i = 0; i < 2; i++) {
    let sag = self(stays[i].x) + mass * G * influence(stays[i].x, loadX);
    for (const s of stays) sag += s.end * influence(stays[i].x, s.x);
    b[i] = sag * stays[i].cy;
    for (let j = 0; j < 2; j++) A[i][j] = stays[j].cy * influence(stays[i].x, stays[j].x) * stays[i].cy + stays[j].cx * Math.min(stays[i].x, stays[j].x) / EA * stays[i].cx + (i === j ? stays[i].length / stayEA : 0);
  }
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0], tensions = [(b[0] * A[1][1] - b[1] * A[0][1]) / det, (A[0][0] * b[1] - A[1][0] * b[0]) / det];
  const deflection = x => -self(x) - mass * G * influence(x, loadX) + stays.reduce((sum, s, j) => sum + (tensions[j] * s.cy - s.end) * influence(x, s.x), 0);
  return {tensions, deflection, weight: (mass + steel.density * steel.area * L + stays.reduce((sum, s) => sum + stayRho * s.length, 0)) * G};
}
/** The deck scene with the ball on `node`: settle 1.75 s, then quarter-second means; with the world hash and the field bits. */
async function deckRun(source, node) {
  const loaded = await open(source), {world, simulation} = loaded;
  try {
    const frame = loaded.frames.get('deck'), cables = ['stay-left', 'stay-right'].map(id => loaded.cables.get(id)), window = HZ / 4, tension = [0, 0];
    for (let i = 0; i < Math.round(1.75 * HZ); i++) simulation.step();
    let reaction = 0, deflection = 0;
    for (let i = 0; i < window; i++) {
      simulation.step();
      const s = frame.inspect(); reaction += (s.supportReactions[1] + s.supportReactions[6 * SPAN.segments + 1]) / window; deflection += s.displacements[6 * node + 1] / window;
      cables.forEach((cable, k) => { const c = cable.inspect(); tension[k] += c.tensions[0] / window; reaction += c.supportReactions[1] / window; });
    }
    const f = frame.couplingViews();
    return {tension, deflection, reaction, mass: world.getState(loaded.bodies.get('load')).mass, hash: world.exactHash(), state: bits(f.displacements, f.velocities, ...cables.flatMap(cable => { const v = cable.couplingViews(); return [v.positions, v.velocities]; }))};
  } finally { world.dispose(); }
}
const deck = () => memo('simulation/deck', async () => {
  const m = await modules(), worst = {tension: 0, deflection: 0, reaction: 0}; let reference = null;
  for (const node of [1, 3, 4, 5, 7]) {
    const run = await deckRun(m.cableStayedDeckScene({loadNode: node}), node), hand = stayStatics(run.mass, node);
    run.tension.forEach((value, i) => { worst.tension = Math.max(worst.tension, Math.abs(value / hand.tensions[i] - 1)); });
    worst.deflection = Math.max(worst.deflection, Math.abs(run.deflection / hand.deflection(node) - 1));
    worst.reaction = Math.max(worst.reaction, Math.abs(run.reaction / hand.weight - 1));
    if (node === 5) reference = run;
  }
  // The same scene through a share link: every number and every bit must be the same.
  const scene = m.cableStayedDeckScene({loadNode: 5}); let different = 0;
  for (const source of [m.decodeSceneLink(await m.encodeSceneLink(scene)), m.decodeSceneLink(m.encodeSceneLinkSync(scene))]) {
    const run = await deckRun(source, 5);
    if (run.hash !== reference.hash || run.state !== reference.state || run.deflection !== reference.deflection || run.tension[0] !== reference.tension[0] || run.tension[1] !== reference.tension[1]) different++;
  }
  return {...worst, different};
});

// ---- Links ----

const thermal = () => memo('simulation/thermal', async () => {
  const m = await modules(), hz = 60, dt = 1 / hz, T0 = 300, T1 = 380, strain = STEEL_SOLID.thermalExpansion * (T1 - T0), h = 0.0025;
  const world = await m.createWorld({step: dt, subSteps: SUB, ground: false});
  try {
    const sim = m.createSimulation(world);
    const build = (id, cells, constrain) => {
      const [nx, ny, nz] = cells;
      const heat = new m.HeatSolver({nx, ny, nz, dx: h, dy: h, dz: h, materials: [COPPER], temperature: T0, dt, scheme: 'backward-euler', boundaries: [{face: 'x-', type: 'temperature', temperature: T1}, {face: 'x+', type: 'temperature', temperature: T1}]});
      const solid = new m.SolidBody({mesh: m.boxMesh({size: [nx * h, ny * h, nz * h], cells}), material: STEEL_SOLID, config: {dt, integrator: 'backward-euler', model: 'linear', forceTolerance: 1e-7}});
      constrain(solid);
      sim.add(m.heatSubsystem(heat, {id: `${id}-heat`})).add(m.thermalSolidLink(heat, solid, {id: `${id}-link`, reference: T0})).add(m.solidSubsystem(solid, {id: `${id}-solid`}));
      return solid;
    };
    const planes = solid => { solid.constrain(solid.selectNodes((x, y) => y === 0), [null, 0, null]); solid.constrain(solid.selectNodes((x, y, z) => z === 0), [null, null, 0]); };
    const free = build('free', [5, 4, 3], solid => { solid.constrain(solid.selectNodes(x => x === 0), [0, null, null]); planes(solid); });
    const bar = build('bar', [8, 2, 2], solid => { solid.constrain(solid.selectNodes(x => x === 0 || Math.abs(x - 0.02) < 1e-12), [0, null, null]); planes(solid); });
    for (let i = 0; i < 600; i++) sim.step();
    const u = free.displacements, X = free.referencePositions, far = m.boxNode([5, 4, 3], 5, 4, 3);
    return {growth: u[3 * far] / X[3 * far], strain, freeStress: free.stresses().reduce((a, s) => Math.max(a, Math.abs(s)), 0) / (STEEL_SOLID.youngModulus * strain), barStress: bar.stresses()[0]};
  } finally { world.dispose(); }
});

const deadLoad = () => memo('simulation/dead-load', async () => {
  const m = await modules(), hz = 60, L = 0.2, A = 0.01, world = await m.createWorld({step: 1 / hz, subSteps: SUB, ground: true});
  try {
    world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.05, 0.5]}, type: 'static', position: [0, 0.05, 0]});
    const body = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, position: [0, 0.2, 0], density: 7850});
    const solid = new m.SolidBody({mesh: m.boxMesh({size: [0.1, L, 0.1], cells: [4, 8, 4]}), material: {...STEEL_SOLID, thermalExpansion: 0}, config: {dt: 1 / hz, integrator: 'backward-euler', model: 'linear'}});
    solid.constrain(solid.selectNodes((x, y) => y === 0), [null, 0, null]); solid.constrain(solid.selectNodes(x => x === 0), [0, null, null]); solid.constrain(solid.selectNodes((x, y, z) => z === 0), [null, null, 0]);
    const sim = m.createSimulation(world).add(m.solidSubsystem(solid)).add(m.deadLoadLink(body, solid, {faces: solid.selectFaces((cx, cy, cz, nx, ny) => ny > 0.99)}));
    for (let i = 0; i < 120; i++) sim.step();
    const weight = world.getState(body).mass * -world.gravity()[1], top = solid.selectNodes((x, y) => Math.abs(y - L) < 1e-12)[0];
    return {shortening: -solid.displacements[3 * top + 1], expectedShortening: weight * L / (STEEL_SOLID.youngModulus * A), stress: solid.stresses()[1], expectedStress: -weight / A};
  } finally { world.dispose(); }
});

// ---- Energy ledger ----

const pendulum = hz => memo(`simulation/pendulum-${hz}`, async () => {
  const m = await modules(), L = 2, radius = 0.1, theta = 0.1, seconds = 6, world = await m.createWorld({step: 1 / hz, subSteps: SUB, ground: false});
  try {
    const definition = m.hangingCableDefinition({segments: 1, length: L, linearDensity: 0.05, tipMass: 0, axialRigidity: 1e6, config: cableConfig({dt: 1 / hz})});
    definition.positions[3] = L * Math.sin(theta); definition.positions[4] = -L * Math.cos(theta);
    const cable = new m.CompliantCableRuntime(definition), body = world.createBody({shape: {kind: 'sphere', radius}, position: [L * Math.sin(theta), -L * Math.cos(theta), 0], density: 2000, neverSleeps: true});
    const coupling = new m.StructureCoupling(world);
    coupling.attachCableToBody(cable, 1, body, {inertia: {kind: 'sphere', radius}});
    const sim = m.createSimulation(world).add(m.structureSubsystem(coupling, {bodies: [body]})), scale = world.getState(body).mass * G * L * (1 - Math.cos(theta));
    const start = sim.energy().balance; let previous = start, rise = 0;
    for (let i = 1; i <= seconds * hz; i++) { sim.step(); if (i % (hz / 4) === 0) { const e = sim.energy().balance; rise = Math.max(rise, e - previous); previous = e; } }
    return {loss: (start - previous) / scale, rise: rise / scale};
  } finally { world.dispose(); }
});

const midpointSolid = () => memo('simulation/midpoint-solid', async () => {
  const m = await modules(), world = await m.createWorld({step: DT, subSteps: SUB, ground: false});
  try {
    const solid = new m.SolidBody({mesh: m.boxMesh({size: [0.6, 0.1, 0.1], cells: [6, 1, 1]}), material: STEEL_SOLID, config: {dt: DT, integrator: 'midpoint', model: 'linear', gravity: [0, -G, 0]}});
    solid.constrain(solid.selectNodes(x => x === 0), [0, 0, 0]);
    const u = new Float64Array(3 * solid.nodeCount);
    for (let n = 0; n < solid.nodeCount; n++) u[3 * n] = 1e-5 * solid.referencePositions[3 * n] / 0.6;
    solid.setState(u);
    const heat = new m.HeatSolver({nx: 12, ny: 2, nz: 2, dx: 0.005, dy: 0.005, dz: 0.005, materials: [COPPER], temperature: 300, dt: DT, scheme: 'crank-nicolson',
      boundaries: [{face: 'x-', type: 'temperature', temperature: 400}, {face: 'x+', type: 'convection', coefficient: 500, ambient: 280}], sources: [{min: [5, 0, 0], max: [6, 1, 1], power: 20}]});
    const sim = m.createSimulation(world).add(m.solidSubsystem(solid)).add(m.heatSubsystem(heat)), entry = id => sim.energy().entries.find(e => e.id === id);
    const swing = entry('solid').parts.strain, solid0 = entry('solid').balance, heat0 = entry('heat').balance; let mechanical = 0, thermalChange = 0;
    for (let i = 0; i < 480; i++) {
      sim.step();
      if (i % 8) continue;
      mechanical = Math.max(mechanical, Math.abs(entry('solid').balance - solid0) / swing); thermalChange = Math.max(thermalChange, Math.abs(entry('heat').balance - heat0) / Math.abs(entry('heat').exchanged || 1));
    }
    return {mechanical, thermal: thermalChange};
  } finally { world.dispose(); }
});

// ---- Save and resume ----

const resume = (name, body, field) => memo(`simulation/resume-${name}`, async () => {
  const m = await modules(), scene = name === 'moored-buoy' ? m.mooredBuoyScene({offset: 0.4}) : m.cableStayedDeckScene(), original = await open(scene);
  let resumed = null;
  try {
    for (let i = 0; i < 240; i++) original.simulation.step();
    resumed = await open(m.decodeSceneLink(await m.encodeSceneLink(m.saveScene(original.world, original))));
    for (let i = 0; i < 240; i++) { original.simulation.step(); resumed.simulation.step(); }
    const a = original.world.getState(original.bodies.get(body)).position, b = resumed.world.getState(resumed.bodies.get(body)).position, fa = field(original), fb = field(resumed);
    let fieldDrift = 0; for (let i = 0; i < fa.length; i++) fieldDrift = Math.max(fieldDrift, Math.abs(fa[i] - fb[i]));
    return {body: Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), field: fieldDrift};
  } finally { original.world.dispose(); resumed?.world.dispose(); }
});
const resumeBuoy = () => resume('moored-buoy', 'buoy', l => l.water.get('basin').eta);
// ---- Moored spar (the water's force in the structure coupling's interface solve) ----
const MOORED = 'packages/box3d-kit/test/v17-moored.test.mjs';
const M = {
  rest: 'moored spar at rest: draught and tension against the closed form, with and without the water in the interface solve',
  heave: 'moored spar in heave: sqrt((rho g A + E A / L0) / (m + m_n)), with no added mass',
  large: 'a large step: the spar set at its equilibrium stays there; without the water in the interface solve it rings and settles off it',
};
const spar = (kind, options) => memo(`simulation/spar-${kind}-${JSON.stringify(options)}`, async () => {
  const m = await modules(), S = await import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/moored-scenarios.mjs')).href);
  return kind === 'rest' ? S.sparAtRest(m, options) : S.sparHeave(m, options);
});
const resumeDeck = () => resume('cable-stayed-deck', 'load', l => l.frames.get('deck').couplingViews().displacements);

const LINKED = 'The water\'s force is part of the body\'s free motion in the structure coupling\'s interface solve (linkWaterToStructure, which the scene loader calls). Before that link this row was off by the stated amount: the cable saw the buoy B dt^2 / m = 0.46 mm lower than it goes and carried its end node as if the buoy fell, m_n B / (m + m_n) = 0.73 N.';
export default defineCases('simulation', FILE, [
  {id: 'simulation.identity.water-structure', title: 'Moored buoy: Simulation of the scene file against the modules driven by hand', quantity: 'checkpoints (every 60 of 480 steps) at which the world hash or the water and cable bits differ', unit: '1', test: T.combined,
    reference: {formula: 'coupling.step(); water.step(); world.step() by hand: 0 differences', value: 0}, tolerance: absolute(0),
    note: 'Bit-identity is exact or it is not; the test file proves it for each adapter alone and for five solvers together.', measure: () => buoyIdentity()},
  {id: 'simulation.buoy.cable-force', title: 'Moored buoy at rest: force of the cable on the buoy', quantity: 'vertical force of the mooring on an 80.4 kg sphere, half-second mean', unit: 'N', test: T.rest,
    reference: {formula: 'F = rho g V_sub - m g', value: null}, tolerance: relative(1e-5), note: 'V_sub is the submerged volume the water coupling reports; the rigid solver holds mass and gravity in float32.',
    measure: async () => { const r = await buoyAtRest(); return {value: r.force, reference: r.net}; }},
  {id: 'simulation.buoy.tension', title: 'Moored buoy at rest: cable tension', quantity: 'tension of the one-segment mooring (EA = 5e4 N), half-second mean', unit: 'N', test: T.rest,
    reference: {formula: 'T = rho g V_sub - (m + m_n) g', value: null}, tolerance: relative(1e-5), note: LINKED + ' Was +0.729 N.',
    measure: async () => { const r = await buoyAtRest(); return {value: r.tension, reference: r.netWithNode}; }},
  {id: 'simulation.buoy.draught', title: 'Moored buoy at rest: draught', quantity: 'draught of the sphere (R = 0.4 m) against the closed-form equilibrium of cable stretch, level rise and cap volume', unit: 'm', test: T.rest,
    reference: {formula: 'E A s / L0 = rho g V(d) - (m + m_n) g, d = H + (V - V0) / A - (L0 + s - R)', value: null}, tolerance: absolute(5e-6), note: LINKED + ' Was -0.41 mm. Float32 resolves the height of the buoy to 2.4e-7 m.',
    measure: async () => { const r = await buoyAtRest(); return {value: r.draught, reference: r.closed.draught}; }},
  {id: 'simulation.buoy.tension-closed-form', title: 'Moored buoy at rest: tension against the closed-form equilibrium', quantity: 'cable tension against the root of the equilibrium equation', unit: 'N', test: T.rest,
    reference: {formula: 'T = E A s / L0 at the root s', value: null}, tolerance: relative(1e-5), note: 'Was -6.8e-4 before the water\'s force was in the interface solve.',
    measure: async () => { const r = await buoyAtRest(); return {value: r.tension, reference: r.closed.tension}; }},
  {id: 'simulation.buoy.vertical-balance', title: 'Moored buoy at rest: the floor and the anchor carry the total weight', quantity: 'hydrostatic floor load minus the anchor pull', unit: 'N', test: T.rest,
    reference: {formula: 'rho g sum((H + eta) dA) - R_anchor = (m_water + m + m_cable) g', value: null}, tolerance: absolute(0.02), note: 'On 1.88 MN. Was -0.73 N before the water\'s force was in the interface solve.',
    measure: async () => { const r = await buoyAtRest(); return {value: r.ground, reference: r.total}; }},
  {id: 'simulation.spar.tension', title: 'Moored spar at rest, 30 Hz: tether tension', quantity: 'tension of a 1000 N/m tether holding a 32 kg spar (0.2 m x 0.2 m x 2 m) under its free waterline, at a step of 1/30 s', unit: 'N', test: M.rest, file: MOORED,
    reference: {formula: 'buoyancy - weight = tension: rho g A d - (m + m_n) g = (E A / L0) s with d = level - L0 - s', value: null}, tolerance: relative(5e-6), note: 'The same 4e-7 at 240, 60 and 30 Hz. Without the water in the interface solve: -2.2% at 30 Hz, -0.46% at 60 Hz, +0.09% at 240 Hz.',
    measure: async () => { const r = await spar('rest', {hz: 30}); return {value: r.tension, reference: r.exactTension}; }},
  {id: 'simulation.spar.draught', title: 'Moored spar at rest, 30 Hz: draught', quantity: 'draught of the spar against the closed-form equilibrium', unit: 'm', test: M.rest, file: MOORED,
    reference: {formula: 'd from the same equation', value: null}, tolerance: absolute(1e-6), note: 'Float32 resolves the spar\'s height to 2.4e-7 m.',
    measure: async () => { const r = await spar('rest', {hz: 30}); return {value: r.draught, reference: r.exactDraught}; }},
  {id: 'simulation.spar.draught-before', title: 'The same without the water in the interface solve', quantity: 'draught error at 30 Hz with the link left out, over B dt^2 / m = 18.5 mm', unit: '1', test: M.rest, file: MOORED,
    reference: {formula: 'the cable\'s end is placed where the spar would go under gravity alone: error of the order of -B dt^2 / m', value: -1}, tolerance: absolute(0.5),
    note: 'What the link removes, kept as a measurement: -13.6 mm at 30 Hz, -3.6 mm at 60 Hz, -0.50 mm at 240 Hz. Not an accuracy claim.',
    measure: async () => { const r = await spar('rest', {hz: 30, linked: false}); return r.draughtError / r.lag; }},
  {id: 'simulation.spar.heave', title: 'Moored spar in heave', quantity: 'frequency of the spar on its taut tether, no drag, 240 Hz, 8 s', unit: 'Hz', test: M.heave, file: MOORED,
    reference: {formula: 'f = sqrt((rho g A + E A / L0) / (m + m_n)) / (2 pi), no added mass', value: null}, tolerance: relative(0.01),
    note: 'The coupling has no added mass, and neither has the reference. The model\'s water answers the spar\'s volume source (a local rise, radiated waves), which the closed form leaves out; -1.0% at 60 Hz. The tether alone would give 0.889 Hz.',
    measure: async () => { const r = await spar('heave', {hz: 240, seconds: 8}); return {value: r.frequency, reference: r.exact}; }},
  {id: 'simulation.spar.still', title: 'Moored spar set at its equilibrium, 30 Hz', quantity: 'largest swing in 8 s of a spar started at the closed-form equilibrium, at a step of 1/30 s', unit: 'm', test: M.large, file: MOORED,
    reference: {formula: 'no motion', value: 0}, tolerance: upper(3e-7), note: 'Without the water in the interface solve it swings 12.3 mm and settles 13.6 mm off (0.49 mm and 0.50 mm at 240 Hz).',
    measure: async () => (await spar('heave', {hz: 30, kick: 0, seconds: 8})).first},
  {id: 'simulation.buoy.return', title: 'Moored buoy released 0.4 m to the side: where it ends', quantity: 'distance from the anchor line after 24 s (linear drag 200 N s/m, bottom friction 0.5 /s)', unit: 'm', test: T.release,
    reference: {formula: 'x = 0', value: 0}, tolerance: absolute(2e-3), note: 'What the sloshing it started still moves it by; 0.5% of the offset.', measure: async () => (await buoyRun(0.4)).x},
  {id: 'simulation.buoy.rest-height', title: 'Moored buoy released 0.4 m to the side: rest height', quantity: 'height of the buoy after 24 s against the run started on the anchor line', unit: 'm', test: T.release,
    reference: {formula: 'y = y_rest', value: null}, tolerance: absolute(2e-4), measure: async () => ({value: (await buoyRun(0.4)).y, reference: (await buoyRun(0)).y})},
  {id: 'simulation.buoy.bounded', title: 'Moored buoy released 0.4 m to the side: bounded', quantity: 'largest distance from the anchor line during 24 s', unit: 'm', test: T.release,
    reference: {formula: 'max x <= x(0) = 0.4', value: 0.4}, tolerance: upper(4e-7), measure: async () => (await buoyRun(0.4)).far},
  {id: 'simulation.energy.drag', title: 'Energy ledger with drag: never above its start beyond the sampling offset', quantity: 'largest excess of the ledger above its first value, as a fraction of rho g V v_max dt', unit: '1', test: T.release,
    reference: {formula: '(max E - E_1) / (rho g V v_max dt) <= 1', value: 1}, tolerance: upper(0), note: 'The ledger\'s terms are known half a step apart; the ledger fell 49.7 J in the run.', measure: async () => { const r = await buoyRun(0.4); return r.excess / r.bound; }},
  {id: 'simulation.deck.tension', title: 'Cable-stayed deck scene: stay tensions', quantity: 'worst relative error of the two stay tensions with the ball on deck nodes 1, 3, 4, 5 and 7', unit: '1', test: T.deck,
    reference: {formula: 'flexibility method: |T / T_hand - 1| = 0', value: 0}, tolerance: absolute(2e-4), note: 'The hand solution linearises the stay geometry (3e-4 of the stretch at most).', measure: async () => (await deck()).tension},
  {id: 'simulation.deck.deflection', title: 'Cable-stayed deck scene: deflection under the load', quantity: 'worst relative error of the deck deflection under the ball over 5 positions', unit: '1', test: T.deck,
    reference: {formula: 'flexibility method: |u / u_hand - 1| = 0', value: 0}, tolerance: absolute(2e-4), measure: async () => (await deck()).deflection},
  {id: 'simulation.deck.reaction', title: 'Cable-stayed deck scene: total vertical reaction', quantity: 'worst relative error of the summed support and tower reactions over 5 positions', unit: '1', test: T.deck,
    reference: {formula: '|sum R / (total weight) - 1| = 0', value: 0}, tolerance: absolute(5e-5), measure: async () => (await deck()).reaction},
  {id: 'simulation.deck.share-link', title: 'Cable-stayed deck scene: the same from a share link', quantity: 'links (one compressed, one stored) whose run differs in any bit of the world hash, the fields or the measured numbers', unit: '1', test: T.deck,
    reference: {formula: 'decodeSceneLink(encodeSceneLink(scene)): 0 differences', value: 0}, tolerance: absolute(0), measure: async () => (await deck()).different},
  {id: 'simulation.thermal.free-expansion', title: 'Heat to solid: a free block grows by alpha dT', quantity: 'strain of a steel block 12.5 x 10 x 7.5 mm heated 80 K by the heat solver, from its far corner', unit: '1', test: T.thermal,
    reference: {formula: 'u / x = alpha dT', value: 12e-6 * 80}, tolerance: relative(1e-9), note: 'A uniform state is in the element space: only the solvers\' tolerances are left.', measure: async () => (await thermal()).growth},
  {id: 'simulation.thermal.free-stress', title: 'Heat to solid: a free block stays stress-free', quantity: 'largest stress component in the block, as a fraction of E alpha dT', unit: '1', test: T.thermal,
    reference: {formula: 'sigma = 0', value: 0}, tolerance: absolute(1e-9), measure: async () => (await thermal()).freeStress},
  {id: 'simulation.thermal.restrained-stress', title: 'Heat to solid: a bar held at both ends', quantity: 'axial stress of a 20 mm steel bar (linear model) once the heat solver has brought it from 300 K to 380 K', unit: 'Pa', test: T.thermal,
    reference: {formula: 'sigma = -E alpha dT', value: -200e9 * 12e-6 * 80}, tolerance: relative(1e-9), note: 'The link is one-way: the solid does not act on the temperature.', measure: async () => (await thermal()).barStress},
  {id: 'simulation.dead-load.shortening', title: 'Rigid weight on a solid: shortening', quantity: 'shortening of a 0.2 m steel block (A = 0.01 m^2) under a 62.8 kg resting body', unit: 'm', test: T.dead,
    reference: {formula: 'u = m g L / (E A)', value: null}, tolerance: relative(1e-8), note: 'One-way: the weight is a dead load, and the body does not feel the block.',
    measure: async () => { const r = await deadLoad(); return {value: r.shortening, reference: r.expectedShortening}; }},
  {id: 'simulation.dead-load.stress', title: 'Rigid weight on a solid: stress', quantity: 'vertical stress in the block', unit: 'Pa', test: T.dead,
    reference: {formula: 'sigma = -m g / A', value: null}, tolerance: relative(1e-8), measure: async () => { const r = await deadLoad(); return {value: r.stress, reference: r.expectedStress}; }},
  {id: 'simulation.energy.solid', title: 'Energy ledger: a midpoint, linear solid', quantity: 'largest relative change of the solid entry over 480 steps', unit: '1', test: T.energy,
    reference: {formula: 'E_kinetic + E_strain + E_load = constant', value: 0}, tolerance: upper(1e-10), measure: async () => (await midpointSolid()).mechanical},
  {id: 'simulation.energy.heat', title: 'Energy ledger: heat with a fixed face, a film and a source', quantity: 'largest change of stored energy minus the heat exchanged, as a fraction of the heat exchanged', unit: '1', test: T.energy,
    reference: {formula: 'E_stored - sum(boundary heat) - source heat = constant', value: 0}, tolerance: upper(1e-10), measure: async () => (await midpointSolid()).thermal},
  {id: 'simulation.energy.pendulum-rise', title: 'Energy ledger: a pendulum on a cable never gains', quantity: 'largest rise of the ledger between quarter-second samples over 6 s, as a fraction of the swing energy', unit: '1', test: T.energy,
    reference: {formula: 'E(t + 0.25 s) - E(t) <= 0', value: 0}, tolerance: upper(1e-4), note: 'The bound is float32 noise of the body state.', measure: async () => Math.max((await pendulum(240)).rise, (await pendulum(480)).rise)},
  {id: 'simulation.energy.pendulum-order', title: 'Energy ledger: the cable step is first order', quantity: 'energy lost in 6 s at 240 Hz divided by the loss at 480 Hz', unit: '1', test: T.energy,
    reference: {formula: 'loss(dt) / loss(dt / 2) = 2', value: 2}, tolerance: absolute(0.3), note: 'Implicit Euler damps the swing at (n + 1) / (4 n) omega^2 dt per second for n rigid sub-steps.',
    measure: async () => (await pendulum(240)).loss / (await pendulum(480)).loss},
  {id: 'simulation.resume.buoy', title: 'Save and resume, moored buoy: body', quantity: 'distance between the buoy of a run saved at tick 240 and resumed, and the original, 240 ticks later', unit: 'm', test: T.resume,
    reference: {formula: 'bit-exact continuation: 0', value: 0}, tolerance: upper(1e-4), note: 'A save does not carry the coupling\'s impulses, the cable multipliers or the last step\'s displaced volume.', measure: async () => (await resumeBuoy()).body},
  {id: 'simulation.resume.buoy-water', title: 'Save and resume, moored buoy: water', quantity: 'largest difference of the surface elevation, same runs (waves 2.3 mm high)', unit: 'm', test: T.resume,
    reference: {formula: 'bit-exact continuation: 0', value: 0}, tolerance: upper(4e-4), measure: async () => (await resumeBuoy()).field},
  {id: 'simulation.resume.deck', title: 'Save and resume, cable-stayed deck: deck', quantity: 'largest difference of a deck displacement between a resumed run and the original, 240 ticks after the save', unit: 'm', test: T.resume,
    reference: {formula: 'bit-exact continuation: 0', value: 0}, tolerance: upper(4e-6), note: 'The saved velocity of a body on a frame lacks the closing half of the last frame impulse (g dt / 2 = 0.02 m/s).', measure: async () => (await resumeDeck()).field},
]);
