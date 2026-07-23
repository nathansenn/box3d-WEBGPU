import type { AAAStagePrimitive } from './aaa-improvements';
import type { Vec3 } from './math';
import { getSceneById, type ScenePreset } from './scenes';
import type { CameraRig } from './types';

export type MaterialDemoKind = 'metal' | 'glass' | 'concrete' | 'combined';
export type MaterialBoundary = 'perimeter' | 'simple-span' | 'cantilever' | 'four-corner' | 'end-clamped';
export type MaterialLoadPattern = 'center' | 'offset' | 'dual' | 'line' | 'distributed' | 'torsion' | 'edge' | 'pulse';
export type MaterialCrackStyle = 'local' | 'radial' | 'dense' | 'retained' | 'edge' | 'cone' | 'diagonal';
export type MaterialFixtureStyle = 'press' | 'rollers' | 'ram' | 'blast' | 'drop' | 'fatigue' | 'facade' | 'reaction-frame';

export type MaterialDemoRecipe = {
  readonly id: string;
  readonly kind: MaterialDemoKind;
  readonly title: string;
  readonly tagline: string;
  readonly objective: string;
  /** Stable scene ID used by both native and fallback rigid staging. */
  readonly baseSceneId: number;
  /** Physical material preset index; presentation selection is orthogonal. */
  readonly profileVariant: number;
  readonly boundary: MaterialBoundary;
  readonly loadPattern: MaterialLoadPattern;
  readonly loadCenter: readonly [number, number];
  readonly loadRadius: readonly [number, number];
  readonly strikeCenter: readonly [number, number];
  readonly loadScale: number;
  readonly primaryLoad: number;
  readonly ultimateLoad: number;
  readonly primaryStrike: number;
  readonly ultimateStrike: number;
  readonly crackStyle: MaterialCrackStyle;
  readonly fixtureStyle: MaterialFixtureStyle;
  /** Specimen plane; horizontal loads act on Y, vertical loads act on Z. */
  readonly orientation?: 'horizontal' | 'vertical';
  /** Normal-direction sign. -1 is downward/rearward, +1 is upward/forward. */
  readonly loadSign?: -1 | 1;
  readonly span: number;
  readonly depth: number;
  readonly stations: number;
  readonly lanes: number;
  readonly recommendedStress: number;
  readonly duration: number;
  readonly camera: CameraRig;
};

const camera = (yaw: number, pitch: number, distance: number, target: Vec3): CameraRig => ({ yaw, pitch, distance, target });

