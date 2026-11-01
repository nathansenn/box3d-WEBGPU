import type { Vec3 } from './math';

export type AAAImprovementCategory = 'architecture' | 'forensics' | 'lighting' | 'safety' | 'story';

export type AAAStagePrimitive = {
  readonly pos: Vec3;
  readonly half: Vec3;
  readonly rot: Vec3;
  readonly color: readonly [number, number, number, number];
};

export type EngineeringStageGroupRole =
  | 'facility'
  | 'reaction-frame'
  | 'load-train'
  | 'instrumentation'
  | 'safety';

export type EngineeringStageOwnership = 'presentation-only' | 'solver-render-witness';

/**
 * Stable assembly metadata for inspector, isolation, and schedule views.
 * `primitives` is always a frozen slice containing the exact primitive object
 * references used by the existing flattened stage arrays.
 */
export type EngineeringStageGroup = Readonly<{
  id: string;
  label: string;
  role: EngineeringStageGroupRole;
  ownership: EngineeringStageOwnership;
  primitives: readonly AAAStagePrimitive[];
}>;

const EMPTY_ENGINEERING_STAGE_GROUPS: readonly EngineeringStageGroup[] = Object.freeze([]);

export type AAAImprovement = {
  readonly id: string;
  readonly sceneId: number;
  readonly showcaseId: string;
  readonly ordinal: number;
  readonly label: string;
  readonly category: AAAImprovementCategory;
  readonly primitives: readonly AAAStagePrimitive[];
};

type Definition = readonly [
  slug: string,
  label: string,
  category: AAAImprovementCategory,
  primitives: readonly AAAStagePrimitive[],
];

const rgb = (hex: number, alpha: number): readonly [number, number, number, number] => [
  ((hex >> 16) & 0xff) / 255,
  ((hex >> 8) & 0xff) / 255,
  (hex & 0xff) / 255,
  alpha,
];

const CONCRETE = rgb(0x8b8d88, -1);
const METAL = rgb(0x9aa7b5, -2);
const GLASS = rgb(0x8eddf2, -4);
const STONE = rgb(0xa0a09a, -5);
const DARK = rgb(0x152033, 1);
const BLACK = rgb(0x080f1d, 1);
const CYAN = rgb(0x50d8ff, 4.2);
const AMBER = rgb(0xffc857, 4.4);
const RED = rgb(0xff4d4d, 4.6);
const GREEN = rgb(0x65f5a5, 3.8);
const WHITE = rgb(0xeaf7ff, 3.6);
// Painted machine housings are coated dielectrics; the posts, wear surfaces,
// and load-cell stack retain the explicit galvanized-metal material ID.
const PRESS_BLACK = rgb(0x2f3a34, 1);
const PRESS_STEEL = rgb(0x596167, -2);
const POLISHED_STEEL = rgb(0xc4c9ca, -2);

const box = (
  pos: Vec3,
  half: Vec3,
  color: readonly [number, number, number, number],
  rot: Vec3 = [0, 0, 0],
): AAAStagePrimitive => ({ pos, half, rot, color });

const verticalCylinder = (
  center: Vec3,
  radius: number,
  halfHeight: number,
  color: readonly [number, number, number, number],
  sides = 10,
): AAAStagePrimitive[] => {
  const panels: AAAStagePrimitive[] = [];
  const tangentHalf = radius * Math.tan(Math.PI / sides) * 1.03;
  const shellHalf = Math.max(0.025, radius * 0.055);
  for (let index = 0; index < sides; index++) {
    const angle = index * Math.PI * 2 / sides;
    panels.push(box(
      [center[0] + Math.cos(angle) * radius, center[1], center[2] + Math.sin(angle) * radius],
      [tangentHalf, halfHeight, shellHalf],
      color,
      [0, Math.PI * 0.5 - angle, 0],
    ));
  }
  return panels;
};

const pairX = (x: number, y: number, z: number, half: Vec3, color: readonly [number, number, number, number]): AAAStagePrimitive[] => [
  box([-x, y, z], half, color), box([x, y, z], half, color),
];

const pairZ = (x: number, y: number, z: number, half: Vec3, color: readonly [number, number, number, number]): AAAStagePrimitive[] => [
  box([x, y, -z], half, color), box([x, y, z], half, color),
];

const rowX = (count: number, spacing: number, y: number, z: number, half: Vec3, color: readonly [number, number, number, number]): AAAStagePrimitive[] => {
  const result: AAAStagePrimitive[] = [];
  for (let i = 0; i < count; i++) result.push(box([(i - (count - 1) * 0.5) * spacing, y, z], half, color));
  return result;
};

const entries: AAAImprovement[] = [];

function addScene(sceneId: number, showcaseId: string, definitions: readonly Definition[]): void {
  if (definitions.length !== 10) throw new Error(`${showcaseId} must define exactly ten AAA improvements`);
  definitions.forEach(([slug, label, category, primitives], index) => {
    entries.push({
      id: `${showcaseId}-${String(index + 1).padStart(2, '0')}-${slug}`,
      sceneId,
      showcaseId,
      ordinal: entries.length + 1,
      label,
      category,
      primitives,
    });
  });
}

