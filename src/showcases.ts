import { clamp, easeInOutCubic, lerp, lerpAngle, type Vec3 } from './math';
import { getSceneById } from './scenes';
import type { CameraRig } from './types';

export type ShowcaseActionKind =
  | 'caption'
  | 'kick'
  | 'explode'
  | 'projectile'
  | 'rain'
  | 'set-load'
  | 'release-load'
  | 'slowmo'
  | 'normal-speed';

export type ShowcaseBeat = {
  at: number;
  label: string;
  detail: string;
  action: ShowcaseActionKind;
  center?: Vec3;
  strength?: number;
  radius?: number;
  count?: number;
};

export type CameraKeyframe = {
  at: number;
  rig: CameraRig;
};

export type AAAShowcase = {
  id: string;
  sceneId: number;
  title: string;
  category: string;
  tagline: string;
  objective: string;
  duration: number;
  recommendedStress: number;
  cameraTrack: readonly CameraKeyframe[];
  beats: readonly ShowcaseBeat[];
};

type ShowcaseDefinition = Omit<AAAShowcase, 'cameraTrack' | 'beats'> & {
  action: 'collapse' | 'impact' | 'storm' | 'cascade';
  focalHeight?: number;
  softSystem?: 'cloth' | 'rope' | 'water' | 'fracture';
};

function sceneId(familyIndex: number, variant: number): number {
  return familyIndex * 50 + 40 + variant;
}

function rig(base: CameraRig, yawOffset: number, pitchOffset: number, distanceScale: number, targetOffset: Vec3): CameraRig {
  return {
    yaw: base.yaw + yawOffset,
    pitch: clamp(base.pitch + pitchOffset, 0.08, 1.28),
    distance: Math.max(8, base.distance * distanceScale),
    target: [
      base.target[0] + targetOffset[0],
      base.target[1] + targetOffset[1],
      base.target[2] + targetOffset[2],
    ],
  };
}

function buildCameraTrack(def: ShowcaseDefinition): readonly CameraKeyframe[] {
  const base = getSceneById(def.sceneId).camera;
  const h = def.focalHeight ?? base.target[1];
  const targetLift = h - base.target[1];
  return [
    { at: 0, rig: rig(base, -0.58, -0.05, 1.22, [0, targetLift * 0.35, 0]) },
    { at: 3.2, rig: rig(base, -0.10, 0.03, 0.98, [0, targetLift * 0.65, 0]) },
    { at: 7.0, rig: rig(base, 0.62, 0.06, 0.78, [0, targetLift, 0]) },
    { at: 11.5, rig: rig(base, 1.42, -0.02, 0.68, [0, targetLift * 0.82, 0]) },
    { at: def.duration, rig: rig(base, 2.22, -0.08, 1.08, [0, targetLift * 0.45, 0]) },
  ];
}

