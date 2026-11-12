// Woven fabric in the calibrated cloth (src/engine/cloth.ts): orthotropic membrane, tension-only edge cables and
// strength-based tearing, against closed forms. SI units. Measured values are printed (`--test-reporter=spec`);
// docs/CLOTH.md and docs/STUDIO_CANOPY.md quote them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Cloth, clothGrid} from '../../src/engine/cloth.ts';
import {fabricMaterial} from '../../src/engine/materials.ts';
import {encodeState, decodeState} from '../../src/engine/checkpoint.ts';

const FABRIC = {warp: 1225e3, weft: 1000e3, shear: 30e3, poissonRatio: 0.35};
const close = (a, b, rel, label = '') => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${label} ${a} vs ${b} (${(a / b - 1).toExponential(2)})`);
/** A material for Cloth with an orthotropic membrane, warp along `dir`. */
const fabric = (dir, extra = {}) => ({arealDensity: 1.35, youngModulus: 1e9, thickness: 1e-3, poissonRatio: 0.3, bending: 'none',
  orthotropic: {...FABRIC, warpDirection: dir}, ...extra});

/** A strip L x W in the xz plane, pulled along x by a line force T (N/m) on the end x = L, held at x = 0 (x only, one node fully). */
function strip(dir, T, {L = 1, W = 0.2, nx = 10, nz = 2, extra = {}} = {}) {
  const g = clothGrid({nx, ny: nz, u: [L, 0, 0], v: [0, 0, W], origin: [0, 0, 0], diagonal: 'alternate'});
  const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: fabric(dir, extra), config: {dt: 1, gravity: [0, 0, 0]}});
  for (let j = 0; j <= nz; j++) cloth.pin(g.node(0, j));
  // The pinned end also holds the strip's width: release the lateral contraction by pulling with equal nodal shares on a free end.
  for (let j = 0; j <= nz; j++) cloth.setNodalForce(g.node(nx, j), [T * W / nz * (j === 0 || j === nz ? 0.5 : 1), 0, 0]);
  return {cloth, g};
}
const endStrain = ({cloth, g}, nx, nz, L) => { let s = 0; for (let j = 0; j <= nz; j++) s += cloth.positions[3 * g.node(nx, j)] - L; return s / (nz + 1) / L; };

test('uniaxial strip along the warp, the weft and at 45 degrees: strain = T / E_dir (orthotropic compliance)', () => {
  const T = 1000, rows = [];
  // Small strain (1e-3): the Green strain against engineering strain differs by 0.05%.
  const E45 = 1 / ((1 / FABRIC.warp + 1 / FABRIC.weft + 1 / FABRIC.shear - 2 * FABRIC.poissonRatio / FABRIC.warp) / 4);
  for (const [name, dir, E] of [['warp', [1, 0, 0], FABRIC.warp], ['weft', [0, 0, 1], FABRIC.weft], ['45', [1, 0, 1], E45]]) {
    const s = strip(dir, T, {nx: 20, nz: 4, L: 1, W: 0.2});
    // Fixing the end x = 0 holds the width there; a long strip (L / W = 5) and the middle third measure the free uniaxial state.
    s.cloth.solveStatic();
    const x = s.cloth.positions, a = s.g.node(7, 2), b = s.g.node(13, 2), eps = (x[3 * b] - x[3 * a]) / 0.3 - 1;
    rows.push(`${name}: ${eps.toExponential(5)} vs ${(T / E).toExponential(5)}`);
    // 45 degrees: the end clamp restrains the shear coupling; the middle third is within 2% of the free value. Warp and weft 0.2%.
    close(eps, T / E, name === '45' ? 0.02 : 0.002, name);
  }
  console.log('# ' + rows.join('; '));
});

test('a long strip under pressure takes a circular arc: T = p R with the weft stiffness in plane strain', () => {
  // Strip of span S across x (the weft), long along z, pinned on its two long edges, pressure p.
  const S = 1, B = 6, nx = 16, nz = 48, p = 2000;
  const g = clothGrid({nx, ny: nz, u: [S, 0, 0], v: [0, 0, B], origin: [0, 0, 0], diagonal: 'alternate'});
  const pinned = []; for (let j = 0; j <= nz; j++) pinned.push(g.node(0, j), g.node(nx, j));
  for (let i = 0; i <= nx; i++) pinned.push(g.node(i, 0), g.node(i, nz));
  const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: fabric([0, 0, 1]), config: {dt: 1, gravity: [0, 0, 0]}, pinned});
  cloth.setPressure(p);
  cloth.solveStatic();
  // Closed form: T = p R, plane strain along x with no strain along z: T = Q22 eps, Q22 = E_weft / (1 - nu12 nu21) in x here.
  const n21 = FABRIC.poissonRatio * FABRIC.weft / FABRIC.warp, Q = FABRIC.weft / (1 - FABRIC.poissonRatio * n21);
  // Arc of half-angle a: S / 2 = R sin a, length 2 R a = S (1 + eps) (engineering strain); solve for R.
  let lo = S / 2 * 1.0000001, hi = 1e6;
  for (let k = 0; k < 200; k++) { const R = Math.sqrt(lo * hi), a = Math.asin(S / (2 * R)), eps = p * R / Q; if (2 * R * a > S * (1 + eps)) lo = R; else hi = R; }
  const R = Math.sqrt(lo * hi), a = Math.asin(S / (2 * R)), rise = R * (1 - Math.cos(a));
  const mid = g.node(nx / 2, nz / 2), measured = Math.abs(cloth.positions[3 * mid + 1]);
  console.log(`# pressurised strip: mid-span rise ${(measured * 1e3).toFixed(3)} mm, arc ${(rise * 1e3).toFixed(3)} mm (R ${R.toFixed(3)} m, T ${(p * R / 1e3).toFixed(3)} kN/m)`);
  // 1%: the Green strain against the engineering strain of the arc (eps ~ 3e-3), and 16 cells across the span.
  close(measured, rise, 0.01, 'rise');
});