const METAL_DEMOS: readonly MaterialDemoRecipe[] = [
  {
    id: 'metal-square-punch-forming', kind: 'metal', title: 'Square-Punch Steel Forming',
    tagline: 'A four-edge-clamped galvanized panel forms a controlled bowl beneath a square hydraulic punch, then springs back into a measurable permanent set.',
    objective: 'Resolve elastic bending, plastic flow, punch-footprint shoulders, restrained coating scuff, unload springback, and residual dent telemetry.',
    baseSceneId: 780, profileVariant: 0, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.34], strikeCenter: [0.5, 0.5],
    loadScale: 1, primaryLoad: 0.82, ultimateLoad: 1.42, primaryStrike: 0.90, ultimateStrike: 1.48,
    crackStyle: 'local', fixtureStyle: 'press', span: 24, depth: 8.6, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    camera: camera(-1.04, 0.52, 34, [0, 6.9, 0]),
  },
  {
    id: 'metal-aluminum-hailstorm', kind: 'metal', title: 'Aluminum Hailstorm Panel',
    tagline: 'A lightweight automotive-grade aluminum skin receives offset compact impacts that accumulate into overlapping shallow dimples.',
    objective: 'Show low-mass response, distributed dent accumulation, local work hardening, oil-canning recovery, and non-emissive surface scuff.',
    baseSceneId: 781, profileVariant: 1, boundary: 'perimeter', loadPattern: 'pulse', loadCenter: [0.38, 0.62], loadRadius: [0.10, 0.22], strikeCenter: [0.36, 0.64],
    loadScale: 0.82, primaryLoad: 0.54, ultimateLoad: 1.05, primaryStrike: 0.72, ultimateStrike: 1.08,
    crackStyle: 'local', fixtureStyle: 'drop', span: 22, depth: 9.2, stations: 46, lanes: 11, recommendedStress: 4, duration: 17,
    camera: camera(-0.62, 0.58, 31, [-1.8, 6.8, 1.1]),
  },
  {
    id: 'metal-copper-deep-draw', kind: 'metal', title: 'Copper Deep-Draw Dome',
    tagline: 'A broad punch pulls a ductile copper blank into a deep permanent dome while the clamped perimeter resists draw-in.',
    objective: 'Demonstrate high plastic stretch, broad curvature, large springback contrast, strain redistribution, and minimal brittle separation.',
    baseSceneId: 782, profileVariant: 2, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.34, 0.72], strikeCenter: [0.5, 0.5],
    loadScale: 0.92, primaryLoad: 0.94, ultimateLoad: 1.72, primaryStrike: 0.68, ultimateStrike: 1.22,
    crackStyle: 'local', fixtureStyle: 'press', span: 21, depth: 9.8, stations: 46, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.38, 0.48, 32, [0, 6.7, 0]),
  },
  {
    id: 'metal-door-skin-oblique-dent', kind: 'metal', title: 'Automotive Door-Skin Oblique Dent',
    orientation: 'vertical',
    tagline: 'An off-center elliptical ram drives an asymmetric crease into a thin steel door skin and releases into a visible oil-canning rebound.',
    objective: 'Show oblique load transfer, directional crease formation, asymmetric springback, residual set, and localized coating witness marks.',
    baseSceneId: 780, profileVariant: 0, boundary: 'perimeter', loadPattern: 'offset', loadCenter: [0.66, 0.38], loadRadius: [0.12, 0.30], strikeCenter: [0.68, 0.36],
    loadScale: 0.96, primaryLoad: 0.76, ultimateLoad: 1.36, primaryStrike: 0.94, ultimateStrike: 1.40,
    crackStyle: 'local', fixtureStyle: 'ram', span: 23, depth: 10.2, stations: 48, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-0.42, 0.44, 30, [3.2, 6.9, -1.2]),
  },
  {
    id: 'metal-press-brake-v-bend', kind: 'metal', title: 'Press-Brake V-Bend',
    tagline: 'Twin die shoulders and a narrow line punch create a crisp cold-formed fold with a concentrated plastic hinge.',
    objective: 'Expose line-load curvature, neutral-axis migration, fold localization, unload angle recovery, and retained V-bend geometry.',
    baseSceneId: 780, profileVariant: 0, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.055, 1], strikeCenter: [0.5, 0.5],
    loadScale: 1.08, primaryLoad: 0.88, ultimateLoad: 1.54, primaryStrike: 0.70, ultimateStrike: 1.18,
    crackStyle: 'local', fixtureStyle: 'rollers', span: 24, depth: 5.8, stations: 48, lanes: 9, recommendedStress: 5, duration: 18,
    camera: camera(-1.22, 0.40, 33, [0, 6.8, 0]),
  },
  {
    id: 'metal-four-point-bumper-beam', kind: 'metal', title: 'Four-Point Bumper Beam',
    tagline: 'Two synchronized load noses bend a supported high-strength rail through a constant-moment zone before twin hinge shoulders form.',
    objective: 'Compare dual load paths, broad plastic plateau formation, support reaction, permanent sweep, and late-stage localized damage.',
    baseSceneId: 780, profileVariant: 0, boundary: 'simple-span', loadPattern: 'dual', loadCenter: [0.5, 0.5], loadRadius: [0.08, 0.64], strikeCenter: [0.68, 0.5],
    loadScale: 0.98, primaryLoad: 0.84, ultimateLoad: 1.46, primaryStrike: 0.78, ultimateStrike: 1.28,
    crackStyle: 'local', fixtureStyle: 'rollers', span: 26, depth: 4.8, stations: 48, lanes: 9, recommendedStress: 5, duration: 18,
    camera: camera(-0.92, 0.36, 37, [0, 6.8, 0]),
  },
  {
    id: 'metal-cantilever-overbend', kind: 'metal', title: 'Cantilever Bracket Overbend',
    tagline: 'A single fixed edge forces an offset sheet bracket to rotate through a root plastic hinge under a controlled tip load.',
    objective: 'Demonstrate cantilever rotation, root strain concentration, one-sided plasticity, springback, and retained tip displacement.',
    baseSceneId: 781, profileVariant: 1, boundary: 'cantilever', loadPattern: 'edge', loadCenter: [0.86, 0.5], loadRadius: [0.12, 0.82], strikeCenter: [0.88, 0.5],
    loadScale: 0.90, primaryLoad: 0.72, ultimateLoad: 1.34, primaryStrike: 0.78, ultimateStrike: 1.24,
    crackStyle: 'local', fixtureStyle: 'ram', span: 22, depth: 6.2, stations: 46, lanes: 9, recommendedStress: 4, duration: 17,
    camera: camera(-0.28, 0.46, 30, [4.2, 6.7, 0]),
  },
  {
    id: 'metal-tension-field-shear', kind: 'metal', title: 'Tension-Field Shear Panel',
    orientation: 'vertical',
    tagline: 'Opposing corner demand drives a clamped steel web into diagonal tension-field wrinkling and an X-shaped yield signature.',
    objective: 'Show shear-dominated deformation, diagonal wrinkle formation, opposite-sign loading, edge reaction, and progressive diagonal damage.',
    baseSceneId: 780, profileVariant: 0, boundary: 'four-corner', loadPattern: 'torsion', loadCenter: [0.5, 0.5], loadRadius: [0.72, 0.72], strikeCenter: [0.62, 0.62],
    loadScale: 0.72, primaryLoad: 0.66, ultimateLoad: 1.24, primaryStrike: 0.64, ultimateStrike: 1.06,
    crackStyle: 'diagonal', fixtureStyle: 'fatigue', span: 20, depth: 10.6, stations: 44, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-0.66, 0.62, 32, [0, 6.8, 0]),
  },
  {
    id: 'metal-notched-fatigue', kind: 'metal', title: 'Notched Low-Cycle Fatigue',
    tagline: 'A seeded center notch endures deterministic reversing displacement until a narrow ductile ligament progressively loses capacity.',
    objective: 'Reveal cyclic plasticity, fatigue damage accumulation, notch sensitivity, crack growth, stiffness loss, and final residual deformation.',
    baseSceneId: 780, profileVariant: 0, boundary: 'end-clamped', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.07, 0.86], strikeCenter: [0.5, 0.5],
    loadScale: 0.84, primaryLoad: 0.70, ultimateLoad: 1.30, primaryStrike: 0.68, ultimateStrike: 1.12,
    crackStyle: 'local', fixtureStyle: 'fatigue', span: 24, depth: 5.2, stations: 48, lanes: 9, recommendedStress: 5, duration: 20,
    camera: camera(-1.12, 0.32, 34, [0, 6.9, 0]),
  },
  {
    id: 'metal-blast-bulge-armor', kind: 'metal', title: 'Blast-Bulge Armor Plate',
    orientation: 'vertical',
    tagline: 'A short distributed pressure pulse drives a perimeter-clamped armor plate into a broad dome with radial yield bands.',
    objective: 'Show impulse-driven membrane action, distributed curvature, radial plasticity, rebound, residual bulge, and possible central plug damage.',
    baseSceneId: 780, profileVariant: 0, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.82, 0.82], strikeCenter: [0.5, 0.5],
    loadScale: 1.16, primaryLoad: 0.90, ultimateLoad: 1.64, primaryStrike: 1.06, ultimateStrike: 1.62,
    crackStyle: 'radial', fixtureStyle: 'blast', span: 22, depth: 10.4, stations: 48, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.42, 0.56, 34, [0, 6.8, 0]),
  },
] as const;

