// Shared by tests/physics/si-bridge.test.mjs and validation/domains/si-bridge.mjs: the native world the
// bridge runs on, hand solutions, and small measuring helpers. Not a test file.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {SiBridge} from '../../src/engine/si-bridge.ts';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
let pool = null;
/** An empty SI world of the single-threaded Box3D artifact (gravity 9.81 m/s^2 down, no ground). */
export async function freshWorld() {
  if (!pool) {
    const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? resolve(root, 'public/box3d'));
    const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')).href);
    pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
  }
  const world = pool.createWorld();
  world.resetWorld({ground: false, gravity: [0, -9.81, 0]});
  return world;
}
/** Build a bridge on a fresh world, hand it to `use`, and release both. */
export async function withBridge(layout, options, use) {
  const world = await freshWorld();
  let bridge = null;
  try { bridge = new SiBridge(world, layout, options); return await use(bridge, world); }
  finally { bridge?.dispose(); world.destroy(); }
}

/** Step `settle` times, then return the means of the outputs over `window` further steps. Means, because the frame's
 * midpoint rule does not damp its stiffest modes and one instant carries their ripple (docs/STRUCTURE_COUPLING.md). */
export function settledMeans(bridge, settle, window) {
  for (let i = 0; i < settle; i++) bridge.step();
  const out = bridge.out, mean = {
    tension: new Float64Array(out.stayTension.length), deflection: new Float64Array(out.deckDeflection.length), lateral: new Float64Array(out.deckLateral.length),
    moment: new Float64Array(out.deckMoment.length), towerBase: new Float64Array(out.towerBase.length), reaction: [0, 0, 0], frameReaction: [0, 0, 0], midspan: 0,
  };
  const add = (target, source) => { for (let i = 0; i < target.length; i++) target[i] += source[i] / window; };
  for (let i = 0; i < window; i++) {
    bridge.step();
    add(mean.tension, out.stayTension); add(mean.deflection, out.deckDeflection); add(mean.lateral, out.deckLateral); add(mean.moment, out.deckMoment);
    add(mean.towerBase, out.towerBase); add(mean.reaction, out.totalReaction); mean.midspan += out.midspanDeflection / window;
    // The frame solver's own reactions, which include inertia: an independent reading of the same supports.
    const r = bridge.frame.inspect().supportReactions;
    for (let j = 0; j < r.length; j += 6) for (let k = 0; k < 3; k++) mean.frameReaction[k] += r[j + k] / window;
  }
  return mean;
}

/** Frequency (Hz) of a signal from its upward zero crossings, with linear interpolation. */
export function crossingFrequency(samples, dt) {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings.push(i - 1 - samples[i - 1] / (samples[i] - samples[i - 1]));
  return {hertz: (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * dt), periods: crossings.length - 1};
}

/**
 * Hand solution of the propped span (proppedSpanLayout): a simply supported deck of span L, propped at midspan by one
 * stay from the top of a column of height H clamped at the left support. One redundant, the stay force T
 * (flexibility method). Downward deflections are positive.
 *
 *   deck at midspan      delta   = 5 w L^4 / (384 E I) + (We - T sin) L^3 / (48 E I) + P g(L/2, x_P)
 *   deck shortening      u_d     = T cos (L/2) / (E A)_deck           (the pin is at x = 0)
 *   column top, sway     Delta_t = T cos H^3 / (3 E I)_column
 *   column top, down     delta_t = (T sin + We) H / (E A)_column + w_t H^2 / (2 (E A)_column)
 *   stay stretch         e       = T L_s / (E A)_stay = sin (delta - delta_t) - cos (u_d + Delta_t)
 *
 * with w the deck's weight per metre, We half the stay's weight (lumped on each end), P a point load at x_P and
 * g the simply supported beam's influence function. That is linear in T. With `exact` the stay's chord (length and
 * direction) is taken between the displaced end points and the equations are iterated to a fixed point: the same
 * beam formulas with the stay geometry no longer linearised.
 */
export function proppedSpanHand({span: L, towerHeight: H, deck, tower, stay, gravity, load = 0, loadX = 0, exact = false}) {
  const a = L / 2, Ls = Math.hypot(a, H), EI = deck.youngModulus * deck.iz, EAd = deck.youngModulus * deck.area;
  const EIt = tower.youngModulus * tower.iz, EAt = tower.youngModulus * tower.area, EAs = stay.youngModulus * stay.area;
  const w = deck.massPerMetre * gravity, wt = tower.massPerMetre * gravity, We = stay.massPerMetre * Ls * gravity / 2;
  const influence = (x, xi) => { if (x > xi) [x, xi] = [xi, x]; const b = L - xi; return b * x * (L * L - b * b - x * x) / (6 * L * EI); };
  const free = 5 * w * L ** 4 / (384 * EI) + We * L ** 3 / (48 * EI) + load * influence(a, loadX);
  let cos = a / Ls, sin = H / Ls;
  const flexibility = () => Ls / EAs + sin * sin * L ** 3 / (48 * EI) + sin * sin * H / EAt + cos * cos * a / EAd + cos * cos * H ** 3 / (3 * EIt);
  let T = sin * (free - We * H / EAt - wt * H * H / (2 * EAt)) / flexibility(), delta = free - T * sin * L ** 3 / (48 * EI);
  if (exact) for (let i = 0; i < 200; i++) {
    const deckX = a - T * cos * a / EAd, deckY = -delta, topX = T * cos * H ** 3 / (3 * EIt), topY = H - (T * sin + We) * H / EAt - wt * H * H / (2 * EAt);
    const length = Math.hypot(deckX - topX, deckY - topY);
    cos = (deckX - topX) / length; sin = (topY - deckY) / length;
    const next = EAs * (length - Ls) / Ls, change = Math.abs(next - T);
    // Under-relax: the stay is stiff next to the beam, so the plain fixed point converges slowly.
    T += (next - T) / (1 + EAs / Ls * (sin * sin * L ** 3 / (48 * EI) + cos * cos * H ** 3 / (3 * EIt)));
    delta = free - T * sin * L ** 3 / (48 * EI);
    if (change <= 1e-12 * T) break;
  }
  return {tension: T, deflection: delta, freeDeflection: free, stayLength: Ls};
}
