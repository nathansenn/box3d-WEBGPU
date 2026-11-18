// Heat conduction in solids (src/engine/heat.ts), against closed-form solutions.
// Set-ups are those of tests/engine/heat.test.mjs. SI units, kelvin.
import {engine, memo, defineCases, relative, absolute, upper, order, erf} from '../lib.mjs';

const FILE = 'tests/engine/heat.test.mjs';
const T = {
  slab: 'steady slab with fixed end temperatures: linear profile and flux k dT / L',
  composite: 'composite walls of two and three materials: interface temperatures and flux from the resistances',
  source: 'steady slab with a uniform source: the parabola, second order, with the predicted offset',
  convection: 'convection boundary: flux = dT / (L/k + 1/h_c), and the surface temperature',
  kirchhoff: 'temperature-dependent conductivity: the Kirchhoff flux, second order',
  erfc: 'semi-infinite solid with a sudden surface temperature: the erfc solution at the order of each scheme',
  series: 'slab cooling with fixed-temperature faces: the Fourier series and the first-mode decay rate',
  lumped: 'lumped-capacitance cooling of a small-Biot block: T = T_inf + (T0 - T_inf) exp(-h A t / (rho c V))',
  plate: '2-D steady plate with one hot edge: the series solution at the centre, second order',
  radiation: 'radiation: a thin plate radiating to cold surroundings matches the lumped ODE',
  audit: 'energy audit: stored-energy change equals boundary heat plus sources for the implicit schemes',
  explicit: 'explicit scheme: stable at its limit, refused above it',
  stress: 'thermal stress: restrained bar and plate, and a quenched slab cracks from the surface inwards',
};

const steel = {conductivity: 50, density: 7800, specificHeat: 500};
const alphaSteel = steel.conductivity / (steel.density * steel.specificHeat);
const copper = {conductivity: 400, density: 8900, specificHeat: 385};
const heat = () => engine('heat');
/** A 1-D bar along x with unit cross-section. */
const slab = async (nx, length, extra) => new (await heat()).HeatSolver({nx, ny: 1, nz: 1, dx: length / nx, dy: 1, dz: 1, materials: [steel], temperature: 300, ...extra});
const fixedEnds = (hot, cold) => [{face: 'x-', type: 'temperature', temperature: hot}, {face: 'x+', type: 'temperature', temperature: cold}];

const steadySlab = () => memo('heat/slab', async () => {
  const nx = 20, L = 0.2, hot = 400, cold = 300, solver = await slab(nx, L, {boundaries: fixedEnds(hot, cold)});
  solver.solveSteady();
  let worst = 0;
  for (let i = 0; i < nx; i++) worst = Math.max(worst, Math.abs(solver.temperature[i] - (hot + (cold - hot) * (i + 0.5) / nx)));
  return {flux: solver.boundaryHeatRate(0), profile: worst};
});

const LAYERS = [{k: 0.7, cells: 10}, {k: 0.04, cells: 5}, {k: 1.4, cells: 15}];
const WALL = {h: 0.01, hot: 293.15, cold: 263.15};
const wallResistance = LAYERS.map(layer => layer.cells * WALL.h / layer.k), wallFlux = (WALL.hot - WALL.cold) / wallResistance.reduce((a, b) => a + b, 0);
const composite = () => memo('heat/composite', async () => {
  const {HeatSolver} = await heat(), nx = LAYERS.reduce((sum, layer) => sum + layer.cells, 0), material = [];
  LAYERS.forEach((layer, m) => { for (let i = 0; i < layer.cells; i++) material.push(m); });
  const solver = new HeatSolver({nx, ny: 1, nz: 1, dx: WALL.h, dy: 1, dz: 1, temperature: 280, material,
    materials: LAYERS.map(layer => ({conductivity: layer.k, density: 1800, specificHeat: 900})), boundaries: fixedEnds(WALL.hot, WALL.cold)});
  solver.solveSteady();
  return {flux: solver.boundaryHeatRate(0), first: solver.faceTemperature(LAYERS[0].cells - 1, 0, 0, 'x+'), second: solver.faceTemperature(LAYERS[0].cells + LAYERS[1].cells, 0, 0, 'x-')};
});