const GLASS_DEMOS: readonly MaterialDemoRecipe[] = [
  {
    id: 'glass-annealed-pendulum-impact', kind: 'glass', title: 'Annealed Pendulum Impact',
    tagline: 'A framed annealed pane bows under a soft pendulum strike before long radial cracks release large dagger-shaped shards.',
    objective: 'Show narrow elastic capacity, center nucleation, long radial cracking, large transparent fragments, and gravity-separated residual islands.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.32], strikeCenter: [0.5, 0.5],
    loadScale: 0.84, primaryLoad: 0.16, ultimateLoad: 0.36, primaryStrike: 0.82, ultimateStrike: 1.28,
    crackStyle: 'radial', fixtureStyle: 'facade', span: 24, depth: 8.6, stations: 48, lanes: 13, recommendedStress: 5, duration: 17,
    camera: camera(-1.36, 0.34, 34, [0, 7.2, 0]),
  },
  {
    id: 'glass-tempered-safety-punch', kind: 'glass', title: 'Tempered Safety-Glass Punch',
    tagline: 'A compact punch releases stored surface compression into a dense pebble-sized fracture mosaic with bounded shard energy.',
    objective: 'Demonstrate dense branching, rapid crack-front multiplication, small transparent fragments, safe breakup, and a retained frame perimeter.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.10, 0.18], strikeCenter: [0.5, 0.5],
    loadScale: 0.68, primaryLoad: 0.12, ultimateLoad: 0.28, primaryStrike: 0.94, ultimateStrike: 1.42,
    crackStyle: 'dense', fixtureStyle: 'facade', span: 22, depth: 9.2, stations: 48, lanes: 15, recommendedStress: 5, duration: 17,
    camera: camera(-0.92, 0.38, 31, [0, 7.1, 0]),
  },
  {
    id: 'glass-laminated-stone-strike', kind: 'glass', title: 'Laminated Windshield Stone Strike',
    tagline: 'A small off-center stone produces a spiderweb crack while the laminated pane retains broken islands instead of ejecting a free shard sheet.',
    objective: 'Show localized impact, intersecting radial rings, retained transparent fragments, interlayer-like sag, and limited opening displacement.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'offset', loadCenter: [0.36, 0.62], loadRadius: [0.12, 0.18], strikeCenter: [0.36, 0.62],
    loadScale: 0.62, primaryLoad: 0.10, ultimateLoad: 0.24, primaryStrike: 0.76, ultimateStrike: 1.12,
    crackStyle: 'retained', fixtureStyle: 'facade', span: 23, depth: 8.4, stations: 48, lanes: 13, recommendedStress: 4, duration: 18,
    camera: camera(-0.46, 0.40, 29, [-3.2, 8.0, 0]),
  },
  {
    id: 'glass-edge-chip-runaway', kind: 'glass', title: 'Edge-Chip Runaway Crack',
    tagline: 'A seeded flaw near the frame edge launches an asymmetric crack fan that races across the pane toward the opposite corner.',
    objective: 'Resolve edge-flaw sensitivity, directional crack propagation, asymmetric fragment release, frame interaction, and surviving pane islands.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'edge', loadCenter: [0.14, 0.56], loadRadius: [0.12, 0.30], strikeCenter: [0.12, 0.56],
    loadScale: 0.76, primaryLoad: 0.14, ultimateLoad: 0.32, primaryStrike: 0.72, ultimateStrike: 1.16,
    crackStyle: 'edge', fixtureStyle: 'facade', span: 24, depth: 9.0, stations: 48, lanes: 13, recommendedStress: 5, duration: 17,
    camera: camera(-0.22, 0.36, 30, [-5.2, 7.5, 0]),
  },
  {
    id: 'glass-four-bolt-facade', kind: 'glass', title: 'Four-Bolt Point-Supported Facade',
    tagline: 'Four corner fasteners concentrate demand until a stressed point support seeds a star crack through the floating glass plate.',
    objective: 'Show point-supported boundary response, fastener stress concentration, corner-origin fracture, transparent shard retention, and hardware load paths.',
    baseSceneId: 796, profileVariant: 6, boundary: 'four-corner', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.82, 0.82], strikeCenter: [0.18, 0.18],
    loadScale: 0.82, primaryLoad: 0.16, ultimateLoad: 0.38, primaryStrike: 0.80, ultimateStrike: 1.24,
    crackStyle: 'edge', fixtureStyle: 'facade', span: 22, depth: 9.6, stations: 46, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.72, 0.44, 33, [-3.8, 5.9, 0]),
  },
  {
    id: 'glass-curtain-wall-wind', kind: 'glass', title: 'Curtain-Wall Wind Failure',
    tagline: 'Uniform facade pressure bows an edge-supported lite until a perimeter crack turns into a rapid whole-pane release.',
    objective: 'Demonstrate distributed wind pressure, broad elastic bowing, edge stress, corner crack onset, and outward transparent fragment motion.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.95, 0.95], strikeCenter: [0.78, 0.22],
    loadScale: 0.96, primaryLoad: 0.20, ultimateLoad: 0.46, primaryStrike: 0.72, ultimateStrike: 1.18,
    crackStyle: 'edge', fixtureStyle: 'facade', span: 26, depth: 10.2, stations: 48, lanes: 15, recommendedStress: 5, duration: 19,
    camera: camera(-1.02, 0.42, 38, [0, 7.2, 0]),
  },
  {
    id: 'glass-ballistic-off-center', kind: 'glass', title: 'Ballistic Off-Center Penetration',
    tagline: 'A compact high-speed projectile punches an off-axis opening and drives a directional cone of thin glass fragments into the capture bay.',
    objective: 'Show localized penetration, asymmetric radial cracking, directional shard velocity, clean transparent edges, and bounded perforation growth.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'offset', loadCenter: [0.68, 0.42], loadRadius: [0.08, 0.14], strikeCenter: [0.70, 0.42],
    loadScale: 0.72, primaryLoad: 0.10, ultimateLoad: 0.22, primaryStrike: 1.04, ultimateStrike: 1.66,
    crackStyle: 'radial', fixtureStyle: 'ram', span: 23, depth: 8.8, stations: 48, lanes: 13, recommendedStress: 5, duration: 17,
    camera: camera(-0.58, 0.30, 28, [4.0, 6.6, 0]),
  },
  {
    id: 'glass-blast-overpressure', kind: 'glass', title: 'Blast Overpressure Release',
    tagline: 'A broad pressure pulse bows the framed pane as one membrane before a fast branching front releases an outward shard sheet.',
    objective: 'Resolve whole-pane impulse response, distributed tensile demand, rapid branching, outward fragment field, and pressure-release recovery.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'pulse', loadCenter: [0.5, 0.5], loadRadius: [0.92, 0.92], strikeCenter: [0.5, 0.5],
    loadScale: 1.08, primaryLoad: 0.24, ultimateLoad: 0.52, primaryStrike: 1.02, ultimateStrike: 1.58,
    crackStyle: 'dense', fixtureStyle: 'blast', span: 25, depth: 10.0, stations: 48, lanes: 15, recommendedStress: 5, duration: 18,
    camera: camera(-1.48, 0.48, 37, [0, 7.2, 0]),
  },
  {
    id: 'glass-hail-multi-hit', kind: 'glass', title: 'Hailstone Multi-Hit Pattern',
    tagline: 'Two deterministic compact impacts seed intersecting fracture stars that compete across a wind-loaded architectural lite.',
    objective: 'Show multi-origin cracks, interacting radial fronts, bounded fragment count, frame retention, and distinct first- versus second-hit damage.',
    baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'dual', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.24], strikeCenter: [0.34, 0.62],
    loadScale: 0.70, primaryLoad: 0.12, ultimateLoad: 0.28, primaryStrike: 0.74, ultimateStrike: 1.20,
    crackStyle: 'radial', fixtureStyle: 'drop', span: 24, depth: 9.4, stations: 48, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-0.76, 0.46, 32, [-2.2, 8.1, 0]),
  },
  {
    id: 'glass-thermal-corner-fracture', kind: 'glass', title: 'Thermal Corner Fracture',
    tagline: 'A restrained corner flaw under broad facade bowing launches diagonal cracks between cold-edge and warm-center stress zones.',
    objective: 'Demonstrate corner-origin fracture, diagonal crack bias, restrained edge movement, sparse shard release, and a readable forensic crack map.',
    baseSceneId: 796, profileVariant: 6, boundary: 'end-clamped', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.82, 0.82], strikeCenter: [0.84, 0.82],
    loadScale: 0.78, primaryLoad: 0.15, ultimateLoad: 0.34, primaryStrike: 0.70, ultimateStrike: 1.10,
    crackStyle: 'diagonal', fixtureStyle: 'facade', span: 23, depth: 9.2, stations: 46, lanes: 13, recommendedStress: 4, duration: 18,
    camera: camera(-1.84, 0.38, 32, [4.6, 9.8, 0]),
  },
] as const;

