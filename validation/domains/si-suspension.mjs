// The SI suspension footbridge (src/engine/si-suspension.ts), the model behind the Studio's bridge study: form-finding,
// the main cable and hangers against closed forms, a point load against the deflection theory, the first antisymmetric
// mode, the time-stepped model against its statics, symmetry, a hanger failure, wind, a parked vehicle and repeatability.
// Set-ups and hand solutions are those of tests/physics/si-suspension.test.mjs (its fixtures file).
import {defineCases, relative, upper} from '../lib.mjs';
import {freshWorld} from '../../tests/physics/si-bridge-fixtures.mjs';
import {
  measureCable, measureCrowd, measureDead, measureFailure, measureForm, measureMirror, measureModes, measurePoint, measureRelease, measureRepeat, measureVehicle, measureWind,
} from '../../tests/physics/si-suspension-fixtures.mjs';

const FILE = 'tests/physics/si-suspension.test.mjs';
const T = {
  form: 'form-finding: the deck is level at every hanger, the cable passes the drawn midspan height, the hangers hang plumb',
  dead: 'dead load: the supports carry the whole weight and the horizontal forces balance (statics)',
  cable: 'main cable under dead load: H against w L^2 / 8 f, tension at the towers, hangers against the continuous deck',
  point: 'a 20 kN point load: deck deflection and cable force against the linearised deflection theory',
  modes: 'natural frequencies: the first antisymmetric vertical mode against the tensioned-beam closed form',
  crowd: 'time-stepped, crowd on the west half: equal to the statics, the supports carry structure and crowd',
  release: 'time-stepped, released from antisymmetric loads: the frequency of the first antisymmetric mode',
  mirror: 'symmetry: crowds on the west and east thirds give mirror-image answers',
  failure: 'a hanger fails: the load moves to its neighbours as the damaged statics say',
  wind: 'wind on the deck: lateral deflection equal to the statics, the bearings carry the whole lateral load',
  vehicle: 'a parked service vehicle on the Box3D world: equal to the statics with its weight at its place',
  repeat: 'determinism: two runs with a changing crowd, wind and a failing hanger are bit-identical',
};
let world = null;
const vehicle = async () => { world ??= await freshWorld(); return measureVehicle(world); };