addScene(140, 'aegis-tower-kinetic-breach', [
  ['stepped-blast-plinth', 'Stepped weathered-concrete blast plinth', 'architecture', [box([0, 0.32, 0], [10.8, 0.18, 10.8], CONCRETE), box([0, 0.12, 0], [12.2, 0.12, 12.2], STONE)]],
  ['corner-buttresses', 'Four load-path corner buttresses', 'architecture', [...pairX(7.4, 2.1, -7.4, [0.42, 2.1, 0.42], CONCRETE), ...pairX(7.4, 2.1, 7.4, [0.42, 2.1, 0.42], CONCRETE)]],
  ['mechanical-belt', 'Galvanized mechanical-floor belt', 'architecture', [box([0, 10.2, -6.0], [6.2, 0.15, 0.12], METAL), box([0, 10.2, 6.0], [6.2, 0.15, 0.12], METAL)]],
  ['roof-crown', 'Layered rooftop crown and antenna base', 'story', [box([0, 19.1, 0], [3.4, 0.24, 3.4], METAL), box([0, 20.1, 0], [0.34, 0.86, 0.34], METAL)]],
  ['aviation-beacons', 'Paired aviation warning beacons', 'lighting', [...pairX(2.6, 19.7, 0, [0.16, 0.16, 0.16], RED)]],
  ['breach-chevrons', 'Kinetic-breach target chevrons', 'forensics', [box([-6.25, 7.0, -2.2], [0.06, 0.16, 1.0], AMBER, [0, 0, 0.38]), box([-6.25, 7.0, 2.2], [0.06, 0.16, 1.0], AMBER, [0, 0, -0.38])]],
  ['sidewalk-bollards', 'Perimeter impact bollards', 'safety', [...rowX(7, 2.4, 0.55, -10.8, [0.13, 0.55, 0.13], METAL)]],
  ['debris-catch-curb', 'Low debris-containment curb', 'safety', [box([0, 0.45, 10.6], [10.8, 0.26, 0.18], CONCRETE)]],
  ['louver-bank', 'Dark mechanical louver bank', 'story', [...rowX(5, 2.0, 4.5, 6.08, [0.72, 0.12, 0.06], DARK)]],
  ['podium-light-rails', 'Cyan podium guidance rails', 'lighting', [box([0, 0.52, -9.8], [7.2, 0.035, 0.035], CYAN), box([9.8, 0.52, 0], [0.035, 0.035, 7.2], CYAN)]],
]);

addScene(147, 'twin-spire-progressive-collapse', [
  ['shared-megapodium', 'Shared stone-and-concrete megapodium', 'architecture', [box([0, 0.28, 0], [18.2, 0.16, 10.8], STONE), box([0, 0.58, 0], [16.8, 0.18, 9.4], CONCRETE)]],
  ['skybridge-keel', 'Galvanized skybridge underside keel', 'architecture', [box([0, 10.3, 0], [5.5, 0.16, 0.34], METAL)]],
  ['twin-crowns', 'Matched rooftop crown plates', 'architecture', [...pairX(8.6, 19.0, 0, [3.0, 0.22, 3.0], METAL)]],
  ['spire-beacons', 'Independent spire status beacons', 'lighting', [box([-8.6, 19.55, 0], [0.18, 0.18, 0.18], GREEN), box([8.6, 19.55, 0], [0.18, 0.18, 0.18], RED)]],
  ['outer-fins', 'Outer galvanized stability fins', 'architecture', [box([-16.25, 8.5, 0], [0.10, 6.5, 2.6], METAL), box([16.25, 8.5, 0], [0.10, 6.5, 2.6], METAL)]],
  ['expansion-joint', 'Readable skybridge expansion joint', 'forensics', [box([0, 11.0, 0], [0.18, 0.82, 2.0], AMBER)]],
  ['plaza-light-wells', 'Four recessed plaza light wells', 'lighting', [box([-6, 0.89, -6], [1.4, 0.025, 0.08], CYAN), box([6, 0.89, -6], [1.4, 0.025, 0.08], CYAN), box([-6, 0.89, 6], [1.4, 0.025, 0.08], CYAN), box([6, 0.89, 6], [1.4, 0.025, 0.08], CYAN)]],
  ['setback-terraces', 'Twin elevated setback terraces', 'story', [...pairX(8.6, 13.8, 0, [4.7, 0.14, 4.7], STONE)]],
  ['impact-warning-strip', 'Asymmetric impact-side warning strip', 'safety', [box([-16.4, 6.4, 0], [0.05, 3.0, 0.10], AMBER)]],
  ['debris-barrier', 'Skybridge-fall debris barrier', 'safety', [box([0, 0.72, 9.7], [14.0, 0.42, 0.16], CONCRETE)]],
]);

addScene(192, 'truss-span-failure', [
  ['bearing-pads', 'Eight visible elastomeric bearing pads', 'forensics', [...rowX(4, 8.5, 2.38, -2.4, [0.62, 0.10, 0.48], DARK), ...rowX(4, 8.5, 2.38, 2.4, [0.62, 0.10, 0.48], DARK)]],
  ['approach-slabs', 'Honed-stone approach slabs', 'architecture', [...pairX(25.2, 2.65, 0, [2.4, 0.14, 3.0], STONE)]],
  ['guard-rails', 'Continuous galvanized guard rails', 'safety', [box([0, 3.72, -3.0], [24.5, 0.07, 0.07], METAL), box([0, 3.72, 3.0], [24.5, 0.07, 0.07], METAL)]],
  ['portal-frames', 'End portal frames for silhouette depth', 'architecture', [box([-22.2, 5.4, 0], [0.12, 2.6, 3.0], METAL), box([22.2, 5.4, 0], [0.12, 2.6, 3.0], METAL)]],
  ['redundancy-chords', 'Under-deck redundancy chords', 'architecture', [box([0, 2.15, -2.0], [22.4, 0.08, 0.08], METAL), box([0, 2.15, 2.0], [22.4, 0.08, 0.08], METAL)]],
  ['expansion-joints', 'Readable deck expansion joints', 'forensics', [box([-11.2, 2.83, 0], [0.10, 0.03, 3.0], AMBER), box([11.2, 2.83, 0], [0.10, 0.03, 3.0], AMBER)]],
  ['inspection-lamps', 'Pier inspection lamps', 'lighting', [box([-17, 2.65, -3.5], [0.16, 0.16, 0.16], CYAN), box([-8.5, 2.65, -3.5], [0.16, 0.16, 0.16], CYAN), box([8.5, 2.65, -3.5], [0.16, 0.16, 0.16], CYAN), box([17, 2.65, -3.5], [0.16, 0.16, 0.16], CYAN)]],
  ['pier-caps', 'Layered concrete pier caps', 'architecture', [box([-17, 2.42, 0], [1.65, 0.18, 3.8], CONCRETE), box([-8.5, 2.42, 0], [1.65, 0.18, 3.8], CONCRETE), box([8.5, 2.42, 0], [1.65, 0.18, 3.8], CONCRETE), box([17, 2.42, 0], [1.65, 0.18, 3.8], CONCRETE)]],
  ['lane-markers', 'Emissive deck lane markers', 'lighting', [...rowX(9, 4.8, 2.98, 0, [1.35, 0.025, 0.05], WHITE)]],
  ['crossbeam-array', 'Under-deck crossbeam array', 'architecture', [...rowX(9, 5.2, 2.28, 0, [0.08, 0.08, 2.65], METAL)]],
]);

