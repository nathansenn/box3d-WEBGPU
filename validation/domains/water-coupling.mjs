// Rigid bodies <-> water (box3d-webgpu-kit/coupling), against closed-form hydrostatics and dynamics.
// Set-ups are those of packages/box3d-kit/test/v09-coupling.test.mjs: SI units, 240 Hz, 4 sub-steps.
import {kit, memo, defineCases, relative, absolute, upper, meanPeriod} from '../lib.mjs';

const G = 9.81, RHO = 1000, HZ = 240, SUB = 4, DT = 1 / HZ;
const FILE = 'packages/box3d-kit/test/v09-coupling.test.mjs';
const T = {
  float: 'Archimedes: a box, a sphere and a capsule float with submerged fraction rho_b / rho_w',
  sink: 'Archimedes: a body denser than water sinks to the basin floor and stays fully submerged',
  volume: 'volume: water + displaced volume is constant while a body is lowered in and bobs, and the level rises by V / A',
  balance: 'balances: floor load = water weight + buoyancy, and horizontal impulse on bodies = - impulse on the water',
  heave: 'heave: a floating spar oscillates with T = 2 pi sqrt(m / (rho_w g A_waterplane))',
  terminal: 'terminal velocity: a sinking sphere settles where weight - buoyancy = quadratic drag',
  energy: 'reaction: a dropped body makes waves, and body + water energy never exceeds the initial energy',
  righting: 'righting torque: a heeled box feels rho g V GZ (wall-sided formula) and returns upright',
  closed: 'the coupled water is the closed-basin solver: without bodies it matches stepClosedWaterCpu',
};

/** A square basin centred on the world origin with its floor at y = 0. `floor` adds a static slab under it. */
async function scene({cells, cell, depth, floor = false, waterDrag = 0, hz = HZ}) {
  const [{createWorld}, {WaterCoupling}] = await Promise.all([kit('index'), kit('coupling')]);
  const world = await createWorld({step: 1 / hz, subSteps: SUB, ground: false});
  const side = cells * cell;
  if (floor) world.createBody({shape: {kind: 'box', halfExtents: [side / 2, 0.5, side / 2]}, type: 'static', position: [0, -0.5, 0]});
  const water = new WaterCoupling(world, {cols: cells, rows: cells, dx: cell, dz: cell, restDepth: depth, origin: [-side / 2, 0, -side / 2], waterDrag});
  return {world, water, area: side * side, depth, hz};
}
/** The documented order: coupling first, then the rigid step. */
function run({world, water, hz}, seconds, each) {
  const steps = Math.round(seconds * hz);
  for (let i = 1; i <= steps; i++) { water.step(); world.step(); if (each) each(i); }
}
const add = ({world, water}, shape, body, options) => {
  const handle = world.createBody({shape, ...body});
  return {handle, shape, report: water.attach(handle, shape, options)};
};
/** Height h of the spherical cap that holds `fraction` of a sphere of radius r: h^2 (3r - h) = 4 fraction r^3. */
function capHeight(r, fraction) {
  let lo = 0, hi = 2 * r;
  for (let i = 0; i < 200; i++) { const h = (lo + hi) / 2; if (h * h * (3 * r - h) < 4 * fraction * r ** 3) lo = h; else hi = h; }
  return (lo + hi) / 2;
}

const floating = () => memo('water/floating', async () => {
  const s = await scene({cells: 32, cell: 0.5, depth: 2, waterDrag: 0.5});
  try {
    const box = add(s, {kind: 'box', halfExtents: [0.5, 0.3, 0.5]}, {position: [-4, 2.05, -4], density: 600}, {linearDrag: 400});
    const ball = add(s, {kind: 'sphere', radius: 0.4}, {position: [4, 2.2, -4], density: 300}, {linearDrag: 400});
    const pill = add(s, {kind: 'capsule', radius: 0.25, halfLength: 0.5}, {position: [0, 2.1, 4], density: 500, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2]}, {linearDrag: 400});
    run(s, 30);
    const level = body => s.depth + s.water.elevationAt(...[0, 2].map(i => s.world.getState(body.handle).position[i]));
    const boxState = s.world.getState(box.handle);
    return {
      fractions: [box, ball, pill].map(body => body.report.submergedFraction),
      buoyancy: box.report.buoyancy[1], weight: boxState.mass * G,
      boxDraught: level(box) - (boxState.position[1] - 0.3),
      ballDraught: level(ball) - (s.world.getState(ball.handle).position[1] - 0.4),
      pillAxis: s.world.getState(pill.handle).position[1] - level(pill),
    };
  } finally { s.world.dispose(); }
});

