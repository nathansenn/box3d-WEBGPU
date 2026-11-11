// Rigid bodies, joints and shapes (the kit's Box3D world), against closed-form mechanics.
// Set-ups are those of packages/box3d-kit/test/v08.test.mjs: SI units, 240 Hz, 4 sub-steps.
import {kit, memo, defineCases, relative, absolute, meanPeriod} from '../lib.mjs';

const G = 9.81, HZ = 240, SUB = 4;
const FILE = 'packages/box3d-kit/test/v08.test.mjs';
const T = {
  fall: 'free fall follows y = h - g t^2 / 2 and mass is density x volume for each shape',
  pendulum: 'a hinged sphere swings with the compound-pendulum period and keeps its amplitude',
  friction: 'sliding friction stops a box after v^2 / (2 mu g) and a bounce returns e^2 of the drop height',
  collision: 'an elastic collision conserves momentum and kinetic energy',
  joints: 'joints: motor speed, prismatic limits, distance length, weld, spring, steering and lifetime',
  forces: 'kinematic bodies, setters, forces, gravity control and collision filters',
  events: 'contact, hit and sensor events arrive after the step that caused them',
  hulls: 'convex hulls: mass is density x volume and a hull rests on its face',
  incline: 'a triangle-mesh incline: sliding at g sin(theta) and rolling at 5/7 of it',
  terrain: 'height-field terrain: exact heights on a plane, sliding on it, and settling in a bowl',
};

async function world(extra = {}) {
  const {createWorld} = await kit('index');
  return createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0], ...extra});
}
const run = (w, seconds) => { for (let i = 0; i < Math.round(seconds * HZ); i++) w.step(); };

const freeFall = () => memo('rigid/free-fall', async () => {
  const w = await world({ground: false});
  try {
    const sphere = w.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [0, 100, 0]});
    const box = w.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.2, 0.3]}, position: [5, 100, 0], density: 2700});
    const capsule = w.createBody({shape: {kind: 'capsule', radius: 0.3, halfLength: 0.5}, position: [10, 100, 0], density: 500});
    const masses = [sphere, box, capsule].map(body => w.getState(body).mass);
    run(w, 2);
    const state = w.getState(sphere);
    return {masses, speed: -state.linearVelocity[1], height: state.position[1]};
  } finally { w.dispose(); }
});

const pendulum = () => memo('rigid/pendulum', async () => {
  const w = await world({ground: false});
  try {
    const L = 2, r = 0.1, theta0 = 0.1, pivot = [0, 10, 0];
    const bob = w.createBody({shape: {kind: 'sphere', radius: r}, position: [L * Math.sin(theta0), pivot[1] - L * Math.cos(theta0), 0], neverSleeps: true});
    const hinge = w.createJoint({type: 'revolute', bodyA: null, bodyB: bob, frameA: {position: pivot}, frameB: {position: [-L * Math.sin(theta0), L * Math.cos(theta0), 0]}});
    let previous = theta0, lateAmplitude = 0;
    const crossings = [];
    for (let i = 1; i <= HZ * 30; i++) {
      w.step();
      const p = w.getState(bob).position, theta = Math.atan2(p[0], pivot[1] - p[1]);
      if (previous > 0 && theta <= 0) crossings.push((i - 1 + previous / (previous - theta)) / HZ);
      previous = theta;
      if (i > HZ * 25) lateAmplitude = Math.max(lateAmplitude, Math.abs(theta));
    }
    return {
      period: meanPeriod(crossings), lateAmplitude, theta0,
      exact: 2 * Math.PI * Math.sqrt((L * L + 0.4 * r * r) / (G * L)) * (1 + theta0 * theta0 / 16),
      hingeForce: Math.hypot(...w.getJointState(hinge).force), weight: w.getState(bob).mass * G,
    };
  } finally { w.dispose(); }
});

