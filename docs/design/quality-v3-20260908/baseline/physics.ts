/** Shared, dependency-free reduced failure model. Y up, right handed, model units.
 * Fixed-step position-based dynamics; these authored coefficients are not material test data.
 * Failure is driven by connection strain/damage, never by the animation clock.
 */
export type StudyId = 'canopy' | 'plate' | 'bridge';
export type Vec = [number, number, number];
export type LinkKind = 'warp' | 'weft' | 'shear' | 'bend' | 'cable' | 'hanger' | 'deck' | 'crossbeam';
export interface Particle { p: Vec; prev: Vec; rest: Vec; inverseMass: number; strain: number }
export interface Link {
  a: number; b: number; rest: number; original: number; stiffness: number;
  kind: LinkKind; threshold: number; damage: number; broken: boolean; plastic: number;
  dependencies: number[];
}
export interface Face { nodes: [number, number, number]; links: number[] }
export interface FailureEvent { time: number; type: 'yield' | 'break' | 'collapse'; message: string; connection: number }
export interface Response { time: number; load: number; deflection: number; strain: number; broken: number; damage: number; plastic: number; phase: string }
export interface Snapshot { positions: Float32Array; broken: Uint8Array; strains: Float32Array; punchY: number; response: Response }

export const STUDIES = {
  canopy: { id: 'canopy', title: 'Canopy load study', subtitle: 'Tensile membrane · pressure & wind', theme: 'precision',
    span: 10, depth: 8, supportY: 5.3, cols: 33, rows: 27, floor: 0.025,
    camera: [12.9, 12.8, 14.6] as Vec, target: [0, 3.1, 0] as Vec, fov: 43,
    secondCamera: [-12, 8, 12] as Vec, threshold: 0.22 },
  plate: { id: 'plate', title: 'Plate forming study', subtitle: 'Metal sheet · punch through fracture', theme: 'atelier',
    span: 5.2, depth: 4.4, supportY: 3.15, cols: 33, rows: 29, floor: 1.62,
    camera: [3.9, 6.2, 12.7] as Vec, target: [0, 3.5, 0] as Vec, fov: 38,
    secondCamera: [-7.5, 5.2, 8] as Vec, threshold: 0.30 },
  bridge: { id: 'bridge', title: 'Suspension cable study', subtitle: 'Footbridge · progressive connection failure', theme: 'observatory',
    span: 42, depth: 3.8, supportY: 4.8, cols: 37, rows: 4, floor: -1.4,
    camera: [-31, 13, 35] as Vec, target: [-4, 7, 0] as Vec, fov: 48,
    secondCamera: [30, 17, 30] as Vec, threshold: 0.005 },
} as const;

export const FIXED_DT = 1 / 120;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const cableHeight = (u: number) => 7.2 + 6.8 * (2 * u - 1) ** 2;
export function terrainHeight(x: number, z: number): number {
  const bank = Math.max(0, Math.abs(x) - 15.5);
  return -2.1 + Math.min(6, bank * .49) + Math.min(1, bank * .07) *
    (.5 * Math.sin(x * .17 + z * .22) + .27 * Math.sin(z * .41 - x * .3));
}

export class FailureSimulation {
  readonly id: StudyId;
  readonly nodes: Particle[] = [];
  readonly links: Link[] = [];
  readonly faces: Face[] = [];
  readonly events: FailureEvent[] = [];
  readonly supports: number[] = [];
  readonly config: typeof STUDIES[StudyId];
  time = 0;
  load = 0;
  targetLoad = .8;
  strength = 1;
  damping = .022;
  wind = .25;
  punchY = 3.7;
  topologyVersion = 0;
  maxStrain = 0;
  peakDeflection = 0;
  brokenCount = 0;
  yieldedCount = 0;
  private edgeMap = new Map<string, number>();
  private collapseRecorded = false;
  private firstYield = false;