const SOURCE = {L: 0.1, q: 2e6, T0: 300};
const sourceError = nx => memo(`heat/source/${nx}`, async () => {
  const {L, q, T0} = SOURCE, h = L / nx, solver = await slab(nx, L, {heatGeneration: q, boundaries: fixedEnds(T0, T0)});
  solver.solveSteady();
  let worst = 0, peak = -Infinity;
  for (let i = 0; i < nx; i++) { const x = (i + 0.5) * h; worst = Math.max(worst, Math.abs(solver.temperature[i] - (T0 + q * x * (L - x) / (2 * steel.conductivity)))); peak = Math.max(peak, solver.temperature[i]); }
  return {worst, balance: solver.boundaryHeatRate(0) + solver.boundaryHeatRate(1)};
});

const convection = () => memo('heat/convection', async () => {
  const nx = 12, L = 0.3, solver = await slab(nx, L, {boundaries: [{face: 'x-', type: 'temperature', temperature: 500}, {face: 'x+', type: 'convection', coefficient: 25, ambient: 290}]});
  solver.solveSteady();
  return {flux: -solver.boundaryHeatRate(1), surface: solver.faceTemperature(nx - 1, 0, 0, 'x+')};
});

const KIRCHHOFF = {L: 0.2, hot: 600, cold: 300, k0: 10, beta: 0.004};
const kirchhoffFlux = (nx, table, key) => memo(`heat/kirchhoff/${key}/${nx}`, async () => {
  const {HeatSolver} = await heat(), {L, hot, cold} = KIRCHHOFF;
  const solver = new HeatSolver({nx, ny: 1, nz: 1, dx: L / nx, dy: 1, dz: 1, temperature: 450, materials: [{density: 2000, specificHeat: 800, conductivityTable: table}], boundaries: fixedEnds(hot, cold)});
  solver.solveSteady();
  return solver.boundaryHeatRate(0);
});
const linearTable = {temperatures: [0, 1000], conductivities: [KIRCHHOFF.k0, KIRCHHOFF.k0 * (1 + KIRCHHOFF.beta * 1000)]};
/** k = 5 + 1e-4 T^2, tabulated every kelvin; the reference is the exact integral of the table. */
function quadraticTable() {
  const temperatures = [], conductivities = [];
  for (let K = 250; K <= 650; K++) { temperatures.push(K); conductivities.push(5 + 1e-4 * K * K); }
  let integral = 0;
  for (let i = 1; i < temperatures.length; i++) if (temperatures[i] > KIRCHHOFF.cold && temperatures[i] <= KIRCHHOFF.hot) integral += (conductivities[i] + conductivities[i - 1]) / 2;
  return {table: {temperatures, conductivities}, exact: integral / KIRCHHOFF.L};
}

/** A semi-infinite solid at 300 K whose surface jumps to 400 K at t = 0, compared at t = 100 s. */
const semiInfinite = (scheme, nx, dt) => memo(`heat/erfc/${scheme}/${nx}/${dt}`, async () => {
  const L = 0.5, h = L / nx, solver = await slab(nx, L, {dt, scheme, boundaries: [{face: 'x-', type: 'temperature', temperature: 400}]});
  solver.step(Math.round(100 / dt));
  let worst = 0;
  for (let i = 0; i < nx; i++) worst = Math.max(worst, Math.abs(solver.temperature[i] - (400 - 100 * erf((i + 0.5) * h / (2 * Math.sqrt(alphaSteel * solver.time))))));
  return {error: worst / 100, field: Float64Array.from(solver.temperature)};
});
const maxDifference = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const timeOrder = async scheme => {
  const fields = [];
  for (const dt of [2, 1, 0.5]) fields.push((await semiInfinite(scheme, 200, dt)).field);
  return order(maxDifference(fields[0], fields[1]), maxDifference(fields[1], fields[2]));
};
const DELTA = Math.sqrt(4 * alphaSteel * 100);

