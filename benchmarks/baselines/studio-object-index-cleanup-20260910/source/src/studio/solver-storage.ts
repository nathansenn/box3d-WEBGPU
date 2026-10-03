import type { Link, LinkKind, Particle, Vec } from './physics.ts';

export const STUDIO_LINK_KINDS = ['warp','weft','shear','bend','cable','hanger','deck','crossbeam'] as const satisfies readonly LinkKind[];
export const BEND_LINK = STUDIO_LINK_KINDS.indexOf('bend');

/** Ordinary Array views retain indexed writes, JSON output and full Number precision.
 * Only compatibility consumers allocate these objects; solver loops use the buffers.
 * The authored topology has fixed sizes. Adding/removing nodes or links is not supported.
 */
const vectorBindings=new WeakMap<object,{data:Float64Array;offset:number}>();
const vectorDescriptors:PropertyDescriptorMap={};
for(let axis=0;axis<3;axis++)vectorDescriptors[axis]={enumerable:true,configurable:true,
  get(this:object){const b=vectorBindings.get(this)!;return b.data[b.offset+axis];},
  set(this:object,value:number){const b=vectorBindings.get(this)!;b.data[b.offset+axis]=value;},
};
function vectorView(data: Float64Array, offset: number): Vec {
  const result:Vec=[0,0,0];vectorBindings.set(result,{data,offset});
  return Object.defineProperties(result,vectorDescriptors);
}
function writeVector(data: Float64Array, offset: number, value: Vec): void {
  const x=value[0],y=value[1],z=value[2];
  data[offset]=x;data[offset+1]=y;data[offset+2]=z;
}
type ParticleBinding={store:StudioParticles;index:number;p?:Vec;prev?:Vec;rest?:Vec};
const particleBindings=new WeakMap<object,ParticleBinding>();
function particleVector(field:'p'|'prev'|'rest',buffer:'positions'|'previous'|'rest'):PropertyDescriptor {
  return {enumerable:true,configurable:true,
    get(this:object){const b=particleBindings.get(this)!;return b[field]??=vectorView(b.store[buffer],b.index*3);},
    set(this:object,value:Vec){const b=particleBindings.get(this)!;writeVector(b.store[buffer],b.index*3,value);},
  };
}
function particleNumber(field:'inverseMass'|'strain'):PropertyDescriptor {
  return {enumerable:true,configurable:true,
    get(this:object){const b=particleBindings.get(this)!;return b.store[field][b.index];},
    set(this:object,value:number){const b=particleBindings.get(this)!;b.store[field][b.index]=value;},
  };
}
const particleDescriptors:PropertyDescriptorMap={p:particleVector('p','positions'),prev:particleVector('prev','previous'),
  rest:particleVector('rest','rest'),inverseMass:particleNumber('inverseMass'),strain:particleNumber('strain')};
const linkBindings=new WeakMap<object,{store:StudioLinks;index:number}>();
function linkNumber(field:'a'|'b'|'rest'|'original'|'stiffness'|'threshold'|'damage'|'plastic'):PropertyDescriptor {
  return {enumerable:true,configurable:true,
    get(this:object){const b=linkBindings.get(this)!;return b.store[field][b.index];},
    set(this:object,value:number){const b=linkBindings.get(this)!;b.store[field][b.index]=value;},
  };
}
// Share accessors across specimens; creating one function closure per field per link
// would overwhelm the memory saved by packing when compatibility views are requested.
const linkDescriptors:PropertyDescriptorMap={a:linkNumber('a'),b:linkNumber('b'),rest:linkNumber('rest'),original:linkNumber('original'),
  stiffness:linkNumber('stiffness'),threshold:linkNumber('threshold'),damage:linkNumber('damage'),plastic:linkNumber('plastic'),
  kind:{enumerable:true,configurable:true,
    get(this:object){const b=linkBindings.get(this)!;return STUDIO_LINK_KINDS[b.store.kind[b.index]];},
    set(this:object,value:LinkKind){const b=linkBindings.get(this)!;b.store.kind[b.index]=STUDIO_LINK_KINDS.indexOf(value);}},
  broken:{enumerable:true,configurable:true,
    get(this:object){const b=linkBindings.get(this)!;return b.store.broken[b.index]!==0;},
    set(this:object,value:boolean){const b=linkBindings.get(this)!;b.store.broken[b.index]=value?1:0;}},
  dependencies:{enumerable:true,configurable:true,
    get(this:object){const b=linkBindings.get(this)!;return b.store.dependencies[b.index];},
    set(this:object,value:number[]){const b=linkBindings.get(this)!;b.store.dependencies[b.index]=value;}},
};

