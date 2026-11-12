/**
 * The Studio's bridge study on the SI suspension model (src/engine/si-suspension.ts). This adapter keeps the
 * Studio's runtime contract (fixed 120 Hz steps, snapshots of 148 drawn particles and the drawn link topology) and
 * fills it from the SI model: deck particles are the girder nodes, cable particles the main cable points and saddles,
 * and a hanger link is broken when that hanger has failed. Readings in SI travel in `snapshot.si`.
 *
 * Controls, in SI: `targetLoad` is the pedestrian crowd in kN/m^2 on the east half of the deck (it builds up at
 * 0.5 kN/m^2 per second), `wind` the lateral load on the deck in kN/m, and `cuts` the number of hangers cut on the
 * upstream cable (z < 0), from midspan outwards. A hanger also fails by itself when its tension exceeds its minimum
 * breaking force.
 */
import { FailureSimulation, FIXED_DT, STUDIES, STUDIO_SI_BRIDGE_BACKEND, type Snapshot, type SiBridgeReadout, type StudioCheckpoint } from './physics.ts';
import { SiSuspensionBridge, SiSuspensionStatics, structureOnlyWorld, suspensionLayout, type SiSuspensionLayout } from '../engine/si-suspension.ts';

/** Crowd build-up, kN/m^2 per second. */
export const SI_BRIDGE_CROWD_RATE = .5;
/** The crowd covers these panels (the east half of the deck). */
export const SI_BRIDGE_CROWD_PANELS = Object.freeze({ from: 18, to: 36 });
/** Order in which hangers of the upstream cable are cut: midspan, then alternately west and east of it. */
export const SI_BRIDGE_CUT_ORDER = Object.freeze([18, 17, 19, 16, 20, 15, 21, 14]);
export const SI_BRIDGE_MAX_CUTS = 6;
/** Frame and cable damping, 1/s (mass-proportional): about 0.6 % of critical in the first vertical mode. */
export const SI_BRIDGE_DAMPING = Object.freeze({ frame: .1, cable: .1 });

/** What a reader of this study needs to know, from docs/SI_BRIDGE.md. */
export const SI_BRIDGE_SCOPE = 'SI model: steel frame elements (deck grillage, portal towers), tension-only steel strands with exact geometry (main cables, backstays, hangers), coupled each step. Not modelled: contact, buckling, yielding, cable slip on the saddles, aerodynamics beyond a static lateral load, timber stiffness. Utilisations are linear-elastic indicators, not a design check.';

let template: { layout: SiSuspensionLayout; statics: SiSuspensionStatics } | undefined;
/** Form-finding once per realm: every study starts from a copy of the same form-found statics. */
function form(): { layout: SiSuspensionLayout; statics: SiSuspensionStatics } {
  if (!template) {
    const layout = suspensionLayout(), gravity = -structureOnlyWorld().gravity()[1];
    template = { layout, statics: new SiSuspensionStatics(layout, { gravity }) };
  }
  return template;
}

export class SiBridgeStudy extends FailureSimulation {
  readonly layout: SiSuspensionLayout;
  private built?: SiSuspensionBridge;
  /** The time-stepped SI model, built on first use: a copy that only draws (the Studio's main thread, whose model
   * steps in a worker) never builds it and shows the form-found dead-load state. */
  get model(): SiSuspensionBridge {
    if (!this.built) {
      const { layout, statics } = form();
      this.built = new SiSuspensionBridge(structureOnlyWorld(), layout, {
        statics: new SiSuspensionStatics(layout, { gravity: statics.gravity, formFrom: statics }),
        damping: SI_BRIDGE_DAMPING.frame, cableDamping: SI_BRIDGE_DAMPING.cable,
      });
    }
    return this.built;
  }
  /** Hangers to cut (control). */
  cuts = 0;
  private cut = 0;
  /** Hangers the control has cut so far (each cut fails one hanger that was still carrying). */
  private cutCount = 0;
  private appliedCrowd = 0; private appliedWind = 0;
  private yielded = false;
  private readonly failedSeen = new Set<number>();
  /** PBD hanger link of each SI segment (-1 for other segments), and the hanger segment of each link (-1 otherwise). */
  private readonly linkOfSegment: Int32Array; private readonly segmentOfLink: Int32Array;
  private readonly p3: [number, number, number] = [0, 0, 0];