/** Fourier series for a slab at T0 whose two faces are held at Ts from t = 0. */
function slabSeries(x, time, L, alpha, T0, Ts) {
  let sum = 0;
  for (let n = 1; n < 400; n += 2) sum += 4 / (n * Math.PI) * Math.sin(n * Math.PI * x / L) * Math.exp(-alpha * (n * Math.PI / L) ** 2 * time);
  return Ts + (T0 - Ts) * sum;
}
const COOL = {L: 0.1, T0: 500, Ts: 300};
const coolRate = alphaSteel * (Math.PI / COOL.L) ** 2;
const seriesError = nx => memo(`heat/series/${nx}`, async () => {
  const {L, T0, Ts} = COOL, h = L / nx, dt = 20 / nx, solver = await slab(nx, L, {temperature: T0, dt, scheme: 'crank-nicolson', boundaries: fixedEnds(Ts, Ts)});
  let worst = 0;
  for (const fourier of [0.05, 0.2]) {
    solver.step(Math.round(fourier * L * L / alphaSteel / dt) - solver.steps);
    for (let i = 0; i < nx; i++) worst = Math.max(worst, Math.abs(solver.temperature[i] - slabSeries((i + 0.5) * h, solver.time, L, alphaSteel, T0, Ts)));
  }
  return worst / (T0 - Ts);
});
const lateRate = () => memo('heat/late-rate', async () => {
  const {L, T0, Ts} = COOL, nx = 80, dt = 0.25, solver = await slab(nx, L, {temperature: T0, dt, scheme: 'crank-nicolson', boundaries: fixedEnds(Ts, Ts)});
  solver.step(Math.round(0.5 * L * L / alphaSteel / dt));
  const t1 = solver.time, a1 = solver.temperature[nx >> 1] - Ts;
  solver.step(Math.round(0.3 * L * L / alphaSteel / dt));
  return -Math.log((solver.temperature[nx >> 1] - Ts) / a1) / (solver.time - t1);
});

const LUMPED = {n: 4, side: 0.02, film: 10, T0: 400, ambient: 300};
const lumpedBiot = LUMPED.film * (LUMPED.side / 6) / copper.conductivity;
const lumped = () => memo('heat/lumped', async () => {
  const {HeatSolver} = await heat(), {n, side, film, T0, ambient} = LUMPED;
  const boundaries = ['x-', 'x+', 'y-', 'y+', 'z-', 'z+'].map(face => ({face, type: 'convection', coefficient: film, ambient}));
  const tau = copper.density * copper.specificHeat * (side / 6) / film, steps = 100;
  const solver = new HeatSolver({nx: n, ny: n, nz: n, dx: side / n, dy: side / n, dz: side / n, materials: [copper], temperature: T0, dt: tau / steps, scheme: 'crank-nicolson', boundaries});
  let worstMean = 0, mean = 0;
  for (let s = 0; s < steps; s++) {
    solver.step();
    let sum = 0;
    for (const value of solver.temperature) sum += value;
    mean = sum / n ** 3;
    worstMean = Math.max(worstMean, Math.abs(mean - (ambient + (T0 - ambient) * Math.exp(-solver.time / tau))));
  }
  return {final: mean, worstMean: worstMean / (T0 - ambient)};
});

const plate = (n, width, height) => memo(`heat/plate/${n}/${width}`, async () => {
  const {HeatSolver} = await heat();
  const solver = new HeatSolver({nx: n, ny: n, nz: 1, dx: width / n, dy: height / n, dz: 1, materials: [steel], temperature: 0,
    boundaries: [{face: 'y+', type: 'temperature', temperature: 100}, {face: 'y-', type: 'temperature', temperature: 0}, {face: 'x-', type: 'temperature', temperature: 0}, {face: 'x+', type: 'temperature', temperature: 0}]});
  solver.solveSteady();
  return solver.temperature[solver.index(n >> 1, n >> 1, 0)];
});
const plateSeries = (() => { let exact = 0; for (let n = 1; n < 200; n += 2) exact += Math.sin(n * Math.PI / 2) / (2 * n * Math.cosh(n * Math.PI * 1 / (2 * 2))); return exact * 400 / Math.PI; })();