addScene(340, 'citadel-siege', [
  ['breach-apron', 'Stone breach-analysis apron', 'forensics', [box([0, 0.16, -7.8], [9.5, 0.16, 3.0], STONE)]],
  ['exposed-rebar-cages', 'Twin exposed rebar cages', 'story', [box([-5.4, 2.2, -4.45], [0.08, 1.8, 0.08], METAL), box([-4.7, 2.2, -4.45], [0.08, 1.8, 0.08], METAL), box([4.7, 2.2, -4.45], [0.08, 1.8, 0.08], METAL), box([5.4, 2.2, -4.45], [0.08, 1.8, 0.08], METAL)]],
  ['parapet-caps', 'Layered parapet capstones', 'architecture', [box([0, 6.35, -4.8], [9.0, 0.22, 0.48], CONCRETE)]],
  ['side-buttresses', 'Massive side buttresses', 'architecture', [...pairX(9.2, 2.2, -4.8, [1.15, 2.2, 1.4], CONCRETE)]],
  ['rubble-catcher', 'Breach rubble catch wall', 'safety', [box([0, 0.7, -10.2], [8.5, 0.7, 0.28], CONCRETE)]],
  ['breach-warning-lamps', 'Red breach warning lamps', 'lighting', [...pairX(6.8, 5.8, -4.25, [0.18, 0.18, 0.18], RED)]],
  ['inner-gate-frame', 'Galvanized inner gate frame', 'architecture', [box([0, 3.0, -3.95], [3.2, 0.12, 0.12], METAL), ...pairX(3.2, 1.8, -3.95, [0.12, 1.8, 0.12], METAL)]],
  ['blast-scorch', 'Darkened breach-face scorch plate', 'story', [box([0, 2.8, -4.16], [2.4, 1.45, 0.025], BLACK)]],
  ['observation-lights', 'Forensic observation light bar', 'lighting', [box([0, 7.0, -8.4], [5.0, 0.06, 0.06], WHITE)]],
  ['debris-markers', 'Numbered-style debris marker row', 'forensics', [...rowX(7, 2.1, 0.28, -8.1, [0.12, 0.28, 0.12], AMBER)]],
]);

addScene(599, 'mega-atrium-collapse', [
  ['entry-canopy', 'Galvanized-and-glass entry canopy', 'architecture', [box([0, 3.0, -13.2], [5.8, 0.12, 2.1], GLASS), box([0, 3.18, -13.2], [6.2, 0.08, 2.35], METAL)]],
  ['roof-oculus', 'Layered central roof oculus', 'architecture', [box([0, 9.18, 0], [4.0, 0.08, 4.0], GLASS), box([0, 9.30, 0], [4.6, 0.08, 0.12], METAL), box([0, 9.30, 0], [0.12, 0.08, 4.6], METAL)]],
  ['skylight-ring', 'Emissive skylight datum ring', 'lighting', [box([0, 9.46, -6.7], [5.2, 0.04, 0.04], CYAN), box([0, 9.46, 6.7], [5.2, 0.04, 0.04], CYAN), box([-6.7, 9.46, 0], [0.04, 0.04, 5.2], CYAN), box([6.7, 9.46, 0], [0.04, 0.04, 5.2], CYAN)]],
  ['facade-belt', 'Continuous facade mullion belt', 'architecture', [box([0, 5.6, -12.65], [11.8, 0.08, 0.08], METAL), box([0, 5.6, 12.65], [11.8, 0.08, 0.08], METAL)]],
  ['balcony-slabs', 'Opposed interior balcony slabs', 'architecture', [box([-7.4, 4.8, 0], [2.4, 0.14, 8.0], STONE), box([7.4, 4.8, 0], [2.4, 0.14, 8.0], STONE)]],
  ['floor-inlay', 'Cross-axis luminous floor inlay', 'lighting', [box([0, 0.42, 0], [10.2, 0.025, 0.06], AMBER), box([0, 0.42, 0], [0.06, 0.025, 10.2], AMBER)]],
  ['egress-beacons', 'Emergency egress beacon quartet', 'safety', [box([-10.5, 0.65, -10.5], [0.18, 0.18, 0.18], GREEN), box([10.5, 0.65, -10.5], [0.18, 0.18, 0.18], GREEN), box([-10.5, 0.65, 10.5], [0.18, 0.18, 0.18], GREEN), box([10.5, 0.65, 10.5], [0.18, 0.18, 0.18], GREEN)]],
  ['mega-columns', 'Four atrium mega-columns', 'architecture', [box([-8.5, 4.4, -8.5], [0.42, 4.4, 0.42], CONCRETE), box([8.5, 4.4, -8.5], [0.42, 4.4, 0.42], CONCRETE), box([-8.5, 4.4, 8.5], [0.42, 4.4, 0.42], CONCRETE), box([8.5, 4.4, 8.5], [0.42, 4.4, 0.42], CONCRETE)]],
  ['debris-barriers', 'Entry debris-control barriers', 'safety', [...pairX(7.5, 0.62, -15.0, [2.6, 0.62, 0.18], CONCRETE)]],
  ['atrium-signage', 'Suspended luminous atrium signage', 'story', [box([0, 6.8, -10.8], [3.6, 0.55, 0.05], CYAN)]],
]);