  constructor(id: StudyId) {
    this.id = id;
    this.config = STUDIES[id];
    if (id === 'bridge') this.buildBridge(); else this.buildSurface();
  }

  private node(x: number, y: number, z: number, fixed = false, inverseMass = 1): number {
    const i = this.nodes.length;
    this.nodes.push({ p: [x,y,z], prev: [x,y,z], rest: [x,y,z], inverseMass: fixed ? 0 : inverseMass, strain: 0 });
    if (fixed) this.supports.push(i);
    return i;
  }

  private link(a: number, b: number, kind: LinkKind, stiffness: number, threshold: number, dependencies: number[] = []): number {
    const i = this.links.length;
    const rest = distance(this.nodes[a].p, this.nodes[b].p);
    this.links.push({ a,b,rest,original:rest,kind,stiffness,threshold,damage:0,broken:false,plastic:0,dependencies });
    this.edgeMap.set([Math.min(a,b),Math.max(a,b)].join(','),i);
    return i;
  }
  private edge(a: number, b: number): number { return this.edgeMap.get([Math.min(a,b),Math.max(a,b)].join(',')) ?? -1; }

  private buildSurface(): void {
    const {cols,rows,span,depth,supportY,threshold} = this.config;
    const plate = this.id === 'plate';
    for (let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const u=i/(cols-1), v=j/(rows-1);
      const fixed=plate ? (i===0||i===cols-1||j===0||j===rows-1) :
        (i===0||i===cols-1)&&(j===0||j===rows-1);
      const sag=plate ? 0 : .85 * (1 - Math.pow(2*u-1,2)*Math.pow(2*v-1,2));
      // Shaped, concave perimeter resembles a tensioned membrane, while all four corners stay on fixtures.
      const x=(u-.5)*span*(plate?1:1-.13*Math.sin(Math.PI*v));
      const z=(v-.5)*depth*(plate?1:1-.13*Math.sin(Math.PI*u));
      this.node(x,supportY-sag,z,fixed);
    }
    for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const n=j*cols+i;
      if(i<cols-1) this.link(n,n+1,'warp',.95,threshold);
      if(j<rows-1) this.link(n,n+cols,'weft',.95,threshold);
      if(i<cols-1&&j<rows-1) {
        this.link(n,n+cols+1,'shear',plate?.72:.46,threshold*1.15);
        this.link(n+1,n+cols,'shear',plate?.72:.46,threshold*1.15);
      }
    }
    for(let j=0;j<rows;j++) for(let i=0;i<cols;i++) {
      const n=j*cols+i;
      if(i<cols-2) this.link(n,n+2,'bend',plate?.45:.055,threshold*1.5,[this.edge(n,n+1),this.edge(n+1,n+2)]);
      if(j<rows-2) this.link(n,n+cols*2,'bend',plate?.45:.055,threshold*1.5,[this.edge(n,n+cols),this.edge(n+cols,n+cols*2)]);
      if(i<cols-1&&j<rows-1) {
        const a=n,b=n+1,c=n+cols,d=c+1;
        this.faces.push({nodes:[a,c,b],links:[this.edge(a,c),this.edge(c,b),this.edge(b,a)]});
        this.faces.push({nodes:[b,c,d],links:[this.edge(b,c),this.edge(c,d),this.edge(d,b)]});
      }
    }
  }

  private buildBridge(): void {
    const {cols,span,depth,supportY,threshold} = this.config;
    for(let i=0;i<cols;i++) {
      const u=i/(cols-1), x=(u-.5)*span, fixed=i===0||i===cols-1;
      this.node(x,supportY,-depth/2,fixed);
      this.node(x,supportY,depth/2,fixed);
      this.node(x,cableHeight(u),-depth/2,fixed,.25);
      this.node(x,cableHeight(u),depth/2,fixed,.25);
    }
    for(let i=0;i<cols;i++) {
      const n=i*4;
      this.link(n,n+1,'crossbeam',1,.65);
      for(let side=0;side<2;side++) {
        this.link(n+side,n+side+2,'hanger',.98,threshold*1.25);
        if(i<cols-1) {
          this.link(n+side+2,n+side+6,'cable',1,threshold);
          this.link(n+side,n+side+4,'deck',.95,threshold*1.6);
        }
      }
      if(i<cols-1) {
        this.link(n,n+5,'shear',.82,threshold*1.8);
        this.link(n+1,n+4,'shear',.82,threshold*1.8);
      }
    }
  }

  /** Positive load is a model acceleration (cloth/bridge) or punch travel (plate). */
  step(dt = FIXED_DT): void {
    if (!(dt > 0) || dt > .025 || !Number.isFinite(dt)) throw new RangeError('Use fixed simulation steps <= 0.025 s');
    this.time += dt;
    this.load += clamp(this.targetLoad-this.load,-dt*.55,dt*.55);
    this.punchY = Math.max(1.70,3.7-this.load*1.22);
    const plate=this.id==='plate', bridge=this.id==='bridge';
    this.maxStrain=0;
    const dt2=dt*dt, drag=1-clamp(this.damping,0,.2);
    for(let i=0;i<this.nodes.length;i++) {
      const n=this.nodes[i]; n.strain=0;
      if(n.inverseMass===0) continue;
      const old: Vec=[...n.p];
      const x=n.rest[0], z=n.rest[2];
      let ay=plate?-.2:bridge?-2.2:-1.4;
      let ax=0,az=0;
      if(bridge) {
        if(i%4<2) ay-=this.load*18*Math.exp(-(((x-2)/10)**2))*(i%4===1?1.18:1);
        az=this.wind*this.load*1.5*Math.sin(this.time*2+x*.14);
      } else if(!plate) {
        ay-=this.load*11.5*(.82+.18*Math.cos(x*.8)*Math.cos(z*.7));
        ax=this.wind*this.load*4*Math.sin(this.time*2.1+z*.25);
        az=this.wind*this.load*2*Math.cos(this.time*1.7+x*.4);
      }
      const acc=[ax,ay,az];
      for(let k=0;k<3;k++) {
        const velocity=clamp((n.p[k]-n.prev[k])*drag,-.25,.25);
        n.p[k]+=velocity+acc[k]*dt2;
        n.prev[k]=old[k];
      }
    }
    // Contact is applied before and during projection so the punch participates in the load path.
    this.collide();
    for(let iteration=0;iteration<12;iteration++) {
      // Alternate order reduces directional bias without randomizing reproducibility.
      for(let q=0;q<this.links.length;q++) {
        const idx=iteration%2?this.links.length-q-1:q, e=this.links[idx];
        if(e.broken) continue;
        if(e.dependencies.some(d=>d>=0&&this.links[d].broken)) { this.breakLink(idx,false); continue; }
        const a=this.nodes[e.a],b=this.nodes[e.b], sum=a.inverseMass+b.inverseMass;
        if(sum===0) continue;
        const dx=b.p[0]-a.p[0],dy=b.p[1]-a.p[1],dz=b.p[2]-a.p[2];
        const length=Math.hypot(dx,dy,dz);
        if(length<1e-9) continue;
        const elastic=Math.max(0,length/e.rest-1);
        const total=Math.max(0,length/e.original-1);
        if(iteration===0) {
          const strain=plate?total:elastic;
          a.strain=Math.max(a.strain,strain); b.strain=Math.max(b.strain,strain);
          this.maxStrain=Math.max(this.maxStrain,strain);
          const threshold=e.threshold*this.strength;
          if(strain>threshold*.65) e.damage=Math.min(1,e.damage+dt*2.4*Math.pow(strain/threshold,2));
          if(strain>threshold*1.65||e.damage>=1) { this.breakLink(idx,true); continue; }
          if(plate&&elastic>.025*this.strength&&e.kind!=='bend') {
            e.rest += Math.min(length-e.rest,e.original*.006);
            if(e.plastic===0) this.yieldedCount++;
            e.plastic=e.rest/e.original-1;
            if(!this.firstYield) {
              this.firstYield=true;
              this.events.push({time:this.time,type:'yield',message:'Plastic strain begins · permanent set',connection:idx});
            }
          }
        }
        const corr=(length-e.rest)/length*e.stiffness/sum;
        const delta=[dx,dy,dz];
        for(let k=0;k<3;k++) {
          a.p[k]+=delta[k]*corr*a.inverseMass;
          b.p[k]-=delta[k]*corr*b.inverseMass;
        }
      }
      this.collide();
    }
    const def=this.deflection();
    this.peakDeflection=Math.max(this.peakDeflection,def);
    if(!this.collapseRecorded&&this.brokenCount>0&&def>this.config.supportY*(plate?.34:.58)) {
      this.collapseRecorded=true;
      this.events.push({time:this.time,type:'collapse',message:bridge?'Deck support lost · progressive collapse':plate?'Punch penetration · detached fragments':'Membrane support lost · fabric falling',connection:-1});
    }
  }

  private collide(): void {
    for(const n of this.nodes) {
      if(n.inverseMass===0) { n.p[0]=n.rest[0];n.p[1]=n.rest[1];n.p[2]=n.rest[2];continue; }
      if(this.id==='plate'&&Math.hypot(n.p[0],n.p[2])<.86&&n.p[1]>this.punchY) n.p[1]=this.punchY;
      const ground=this.id==='bridge'?Math.max(this.config.floor,terrainHeight(n.p[0],n.p[2])+.08):this.config.floor;
      if(n.p[1]<ground) {
        n.p[1]=ground;
        n.prev[0]+=(n.p[0]-n.prev[0])*.25;
        n.prev[2]+=(n.p[2]-n.prev[2])*.25;
        n.prev[1]=ground;
      }
    }
  }
  private breakLink(index: number, event: boolean): void {
    const e=this.links[index];
    if(e.broken) return;
    e.broken=true; e.damage=1;this.brokenCount++;this.topologyVersion++;
    // Event coalescing keeps the UI useful; complete broken topology is stored in snapshots.
    const last=this.events[this.events.length-1];
    if(event&&(!last||last.type!=='break'||this.time-last.time>.22)) {
      this.events.push({time:this.time,type:'break',message:`${e.kind==='warp'||e.kind==='weft'?'Surface':e.kind[0].toUpperCase()+e.kind.slice(1)} connection ruptured`,connection:index});
    }
  }
  deflection(): number {
    let max=0;
    for(let i=0;i<this.nodes.length;i++) {
      if(this.id==='bridge'&&i%4>1) continue;
      max=Math.max(max,this.nodes[i].rest[1]-this.nodes[i].p[1]);
    }
    return max;
  }
  response(): Response {
    let damage=0,plastic=0;
    for(const e of this.links) { damage=Math.max(damage,e.damage);plastic=Math.max(plastic,e.plastic); }
    return {time:this.time,load:this.load,deflection:this.deflection(),strain:this.maxStrain,
      broken:this.brokenCount,damage,plastic,
      phase:this.collapseRecorded?(this.id==='plate'?'Perforated':'Collapsed'):this.brokenCount?'Fracturing':this.firstYield?'Plastic deformation':damage>.05?'Damage accumulating':this.load>.02?'Elastic response':'Ready'};
  }
  activeIndices(): number[] {
    const out:number[]=[];
    for(const f of this.faces) if(f.links.every(i=>i<0||!this.links[i].broken)) out.push(...f.nodes);
    return out;
  }
  snapshot(): Snapshot {
    return {positions:Float32Array.from(this.nodes.flatMap(n=>n.p)),broken:Uint8Array.from(this.links.map(e=>e.broken?1:0)),
      strains:Float32Array.from(this.nodes.map(n=>n.strain)),punchY:this.punchY,response:this.response()};
  }
}
