import type { CameraRig } from './types';

export type SceneFamily =
  | 'stack'
  | 'domino'
  | 'skyscraper'
  | 'bridge'
  | 'material'
  | 'rain'
  | 'demolition'
  | 'vehicle'
  | 'marble'
  | 'construction'
  | 'warehouse'
  | 'architecture';

export type SceneCategory =
  | 'Core Physics'
  | 'Buildings'
  | 'Infrastructure'
  | 'Materials'
  | 'Stress Tests'
  | 'Destruction'
  | 'Machines'
  | 'Logistics'
  | 'Architecture';

export type ScenePreset = {
  id: number;
  key: SceneFamily;
  family: SceneFamily;
  variant: number;
  mode: number;
  category: SceneCategory;
  title: string;
  subtitle: string;
  details: string;
  defaultStress: number;
  recommendedMaxBodies: number;
  camera: CameraRig;
  tags: readonly string[];
  tourSeconds: number;
};

type FamilyDefinition = {
  family: SceneFamily;
  category: SceneCategory;
  titles: readonly string[];
  focus: readonly string[];
  tags: readonly string[];
  defaultStress: number;
  recommendedMaxBodies: number;
  camera: CameraRig;
};

const FAMILIES: readonly FamilyDefinition[] = [
  {
    family: 'stack',
    category: 'Core Physics',
    titles: [
      'Mega Stack Collapse', 'Offset Brick Tower', 'Jenga Shear Test', 'Pyramid Settling Stack', 'Cantilever Block Shelf',
      'Warehouse Pallet Pile', 'Masonry Wall Buckling', 'Column Forest Compression', 'Stair-Step Avalanche', 'Cross-Laminated Block Grid',
    ],
    focus: [
      'stacked contacts and solver stability', 'micro-offset settling and sleeping', 'thin support removal behavior', 'wide-base pressure propagation', 'overhang leverage and toppling',
      'industrial pile compaction', 'wall impacts and progressive buckling', 'many narrow vertical columns', 'cascading elevation changes', 'alternating grain orientation',
    ],
    tags: ['contacts', 'stacking', 'solver', 'rigid-bodies'],
    defaultStress: 3,
    recommendedMaxBodies: 1900,
    camera: { yaw: -0.78, pitch: 0.42, distance: 30, target: [0, 7, 0] },
  },
  {
    family: 'domino',
    category: 'Core Physics',
    titles: [
      'Domino Cathedral', 'Spiral Domino Garden', 'Double Helix Dominoes', 'Domino Ramp Relay', 'Concentric Contact Rings',
      'Long Hallway Chain', 'S-Curve Cascade', 'Domino Gate Array', 'Nested Figure Eight', 'Thin-Body Stability Trial',
    ],
    focus: [
      'thin vertical bodies and cascading impulses', 'curved-chain propagation', 'two synchronized contact waves', 'inclined relay sections', 'radial inward and outward triggering',
      'long-distance contact transfer', 'alternating tangential impacts', 'branching event timing', 'looped contact re-entry', 'narrow AABB solver edge cases',
    ],
    tags: ['domino', 'chain-reaction', 'thin-bodies', 'impulses'],
    defaultStress: 2,
    recommendedMaxBodies: 950,
    camera: { yaw: -1.2, pitch: 0.34, distance: 44, target: [0, 3, 0] },
  },
  {
    family: 'skyscraper',
    category: 'Buildings',
    titles: [
      'Skyscraper Impact Lab', 'Core-and-Shell Tower', 'Twin Tower Collision Test', 'Mega-Braced High Rise', 'Setback Office Tower',
      'Podium Tower Collapse', 'Diagonal Tube Frame', 'Skybridge Tower Pair', 'Stacked Module High Rise', 'Needle Spire Shake Test',
    ],
    focus: [
      'procedural tower collapse with projectile impact', 'dense central core and exterior frame', 'side-by-side tower interaction', 'diagonal brace failure', 'tiered floor-plate offsets',
      'wide podium and slender upper floors', 'tube-frame torsion', 'elevated connector impacts', 'prefab volumetric modules', 'slenderness and sway response',
    ],
    tags: ['building', 'tower', 'impact', 'collapse'],
    defaultStress: 3,
    recommendedMaxBodies: 1800,
    camera: { yaw: -0.65, pitch: 0.35, distance: 48, target: [0, 12, 0] },
  },
  {
    family: 'bridge',
    category: 'Infrastructure',
    titles: [
      'Bridge Load Test', 'Suspension Deck Proxy', 'Truss Span Failure', 'Arch Bridge Compression', 'Drawbridge Drop Test',
      'Rail Trestle Vibration', 'Causeway Blockade', 'Cantilever Span Stress', 'Covered Bridge Debris Test', 'Multi-Pier Viaduct',
    ],
    focus: [
      'deck segmentation and load piles', 'hanging-deck rhythm approximated by planks', 'triangular truss contact behavior', 'arch-like compression blocks', 'rotated ramp/deck impacts',
      'repeating rail ties and deck bounce', 'long low deck obstruction', 'unsupported mid-span sag', 'roofed span debris accumulation', 'many supports and long roadway',
    ],
    tags: ['bridge', 'infrastructure', 'load', 'planks'],
    defaultStress: 2,
    recommendedMaxBodies: 1300,
    camera: { yaw: -0.35, pitch: 0.38, distance: 40, target: [0, 4, 0] },
  },
  {
    family: 'material',
    category: 'Materials',
    titles: [
      'Material Bounce Lab', 'Ice vs Rubber Lanes', 'Sandpaper Friction Bank', 'Restitution Staircase', 'Heavy-Light Collision Matrix',
      'Ramp Angle Sweep', 'Bumper Rail Test', 'Floor Coating Comparison', 'Sliding Crate Gauntlet', 'Energy Loss Arena',
    ],
    focus: [
      'friction, restitution, ramps, and obstacle lanes', 'extreme low and high friction contrast', 'progressive drag response', 'bounce height comparison', 'density and mass distribution',
      'angle-dependent sliding', 'side-wall rebound behavior', 'surface material tuning', 'crates through mixed surfaces', 'damping and settling time',
    ],
    tags: ['materials', 'friction', 'restitution', 'ramps'],
    defaultStress: 2,
    recommendedMaxBodies: 1050,
    camera: { yaw: -0.9, pitch: 0.48, distance: 38, target: [0, 3, 0] },
  },
  {
    family: 'rain',
    category: 'Stress Tests',
    titles: [
      'Object Rain Stress Test', 'Million-Dollar Confetti Drop', 'Debris Storm Chamber', 'Falling Cargo Bay', 'Voxel Hail Simulation',
      'High-Altitude Drop Test', 'GPU Upload Saturation', 'Randomized Settling Cloud', 'Wide-Area Scatter Rain', 'Dense Core Rain Column',
    ],
    focus: [
      'high-volume spawning and transform streaming', 'colorful dense body churn', 'chaotic debris inflow', 'cargo-like falling boxes', 'small cube contact storm',
      'long fall acceleration', 'maximum matrix buffer upload pressure', 'deterministic random settling', 'broad spread occupancy', 'narrow dense collision column',
    ],
    tags: ['stress', 'rain', 'gpu-upload', 'throughput'],
    defaultStress: 4,
    recommendedMaxBodies: 4096,
    camera: { yaw: -0.72, pitch: 0.56, distance: 56, target: [0, 14, 0] },
  },
  {
    family: 'demolition',
    category: 'Destruction',
    titles: [
      'Castle Siege Impact', 'Block House Demolition', 'Rubble Wall Breach', 'Shockwave Courtyard', 'Falling Chimney Test',
      'Barrier Breach Range', 'Wrecking Ball Proxy', 'Explosive Core Failure', 'Stacked Barricade Assault', 'Progressive Collapse Theater',
    ],
    focus: [
      'projectile strikes against defensive walls', 'small building destruction', 'localized wall penetration', 'radial blast response', 'tall slender column fall',
      'multiple barriers and impact lanes', 'heavy moving block impact proxy', 'center-column removal by blast', 'layered barricade durability', 'failure wave traveling through structures',
    ],
    tags: ['destruction', 'blast', 'impact', 'rubble'],
    defaultStress: 3,
    recommendedMaxBodies: 1700,
    camera: { yaw: -0.82, pitch: 0.4, distance: 42, target: [0, 6, 0] },
  },
  {
    family: 'vehicle',
    category: 'Machines',
    titles: [
      'Vehicle Obstacle Course', 'Truck Cargo Spill', 'Forklift Pallet Push', 'Train Car Coupler Proxy', 'Rolling Crate Convoy',
      'Crash Barrier Test', 'Ramp Jump Cargo', 'Bulldozer Blade Proxy', 'Container Yard Collision', 'Heavy Hauler Load Shift',
    ],
    focus: [
      'moving box vehicles against obstacles', 'cargo stability under impacts', 'pallet pushing and friction', 'chain of car-like bodies', 'convoy spacing and contact',
      'barrier deformation by moving mass', 'ramp launch with carried blocks', 'wide blade sweeping debris', 'industrial lane collisions', 'load shift and rollover proxy',
    ],
    tags: ['vehicles', 'machines', 'cargo', 'obstacles'],
    defaultStress: 2,
    recommendedMaxBodies: 1300,
    camera: { yaw: -0.92, pitch: 0.38, distance: 46, target: [0, 3.5, 0] },
  },
  {
    family: 'marble',
    category: 'Machines',
    titles: [
      'Marble Run Box Proxy', 'Pinball Bumper Field', 'Sluice Gate Sorter', 'Funnel Drop Maze', 'Ramp Spiral Sorter',
      'Timing Gate Cascade', 'Obstacle Peg Board', 'Gravity Conveyor Course', 'Bowl Drain Proxy', 'Physics Toy Museum',
    ],
    focus: [
      'small cubes traveling through ramp systems', 'bumper field rebound', 'gate openings and sorted streams', 'funnel-like collisions', 'spiral ramp approximations',
      'delayed release timing', 'many pegs and small bodies', 'gravity-fed conveyor lanes', 'radial drain movement', 'toy-like mixed mechanisms',
    ],
    tags: ['marble-run', 'ramps', 'small-bodies', 'toy-physics'],
    defaultStress: 2,
    recommendedMaxBodies: 1200,
    camera: { yaw: -1.0, pitch: 0.5, distance: 42, target: [0, 5, 0] },
  },
  {
    family: 'construction',
    category: 'Buildings',
    titles: [
      'Construction Site Crane Drop', 'Framing Lumber Stack', 'Roof Truss Knockdown', 'Scaffold Stability Lab', 'Concrete Formwork Spill',
      'Modular House Assembly', 'Shed Builder Stress Test', 'Barndominium Frame Test', 'Skyscraper Floor Pack Drop', 'Foundation Block Layout',
    ],
    focus: [
      'dropped loads into active jobsite geometry', 'long boards and stack settling', 'truss-like triangular approximations', 'skinny scaffold towers', 'form panels and dense blocks',
      'volumetric modules landing together', 'portable-building component pile', 'long-span posts and wall frames', 'floor packs dropped onto columns', 'grid of heavy foundation units',
    ],
    tags: ['construction', 'building', 'assembly', 'jobsite'],
    defaultStress: 3,
    recommendedMaxBodies: 1800,
    camera: { yaw: -0.7, pitch: 0.42, distance: 46, target: [0, 6, 0] },
  },
  {
    family: 'warehouse',
    category: 'Logistics',
    titles: [
      'Warehouse Sorter Chaos', 'Rack Collapse Test', 'Conveyor Merge Jam', 'Pallet Avalanche', 'Loading Dock Impact',
      'Parcel Rain Sort', 'High-Bay Storage Failure', 'Fork Aisle Blockage', 'Crate Pyramid Shipping', 'Inventory Earthquake Proxy',
    ],
    focus: [
      'parcels through lane obstacles', 'rack supports and shelf contact', 'multiple streams merging', 'palletized stack collapse', 'dock bumper and cargo impact',
      'small packages dropped for sorting', 'tall storage rack instability', 'narrow aisle collisions', 'shipping crate pyramid pressure', 'uniform impulse across inventory stacks',
    ],
    tags: ['warehouse', 'logistics', 'pallets', 'sorter'],
    defaultStress: 3,
    recommendedMaxBodies: 1900,
    camera: { yaw: -0.86, pitch: 0.43, distance: 44, target: [0, 5, 0] },
  },
  {
    family: 'architecture',
    category: 'Architecture',
    titles: [
      'Temple Colonnade Collapse', 'Museum Atrium Drop', 'Stadium Seating Wave', 'Cathedral Nave Blocks', 'Dome Ring Compression',
      'City Block Microphysics', 'Archway Contact Test', 'Facade Panel Fall', 'Courtyard Pavilion Impact', 'Mega Structure Showcase',
    ],
    focus: [
      'rows of columns and roof slab behavior', 'open atrium with falling art crates', 'tiered seating contact wave', 'nave-like repetitive spans', 'ring compression proxy',
      'mini-city block interactions', 'stacked arch opening approximation', 'thin panels falling from facade', 'pavilion roof and columns', 'large mixed architectural set-piece',
    ],
    tags: ['architecture', 'columns', 'facade', 'showcase'],
    defaultStress: 3,
    recommendedMaxBodies: 1700,
    camera: { yaw: -0.68, pitch: 0.4, distance: 50, target: [0, 7, 0] },
  },
] as const;