addScene(640, 'tempest-standard-protocol', [
  ['contraction-frame', 'Wind-tunnel contraction frame', 'architecture', [box([0, 5.6, -8.8], [16.2, 0.12, 0.12], METAL), ...pairX(16.2, 3.0, -8.8, [0.12, 3.0, 0.12], METAL)]],
  ['anemometer-poles', 'Four anemometer reference poles', 'forensics', [box([-12, 3.3, -2.5], [0.07, 3.3, 0.07], METAL), box([-4, 3.3, -2.5], [0.07, 3.3, 0.07], METAL), box([4, 3.3, -2.5], [0.07, 3.3, 0.07], METAL), box([12, 3.3, -2.5], [0.07, 3.3, 0.07], METAL)]],
  ['pitot-rail', 'Cyan pitot telemetry rail', 'forensics', [box([0, 1.2, -3.2], [13.0, 0.04, 0.04], CYAN)]],
  ['anchor-caps', 'Readable cloth-anchor cap blocks', 'story', [...pairX(15.2, 10.8, -5.5, [0.5, 0.18, 0.5], AMBER)]],
  ['floor-streamlines', 'Emissive floor streamline array', 'lighting', [...rowX(7, 4.0, 0.42, 4.8, [1.3, 0.025, 0.05], CYAN)]],
  ['control-booth', 'Glazed wind-control booth', 'architecture', [box([12.8, 2.2, 6.2], [2.2, 1.7, 0.06], GLASS), box([12.8, 4.0, 6.2], [2.4, 0.12, 0.2], METAL)]],
  ['safety-rail', 'Rear observation safety rail', 'safety', [box([0, 1.2, 7.4], [14.5, 0.07, 0.07], METAL), ...pairX(14.5, 0.7, 7.4, [0.07, 0.7, 0.07], METAL)]],
  ['storm-beacons', 'Amber storm-level beacons', 'lighting', [box([-14.5, 1.6, 7.4], [0.18, 0.18, 0.18], AMBER), box([14.5, 1.6, 7.4], [0.18, 0.18, 0.18], AMBER)]],
  ['recovery-markers', 'Post-impact recovery datum markers', 'forensics', [...rowX(5, 6.0, 0.58, -1.5, [0.08, 0.38, 0.08], WHITE)]],
  ['service-gantry', 'Overhead service gantry', 'architecture', [box([0, 12.0, -5.5], [15.8, 0.10, 0.18], METAL)]],
]);

addScene(690, 'sky-crane-cable-failure', [
  ['outrigger-mats', 'Four honed-stone outrigger mats', 'architecture', [box([-10.5, 0.18, -3.5], [2.0, 0.18, 1.2], STONE), box([10.5, 0.18, -3.5], [2.0, 0.18, 1.2], STONE), box([-10.5, 0.18, 3.5], [2.0, 0.18, 1.2], STONE), box([10.5, 0.18, 3.5], [2.0, 0.18, 1.2], STONE)]],
  ['operator-cage', 'Glazed operator inspection cage', 'architecture', [box([-7.4, 8.8, -2.8], [1.2, 1.0, 0.06], GLASS), box([-7.4, 9.9, -2.8], [1.4, 0.12, 0.4], METAL)]],
  ['landing-zone', 'Luminous payload landing zone', 'safety', [box([0, 0.43, 0], [4.2, 0.025, 0.08], AMBER), box([0, 0.43, 0], [0.08, 0.025, 3.2], AMBER)]],
  ['counterweights', 'Layered concrete counterweight blocks', 'story', [box([-9.0, 2.2, -3.4], [1.6, 1.1, 1.2], CONCRETE), box([-9.0, 4.5, -3.4], [1.6, 1.1, 1.2], CONCRETE)]],
  ['warning-beacons', 'Crane envelope warning beacons', 'lighting', [box([-9.0, 13.8, -2.8], [0.18, 0.18, 0.18], RED), box([9.0, 13.8, -2.8], [0.18, 0.18, 0.18], RED)]],
  ['tag-line-posts', 'Payload tag-line guide posts', 'safety', [...pairX(5.8, 1.4, 3.8, [0.08, 1.4, 0.08], METAL)]],
  ['hook-inspection-lights', 'Hook-path inspection light bar', 'lighting', [box([0, 12.8, -2.65], [2.3, 0.05, 0.05], WHITE)]],
  ['deck-edge-stripes', 'Alternating deck-edge guidance stripes', 'safety', [...rowX(7, 2.1, 0.46, 4.0, [0.72, 0.025, 0.08], AMBER)]],
  ['mast-braces', 'Twin mast-base stability braces', 'architecture', [box([-8.0, 4.0, -2.8], [0.09, 2.8, 0.09], METAL, [0, 0, -0.28]), box([8.0, 4.0, -2.8], [0.09, 2.8, 0.09], METAL, [0, 0, 0.28])]],
  ['payload-cribbing', 'Concrete payload cribbing stands', 'story', [...pairX(3.0, 0.75, 0, [1.0, 0.75, 1.4], CONCRETE)]],
]);

addScene(741, 'tsunami-research-array', [
  ['wave-gauge-poles', 'Five calibrated wave-gauge poles', 'forensics', [...rowX(5, 6.5, 2.8, -7.5, [0.06, 2.8, 0.06], METAL)]],
  ['datum-lights', 'Cyan still-water datum lights', 'lighting', [box([0, 1.05, -11.25], [16.8, 0.035, 0.035], CYAN)]],
  ['control-booth', 'Elevated glazed control booth', 'architecture', [box([13.2, 3.6, 12.0], [2.5, 1.6, 0.06], GLASS), box([13.2, 5.3, 12.0], [2.8, 0.12, 0.4], METAL)]],
  ['impact-target', 'High-contrast wave-impact target', 'forensics', [box([0, 1.8, -11.18], [1.6, 1.6, 0.025], DARK), box([0, 1.8, -11.12], [0.08, 1.35, 0.03], AMBER), box([0, 1.8, -11.12], [1.35, 0.08, 0.03], AMBER)]],
  ['runup-ramp', 'Honed-stone wave run-up ramp', 'architecture', [box([0, 0.35, -9.8], [6.8, 0.16, 2.2], STONE, [0.18, 0, 0])]],
  ['pressure-sensor-rail', 'Pressure-sensor rail array', 'forensics', [...rowX(9, 3.6, 0.72, -10.9, [0.08, 0.32, 0.08], WHITE)]],
  ['emergency-beacons', 'Flood-level emergency beacons', 'safety', [box([-17.2, 4.5, 11.4], [0.18, 0.18, 0.18], RED), box([17.2, 4.5, 11.4], [0.18, 0.18, 0.18], RED)]],
  ['drainage-slots', 'Flume drainage-slot markers', 'architecture', [...rowX(9, 3.8, 0.34, 10.9, [1.1, 0.025, 0.12], DARK)]],
  ['camera-gantry', 'Overhead high-speed camera gantry', 'story', [box([0, 7.8, 0], [15.5, 0.08, 0.08], METAL), ...pairX(15.5, 4.0, 0, [0.08, 4.0, 0.08], METAL)]],
  ['foam-boom', 'Downstream foam-collection boom', 'story', [box([0, 0.72, 8.6], [14.2, 0.08, 0.08], AMBER)]],
]);