const CONCRETE_DEMOS: readonly MaterialDemoRecipe[] = [
  {
    id: 'concrete-three-point-beam', kind: 'concrete', title: 'RC Three-Point Beam',
    tagline: 'A reinforced span develops a center soffit crack, sheds cover as aggregate-rich spall, and transfers residual demand into exposed steel.',
    objective: 'Show flexural cracking, cover loss, physical rubble, translucent dust, rebar bridging, unload residuals, and deterministic fracture telemetry.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.07, 0.82], strikeCenter: [0.5, 0.5],
    loadScale: 1, primaryLoad: 0.78, ultimateLoad: 1.34, primaryStrike: 0.92, ultimateStrike: 1.48,
    crackStyle: 'local', fixtureStyle: 'reaction-frame', span: 24, depth: 6.8, stations: 48, lanes: 9, recommendedStress: 5, duration: 18,
    camera: camera(-1.18, 0.34, 35, [0, 6.8, 0]),
  },
  {
    id: 'concrete-four-point-beam', kind: 'concrete', title: 'RC Four-Point Constant-Moment Beam',
    tagline: 'Twin load noses produce a broad constant-moment region where multiple vertical cracks share demand before cover spalls.',
    objective: 'Demonstrate distributed flexural cracking, dual actuator load paths, progressive cover loss, steel bridging, and a wide damaged zone.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'dual', loadCenter: [0.5, 0.5], loadRadius: [0.08, 0.78], strikeCenter: [0.66, 0.5],
    loadScale: 0.96, primaryLoad: 0.72, ultimateLoad: 1.30, primaryStrike: 0.86, ultimateStrike: 1.40,
    crackStyle: 'local', fixtureStyle: 'reaction-frame', span: 27, depth: 6.4, stations: 48, lanes: 9, recommendedStress: 5, duration: 19,
    camera: camera(-0.82, 0.36, 39, [0, 6.8, 0]),
  },
  {
    id: 'concrete-flat-slab-punching', kind: 'concrete', title: 'Flat-Slab Punching Shear',
    tagline: 'A central column platen drives a four-corner-supported slab toward an annular punching cone and exposed radial reinforcement.',
    objective: 'Show two-way slab action, concentrated column demand, cone-style breakout, radial cracking, aggregate exposure, and retained bar paths.',
    baseSceneId: 795, profileVariant: 5, boundary: 'four-corner', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.13, 0.28], strikeCenter: [0.5, 0.5],
    loadScale: 1.12, primaryLoad: 0.84, ultimateLoad: 1.48, primaryStrike: 1.02, ultimateStrike: 1.62,
    crackStyle: 'cone', fixtureStyle: 'press', span: 20, depth: 11.2, stations: 46, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.48, 0.62, 35, [0, 6.9, 0]),
  },
  {
    id: 'concrete-slab-drop-weight', kind: 'concrete', title: 'One-Way Slab Drop Weight',
    tagline: 'A compact falling mass excavates a top crater while radial cracks and back-face spall expose mineral aggregate and steel.',
    objective: 'Resolve impact crater formation, local crushing, radial fracture, back-face spall, physical debris, dust, and reinforcement retention.',
    baseSceneId: 795, profileVariant: 5, boundary: 'end-clamped', loadPattern: 'pulse', loadCenter: [0.58, 0.48], loadRadius: [0.12, 0.26], strikeCenter: [0.58, 0.48],
    loadScale: 1.08, primaryLoad: 0.62, ultimateLoad: 1.22, primaryStrike: 1.10, ultimateStrike: 1.72,
    crackStyle: 'radial', fixtureStyle: 'drop', span: 22, depth: 9.4, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    camera: camera(-0.44, 0.54, 32, [1.6, 6.8, 0]),
  },
  {
    id: 'concrete-bridge-deck-wheel', kind: 'concrete', title: 'Bridge-Deck Wheel Patch',
    tagline: 'Twin wheel patches walk across a reinforced deck strip, building flexural cracks and localized punching damage near the loaded lane.',
    objective: 'Show moving load equivalence, dual patch demand, lane-localized damage, aggregate breakout, residual deck curvature, and bar continuity.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'dual', loadCenter: [0.62, 0.34], loadRadius: [0.10, 0.20], strikeCenter: [0.68, 0.34],
    loadScale: 0.88, primaryLoad: 0.70, ultimateLoad: 1.26, primaryStrike: 0.82, ultimateStrike: 1.34,
    crackStyle: 'local', fixtureStyle: 'rollers', span: 28, depth: 9.0, stations: 48, lanes: 11, recommendedStress: 5, duration: 19,
    camera: camera(-0.64, 0.46, 39, [3.0, 6.8, -1.5]),
  },
  {
    id: 'concrete-cantilever-corbel', kind: 'concrete', title: 'Cantilever Corbel Shear',
    tagline: 'A short reinforced corbel carries an edge load into a single reaction face until diagonal shear cracking exposes its steel tie.',
    objective: 'Demonstrate deep-member action, cantilever root demand, diagonal cracking, compact cover spall, aggregate interlock, and steel tie bridging.',
    baseSceneId: 795, profileVariant: 5, boundary: 'cantilever', loadPattern: 'edge', loadCenter: [0.86, 0.5], loadRadius: [0.11, 0.68], strikeCenter: [0.80, 0.5],
    loadScale: 0.92, primaryLoad: 0.74, ultimateLoad: 1.32, primaryStrike: 0.88, ultimateStrike: 1.42,
    crackStyle: 'diagonal', fixtureStyle: 'ram', span: 20, depth: 7.4, stations: 44, lanes: 9, recommendedStress: 5, duration: 18,
    camera: camera(-0.18, 0.42, 29, [4.5, 6.8, 0]),
  },
  {
    id: 'concrete-barrier-impact', kind: 'concrete', title: 'Highway Barrier Impact Strip',
    orientation: 'vertical',
    tagline: 'An eccentric lateral-equivalent strike drives a localized front crater, rear scabbing, and visible reinforcement bridging in a barrier strip.',
    objective: 'Show impact localization, asymmetric crack growth, front and back cover loss, dust, aggregate, and residual steel load transfer.',
    baseSceneId: 795, profileVariant: 5, boundary: 'end-clamped', loadPattern: 'offset', loadCenter: [0.66, 0.40], loadRadius: [0.12, 0.28], strikeCenter: [0.68, 0.40],
    loadScale: 0.94, primaryLoad: 0.68, ultimateLoad: 1.28, primaryStrike: 1.06, ultimateStrike: 1.68,
    crackStyle: 'radial', fixtureStyle: 'ram', span: 24, depth: 8.4, stations: 48, lanes: 11, recommendedStress: 5, duration: 18,
    camera: camera(-0.56, 0.38, 33, [3.4, 6.8, -0.8]),
  },
  {
    id: 'concrete-blast-wall-spall', kind: 'concrete', title: 'Blast-Wall Back-Face Spall',
    orientation: 'vertical',
    tagline: 'A broad impulse bends the reinforced panel and ejects a shallow rear scab while the steel grid preserves a residual load path.',
    objective: 'Resolve distributed impulse, flexural field response, back-face spall, suspended dust, mineral aggregate, and persistent reinforcement.',
    baseSceneId: 795, profileVariant: 5, boundary: 'perimeter', loadPattern: 'distributed', loadCenter: [0.5, 0.5], loadRadius: [0.90, 0.90], strikeCenter: [0.5, 0.5],
    loadScale: 1.10, primaryLoad: 0.82, ultimateLoad: 1.48, primaryStrike: 1.08, ultimateStrike: 1.70,
    crackStyle: 'radial', fixtureStyle: 'blast', span: 23, depth: 10.2, stations: 48, lanes: 13, recommendedStress: 5, duration: 19,
    camera: camera(-1.36, 0.56, 36, [0, 6.8, 0]),
  },
  {
    id: 'concrete-anchor-pullout', kind: 'concrete', title: 'Anchor Pull-Out Cone',
    loadSign: 1,
    tagline: 'A localized anchor demand lifts a conical breakout field from a four-corner-supported slab and reveals radial reinforcement.',
    objective: 'Show concentrated pull-out demand, cone-shaped fracture, radial crack spokes, exposed anchor zone, physical rubble, and steel retention.',
    baseSceneId: 795, profileVariant: 5, boundary: 'four-corner', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.10, 0.22], strikeCenter: [0.5, 0.5],
    loadScale: 1.06, primaryLoad: 0.78, ultimateLoad: 1.42, primaryStrike: 0.98, ultimateStrike: 1.56,
    crackStyle: 'cone', fixtureStyle: 'press', span: 20, depth: 10.6, stations: 46, lanes: 13, recommendedStress: 5, duration: 18,
    camera: camera(-1.72, 0.64, 34, [0, 6.9, 0]),
  },
  {
    id: 'concrete-cyclic-deck-fatigue', kind: 'concrete', title: 'Cyclic Deck Fatigue Strip',
    tagline: 'Repeated service-level displacement accumulates distributed cracks before a final overload sheds cover and exposes working reinforcement.',
    objective: 'Demonstrate fatigue accumulation, crack multiplication, stiffness loss, final overload spall, residual curvature, and intact bar bridging.',
    baseSceneId: 795, profileVariant: 5, boundary: 'simple-span', loadPattern: 'line', loadCenter: [0.5, 0.5], loadRadius: [0.08, 0.78], strikeCenter: [0.5, 0.5],
    loadScale: 0.78, primaryLoad: 0.62, ultimateLoad: 1.24, primaryStrike: 0.76, ultimateStrike: 1.34,
    crackStyle: 'local', fixtureStyle: 'fatigue', span: 26, depth: 7.2, stations: 48, lanes: 9, recommendedStress: 5, duration: 20,
    camera: camera(-1.02, 0.34, 37, [0, 6.8, 0]),
  },
] as const;

