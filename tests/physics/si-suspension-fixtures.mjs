// Shared by tests/physics/si-suspension.test.mjs and validation/domains/si-suspension.mjs: hand solutions for the
// suspension footbridge (src/engine/si-suspension.ts) and small helpers. Not a test file.
import {SiSuspensionBridge, SiSuspensionStatics, suspensionLayout} from '../../src/engine/si-suspension.ts';

let cached = null;
/** The default layout and its statics (form-finding takes about 0.3 s), shared by every reader. */
export function defaultStatics() {
  if (!cached) { const layout = suspensionLayout(), statics = new SiSuspensionStatics(layout); cached = {layout, statics, dead: statics.dead}; }
  return cached;
}
export const segmentOf = (layout, kind, side, station) => layout.segments.findIndex(s => s.kind === kind && s.side === side && s.station === station);
/** Mean vertical displacement of the two girders at a station. */
export const deckAt = (layout, u, station) => (u[6 * layout.girders[0][station] + 1] + u[6 * layout.girders[1][station] + 1]) / 2;

/** Deck mass per metre (girders with what they carry, crossbeams, bracing) plus main cables and hangers, kg/m. */
export function spanMass(statics) {
  const L = statics.layout;
  let mass = 0;
  statics.elements.forEach((e, i) => { if (['girder', 'crossbeam', 'bracing'].includes(L.members[i])) mass += e.mass; });
  L.segments.forEach((s, i) => { if (s.kind !== 'backstay') mass += statics.segmentMass(i); });
  return mass / L.params.span;
}
/** Sum of the vertical loads one main cable carries at its points (hanger tensions, half the hangers' weight, the cable's weight), N. */
export function cableLoad(statics, state, side = 0) {
  const L = statics.layout, g = statics.gravity, N = L.params.panels;
  let total = 0;
  for (let j = 1; j < N; j++) {
    const h = L.hangers[side][j];
    total += state.tensions[h] + statics.segmentMass(h) * g / 2 + (statics.segmentMass(segmentOf(L, 'main', side, j)) + statics.segmentMass(segmentOf(L, 'main', side, j + 1))) * g / 2;
  }
  return total;
}
/** Longitudinal stiffness of a saddle, N/m: its backstay's axial stiffness along the bridge plus the column as a cantilever. */
export function saddleStiffness(layout) {
  const p = layout.params, EA = p.mainCable.youngModulus * p.mainCable.area;
  const l = Math.hypot(p.anchorX - p.span / 2, p.saddleY - p.anchorY, p.anchorZ - p.halfWidth), c = (p.anchorX - p.span / 2) / l;
  return EA / l * c * c + 3 * p.column.youngModulus * p.column.iz / (p.saddleY - p.towerBaseY) ** 3;
}
/**
 * The linearised deflection theory of a suspension bridge with a stiffening deck pinned at both ends (Timoshenko,
 * "Theory of suspension bridges", 1930; Bleich): EI v'''' - H v'' = p - (8 f / L^2) h, with the extra horizontal cable
 * force h from the cable's compatibility h (L_e / EA + 2 / k_s) = (8 f / L^2) integral v dx per cable, L_e = L (1 + 8 (f/L)^2),
 * k_s the longitudinal stiffness of a saddle. Fourier sine series; downward positive. Point loads `loads`: [{P, a}] with a from
 * the west end. Hangers inextensible, the deck's mass and the cable's weight carried by the cable (H from dead load).
 */
