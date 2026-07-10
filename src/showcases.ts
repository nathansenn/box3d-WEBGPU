import { clamp, easeInOutCubic, lerp, lerpAngle, vec3Lerp, type Vec3 } from './math';
import { getSceneById } from './scenes';
import type { CameraRig } from './types';

export type ShowcaseActionKind =
  | 'caption'
  | 'kick'
  | 'explode'
  | 'projectile'
  | 'rain'
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
    { at: 2.6, label: 'Systems armed', detail: 'Solver, continuous collision, WebGPU shadow pass, HDR lighting, and replay telemetry are live.', action: 'caption' },
  ];

  if (def.action === 'impact') {
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

  common.push({ at: def.duration - 1.4, label: 'Telemetry lock', detail: 'Final body count, frame cost, transform bandwidth, and replay hash are captured.', action: 'caption' });
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
    id: 'atlas-suspension-convoy', sceneId: sceneId(3, 0), title: 'Atlas Suspension Convoy', category: 'Infrastructure',
    tagline: 'A segmented bridge carries concentrated cargo until a controlled mid-span disruption initiates deck failure.',
    objective: 'Visualize segmented deck contacts, moving load concentration, support response, and debris settling across a wide frame.',
    duration: 15, recommendedStress: 4, action: 'collapse', focalHeight: 5,
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
  const track = showcase.cameraTrack;
  if (track.length === 0) return getSceneById(showcase.sceneId).camera;
  if (timeSeconds <= track[0].at) return cloneRig(track[0].rig);
  if (timeSeconds >= track[track.length - 1].at) return cloneRig(track[track.length - 1].rig);

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (timeSeconds < a.at || timeSeconds > b.at) continue;
    const t = easeInOutCubic((timeSeconds - a.at) / Math.max(0.001, b.at - a.at));
    return {
      yaw: lerpAngle(a.rig.yaw, b.rig.yaw, t),
      pitch: lerp(a.rig.pitch, b.rig.pitch, t),
      distance: lerp(a.rig.distance, b.rig.distance, t),
      target: vec3Lerp(a.rig.target, b.rig.target, t),
    };
  }

  return cloneRig(track[track.length - 1].rig);
}

function cloneRig(value: CameraRig): CameraRig {
  return { yaw: value.yaw, pitch: value.pitch, distance: value.distance, target: [...value.target] as Vec3 };
}