const MODES = [
  { label: 'Baseline', focus: 'clean default behavior', stressDelta: 0, bodyDelta: 0, seconds: 8 },
  { label: 'High Stress', focus: 'larger body counts and heavier solver pressure', stressDelta: 1, bodyDelta: 260, seconds: 10 },
  { label: 'Precision', focus: 'smaller bodies, tighter spacing, and replay stability', stressDelta: -1, bodyDelta: 120, seconds: 9 },
  { label: 'Impact Demo', focus: 'presentation-ready action with strong impulse events', stressDelta: 0, bodyDelta: 180, seconds: 11 },
  { label: 'Cinematic', focus: 'wide camera storytelling and maximum visual value', stressDelta: 1, bodyDelta: 340, seconds: 12 },
] as const;

function cameraFor(def: FamilyDefinition, variant: number): CameraRig {
  const shift = (variant - 4.5) * 0.018;
  return {
    yaw: def.camera.yaw + shift,
    pitch: def.camera.pitch,
    distance: def.camera.distance + (variant % 3) * 2,
    target: [...def.camera.target] as [number, number, number],
  };
}

function makeScene(def: FamilyDefinition, variant: number, mode: number, id: number): ScenePreset {
  const modeDef = MODES[mode];
  const baseTitle = def.titles[variant];
  const focus = `${def.focus[variant]} with ${modeDef.focus}`;
  const stress = Math.max(1, Math.min(5, def.defaultStress + modeDef.stressDelta + ((variant % 4 === 3) ? 1 : 0) - ((variant % 5 === 1) ? 1 : 0)));
  const recommended = Math.min(4096, def.recommendedMaxBodies + variant * 55 + modeDef.bodyDelta);
  const title = `${baseTitle} — ${modeDef.label}`;
  return {
    id,
    key: def.family,
    family: def.family,
    variant,
    mode,
    category: def.category,
    title,
    subtitle: `${def.category} · ${focus}.`,
    details: `${title} is a procedural test recipe for ${focus}. It stresses Box3D/WASM simulation, JS fallback determinism, WebGPU transform streaming, one-draw-call instancing, debug wireframes, replay hashes, and browser smoke-test coverage.`,
    defaultStress: stress,
    recommendedMaxBodies: recommended,
    camera: cameraFor(def, variant),
    tags: [...def.tags, def.family, def.category.toLowerCase().replaceAll(' ', '-'), modeDef.label.toLowerCase().replaceAll(' ', '-')],
    tourSeconds: modeDef.seconds + (variant % 3),
  };
}