const frictionAndBounce = () => memo('rigid/friction-bounce', async () => {
  const w = await world({ground: false});
  try {
    const mu = 0.5, v0 = 6;
    w.createBody({shape: {kind: 'box', halfExtents: [50, 0.5, 5]}, type: 'static', position: [0, -0.5, 0], friction: mu});
    const slider = w.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.1, 0.5]}, position: [0, 0.1, 0], friction: mu, lockRotation: true, linearVelocity: [v0, 0, 0]});
    run(w, 5);
    const distance = w.getState(slider).position[0];
    const e = 0.5, drop = 5, radius = 0.2;
    const ball = w.createBody({shape: {kind: 'sphere', radius}, position: [20, drop + radius, 0], restitution: e});
    let rising = false, peak = 0;
    for (let i = 0; i < HZ * 4; i++) {
      w.step();
      const s = w.getState(ball);
      if (s.linearVelocity[1] > 0) rising = true;
      if (rising) peak = Math.max(peak, s.position[1] - radius);
      if (rising && s.linearVelocity[1] < -0.5) break;
    }
    return {distance, stopping: v0 * v0 / (2 * mu * G), peak, rebound: e * e * drop};
  } finally { w.dispose(); }
});

const collision = () => memo('rigid/collision', async () => {
  const w = await world({ground: false, gravity: [0, 0, 0]});
  try {
    const a = w.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [-3, 0, 0], linearVelocity: [4, 0, 0], restitution: 1, friction: 0});
    const b = w.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [0, 0.1, 0], restitution: 1, friction: 0});
    const sum = () => {
      const sa = w.getState(a), sb = w.getState(b), v2 = s => s.linearVelocity.reduce((t, v) => t + v * v, 0);
      return {p: sa.mass * sa.linearVelocity[0] + sb.mass * sb.linearVelocity[0], ke: 0.5 * sa.mass * v2(sa) + 0.5 * sb.mass * v2(sb)};
    };
    const before = sum();
    run(w, 2);
    return {before, after: sum()};
  } finally { w.dispose(); }
});

const joints = () => memo('rigid/joints', async () => {
  const {axisRotation} = await kit('index');
  const w = await world({ground: false, gravity: [0, 0, 0]});
  try {
    const rotor = w.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.1]}, position: [0, 0, 0]});
    const motor = w.createJoint({type: 'revolute', bodyA: null, bodyB: rotor, motor: {speed: 2, maxForce: 1e6}});
    run(w, 1);
    const motorSpeed = w.getState(rotor).angularVelocity[2], motorAngle = w.getJointState(motor).value;

    const orbiter = w.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [30, 0, 3], linearVelocity: [2, 0, 0]});
    const tether = w.createJoint({type: 'distance', bodyA: null, bodyB: orbiter, frameA: {position: [30, 0, 0]}, length: 3});
    let lengthError = 0;
    for (let i = 0; i < HZ * 3; i++) { w.step(); lengthError = Math.max(lengthError, Math.abs(w.getJointState(tether).value - 3)); }
    const m = w.getState(orbiter).mass, speed = Math.hypot(...w.getState(orbiter).linearVelocity);
    const tension = Math.hypot(...w.getJointState(tether).force);

    const mass = w.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [50, 0, 0.5], neverSleeps: true});
    const q = axisRotation([0, 0, 1], 'x');
    w.createJoint({type: 'prismatic', bodyA: null, bodyB: mass, frameA: {position: [50, 0, 0], rotation: q}, frameB: {rotation: q}, spring: {hertz: 2, dampingRatio: 0, target: 0}});
    let last = 0.5, firstReturn = 0;
    for (let i = 1; i <= HZ * 2 && firstReturn === 0; i++) {
      w.step();
      const z = w.getState(mass).position[2];
      if (last > 0 && z <= 0) firstReturn = (i - 1 + last / (last - z)) / HZ;
      last = z;
    }
    return {motorSpeed, motorAngle, lengthError, tension, centripetal: m * speed * speed / 3, firstReturn};
  } finally { w.dispose(); }
});