const COMBINED_DEMO: MaterialDemoRecipe = {
  id: 'apex-materials-proving-ground', kind: 'combined', title: 'Apex Materials Proving Ground',
  tagline: 'A single cinematic proving hall runs a metal-forming press, backlit ballistic glass tunnel, and reinforced-concrete reaction frame through one coordinated failure sequence.',
  objective: 'Present simultaneous deterministic metal deformation, glass fracture, concrete spall, transparent shards, physical aggregate, dust, surviving reinforcement, and forensic telemetry in one AAA scene.',
  baseSceneId: 796, profileVariant: 6, boundary: 'perimeter', loadPattern: 'center', loadCenter: [0.5, 0.5], loadRadius: [0.16, 0.34], strikeCenter: [0.5, 0.5],
  loadScale: 1, primaryLoad: 0.76, ultimateLoad: 1.42, primaryStrike: 0.92, ultimateStrike: 1.52,
  crackStyle: 'radial', fixtureStyle: 'reaction-frame', span: 24, depth: 8.6, stations: 48, lanes: 13, recommendedStress: 5, duration: 28,
  camera: camera(-0.78, 0.42, 102, [0, 7.0, 0]),
};

export const MATERIAL_DEMO_RECIPES: readonly MaterialDemoRecipe[] = [
  ...METAL_DEMOS,
  ...GLASS_DEMOS,
  ...CONCRETE_DEMOS,
  COMBINED_DEMO,
] as const;