const RAD = {thickness: 0.001, emissivity: 0.8, T0: 1000, duration: 60};
const radiationClosed = async () => {
  const {STEFAN_BOLTZMANN} = await heat(), {thickness, emissivity, T0, duration} = RAD;
  const kappa = 2 * emissivity * STEFAN_BOLTZMANN / (copper.density * copper.specificHeat * thickness);
  return T0 * (1 + 3 * kappa * T0 ** 3 * duration) ** (-1 / 3);
};
const radiating = () => memo('heat/radiation', async () => {
  const {HeatSolver} = await heat(), {thickness, emissivity, T0, duration} = RAD, dt = 0.125;
  const solver = new HeatSolver({nx: 1, ny: 1, nz: 1, dx: thickness, dy: 1, dz: 1, materials: [copper], temperature: T0, dt, scheme: 'crank-nicolson',
    boundaries: [{face: 'x-', type: 'radiation', emissivity, environment: 0}, {face: 'x+', type: 'radiation', emissivity, environment: 0}]});
  solver.step(Math.round(duration / dt));
  return {value: solver.temperature[0], reference: await radiationClosed()};
});
const radiatingWall = () => memo('heat/radiating-wall', async () => {
  const {STEFAN_BOLTZMANN} = await heat();
  const wall = await slab(10, 0.05, {temperature: 600, boundaries: [{face: 'x-', type: 'temperature', temperature: 900}, {face: 'x+', type: 'radiation', emissivity: 0.9, environment: 300}]});
  wall.solveSteady();
  const surface = wall.faceTemperature(9, 0, 0, 'x+');
  return {value: steel.conductivity * (900 - surface) / 0.05, reference: 0.9 * STEFAN_BOLTZMANN * (surface ** 4 - 300 ** 4)};
});

/** A 3-D case with every feature at once: two materials (one with k(T)), a void, all four boundary types, two kinds of source. */
const audit = scheme => memo(`heat/audit/${scheme}`, async () => {
  const {HeatSolver} = await heat();
  const nx = 6, ny = 5, nz = 4, n = nx * ny * nz, material = new Uint8Array(n), solid = new Uint8Array(n).fill(1), temperature = new Float64Array(n);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cell = i + nx * (j + ny * k);
    material[cell] = i < 3 ? 0 : 1;
    if (i >= 2 && i <= 3 && j >= 2 && j <= 3 && k >= 1 && k <= 2) solid[cell] = 0;
    if (i === 5 && j === 4) solid[cell] = 0;
    temperature[cell] = 500 + 40 * Math.sin(0.9 * i + 0.4 * j) - 25 * Math.cos(0.7 * k + 0.2 * i);
  }
  const solver = new HeatSolver({nx, ny, nz, dx: 0.01, dy: 0.012, dz: 0.015, material, solid, temperature, dt: 2, scheme,
    materials: [steel, {density: 2700, specificHeat: 900, conductivityTable: {temperatures: [300, 500, 900], conductivities: [230, 200, 160]}}],
    heatGeneration: 2e5, sources: [{min: [1, 1, 1], power: 30}],
    boundaries: [
      {face: 'x-', type: 'temperature', temperature: 450, region: {min: [0, 0, 0], max: [0, 4, 3]}},
      {face: 'x+', type: 'convection', coefficient: 150, ambient: 300},
      {face: 'y-', type: 'flux', flux: 4000},
      {face: 'y+', type: 'radiation', emissivity: 0.85, environment: 290},
      {face: 'z+', type: 'convection', coefficient: 40, ambient: 320, region: {min: [0, 0, 3], max: [2, 4, 3]}},
      {face: 'z+', type: 'radiation', emissivity: 0.5, environment: 290, region: {min: [0, 0, 3], max: [2, 4, 3]}},
      {face: 'x-', type: 'radiation', emissivity: 0.9, environment: 290, region: {min: [4, 2, 1], max: [4, 3, 2]}},
    ]});
  const before = solver.storedEnergy();
  let moved = 0;
  for (let s = 0; s < 60; s++) { solver.step(); for (const rate of solver.boundaryStepRates) moved += Math.abs(rate) * solver.dt; }
  const change = solver.storedEnergy() - before, supplied = solver.boundaryEnergy.reduce((a, b) => a + b, 0) + solver.sourceEnergy;
  return Math.abs(change - supplied) / (moved + Math.abs(solver.sourceEnergy));
});