const forces = () => memo('rigid/forces', async () => {
  const w = await world({ground: false, gravity: [0, 0, 0]});
  try {
    const cart = w.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 20, 0], density: 100});
    const m = w.getState(cart).mass, inertia = m * (1 + 1) / 12;
    for (let i = 0; i < HZ; i++) { w.applyForce(cart, [50, 0, 0]); w.step(); }
    const speed = w.getState(cart).linearVelocity[0];
    for (let i = 0; i < HZ; i++) { w.applyTorque(cart, [0, 5, 0]); w.step(); }
    return {speed, expectedSpeed: 50 / m, spin: w.getState(cart).angularVelocity[1], expectedSpin: 5 / inertia};
  } finally { w.dispose(); }
});

const impact = () => memo('rigid/impact', async () => {
  const w = await world();
  try {
    const events = [], drop = 2, radius = 0.2;
    w.onEvent(event => events.push(event));
    w.createBody({shape: {kind: 'sphere', radius}, position: [0, drop + radius, 0], hitEvents: true});
    run(w, 2);
    return {speed: events.find(e => e.kind === 'hit').approachSpeed, expected: Math.sqrt(2 * G * drop)};
  } finally { w.dispose(); }
});

const incline = () => memo('rigid/incline', async () => {
  const w = await world({ground: false});
  try {
    const theta = 0.3, length = 40, half = 4, c = Math.cos(theta), s = Math.sin(theta), r = 0.25, t = 2;
    const ramp = (z, friction) => w.createBody({
      shape: {kind: 'mesh', vertices: [0, 0, z - half, length * c, -length * s, z - half, length * c, -length * s, z + half, 0, 0, z + half], indices: [0, 2, 1, 0, 3, 2]},
      position: [0, 0, 0], friction,
    });
    const start = z => [c + r * s, -s + r * c, z];
    ramp(0, 0);
    const slider = w.createBody({shape: {kind: 'sphere', radius: r}, position: start(0), friction: 0});
    ramp(20, 1);
    const roller = w.createBody({shape: {kind: 'sphere', radius: r}, position: start(20), friction: 1});
    run(w, t);
    const rolling = w.getState(roller);
    return {
      sliding: Math.hypot(...w.getState(slider).linearVelocity), slidingExact: G * s * t,
      rolling: Math.hypot(...rolling.linearVelocity), rollingExact: 5 / 7 * G * s * t,
      rim: Math.abs(rolling.angularVelocity[2]) * r,
    };
  } finally { w.dispose(); }
});

const terrain = () => memo('rigid/terrain', async () => {
  const w = await world({ground: false});
  try {
    const theta = 0.2, nx = 81, nz = 9, d = 0.5, slope = Math.tan(theta), heights = [];
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) heights.push((nx - 1 - x) * d * slope);
    w.createBody({shape: {kind: 'heightfield', heights, countX: nx, countZ: nz, spacing: [d, d]}, position: [100, 0, -2], friction: 0});
    const hit = w.raycast([100 + 10.3, 100, 0], [0, -200, 0]);
    const r = 0.25, c = Math.cos(theta), s = Math.sin(theta), t = 2;
    const puck = w.createBody({shape: {kind: 'sphere', radius: r}, position: [101 + r * s, 39 * slope + r * c, 0], friction: 0});
    run(w, t);
    return {height: hit.point[1], heightExact: (40 - 10.3) * slope, speed: Math.hypot(...w.getState(puck).linearVelocity), speedExact: G * s * t};
  } finally { w.dispose(); }
});

const hulls = () => memo('rigid/hulls', async () => {
  const w = await world();
  try {
    const corners = [];
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) corners.push(x, y, z);
    const cube = w.createBody({shape: {kind: 'hull', points: [...corners, 0, 0, 0]}, position: [0, 0.6, 0], density: 800});
    const octahedron = w.createBody({shape: {kind: 'hull', points: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]}, position: [5, 30, 0]});
    const masses = [w.getState(cube).mass, w.getState(octahedron).mass];
    run(w, 2);
    return {masses, rest: w.getState(cube).position[1]};
  } finally { w.dispose(); }
});