const byId = new Map(MATERIAL_DEMO_RECIPES.map((recipe) => [recipe.id, recipe] as const));

export function getMaterialDemoRecipe(id: string | undefined): MaterialDemoRecipe | null {
  return id ? byId.get(id) ?? null : null;
}

export function materialDemoCounts(): Readonly<Record<MaterialDemoKind, number>> {
  return MATERIAL_DEMO_RECIPES.reduce<Record<MaterialDemoKind, number>>((counts, recipe) => {
    counts[recipe.kind]++;
    return counts;
  }, { metal: 0, glass: 0, concrete: 0, combined: 0 });
}

export function sceneForMaterialDemo(id: string): ScenePreset {
  const recipe = getMaterialDemoRecipe(id);
  if (!recipe) throw new Error(`Unknown material demo recipe: ${id}`);
  const base = getSceneById(recipe.baseSceneId);
  return {
    ...base,
    variant: recipe.profileVariant,
    title: recipe.title,
    subtitle: `${recipe.kind === 'combined' ? 'AAA Materials Finale' : `${recipe.kind[0].toUpperCase()}${recipe.kind.slice(1)} Presentation`} · ${recipe.tagline}`,
    details: recipe.objective,
    defaultStress: recipe.recommendedStress,
    recommendedMaxBodies: Math.max(base.recommendedMaxBodies, recipe.kind === 'combined' ? 2200 : 980),
    camera: { ...recipe.camera, target: [...recipe.camera.target] as Vec3 },
    tags: [
      ...base.tags,
      'material-demo',
      recipe.kind,
      recipe.boundary,
      recipe.loadPattern,
      recipe.crackStyle,
      recipe.fixtureStyle,
      recipe.orientation ?? (recipe.kind === 'glass' ? 'vertical' : 'horizontal'),
    ],
    tourSeconds: recipe.duration,
    materialDemoId: recipe.id,
  };
}