test('a pretensioned square membrane under a small uniform load: Fourier series of T laplacian(w) = -q; reactions equal the load', () => {
  // Isotropic pretension from a shrunk rest shape: a square a x a held on its edges, rest side a (1 - e0).
  const a = 2, n = 24, e0 = 2e-3, q = 50, E = 600e3, nu = 0.3;
  const g = clothGrid({nx: n, ny: n, u: [a, 0, 0], v: [0, 0, a], origin: [0, 0, 0], diagonal: 'alternate'});
  const rest = Float64Array.from(g.positions, (v, i) => i % 3 === 1 ? v : (v - a / 2) * (1 - e0) + a / 2);
  const pinned = []; for (let i = 0; i <= n; i++) pinned.push(g.node(i, 0), g.node(i, n), g.node(0, i), g.node(n, i));
  const cloth = new Cloth({positions: g.positions, restPositions: rest, triangles: g.triangles, pinned: [...new Set(pinned)],
    material: {arealDensity: 1, youngModulus: E, thickness: 1, poissonRatio: nu, bending: 'none'}, config: {dt: 1, gravity: [0, 0, 0]}});
  const h = a / n;
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) cloth.setNodalForce(g.node(i, j), [0, -q * h * h, 0]);
  cloth.solveStatic();
  // Biaxial pretension of an isotropic membrane: T = E t e / (1 - nu) with the strain of the shrunk rest shape, e = 1 / (1 - e0) - 1.
  const e = 1 / (1 - e0) - 1, T = E * (e + 0.5 * e * e) / (1 - nu);
  let w = 0; for (let m = 1; m < 200; m += 2) for (let k = 1; k < 200; k += 2) w += 16 * q / (Math.PI ** 2 * m * k * T * ((m * Math.PI / a) ** 2 + (k * Math.PI / a) ** 2)) * Math.sin(m * Math.PI / 2) * Math.sin(k * Math.PI / 2);
  const measured = -cloth.positions[3 * g.node(n / 2, n / 2) + 1];
  const R = cloth.totalReaction(), load = q * h * h * (n - 1) ** 2;
  console.log(`# square membrane: centre ${(measured * 1e3).toFixed(4)} mm, series ${(w * 1e3).toFixed(4)} mm; reactions ${R[1].toFixed(4)} N for ${load.toFixed(4)} N of load`);
  // 3%: the load is applied at interior nodes only (a cell's worth short at the edge) and the deflection stiffens the membrane slightly (w / a ~ 2e-3).
  close(measured, w, 0.03, 'centre deflection');
  close(R[1], load, 1e-6, 'vertical reaction');
});