export function deflectionTheory({EI, H, f, L, EAcable, saddle, loads, cables = 2, terms = 600}) {
  const c = 8 * f / L ** 2, Le = L * (1 + 8 * (f / L) ** 2), flex = (Le / EAcable + 2 / saddle) / cables;
  const coefficients = [];
  let A = 0, B = 0;
  for (let n = 1; n <= terms; n++) {
    const k = n * Math.PI / L, D = EI * k ** 4 + H * k * k;
    let pn = 0; for (const {P, a} of loads) pn += 2 / L * P * Math.sin(k * a);
    const cn = n % 2 ? 4 / (n * Math.PI) : 0;
    coefficients.push([pn / D, cn / D]);
    if (n % 2) { A += 2 * L / (n * Math.PI) * pn / D; B += 2 * L / (n * Math.PI) * cn / D; }
  }
  const h = c * A / (flex + c * c * B);
  return {h, deflection: x => { let v = 0; coefficients.forEach(([u, w], i) => { v += (u - h * c * w) * Math.sin((i + 1) * Math.PI * x / L); }); return v; }};
}
/** Frequency of the n-th antisymmetric vertical mode (n even) by the tensioned-beam closed form: the cable keeps its
 * length, so it adds only the string stiffness of its dead-load tension. f = sqrt((EI k^4 + H k^2) / m) / (2 pi), k = n pi / L. */
export function antisymmetricFrequency({EI, H, m, L, n = 2}) { const k = n * Math.PI / L; return Math.sqrt((EI * k ** 4 + H * k * k) / m) / (2 * Math.PI); }

/** Step `settle` times, then return means of the outputs over `window` steps. */
export function settledMeans(bridge, settle, window) {
  for (let i = 0; i < settle; i++) bridge.step();
  const out = bridge.out, mean = {tension: new Float64Array(out.tension.length), deflection: new Float64Array(out.deckDeflection.length), lateral: new Float64Array(out.deckLateral.length), reaction: [0, 0, 0], midspan: 0};
  const add = (target, source) => { for (let i = 0; i < target.length; i++) target[i] += source[i] / window; };
  for (let i = 0; i < window; i++) {
    bridge.step();
    add(mean.tension, out.tension); add(mean.deflection, out.deckDeflection); add(mean.lateral, out.deckLateral);
    for (let k = 0; k < 3; k++) mean.reaction[k] += out.totalReaction[k] / window;
    mean.midspan += out.midspanDeflection / window;
  }
  return mean;
}
/** Build a bridge (on `world`, or with no rigid world), hand it to `use`, and release it. */
export async function withSuspension(layout, options, use, world = null) {
  let bridge = null;
  try { bridge = new SiSuspensionBridge(world, layout, options); return await use(bridge); }
  finally { bridge?.dispose(); }
}
/** Largest relative difference of segment tensions, and largest deck deflection difference (m), against a static state. */
export function againstStatics(layout, mean, state, skip = []) {
  let tension = 0, deflection = 0;
  for (let i = 0; i < mean.tension.length; i++) if (!skip.includes(i) && state.tensions[i] > 0) tension = Math.max(tension, Math.abs(mean.tension[i] / state.tensions[i] - 1));
  for (let j = 0; j < mean.deflection.length; j++) deflection = Math.max(deflection, Math.abs(mean.deflection[j] - deckAt(layout, state.displacements, j)));
  return {tension, deflection};
}
/** Frequency (Hz) from upward zero crossings. */
export function crossingFrequency(samples, dt) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  return (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * dt);
}

// ---------------------------------------------------------------------------------------------
// Measurements, shared by the test file and the validation domain (each runs once per process).
const memo = new Map();
const once = (key, make) => { if (!memo.has(key)) memo.set(key, Promise.resolve().then(make)); return memo.get(key); };
export const HZ = 120;
const sides = [0, 1];

