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
import siBridge from './domains/si-bridge.mjs';
import geometry from './domains/geometry.mjs';
import scene from './domains/scene.mjs';
import simulation from './domains/simulation.mjs';
import robot from './domains/robot.mjs';
import cloth from './domains/cloth.mjs';
import heat from './domains/heat.mjs';
import solid from './domains/solid.mjs';
import fracture from './domains/fracture.mjs';
import frame from './domains/frame.mjs';
import cable from './domains/cable.mjs';
import closedWater from './domains/closed-water.mjs';

export const DOMAINS = [
  {
    id: 'rigid', title: 'Rigid bodies, joints and shapes', needsKit: true,
    solver: 'Box3D compiled to WebAssembly, through `box3d-webgpu-kit` (float32 state, 240 Hz, 4 sub-steps)',
    summary: 'Free fall, pendulums, friction, restitution, collisions, forces and torques, joint motors and springs, motion on triangle-mesh and height-field ground, compound bodies (summed mass, centre of mass and inertia, tipping, rest) and explicit mass data (stated mass, centre of mass and inertia tensor).',
    docs: ['packages/box3d-kit/README.md'],
    notValidated: [
      'Stacks, piles and many-body contact: every case here has one or two bodies in contact. Stack stability and friction in piles are not checked against a reference.',
      'Rolling is checked for a sphere only, and the contact slips slightly (the rolling case allows 1%). There is no rolling-resistance or spinning-friction reference.',
      'Restitution is checked at one speed and one coefficient. Box3D applies restitution only above a threshold speed.',
      'Wheel, weld and spherical joints have no closed-form row here: wheel and weld joints are tested for behaviour only (a car drives and steers, a weld keeps its spacing).',
      'Compound bodies: a body holds at most 64 convex shapes (box, sphere, capsule, hull); overlapping shapes count their overlap twice in mass and inertia. Contact of a compound is checked at rest and at tipping only, not in stacks or impacts. Triangle meshes and height fields are static only and cannot be part of a compound.',
      'Explicit mass data replace the numbers, not the shapes: nothing checks that a stated tensor is physically possible for the collision shape (the triangle inequality of the principal moments is not required), and a body with partly locked rotation is not covered.',
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
      'CPU only; the WebGPU closed-water solver is not coupled. A scene file can describe a basin (see the simulation domain); the Lab and the Studio do not run it.',
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
    id: 'si-bridge', title: 'Cable-stayed bridge (SI scene)', needsKit: false,
    solver: '`src/engine/si-bridge.ts`: frame elements for deck and towers, compliant cables for the stays and a rigid body for the vehicle, coupled by `StructureCoupling`; 120 Hz, 4 sub-steps',
    summary: 'The Physics Lab\'s bridge scene as a whole: dead-load reactions and the levelled deck, a hand-solved propped span with its mesh study, symmetry, influence lines, the first frequencies, dynamic amplification, a stay failure, wind and repeatability.',
    docs: ['docs/SI_BRIDGE.md'],
    notValidated: [
      'Contact between wheels and deck. The vehicle is one rigid body pinned to the two deck nodes it stands between and moved by re-attachment; it has no wheels, no suspension and no velocity along the deck.',
      'The vehicle\'s weight is shared by the lever rule: 1.9 % of the peak midspan deflection and 2.3 % of the peak stay-tension change on the default 6 m elements. Its rigid body also acts as a strut along the element it stands on (up to 8e-4 of a stay tension in the hand case).',
      'Buckling, yielding, geometric stiffness of the deck and towers, and cable sag (one segment per stay). The utilisation ratios are linear-elastic indicators, not a design check.',
      'Aerodynamics: wind is a static lateral load. No vortex shedding, flutter or buffeting.',
      'The reference for most rows is a second solver in the same file that shares the element matrices and the stay law. Only the propped span, the lateral frequency, the Rayleigh estimates and the wind beam are independent hand results.',
      'Section properties are hand estimates for a plausible steel footbridge, not a designed or surveyed bridge, and nothing is calibrated against measurements.',
      'The amplification rows bound the factor; they do not compare it with a moving-load solution. Damping is the model\'s own (about 1 % of critical in the first vertical mode at 120 Hz) plus what is set.',
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
    solver: '`box3d-webgpu-kit/scene`: the `box3d-scene` format (version 1, and version 2 for compound shapes and explicit mass data), canonical text, share links, save and resume',
    summary: 'Rotation conventions, lossless share links, deterministic loading, what a save restores, the physics of two example scenes, and version 2 scenes (compound shapes, massData) against the same bodies built by hand.',
    docs: ['docs/SCENE_FORMAT.md'],
    notValidated: [
      'A save is not a bit-exact continuation. It restores poses and velocities, not the solver\'s warm-start impulses, sleep state or tick count; the drift rows show how far a resumed run moves in 100 ticks (up to 7 cm for a toppling ragdoll).',
      'Settings changed on the world after loading (motors, damping) are not saved.',
      'The domino, car and ragdoll example scenes are tested for behaviour, not against a closed-form number.',
      'The Lab and the Studio do not read scene links yet.',
    ],
  },
  {
    id: 'simulation', title: 'One stepping loop: coupled scenes and links', needsKit: true,
    solver: '`box3d-webgpu-kit/simulation`: one Simulation that steps the rigid world, the water and structure couplings, heat and solids in fixed stages, and builds scenes with water, cable and frame sections',
    summary: 'Bit-identity with the modules driven by hand, a moored buoy and a cable-stayed deck loaded from scene files against closed-form statics, the heat-to-solid and weight-to-solid links, the energy ledger, and what a save of a coupled scene restores.',
    docs: ['docs/SIMULATION.md'],
    notValidated: [
      'Water and structure do not know of each other: the structure coupling\'s free response of a body has gravity only. A moored buoy\'s cable tension is high by m_n B / (m + m_n) (0.73 N of 1337 N here) and its draught off by B dt^2 / m (0.46 mm); a heavy cable node on a light buoy makes both larger.',
      'The two links are one-way. Heat drives the solid\'s thermal strain and a rigid body\'s weight loads a solid; the solid does not change the temperature, hold the body up or push it. There is no contact between rigid bodies and deformable solids.',
      'The thermal link needs co-located grids: a box mesh whose cells are the heat grid\'s cells. Only uniform end states are checked, where the mapping is exact.',
      'A save of a coupled scene is not a bit-exact continuation: the structure coupling\'s impulses and pending half kick, the cable multipliers and one step of displaced volume are not saved. The resume rows show the drift.',
      'The energy ledger is a sum of what each solver reports. With drag it may exceed its start by the sampling offset rho g V v dt, because its terms are known half a step apart.',
      'The Physics Lab and the Studio do not run coupled scenes; the Lab refuses a scene with water, cable or frame sections. Heat and solids are not in the scene format.',
    ],
  },
  {
    id: 'robot', title: 'Robot import (URDF and MJCF)', needsKit: true,
    solver: '`box3d-webgpu-kit/robot`: URDF and MJCF files as scenes of the rigid world (one body per link, a compound when the link has several collision shapes, with the file\'s mass, centre of mass and inertia tensor; joints as constraints; 240 Hz, 4 sub-steps)',
    summary: 'Forward kinematics against the product of joint transforms, the same robot from both formats, mass, the file\'s inertia in the solver and the gap without it, pendulum and cart-pole periods, joint limits, effort limits, joint springs and damping, a held arm, joint drift on a chain, a wheeled cart, and round trips through scene files and share links.',
    docs: ['docs/ROBOT_IMPORT.md'],
    notValidated: [
      'The file\'s inertial is applied as numbers; the collision shapes are not changed to agree with it. A tensor that is not positive definite is not applied (the shapes\' inertia is used, with a warning), and with `links: \'welded\'` a link of several bodies keeps its shapes\' inertia. The rows marked "inertia: shapes" measure the import without the file\'s inertia (42% off on the worst link of the example arm).',
      'Joints are soft constraints (60 Hz by default; `jointStiffness` raises it). A loaded arm settles below its kinematic pose (17 mm at the tool of the 1 m example arm) and a chain stretches by millimetres. There is no reduced-coordinate articulation solver.',
      'No comparison with MuJoCo, Gazebo or another simulator on the same model: every reference here is closed form.',
      'Mesh collision is the convex hull of each mesh; only the parser path and a cube and a tetrahedron are checked. No real robot model with meshes is in the suite.',
      'Ball joints, floating bases under contact, self-collision of real robots, and contact between a robot and objects (grasping) have no reference here.',
      'Joint springs damp numerically (measured 0.10 /s on the spring case), and joint damping without stiffness adds a very weak spring towards the starting pose.',
      'MJCF: equality constraints, tendons, most actuator types and several joints on one body are reported and dropped, so models that depend on them do not behave as in MuJoCo.',
    ],
  },
  {
    id: 'cloth', title: 'Cloth: membrane, bending, contact and rigid coupling', needsKit: true,
    solver: '`box3d-webgpu-kit/cloth`: constant-strain St. Venant-Kirchhoff triangles, Koiter bending on the triangle-averaged shape operator, backward Euler by Newton and preconditioned conjugate gradients, float64; rigid bodies as unknowns of the same solve',
    summary: 'The patch test, uniaxial stress and Poisson contraction (and the edge-spring model failing it), a hanging strip, the catenary, a cantilever with its mesh study, the frequency of a tensioned strip, a pressurised membrane, the integrators\' energy, Coulomb friction on a ramp, a plate that must not tunnel, a ball on a trampoline, a draped box on a scale, a hanging body, self-collision and repeatability.',
    docs: ['docs/CLOTH.md'],
    notValidated: [
      'Bending on irregular meshes. The triangle-averaged curvature is consistent on structured meshes only: with nodes jittered by 25% of a cell the cantilever is 4% too stiff at 16 elements and 11% at 32, and refinement does not help. The membrane rows do not have this limit.',
      'Large strains and wrinkling. The membrane law is St. Venant-Kirchhoff, checked at strains up to 2e-3; it is not a fabric model (no anisotropy, no warp and weft, no hysteresis), and compression is carried until the sheet buckles at the scale of the mesh.',
      'Tearing, plasticity and damage are not modelled. Bending stiffness of a woven fabric is not E t^3 / 12: it must be measured and set.',
      'Contact is node against body: a body corner or edge between nodes is not seen, a body smaller than the mesh spacing rests on single nodes, and hulls, triangle meshes and height fields are not supported. Curved bodies are safe from tunnelling only below about one radius of travel per step.',
      'Self-collision is a repulsion without friction, checked for layers pressed at 0.02 N per pair. It is not intersection-free: a pair pressed harder than stiffness times thickness, or one that closes by more than a mesh edge in one step, can pass through, and nothing untangles it.',
      'Friction limits lag the normal force by a Newton iterate in transients; only steady sliding and sticking are checked. Rolling and spinning friction are not modelled.',
      'The coupling sees a body\'s other contacts and joints only through an estimate that lags one step. A cloth heavier than the supported body it rests on is not checked. Bodies rotate by a linearised rotation in the contact geometry (error (omega dt)^2 / 2 times the body size per step).',
      'Wind is a normal-pressure formula, not aerodynamics, and has no reference here beyond its own force. No real-fabric measurement is used anywhere: every reference is a formula.',
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
      'Material data are inputs: no calibrated material library is validated here. Not in the scene format, and not used by the Lab or the Studio.',
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
      'Contact and self-contact, plasticity, viscoelasticity, anisotropy, and more than one material per body. Crack growth is a separate solver on the linear model of this element (the fracture domain); `SolidBody` itself only flags elements above a strength.',
      'No two-way coupling to the rigid-body, water, cable or frame solvers, and no contact with rigid bodies. The one-way thermal and dead-load links are in the simulation domain.',
      'Uniform states are exact, so the tension, shear, pressure and rubber rows say nothing about accuracy under stress gradients.',
    ],
  },
  {
    id: 'fracture', title: 'Fracture of deformable solids', needsKit: false,
    solver: '`src/engine/solid-fracture.ts`: small-strain linear tetrahedra with cohesive interfaces on element faces (bilinear traction-separation law, nodes duplicated where a face opens) or a Rankine crack band; static, midpoint, backward-Euler and explicit integration, float64',
    summary: 'A bar with a weak cross-section against the traction-separation law and G_c A, mesh objectivity of the cohesive and crack-band energies, a centre-cracked plate against Griffith, a notched beam against the size-effect law and the work of fracture, momentum and energy of a bar that breaks in flight, the onset of thermal-shock cracking against the heat module, and the mesh dependence of an inclined crack.',
    docs: ['docs/SOLID_FRACTURE.md'],
    notValidated: [
      'Crack paths. A cohesive crack can only follow element faces: a crack inclined 30 degrees to the mesh is 24 % (five-tetrahedron cells) or 48 % (six-tetrahedron cells) larger than the plane it should follow, at any resolution, and dissipates 30 % to 70 % too much energy. Every closed-form row here has its crack on a mesh plane.',
      'Insertion on demand near a crack tip. The criterion reads the mean stress of two elements, which misses the peak at a tip: with cells of l_ch / 2 the centre-cracked plate fails at 1.60 of the Griffith stress unless interfaces are inserted earlier (0.5 sigma_c gives 0.985) or placed along the expected path, as the Griffith and beam rows do.',
      'The Griffith and beam rows are converged in neither mesh nor size: cells of l_ch read 11.5 % high, cells of l_ch / 2 read 3.5 % low, and the cohesive law itself is 4.5 % below LEFM at a = 5 l_ch (1.5 % at 10 l_ch). The size-effect law used for the beam is an asymptote, and its constant c_f = 0.419 l_ch is taken from the literature.',
      'Crack branching, dynamic crack speeds and fragmentation statistics have no reference here; branching is whatever the faces allow. No plasticity, no rate dependence, no fatigue.',
      'Contact exists only across an interface (a penalty that stops its two sides passing through each other, without friction). Fragments do not collide with each other or with anything else until they are handed to the rigid world, and that hand-off is one-way.',
      'Small strain: a piece that rotates after breaking off carries false stress (angular momentum of a bar spinning at 40 rad/s drifts by 1.5e-4 of m V L). The crack band uses isotropic damage: it weakens compression too, and a band held sideways by its neighbours dissipates 0.9 G_c at nu = 0.2.',
      'The thermal-shock row checks when and where the first crack appears, on elements larger than l_ch; the crack pattern after that (spacing, depth, arrest) is not resolved and has no row. The heat flow does not see the cracks.',
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

export const CASES = [...rigid, ...waterCoupling, ...structureCoupling, ...siBridge, ...geometry, ...scene, ...simulation, ...robot, ...cloth, ...heat, ...solid, ...fracture, ...frame, ...cable, ...closedWater];

/** Cases of the given domains (all when `only` is empty), in registry order. */
export function selectCases(only = []) {
  for (const id of only) if (!DOMAINS.some(domain => domain.id === id)) throw new RangeError(`Unknown domain "${id}". Domains: ${DOMAINS.map(domain => domain.id).join(', ')}`);
  return only.length ? CASES.filter(one => only.includes(one.domain)) : CASES;
}
/** True when any of the cases runs through the built kit. */
export const needsKit = cases => cases.some(one => DOMAINS.find(domain => domain.id === one.domain).needsKit);