const sunk = () => memo('water/sunk', async () => {
  const s = await scene({cells: 16, cell: 0.5, depth: 2, floor: true});
  try {
    const half = 0.3, volume = (2 * half) ** 3;
    const brick = add(s, {kind: 'box', halfExtents: [half, half, half]}, {position: [0, 2.6, 0], density: 2500});
    run(s, 8);
    return {rest: s.world.getState(brick.handle).position[1], rise: s.water.meanElevation(), expectedRise: volume / s.area,
      buoyancy: brick.report.buoyancy[1], expectedBuoyancy: RHO * s.water.gravity() * volume};
  } finally { s.world.dispose(); }
});

const lowered = () => memo('water/volume', async () => {
  const s = await scene({cells: 32, cell: 0.5, depth: 2, waterDrag: 0.5});
  try {
    const float = add(s, {kind: 'box', halfExtents: [0.6, 0.4, 0.6]}, {position: [0, 3.2, 0], density: 550}, {linearDrag: 3000});
    const initial = s.water.waterVolume();
    let worst = 0;
    run(s, 30, () => { worst = Math.max(worst, Math.abs(s.water.waterVolume() - initial)); });
    const mass = s.world.getState(float.handle).mass;
    const level = s.water.meanElevation(), expectedLevel = mass / (RHO * s.area);
    const radius = 0.5, ball = add(s, {kind: 'sphere', radius}, {position: [5, 2.6, 5], type: 'kinematic'});
    s.world.setVelocity(ball.handle, [0, -0.5, 0]);
    run(s, 3);
    s.world.setVelocity(ball.handle, [0, 0, 0]);
    run(s, 1);
    return {drift: worst / initial, level, expectedLevel, plunger: ball.report.submergedVolume};
  } finally { s.world.dispose(); }
});

const balances = () => memo('water/balances', async () => {
  const s = await scene({cells: 32, cell: 0.5, depth: 2});
  try {
    add(s, {kind: 'box', halfExtents: [0.5, 0.25, 0.5]}, {position: [-3, 2.4, 0], density: 500});
    add(s, {kind: 'sphere', radius: 0.35}, {position: [3, 1.2, 1], density: 900, linearVelocity: [2, 0, -1]});
    const {water} = s, initial = s.area * s.depth;
    let vertical = 0, horizontal = 0;
    run(s, 4, () => {
      const excess = water.floorLoad() - RHO * water.gravity() * water.waterVolume();
      vertical = Math.max(vertical, Math.abs(excess - water.buoyancyTotal()) / (RHO * G * initial));
      horizontal = Math.max(horizontal, Math.abs(water.stepImpulseOnBodies[0] + water.stepImpulseOnWater[0]), Math.abs(water.stepImpulseOnBodies[2] + water.stepImpulseOnWater[1]));
    });
    return {vertical, horizontal};
  } finally { s.world.dispose(); }
});

const heave = () => memo('water/heave', async () => {
  const s = await scene({cells: 64, cell: 0.5, depth: 4});
  try {
    const half = [0.25, 2, 0.25], density = 600, amplitude = 0.1;
    const rest = s.depth - 2 * half[1] * density / RHO + half[1];
    const spar = add(s, {kind: 'box', halfExtents: half}, {position: [0, rest + amplitude, 0], density, lockRotation: true}, {dragCoefficient: 0});
    const mass = s.world.getState(spar.handle).mass, exact = 2 * Math.PI * Math.sqrt(mass / (RHO * G * 4 * half[0] * half[2]));
    const crossings = [];
    let previous = amplitude;
    run(s, 14, i => {
      const y = s.world.getState(spar.handle).position[1] - rest - s.water.meanElevation();
      if (previous > 0 && y <= 0) crossings.push((i - 1 + previous / (previous - y)) / HZ);
      previous = y;
    });
    return {period: meanPeriod(crossings), exact};
  } finally { s.world.dispose(); }
});