const explicitLimit = () => memo('heat/explicit', async () => {
  const {HeatSolver} = await heat(), n = 6, h = 0.01, limit = h * h / (6 * alphaSteel);
  const initial = Float64Array.from({length: n ** 3}, (_, i) => 300 + 100 * ((i * 7919) % 101) / 100);
  const solver = new HeatSolver({nx: n, ny: n, nz: n, dx: h, dy: h, dz: h, materials: [steel], temperature: initial, dt: limit, scheme: 'explicit'});
  const reported = solver.explicitStabilityLimit(), energy = solver.storedEnergy();
  let low = Infinity, high = -Infinity;
  for (let s = 0; s < 400; s++) { solver.step(); for (const value of solver.temperature) { low = Math.min(low, value); high = Math.max(high, value); } }
  return {reported, overshoot: Math.max(0, 300 - low, high - 400), energyDrift: Math.abs(solver.storedEnergy() - energy) / energy};
});

const thermalStress = () => memo('heat/stress', async () => {
  const {restrainedThermalStress} = await heat(), E = 200e9, expansion = 12e-6, field = new Float64Array(8).fill(343.15);
  return {bar: restrainedThermalStress(field, {expansion, youngsModulus: E, reference: 293.15})[0],
    plate: restrainedThermalStress(field, {expansion, youngsModulus: E, poissonRatio: 0.3, reference: 293.15, constraint: 'plate'})[0]};
});