addScene(795, 'concrete-spall-and-rebar', [
  ['actuator-head', 'Hydraulic actuator head and platen', 'story', [box([0, 9.1, 0], [1.25, 0.55, 1.25], METAL), box([0, 8.42, 0], [2.4, 0.12, 1.4], METAL)]],
  ['load-cell', 'Emissive load-cell collar', 'forensics', [box([0, 8.65, 0], [0.62, 0.12, 0.62], CYAN)]],
  ['support-saddles', 'Twin honed-stone support saddles', 'architecture', [...pairX(12.0, 6.82, 0, [1.1, 0.38, 1.4], STONE)]],
  ['rebar-inspection-lights', 'Warm rebar-transfer inspection lights', 'lighting', [box([-7.5, 5.45, -1.5], [2.2, 0.04, 0.04], AMBER), box([7.5, 5.45, -1.5], [2.2, 0.04, 0.04], AMBER)]],
  ['spall-catch-tray', 'Deep spall-fragment catch tray', 'safety', [box([0, 0.22, 0], [11.8, 0.18, 2.5], STONE), box([0, 0.62, 2.35], [11.8, 0.42, 0.12], CONCRETE)]],
  ['crack-gauges', 'Seven crack-width gauge markers', 'forensics', [...rowX(7, 3.0, 7.55, -0.78, [0.07, 0.34, 0.04], CYAN)]],
  ['shield-fins', 'Glazed lateral safety shields', 'safety', [box([-11.6, 4.0, 0], [0.04, 3.0, 2.4], GLASS), box([11.6, 4.0, 0], [0.04, 3.0, 2.4], GLASS)]],
  ['hazard-strip', 'Alternating floor hazard strip', 'safety', [...rowX(9, 2.6, 0.44, -3.1, [0.92, 0.025, 0.10], AMBER)]],
  ['specimen-plaque', 'Luminous specimen identification plaque', 'story', [box([-8.0, 2.2, -2.7], [2.0, 0.6, 0.05], WHITE)]],
  ['deflection-datum', 'Residual-deflection datum rail', 'forensics', [box([0, 4.95, 1.7], [10.4, 0.035, 0.035], GREEN)]],
]);

addScene(796, 'glass-catastrophic-fracture', [
  ['pendulum-guide', 'Galvanized impact-pendulum guide', 'story', [box([0, 11.8, 2.6], [5.2, 0.10, 0.10], METAL), box([0, 9.8, 2.6], [0.10, 2.0, 0.10], METAL)]],
  ['perimeter-light-bars', 'Four perimeter fracture light bars', 'lighting', [box([0, 11.15, -0.45], [9.9, 0.04, 0.04], CYAN), box([0, 3.25, -0.45], [9.9, 0.04, 0.04], CYAN), box([-10.0, 7.2, -0.45], [0.04, 3.95, 0.04], CYAN), box([10.0, 7.2, -0.45], [0.04, 3.95, 0.04], CYAN)]],
  ['shard-catch-tray', 'Deep honed-stone shard catch tray', 'safety', [box([0, 0.22, 0], [11.2, 0.18, 3.6], STONE), box([0, 0.62, 3.35], [11.2, 0.42, 0.12], STONE)]],
  ['standoff-fins', 'Transparent lateral standoff fins', 'architecture', [box([-11.0, 4.6, 0], [0.035, 3.4, 2.8], GLASS), box([11.0, 4.6, 0], [0.035, 3.4, 2.8], GLASS)]],
  ['fracture-backlight', 'Broad cool fracture backlight', 'lighting', [
    box([0, 7.2, -1.72], [8.8, 3.6, 0.025], DARK),
    box([-6.6, 7.2, -1.66], [0.72, 3.35, 0.018], rgb(0xc7f4ff, 1.8)),
    box([-2.2, 7.2, -1.66], [0.72, 3.35, 0.018], rgb(0x55cbe8, 1.45)),
    box([2.2, 7.2, -1.66], [0.72, 3.35, 0.018], rgb(0xc7f4ff, 1.8)),
    box([6.6, 7.2, -1.66], [0.72, 3.35, 0.018], rgb(0x55cbe8, 1.45)),
  ]],
  ['origin-beacon', 'Localized crack-origin beacon', 'forensics', [box([0, 7.2, 0.62], [0.20, 0.20, 0.20], RED)]],
  ['clamp-covers', 'Galvanized edge-clamp covers', 'architecture', [box([0, 11.32, 0], [10.4, 0.14, 0.28], METAL), box([0, 3.08, 0], [10.4, 0.14, 0.28], METAL)]],
  ['safety-barriers', 'Front-of-stage safety barriers', 'safety', [box([0, 1.0, 4.2], [10.5, 0.08, 0.08], METAL), ...pairX(10.5, 0.55, 4.2, [0.08, 0.55, 0.08], METAL)]],
  ['forensic-scales', 'Twin forensic fracture scale bars', 'forensics', [box([-9.4, 7.2, 0.42], [0.05, 3.4, 0.05], WHITE), box([9.4, 7.2, 0.42], [0.05, 3.4, 0.05], WHITE)]],
  ['debris-markers', 'Shard-field collection markers', 'forensics', [...rowX(9, 2.2, 0.52, 2.6, [0.10, 0.32, 0.10], AMBER)]],
]);

if (entries.length !== 100) throw new Error(`Expected 100 AAA improvements, received ${entries.length}`);

export const AAA_IMPROVEMENTS: readonly AAAImprovement[] = entries;

