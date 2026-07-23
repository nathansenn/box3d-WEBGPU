import type { Vec3 } from './math';

export type AAAImprovementCategory = 'architecture' | 'forensics' | 'lighting' | 'safety' | 'story';

export type AAAStagePrimitive = {
  readonly pos: Vec3;
  readonly half: Vec3;
  readonly rot: Vec3;
  readonly color: readonly [number, number, number, number];
};

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

const box = (
  pos: Vec3,
  half: Vec3,
  color: readonly [number, number, number, number],
  rot: Vec3 = [0, 0, 0],
): AAAStagePrimitive => ({ pos, half, rot, color });

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