export default defineCases('rigid', FILE, [
  {id: 'rigid.free-fall.speed', title: 'Free fall: speed after 2 s', quantity: 'speed of a falling sphere', unit: 'm/s', test: T.fall,
    reference: {formula: 'v = g t', value: G * 2}, tolerance: relative(1e-4), measure: async () => (await freeFall()).speed},
  {id: 'rigid.free-fall.height', title: 'Free fall: height after 2 s', quantity: 'height of a sphere dropped from 100 m', unit: 'm', test: T.fall,
    reference: {formula: 'y = h - g t^2 / 2', value: 100 - 0.5 * G * 4},
    tolerance: absolute(0.5 * G * 2 / (HZ * SUB) + 1e-3),
    note: 'Semi-implicit Euler falls g t dt / 2 further than the continuum answer; the tolerance is exactly that plus 1 mm.',
    measure: async () => (await freeFall()).height},
  {id: 'rigid.mass.sphere', title: 'Mass of a sphere', quantity: 'mass, density 1000 kg/m^3, r = 0.25 m', unit: 'kg', test: T.fall,
    reference: {formula: 'm = rho (4/3) pi r^3', value: 1000 * 4 / 3 * Math.PI * 0.25 ** 3}, tolerance: relative(1e-5), note: 'The world stores mass in float32.',
    measure: async () => (await freeFall()).masses[0]},
  {id: 'rigid.mass.box', title: 'Mass of a box', quantity: 'mass, density 2700 kg/m^3, 0.2 x 0.4 x 0.6 m', unit: 'kg', test: T.fall,
    reference: {formula: 'm = rho a b c', value: 2700 * 0.2 * 0.4 * 0.6}, tolerance: relative(1e-5), measure: async () => (await freeFall()).masses[1]},
  {id: 'rigid.mass.capsule', title: 'Mass of a capsule', quantity: 'mass, density 500 kg/m^3, r = 0.3 m, half length 0.5 m', unit: 'kg', test: T.fall,
    reference: {formula: 'm = rho (pi r^2 (2 h) + (4/3) pi r^3)', value: 500 * (Math.PI * 0.09 * 1 + 4 / 3 * Math.PI * 0.027)}, tolerance: relative(1e-5),
    measure: async () => (await freeFall()).masses[2]},
  {id: 'rigid.mass.hull', title: 'Mass of a convex hull (octahedron)', quantity: 'mass of the hull of six unit axis points, density 1000 kg/m^3', unit: 'kg', test: T.hulls,
    reference: {formula: 'm = rho (4/3)', value: 1000 * 4 / 3}, tolerance: relative(1e-5), measure: async () => (await hulls()).masses[1]},
  {id: 'rigid.hull.rest-height', title: 'A cube hull rests on the ground', quantity: 'centre height of a 1 m cube hull at rest', unit: 'm', test: T.hulls,
    reference: {formula: 'y = a / 2', value: 0.5}, tolerance: absolute(0.006), note: 'Box3D lets resting contacts sink by its linear slop (5 mm).',
    measure: async () => (await hulls()).rest},
  {id: 'rigid.pendulum.period', title: 'Compound pendulum: period', quantity: 'period of a hinged sphere, L = 2 m, released at 0.1 rad, mean over 30 s', unit: 's', test: T.pendulum,
    reference: {formula: 'T = 2 pi sqrt((L^2 + 2 r^2 / 5) / (g L)) (1 + theta0^2 / 16)', value: 2 * Math.PI * Math.sqrt((4 + 0.4 * 0.01) / (G * 2)) * (1 + 0.01 / 16)},
    tolerance: relative(1e-3), measure: async () => (await pendulum()).period},
  {id: 'rigid.pendulum.amplitude', title: 'Compound pendulum: amplitude kept', quantity: 'largest angle between 25 s and 30 s', unit: 'rad', test: T.pendulum,
    reference: {formula: 'theta_max = theta0 (no energy drift)', value: 0.1}, tolerance: relative(0.01), measure: async () => (await pendulum()).lateAmplitude},
  {id: 'rigid.pendulum.hinge-force', title: 'Compound pendulum: hinge force', quantity: 'force carried by the hinge at the end of the run', unit: 'N', test: T.pendulum,
    reference: {formula: 'F = m g (to first order in theta0)', value: 1000 * 4 / 3 * Math.PI * 0.001 * G}, tolerance: relative(0.05),
    note: 'The exact force varies by theta0^2 = 1% over a swing; the reference uses the mass the world reports.',
    measure: async () => { const r = await pendulum(); return {value: r.hingeForce, reference: r.weight}; }},
  {id: 'rigid.friction.stopping-distance', title: 'Sliding friction: stopping distance', quantity: 'distance a box slides from 6 m/s with mu = 0.5', unit: 'm', test: T.friction,
    reference: {formula: 'd = v0^2 / (2 mu g)', value: 36 / (2 * 0.5 * G)}, tolerance: relative(0.01), measure: async () => (await frictionAndBounce()).distance},
  {id: 'rigid.restitution.rebound', title: 'Restitution: rebound height', quantity: 'first rebound of a ball dropped 5 m with e = 0.5', unit: 'm', test: T.friction,
    reference: {formula: 'h1 = e^2 h', value: 0.25 * 5}, tolerance: relative(0.02), measure: async () => (await frictionAndBounce()).peak},
  {id: 'rigid.collision.momentum', title: 'Elastic collision: momentum', quantity: 'total x momentum of two spheres after an oblique elastic collision', unit: 'kg m/s', test: T.collision,
    reference: {formula: 'p_after = p_before', value: 1000 * 4 / 3 * Math.PI * 0.125 * 4}, tolerance: relative(1e-4),
    measure: async () => { const r = await collision(); return {value: r.after.p, reference: r.before.p}; }},
  {id: 'rigid.collision.energy', title: 'Elastic collision: kinetic energy', quantity: 'total kinetic energy after the collision (e = 1, no friction)', unit: 'J', test: T.collision,
    reference: {formula: 'KE_after = KE_before', value: 0.5 * 1000 * 4 / 3 * Math.PI * 0.125 * 16}, tolerance: relative(1e-3),
    measure: async () => { const r = await collision(); return {value: r.after.ke, reference: r.before.ke}; }},
  {id: 'rigid.force.newton', title: 'F = m a', quantity: 'speed after 50 N acts for 1 s on a 100 kg box', unit: 'm/s', test: T.forces,
    reference: {formula: 'v = F t / m', value: 0.5}, tolerance: relative(1e-3),
    measure: async () => { const r = await forces(); return {value: r.speed, reference: r.expectedSpeed}; }},
  {id: 'rigid.force.torque', title: 'tau = I alpha', quantity: 'spin after 5 N m acts for 1 s about a principal axis of a 1 m cube', unit: 'rad/s', test: T.forces,
    reference: {formula: 'omega = tau t / I, I = m (a^2 + b^2) / 12', value: 5 / (100 * 2 / 12)}, tolerance: relative(1e-3),
    measure: async () => { const r = await forces(); return {value: r.spin, reference: r.expectedSpin}; }},
  {id: 'rigid.impact.speed', title: 'Impact speed of a dropped ball', quantity: 'approach speed reported by the hit event after a 2 m drop', unit: 'm/s', test: T.events,
    reference: {formula: 'v = sqrt(2 g h)', value: Math.sqrt(2 * G * 2)}, tolerance: relative(0.02), measure: async () => (await impact()).speed},
  {id: 'rigid.joint.motor-speed', title: 'Revolute motor: speed', quantity: 'angular speed of a rotor driven at 2 rad/s', unit: 'rad/s', test: T.joints,
    reference: {formula: 'omega = omega_motor', value: 2}, tolerance: relative(1e-3), measure: async () => (await joints()).motorSpeed},
  {id: 'rigid.joint.motor-angle', title: 'Revolute motor: angle', quantity: 'joint angle after 1 s at 2 rad/s', unit: 'rad', test: T.joints,
    reference: {formula: 'theta = omega t', value: 2}, tolerance: relative(0.01), measure: async () => (await joints()).motorAngle},
  {id: 'rigid.joint.distance-length', title: 'Distance joint: length kept', quantity: 'largest length error of a 3 m tether over 3 s of orbit', unit: 'm', test: T.joints,
    reference: {formula: '|l - L| = 0', value: 0}, tolerance: absolute(0.01), measure: async () => (await joints()).lengthError},
  {id: 'rigid.joint.tether-tension', title: 'Distance joint: centripetal tension', quantity: 'tension in a 3 m tether holding a sphere at 2 m/s', unit: 'N', test: T.joints,
    reference: {formula: 'T = m v^2 / r', value: 1000 * 4 / 3 * Math.PI * 0.008 * 4 / 3}, tolerance: relative(0.02),
    measure: async () => { const r = await joints(); return {value: r.tension, reference: r.centripetal}; }},
  {id: 'rigid.joint.spring-period', title: 'Joint spring: quarter period', quantity: 'time for a mass on a 2 Hz joint spring to first reach its rest point', unit: 's', test: T.joints,
    reference: {formula: 't = 1 / (4 f)', value: 1 / 8}, tolerance: relative(0.02), measure: async () => (await joints()).firstReturn},
  {id: 'rigid.incline.sliding', title: 'Incline: frictionless sliding', quantity: 'speed of a sphere after 2 s on a 0.3 rad triangle-mesh incline', unit: 'm/s', test: T.incline,
    reference: {formula: 'v = g sin(theta) t', value: G * Math.sin(0.3) * 2}, tolerance: relative(1e-3), measure: async () => (await incline()).sliding},
  {id: 'rigid.incline.rolling', title: 'Incline: rolling without slipping', quantity: 'speed of a solid sphere after 2 s on the same incline with friction 1', unit: 'm/s', test: T.incline,
    reference: {formula: 'v = (5/7) g sin(theta) t', value: 5 / 7 * G * Math.sin(0.3) * 2}, tolerance: relative(0.01), note: 'The solver lets the contact slip slightly.',
    measure: async () => (await incline()).rolling},
  {id: 'rigid.incline.rolling-constraint', title: 'Incline: v = omega r', quantity: 'rim speed omega r of the rolling sphere', unit: 'm/s', test: T.incline,
    reference: {formula: 'omega r = v', value: 5 / 7 * G * Math.sin(0.3) * 2}, tolerance: relative(0.02),
    measure: async () => { const r = await incline(); return {value: r.rim, reference: r.rolling}; }},
  {id: 'rigid.terrain.height', title: 'Height field: surface height', quantity: 'ray hit height on a planar height field at x = 10.3 m', unit: 'm', test: T.terrain,
    reference: {formula: 'y = (40 - x) tan(theta)', value: (40 - 10.3) * Math.tan(0.2)}, tolerance: absolute(5e-4), note: 'Heights are quantised to 16 bits over the 8 m range: about 0.12 mm.',
    measure: async () => (await terrain()).height},
  {id: 'rigid.terrain.sliding', title: 'Height field: frictionless sliding', quantity: 'speed of a sphere after 2 s on a 0.2 rad height-field slope', unit: 'm/s', test: T.terrain,
    reference: {formula: 'v = g sin(theta) t', value: G * Math.sin(0.2) * 2}, tolerance: relative(1e-3), measure: async () => (await terrain()).speed},
]);