test('edge cables are tension-only bars: a pretensioned cable carries E A (L / L0 - 1) and goes slack in compression', () => {
  const g = clothGrid({nx: 2, ny: 1, u: [1, 0, 0], v: [0, 0, 0.5], origin: [0, 0, 0]});
  const EA = 1e5, factor = 0.99;
  const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: {arealDensity: 1, youngModulus: 1, thickness: 1e-3, poissonRatio: 0.3, bending: 'none'},
    config: {dt: 1, gravity: [0, 0, 0]}, pinned: [g.node(0, 0), g.node(2, 0), g.node(0, 1), g.node(2, 1)], cables: [{nodes: [g.node(0, 0), g.node(1, 0), g.node(2, 0)], axialStiffness: EA, restLengthFactor: factor}]});
  cloth.solveStatic();
  const t = cloth.cableTensions();
  close(t[0], EA * (1 / factor - 1), 2e-3, 'cable tension');
  const slack = new Cloth({positions: g.positions, triangles: g.triangles, material: {arealDensity: 1, youngModulus: 1, thickness: 1e-3, poissonRatio: 0.3, bending: 'none'},
    config: {dt: 1, gravity: [0, 0, 0]}, pinned: [g.node(0, 0), g.node(2, 0), g.node(0, 1), g.node(2, 1)], cables: [{nodes: [g.node(0, 0), g.node(2, 0)], axialStiffness: EA, restLengthFactor: 1.01}]});
  slack.solveStatic();
  assert.equal(slack.cableTensions()[0], 0, 'a long cable is slack');
});