const improvementsByScene = new Map<number, readonly AAAImprovement[]>();
const primitivesByScene = new Map<number, readonly AAAStagePrimitive[]>();

for (const sceneId of new Set(entries.map((entry) => entry.sceneId))) {
  const sceneEntries = entries.filter((entry) => entry.sceneId === sceneId);
  improvementsByScene.set(sceneId, sceneEntries);
  primitivesByScene.set(sceneId, sceneEntries.flatMap((entry) => entry.primitives));
}

export function getAAAImprovementsForScene(sceneId: number): readonly AAAImprovement[] {
  return improvementsByScene.get(sceneId) ?? [];
}

export function getAAAStagePrimitives(sceneId: number): readonly AAAStagePrimitive[] {
  return primitivesByScene.get(sceneId) ?? [];
}

/**
 * Backend-neutral specimen fixtures. These presentation-only cube instances
 * intentionally live outside the exact-count AAA improvement registry: they
 * complete the visible load path without changing native bodies or replay
 * hashes.
 */
export const TITAN_BEND_DENT_RIG: readonly AAAStagePrimitive[] = [
  // Grounded foundation mass keeps the press silhouette continuous down to
  // the test-cell floor, matching a real reaction frame rather than a table.
  box([0, 2.55, 0], [13.0, 1.20, 6.0], PRESS_BLACK),
  // A deep, layered bolster replaces the former table-like frame. Its broad
  // front mass and inset die surface match the visual load path of a real
  // servo-hydraulic forming press without adding solver bodies.
  box([0, 4.45, 0], [14.40, 0.68, 5.75], PRESS_BLACK),
  box([0, 5.25, 0], [13.90, 0.22, 5.40], POLISHED_STEEL),
  box([0, 5.58, 0], [13.35, 0.30, 5.08], PRESS_BLACK),
  box([0, 5.92, -4.75], [12.80, 0.22, 0.42], PRESS_STEEL),
  box([0, 6.02, 0], [12.55, 0.18, 4.62], PRESS_STEEL),

  // Twin polished reaction posts sit behind the specimen, with massive feet
  // and dark collars carrying the upper crosshead into the bed.
  ...verticalCylinder([-11.0, 9.00, 3.85], 0.48, 4.25, POLISHED_STEEL, 8),
  ...verticalCylinder([11.0, 9.00, 3.85], 0.48, 4.25, POLISHED_STEEL, 8),
  box([-11.0, 5.72, 3.85], [0.76, 0.42, 0.76], PRESS_BLACK),
  box([11.0, 5.72, 3.85], [0.76, 0.42, 0.76], PRESS_BLACK),
  box([-11.0, 6.46, 3.85], [0.62, 0.18, 0.62], PRESS_STEEL),
  box([11.0, 6.46, 3.85], [0.62, 0.18, 0.62], PRESS_STEEL),

  // Full-width crosshead, load-cell stack, and fixed barrel. The deformable
  // solver still owns the moving platen and telescoping sleeve below y=9.50.
  box([0, 13.25, 2.55], [12.20, 1.00, 2.30], PRESS_BLACK),
  box([0, 11.46, 1.15], [6.10, 0.18, 1.88], PRESS_STEEL),
  box([0, 11.02, 0], [2.45, 0.50, 1.82], PRESS_BLACK),
  box([0, 10.42, 0], [1.72, 0.18, 1.34], POLISHED_STEEL),
  ...verticalCylinder([0, 10.02, 0], 1.18, 0.52, PRESS_BLACK, 12),

  // Four heavy corner shoes visibly restrain the square blank. The two front
  // jaws receive bright wear caps so their contact surfaces remain legible.
  box([-10.1, 7.34, -3.82], [1.15, 0.34, 0.78], PRESS_BLACK),
  box([10.1, 7.34, -3.82], [1.15, 0.34, 0.78], PRESS_BLACK),
  box([-10.1, 7.34, 3.82], [1.15, 0.34, 0.78], PRESS_BLACK),
  box([10.1, 7.34, 3.82], [1.15, 0.34, 0.78], PRESS_BLACK),
  box([-10.1, 7.70, -3.68], [0.78, 0.08, 0.42], POLISHED_STEEL),
  box([10.1, 7.70, -3.68], [0.78, 0.08, 0.42], POLISHED_STEEL),

  // Compact displacement transducers flank the front edge without the former
  // oversized cyan glow, which read as a game prop rather than lab hardware.
  box([-8.35, 8.02, -4.82], [0.06, 0.70, 0.06], POLISHED_STEEL),
  box([8.35, 8.02, -4.82], [0.06, 0.70, 0.06], POLISHED_STEEL),
  box([-8.35, 8.78, -4.82], [0.17, 0.10, 0.17], PRESS_BLACK),
  box([8.35, 8.78, -4.82], [0.17, 0.10, 0.17], PRESS_BLACK),

  // Honed guide rods sit outside the blank so they register the ram without
  // piercing the sheet lattice. Glands and a bed stripe read as shop iron.
  ...verticalCylinder([-12.7, 9.15, -5.15], 0.16, 3.50, POLISHED_STEEL, 8),
  ...verticalCylinder([12.7, 9.15, -5.15], 0.16, 3.50, POLISHED_STEEL, 8),
  ...verticalCylinder([-12.7, 9.15, 5.15], 0.16, 3.50, POLISHED_STEEL, 8),
  ...verticalCylinder([12.7, 9.15, 5.15], 0.16, 3.50, POLISHED_STEEL, 8),
  box([-12.7, 6.00, -5.15], [0.28, 0.12, 0.28], PRESS_BLACK),
  box([12.7, 6.00, -5.15], [0.28, 0.12, 0.28], PRESS_BLACK),
  box([-12.7, 6.00, 5.15], [0.28, 0.12, 0.28], PRESS_BLACK),
  box([12.7, 6.00, 5.15], [0.28, 0.12, 0.28], PRESS_BLACK),
  ...[-8, -4, 0, 4, 8].map((x) => box([x, 5.95, -4.55], [0.09, 0.07, 0.09], POLISHED_STEEL)),
  box([0, 4.95, -5.55], [12.6, 0.04, 0.06], rgb(0xd99b18, 1)),
  box([0, 9.72, 0], [1.45, 0.14, 1.45], PRESS_BLACK),
  ...verticalCylinder([0, 9.22, 0], 0.42, 0.38, POLISHED_STEEL, 8),
];

