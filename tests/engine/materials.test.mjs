// The material library (src/engine/materials.ts): the data are well formed and traceable, the conversions the
// entries record reproduce their SI values, the helpers build the solvers' inputs, and the library values reach the
// solvers as the closed forms say. The solver runs are the scenarios of validation/domains/materials.mjs, which the
// validation report prints. SI units. Nothing here depends on wall-clock time.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/engine/materials.ts';
import {EngineError} from '../../src/engine/contracts.ts';
import * as S from '../../validation/domains/materials.mjs';

const close = (actual, expected, relative, label = '') => assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${label} ${actual} != ${expected}: relative ${actual / expected - 1}`);
const refuses = (make, pattern) => assert.throws(make, error => error instanceof EngineError && error.code === 'INVALID_PAYLOAD' && pattern.test(error.message));
const values = () => [
  ...Object.values(M.MATERIALS).flatMap(entry => Object.entries(entry.properties).map(([property, value]) => [`${entry.id}.${property}`, value])),
  ...M.CONTACT_PAIRS.flatMap(pair => ['staticFriction', 'kineticFriction', 'friction', 'restitution'].filter(key => pair[key]).map(key => [`${pair.a}/${pair.b}/${pair.condition}.${key}`, pair[key]])),
];

test('every value has a source that exists, the figure read, conditions, and a range that holds it', () => {
  assert.match(M.MATERIAL_LIBRARY_VERSION, /^\d+\.\d+\.\d+$/);
  for (const [label, value] of values()) {
    assert.ok(Number.isFinite(value.value), `${label}: finite`);
    assert.ok(typeof value.conditions === 'string' && value.conditions.length > 2, `${label}: conditions`);
    if (value.source === 'unverified') {
      assert.ok(typeof value.reason === 'string' && value.reason.length > 20, `${label}: an unverified value says why`);
      assert.equal(value.read, '', `${label}: nothing was read`);
    } else {
      assert.ok(Object.hasOwn(M.MATERIAL_SOURCES, value.source), `${label}: source ${value.source} is listed`);
      assert.ok(value.read.length > 2, `${label}: the figure read is recorded`);
    }
    for (const also of value.also ?? []) assert.ok(Object.hasOwn(M.MATERIAL_SOURCES, also), `${label}: also ${also} is listed`);
    if (value.range) assert.ok(value.range[0] <= value.value && value.value <= value.range[1] && value.range[0] < value.range[1], `${label}: ${value.value} inside ${value.range}`);
  }
  for (const source of Object.values(M.MATERIAL_SOURCES)) assert.match(source.url, /^https:\/\//, `${source.id}: an https URL`);
  // Every listed source is used.
  const used = new Set(values().flatMap(([, value]) => [value.source, ...(value.also ?? [])]));
  for (const id of Object.keys(M.MATERIAL_SOURCES)) assert.ok(used.has(id), `${id} is cited by a value`);
  // Ranges of the physically bounded quantities.
  for (const entry of Object.values(M.MATERIALS)) {
    const {poissonRatio: nu, density} = entry.properties;
    if (nu) assert.ok(nu.value > -1 && nu.value <= 0.5, `${entry.id}: Poisson's ratio`);
    assert.ok(density && density.value > 0, `${entry.id}: every material has a density`);
  }
  for (const pair of M.CONTACT_PAIRS) {
    if (pair.restitution) assert.ok(pair.restitution.value > 0 && pair.restitution.value <= 1, `${pair.a}/${pair.b}: restitution in (0, 1]`);
    if (pair.staticFriction && pair.kineticFriction) assert.ok(pair.staticFriction.value >= pair.kineticFriction.value, `${pair.a}/${pair.b}: static >= kinetic`);
  }
  assert.ok(Object.isFrozen(M.MATERIALS) && Object.isFrozen(M.MATERIALS['copper-c11000'].properties.density) && Object.isFrozen(M.CONTACT_PAIRS[0]));
});