/** Form-finding: deck level at every hanger, the main cable's midspan height, plumb hangers. */
export const measureForm = () => once('form', () => {
  const {layout: L, statics: s, dead} = defaultStatics(), F = 6 * s.frameNodes;
  let plumb = 0;
  for (const side of sides) for (let j = 1; j < L.params.panels; j++) {
    const seg = L.segments[L.hangers[side][j]], a = s.endPosition(seg.a, dead.displacements), b = s.endPosition(seg.b, dead.displacements);
    plumb = Math.max(plumb, Math.hypot(a[0] - b[0], a[2] - b[2]));
  }
  const mid = L.cablePoints[0][L.midStation];
  return {deckLevel: s.form.deckLevel, midHeight: L.points[3 * mid + 1] + dead.displacements[F + 3 * mid + 1], target: L.params.saddleY - L.params.sag, plumb, passes: s.form.passes};
});
/** Dead load: support reactions against the weight (statics). */
export const measureDead = () => once('dead', () => {
  const {statics: s, dead} = defaultStatics(), weight = s.structureMass() * s.gravity, sum = [0, 0, 0];
  for (let i = 0; i < s.frameNodes; i++) for (let k = 0; k < 3; k++) sum[k] += dead.reactions[6 * i + k];
  for (let p = 0; p < s.pointCount; p++) for (let k = 0; k < 3; k++) sum[k] += dead.reactions[6 * s.frameNodes + 3 * p + k];
  return {weight, vertical: sum[1] / weight, horizontal: Math.hypot(sum[0], sum[2]) / weight, residual: dead.residual};
});
/** Main cable, tower tension and hangers under dead load against the parabola and the continuous deck. */
export const measureCable = () => once('cable', () => {
  const {layout: L, statics: s, dead} = defaultStatics(), p = L.params, g = s.gravity, span = p.span, f = p.sag, N = p.panels;
  const load = cableLoad(s, dead), w = load / span, H = s.form.horizontal[0], end = dead.tensions[segmentOf(L, 'main', 0, 1)];
  const panel = span / N, h18 = L.hangers[0][L.midStation];
  // An interior support deep in a long continuous beam with equal panels carries the load of one panel.
  const perPanel = (p.girder.massPerMetre * panel + p.crossbeam.massPerMetre * p.halfWidth + p.bracing.massPerMetre * Math.hypot(panel, 2 * p.halfWidth)) * g + s.segmentMass(h18) * g / 2;
  let endHanger = 0; for (const side of sides) endHanger = Math.max(endHanger, dead.tensions[L.hangers[side][1]] / dead.tensions[L.hangers[side][L.midStation]]);
  return {H, parabola: w * span * span / (8 * f), end, polygon: Math.hypot(H, load / 2), parabolaEnd: w * span * span / (8 * f) * Math.sqrt(1 + 16 * (f / span) ** 2),
    hanger: dead.tensions[h18], perPanel, endHanger, backstay: dead.tensions[segmentOf(L, 'backstay', 0, 0)], load};
});
/** A point load P = 20 kN on the deck (half on each girder) against the linearised deflection theory. */
export const measurePoint = (kind) => once(`point/${kind}`, () => {
  const {layout: L, statics: s, dead} = defaultStatics(), p = L.params, P = 20e3, F = 6 * s.frameNodes, nodal = new Float64Array(F);
  const stations = kind === 'mid' ? [[L.midStation, 1]] : kind === 'quarter' ? [[L.midStation / 2, 1]] : [[L.midStation / 2, 1], [3 * L.midStation / 2, -1]];
  for (const [station, sign] of stations) for (const side of sides) nodal[6 * L.girders[side][station] + 1] = -sign * P / 2;
  const state = s.solve({nodal}), station = stations[0][0], x = L.stationX[station] + p.span / 2;
  const deflection = deckAt(L, dead.displacements, station) - deckAt(L, state.displacements, station);
  const theory = deflectionTheory({EI: 2 * p.girder.youngModulus * p.girder.iz, H: 2 * s.form.horizontal[0], f: p.sag, L: p.span, EAcable: p.mainCable.youngModulus * p.mainCable.area, saddle: saddleStiffness(L),
    loads: stations.map(([j, sign]) => ({P: sign * P, a: L.stationX[j] + p.span / 2}))});
  const mid = segmentOf(L, 'main', 0, L.midStation + 1);
  // h: change of the horizontal cable force, both cables, read from the midspan segment (horizontal there).
  const dh = 2 * (state.tensions[mid] - dead.tensions[mid]);
  return {deflection, theory: theory.deflection(x), h: dh, hTheory: theory.h};
});
/** Natural frequencies: the eigenvalue solve against the tensioned-beam closed form for the antisymmetric modes. */
export const measureModes = () => once('modes', () => {
  const {layout: L, statics: s, dead} = defaultStatics(), p = L.params, modes = s.modes(8, dead);
  const antisymmetric = modes.frequencies.map((f, i) => ({f, i, shape: modes.shapes[i], vertical: modes.character[i].vertical}))
    .filter(m => m.vertical > .5 && Math.sign(m.shape[6 * L.girders[0][9] + 1]) !== Math.sign(m.shape[6 * L.girders[0][27] + 1]));
  const symmetric = modes.frequencies.map((f, i) => ({f, i, shape: modes.shapes[i], vertical: modes.character[i].vertical}))
    .filter(m => m.vertical > .5 && Math.sign(m.shape[6 * L.girders[0][9] + 1]) === Math.sign(m.shape[6 * L.girders[0][27] + 1]));
  const closed = antisymmetricFrequency({EI: 2 * p.girder.youngModulus * p.girder.iz, H: 2 * s.form.horizontal[0], m: spanMass(s), L: p.span, n: 2});
  return {modes, antisymmetric: antisymmetric[0], symmetric: symmetric[0], closed, mass: spanMass(s)};
});