export default defineCases('heat', FILE, [
  {id: 'heat.slab.flux', title: 'Steady slab: heat flux', quantity: 'heat flux through a 0.2 m steel slab between 400 K and 300 K (20 cells)', unit: 'W/m^2', test: T.slab,
    reference: {formula: 'q = k (T1 - T2) / L', value: 50 * 100 / 0.2}, tolerance: relative(1e-10), note: 'A linear profile is in the scheme\'s space; only the linear-solver residual remains.',
    measure: async () => (await steadySlab()).flux},
  {id: 'heat.slab.profile', title: 'Steady slab: linear profile', quantity: 'largest cell-temperature error against the linear profile', unit: 'K', test: T.slab,
    reference: {formula: 'T(x) = T1 + (T2 - T1) x / L', value: 0}, tolerance: absolute(1e-9), measure: async () => (await steadySlab()).profile},
  {id: 'heat.composite.flux', title: 'Three-layer wall: heat flux', quantity: 'flux through brick, insulation and concrete layers between 293.15 K and 263.15 K', unit: 'W/m^2', test: T.composite,
    reference: {formula: 'q = (T1 - T2) / sum(L_i / k_i)', value: wallFlux}, tolerance: relative(1e-9), note: 'The harmonic-mean face conductivity makes a piecewise-linear profile exact.',
    measure: async () => (await composite()).flux},
  {id: 'heat.composite.interface-1', title: 'Three-layer wall: first interface temperature', quantity: 'temperature at the brick / insulation interface', unit: 'K', test: T.composite,
    reference: {formula: 'T = T1 - q R_1', value: WALL.hot - wallFlux * wallResistance[0]}, tolerance: absolute(1e-9), measure: async () => (await composite()).first},
  {id: 'heat.composite.interface-2', title: 'Three-layer wall: second interface temperature', quantity: 'temperature at the insulation / concrete interface', unit: 'K', test: T.composite,
    reference: {formula: 'T = T1 - q (R_1 + R_2)', value: WALL.hot - wallFlux * (wallResistance[0] + wallResistance[1])}, tolerance: absolute(1e-9), measure: async () => (await composite()).second},
  {id: 'heat.source.error', title: 'Slab with a uniform source: error at 64 cells', quantity: 'largest error against the parabola T0 + q x (L - x) / (2 k), of a 50 K rise', unit: 'K', test: T.source,
    reference: {formula: 'max |T - T_exact| = 0', value: 0}, tolerance: upper(SOURCE.q * (SOURCE.L / 64) ** 2 / (8 * steel.conductivity) * (1 + 1e-6)),
    note: 'The half-cell fixed-temperature face shifts the discrete parabola by exactly q h^2 / (8 k), which is the tolerance.', measure: async () => (await sourceError(64)).worst},
  {id: 'heat.source.order', title: 'Slab with a uniform source: observed order', quantity: 'convergence order of that error from 32 to 64 cells', unit: '1', test: T.source,
    reference: {formula: 'log2(e_32 / e_64) = 2', value: 2}, tolerance: absolute(0.001), measure: async () => order((await sourceError(32)).worst, (await sourceError(64)).worst)},
  {id: 'heat.source.balance', title: 'Slab with a uniform source: heat balance', quantity: 'heat leaving through the two faces per unit area', unit: 'W/m^2', test: T.source,
    reference: {formula: 'q_out = -q L', value: -SOURCE.q * SOURCE.L}, tolerance: relative(1e-10), measure: async () => (await sourceError(64)).balance},
  {id: 'heat.convection.flux', title: 'Convection boundary: heat flux', quantity: 'flux through a 0.3 m slab from 500 K to air at 290 K with h = 25 W/(m^2 K)', unit: 'W/m^2', test: T.convection,
    reference: {formula: 'q = (T1 - T_inf) / (L / k + 1 / h)', value: 210 / (0.3 / 50 + 1 / 25)}, tolerance: relative(1e-10), measure: async () => (await convection()).flux},
  {id: 'heat.convection.surface', title: 'Convection boundary: surface temperature', quantity: 'temperature of the cooled face', unit: 'K', test: T.convection,
    reference: {formula: 'T_s = T_inf + q / h', value: 290 + 210 / (0.3 / 50 + 1 / 25) / 25}, tolerance: absolute(1e-9), measure: async () => (await convection()).surface},
  {id: 'heat.kirchhoff.linear', title: 'Conductivity linear in temperature: Kirchhoff flux', quantity: 'flux with k = k0 (1 + beta T) between 600 K and 300 K (8 cells)', unit: 'W/m^2', test: T.kirchhoff,
    reference: {formula: 'q = k0 ((T1 - T2) + beta (T1^2 - T2^2) / 2) / L', value: 10 * (300 + 0.002 * (360000 - 90000)) / 0.2}, tolerance: relative(1e-9),
    measure: () => kirchhoffFlux(8, linearTable, 'linear')},
  {id: 'heat.kirchhoff.quadratic', title: 'Conductivity quadratic in temperature: flux at 32 cells', quantity: 'flux with k = 5 + 1e-4 T^2, tabulated every kelvin', unit: 'W/m^2', test: T.kirchhoff,
    reference: {formula: 'q = (1 / L) integral of k dT', value: quadraticTable().exact}, tolerance: relative(5e-4), note: 'Second-order error of the cell-centred k for a threefold change in k across the slab.',
    measure: () => kirchhoffFlux(32, quadraticTable().table, 'quadratic')},
  {id: 'heat.kirchhoff.order', title: 'Conductivity quadratic in temperature: observed order', quantity: 'convergence order of the flux error from 16 to 32 cells', unit: '1', test: T.kirchhoff,
    reference: {formula: 'log2(e_16 / e_32) = 2', value: 2}, tolerance: absolute(0.1),
    measure: async () => { const {table, exact} = quadraticTable(); return order(await kirchhoffFlux(16, table, 'quadratic') - exact, await kirchhoffFlux(32, table, 'quadratic') - exact); }},
  {id: 'heat.erfc.error', title: 'Sudden surface temperature (erfc): Crank-Nicolson error', quantity: 'largest error against 400 - 100 erf(x / (2 sqrt(alpha t))) at t = 100 s, 200 cells, as a fraction of the 100 K step', unit: '1', test: T.erfc,
    reference: {formula: 'max |T - T_erfc| / 100 K = 0', value: 0}, tolerance: upper(0.25 * (0.5 / 200 / DELTA) ** 2), note: 'The tolerance is 0.25 (h / delta)^2 with delta = sqrt(4 alpha t), the diffusion length.',
    measure: async () => (await semiInfinite('crank-nicolson', 200, 250 / 200)).error},
  {id: 'heat.erfc.order.crank-nicolson', title: 'erfc transient: Crank-Nicolson order, h and dt halved together', quantity: 'convergence order of the erfc error from 100 to 200 cells', unit: '1', test: T.erfc,
    reference: {formula: 'log2(e_100 / e_200) = 2', value: 2}, tolerance: absolute(0.05),
    measure: async () => order((await semiInfinite('crank-nicolson', 100, 2.5)).error, (await semiInfinite('crank-nicolson', 200, 1.25)).error)},
  {id: 'heat.erfc.order.backward-euler', title: 'erfc transient: backward Euler order with dt ~ h^2', quantity: 'convergence order of the erfc error from 100 to 200 cells', unit: '1', test: T.erfc,
    reference: {formula: 'log2(e_100 / e_200) = 2', value: 2}, tolerance: absolute(0.05),
    measure: async () => order((await semiInfinite('backward-euler', 100, 5 * 0.25)).error, (await semiInfinite('backward-euler', 200, 5 * 0.0625)).error)},
  {id: 'heat.erfc.time-order.crank-nicolson', title: 'erfc transient: Crank-Nicolson order in dt alone', quantity: 'order from the field differences at dt = 2, 1 and 0.5 s on 200 cells', unit: '1', test: T.erfc,
    reference: {formula: 'log2(|T_2 - T_1| / |T_1 - T_0.5|) = 2', value: 2}, tolerance: absolute(0.02), measure: () => timeOrder('crank-nicolson')},
  {id: 'heat.erfc.time-order.backward-euler', title: 'erfc transient: backward Euler order in dt alone', quantity: 'order from the field differences at dt = 2, 1 and 0.5 s on 200 cells', unit: '1', test: T.erfc,
    reference: {formula: 'log2(|T_2 - T_1| / |T_1 - T_0.5|) = 1', value: 1}, tolerance: absolute(0.02), measure: () => timeOrder('backward-euler')},
  {id: 'heat.series.error', title: 'Cooling slab: Fourier-series profile at 80 cells', quantity: 'largest error against the series at Fourier numbers 0.05 and 0.2, as a fraction of the 200 K step', unit: '1', test: T.series,
    reference: {formula: 'max |T - T_series| / 200 K = 0', value: 0}, tolerance: upper(3e-4), measure: () => seriesError(80)},
  {id: 'heat.series.order', title: 'Cooling slab: observed order', quantity: 'convergence order of the series error from 40 to 80 cells (Crank-Nicolson, dt ~ h)', unit: '1', test: T.series,
    reference: {formula: 'log2(e_40 / e_80) = 2', value: 2}, tolerance: absolute(0.1), measure: async () => order(await seriesError(40), await seriesError(80))},
  {id: 'heat.series.decay-rate', title: 'Cooling slab: first-mode decay rate', quantity: 'decay rate of the mid-plane temperature between Fourier numbers 0.5 and 0.8', unit: '1/s', test: T.series,
    reference: {formula: 'lambda = alpha (pi / L)^2', value: coolRate}, tolerance: relative(3e-4), note: 'The leading space error of the rate is (pi h / L)^2 / 12 = 1.3e-4 at 80 cells.', measure: lateRate},
  {id: 'heat.lumped.final', title: 'Lumped-capacitance cooling: temperature after one time constant', quantity: 'mean temperature of a 20 mm copper block cooled by a film, after t = tau', unit: 'K', test: T.lumped,
    reference: {formula: 'T = T_inf + (T0 - T_inf) exp(-h A t / (rho c V))', value: 300 + 100 * Math.exp(-1)}, tolerance: absolute(lumpedBiot * 100),
    note: 'The lumped law is itself good to order Bi = h (V / A) / k = 8.3e-5; the tolerance is Bi times the 100 K step.', measure: async () => (await lumped()).final},
  {id: 'heat.lumped.error', title: 'Lumped-capacitance cooling: worst error over the transient', quantity: 'largest error of the mean temperature over one time constant, as a fraction of the 100 K step', unit: '1', test: T.lumped,
    reference: {formula: 'max |T_mean - T_lumped| / 100 K = 0', value: 0}, tolerance: upper(lumpedBiot), measure: async () => (await lumped()).worstMean},
  {id: 'heat.plate.square', title: '2-D square plate with one hot edge: centre temperature', quantity: 'centre temperature of a square plate with one edge at 100 and three at 0 (15 x 15 cells)', unit: 'K', test: T.plate,
    reference: {formula: 'T_centre = T1 / 4 (superposition)', value: 25}, tolerance: absolute(1e-9), measure: () => plate(15, 1, 1)},
  {id: 'heat.plate.series', title: '2 x 1 plate with a hot long edge: centre temperature at 81 x 81', quantity: 'centre temperature against the series solution', unit: 'K', test: T.plate,
    reference: {formula: 'T = (4 T1 / pi) sum over odd n of sin(n pi / 2) / (2 n cosh(n pi b / (2 a)))', value: plateSeries}, tolerance: absolute(2e-3), measure: () => plate(81, 2, 1)},
  {id: 'heat.plate.order', title: '2 x 1 plate: observed order', quantity: 'convergence order of the centre error from 27 to 81 cells per side', unit: '1', test: T.plate,
    reference: {formula: 'log3(e_27 / e_81) = 2', value: 2}, tolerance: absolute(0.05), measure: async () => order(await plate(27, 2, 1) - plateSeries, await plate(81, 2, 1) - plateSeries, 3)},
  {id: 'heat.radiation.cooling', title: 'Radiating thin plate: temperature after 60 s', quantity: 'temperature of a 1 mm copper plate at 1000 K radiating to 0 K surroundings', unit: 'K', test: T.radiation,
    reference: {formula: 'T = T0 (1 + 3 kappa T0^3 t)^(-1/3), kappa = 2 eps sigma / (rho c L)', value: null}, tolerance: absolute(0.1),
    note: 'The lumped model differs from the conducting plate by order Bi (T0 - T) = 0.1 K.', measure: radiating},
  {id: 'heat.radiation.steady', title: 'Radiating wall at steady state', quantity: 'conducted flux to a face that radiates to 300 K', unit: 'W/m^2', test: T.radiation,
    reference: {formula: 'k (T1 - T_s) / L = eps sigma (T_s^4 - T_e^4)', value: null}, tolerance: relative(1e-9), measure: radiatingWall},
  ...['backward-euler', 'crank-nicolson'].map(scheme => (
    {id: `heat.energy-audit.${scheme}`, title: `Energy audit (${scheme})`, quantity: 'stored-energy change minus boundary heat and sources over 60 steps of a 3-D case with every boundary type, as a fraction of the heat exchanged', unit: '1', test: T.audit,
      reference: {formula: '|dE - (Q_boundary + Q_source)| / Q_exchanged = 0', value: 0}, tolerance: upper(1e-10), note: 'Conduction between cells cancels in the sum exactly; the defect is the summed linear-solver residual.',
      measure: () => audit(scheme)})),
  {id: 'heat.explicit.limit', title: 'Explicit scheme: reported stability limit', quantity: 'explicitStabilityLimit() of a uniform insulated 3-D grid, h = 10 mm', unit: 's', test: T.explicit,
    reference: {formula: 'dt = h^2 / (6 alpha)', value: 1e-4 / (6 * alphaSteel)}, tolerance: relative(1e-12), measure: async () => (await explicitLimit()).reported},
  {id: 'heat.explicit.bounded', title: 'Explicit scheme: no overshoot at the limit', quantity: 'largest excursion outside the initial 300 to 400 K range in 400 steps at the limit', unit: 'K', test: T.explicit,
    reference: {formula: 'min T0 <= T <= max T0', value: 0}, tolerance: upper(1e-9), measure: async () => (await explicitLimit()).overshoot},
  {id: 'heat.thermal-stress.bar', title: 'Restrained bar heated by 50 K', quantity: 'stress of a fully restrained steel bar', unit: 'Pa', test: T.stress,
    reference: {formula: 'sigma = -E alpha dT', value: -200e9 * 12e-6 * 50}, tolerance: relative(1e-13), note: 'A one-way formula evaluated on the temperature field, not a stress solve.',
    measure: async () => (await thermalStress()).bar},
  {id: 'heat.thermal-stress.plate', title: 'Restrained plate heated by 50 K', quantity: 'in-plane stress of a plate restrained in its plane', unit: 'Pa', test: T.stress,
    reference: {formula: 'sigma = -E alpha dT / (1 - nu)', value: -200e9 * 12e-6 * 50 / 0.7}, tolerance: relative(1e-13), measure: async () => (await thermalStress()).plate},
]);