test('the library covers the materials and properties it promises, and counts its unverified values', () => {
  const ids = M.materialIds();
  for (const id of ['structural-steel-s355', 'structural-steel-s235', 'stainless-304', 'aluminium-6061-t6', 'copper-c11000', 'cast-iron-gjl-250', 'soda-lime-glass', 'concrete-c30-37', 'granite-barre',
    'oak-red-northern', 'pine-loblolly', 'pmma', 'abs', 'nylon-66', 'natural-rubber', 'ptfe', 'ice', 'water', 'air', 'glycerol', 'olive-oil', 'honey', 'glass-beads', 'sand-quartz']) assert.ok(ids.includes(id), id);
  for (const id of ids.filter(id => M.material(id).category !== 'fluid')) assert.ok(M.materialValue(id, 'youngModulus'), `${id}: a Young's modulus`);
  for (const id of ids.filter(id => M.material(id).category === 'fluid')) for (const property of ['density', 'viscosity']) assert.ok(M.materialValue(id, property), `${id}.${property}`);
  for (const id of ['glass-beads', 'sand-quartz']) for (const property of ['density', 'youngModulus', 'poissonRatio']) assert.ok(M.materialValue(id, property), `${id}.${property}`);
  const rows = M.materialAudit(), unverified = rows.filter(row => row.source === 'unverified');
  assert.equal(rows.length, 228, 'values in the library (docs/MATERIALS.md and the validation domain quote this count)');
  assert.equal(unverified.length, 7, 'unverified values (docs/MATERIALS.md lists them)');
  assert.deepEqual(unverified.filter(row => row.kind !== 'pair').map(row => `${row.subject}.${row.property}`), ['honey.density'], 'every material property has a source except the density of honey; the rest are contact coefficients');
});

test('the conversions recorded in the entries reproduce the SI values', () => {
  const ksi = 6.894757e6, psi = 6894.757;
  close(M.materialProperty('copper-c11000', 'youngModulus'), 17000 * ksi, 1e-4, 'copper E');
  close(M.materialProperty('copper-c11000', 'shearModulus'), 6400 * ksi, 1e-4, 'copper G');
  close(M.materialProperty('copper-c11000', 'thermalConductivity'), 226 * 1.730735, 5e-4, 'copper k (stored to four digits)');
  close(M.materialProperty('copper-c11000', 'specificHeat'), 0.092 * 4186.8, 1e-4, 'copper c_p');
  close(M.materialProperty('copper-c11000', 'thermalExpansion'), 9.4e-6 * 1.8, 1e-9, 'copper alpha');
  close(M.materialProperty('copper-c11000', 'poissonRatio'), 17000 / (2 * 6400) - 1, 2e-3, 'copper nu');
  close(M.materialProperty('ptfe', 'youngModulus'), 80000 * psi, 1e-4, 'PTFE E');
  close(M.materialProperty('ptfe', 'tensileStrength'), 3900 * psi, 1e-3, 'PTFE strength');
  close(M.materialProperty('ptfe', 'thermalConductivity'), 1.70 * 0.1442279, 1e-3, 'PTFE k from Btu in');
  close(M.materialProperty('cast-iron-gjl-250', 'fractureToughness'), 480 * 1e6 * Math.sqrt(1e-3), 1e-4, 'grey iron K_IC from N/mm^1.5');
  close(M.materialProperty('structural-steel-s355', 'specificHeat'), 425 + 0.773 * 20 - 1.69e-3 * 400 + 2.22e-6 * 8000, 1e-4, 'EN 1993-1-2 c_a(20 °C)');
  close(M.materialProperty('structural-steel-s355', 'thermalConductivity'), 54 - 3.33e-2 * 20, 1e-6, 'EN 1993-1-2 lambda_a(20 °C)');
  const T = 293.15, x = 12, cp0 = 0.1031 + 0.003867 * T, Ac = x * (-0.06191 + 2.36e-4 * T - 1.33e-4 * x);
  close(M.materialProperty('pine-loblolly', 'specificHeat'), 1000 * ((cp0 + 4.18 * x / 100) / (1 + x / 100) + Ac), 5e-4, 'wood c_p at 12% (stored to three digits)');
  close(M.materialProperty('oak-red-northern', 'thermalConductivity'), 1.8 * (0.63 * (0.1941 + 0.004064 * x) + 0.01864), 1e-3, 'oak k along the grain');
  close(M.materialProperty('oak-red-northern', 'density'), 0.63 * 1.12 * 1000, 1e-9, 'oak density at 12%');
  close(M.materialProperty('natural-rubber', 'thermalExpansion'), 0.00067 / 3, 2e-3, 'rubber linear expansion');
  // Ice: the source's own G_c = K^2 (1 - nu^2) / E = 1 J/m^2 from its E and nu.
  close(M.fractureEnergyFromToughness(0.1e6, 9.3e9, 0.33), 1, 0.15, 'ice G_c');
});