export default defineCases('si-suspension', FILE, [
  {id: 'si-suspension.form.level', test: T.form, title: 'Form-finding: the deck is level under dead load', quantity: 'largest girder deflection at a hanger', unit: 'm',
    reference: {formula: '0 (hangers cut for the reactions of a deck on level supports)', value: 0}, tolerance: upper(1e-6), measure: async () => (await measureForm()).deckLevel,
    note: 'Four passes: the towers shorten by 0.48 mm and the backstays pull the saddles 0.25 mm outwards, and the funicular is redrawn between the saddles where they went.'},
  {id: 'si-suspension.form.sag', test: T.form, title: 'Form-finding: the main cable passes the drawn midspan height', quantity: 'midspan cable height', unit: 'm',
    reference: {formula: 'saddle height - sag = 14 - 6.8', value: 7.2}, tolerance: upper(1e-6), measure: async () => { const r = await measureForm(); return {value: r.midHeight, reference: r.target}; }},
  {id: 'si-suspension.dead.vertical', test: T.dead, title: 'Dead load: the supports carry the weight (statics)', quantity: 'sum of vertical reactions / weight', unit: '1',
    reference: {formula: 'sum R_y = (deck + towers + cables + saddles) g', value: 1}, tolerance: relative(1e-9), measure: async () => (await measureDead()).vertical},

  {id: 'si-suspension.cable.parabola', test: T.cable, title: 'Main cable: horizontal tension against the parabola', quantity: 'H', unit: 'N',
    reference: {formula: 'H = w L^2 / (8 f), w = cable load / L', value: null}, tolerance: relative(0.03), measure: async () => { const r = await measureCable(); return {value: r.H, reference: r.parabola}; },
    note: 'The parabola takes the load as uniform; the hangers next to the towers carry 13 % more (the end panels of a continuous deck), which puts H 1.9 % above it.'},
  {id: 'si-suspension.cable.tower', test: T.cable, title: 'Main cable: tension at the towers', quantity: 'tension of the end segment', unit: 'N',
    reference: {formula: 'sqrt(H^2 + V^2), V = half the cable load', value: null}, tolerance: relative(1e-6), measure: async () => { const r = await measureCable(); return {value: r.end, reference: r.polygon}; }},
  {id: 'si-suspension.cable.towerParabola', test: T.cable, title: 'Main cable: tension at the towers against the parabola', quantity: 'tension of the end segment', unit: 'N',
    reference: {formula: 'H_p sqrt(1 + 16 (f / L)^2)', value: null}, tolerance: relative(0.03), measure: async () => { const r = await measureCable(); return {value: r.end, reference: r.parabolaEnd}; }},
  {id: 'si-suspension.cable.hanger', test: T.cable, title: 'Hangers: the midspan hanger carries one panel of deck', quantity: 'hanger tension', unit: 'N',
    reference: {formula: '(girder + crossbeam/2 + bracing/2) g s + half the hanger weight', value: null}, tolerance: relative(1e-5), measure: async () => { const r = await measureCable(); return {value: r.hanger, reference: r.perPanel}; }},

  {id: 'si-suspension.point.mid', test: T.point, title: '20 kN at midspan: deck deflection', quantity: 'deflection under the load', unit: 'm',
    reference: {formula: 'linearised deflection theory, EI v\'\'\'\' - H v\'\' = p - (8 f / L^2) h, Fourier series', value: null}, tolerance: relative(0.05),
    measure: async () => { const r = await measurePoint('mid'); return {value: r.deflection, reference: r.theory}; },
    note: 'The theory has inextensible hangers spread as a membrane and one spring per saddle (backstay plus column); the model has 35 elastic hangers per cable and the portal towers.'},
  {id: 'si-suspension.point.midCable', test: T.point, title: '20 kN at midspan: extra horizontal cable force', quantity: 'h, both cables', unit: 'N',
    reference: {formula: 'h (L_e / EA + 2 / k_s) = (8 f / L^2) integral v dx per cable', value: null}, tolerance: relative(0.01), measure: async () => { const r = await measurePoint('mid'); return {value: r.h, reference: r.hTheory}; }},
  {id: 'si-suspension.point.quarter', test: T.point, title: '20 kN at the quarter point: deck deflection', quantity: 'deflection under the load', unit: 'm',
    reference: {formula: 'the same theory', value: null}, tolerance: relative(0.05), measure: async () => { const r = await measurePoint('quarter'); return {value: r.deflection, reference: r.theory}; }},
  {id: 'si-suspension.point.antisymmetric', test: T.point, title: '20 kN down and up at the quarter points', quantity: 'deflection under the load', unit: 'm',
    reference: {formula: 'the same theory, h = 0 (the cable keeps its length)', value: null}, tolerance: relative(0.05), measure: async () => { const r = await measurePoint('antisymmetric'); return {value: r.deflection, reference: r.theory}; }},

  {id: 'si-suspension.modes.antisymmetric', test: T.modes, title: 'First antisymmetric vertical mode: eigenvalue solve against the closed form', quantity: 'frequency', unit: 'Hz',
    reference: {formula: 'f = sqrt((EI k^4 + H k^2) / m) / (2 pi), k = 2 pi / L', value: null}, tolerance: relative(0.02), measure: async () => { const r = await measureModes(); return {value: r.antisymmetric.f, reference: r.closed}; },
    note: 'The closed form leaves out the towers, the cable\'s own swinging and the discreteness of the hangers. It is the lowest mode of the bridge, inside the band of walking pace.'},
  {id: 'si-suspension.modes.stepped', test: T.release, title: 'First antisymmetric mode: time-stepped against the eigenvalue solve', quantity: 'frequency', unit: 'Hz',
    reference: {formula: 'lowest root of K_t x = w^2 M x', value: null}, tolerance: relative(2e-3), measure: async () => { const r = await measureRelease(); return {value: r.measured, reference: r.reference}; },
    note: 'Released from +-20 kN at the quarter points, undamped, 4 s, modal coordinate.'},

  {id: 'si-suspension.crowd.tension', test: T.crowd, title: '3 kN/m^2 on the west half: time-stepped against the statics', quantity: 'largest segment tension error (fraction)', unit: '1',
    reference: {formula: 'Newton statics of the same structure', value: 0}, tolerance: upper(1e-6), measure: async () => (await measureCrowd()).tension,
    note: 'The cable network is solved with the frame each step (StructureCoupling joint step): at rest the two agree to the solvers\' stopping tolerances.'},
  {id: 'si-suspension.crowd.deflection', test: T.crowd, title: '3 kN/m^2 on the west half: deck deflection against the statics', quantity: 'largest deck deflection error', unit: 'm',
    reference: {formula: 'Newton statics of the same structure', value: 0}, tolerance: upper(1e-7), measure: async () => (await measureCrowd()).deflection},
  {id: 'si-suspension.crowd.reactions', test: T.crowd, title: '3 kN/m^2 on the west half: the supports carry structure and crowd', quantity: 'sum of vertical reactions / (weight + crowd)', unit: '1',
    reference: {formula: '1', value: 1}, tolerance: relative(1e-6), measure: async () => (await measureCrowd()).vertical},
  {id: 'si-suspension.mirror.stepped', test: T.mirror, title: 'Mirrored crowds give mirrored tensions (time-stepped)', quantity: 'largest difference between mirror-image segments (fraction)', unit: '1',
    reference: {formula: 'T_i(west) = T_mirror(i)(east)', value: 0}, tolerance: upper(1e-6), measure: async () => (await measureMirror()).stepped.tension},
  {id: 'si-suspension.failure.statics', test: T.failure, title: 'A hanger fails: the others against the damaged statics', quantity: 'largest segment tension error (fraction)', unit: '1',
    reference: {formula: 'Newton statics without that hanger', value: 0}, tolerance: upper(1e-4), measure: async () => (await measureFailure()).tension,
    note: 'Hanger 12 of the west cable fails at 0.25 s; readings 3 s later. Its two neighbours each take about half of its load (+50 %).'},
  {id: 'si-suspension.failure.reactions', test: T.failure, title: 'A hanger fails: the supports keep the weight', quantity: 'sum of vertical reactions / weight', unit: '1',
    reference: {formula: '1', value: 1}, tolerance: relative(1e-5), measure: async () => (await measureFailure()).reaction},
  {id: 'si-suspension.wind.lateral', test: T.wind, title: 'Wind 1.5 kN/m: lateral deflection against the statics', quantity: 'midspan lateral deflection', unit: 'm',
    reference: {formula: 'Newton statics with the wind', value: null}, tolerance: relative(1e-6), measure: async () => { const r = await measureWind(); return {value: r.lateral, reference: r.still}; }},
  {id: 'si-suspension.wind.reactions', test: T.wind, title: 'Wind 1.5 kN/m: the bearings carry the lateral load', quantity: 'sum of lateral reactions / (q L)', unit: '1',
    reference: {formula: '1', value: 1}, tolerance: relative(1e-6), measure: async () => (await measureWind()).reaction},
  {id: 'si-suspension.vehicle.statics', test: T.vehicle, title: 'A parked 2 t service vehicle (rigid body): against the statics', quantity: 'largest segment tension error (fraction)', unit: '1',
    reference: {formula: 'statics with the vehicle\'s weight shared by the lever rule', value: 0}, tolerance: upper(1e-6), measure: async () => (await vehicle()).tension},
  {id: 'si-suspension.determinism', test: T.repeat, title: 'Determinism: bit-identical repeat', quantity: 'differing bytes of the state', unit: 'bytes',
    reference: {formula: 'two runs, the same inputs', value: 0}, tolerance: upper(0), measure: async () => (await measureRepeat()).different},
]);
