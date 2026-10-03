import * as T from 'three/webgpu';
import { RIVER_SURFACE_Y, RIVER_CURRENT, type WaterImpact, type FailureSimulation } from './physics';

/** One splash event: surface crossings of bridge particles that land together
 * (within MERGE_RADIUS and MERGE_TIME of the first crossing) are one splash.
 * energy = sum(m v^2), momentum = sum(m v); position is momentum-weighted. */
export interface SplashEvent { time: number; x: number; z: number; speed: number; mass: number; energy: number; momentum: number; seed: number }
export interface WaterContact { x: number; z: number; strength: number }

const MERGE_RADIUS = 1.5, MERGE_TIME = .15, RECROSS_TIME = .2;
export const MAX_SPLASHES = 24, MAX_CONTACTS = 24, DROPS_PER_SPLASH = 120;
/** Real-world droplet gravity; the structure's tuned 2.2 is a load model, not free flight. */
const DROP_GRAVITY = 9.81;

const UP = new T.Vector3(0, 1, 0);
const hash = (n: number) => { const x = Math.sin(n * 91.345 + 47.853) * 43758.5453; return x - Math.floor(x); };

export function clusterImpacts(impacts: readonly WaterImpact[], until = Infinity): SplashEvent[] {
  const events: SplashEvent[] = [], lastByNode = new Map<number, number>();
  for (const m of impacts) {
    if (m.time > until) break;
    const last = lastByNode.get(m.node);
    lastByNode.set(m.node, m.time);
    // Projection can lift a particle back over the surface for a step; that is not a new impact.
    if (last !== undefined && m.time - last < RECROSS_TIME) continue;
    const p = m.mass * m.speed, e = m.mass * m.speed * m.speed;
    const hit = events.find(s => m.time - s.time < MERGE_TIME && Math.hypot(m.x - s.x, m.z - s.z) < MERGE_RADIUS);
    if (hit) {
      const w = hit.momentum + p;
      hit.x = (hit.x * hit.momentum + m.x * p) / w; hit.z = (hit.z * hit.momentum + m.z * p) / w;
      hit.momentum = w; hit.energy += e; hit.mass += m.mass; hit.speed = Math.max(hit.speed, m.speed);
    } else events.push({ time: m.time, x: m.x, z: m.z, speed: m.speed, mass: m.mass, energy: e, momentum: p, seed: m.node * 7.13 + events.length });
  }
  return events.slice(-MAX_SPLASHES);
}

/** Particles wetted at the surface (in the channel, within 0.35 below to 0.05 above it). */
export function waterContacts(sim: FailureSimulation): WaterContact[] {
  const out: WaterContact[] = [];
  for (let i = 0; i < sim.nodes.length && out.length < MAX_CONTACTS; i++) {
    const n = sim.nodes[i]; if (n.inverseMass === 0) continue;
    const d = RIVER_SURFACE_Y - n.p[1];
    if (d < -.05 || d > .35 || Math.abs(n.p[0]) > 16) continue;
    out.push({ x: n.p[0], z: n.p[2], strength: (1 - Math.max(0, d - .1) / .25) / n.inverseMass });
  }
  return out;
}

/** Deterministic ballistic spray, evaluated as a pure function of (time - impact time)
 * so any frame renders identically regardless of step history. Launch speed scales with
 * impact speed (slap jets reach 0.6-1.7x the impact speed), droplet count with momentum,
 * droplets move with the current and end when they fall back to the surface. */
export class RiverSplash extends T.InstancedMesh {
  private readonly m4 = new T.Matrix4(); private readonly q = new T.Quaternion(); private readonly s = new T.Vector3(); private readonly v = new T.Vector3();
  constructor() {
    const material = new T.MeshStandardNodeMaterial({ color: '#e4eeec', roughness: .35, metalness: 0, transparent: true, opacity: .78, depthWrite: false });
    super(new T.IcosahedronGeometry(1, 2), material, MAX_SPLASHES * DROPS_PER_SPLASH);
    this.frustumCulled = false; this.castShadow = false; this.receiveShadow = false; this.count = 0;
  }
  update(time: number, events: readonly SplashEvent[]): void {
    let k = 0;
    for (const e of events) {
      const age = time - e.time; if (age < 0 || age > 2.2) continue;
      const n = Math.min(DROPS_PER_SPLASH, Math.round(24 + 14 * e.momentum));
      for (let j = 0; j < n; j++) {
        const h = (o: number) => hash(e.seed * 13.7 + j * 3.1 + o);
        const crown = j % 3 !== 0; // two thirds crown sheet, one third central jet
        const theta = h(1) * Math.PI * 2, elev = crown ? .95 + h(2) * .35 : 1.25 + h(2) * .25;
        const u = e.speed * (crown ? .6 + h(3) * .7 : .9 + h(3) * .8);
        const uy = u * Math.sin(elev), ur = u * Math.cos(elev), life = 2 * uy / DROP_GRAVITY;
        const ta = age - h(4) * .05; if (ta <= 0 || ta >= life) continue;
        const r0 = crown ? .3 + .35 * h(5) : .12 * h(5);
        const y = RIVER_SURFACE_Y + uy * ta - .5 * DROP_GRAVITY * ta * ta;
        const rr = r0 + ur * ta;
        const x = e.x + Math.cos(theta) * rr, z = e.z + Math.sin(theta) * rr + RIVER_CURRENT * ta;
        const size = (crown ? .065 : .095) * (.6 + h(6) * .8) * Math.min(1, Math.sqrt(e.mass)) * (1 - .55 * ta / life);
        const vy = uy - DROP_GRAVITY * ta; this.v.set(Math.cos(theta) * ur, vy, Math.sin(theta) * ur).normalize();
        this.q.setFromUnitVectors(UP, this.v);
        // Droplets stretch along their velocity like short-exposure spray.
        this.s.set(size, size * (1.4 + Math.min(2.2, Math.hypot(ur, vy) * .35)), size);
        this.m4.compose(new T.Vector3(x, y, z), this.q, this.s); this.setMatrixAt(k++, this.m4);
        if (k >= this.instanceMatrix.count) break;
      }
    }
    this.count = k; this.visible = k > 0; this.instanceMatrix.needsUpdate = true;
  }
}
