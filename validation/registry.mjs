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
import siSuspension from './domains/si-suspension.mjs';
import geometry from './domains/geometry.mjs';
import scene from './domains/scene.mjs';
import simulation from './domains/simulation.mjs';
import robot from './domains/robot.mjs';
import cloth from './domains/cloth.mjs';
import granular from './domains/granular.mjs';
import fluid from './domains/fluid.mjs';
import shallowWater from './domains/shallow-water.mjs';
import solidContact from './domains/solid-contact.mjs';
import heat from './domains/heat.mjs';
import solid, {viscoelastic as solidViscoelastic} from './domains/solid.mjs';
import {concrete as solidConcrete} from './domains/concrete.mjs';
import fracture from './domains/fracture.mjs';
import plate from './domains/plate.mjs';
import frame from './domains/frame.mjs';
import cable from './domains/cable.mjs';
import closedWater from './domains/closed-water.mjs';
import materials from './domains/materials.mjs';

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
    id: 'si-suspension', title: 'Suspension footbridge (SI model of the Studio bridge)', needsKit: false,
    solver: '`src/engine/si-suspension.ts`: frame elements for the deck grillage and the portal towers, one Newton cable network for the main cables, backstays and hangers solved together with the frame each step by `StructureCoupling`, and a rigid body for an optional service vehicle; 120 Hz',
    summary: 'The Engineering Studio\'s 42 m footbridge: form-finding, the main cable against the parabola, the hangers against the continuous deck, point loads against the deflection theory, the first antisymmetric mode, the time-stepped model against its statics, symmetry, a hanger failure, wind, a parked vehicle and repeatability.',
    docs: ['docs/SI_BRIDGE.md'],
    notValidated: [
      'Contact: nothing rests on the deck surface. Pedestrians are a distributed load on whole panels; the service vehicle is a rigid body pinned to two centreline nodes, as in the cable-stayed scene.',
      'Linear beams: no buckling of columns, girders or bracing (the plan bracing is linear and carries compression), no yielding, no geometric stiffness of the beams. The utilisations are linear-elastic indicators, not a design check.',
      'Saddles are fixed to the column tops: the cable does not slip over them. The cables are axial and tension-only with exact geometry; there is no bending of strands and no clamp slip.',
      'Aerodynamics: wind is a static lateral load fixed for a run. No vortex shedding, flutter, buffeting or pedestrian lock-in, although the first vertical mode (1.41 Hz) is in the band of walking pace.',
      'A failed hanger stops carrying load at once; it is not drawn swinging. The rupture of a main cable is not modelled.',
      'The timber boards are mass only; their stiffness, the eccentricity of the crossbeams and the bearings\' flexibility are left out.',
      'Sections are table values of rolled sections and hand estimates of the strands for a plausible footbridge of the Studio\'s look. Nothing is calibrated against a designed or measured bridge.',
      'Most time-stepped rows compare with the model\'s own statics. The independent references are the parabola, the hanger share, the deflection theory and the tensioned-beam frequency.',
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
    summary: 'The patch test, uniaxial stress and Poisson contraction (and the edge-spring model failing it), a hanging strip, the catenary, a cantilever with its mesh study, the frequency of a tensioned strip, a pressurised membrane, the integrators\' energy, a woven fabric along warp, weft and bias, a pressurised orthotropic strip, a pretensioned square membrane and its reactions, the onset of tearing, Coulomb friction on a ramp, a plate that must not tunnel, a ball on a trampoline, a draped box on a scale, a hanging body, self-collision and repeatability.',
    docs: ['docs/CLOTH.md'],
    notValidated: [
      'Bending on irregular meshes. The triangle-averaged curvature is consistent on structured meshes only: with nodes jittered by 25% of a cell the cantilever is 4% too stiff at 16 elements and 11% at 32, and refinement does not help. The membrane rows do not have this limit.',
      'Large strains and wrinkling. The membrane law is St. Venant-Kirchhoff (isotropic, or orthotropic with warp and weft), checked at strains up to 1e-2; it has no nonlinear fabric response, crimp interchange or hysteresis, and compression is carried until the sheet buckles at the scale of the mesh.',
      'Tearing is strength-based and removes whole triangles: the onset at a crack tip depends on the mesh (a slit strip tears at 1.27 times a one-element LEFM estimate on its mesh), and a tear follows triangle edges. No plasticity or damage before tearing. Bending stiffness of a woven fabric is not E t^3 / 12: it must be measured and set.',
      'Contact is node against body: a body corner or edge between nodes is not seen, a body smaller than the mesh spacing rests on single nodes, and hulls, triangle meshes and height fields are not supported. Curved bodies are safe from tunnelling only below about one radius of travel per step.',
      'Self-collision is a repulsion without friction, checked for layers pressed at 0.02 N per pair. It is not intersection-free: a pair pressed harder than stiffness times thickness, or one that closes by more than a mesh edge in one step, can pass through, and nothing untangles it.',
      'Friction limits lag the normal force by a Newton iterate in transients; only steady sliding and sticking are checked. Rolling and spinning friction are not modelled.',
      'The coupling sees a body\'s other contacts and joints only through an estimate that lags one step. A cloth heavier than the supported body it rests on is not checked. Bodies rotate by a linearised rotation in the contact geometry (error (omega dt)^2 / 2 times the body size per step).',
      'Wind is a normal-pressure formula, not aerodynamics, and has no reference here beyond its own force. No real-fabric measurement is used anywhere: every reference is a formula.',
    ],
  },
  {
    id: 'granular', title: 'Granular media: discrete elements, silos and rigid coupling', needsKit: true,
    solver: '`box3d-webgpu-kit/granular`: soft spheres with Hertz or linear normal contact, a damping solved for the restitution, tangential springs with history capped by Coulomb friction, an elastic-plastic rolling spring, velocity Verlet, float64; rigid bodies as dynamic walls sub-cycled inside each rigid step',
    summary: 'Hertz contact duration and its convergence, restitution, oblique impacts in the sliding and sticking regimes, a grain sliding and rolling on an incline, the energy ledger, a column on a floor, Janssen saturation in a silo, Beverloo discharge through an orifice, the angle of repose, a block on a bed, momentum exchange with a rigid body, a box of beads on a scale and repeatability.',
    docs: ['docs/GRANULAR.md'],
    notValidated: [
      'Grain shape. Grains are spheres; angular grains are stood in for by a rolling-resistance coefficient that has to be calibrated. No clumps, no polyhedra, no breakage, no cohesion, no liquid bridges, no interstitial fluid.',
      'Real materials. The bulk cases use beads about a thousand times softer than glass (k_n = 4000 m g / d) so that the step is affordable; overlaps reach 5% of a radius under impact. No case is compared with a measurement: every reference is a formula or a typical literature range written from memory.',
      'Janssen and Beverloo are checked in form, not in their constants. The stress ratio comes out near 1.1 with a mobilised wall friction near half the coefficient, in a silo only six beads wide; the Beverloo C comes out at 0.45 to 0.49, below the range usually quoted. The small runs of the gate fluctuate by about 10%.',
      'The angle of repose is a trend check on a ledge 12 beads long and 3.5 deep between frictionless planes. It is not a calibrated repose angle.',
      'Hertz-Mindlin in the sticking regime has no closed form here: only the sign of the rebound is checked. The tangential spring uses the no-slip Mindlin stiffness at the current overlap, which is not exactly elastic when the normal load changes; the ledger books that defect under friction.',
      'Twisting resistance is not modelled: a bead spinning about its contact normal keeps spinning. Rolling resistance is one model (an elastic-plastic spring), checked only through the repose trend.',
      'Coupling: the rigid world receives the mean force of a rigid step; other contacts and joints of a body are seen only through an estimate of their force that lags one step, and their torque is not estimated. Bodies are boxes, spheres and capsules. Only resting and single-impact cases are checked.',
      'Wide size ratios. The neighbour grid uses cells of the largest diameter, so a ratio above about 3 is slow; the cases here use radii within 10% of the mean.',
    ],
  },
  {
    id: 'fluid', title: 'Volumetric fluid: incompressible flow, obstacles, rigid coupling and free surface', needsKit: true,
    solver: '`box3d-webgpu-kit/fluid`: Navier-Stokes on a staggered grid, incremental pressure projection by MIC(0)-preconditioned conjugate gradients, central (or upwind) advection with Adams-Bashforth 2, explicit, Crank-Nicolson or backward-Euler viscosity, float64; obstacles immersed in the grid; rigid bodies as moving obstacles; a free surface by APIC particles with ghost-fluid p = 0',
    summary: 'The divergence left by the projection, the Taylor-Green vortex and its convergence, plane Poiseuille and Couette flow, a square duct against its series, an inflow and an outflow, the lid-driven cavity at Re 100 and 400 against Ghia et al., water at rest, Stokes drag on a sphere against Hasimoto, a settling sphere of the rigid world, momentum exchange, repeatability, a dam break against Martin & Moyce and the sloshing frequency.',
    docs: ['docs/FLUID.md'],
    notValidated: [
      'Turbulence. There is no turbulence model; the central scheme is for resolved flow (cell Reynolds number of a few at most), the upwind option is first order and diffusive. No case is above Re 400.',
      'Obstacles are immersed in the grid with their surface placed to about h^2: at 2.4 cells per radius a sphere\'s drag is 7.5% low, at 3.6 cells 3.3%. Drag at higher Reynolds number, lift, torque on a body, thin plates and bodies smaller than two cells have no case. The pressure inside an obstacle is not physical and creeps.',
      'Coupling is explicit: the body feels the fluid of the last step. It is checked for a sphere 1.5 times denser than the fluid with the step below the body\'s response time m / (6 pi mu a K); lighter bodies or longer steps can be unstable. Only spheres are checked; the energy ledger of a coupled run does not close (the bodies\' work is sampled at the start of the step).',
      'Free surface: inviscid, no surface tension, walls only (no obstacles or bodies), closed free-slip tanks. The surface is located from the particles to about half a particle spacing. The dam-break comparison is with one experiment whose start time is not known and is normalised away, as in the paper; the sloshing case loses 15% of its amplitude in three periods.',
      'Ghia et al. is compared through transcriptions of its tables found on the web (two copies that agree), not the paper. Hasimoto\'s coefficients come from Ladd (1994). Martin & Moyce\'s table was read from a scan.',
      'Cost: one JavaScript thread. A 32^3 grid steps at a few steps per second; nothing here runs on the GPU.',
    ],
  },
  {
    id: 'shallow-water', title: 'Shallow water on terrain: dam breaks, steady flows, rain and infiltration', needsKit: true,
    solver: '`box3d-webgpu-kit/shallow-water`: the 2D Saint-Venant equations by finite volumes, hydrostatic reconstruction (Audusse et al. 2004), MUSCL with minmod, HLL, Heun in time, wetting and drying, Manning friction (split, backward Euler), rain, Green-Ampt infiltration, inflow, open and stage sides, float64; rigid bodies coupled by buoyancy and drag',
    summary: 'A lake at rest over a bumpy, partly emerged bed; Ritter\'s and Stoker\'s dam breaks; Thacker\'s oscillating paraboloid; the subcritical, transcritical and shock flows over the Goutal-Maurel bump (SWASHES); Manning\'s normal depth; rain on a slope against the kinematic wave; Green-Ampt against its closed form; the volume budget; repeatability; a floating box and a sphere in a current.',
    docs: ['docs/SHALLOW_WATER.md'],
    notValidated: [
      'Shallow water only: no vertical accelerations (no dispersion, no breaking, no flow over a vertical step), hydrostatic pressure, depth-averaged velocity. No turbulence model beyond bed friction, no Coriolis force, no wind stress.',
      'Steep thin films: the hydrostatic reconstruction loses accuracy where the bed rises by more than the depth over one cell; the rain-on-slope hydrograph is 4% off the kinematic wave at 400 cells (7% at 200). Wet-dry fronts are first order.',
      'Manning friction is split from the transport and applied by backward Euler: the normal depth is off by O(dt), -2.5e-4 to -1.3e-3 in the cases here. Manning n values are tabulated ranges (Chow 1959); no case is compared with a measured flood or flume.',
      'Green-Ampt is the one-layer, uniform-initial-moisture model with no redistribution after rain, no crusting and no macropores; the parameters are texture-class means with wide scatter (Rawls et al. 1983 give one standard deviation of a factor of three on the suction head).',
      'Coupling: boxes and spheres only; buoyancy reads the water plane one cell outside the body; drag is a coefficient on the depth-averaged relative velocity, not hydrodynamics; the body exerts no pressure on the water (its displaced volume is a volume source). Only resting and drifting cases are checked.',
      'Cost: about 3 million cell-substeps per second on one loaded thread of this machine; no GPU or WASM version.',
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
    solver: '`src/engine/solid.ts`: linear tetrahedra with linear, corotational, Neo-Hookean and Green-Lagrange models, J2 plasticity with linear isotropic hardening and ductile erosion (linear and Green-Lagrange), a concrete law (Drucker-Prager and Rankine composite plasticity with crack-band softening, `src/engine/concrete-law.ts`); static, midpoint, backward-Euler and explicit integration, float64. The press brake (`src/engine/press-brake.ts`) bends a plane-strain section of sheet with rigid punch and die through `SolidContact`',
    summary: 'The patch test, uniaxial tension, shear and bulk moduli, a hanging bar, the cantilever locking table, axial and bending frequencies with observed orders, a stress wave, energy and damping, large-strain rubber and thermal eigenstrain. Plasticity: the uniaxial bilinear cycle, the elastic-plastic moment and springback of a beam, and a press-brake air bend against the beam limit load and elastic springback. Concrete: the EN 1992-1-1 (3.14) curve to f_cm, eps_c1 and eps_cu1, f_ctm and G_f on three meshes, G_c per unit area of a crushed band, the Drucker-Prager confinement closed form, and the Studio cube against a slenderness-2 prism.',
    docs: ['docs/SOLID_MECHANICS.md'],
    notValidated: [
      'Bending is where this element is weak, and the table shows it: one cell through the thickness is three times too stiff, four cells 12%, eight cells 3.4%. Bending frequencies are 5% to 6% high at four cells.',
      'Near-incompressibility: at nu = 0.4999 the four-cell cantilever is 29% too stiff with tet4 and 23% with tet4-nodal (averaged nodal pressure), against 12.5% and 9.6% at nu = 0.3: the nodal element relieves part of the locking in bending, not all. There is no higher-order element. The concrete law keeps tet4.',
      'With nu = 0.3 a clamped root also restrains Poisson contraction, which beam theory ignores: the 3-D limit sits about 1.2% below the Timoshenko reference.',
      'Viscoelasticity is a stress-based Prony series: checked for uniaxial creep, relaxation and recovery at small strain and for a uniform Neo-Hookean stretch; it is not objective under large rotation while an overstress remains, and no measured rubber was fitted. Contact and self-contact, plasticity, anisotropy, and more than one material per body. Crack growth is a separate solver on the linear model of this element (the fracture domain); `SolidBody` itself only flags elements above a strength.',
      'Plasticity is small-strain J2 (additive in the Green-Lagrange strain for large rotations), isotropic linear hardening only: no kinematic hardening, rate dependence, necking or anisotropy. Fully plastic bending is 3.2% (3-D) to 6.8% (plane strain, 4 cells) too strong with tet4 and 4.8% with tet4-nodal: what remains is the bending error of linear tetrahedra. Ductile erosion uses one failure strain, independent of stress triaxiality, and the press brake\'s limit load is 1.23 times beam theory.',
      'Self-contact, plasticity combined with viscoelasticity (refused), anisotropy, and more than one material per body. Crack growth is a separate solver on the linear model of this element (the fracture domain); `SolidBody` erodes plastic elements at a failure strain but has no crack-growth law of its own.',
      'No two-way coupling to the rigid-body, water, cable or frame solvers, and no contact with rigid bodies. The one-way thermal and dead-load links are in the simulation domain.',
      'Concrete: compressive softening does not stay in one element layer. In a prism the crushed band is restrained across by its neighbours (associated flow dilates it), so the post-peak energy of a 5, 10 and 20-cell bar grows with refinement instead of staying G_c A; only the tensile crack band is mesh objective here. Confinement raises the strength by m = 1.41 sigma_3, not the 2.5 to 5 of EN 1992-1-1 3.1.9; the equal-biaxial ratio 1.16 is quoted, not read. Cracks unload elastically (plasticity, not damage) and do not close; no rate, size (beyond the crack band), creep, shrinkage or reinforcement.',
      'Uniform states are exact, so the tension, shear, pressure and rubber rows say nothing about accuracy under stress gradients.',
    ],
  },
  {
    id: 'solid-contact', title: 'Deformable solids in contact with rigid bodies', needsKit: true,
    solver: '`box3d-webgpu-kit/solid-contact`: node-against-body penalty contact of the tetrahedral solid with boxes, spheres, capsules and planes, Coulomb friction as a capped stick spring, welds; backward Euler by Newton and preconditioned conjugate gradients with each dynamic rigid body as six unknowns of the same solve, float64',
    summary: 'A rigid block on an elastic pad in uniaxial stress and in uniaxial strain, the same through the stepping loop with its energy ledger, Hertz contact with a mesh study and the force exponent, Coulomb friction on a deformable incline either side of tan(theta) = mu, a block on an elastic column against the bar with a tip mass, a welded hanging weight, momentum in a free impact, extreme mass ratios with naive staggering failing, and a solid on a supported body.',
    docs: ['docs/SOLID_CONTACT.md'],
    notValidated: [
      'Hertz contact is 7% to 16% too stiff on the meshes in the gate (2.5 to 5 linear tetrahedra per contact radius, against Hertz with the bonded-layer factor) and converges slowly. The pressure distribution inside the contact is not checked.',
      'Contact is node against body: a body corner or edge between nodes is not seen, a body smaller than the mesh spacing rests on single nodes, and hulls, triangle meshes and height fields are not supported. There is no solid-solid or self contact.',
      'A node gets one plane per body and step from where it starts, and nothing is traced along its path: a body that crosses a whole solid in one step is missed, and curved bodies are seen through tangent planes.',
      'Bodies turn by a linearised rotation within a step (error (omega dt)^2 / 2 of the arm, about the free rotation). Fast-spinning bodies in contact are not checked.',
      'Friction limits follow the normal force to 1e-4 by repeated solves; only steady sticking and sliding of a flat box are checked. Rolling and spinning friction are not modelled, and static and kinetic coefficients are equal.',
      'The coupling sees a body\'s other contacts and joints only through an estimate that lags one step; one case (a block on a box on the ground) is checked.',
      'The integrator is backward Euler: it damps (36% of the kinetic energy is left after the impact case). Restitution is not a parameter and impact speeds after a bounce are not validated.',
      'Welds are stiff springs: a welded face is held in all three directions, like a clamped end. Large rotations of a welded solid are not checked against a reference.',
    ],
  },
  {
    id: 'fracture', title: 'Fracture of deformable solids', needsKit: false,
    solver: '`src/engine/solid-fracture.ts`: small-strain linear tetrahedra with cohesive interfaces on element faces (bilinear traction-separation law, nodes duplicated where a face opens) or a Rankine crack band; static, midpoint, backward-Euler and explicit integration, float64',
    summary: 'A bar with a weak cross-section against the traction-separation law and G_c A, mesh objectivity of the cohesive and crack-band energies, a centre-cracked plate against Griffith, a notched beam against the size-effect law and the work of fracture, momentum and energy of a bar that breaks in flight, the onset of thermal-shock cracking against the heat module, and the mesh dependence of an inclined crack.',
    docs: ['docs/SOLID_FRACTURE.md'],
    notValidated: [
      'Crack paths. A cohesive crack can only follow element faces: a crack inclined 30 degrees to the mesh is 2.5 % to 30 % larger than the plane it should follow, depending on the mesh pattern and the cell size and not falling with refinement, and dissipates 38 % to 54 % too much energy. Every closed-form row here has its crack on a mesh plane.',
      'Insertion on demand near a crack tip. The criterion reads the mean stress of two elements, which misses the peak at a tip, so faces that touch a crack front are inserted at 0.4 of their strength. That value was chosen on one case, the centre-cracked plate with cells of l_ch and l_ch / 2 in mode I on a mesh plane, where it gives the failure load of the pre-inserted path within the 1 % load step. Coarser cells, mixed mode, and a notch that is not a cut face are not covered. With the rule off the plate holds 1.6 times its Griffith stress.',
      'The Griffith and beam rows are converged in neither mesh nor size: cells of l_ch read 11.5 % high, cells of l_ch / 2 read 3.5 % low, and the cohesive law itself is 4.5 % below LEFM at a = 5 l_ch (1.5 % at 10 l_ch). The size-effect law used for the beam is an asymptote, and its constant c_f = 0.419 l_ch is taken from the literature.',
      'Crack branching, dynamic crack speeds and fragmentation statistics have no reference here; branching is whatever the faces allow. No plasticity, no rate dependence, no fatigue.',
      'Contact exists only across an interface (a penalty that stops its two sides passing through each other, without friction). Fragments do not collide with each other or with anything else until they are handed to the rigid world, and that hand-off is one-way.',
      'Small strain: a piece that rotates after breaking off carries false stress (angular momentum of a bar spinning at 40 rad/s drifts by 1.5e-4 of m V L). The crack band uses isotropic damage: it weakens compression too, and a band held sideways by its neighbours dissipates 0.9 G_c at nu = 0.2.',
      'The thermal-shock row checks when and where the first crack appears, on elements larger than l_ch; the crack pattern after that (spacing, depth, arrest) is not resolved and has no row. The heat flow does not see the cracks.',
    ],
  },
  {
    id: 'plate', title: 'Thin plates with brittle fracture', needsKit: false,
    solver: '`src/engine/plate.ts`: Kirchhoff bending on a regular grid (finite-difference curvatures, energy-consistent forces), explicit symplectic Euler, cracks as broken bonds between nodes, float64',
    summary: 'A simply supported pane under uniform pressure against the Navier series (deflection, moment, order), its first mode against the grid\'s exact frequency and Kirchhoff theory, energy of the explicit step, and the pressure of the first crack, with and without a surface prestress, against the Navier stress.',
    docs: ['docs/STUDIO_MATERIAL_LABS.md'],
    notValidated: [
      'Linear plate theory: deflections well above the thickness stiffen a real pane by membrane action, which is not modelled; the Studio\'s impacts reach several thicknesses.',
      'Crack paths follow the grid (bonds along x and y, 0.1 m in the Studio): a crack at 45 degrees is a staircase, and nothing finer than a cell is resolved. Once a bond breaks the crack runs, which is right for glass (l_ch of a fraction of a millimetre) and wrong for tougher materials.',
      'The strength check reads the moment at a bond\'s middle. A point load on one node gives a mesh-dependent peak (the Kirchhoff point-load moment is logarithmically singular): onset under a hard impactor depends on the cell size. Hertzian contact stresses and cone cracks are not modelled.',
      'Tempered glass dicing is a front that breaks every bond it reaches; its speed and the fragment size quoted by the Studio are inputs from the literature, not results.',
      'Bridging layers (PVB, wire mesh) are strings with the in-plane displacement neglected; they never tear. No impact validation: the contact with the pendulum is a penalty spring and dashpot, and fragments fall as rigid bodies that do not collide with each other.',
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
  {
    id: 'materials', title: 'Material library in the solvers', needsKit: true,
    solver: '`src/engine/materials.ts` (`box3d-webgpu-kit/materials`): sourced SI values with conditions and citations, and the helpers that build the inputs of the solid, fracture, heat, granular and rigid solvers from them',
    summary: 'Shear moduli against E / (2 (1 + nu)) for the entries with three sourced moduli; an aluminium bar in tension, a steel cantilever, a heated stainless bar, a cracked glass plate, a cooling copper bar, Hertz impacts of rubber spheres and glass beads, the restitution of glass beads, and a steel block and ball in the rigid world, each built from library values and checked against the closed form in which the value enters.',
    docs: ['docs/MATERIALS.md'],
    notValidated: [
      'The values themselves: each row checks that a library value reaches a solver in the right unit and role, with the reference computed from the same value. Whether 6061-T6 really has E = 68.9 GPa is the source\'s claim (docs/MATERIALS.md cites it), not something measured here.',
      'Source quality varies: standards and NIST data, manufacturers\' typical values ("not for design"), and for several friction pairs only The Engineering ToolBox, marked as a last resort. 6 of the 228 values are unverified (no source opened) and are refused by the helpers unless allowUnverified is set.',
      'Friction and restitution are properties of a pair, a surface finish and a speed. The rigid world applies one coefficient to sticking and sliding, mixes two bodies as sqrt(f_a f_b) and max(e_a, e_b), and does not apply restitution to slow impacts; the library records the measured speed but no solver uses it.',
      'Temperature dependence: each value holds at the stated temperature (mostly 20 to 25 °C); only the steel, concrete and wood formulas the sources give were evaluated, at 20 °C.',
      'Anisotropy and variability: wood is orthotropic and is given along the grain; rubber, polymers and wood vary with grade, moisture, rate and cross-linking well beyond the ranges here; grain-scale moduli of beads and sand are back-calculated from contact tests.',
    ],
  },
];

export const CASES = [...rigid, ...waterCoupling, ...structureCoupling, ...siBridge, ...siSuspension, ...geometry, ...scene, ...simulation, ...robot, ...cloth, ...granular, ...fluid, ...shallowWater, ...heat, ...solid, ...solidViscoelastic, ...solidConcrete, ...solidContact, ...fracture, ...plate, ...frame, ...cable, ...closedWater, ...materials];

/** Cases of the given domains (all when `only` is empty), in registry order. */
export function selectCases(only = []) {
  for (const id of only) if (!DOMAINS.some(domain => domain.id === id)) throw new RangeError(`Unknown domain "${id}". Domains: ${DOMAINS.map(domain => domain.id).join(', ')}`);
  return only.length ? CASES.filter(one => only.includes(one.domain)) : CASES;
}
/** True when any of the cases runs through the built kit. */
export const needsKit = cases => cases.some(one => DOMAINS.find(domain => domain.id === one.domain).needsKit);