test('the helpers build each solver\'s input, refuse what is missing or unverified, and accept overrides', () => {
  assert.deepEqual(M.solidMaterial('structural-steel-s355'), {youngModulus: 210e9, poissonRatio: 0.3, density: 7850, thermalExpansion: 12e-6});
  assert.deepEqual(M.solidMaterial('aluminium-6061-t6', {thermalExpansion: null}), {youngModulus: 68.9e9, poissonRatio: 0.33, density: 2700});
  assert.equal(M.solidMaterial('natural-rubber').poissonRatio, M.SOLVER_POISSON_LIMIT, 'nu = 0.5 is capped for the solvers');
  refuses(() => M.solidMaterial('abs'), /no poissonRatio for "abs"/);
  assert.equal(M.solidMaterial('abs', {poissonRatio: 0.35}).poissonRatio, 0.35);
  refuses(() => M.material('unobtainium'), /Unknown material "unobtainium"/);
  refuses(() => M.material('toString'), /Unknown material/);
  // Heat.
  assert.deepEqual(M.heatMaterial('water'), {conductivity: 0.598012, density: 998.207, specificHeat: 4184.05});
  close(M.thermalDiffusivity('copper-c11000'), 391.1 / (8910 * 385.2), 1e-12, 'copper diffusivity');
  refuses(() => M.heatMaterial('nylon-66'), /no specificHeat/);
  // Fracture: Irwin's relation in plane strain by default, plane stress on request; strength from the library or passed.
  const glass = M.fractureLaw('soda-lime-glass');
  close(glass.toughness, 0.75e6 ** 2 * (1 - 0.23 ** 2) / 72e9, 1e-12, 'glass G_c plane strain');
  close(M.fractureLaw('soda-lime-glass', {state: 'plane-stress'}).toughness, 0.75e6 ** 2 / 72e9, 1e-12, 'glass G_c plane stress');
  assert.equal(glass.strength, 41e6); assert.equal(glass.model, 'cohesive');
  assert.equal(M.fractureLaw('ice', {strength: 1e6}).toughness, M.fractureEnergyFromToughness(0.1e6, 9.3e9, 0.33));
  refuses(() => M.fractureLaw('ice'), /no tensile or flexural strength for "ice"/);
  refuses(() => M.fractureLaw('concrete-c30-37'), /no fracture toughness or fracture energy/);
  assert.equal(M.fractureLaw('concrete-c30-37', {toughness: 100, model: 'crack-band'}).strength, 2.9e6);
  // Contact pairs, in either order.
  const steel = M.contactPair('structural-steel-s355', 'structural-steel-s355');
  assert.deepEqual([steel.staticFriction, steel.kineticFriction, steel.friction, steel.restitution, steel.impactSpeed], [0.6, 0.3, 0.6, 0.56, [3.13, 4.43]]);
  assert.equal(M.contactPair('structural-steel-s355', 'structural-steel-s355', 'dry', {use: 'kinetic'}).friction, 0.3);
  const forward = M.contactPair('structural-steel-s355', 'aluminium-6061-t6'), backward = M.contactPair('aluminium-6061-t6', 'structural-steel-s355');
  assert.deepEqual([forward.staticFriction, forward.kineticFriction, forward.entries], [backward.staticFriction, backward.kineticFriction, backward.entries]);
  assert.deepEqual([forward.staticFriction, forward.kineticFriction], [0.61, 0.47]);
  assert.equal(M.contactPair('structural-steel-s355', 'structural-steel-s355', 'lubricated').friction, 0.05);
  assert.equal(M.contactPair('pmma', 'pmma').friction, 0.8, 'an unqualified coefficient is used when the source gives neither');
  refuses(() => M.contactPair('abs', 'granite-barre'), /no dry contact entry/);
  // An unverified coefficient is not handed out unless asked for.
  assert.equal(M.contactPair('concrete-c30-37', 'concrete-c30-37').friction, null);
  assert.equal(M.contactPair('concrete-c30-37', 'concrete-c30-37', 'dry', {allowUnverified: true}).friction, 0.6);
  refuses(() => M.rigidMaterial('concrete-c30-37'), /unverified/);
  const concrete = M.rigidMaterial('concrete-c30-37', {allowUnverified: true});
  assert.deepEqual([concrete.density, concrete.friction, concrete.restitution, [...concrete.unverified]], [2400, 0.6, 0.2, ['friction', 'restitution']]);
  const rubber = M.rigidMaterial('natural-rubber', {allowUnverified: true, frictionPair: ['natural-rubber', 'concrete-c30-37']});
  assert.deepEqual([rubber.friction, rubber.restitution, [...rubber.unverified]], [1, 0.8, ['restitution']]);
  refuses(() => M.rigidMaterial('soda-lime-glass'), /no restitution/);
  assert.equal(M.rigidMaterial('soda-lime-glass', {restitutionPair: ['glass-beads', 'glass-beads']}).restitution, 0.926);
  // Grains.
  assert.deepEqual(M.grainMaterial('glass-beads'), {density: 2500, youngModulus: 46.2e9, poissonRatio: 0.245, restitution: 0.926, friction: 0.12});
  refuses(() => M.grainMaterial('sand-quartz'), /no grain-on-grain restitution/);
  assert.deepEqual(M.grainMaterial('sand-quartz', {restitution: 0.6, rollingFriction: 0.1}), {density: 2650, youngModulus: 52e9, poissonRatio: 0.25, restitution: 0.6, friction: 0.19, rollingFriction: 0.1});
});