  constructor(controls: { targetLoad?: number; wind?: number; cuts?: number } = {}) {
    super('bridge', {}, STUDIO_SI_BRIDGE_BACKEND);
    const { layout } = form();
    this.layout = layout;
    this.targetLoad = 0; this.wind = 0; this.strength = 1; this.load = 0;
    this.linkOfSegment = new Int32Array(layout.segments.length).fill(-1); this.segmentOfLink = new Int32Array(this.links.length).fill(-1);
    this.links.forEach((link, index) => {
      if (link.kind !== 'hanger') return;
      const station = Math.floor(link.a / 4), side = link.a % 4, segment = layout.hangers[side][station];
      if (segment >= 0) { this.linkOfSegment[segment] = index; this.segmentOfLink[index] = segment; }
    });
    Object.assign(this, controls);
  }

  /** Hanger segment cut by the n-th cut. */
  cutSegment(n: number): number { return this.layout.hangers[0][SI_BRIDGE_CUT_ORDER[n]]; }

  override step(dt = FIXED_DT): void {
    if (Math.abs(dt - FIXED_DT) > 1e-12) throw new RangeError('The SI bridge steps at the Studio\'s fixed 120 Hz only.');
    if (!(this.targetLoad >= 0 && this.targetLoad <= 10) || !(this.wind >= -5 && this.wind <= 5)) throw new RangeError('Crowd 0 to 10 kN/m^2 and wind -5 to 5 kN/m.');
    this.load += Math.min(dt * SI_BRIDGE_CROWD_RATE, Math.max(-dt * SI_BRIDGE_CROWD_RATE, this.targetLoad - this.load));
    if (Math.abs(this.load - this.targetLoad) < 1e-9) this.load = this.targetLoad;
    if (this.load !== this.appliedCrowd) {
      this.model.setCrowd(this.load > 0 ? { pressure: this.load * 1e3, ...SI_BRIDGE_CROWD_PANELS } : null);
      this.appliedCrowd = this.load;
    }
    if (this.wind !== this.appliedWind) { this.model.setWind(this.wind * 1e3); this.appliedWind = this.wind; }
    const wanted = Math.max(0, Math.min(SI_BRIDGE_MAX_CUTS, Math.round(this.cuts)));
    while (this.cut < wanted) {
      const segment = this.cutSegment(this.cut++);
      if (this.model.failHanger(segment)) {
        this.failedSeen.add(segment); this.cutCount++;
        this.events.push({ time: this.time, type: 'break', message: `Hanger ${this.hangerLabel(segment)} cut`, connection: this.linkOfSegment[segment] });
      }
    }
    this.model.step();
    this.time = this.model.out.time;
    for (const segment of this.model.failed) if (!this.failedSeen.has(segment)) {
      this.failedSeen.add(segment);
      this.events.push({ time: this.time, type: 'break', message: `Hanger ${this.hangerLabel(segment)} ruptured over its breaking force`, connection: this.linkOfSegment[segment] });
    }
    const out = this.model.out;
    if (!this.yielded && Math.max(out.girderUtilisation, out.crossbeamUtilisation, out.towerUtilisation, out.maxHangerUtilisation, out.maxMainUtilisation) >= 1) {
      this.yielded = true;
      this.events.push({ time: this.time, type: 'yield', message: 'A member reaches its stated strength (linear-elastic indicator)', connection: 0 });
    }
    this.brokenCount = this.model.failed.length; this.topologyVersion = this.brokenCount;
    for (let i = 0; i < this.links.length; i++) this.links[i].broken = this.segmentOfLink[i] >= 0 && this.model.isFailed(this.segmentOfLink[i]);
  }
  hangerLabel(segment: number): string { const s = this.layout.segments[segment]; return `${s.side === 0 ? 'U' : 'D'}${s.station}`; }