/** A crowd of 3 kN/m^2 on the west half: the time-stepped model against its statics, and the reactions. */
export const measureCrowd = () => once('crowd', () => {
  const {layout: L} = defaultStatics(), crowd = {pressure: 3000, from: 0, to: L.params.panels / 2};
  return withSuspension(L, {hz: HZ, damping: 4, cableDamping: 2, crowd}, bridge => {
    const mean = settledMeans(bridge, 2 * HZ, HZ / 2), state = bridge.statics.solve({crowd});
    const crowdWeight = crowd.pressure * 2 * L.params.halfWidth * L.params.span / 2;
    return {...againstStatics(L, mean, state), vertical: mean.reaction[1] / (bridge.totalWeight() + crowdWeight), horizontal: Math.hypot(mean.reaction[0], mean.reaction[2]) / bridge.totalWeight(),
      peak: Math.min(...mean.deflection), staticPeak: Math.min(...Array.from(L.stationX, (_, j) => deckAt(L, state.displacements, j)))};
  });
});
/** Released from antisymmetric point loads: the first antisymmetric vertical mode, time-stepped, against the eigenvalue solve. */
export const measureRelease = () => once('release', async () => {
  const {layout: L, statics: s} = defaultStatics(), modes = await measureModes(), P = 20e3, release = new Float64Array(6 * s.frameNodes);
  for (const side of sides) { release[6 * L.girders[side][9] + 1] = -P / 2; release[6 * L.girders[side][27] + 1] = P / 2; }
  return withSuspension(L, {hz: HZ, damping: 0, cableDamping: 0, releaseLoad: release}, bridge => {
    // The modal coordinate phi^T M (u - u_rest) of the first antisymmetric vertical mode.
    const weights = s.modalWeights(modes.antisymmetric.shape), u = new Float64Array(s.size), samples = [];
    const coordinate = field => { let sum = 0; for (let j = 0; j < weights.length; j++) sum += weights[j] * field[j]; return sum; }, rest = coordinate(bridge.initial.displacements);
    for (let i = 0; i < 4 * HZ; i++) { bridge.step(); samples.push(coordinate(bridge.displacements(u)) - rest); }
    return {measured: crossingFrequency(samples, bridge.dt), reference: modes.antisymmetric.f};
  });
});
/** Symmetry: a crowd on the west third and one on the east third give mirror-image answers (statics and time-stepped). */
export const measureMirror = () => once('mirror', async () => {
  const {layout: L, statics: s} = defaultStatics(), N = L.params.panels, west = {pressure: 3000, from: 0, to: N / 3}, east = {pressure: 3000, from: 2 * N / 3, to: N};
  const mirrorSegment = i => { const seg = L.segments[i]; const station = seg.kind === 'hanger' ? N - seg.station : seg.kind === 'main' ? N + 1 - seg.station : N - seg.station; return segmentOf(L, seg.kind, seg.side, station); };
  const compare = (ta, tb, da, db) => {
    let tension = 0, deflection = 0;
    for (let i = 0; i < ta.length; i++) tension = Math.max(tension, Math.abs(ta[i] - tb[mirrorSegment(i)]) / Math.max(ta[i], 1));
    for (let j = 0; j <= N; j++) deflection = Math.max(deflection, Math.abs(da(j) - db(N - j)));
    return {tension, deflection};
  };
  const a = s.solve({crowd: west}), b = s.solve({crowd: east});
  const statics = compare(a.tensions, b.tensions, j => deckAt(L, a.displacements, j), j => deckAt(L, b.displacements, j));
  const run = crowd => withSuspension(L, {hz: HZ, damping: 4, cableDamping: 2, crowd}, bridge => settledMeans(bridge, 2 * HZ, HZ / 2));
  const ma = await run(west), mb = await run(east);
  return {statics, stepped: compare(ma.tension, mb.tension, j => ma.deflection[j], j => mb.deflection[j])};
});
/** A hanger lets go: the time-stepped model settles to the static re-solve without it; the reactions keep the weight. */
export const measureFailure = () => once('failure', () => {
  const {layout: L} = defaultStatics(), hanger = L.hangers[0][12];
  return withSuspension(L, {hz: HZ, damping: 8, cableDamping: 4, failures: [{segment: hanger, time: .25}]}, bridge => {
    const intact = bridge.initial, mean = settledMeans(bridge, 3 * HZ, HZ / 2), damaged = bridge.statics.solve({failed: [hanger]}, intact.displacements);
    const neighbours = [L.hangers[0][11], L.hangers[0][13]];
    return {...againstStatics(L, mean, damaged, [hanger]), failed: bridge.failed.slice(), reaction: mean.reaction[1] / bridge.totalWeight(),
      neighbourGain: neighbours.map(i => mean.tension[i] / intact.tensions[i]), neighbourStatic: neighbours.map(i => damaged.tensions[i] / intact.tensions[i]),
      sag: deckAt(L, damaged.displacements, 12) - deckAt(L, intact.displacements, 12)};
  });
});
/** Wind 1.5 kN/m on the deck: the time-stepped lateral deflection against the statics, and the lateral reactions. */
export const measureWind = () => once('wind', () => {
  const {layout: L} = defaultStatics(), q = 1500;
  return withSuspension(L, {hz: HZ, damping: 4, cableDamping: 2, windLoad: q}, bridge => {
    const mean = settledMeans(bridge, 2 * HZ, HZ / 2), still = bridge.initial, j = L.midStation;
    const lateral = (still.displacements[6 * L.girders[0][j] + 2] + still.displacements[6 * L.girders[1][j] + 2]) / 2;
    return {lateral: mean.lateral[j], still: lateral, reaction: mean.reaction[2] / (-q * L.params.span)};
  });
});
/** A parked 2 t service vehicle (a rigid body in the Box3D world) against the statics with its weight at that place. */
export const measureVehicle = world => once('vehicle', () => {
  const {layout: L} = defaultStatics();
  return withSuspension(L, {hz: HZ, damping: 4, cableDamping: 2, vehicle: {mass: 2000, speed: 0, start: -5.3}}, bridge => {
    const mean = settledMeans(bridge, 2 * HZ, HZ / 2), state = bridge.statics.solve({vehicle: {x: -5.3, weight: bridge.vehicle.mass * bridge.gravity}});
    return {...againstStatics(L, mean, state), vertical: mean.reaction[1] / bridge.totalWeight()};
  }, world);
});
/** Two runs with a crowd that changes mid-run and a failing hanger are bit-identical. */
export const measureRepeat = () => once('repeat', async () => {
  const {layout: L} = defaultStatics();
  const run = () => withSuspension(L, {hz: HZ, windLoad: 800, failures: [{segment: L.hangers[1][20], time: .2}]}, bridge => {
    for (let i = 0; i < HZ / 2; i++) { if (i === 30) bridge.setCrowd({pressure: 2500, from: 6, to: 24}); bridge.step(); }
    return bridge.stateBytes();
  });
  const a = await run(), b = await run();
  let different = a.length === b.length ? 0 : 1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) different++;
  return {different, bytes: a.length};
});
