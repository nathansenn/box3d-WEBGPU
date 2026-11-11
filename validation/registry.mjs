// The validation registry: every domain, in the order the report prints them, and every case.
//
// Why a top-level `validation/` folder: the cases span the kit (packages/box3d-kit) and the engine
// (src/engine), so they belong to neither; they are not tests (they report numbers, they do not
// assert), so they do not belong in tests/; and scripts/ holds entry points, not data. The runner is
// scripts/validation-report.mjs and the tests of this folder are tests/validation/.
//
// `notValidated` is drawn from the limits sections of the documents listed in `docs`. Keep it honest:
// a line belongs here when a reader could otherwise assume the cases above cover it.
import rigid from './domains/rigid.mjs';
import waterCoupling from './domains/water-coupling.mjs';
import structureCoupling from './domains/structure-coupling.mjs';
import geometry from './domains/geometry.mjs';
import scene from './domains/scene.mjs';
import heat from './domains/heat.mjs';
import solid from './domains/solid.mjs';
import frame from './domains/frame.mjs';
import cable from './domains/cable.mjs';
import closedWater from './domains/closed-water.mjs';

export const DOMAINS = [
  {
    id: 'rigid', title: 'Rigid bodies, joints and shapes', needsKit: true,
    solver: 'Box3D compiled to WebAssembly, through `box3d-webgpu-kit` (float32 state, 240 Hz, 4 sub-steps)',
    summary: 'Free fall, pendulums, friction, restitution, collisions, forces and torques, joint motors and springs, and motion on triangle-mesh and height-field ground.',
    docs: ['packages/box3d-kit/README.md'],
    notValidated: [
      'Stacks, piles and many-body contact: every case here has one or two bodies in contact. Stack stability and friction in piles are not checked against a reference.',
      'Rolling is checked for a sphere only, and the contact slips slightly (the rolling case allows 1%). There is no rolling-resistance or spinning-friction reference.',
      'Restitution is checked at one speed and one coefficient. Box3D applies restitution only above a threshold speed.',
      'Wheel, weld and spherical joints have no closed-form row here: wheel and weld joints are tested for behaviour only (a car drives and steers, a weld keeps its spacing).',
      'Compound shapes are not exported by the bridge. Triangle meshes and height fields are static only.',
      'One build on one machine. The cross-device determinism matrix is a separate roadmap item; the kit records identical hashes on arm64 Node and Bun only.',
    ],
  },
  {
    id: 'water-coupling', title: 'Rigid bodies in water', needsKit: true,
    solver: '`box3d-webgpu-kit/coupling`: exact submerged volumes of boxes, spheres and capsules on a linear shallow-water basin (float64), two-way',
    summary: 'Archimedes for three shapes, draught, volume and force balances, heave and roll periods, terminal velocity, the righting moment and the energy budget.',
    docs: ['docs/WATER_COUPLING.md'],
    notValidated: [
      'One rectangular basin with a flat bottom and closed walls. No wetting or drying, sloped beds, inflow or outflow.',
      'Linear, small-amplitude waves only: no advection, breaking, splash or dispersion beyond the grid\'s. The heave case passes at 1% only because the spar is slender; a squat body in shallow water does not meet it.',
      'No added mass, lift or viscosity. Drag is a model with a coefficient you set: the terminal-velocity case checks the force balance, not the drag coefficient.',
      'Each body sees one plane of water averaged over a kernel about twice its size. Waves shorter than the body are averaged away; bodies do not shelter each other.',
      'Boxes, spheres and capsules only, one shape per body. Hulls and meshes are not coupled.',
      'CPU only; the WebGPU closed-water solver is not coupled. Not used by a scene, the Lab or the Studio yet.',
    ],
  },
  {
    id: 'structure-coupling', title: 'Cables and frames carrying rigid bodies', needsKit: true,
    solver: '`box3d-webgpu-kit/structure`: an implicit interface solve between the rigid world and the cable and frame solvers',
    summary: 'A hanging load, cable and spring pendulums, a tether in zero gravity, an off-centre attachment, bodies on a cantilever tip and at midspan, a body on a cable on a beam, a raised support and a cable-stayed span.',
    docs: ['docs/STRUCTURE_COUPLING.md'],
    notValidated: [
      'Contact between bodies and members. A free body does not collide with a cable or a beam; cables have no collisions at all.',
      'Cable bending and torsion. Cables are axial and tension-only; an attachment transmits force, never a moment.',
      'Frame nonlinearity: no buckling, yielding or geometric stiffness, and a clamped body\'s rotation is meaningful for small rotations only.',
      'Other constraints on an attached body. The interface uses the body\'s free response, so a cable to a body that also rests on the ground reads a wrong small tension (measured 97 N to 221 N where the true value is about 0).',
      'The cable step is implicit Euler: first order and numerically damped (the cable pendulum loses about a fifth of its swing energy in 20 s).',
      'Attachments between nodes, gyroscopic terms, step-size changes and checkpoints of the coupling state.',
    ],
  },
  {
    id: 'geometry', title: 'Geometry import, hulls and decomposition', needsKit: true,
    solver: '`box3d-webgpu-kit/geometry`: OBJ, STL and glTF/GLB readers, mesh measures, convex hulls and greedy convex decomposition',
    summary: 'Volumes and centroids of generated files in every format, hull volumes, an exact decomposition, and imported meshes used as bodies and terrain.',
    docs: ['packages/box3d-kit/README.md'],
    notValidated: [
      'Curved concavities are only approached by the decomposition: a torus is off by 24% with 8 hulls, 9% with 16 and 3% with 32. Only solids with flat inner faces split exactly, and only those have rows here.',
      'A hull body keeps at most 64 points (44 for a hull of triangles): a decimated sphere hull is smaller than the sphere. Mass is corrected to the mesh volume; the collision shape is not.',
      'Every fixture is generated by the tests. Files written by CAD or DCC tools, glTF extensions, materials and animations are not part of this check.',
      'Inertia tensors of imported shapes are not compared with a reference; only mass and volume are.',
      'No URDF or MJCF import yet.',
    ],
  },
  {
    id: 'scene', title: 'Scene files and share links', needsKit: true,
    solver: '`box3d-webgpu-kit/scene`: the `box3d-scene` version 1 format, canonical text, share links, save and resume',
    summary: 'Rotation conventions, lossless share links, deterministic loading, what a save restores, and the physics of two example scenes.',
    docs: ['docs/SCENE_FORMAT.md'],
    notValidated: [
      'A save is not a bit-exact continuation. It restores poses and velocities, not the solver\'s warm-start impulses, sleep state or tick count; the drift rows show how far a resumed run moves in 100 ticks (up to 7 cm for a toppling ragdoll).',
      'Settings changed on the world after loading (motors, damping) are not saved.',
      'The domino, car and ragdoll example scenes are tested for behaviour, not against a closed-form number.',
      'The Lab and the Studio do not read scene links yet.',
    ],
  },
  {
    id: 'heat', title: 'Heat conduction', needsKit: false,
    solver: '`src/engine/heat.ts`: finite volumes on a structured grid, backward Euler, Crank-Nicolson or explicit, float64',
    summary: 'Steady slabs and composite walls, sources, convection and radiation boundaries, temperature-dependent conductivity, the erfc and Fourier-series transients with their observed orders, a 2-D plate, an energy audit and the explicit stability limit.',
    docs: ['docs/HEAT_TRANSFER.md'],
    notValidated: [
      'Conduction in solids only: no phase change, no fluid flow, no convection beyond a film coefficient you supply, no radiation between surfaces (no view factors), no contact resistance.',
      'Curved or slanted surfaces are stair-stepped by the grid, which makes their area wrong (a 45 degree face is too large by sqrt(2)). Every case here has axis-aligned faces.',
      'Crank-Nicolson overshoots after a sudden change when alpha dt / h^2 is large (452 K next to a 400 K surface at 8.2); the erfc rows use a step where it does not.',
      'k(T) is lagged by one step and radiation is linearised once per step: first order in dt for strongly nonlinear cases.',
      'The thermal-stress rows are one-way formulas for full restraint, not a stress analysis.',
      'Material data are inputs: no calibrated material library is validated here. Not used by a scene, the Lab or the Studio yet.',
    ],
  },
  {
    id: 'solid', title: 'Deformable solids', needsKit: false,
    solver: '`src/engine/solid.ts`: linear tetrahedra with linear, corotational and Neo-Hookean models; static, midpoint, backward-Euler and explicit integration, float64',
    summary: 'The patch test, uniaxial tension, shear and bulk moduli, a hanging bar, the cantilever locking table, axial and bending frequencies with observed orders, a stress wave, energy and damping, large-strain rubber and thermal eigenstrain.',
    docs: ['docs/SOLID_MECHANICS.md'],
    notValidated: [
      'Bending is where this element is weak, and the table shows it: one cell through the thickness is three times too stiff, four cells 12%, eight cells 3.4%. Bending frequencies are 5% to 6% high at four cells.',
      'Near-incompressibility: at nu = 0.4999 the four-cell cantilever is 29% too stiff. There is no mixed or higher-order element.',
      'With nu = 0.3 a clamped root also restrains Poisson contraction, which beam theory ignores: the 3-D limit sits about 1.2% below the Timoshenko reference.',
      'Contact and self-contact, plasticity, viscoelasticity, damage and crack growth (the strength checks only flag elements), anisotropy, and more than one material per body.',
      'Not coupled to the rigid-body, water, cable or frame solvers.',
      'Uniform states are exact, so the tension, shear, pressure and rubber rows say nothing about accuracy under stress gradients.',
    ],
  },
  {
    id: 'frame', title: 'Frames (beam finite elements)', needsKit: false,
    solver: '`src/engine/frame-runtime.ts`: Euler-Bernoulli elements with cubic Hermite bending, consistent mass, implicit midpoint, float64',
    summary: 'Cantilever compliance in all six directions, self-weight deflection, an exact discrete oscillator, the first bending mode and the temporal order.',
    docs: ['docs/FRAME_MECHANICS.md'],
    notValidated: [
      'Transverse shear and bending rotary inertia (Euler-Bernoulli, not Timoshenko): deep beams are too stiff.',
      'Geometric stiffness, finite rotations and buckling. The solver flags rotations above 0.1 rad and strains above 0.01; it does not model them.',
      'Yielding, fracture and contact.',
      'The static rows are exact for this element, so they check the implementation rather than convergence; only the bending mode tests the discretisation.',
      'The evidence runs under docs/FRAME_MECHANICS.md are not in the repository; these rows are measured fresh instead.',
    ],
  },
  {
    id: 'cable', title: 'Cables', needsKit: false,
    solver: '`src/engine/compliant-cable.ts`: tension-only axial links, XPBD (`cable-xpbd-js-f64-v1`) and proximal nonlinear (`cable-proximal-js-f64-v2`) backends, implicit Euler, float64',
    summary: 'A taut link against an independent implicit solve, the order in the time step, a hanging cable, curved motion, and a suspended span against statics and the extensible catenary.',
    docs: ['docs/COMPLIANT_CABLE.md', 'docs/NONLINEAR_CABLE.md'],
    notValidated: [
      'Bending and torsion: cables are axial and tension-only, with no material calibration.',
      'Time accuracy is first order and the step is numerically damped. The taut-link rows compare with the same implicit step solved independently, so they check the solve, not how close the motion is to the continuum.',
      'The XPBD backend approximates changing constraint directions; curved spans are validated on the proximal backend only.',
      'Exact angular-momentum conservation is not claimed.',
      'Collisions: cables do not collide with anything.',
      'The production Studio bridge still uses its own comparative cable model, which these rows do not cover.',
    ],
  },
  {
    id: 'closed-water', title: 'Closed-basin water', needsKit: false,
    solver: '`src/engine/closed-water.ts`: linear shallow water on a staggered C-grid with closed walls, float32 fields',
    summary: 'Rest, standing waves against the exact discrete and continuum solutions with the observed order, and volume and energy over 24,000 steps.',
    docs: ['docs/CLOSED_WATER.md'],
    notValidated: [
      'Linear waves on a flat bottom: small surface perturbations and wavelengths long relative to depth. No nonlinear advection, breaking, wetting and drying or bathymetry.',
      'The cases validate the discretisation of the linear equations, not that shallow-water physics describes a given flow. High-frequency input is a stability stress only.',
      'These rows run the CPU reference. The WebGPU solver is compared with it elsewhere (not in this report) and no speed-up is claimed.',
      'The other water models of the application (the open absorbing model, GPU water effects) have no rows here.',
      'No empirical calibration against a tank or a measurement.',
    ],
  },
];

export const CASES = [...rigid, ...waterCoupling, ...structureCoupling, ...geometry, ...scene, ...heat, ...solid, ...frame, ...cable, ...closedWater];

/** Cases of the given domains (all when `only` is empty), in registry order. */
export function selectCases(only = []) {
  for (const id of only) if (!DOMAINS.some(domain => domain.id === id)) throw new RangeError(`Unknown domain "${id}". Domains: ${DOMAINS.map(domain => domain.id).join(', ')}`);
  return only.length ? CASES.filter(one => only.includes(one.domain)) : CASES;
}
/** True when any of the cases runs through the built kit. */
export const needsKit = cases => cases.some(one => DOMAINS.find(domain => domain.id === one.domain).needsKit);