  override deflection(): number { if (!this.built) return 0; let drop = 0; for (const value of this.built.out.deckDeflection) drop = Math.max(drop, -value); return drop; }
  /** The snapshot of a model not built yet: the form-found dead-load state of the shared statics, at rest. */
  private deadSnapshot(target: Snapshot): Snapshot {
    const { statics: s } = form(), L = this.layout, u = s.dead.displacements, N = L.params.panels, p: [number, number, number] = [0, 0, 0], si = target.si!;
    for (let j = 0; j <= N; j++) for (let side = 0; side < 2; side++) {
      target.positions.set(s.endPosition(L.girders[side][j], u, p), (j * 4 + side) * 3);
      const point = L.cablePoints[side][j];
      target.positions.set(s.endPosition(point >= 0 ? -point - 1 : L.towers[j === 0 ? 0 : 1].saddles[side], u, p), (j * 4 + 2 + side) * 3);
    }
    target.strains.fill(0); target.broken.fill(0); target.topologyVersion = 0; target.topologyIdentity = 'si-bridge:'; target.punchY = 0;
    Object.assign(target.response, { time: 0, load: 0, deflection: 0, strain: 0, broken: 0, damage: 0, plastic: 0, phase: 'Ready' });
    let hanger = 0, main = 0;
    L.segments.forEach((seg, i) => { if (seg.kind === 'hanger') hanger = Math.max(hanger, s.dead.tensions[i]); else main = Math.max(main, s.dead.tensions[i]); });
    Object.assign(si, { crowd: 0, wind: 0, hangersFailed: 0, hangersCut: 0, midspan: 0, drop: 0, lateral: 0, maxHanger: hanger / 1e3, hangerUtilisation: hanger / L.params.hanger.breakingLoad, maxMain: main / 1e3, mainUtilisation: main / L.params.mainCable.breakingLoad, girderStress: 0, girderUtilisation: 0, towerUtilisation: 0, saddle: 0 });
    for (let side = 0; side < 2; side++) for (let j = 1; j < N; j++) si.hangers[side * (N - 1) + j - 1] = s.dead.tensions[L.hangers[side][j]] / 1e3;
    return target;
  }