export const MEMBRANE_FIELD_RIG: readonly AAAStagePrimitive[] = [
  // Four grounded reaction corners and a braced lower rectangle.
  box([-8.3, 0.34, -5.85], [0.62, 0.34, 0.62], STONE),
  box([-8.3, 0.34, 5.85], [0.62, 0.34, 0.62], STONE),
  box([8.3, 0.34, -5.85], [0.62, 0.34, 0.62], STONE),
  box([8.3, 0.34, 5.85], [0.62, 0.34, 0.62], STONE),
  box([-8, 3.05, -5.55], [0.26, 2.35, 0.26], DARK),
  box([-8, 3.05, 5.55], [0.26, 2.35, 0.26], DARK),
  box([8, 3.05, -5.55], [0.26, 2.35, 0.26], DARK),
  box([8, 3.05, 5.55], [0.26, 2.35, 0.26], DARK),
  box([0, 0.75, -5.55], [8, 0.18, 0.22], METAL),
  box([0, 0.75, 5.55], [8, 0.18, 0.22], METAL),
  box([-8, 0.75, 0], [0.22, 0.18, 5.55], METAL),
  box([8, 0.75, 0], [0.22, 0.18, 5.55], METAL),

  // The inner faces meet the 15.44 x 10.5 solver membrane perimeter.
  box([0, 5.47, -5.50], [8, 0.20, 0.30], METAL),
  box([0, 5.47, 5.50], [8, 0.20, 0.30], METAL),
  box([-7.97, 5.47, 0], [0.30, 0.20, 5.25], METAL),
  box([7.97, 5.47, 0], [0.30, 0.20, 5.25], METAL),
  box([0, 5.78, -5.32], [7.76, 0.08, 0.10], METAL),
  box([0, 5.78, 5.32], [7.76, 0.08, 0.10], METAL),
  box([-7.80, 5.78, 0], [0.10, 0.08, 5.23], METAL),
  box([7.80, 5.78, 0], [0.10, 0.08, 5.23], METAL),
  box([-7.65, 5.90, -5.15], [0.36, 0.08, 0.30], METAL),
  box([-7.65, 5.90, 5.15], [0.36, 0.08, 0.30], METAL),
  box([7.65, 5.90, -5.15], [0.36, 0.08, 0.30], METAL),
  box([7.65, 5.90, 5.15], [0.36, 0.08, 0.30], METAL),
];

/**
 * Presentation-only environment for the reduced-order composite cantilever.
 * The clamp faces and five node-following response taps remain solver-owned;
 * this cell adds only the physical lab context around them.
 */
export const CANTILEVER_FIELD_RIG: readonly AAAStagePrimitive[] = [
  // Sealed concrete pad, flush rear wall, and acoustic wall bays.
  box([0, 0.18, 0], [18.5, 0.18, 11.5], rgb(0x24282a, -5)),
  box([0, 7.2, -8.4], [19.0, 7.2, 0.34], rgb(0x444a4d, 1)),
  box([-12.0, 7.2, -8.02], [0.09, 6.75, 0.06], rgb(0x111518, -2)),
  box([0, 7.2, -8.02], [0.09, 6.75, 0.06], rgb(0x111518, -2)),
  box([12.0, 7.2, -8.02], [0.09, 6.75, 0.06], rgb(0x111518, -2)),
  box([0, 3.0, -8.0], [18.0, 0.08, 0.07], rgb(0x111518, -2)),
  box([0, 11.2, -8.0], [18.0, 0.08, 0.07], rgb(0x111518, -2)),

  // A grouted machine plinth extends the solver-owned clamp base into the
  // floor, with visible tie-down rails and eight compact anchor heads.
  box([-11.8, 0.48, 0], [4.4, 0.12, 3.4], STONE),
  box([-11.8, 0.66, -2.72], [3.7, 0.08, 0.18], PRESS_STEEL),
  box([-11.8, 0.66, 2.72], [3.7, 0.08, 0.18], PRESS_STEEL),
  ...[-14.5, -12.6, -10.7, -8.8].flatMap((x) => [
    box([x, 0.82, -2.72], [0.16, 0.08, 0.22], POLISHED_STEEL),
    box([x, 0.82, 2.72], [0.16, 0.08, 0.22], POLISHED_STEEL),
  ]),

  // Cable tray and short service drops sit behind the response taps, giving
  // the derived marker blocks a believable acquisition context without
  // misrepresenting them as hardware DAQ channels.
  box([0, 1.05, -7.50], [15.8, 0.10, 0.18], PRESS_BLACK),
  box([-8.7, 2.55, -7.48], [0.08, 1.40, 0.16], PRESS_STEEL),
  box([0, 2.55, -7.48], [0.08, 1.40, 0.16], PRESS_STEEL),
  box([8.7, 2.55, -7.48], [0.08, 1.40, 0.16], PRESS_STEEL),

  // Neutral-white inspection fixtures illuminate the carbon surface. Thin
  // amber perimeter lines define a safe hammering envelope at floor level.
  box([-7.2, 13.80, 0.3], [3.5, 0.035, 0.14], rgb(0xf0f4e6, 3.4)),
  box([7.2, 13.80, 0.3], [3.5, 0.035, 0.14], rgb(0xf0f4e6, 3.4)),
  box([-7.2, 13.80, -5.5], [3.5, 0.035, 0.14], rgb(0xf0f4e6, 3.4)),
  box([7.2, 13.80, -5.5], [3.5, 0.035, 0.14], rgb(0xf0f4e6, 3.4)),
  box([0, 0.39, -5.8], [15.6, 0.018, 0.07], rgb(0xd99b18, 1)),
  box([-15.6, 0.39, -1.7], [0.07, 0.018, 4.1], rgb(0xd99b18, 1)),
  box([15.6, 0.39, -1.7], [0.07, 0.018, 4.1], rgb(0xd99b18, 1)),

  // Low observation rail is outside the working envelope and supplies the
  // final human-scale cue without crossing the primary beam silhouette.
  box([0, 1.08, -6.55], [15.8, 0.09, 0.09], PRESS_STEEL),
  ...[-15.8, -10.5, -5.25, 0, 5.25, 10.5, 15.8].flatMap((x) => [
    box([x, 0.74, -6.55], [0.07, 0.65, 0.07], PRESS_STEEL),
  ]),
];