test('internal consistency: G = E / (2 (1 + nu)) for the isotropic entries with three sourced moduli, and the disagreements are flagged', async () => {
  const rows = await S.shearConsistencies();
  for (const [id, tolerance] of S.CONSISTENT) {
    const row = rows.find(one => one.id === id);
    assert.ok(Math.abs(row.relative) <= tolerance, `${id}: G is ${row.relative} from E / (2 (1 + nu)), allowed ${tolerance}`);
    assert.equal(row.flagged, false);
  }
  assert.deepEqual(rows.filter(row => Math.abs(row.relative) > 0.03).map(row => [row.id, row.flagged]), [['stainless-304', true], ['pmma', true]]);
});

test('an aluminium 6061-T6 bar in tension stretches by F L / (E A) with the library E', async () => {
  const r = await S.tension();
  close(r.elongation, r.exact, 1e-9, 'elongation');
  close(r.exact, 2e5 * 2 / (68.9e9 * 0.05 * 0.04), 1e-12, 'the reference uses 68.9 GPa');
});

test('a structural-steel cantilever deflects as Timoshenko beam theory says with the library E and nu', async () => {
  const r = await S.cantilever(8);
  close(r.tip, r.timoshenko, 0.045, 'tip, 8 cells');
  assert.ok(r.tip / r.timoshenko < 1, 'linear tetrahedra are too stiff, never too soft');
  close(r.bending / r.timoshenko, 0.9924, 1e-3, 'shear adds 0.8% at L / t = 10');
});

test('a free stainless 304 bar heated by 100 K grows by alpha dT L with the library alpha', async () => {
  const r = await S.expansion();
  close(r.growth, r.exact, 1e-9, 'growth');
  close(r.exact, 17.3e-6 * 100, 1e-12, 'alpha = 17.3e-6 1/K');
});

test('a soda-lime glass plate fails at the Griffith stress of the library K_IC', async () => {
  const r = await S.glassPlate(0.5);
  close(r.strength, r.griffith, 0.05, 'failure stress');
  close(r.lch, 72e9 * (0.75e6 ** 2 / 72e9) / 41e6 ** 2, 1e-9, 'l_ch = K_IC^2 / sigma_c^2');
});

test('a copper bar cools with the time constant L^2 / (pi^2 alpha) of the library k, rho and c_p', async () => {
  const r = await S.diffusion();
  close(r.measured, r.tau, 1e-3, 'tau');
  close(r.tau, 0.01 / (Math.PI ** 2 * 391.1 / (8910 * 385.2)), 1e-12, 'the reference uses the library numbers');
});

test('two natural-rubber spheres and two glass beads stay in contact for the Hertz duration of the library E, nu and rho', async () => {
  const rubber = await S.headOn('natural-rubber', {restitution: 1, friction: 0}), glass = await S.headOn('glass-beads', {restitution: 1});
  close(rubber.duration, rubber.hertz, 1e-3, 'rubber');
  close(glass.duration, glass.hertz, 1e-3, 'glass beads');
  assert.equal(rubber.material.youngModulus, 1.5e6);
  assert.ok(rubber.duration / glass.duration > 20, 'rubber is in contact far longer than glass');
});

test('two glass beads rebound at the library restitution', async () => {
  const r = await S.headOn('glass-beads', {fraction: 0.01});
  assert.ok(Math.abs(r.rebound - 0.926) <= 1e-3, `rebound ${r.rebound}`);
});