  override createSnapshotTarget(): Snapshot {
    const target: Snapshot = {
      study: 'bridge', positions: new Float32Array(this.nodes.length * 3), broken: new Uint8Array(this.links.length), strains: new Float32Array(this.nodes.length),
      topologyVersion: 0, topologyIdentity: '', punchY: 0, response: { time: 0, load: 0, deflection: 0, strain: 0, broken: 0, damage: 0, plastic: 0, phase: '' },
      si: { crowd: 0, wind: 0, hangersFailed: 0, hangersCut: 0, midspan: 0, drop: 0, lateral: 0, maxHanger: 0, hangerUtilisation: 0, maxMain: 0, mainUtilisation: 0, girderStress: 0, girderUtilisation: 0, towerUtilisation: 0, saddle: 0, hangers: new Array(70).fill(0) },
    };
    return this.snapshotInto(target);
  }
  override snapshotInto(target: Snapshot): Snapshot {
    if (!target || target.study !== 'bridge' || !(target.positions instanceof Float32Array) || target.positions.length !== this.nodes.length * 3 ||
      !(target.strains instanceof Float32Array) || target.strains.length !== this.nodes.length || !(target.broken instanceof Uint8Array) || target.broken.length !== this.links.length ||
      !target.si || target.si.hangers.length !== 70) throw new RangeError('Invalid Studio snapshot target: expected independent, writable buffers for the SI bridge');
    if (!this.built) return this.deadSnapshot(target);
    const L = this.layout, m = this.model, out = m.out, s = m.statics, p = this.p3, N = L.params.panels, threshold = STUDIES.bridge.threshold;
    // Utilisation of the girders at each station (largest of the elements that meet there) and of the cables at each panel point.
    const girderAt = new Float64Array((N + 1) * 2);
    for (let side = 0; side < 2; side++) for (let j = 0; j < N; j++) {
      const ratio = s.memberStress(L.girderElements[side][j], m.frame.couplingViews().displacements) / L.params.girder.yieldStress;
      girderAt[2 * j + side] = Math.max(girderAt[2 * j + side], ratio); girderAt[2 * (j + 1) + side] = Math.max(girderAt[2 * (j + 1) + side], ratio);
    }
    let lateral = 0, drop = 0;
    for (let j = 0; j <= N; j++) {
      for (let side = 0; side < 2; side++) {
        const deck = j * 4 + side, cable = j * 4 + 2 + side;
        m.nodePosition(L.girders[side][j], p);target.positions.set(p, deck * 3);
        const point = L.cablePoints[side][j];
        if (point >= 0) m.endPosition(L.hangers[side][j], 0, p); else m.nodePosition(L.towers[j === 0 ? 0 : 1].saddles[side], p);
        target.positions.set(p, cable * 3);
        const hanger = L.hangers[side][j];
        target.strains[deck] = girderAt[2 * j + side] * threshold;
        target.strains[cable] = (hanger >= 0 ? out.utilisation[hanger] : 0) * threshold;
        lateral = Math.max(lateral, Math.abs(target.positions[deck * 3 + 2] - this.nodes[deck].rest[2]));
      }
      drop = Math.max(drop, -out.deckDeflection[j]);
    }
    for (let i = 0; i < this.links.length; i++) target.broken[i] = this.segmentOfLink[i] >= 0 && m.isFailed(this.segmentOfLink[i]) ? 1 : 0;
    target.topologyVersion = m.failed.length; target.topologyIdentity = `si-bridge:${[...m.failed].sort((a, b) => a - b).join(',')}`;
    target.punchY = 0;
    let saddle = 0; for (const value of out.saddleShift) saddle = Math.max(saddle, Math.abs(value));
    const steel = Math.max(out.girderUtilisation, out.crossbeamUtilisation, out.towerUtilisation), strands = Math.max(out.maxHangerUtilisation, out.maxMainUtilisation);
    const r = target.response;
    r.time = this.time; r.load = this.load; r.deflection = drop; r.strain = Math.max(steel, strands); r.broken = m.failed.length;
    r.damage = Math.min(1, out.maxHangerUtilisation); r.plastic = 0;
    r.phase = Math.max(steel, strands) >= 1 ? 'Beyond stated strength' : m.failed.length ? 'Hangers failed' : this.load > .02 || this.wind !== 0 ? 'Elastic response' : 'Ready';
    const si = target.si;
    si.crowd = this.load; si.wind = this.wind; si.hangersFailed = m.failed.length; si.hangersCut = this.cutCount;
    si.midspan = -out.midspanDeflection * 1e3; si.drop = drop * 1e3; si.lateral = lateral * 1e3;
    si.maxHanger = out.maxHangerTension / 1e3; si.hangerUtilisation = out.maxHangerUtilisation; si.maxMain = out.maxMainTension / 1e3; si.mainUtilisation = out.maxMainUtilisation;
    si.girderStress = out.girderUtilisation * L.params.girder.yieldStress / 1e6; si.girderUtilisation = out.girderUtilisation; si.towerUtilisation = out.towerUtilisation;
    si.saddle = saddle * 1e3;
    for (let side = 0; side < 2; side++) for (let j = 1; j < N; j++) si.hangers[side * (N - 1) + j - 1] = out.tension[L.hangers[side][j]] / 1e3;
    return target;
  }
  override exportCheckpoint(): StudioCheckpoint {
    throw new RangeError('The SI bridge has no resumable checkpoint in the Studio (its checkpoint format does not carry the model); export the recorded response instead.');
  }
  override restoreCheckpoint(): void {
    throw new RangeError('The SI bridge has no resumable checkpoint.');
  }
}