export const SCENES: readonly ScenePreset[] = FAMILIES.flatMap((def, familyIndex) =>
  MODES.flatMap((_, mode) =>
    def.titles.map((__, variant) => makeScene(def, variant, mode, familyIndex * 50 + mode * 10 + variant)),
  ),
) as readonly ScenePreset[];

export const SCENE_CATEGORIES: readonly SceneCategory[] = [
  'Core Physics', 'Buildings', 'Infrastructure', 'Materials', 'Stress Tests', 'Destruction', 'Machines', 'Logistics', 'Architecture',
] as const;

export const FEATURED_SCENE_IDS: readonly number[] = FAMILIES.flatMap((_, familyIndex) => {
  const base = familyIndex * 50;
  return [base + 0, base + 13];
}) as readonly number[];

export function getSceneById(id: number): ScenePreset {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[0];
}

export function getSceneByOrdinal(ordinal: number): ScenePreset {
  const wrapped = ((Math.round(ordinal) % SCENES.length) + SCENES.length) % SCENES.length;
  return SCENES[wrapped];
}

export function clampStress(stress: number): number {
  return Math.max(1, Math.min(5, Math.round(stress)));
}

export function sceneLabel(scene: ScenePreset): string {
  return `${String(scene.id + 1).padStart(3, '0')} · ${scene.title}`;
}

export function sceneSearchText(scene: ScenePreset): string {
  return `${scene.id + 1} ${scene.title} ${scene.subtitle} ${scene.details} ${scene.category} ${scene.family} ${scene.tags.join(' ')}`.toLowerCase();
}