function buildBeats(def: ShowcaseDefinition): readonly ShowcaseBeat[] {
  const center: Vec3 = [0, Math.max(2.5, def.focalHeight ?? 4), 0];
  const common: ShowcaseBeat[] = [
    { at: 0.2, label: 'Establishing shot', detail: def.tagline, action: 'caption' },
    { at: 2.6, label: 'Systems armed', detail: def.softSystem
      ? `${def.softSystem === 'water' ? 'Shallow-water' : def.softSystem === 'fracture' ? 'Material-failure beam-lattice' : 'Position-based'} constraints, Box3D stage bodies, WebGPU presentation, HDR lighting, and replay telemetry are live.`
      : 'Solver, continuous collision, WebGPU shadow pass, HDR lighting, and replay telemetry are live.', action: 'caption' },
  ];

  if (def.softSystem === 'fracture') {
    common.push(
      { at: 3.4, label: 'Elastic preload', detail: 'The displacement-controlled rig begins below the material yield point.', action: 'set-load', strength: 0.42 },
      { at: 5.0, label: 'Yield inspection', detail: 'Time dilation exposes elastic bending, strain concentration, and the first permanent set.', action: 'slowmo' },
      { at: 5.6, label: 'Yield threshold', detail: 'The actuator crosses the tuned yield envelope while the lattice redistributes load.', action: 'set-load', strength: 0.96 },
      { at: 7.5, label: 'Plastic hinge', detail: 'Continued displacement accumulates damage and reveals the difference between ductile and brittle response.', action: 'set-load', strength: 1.38 },
      { at: 9.2, label: 'Controlled flaw', detail: 'A ballistic strike introduces a localized defect at peak bending demand.', action: 'projectile' },
      { at: 10.8, label: 'Ultimate load', detail: 'The rig advances to the configured fracture envelope and captures the final break pattern.', action: 'set-load', strength: 2.0 },
      { at: 13.2, label: 'Unload and inspect', detail: 'The actuator releases so elastic recovery, permanent set, damage, and separated members remain visible.', action: 'release-load' },
      { at: 14.0, label: 'Failure review', detail: 'Full-rate simulation resumes for the final material telemetry lock.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'cloth') {
    common.push(
      { at: 3.6, label: 'Wind front', detail: 'A directional pressure pulse travels across pinned fabric and exposes the constraint network.', action: 'kick', strength: 11 },
      { at: 5.0, label: 'Fiber inspection', detail: 'Time dilation reveals structural, shear, and bend constraints redistributing strain.', action: 'slowmo' },
      { at: 6.4, label: 'Ballistic puncture', detail: 'A high-speed body drives local deformation and can open topology in break-enabled fabric.', action: 'projectile' },
      { at: 8.2, label: 'Pressure shock', detail: 'A radial air-blast creates a second moving deformation front.', action: 'explode', center, strength: 18, radius: 10 },
      { at: 10.1, label: 'Recovery', detail: 'The fabric returns to real time for damping, draping, and final tension telemetry.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'rope') {
    common.push(
      { at: 3.8, label: 'Load swing', detail: 'A broad impulse excites the cable system and transfers energy through every tension member.', action: 'kick', strength: 10 },
      { at: 5.2, label: 'Tension slow motion', detail: 'Time dilation exposes catenary motion, payload inertia, and anchor reaction.', action: 'slowmo' },
      { at: 6.8, label: 'Cable strike', detail: 'A projectile intersects the line field and may sever the closest overloaded segment.', action: 'projectile' },
      { at: 8.5, label: 'Secondary load pulse', detail: 'A radial impulse challenges load sharing after the initial cable event.', action: 'explode', center, strength: 17, radius: 11 },
      { at: 10.4, label: 'Residual oscillation', detail: 'Full-rate simulation resumes for damping, broken-line count, and payload settling.', action: 'normal-speed' },
    );
  } else if (def.softSystem === 'water') {
    common.push(
      { at: 3.5, label: 'Surface forcing', detail: 'A directional wave enters the basin and begins reflecting from the containment boundary.', action: 'kick', strength: 10 },
      { at: 5.0, label: 'Rain field', detail: 'Hundreds of droplets inject localized momentum and high-frequency ripples.', action: 'rain', count: 360 },
      { at: 6.2, label: 'Hydrodynamic inspection', detail: 'Time dilation reveals interference, current vectors, foam generation, and buoyancy response.', action: 'slowmo' },
      { at: 7.6, label: 'Leviathan entry', detail: 'A ballistic body enters the surface and couples into the floating-object solver.', action: 'projectile' },
      { at: 9.0, label: 'Impact crown', detail: 'A controlled radial disturbance produces a large splash crown and reflected wave train.', action: 'explode', center: [0, 1.5, 0], strength: 21, radius: 12 },
      { at: 11.0, label: 'Basin recovery', detail: 'The surface returns to real time for boundary reflections, damping, and energy telemetry.', action: 'normal-speed' },
    );
  } else if (def.action === 'impact') {
    common.push(
      { at: 4.1, label: 'Kinetic launch', detail: 'A high-density projectile enters the structure at camera-relative velocity.', action: 'projectile' },
      { at: 5.3, label: 'Impact time dilation', detail: 'Simulation speed drops to expose contact propagation and secondary failures.', action: 'slowmo' },
      { at: 6.0, label: 'Primary breach', detail: 'A localized impulse visualizes the breach zone and accelerating debris field.', action: 'explode', center, strength: 19, radius: 8 },
      { at: 8.3, label: 'Real-time recovery', detail: 'Normal simulation speed resumes as the structure finds its new load path.', action: 'normal-speed' },
    );
  } else if (def.action === 'storm') {
    common.push(
      { at: 3.8, label: 'Storm front', detail: 'A deterministic high-altitude body field begins streaming into the arena.', action: 'rain', count: 520 },
      { at: 6.0, label: 'Maximum density', detail: 'A second wave saturates collision pairs and transform uploads.', action: 'rain', count: 760 },
      { at: 7.2, label: 'Throughput slow motion', detail: 'The camera closes in while the simulation exposes settling and rebound behavior.', action: 'slowmo' },
      { at: 9.4, label: 'Full-rate stress', detail: 'The lab returns to real time for the final accumulation phase.', action: 'normal-speed' },
    );
  } else if (def.action === 'cascade') {
    common.push(
      { at: 4.0, label: 'Cascade trigger', detail: 'A directional impulse starts the designed chain reaction.', action: 'kick', strength: 8.5 },
      { at: 5.8, label: 'Propagation study', detail: 'Time dilation reveals the traveling contact wave and delayed secondary motion.', action: 'slowmo' },
      { at: 8.2, label: 'Secondary pulse', detail: 'A controlled radial impulse tests whether the cascade remains numerically stable.', action: 'explode', center, strength: 12, radius: 10 },
      { at: 10.0, label: 'Resolution', detail: 'The system returns to full rate for settling, sleeping, and replay hashing.', action: 'normal-speed' },
    );
  } else {
    common.push(
      { at: 4.0, label: 'Load-path disruption', detail: 'A broad impulse challenges stacked contacts and structural redundancy.', action: 'kick', strength: 10.5 },
      { at: 5.2, label: 'Collapse slow motion', detail: 'Time dilation highlights buckling, toppling, and collision ordering.', action: 'slowmo' },
      { at: 7.4, label: 'Controlled shockwave', detail: 'A localized blast creates a second failure front without resetting the simulation.', action: 'explode', center, strength: 15, radius: 9 },
      { at: 9.6, label: 'Final settling', detail: 'Full-rate simulation resumes for debris settling and stability telemetry.', action: 'normal-speed' },
    );
  }

  common.push({ at: def.duration - 1.4, label: 'Telemetry lock', detail: 'Final body/node count, constraint state, frame cost, transform bandwidth, and replay hash are captured.', action: 'caption' });
  return common.sort((a, b) => a.at - b.at);
}

const DEFINITIONS: readonly ShowcaseDefinition[] = [
  {
    id: 'titan-foundry-stackfall', sceneId: sceneId(0, 0), title: 'Titan Foundry Stackfall', category: 'Structural Stability',
    tagline: 'A multi-layer industrial block foundry transitions from perfect balance into a controlled avalanche.',
    objective: 'Demonstrate dense stacked contacts, solver stability, HDR material separation, shadow fidelity, and cinematic collapse framing.',
    duration: 14, recommendedStress: 4, action: 'collapse', focalHeight: 9,
  },
  {
    id: 'masonry-shear-cathedral', sceneId: sceneId(0, 7), title: 'Masonry Shear Cathedral', category: 'Structural Stability',
    tagline: 'Offset masonry towers and cantilevered shelves reveal progressive shear failure across thousands of contacts.',
    objective: 'Expose micro-offset settling, load transfer, toppling order, and deterministic replay behavior under a second shock front.',
    duration: 15, recommendedStress: 5, action: 'collapse', focalHeight: 11,
  },
  {
    id: 'cathedral-of-motion', sceneId: sceneId(1, 0), title: 'Cathedral of Motion', category: 'Chain Reactions',
    tagline: 'A ceremonial field of thin bodies carries one precise impulse through a monumental radial composition.',
    objective: 'Show thin-body stability, contact-wave timing, cinematic orbit tracking, and high-contrast motion readability.',
    duration: 14, recommendedStress: 3, action: 'cascade', focalHeight: 3,
  },
  {
    id: 'helix-relay-protocol', sceneId: sceneId(1, 2), title: 'Helix Relay Protocol', category: 'Chain Reactions',
    tagline: 'Twin contact waves travel through interlocked helical paths before colliding at the center stage.',
    objective: 'Stress synchronized propagation, branching contact order, slow-motion inspection, and replay consistency.',
    duration: 15, recommendedStress: 4, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'aegis-tower-kinetic-breach', sceneId: sceneId(2, 0), title: 'Aegis Tower: Kinetic Breach', category: 'High-Rise Destruction',
    tagline: 'A core-and-shell tower absorbs a high-density strike before its damaged load path redistributes floor by floor.',
    objective: 'Present continuous collision, high-rise contact density, cinematic impact timing, shadowed debris, and structural collapse.',
    duration: 16, recommendedStress: 4, action: 'impact', focalHeight: 14,
  },
  {
    id: 'twin-spire-progressive-collapse', sceneId: sceneId(2, 7), title: 'Twin Spire Progressive Collapse', category: 'High-Rise Destruction',
    tagline: 'Two towers linked by a skybridge enter a coupled failure state after a single lateral strike.',
    objective: 'Demonstrate coupled structures, elevated connectors, asymmetric collapse, camera shake, and high body-count rendering.',
    duration: 17, recommendedStress: 5, action: 'impact', focalHeight: 16,
  },
  {
    id: 'truss-span-failure', sceneId: sceneId(3, 2), title: 'Truss Span Failure', category: 'Infrastructure',
    tagline: 'A triangular truss corridor carries a concentrated load until a lateral strike breaks its repeating support path.',
    objective: 'Visualize truss contact transfer, brace loss, mid-span impact, progressive deck failure, and debris settling across a wide frame.',
    duration: 16, recommendedStress: 5, action: 'impact', focalHeight: 5,
  },
  {
    id: 'viaduct-shockwave', sceneId: sceneId(3, 9), title: 'Viaduct Shockwave', category: 'Infrastructure',
    tagline: 'A multi-pier transport span is tested by a traveling impulse and a secondary centerline shockwave.',
    objective: 'Show long-span failure propagation, repeated supports, broad camera choreography, and stable high-volume transforms.',
    duration: 16, recommendedStress: 5, action: 'cascade', focalHeight: 6,
  },
  {
    id: 'hypermaterial-gauntlet', sceneId: sceneId(4, 0), title: 'Hypermaterial Gauntlet', category: 'Materials',
    tagline: 'Multiple lanes compare friction, restitution, mass, damping, and surface response in a single cinematic experiment.',
    objective: 'Make material differences immediately visible through synchronized bodies, lane lighting, bounce height, and settling time.',
    duration: 14, recommendedStress: 3, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'restitution-reactor', sceneId: sceneId(4, 3), title: 'Restitution Reactor', category: 'Materials',
    tagline: 'A staircase of tuned surfaces turns identical impacts into dramatically different energy-retention signatures.',
    objective: 'Compare restitution and friction while validating fixed-step determinism and high-frequency contact rendering.',
    duration: 14, recommendedStress: 4, action: 'cascade', focalHeight: 5,
  },
  {
    id: 'orbital-cargo-storm', sceneId: sceneId(5, 0), title: 'Orbital Cargo Storm', category: 'Maximum Stress',
    tagline: 'Thousands of cargo modules enter a fortified receiving arena in two escalating orbital drop waves.',
    objective: 'Push body creation, collision throughput, matrix streaming, HDR color separation, and browser responsiveness.',
    duration: 16, recommendedStress: 5, action: 'storm', focalHeight: 16,
  },
  {
    id: 'debris-cyclone-chamber', sceneId: sceneId(5, 2), title: 'Debris Cyclone Chamber', category: 'Maximum Stress',
    tagline: 'A deterministic debris cloud saturates a narrow collision column before spreading across the containment floor.',
    objective: 'Measure transform upload bandwidth, collision saturation, stable camera motion, and finite-matrix guarantees.',
    duration: 17, recommendedStress: 5, action: 'storm', focalHeight: 18,
  },
  {
    id: 'citadel-siege', sceneId: sceneId(6, 0), title: 'Citadel Siege', category: 'Destruction',
    tagline: 'Layered defensive walls, towers, and barricades meet a cinematic projectile strike and secondary breach charge.',
    objective: 'Show localized penetration, rubble generation, progressive wall failure, emissive impact effects, and camera shake.',
    duration: 16, recommendedStress: 4, action: 'impact', focalHeight: 6,
  },
  {
    id: 'core-breach-theater', sceneId: sceneId(6, 7), title: 'Core Breach Theater', category: 'Destruction',
    tagline: 'A dense structural core is removed from within, forcing the surrounding shell into a delayed collapse sequence.',
    objective: 'Reveal radial impulse falloff, delayed failure, secondary contacts, and dramatic close-range collapse coverage.',
    duration: 16, recommendedStress: 5, action: 'collapse', focalHeight: 8,
  },
  {
    id: 'titan-hauler-crash-range', sceneId: sceneId(7, 0), title: 'Titan Hauler Crash Range', category: 'Machines',
    tagline: 'Heavy haulers cross an obstacle field with shifting cargo before striking a reinforced barrier line.',
    objective: 'Demonstrate moving masses, carried cargo, barrier contacts, rollover proxies, and low-angle tracking shots.',
    duration: 15, recommendedStress: 4, action: 'impact', focalHeight: 3,
  },
  {
    id: 'container-convoy-rollover', sceneId: sceneId(7, 9), title: 'Container Convoy Rollover', category: 'Machines',
    tagline: 'A synchronized convoy experiences asymmetric load shift, lane interference, and cascading cargo loss.',
    objective: 'Stress moving-body contact chains, cargo stability, multi-lane occupancy, and cinematic motion continuity.',
    duration: 16, recommendedStress: 5, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'chronos-gravity-foundry', sceneId: sceneId(8, 0), title: 'Chronos Gravity Foundry', category: 'Kinetic Machines',
    tagline: 'A monumental gravity course guides hundreds of small bodies through ramps, gates, pegs, and sorting lanes.',
    objective: 'Show small-body throughput, repeated impacts, visually readable motion trails, and detailed set-piece lighting.',
    duration: 15, recommendedStress: 4, action: 'cascade', focalHeight: 6,
  },
  {
    id: 'pinball-reactor', sceneId: sceneId(8, 1), title: 'Pinball Reactor', category: 'Kinetic Machines',
    tagline: 'A dense bumper field turns one release event into a sustained reactor of rebounds and redirected momentum.',
    objective: 'Demonstrate restitution, repeated collisions, high-frequency transform updates, and stable post-processing.',
    duration: 15, recommendedStress: 5, action: 'cascade', focalHeight: 5,
  },
  {
    id: 'sky-crane-load-failure', sceneId: sceneId(9, 0), title: 'Sky Crane Load Failure', category: 'Construction',
    tagline: 'A tower crane load enters an active steel frame and produces a cascading jobsite failure.',
    objective: 'Present long members, falling loads, floor-pack impacts, construction geometry, and a wide-to-close cinematic path.',
    duration: 16, recommendedStress: 4, action: 'impact', focalHeight: 10,
  },
  {
    id: 'modular-megaframe-assembly', sceneId: sceneId(9, 5), title: 'Modular Megaframe Assembly', category: 'Construction',
    tagline: 'Volumetric building modules settle into a partially completed frame before a controlled alignment failure.',
    objective: 'Show module mass, broad face contacts, support loss, structural alignment, and final settling quality.',
    duration: 15, recommendedStress: 4, action: 'collapse', focalHeight: 8,
  },
  {
    id: 'high-bay-cascade', sceneId: sceneId(10, 1), title: 'High-Bay Cascade', category: 'Logistics',
    tagline: 'Loaded storage racks fail aisle by aisle, releasing pallets into a dense warehouse-wide cascade.',
    objective: 'Stress tall narrow supports, shelves, parcels, progressive collapse, and deep-scene shadow readability.',
    duration: 17, recommendedStress: 5, action: 'collapse', focalHeight: 7,
  },
  {
    id: 'automated-sorter-blackout', sceneId: sceneId(10, 0), title: 'Automated Sorter Blackout', category: 'Logistics',
    tagline: 'Four parcel streams collide when routing lanes lose synchronization and the merge zone saturates.',
    objective: 'Demonstrate many small bodies, lane merging, blockage growth, deterministic randomness, and throughput telemetry.',
    duration: 15, recommendedStress: 4, action: 'cascade', focalHeight: 4,
  },
  {
    id: 'colonnade-resonance', sceneId: sceneId(11, 0), title: 'Colonnade Resonance', category: 'Architecture',
    tagline: 'A monumental ring of columns and layered roof plates responds to a traveling structural pulse.',
    objective: 'Show repeated architectural elements, roof-load transfer, radial collapse, and sweeping cinematic orbit coverage.',
    duration: 16, recommendedStress: 4, action: 'cascade', focalHeight: 9,
  },
  {
    id: 'mega-atrium-collapse', sceneId: sceneId(11, 9), title: 'Mega Atrium Collapse', category: 'Architecture',
    tagline: 'A large mixed-use atrium, facade field, and elevated roof system enter progressive failure after a kinetic breach.',
    objective: 'Deliver the final all-systems showcase: impact, architecture, debris, shadows, bloom, fog, effects, and telemetry.',
    duration: 18, recommendedStress: 5, action: 'impact', focalHeight: 11,
  },

  {
    id: 'tempest-standard-protocol', sceneId: sceneId(12, 0), title: 'Tempest Standard Protocol', category: 'Soft-Body Cloth',
    tagline: 'A monumental fabric standard enters a staged wind front, ballistic puncture, and pressure-wave recovery sequence.',
    objective: 'Demonstrate pinned-edge cloth, structural/shear/bend constraints, turbulent forcing, topology separation, dynamic normals, and two-sided WebGPU shading.',
    duration: 16, recommendedStress: 4, action: 'cascade', focalHeight: 7, softSystem: 'cloth',
  },
  {
    id: 'parachute-canopy-failure', sceneId: sceneId(12, 6), title: 'Parachute Canopy Failure', category: 'Soft-Body Cloth',
    tagline: 'A tensioned canopy catches air, deforms around an impact body, and opens a progressive constraint failure under load.',
    objective: 'Show four-corner loading, curved membrane response, collision coupling, strain visualization, tearing, and deterministic recovery.',
    duration: 17, recommendedStress: 5, action: 'impact', focalHeight: 10, softSystem: 'cloth',
  },
  {
    id: 'sky-crane-cable-failure', sceneId: sceneId(13, 0), title: 'Sky Crane Cable Failure', category: 'Rope and Rigging',
    tagline: 'A long crane cable carries a heavy industrial payload through swing, impact, line failure, and residual oscillation.',
    objective: 'Demonstrate cable tension, bend constraints, concentrated mass, projectile severing, payload inertia, and anchor stability.',
    duration: 17, recommendedStress: 5, action: 'collapse', focalHeight: 9, softSystem: 'rope',
  },
  {
    id: 'suspension-cable-resonance', sceneId: sceneId(13, 1), title: 'Suspension Cable Resonance', category: 'Rope and Rigging',
    tagline: 'Twin catenary cables and cross-planks carry a traveling oscillation before a localized cable strike changes the load path.',
    objective: 'Show coupled ropes, catenary geometry, cross constraints, resonance propagation, line tension coloring, and partial failure.',
    duration: 17, recommendedStress: 4, action: 'cascade', focalHeight: 7, softSystem: 'rope',
  },
  {
    id: 'tsunami-research-array', sceneId: sceneId(14, 1), title: 'Tsunami Research Array', category: 'Interactive Water',
    tagline: 'A large wave front crosses a cinematic research basin, reflects from its boundaries, and collides with secondary forcing.',
    objective: 'Demonstrate linear shallow-water propagation, boundary reflection, interference, foam, current telemetry, and HDR water shading.',
    duration: 18, recommendedStress: 5, action: 'cascade', focalHeight: 2, softSystem: 'water',
  },
  {
    id: 'leviathan-impact-basin', sceneId: sceneId(14, 9), title: 'Leviathan Impact Basin', category: 'Interactive Water',
    tagline: 'Rain, traveling waves, a ballistic entry body, and a massive splash crown converge in the lab’s fluid finale.',
    objective: 'Show wave interference, droplet coupling, buoyancy proxies, impact displacement, splash particles, current vectors, and post-processed water highlights.',
    duration: 19, recommendedStress: 5, action: 'impact', focalHeight: 2, softSystem: 'water',
  },
  {
    id: 'steel-yield-to-rupture', sceneId: sceneId(15, 0), title: 'Steel Yield-to-Rupture', category: 'Material Failure',
    tagline: 'A structural-steel specimen progresses from elastic bend through plastic-hinge formation and final ductile rupture.',
    objective: 'Show displacement-controlled loading, yield onset, permanent set, damage accumulation, fracture separation, and exact breakpoint telemetry.',
    duration: 17, recommendedStress: 4, action: 'collapse', focalHeight: 4.5, softSystem: 'fracture',
  },
  {
    id: 'glass-catastrophic-fracture', sceneId: sceneId(15, 6), title: 'Glass Catastrophic Fracture', category: 'Material Failure',
    tagline: 'A soda-lime glass plate carries a precise preload before a localized flaw triggers a sudden brittle fracture front.',
    objective: 'Contrast a narrow elastic envelope with negligible plastic set, rapid damage localization, abrupt member loss, and deterministic crack progression.',
    duration: 17, recommendedStress: 5, action: 'impact', focalHeight: 4.5, softSystem: 'fracture',
  },
] as const;

export const AAA_SHOWCASES: readonly AAAShowcase[] = DEFINITIONS.map((def) => ({
  id: def.id,
  sceneId: def.sceneId,
  title: def.title,
  category: def.category,
  tagline: def.tagline,
  objective: def.objective,
  duration: def.duration,
  recommendedStress: def.recommendedStress,
  cameraTrack: buildCameraTrack(def),
  beats: buildBeats(def),
}));

export function getShowcaseById(id: string): AAAShowcase {
  return AAA_SHOWCASES.find((showcase) => showcase.id === id) ?? AAA_SHOWCASES[0];
}

export function getShowcaseByOrdinal(index: number): AAAShowcase {
  const wrapped = ((Math.round(index) % AAA_SHOWCASES.length) + AAA_SHOWCASES.length) % AAA_SHOWCASES.length;
  return AAA_SHOWCASES[wrapped];
}

export function sampleShowcaseCamera(showcase: AAAShowcase, timeSeconds: number): CameraRig {
  if (showcase.cameraTrack.length === 0) return getSceneById(showcase.sceneId).camera;
  return sampleShowcaseCameraInto(showcase, timeSeconds, { yaw: 0, pitch: 0, distance: 0, target: [0, 0, 0] });
}

/** Allocation-free camera-track sampling for the per-frame director path. */
export function sampleShowcaseCameraInto(showcase: AAAShowcase, timeSeconds: number, out: CameraRig): CameraRig {
  const track = showcase.cameraTrack;
  if (track.length === 0) return cloneRigInto(out, getSceneById(showcase.sceneId).camera);
  if (timeSeconds <= track[0].at) return cloneRigInto(out, track[0].rig);
  if (timeSeconds >= track[track.length - 1].at) return cloneRigInto(out, track[track.length - 1].rig);

  // Every built-in director track has five keys. Select its segment directly
  // while retaining the generic path for external/custom showcase data.
  if (track.length === 5) {
    const index = timeSeconds <= track[1].at ? 0
      : timeSeconds <= track[2].at ? 1
      : timeSeconds <= track[3].at ? 2
      : 3;
    const a = track[index];
    const b = track[index + 1];
    const t = easeInOutCubic((timeSeconds - a.at) / Math.max(0.001, b.at - a.at));
    out.yaw = lerpAngle(a.rig.yaw, b.rig.yaw, t);
    out.pitch = lerp(a.rig.pitch, b.rig.pitch, t);
    out.distance = lerp(a.rig.distance, b.rig.distance, t);
    out.target[0] = lerp(a.rig.target[0], b.rig.target[0], t);
    out.target[1] = lerp(a.rig.target[1], b.rig.target[1], t);
    out.target[2] = lerp(a.rig.target[2], b.rig.target[2], t);
    return out;
  }

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (timeSeconds < a.at || timeSeconds > b.at) continue;
    const t = easeInOutCubic((timeSeconds - a.at) / Math.max(0.001, b.at - a.at));
    out.yaw = lerpAngle(a.rig.yaw, b.rig.yaw, t);
    out.pitch = lerp(a.rig.pitch, b.rig.pitch, t);
    out.distance = lerp(a.rig.distance, b.rig.distance, t);
    out.target[0] = lerp(a.rig.target[0], b.rig.target[0], t);
    out.target[1] = lerp(a.rig.target[1], b.rig.target[1], t);
    out.target[2] = lerp(a.rig.target[2], b.rig.target[2], t);
    return out;
  }

  return cloneRigInto(out, track[track.length - 1].rig);
}

function cloneRigInto(out: CameraRig, value: CameraRig): CameraRig {
  out.yaw = value.yaw;
  out.pitch = value.pitch;
  out.distance = value.distance;
  out.target[0] = value.target[0];
  out.target[1] = value.target[1];
  out.target[2] = value.target[2];
  return out;
}