/** Float64 deliberately matches the former JavaScript Number state, not render Float32. */
export class StudioParticles {
  readonly count: number;
  readonly positions: Float64Array;
  readonly previous: Float64Array;
  readonly rest: Float64Array;
  readonly inverseMass: Float64Array;
  readonly strain: Float64Array;
  private views: Particle[] | undefined;

  constructor(count: number) {
    this.count=count;
    this.positions=new Float64Array(count*3);this.previous=new Float64Array(count*3);this.rest=new Float64Array(count*3);
    this.inverseMass=new Float64Array(count);this.strain=new Float64Array(count);
  }

  get compatibilityViews(): Particle[] {
    return this.views??=Array.from({length:this.count},(_,i)=>{
      const view=Object.defineProperties({},particleDescriptors) as Particle;
      particleBindings.set(view,{store:this,index:i});return view;
    });
  }

  exportState(): Particle[] {
    return Array.from({length:this.count},(_,i)=>{
      const j=i*3,p=this.positions,v=this.previous,r=this.rest;
      return {p:[p[j],p[j+1],p[j+2]],prev:[v[j],v[j+1],v[j+2]],rest:[r[j],r[j+1],r[j+2]],inverseMass:this.inverseMass[i],strain:this.strain[i]};
    });
  }

  restoreState(nodes: readonly Particle[]): void {
    for(let i=0;i<this.count;i++) {
      const n=nodes[i],j=i*3;
      writeVector(this.positions,j,n.p);writeVector(this.previous,j,n.prev);writeVector(this.rest,j,n.rest);
      this.inverseMass[i]=n.inverseMass;this.strain[i]=n.strain;
    }
  }
}

export class StudioLinks {
  readonly count: number;
  readonly a: Uint32Array;
  readonly b: Uint32Array;
  readonly rest: Float64Array;
  readonly original: Float64Array;
  readonly stiffness: Float64Array;
  readonly threshold: Float64Array;
  readonly damage: Float64Array;
  readonly plastic: Float64Array;
  readonly kind: Uint8Array;
  readonly broken: Uint8Array;
  // Retain the small dependency lists so existing indexed/whole-list edits remain live.
  // Numeric constraint state is packed; no Link objects are read during projection.
  readonly dependencies: number[][];
  private views: Link[] | undefined;

  constructor(links: readonly Link[]) {
    const count=this.count=links.length;
    this.a=new Uint32Array(count);this.b=new Uint32Array(count);
    this.rest=new Float64Array(count);this.original=new Float64Array(count);this.stiffness=new Float64Array(count);
    this.threshold=new Float64Array(count);this.damage=new Float64Array(count);this.plastic=new Float64Array(count);
    this.kind=new Uint8Array(count);this.broken=new Uint8Array(count);
    this.dependencies=new Array(count);
    for(let i=0;i<count;i++) {
      const link=links[i];
      this.a[i]=link.a;this.b[i]=link.b;this.rest[i]=link.rest;this.original[i]=link.original;
      this.stiffness[i]=link.stiffness;this.threshold[i]=link.threshold;this.damage[i]=link.damage;this.plastic[i]=link.plastic;
      this.kind[i]=STUDIO_LINK_KINDS.indexOf(link.kind);this.broken[i]=link.broken?1:0;this.dependencies[i]=link.dependencies;
    }
  }

  get compatibilityViews(): Link[] {
    return this.views??=Array.from({length:this.count},(_,i)=>{
      const view=Object.defineProperties({},linkDescriptors) as Link;
      linkBindings.set(view,{store:this,index:i});return view;
    });
  }

  exportState(): Link[] {
    return Array.from({length:this.count},(_,i)=>({a:this.a[i],b:this.b[i],rest:this.rest[i],original:this.original[i],
      stiffness:this.stiffness[i],kind:STUDIO_LINK_KINDS[this.kind[i]],threshold:this.threshold[i],damage:this.damage[i],
      broken:this.broken[i]!==0,plastic:this.plastic[i],dependencies:[...this.dependencies[i]]}));
  }

  restoreState(links: readonly Link[]): void {
    for(let i=0;i<this.count;i++) {
      const link=links[i];this.rest[i]=link.rest;this.damage[i]=link.damage;this.broken[i]=link.broken?1:0;this.plastic[i]=link.plastic;
    }
  }
}