const terminal = () => memo('water/terminal', async () => {
  const s = await scene({cells: 16, cell: 1, depth: 6});
  try {
    const radius = 0.1, volume = 4 / 3 * Math.PI * radius ** 3;
    const ball = add(s, {kind: 'sphere', radius}, {position: [0, 5.5, 0], density: 1100});
    const mass = s.world.getState(ball.handle).mass;
    run(s, 4.5);
    return {speed: -s.world.getState(ball.handle).linearVelocity[1], exact: Math.sqrt(2 * (mass - RHO * volume) * G / (RHO * 0.47 * Math.PI * radius * radius))};
  } finally { s.world.dispose(); }
});

/** A 0.4 m sphere of density 500 falls 1.5 m into a 16 m x 16 m x 2 m basin; E = body + water energy. */
const dropRun = (hz, options, key) => memo(`water/drop/${key}`, async () => {
  const radius = 0.4, drop = 1.5;
  const s = await scene({cells: 32, cell: 0.5, depth: 2, hz});
  try {
    const ball = add(s, {kind: 'sphere', radius}, {position: [0, s.depth + radius + drop, 0], density: 500, lockRotation: true}, options);
    const mass = s.world.getState(ball.handle).mass, g = s.water.gravity();
    const energy = () => {
      const state = s.world.getState(ball.handle), v = state.linearVelocity;
      return 0.5 * mass * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + mass * g * state.position[1] + s.water.waterKineticEnergy() + s.water.waterPotentialEnergy();
    };
    const initial = energy(), result = {scale: mass * g * drop, excess: -Infinity, deficit: 0, final: 0};
    run(s, 8, () => {
      result.final = energy() - initial;
      result.excess = Math.max(result.excess, result.final);
      result.deficit = Math.min(result.deficit, result.final);
    });
    return result;
  } finally { s.world.dispose(); }
});

const HEEL = {half: [0.5, 0.15, 0.5], density: 500};
const tilt = angle => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
const heelAngle = state => { const [x, y, z, w] = state.rotation; return Math.atan2(2 * (z * w - x * y), 1 - 2 * (x * x + z * z)); };
const stability = () => {
  const width = 2 * HEEL.half[0], height = 2 * HEEL.half[1], draught = height * HEEL.density / RHO, BM = width * width / (12 * draught);
  return {width, height, draught, BM, GM: BM - (height - draught) / 2};
};

const righting = () => memo('water/righting', async () => {
  const s = await scene({cells: 16, cell: 0.5, depth: 2});
  try {
    const {width, draught, BM, GM} = stability(), angle = 0.1;
    const box = add(s, {kind: 'box', halfExtents: HEEL.half}, {position: [0, s.depth, 0], density: HEEL.density, rotation: tilt(angle)});
    s.water.step();
    const state = s.world.getState(box.handle), r = [0, 1, 2].map(i => box.report.centre[i] - state.position[i]);
    const GZ = Math.sin(angle) * (GM + 0.5 * BM * Math.tan(angle) ** 2);
    return {torque: r[0] * box.report.buoyancy[1] - r[1] * box.report.buoyancy[0], exact: -RHO * G * (width * width * draught) * GZ};
  } finally { s.world.dispose(); }
});