const color = (hex: number, alpha: number): readonly [number, number, number, number] => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
  alpha,
];
const box = (pos: Vec3, half: Vec3, shade: readonly [number, number, number, number], rot: Vec3 = [0, 0, 0]): AAAStagePrimitive => ({ pos, half, rot, color: shade });

const STEEL = color(0x8e9cab, -2);
const DARK_STEEL = color(0x273444, 1);
const CONCRETE = color(0x858783, -1);
const STONE = color(0x77766f, -5);
const GLASS = color(0x83d9ee, -4);
const BLACK = color(0x08111d, 1);
const RED = color(0xb63228, 1);
const AMBER = color(0xffb84c, 3.2);
const CYAN = color(0x4bd8ff, 2.8);

const METAL_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.20, 0], [15, 0.20, 8], CONCRETE),
  box([-13.8, 5.0, -6.8], [0.28, 5, 0.28], DARK_STEEL), box([13.8, 5.0, -6.8], [0.28, 5, 0.28], DARK_STEEL),
  box([-13.8, 5.0, 6.8], [0.28, 5, 0.28], DARK_STEEL), box([13.8, 5.0, 6.8], [0.28, 5, 0.28], DARK_STEEL),
  box([0, 10.0, -6.8], [14.1, 0.24, 0.24], STEEL), box([0, 10.0, 6.8], [14.1, 0.24, 0.24], STEEL),
  box([-7.2, 0.48, -7.0], [5.2, 0.08, 0.12], AMBER), box([7.2, 0.48, -7.0], [5.2, 0.08, 0.12], AMBER),
];

const GLASS_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.20, 0], [15, 0.20, 8], CONCRETE),
  box([0, 7.2, 2.0], [13.4, 5.2, 0.12], BLACK),
  box([-8.4, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN), box([-2.8, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN),
  box([2.8, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN), box([8.4, 7.2, 1.82], [0.32, 4.6, 0.05], CYAN),
  box([0, 0.48, -5.8], [12.8, 0.08, 0.14], AMBER),
  box([-12.8, 1.2, -5.8], [0.14, 1.0, 0.14], RED), box([12.8, 1.2, -5.8], [0.14, 1.0, 0.14], RED),
];

const CONCRETE_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.20, 0], [15, 0.20, 8], STONE),
  box([-13.2, 5.2, -6.8], [0.34, 5.2, 0.34], STEEL), box([13.2, 5.2, -6.8], [0.34, 5.2, 0.34], STEEL),
  box([-13.2, 5.2, 6.8], [0.34, 5.2, 0.34], STEEL), box([13.2, 5.2, 6.8], [0.34, 5.2, 0.34], STEEL),
  box([0, 10.2, -6.8], [13.6, 0.30, 0.30], STEEL), box([0, 10.2, 6.8], [13.6, 0.30, 0.30], STEEL),
  box([-10.5, 0.52, 5.9], [2.4, 0.08, 0.12], AMBER), box([0, 0.52, 5.9], [2.4, 0.08, 0.12], AMBER), box([10.5, 0.52, 5.9], [2.4, 0.08, 0.12], AMBER),
];