test('tearing: an intact strip fails at its strength times its width; a strip with a slit fails below the net-section load', () => {
  const W = 0.2, L = 0.6, nx = 24, nz = 16, strength = 120e3;
  const run = (slit) => {
    const g = clothGrid({nx, ny: nz, u: [L, 0, 0], v: [0, 0, W], origin: [0, 0, 0], diagonal: 'alternate'});
    let tris = Array.from(g.triangles);
    const cloth = new Cloth({positions: g.positions, triangles: tris, material: fabric([1, 0, 0], {strength: {warp: strength, weft: strength}}), config: {dt: 0.01, gravity: [0, 0, 0], drag: 20}});
    for (let j = 0; j <= nz; j++) cloth.pin(g.node(0, j));
    if (slit) {
      // A slit of half the width across the middle: the triangles on one column, from the edge to the centre, start torn.
      const mask = cloth.tornMask; for (let k = 0; k < tris.length / 3; k++) { const ns = [tris[3 * k], tris[3 * k + 1], tris[3 * k + 2]], is = ns.map(v => v % (nx + 1)), js = ns.map(v => Math.floor(v / (nx + 1)));
        if (Math.min(...is) === nx / 2 && Math.max(...js) <= nz / 2) mask[k] = 1; }
    }
    // Ramp the end force; the step at which the strip parts is the failure load.
    for (let s = 1; s <= 200; s++) {
      const T = strength * s / 160;
      for (let j = 0; j <= nz; j++) cloth.setNodalForce(g.node(nx, j), [T * W / nz * (j === 0 || j === nz ? 0.5 : 1), 0, 0]);
      const before = cloth.tornCount;cloth.step();
      // The first step that tears a triangle beyond the slit (the strip then unzips under the same load).
      if (cloth.tornCount > before) return {T, torn: cloth.tornCount};
    }
    return {T: Infinity, torn: cloth.tornCount};
  };
  const intact = run(false), cut = run(true);
  console.log(`# tearing: intact strip starts to tear at ${(intact.T / 1e3).toFixed(1)} kN/m (strength ${strength / 1e3}), slit of W/2 starts at ${(cut.T / 1e3).toFixed(1)} kN/m (net section ${strength / 2e3})`);
  // The criterion reads the second Piola-Kirchhoff resultant, the end load is nominal: at the 10% strain of failure (120 kN/m on
  // 1225 kN/m) they differ by about the stretch, and the strip's stress lags the ramp by a load increment (0.6%). Band 0.99 to 1.12.
  assert.ok(intact.T >= strength * 0.99 && intact.T <= strength * 1.12, `intact ${intact.T}`);
  // Net section: a strength criterion cannot carry more than strength x (W - slit). The slit tip concentrates the stress, so it
  // starts far earlier. Fracture estimate: an edge crack a = W / 2 has K = sigma sqrt(pi a) F, F(0.5) = 2.82 (Tada); a triangle of
  // size h at the tip averages K / sqrt(2 pi r) over r < h to 2 K / sqrt(2 pi h); it tears when that reaches the strength.
  const a = W / 2, h = W / nz, estimate = strength * Math.sqrt(2 * Math.PI * h) / (2 * Math.sqrt(Math.PI * a) * 2.82);
  console.log(`# slit: LEFM element estimate ${(estimate / 1e3).toFixed(1)} kN/m, measured / estimate ${(cut.T / estimate).toFixed(2)}`);
  assert.ok(cut.T <= strength / 2, `slit ${cut.T} above the net section`);
  // 0.7 to 1.5: the estimate is order-of-magnitude (one-element averaging, the clamped end, the 0.6% load steps). Strength-based
  // tearing is mesh-dependent at a crack tip; refine the mesh and the onset falls as sqrt(h).
  assert.ok(cut.T > 0.7 * estimate && cut.T < 1.5 * estimate, `slit ${cut.T} estimate ${estimate}`);
});

test('a torn, orthotropic cloth with cables resumes from a checkpoint bit for bit', () => {
  const make = () => {
    const g = clothGrid({nx: 8, ny: 8, u: [1, 0, 0], v: [0, 0, 1], origin: [0, 0, 0], diagonal: 'alternate'});
    const cloth = new Cloth({positions: g.positions, triangles: g.triangles, material: fabric([1, 0, 1], {strength: {warp: 2e3, weft: 2e3}}), config: {dt: 1 / 60, drag: 1},
      pinned: [g.node(0, 0), g.node(8, 0), g.node(0, 8), g.node(8, 8)], cables: [{nodes: Array.from({length: 9}, (_, i) => g.node(i, 0)), axialStiffness: 1e6, restLengthFactor: 0.999}]});
    cloth.setPressure(-400);
    return cloth;
  };
  const a = make(); a.step(20); const saved = encodeState(a.saveState()); a.step(20);
  assert.ok(a.tornCount > 0, 'it tore');
  const b = make(); b.restoreState(decodeState(saved)); b.step(20);
  assert.deepEqual(encodeState(b.saveState()), encodeState(a.saveState()));
});

test('fabricMaterial builds the orthotropic membrane and strengths from the library', () => {
  const m = fabricMaterial('pvc-polyester-fabric', {warpDirection: [1, 0, 0], allowUnverified: true});
  assert.equal(m.orthotropic.warp, 1225e3); assert.equal(m.orthotropic.weft, 1000e3); assert.equal(m.strength.warp, 165.5e3); assert.equal(m.arealDensity, 1.35);
  assert.throws(() => fabricMaterial('pvc-polyester-fabric', {warpDirection: [1, 0, 0]}), /unverified/);
  assert.equal(fabricMaterial('pvc-polyester-fabric', {warpDirection: [1, 0, 0], shear: 40e3}).orthotropic.shear, 40e3);
});