const roll = () => memo('water/roll', async () => {
  const s = await scene({cells: 32, cell: 0.5, depth: 2});
  try {
    const {width, height, draught, GM} = stability();
    const box = add(s, {kind: 'box', halfExtents: HEEL.half}, {position: [0, s.depth, 0], density: HEEL.density, rotation: tilt(0.05)}, {dragCoefficient: 0});
    const mass = s.world.getState(box.handle).mass;
    const crossings = [];
    let previous = 0.05;
    run(s, 8, i => {
      const angle = heelAngle(s.world.getState(box.handle));
      if (previous > 0 && angle <= 0) crossings.push((i - 1 + previous / (previous - angle)) / HZ);
      previous = angle;
    });
    return {period: meanPeriod(crossings), exact: 2 * Math.PI * Math.sqrt(mass * (width * width + height * height) / 12 / (RHO * G * width * width * draught * GM))};
  } finally { s.world.dispose(); }
});

const closedBasin = () => memo('water/closed-basin', async () => {
  const [{WaterCoupling}, {createClosedWaterArrays, stepClosedWaterCpu}] = await Promise.all([kit('coupling'), kit('water')]);
  const cells = 24, eta = new Float32Array(cells * cells);
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) eta[z * cells + x] = 0.03 * Math.cos(2 * Math.PI * (x + 0.5) / cells) * Math.cos(Math.PI * (z + 0.5) / cells);
  const world = {gravity: () => [0, -G, 0], getState() { throw new Error('unused'); }, applyForce() {}, applyTorque() {}, loop: {step: DT}};
  const water = new WaterCoupling(world, {cols: cells, rows: cells, dx: 0.5, dz: 0.5, restDepth: 1.5, origin: [0, 0, 0], waterDrag: 0.28, eta});
  const config = water.waterConfig(), reference = createClosedWaterArrays(config, {eta});
  for (let i = 0; i < 960; i++) { water.step(); stepClosedWaterCpu(reference, config); }
  let worst = 0;
  for (let i = 0; i < eta.length; i++) worst = Math.max(worst, Math.abs(water.eta[i] - reference.eta[i]));
  return worst;
});