const COMBINED_STAGE: readonly AAAStagePrimitive[] = [
  box([0, 0.18, 0], [45, 0.18, 15], STONE),
  box([0, 0.42, 0], [43, 0.10, 13.5], CONCRETE),
  ...[-42, -14, 14, 42].flatMap((x) => [
    box([x, 7.2, -12.8], [0.36, 7.2, 0.36], DARK_STEEL),
    box([x, 7.2, 12.8], [0.36, 7.2, 0.36], DARK_STEEL),
  ]),
  box([0, 14.2, -12.8], [42.4, 0.34, 0.34], STEEL), box([0, 14.2, 12.8], [42.4, 0.34, 0.34], STEEL),
  box([0, 7.2, 13.0], [10.0, 5.1, 0.12], BLACK),
  box([0, 7.2, 12.78], [9.4, 4.8, 0.04], GLASS),
  box([-39, 0.50, -10.8], [3.5, 0.10, 0.16], AMBER), box([-26, 0.50, -10.8], [3.5, 0.10, 0.16], AMBER),
  box([-7, 0.50, -10.8], [3.5, 0.10, 0.16], CYAN), box([7, 0.50, -10.8], [3.5, 0.10, 0.16], CYAN),
  box([26, 0.50, -10.8], [3.5, 0.10, 0.16], RED), box([39, 0.50, -10.8], [3.5, 0.10, 0.16], RED),
  box([-26, 0.58, 0], [14.5, 0.06, 8.5], CONCRETE),
  box([0, 0.58, 0], [14.5, 0.06, 8.5], CONCRETE),
  box([26, 0.58, 0], [14.5, 0.06, 8.5], CONCRETE),
];

export function getMaterialDemoStagePrimitives(id: string | undefined): readonly AAAStagePrimitive[] {
  const recipe = getMaterialDemoRecipe(id);
  if (!recipe) return [];
  if (recipe.kind === 'metal') return METAL_STAGE;
  if (recipe.kind === 'glass') return GLASS_STAGE;
  if (recipe.kind === 'concrete') return CONCRETE_STAGE;
  return COMBINED_STAGE;
}

export const COMBINED_MATERIAL_OFFSETS = {
  metal: [-26, 0, 0] as Vec3,
  glass: [0, 0, 0] as Vec3,
  concrete: [26, 0, 0] as Vec3,
} as const;

export function materialDemoWorldPoint(recipe: MaterialDemoRecipe, target: Exclude<MaterialDemoKind, 'combined'> = recipe.kind as Exclude<MaterialDemoKind, 'combined'>): Vec3 {
  const source = recipe.kind === 'combined'
    ? getMaterialDemoRecipe(target === 'metal' ? 'metal-square-punch-forming' : target === 'glass' ? 'glass-ballistic-off-center' : 'concrete-flat-slab-punching')!
    : recipe;
  const offset = recipe.kind === 'combined' ? COMBINED_MATERIAL_OFFSETS[target] : ([0, 0, 0] as Vec3);
  const x = (source.strikeCenter[0] - 0.5) * source.span + offset[0];
  if (target === 'glass') return [x, 7.2 + (source.strikeCenter[1] - 0.5) * source.depth + offset[1], 0.18 + offset[2]];
  return [x, 7.1 + offset[1], (source.strikeCenter[1] - 0.5) * source.depth + offset[2]];
}

const counts = materialDemoCounts();
if (counts.metal !== 10 || counts.glass !== 10 || counts.concrete !== 10 || counts.combined !== 1 || byId.size !== 31) {
  throw new Error(`Material demo registry must contain 10 metal, 10 glass, 10 concrete, and one combined recipe; received ${JSON.stringify(counts)}.`);
}
for (const recipe of MATERIAL_DEMO_RECIPES) {
  const base = getSceneById(recipe.baseSceneId);
  const finiteValues = [
    ...recipe.loadCenter, ...recipe.loadRadius, ...recipe.strikeCenter,
    recipe.loadScale, recipe.primaryLoad, recipe.ultimateLoad,
    recipe.primaryStrike, recipe.ultimateStrike, recipe.span, recipe.depth,
    recipe.stations, recipe.lanes, recipe.duration,
    recipe.camera.yaw, recipe.camera.pitch, recipe.camera.distance, ...recipe.camera.target,
  ];
  if (base.id !== recipe.baseSceneId || base.family !== 'fracture') {
    throw new Error(`Material demo '${recipe.id}' must derive from a stable fracture-family scene.`);
  }
  if (!finiteValues.every(Number.isFinite) || recipe.span <= 0 || recipe.depth <= 0 || recipe.stations < 4 || recipe.stations > 48 || recipe.lanes < 3 || recipe.lanes > 15) {
    throw new Error(`Material demo '${recipe.id}' has an invalid finite/capacity contract.`);
  }
  if (recipe.loadRadius.some((value) => value <= 0) || recipe.loadCenter.some((value) => value < 0 || value > 1) || recipe.strikeCenter.some((value) => value < 0 || value > 1)) {
    throw new Error(`Material demo '${recipe.id}' has an invalid normalized load or strike footprint.`);
  }
  if (recipe.ultimateLoad <= recipe.primaryLoad || recipe.ultimateStrike <= recipe.primaryStrike) {
    throw new Error(`Material demo '${recipe.id}' must define an ultimate demand above its primary demand.`);
  }
}