type EngineeringStageGroupDefinition = readonly [
  id: string,
  label: string,
  role: EngineeringStageGroupRole,
  start: number,
  end: number,
  ownership?: EngineeringStageOwnership,
];

function defineEngineeringStageGroups(
  source: readonly AAAStagePrimitive[],
  definitions: readonly EngineeringStageGroupDefinition[],
): readonly EngineeringStageGroup[] {
  return Object.freeze(definitions.map(([id, label, role, start, end, ownership = 'presentation-only']) => Object.freeze({
    id,
    label,
    role,
    ownership,
    primitives: Object.freeze(source.slice(start, end)),
  })));
}

function assertEngineeringStageProjection(
  source: readonly AAAStagePrimitive[],
  groups: readonly EngineeringStageGroup[],
  label: string,
): void {
  const ids = new Set<string>();
  let primitiveIndex = 0;
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error(`${label} contains duplicate engineering stage group '${group.id}'.`);
    ids.add(group.id);
    if (!Object.isFrozen(group) || !Object.isFrozen(group.primitives)) {
      throw new Error(`${label} engineering stage group '${group.id}' must be immutable.`);
    }
    for (const primitive of group.primitives) {
      if (primitive !== source[primitiveIndex]) {
        throw new Error(`${label} engineering stage groups do not preserve flattened primitive order at index ${primitiveIndex}.`);
      }
      primitiveIndex++;
    }
  }
  if (primitiveIndex !== source.length) {
    throw new Error(`${label} engineering stage groups cover ${primitiveIndex} of ${source.length} primitives.`);
  }
}

export const TITAN_BEND_DENT_RIG_GROUPS: readonly EngineeringStageGroup[] = defineEngineeringStageGroups(
  TITAN_BEND_DENT_RIG,
  [
    ['titan-rig-foundation-bed', 'Foundation bed and bolster', 'reaction-frame', 0, 6],
    ['titan-rig-reaction-columns', 'Twin reaction columns and collars', 'reaction-frame', 6, 26],
    ['titan-rig-fixed-load-train', 'Crosshead, load-cell stack, and fixed barrel', 'load-train', 26, 42],
    ['titan-rig-blank-restraints', 'Blank restraint shoes and wear caps', 'reaction-frame', 42, 48],
    ['titan-rig-displacement-sensing', 'Displacement transducer housings', 'instrumentation', 48, 52],
    ['titan-rig-guide-rods', 'Honed guide rods and glands', 'reaction-frame', 52, 88],
    ['titan-rig-bed-hardware', 'Bed bolts, safety stripe, and piston rod', 'load-train', 88, 103],
  ],
);

export const MEMBRANE_FIELD_RIG_GROUPS: readonly EngineeringStageGroup[] = defineEngineeringStageGroups(
  MEMBRANE_FIELD_RIG,
  [
    ['membrane-rig-foundations', 'Reaction-corner foundations', 'reaction-frame', 0, 4],
    ['membrane-rig-lower-frame', 'Lower reaction frame', 'reaction-frame', 4, 12],
    ['membrane-rig-boundary-fixtures', 'Perimeter boundary fixtures', 'load-train', 12, 24],
  ],
);

export const CANTILEVER_FIELD_RIG_GROUPS: readonly EngineeringStageGroup[] = defineEngineeringStageGroups(
  CANTILEVER_FIELD_RIG,
  [
    ['cantilever-cell-facility', 'Sealed floor and acoustic wall', 'facility', 0, 7],
    ['cantilever-cell-reaction-base', 'Grouted clamp plinth and tie-downs', 'reaction-frame', 7, 18],
    ['cantilever-cell-instrumentation-services', 'Acquisition services and inspection lighting', 'instrumentation', 18, 26],
    ['cantilever-cell-safety-envelope', 'Working envelope and observation rail', "safety", 26, 37],
  ],
);

if (TITAN_BEND_DENT_RIG.length !== 103) throw new Error(`Expected 103 Titan rig primitives, received ${TITAN_BEND_DENT_RIG.length}`);
if (MEMBRANE_FIELD_RIG.length !== 24) throw new Error(`Expected 24 membrane rig primitives, received ${MEMBRANE_FIELD_RIG.length}`);
if (CANTILEVER_FIELD_RIG.length !== 37) throw new Error(`Expected 37 cantilever field primitives, received ${CANTILEVER_FIELD_RIG.length}`);
assertEngineeringStageProjection(TITAN_BEND_DENT_RIG, TITAN_BEND_DENT_RIG_GROUPS, 'Titan bend/dent rig');
assertEngineeringStageProjection(MEMBRANE_FIELD_RIG, MEMBRANE_FIELD_RIG_GROUPS, 'Membrane field rig');
assertEngineeringStageProjection(CANTILEVER_FIELD_RIG, CANTILEVER_FIELD_RIG_GROUPS, 'Cantilever field rig');

export function getEngineeringStagePrimitives(
  sceneId: number,
  materialDemoId?: string,
): readonly AAAStagePrimitive[] {
  if (materialDemoId === 'metal-square-punch-forming') return TITAN_BEND_DENT_RIG;
  if (sceneId === 649) return MEMBRANE_FIELD_RIG;
  if (sceneId === 799) return CANTILEVER_FIELD_RIG;
  return [];
}

export function getEngineeringStageGroups(
  sceneId: number,
  materialDemoId?: string,
): readonly EngineeringStageGroup[] {
  if (materialDemoId === 'metal-square-punch-forming') return TITAN_BEND_DENT_RIG_GROUPS;
  if (sceneId === 649) return MEMBRANE_FIELD_RIG_GROUPS;
  if (sceneId === 799) return CANTILEVER_FIELD_RIG_GROUPS;
  return EMPTY_ENGINEERING_STAGE_GROUPS;
}