const BM = stability();
export default defineCases('water-coupling', FILE, [
  {id: 'water.archimedes.box', title: 'Archimedes: floating box', quantity: 'submerged fraction of a box of density 600 kg/m^3 after 30 s', unit: '1', test: T.float,
    reference: {formula: 'V_sub / V = rho_b / rho_w', value: 0.6}, tolerance: absolute(1e-4), note: 'The submerged volume is exact geometry; what is left is the residual bobbing.',
    measure: async () => (await floating()).fractions[0]},
  {id: 'water.archimedes.sphere', title: 'Archimedes: floating sphere', quantity: 'submerged fraction of a sphere of density 300 kg/m^3', unit: '1', test: T.float,
    reference: {formula: 'V_sub / V = rho_b / rho_w', value: 0.3}, tolerance: absolute(1e-4), measure: async () => (await floating()).fractions[1]},
  {id: 'water.archimedes.capsule', title: 'Archimedes: floating capsule', quantity: 'submerged fraction of a horizontal capsule of density 500 kg/m^3', unit: '1', test: T.float,
    reference: {formula: 'V_sub / V = rho_b / rho_w', value: 0.5}, tolerance: absolute(1e-4), measure: async () => (await floating()).fractions[2]},
  {id: 'water.archimedes.buoyancy', title: 'Archimedes: buoyancy carries the weight', quantity: 'buoyant force on the floating box', unit: 'N', test: T.float,
    reference: {formula: 'F_b = m g', value: 600 * 0.6 * G}, tolerance: relative(1e-4),
    measure: async () => { const r = await floating(); return {value: r.buoyancy, reference: r.weight}; }},
  {id: 'water.draught.box', title: 'Draught of the floating box', quantity: 'depth of the box bottom below the local water level', unit: 'm', test: T.float,
    reference: {formula: 'd = (rho_b / rho_w) h', value: 0.6 * 0.6}, tolerance: absolute(1e-3), measure: async () => (await floating()).boxDraught},
  {id: 'water.draught.sphere', title: 'Draught of the floating sphere', quantity: 'depth of the sphere bottom below the local water level', unit: 'm', test: T.float,
    reference: {formula: 'h^2 (3 r - h) = 4 (rho_b / rho_w) r^3', value: capHeight(0.4, 0.3)}, tolerance: absolute(1e-3), measure: async () => (await floating()).ballDraught},
  {id: 'water.draught.capsule', title: 'Half-density capsule floats on its axis', quantity: 'height of the capsule axis above the local water level', unit: 'm', test: T.float,
    reference: {formula: 'y_axis - y_water = 0 at rho_b = rho_w / 2', value: 0}, tolerance: absolute(1e-3), measure: async () => (await floating()).pillAxis},
  {id: 'water.sunk.level-rise', title: 'Sunk body: the level rises by V / A', quantity: 'mean water level after a 0.6 m brick sinks in an 8 m x 8 m basin', unit: 'm', test: T.sink,
    reference: {formula: 'eta_mean = V / A', value: 0.216 / 64}, tolerance: absolute(1e-12), note: 'An identity of the volume source, to float64 round-off.',
    measure: async () => { const r = await sunk(); return {value: r.rise, reference: r.expectedRise}; }},
  {id: 'water.sunk.buoyancy', title: 'Sunk body: buoyancy of the whole volume', quantity: 'buoyant force on the brick resting on the floor', unit: 'N', test: T.sink,
    reference: {formula: 'F_b = rho_w g V', value: RHO * G * 0.216}, tolerance: relative(1e-12),
    measure: async () => { const r = await sunk(); return {value: r.buoyancy, reference: r.expectedBuoyancy}; }},
  {id: 'water.sunk.rest-height', title: 'Sunk body: rests on the basin floor', quantity: 'centre height of the 0.6 m brick at rest', unit: 'm', test: T.sink,
    reference: {formula: 'y = a / 2', value: 0.3}, tolerance: absolute(0.006), note: 'Box3D contact slop (5 mm) plus 1 mm.', measure: async () => (await sunk()).rest},
  {id: 'water.volume.conservation', title: 'Volume conservation', quantity: 'largest relative change of the water volume while a body drops in and bobs for 30 s', unit: '1', test: T.volume,
    reference: {formula: '|V(t) - V(0)| / V(0) = 0', value: 0}, tolerance: absolute(1e-12), note: '512 m^3 summed over 1024 cells in float64: one ulp of the total is 2e-16 relative.',
    measure: async () => (await lowered()).drift},
  {id: 'water.volume.bathtub', title: 'Bathtub rise of a floating body', quantity: 'mean water level with a 396 kg box afloat in a 16 m x 16 m basin', unit: 'm', test: T.volume,
    reference: {formula: 'eta_mean = m / (rho_w A)', value: 550 * 1.2 * 0.8 * 1.2 / (RHO * 256)}, tolerance: relative(1e-4),
    measure: async () => { const r = await lowered(); return {value: r.level, reference: r.expectedLevel}; }},
  {id: 'water.volume.plunger', title: 'A plunged sphere displaces its volume', quantity: 'displaced volume of a kinematic sphere pushed fully under', unit: 'm^3', test: T.volume,
    reference: {formula: 'V = (4/3) pi r^3', value: 4 / 3 * Math.PI * 0.125}, tolerance: relative(1e-12), measure: async () => (await lowered()).plunger},
  {id: 'water.balance.vertical', title: 'Vertical force balance', quantity: 'largest mismatch of floor load - water weight - buoyancy, as a fraction of the water weight', unit: '1', test: T.balance,
    reference: {formula: '(F_floor - rho g V_w - F_b) / (rho g V_0) = 0', value: 0}, tolerance: absolute(1e-12), measure: async () => (await balances()).vertical},
  {id: 'water.balance.horizontal', title: 'Horizontal impulse pair', quantity: 'largest per-step sum of the impulse on bodies and the impulse on the water', unit: 'N s', test: T.balance,
    reference: {formula: 'J_bodies + J_water = 0', value: 0}, tolerance: absolute(1e-9), measure: async () => (await balances()).horizontal},
  {id: 'water.heave.period', title: 'Heave period of a spar', quantity: 'period of a 0.5 m x 0.5 m x 4 m spar bobbing in 4 m of water, mean over 14 s', unit: 's', test: T.heave,
    reference: {formula: 'T = 2 pi sqrt(m / (rho_w g A_wp))', value: 2 * Math.PI * Math.sqrt(600 / (RHO * G * 0.25))}, tolerance: relative(0.01),
    note: 'The closed form has no added mass and no wave radiation; the water here does answer the spar, which bounds the agreement at the per-cent level.',
    measure: async () => { const r = await heave(); return {value: r.period, reference: r.exact}; }},
  {id: 'water.terminal-velocity', title: 'Terminal velocity of a sinking sphere', quantity: 'sinking speed of a 0.1 m sphere of density 1100 kg/m^3 after 4.5 s', unit: 'm/s', test: T.terminal,
    reference: {formula: 'v_t = sqrt(2 (m - rho_w V) g / (rho_w C_d pi r^2)), C_d = 0.47', value: Math.sqrt(2 * 100 * 4 / 3 * Math.PI * 1e-3 * G / (RHO * 0.47 * Math.PI * 0.01))}, tolerance: relative(1e-3),
    note: 'Drag is a model with a set coefficient, not a flow solution: this checks the force balance, not C_d.',
    measure: async () => { const r = await terminal(); return {value: r.speed, reference: r.exact}; }},
  {id: 'water.righting-torque', title: 'Righting torque of a heeled box', quantity: 'buoyancy torque on a box heeled 0.1 rad about its waterline', unit: 'N m', test: T.righting,
    reference: {formula: 'M = -rho g V sin(theta) (GM + BM tan^2(theta) / 2)', value: -RHO * G * BM.draught * Math.sin(0.1) * (BM.GM + 0.5 * BM.BM * Math.tan(0.1) ** 2)}, tolerance: relative(1e-5),
    note: 'Wall-sided formula; the clipped volume is exact, so only the float32 pose remains.',
    measure: async () => { const r = await righting(); return {value: r.torque, reference: r.exact}; }},
  {id: 'water.roll.period', title: 'Roll period of a floating box', quantity: 'roll period at 0.05 rad with drag off, mean over 8 s', unit: 's', test: T.righting,
    reference: {formula: 'T = 2 pi sqrt(I / (rho g V GM)), I = m (w^2 + h^2) / 12', value: 2 * Math.PI * Math.sqrt(150 * (1 + 0.09) / 12 / (RHO * G * BM.draught * BM.GM))}, tolerance: relative(0.01),
    measure: async () => { const r = await roll(); return {value: r.period, reference: r.exact}; }},
  {id: 'water.energy.never-created', title: 'Energy is never created (default drag)', quantity: 'largest rise of body + water energy above its start while a sphere drops 1.5 m into the basin', unit: 'J', test: T.energy,
    reference: {formula: 'max(E(t) - E(0)) <= 0', value: 0}, tolerance: upper(0), measure: async () => (await dropRun(HZ, {}, 'damped')).excess},
  {id: 'water.energy.order', title: 'Energy exchange error is first order in dt (drag off)', quantity: 'ratio of the largest energy excess at 240 Hz to that at 480 Hz', unit: '1', test: T.energy,
    reference: {formula: 'excess(dt) / excess(dt / 2) = 2', value: 2}, tolerance: absolute(0.2),
    note: 'With drag off the excess comes from sampling the energy terms half a step apart; it halves with the step.',
    measure: async () => (await dropRun(HZ, {dragCoefficient: 0}, 'coarse')).excess / (await dropRun(2 * HZ, {dragCoefficient: 0}, 'fine')).excess},
  {id: 'water.closed-basin.match', title: 'Coupled water without bodies is the closed-basin solver', quantity: 'largest difference between the float64 coupled water and the float32 closed-basin reference after 960 steps', unit: 'm', test: T.closed,
    reference: {formula: 'max |eta_64 - eta_32| = 0', value: 0}, tolerance: absolute(1e-5), note: 'The reference stores float32: 960 steps of rounding at 0.03 m amplitude.',
    measure: closedBasin},
]);
