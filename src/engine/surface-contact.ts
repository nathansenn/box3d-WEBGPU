/** Continuous feature queries for thin, linearly moving surfaces.
 * Positions use model units. A sweep returns uncertainty when its work limit is
 * exhausted; callers must refine the interval rather than accept a missed hit.
 */
export type SurfaceVec = [number, number, number];
type V = readonly [number, number, number];
const sub = (a: V, b: V): SurfaceVec => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot = (a: V, b: V): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a: V, b: V): SurfaceVec => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const mix = (a: V, b: V, t: number): SurfaceVec => [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const squaredDistance = (a: V, b: V): number => (a[0]-b[0])**2+(a[1]-b[1])**2+(a[2]-b[2])**2;

export interface TriangleClosest {
  point: SurfaceVec;
  weights: SurfaceVec;
  distanceSquared: number;
}

/** Orthogonal projection inside the face, otherwise the closest of its edges.
 * Collapsed faces remain valid edge/point distance queries.
 */
export function closestSurfaceTriangle(p: V, a: V, b: V, c: V): TriangleClosest {
  const ab=sub(b,a), ac=sub(c,a), ap=sub(p,a), n=cross(ab,ac), nn=dot(n,n);
  if(nn>0){
    const v=dot(cross(ap,ac),n)/nn, w=dot(cross(ab,ap),n)/nn;
    if(v>=0&&w>=0&&v+w<=1){
      const q:SurfaceVec=[a[0]+ab[0]*v+ac[0]*w,a[1]+ab[1]*v+ac[1]*w,a[2]+ab[2]*v+ac[2]*w];
      return {point:q,weights:[1-v-w,v,w],distanceSquared:squaredDistance(p,q)};
    }
  }
  const vertices=[a,b,c];let best:TriangleClosest={point:[...a],weights:[1,0,0],distanceSquared:squaredDistance(p,a)};
  for(let edge=0;edge<3;edge++){
    const next=(edge+1)%3, x=vertices[edge], y=vertices[next], d=sub(y,x), lengthSquared=dot(d,d);
    const t=lengthSquared?clamp01(dot(sub(p,x),d)/lengthSquared):0, q=mix(x,y,t), distanceSquared=squaredDistance(p,q);
    if(distanceSquared<best.distanceSquared){
      const weights:SurfaceVec=[0,0,0];weights[edge]=1-t;weights[next]=t;
      best={point:q,weights,distanceSquared};
    }
  }
  return best;
}

export interface EdgeClosest {
  a: SurfaceVec;
  b: SurfaceVec;
  fractionA: number;
  fractionB: number;
  distanceSquared: number;
}

export function closestSurfaceEdges(a0: V, a1: V, b0: V, b1: V): EdgeClosest {
  const da=sub(a1,a0), db=sub(b1,b0), r=sub(a0,b0), aa=dot(da,da), bb=dot(db,db), ab=dot(da,db), ar=dot(da,r), br=dot(db,r);
  let s=0,t=0;
  if(aa===0)t=bb?clamp01(br/bb):0;
  else if(bb===0)s=clamp01(-ar/aa);
  else{
    const den=aa*bb-ab*ab;
    s=den>0?clamp01((ab*br-ar*bb)/den):0;t=(ab*s+br)/bb;
    if(t<0){t=0;s=clamp01(-ar/aa);}
    else if(t>1){t=1;s=clamp01((ab-ar)/aa);}
  }
  const a=mix(a0,a1,s), b=mix(b0,b1,t);
  return {a,b,fractionA:s,fractionB:t,distanceSquared:squaredDistance(a,b)};
}

export interface SurfaceSweep<T> {
  /** Fraction of the caller's interval, in [0,1]. */
  time: number;
  closest: T;
  iterations: number;
  converged: boolean;
}

function advanceSurface<T extends {distanceSquared:number}>(at:(time:number)=>T, closingBound:(closest:T,distance:number)=>number, separation:number, tolerance:number, maxIterations:number):SurfaceSweep<T>|null {
  if(!Number.isFinite(separation)||separation<0||!Number.isFinite(tolerance)||tolerance<=0||!Number.isInteger(maxIterations)||maxIterations<1)throw new RangeError('Invalid surface sweep limits');
  let time=0;
  for(let iteration=1;iteration<=maxIterations;iteration++){
    const closest=at(time), distance=Math.sqrt(closest.distanceSquared);
    if(!Number.isFinite(distance))throw new RangeError('Non-finite surface motion');
    if(distance<=separation+tolerance)return {time,closest,iterations:iteration,converged:true};
    const speedBound=closingBound(closest,distance);
    if(!Number.isFinite(speedBound)||speedBound<0)throw new RangeError('Non-finite surface motion');
    if(speedBound===0)return null;
    const advance=(distance-separation)/speedBound;
    if(advance>1-time)return null;
    if(iteration===maxIterations||time+advance===time)return {time,closest,iterations:iteration,converged:false};
    time+=advance;
  }
  throw new Error('Unreachable surface sweep state');
}

/** The closest-feature normal separates the two convex features at the query
 * time. Their endpoint trajectories are linear: the largest closing projection
 * bounds every convex combination on this fixed plane. Tangential speed cannot
 * close it. This is much tighter than a Euclidean speed bound for grazing paths.
 * We rebuild the separating plane after each conservative advancement.
 */
export function sweepSurfacePointTriangle(start:readonly [V,V,V,V],end:readonly [V,V,V,V],separation:number,tolerance=1e-7,maxIterations=64):SurfaceSweep<TriangleClosest>|null {
  const motion=start.map((p,i)=>sub(end[i],p)),current=start.map(p=>[...p] as SurfaceVec);
  return advanceSurface(t=>{
    for(let i=0;i<4;i++)for(let k=0;k<3;k++)current[i][k]=start[i][k]+motion[i][k]*t;
    return closestSurfaceTriangle(current[0],current[1],current[2],current[3]);
  },(closest,distance)=>{
    const n:SurfaceVec=[(current[0][0]-closest.point[0])/distance,(current[0][1]-closest.point[1])/distance,(current[0][2]-closest.point[2])/distance];
    let closing=0;for(let i=1;i<4;i++)closing=Math.max(closing,(motion[i][0]-motion[0][0])*n[0]+(motion[i][1]-motion[0][1])*n[1]+(motion[i][2]-motion[0][2])*n[2]);
    return closing;
  },separation,tolerance,maxIterations);
}

export function sweepSurfaceEdges(start:readonly [V,V,V,V],end:readonly [V,V,V,V],separation:number,tolerance=1e-7,maxIterations=64):SurfaceSweep<EdgeClosest>|null {
  const motion=start.map((p,i)=>sub(end[i],p)),current=start.map(p=>[...p] as SurfaceVec);
  return advanceSurface(t=>{
    for(let i=0;i<4;i++)for(let k=0;k<3;k++)current[i][k]=start[i][k]+motion[i][k]*t;
    return closestSurfaceEdges(current[0],current[1],current[2],current[3]);
  },(closest,distance)=>{
    const n:SurfaceVec=[(closest.a[0]-closest.b[0])/distance,(closest.a[1]-closest.b[1])/distance,(closest.a[2]-closest.b[2])/distance];
    let closing=0;
    for(let a=0;a<2;a++)for(let b=2;b<4;b++)closing=Math.max(closing,(motion[b][0]-motion[a][0])*n[0]+(motion[b][1]-motion[a][1])*n[1]+(motion[b][2]-motion[a][2])*n[2]);
    return closing;
  },separation,tolerance,maxIterations);
}

export interface SurfaceParticle { p: SurfaceVec; inverseMass: number; }

/** Solve one signed separation with its complete mass-weighted Jacobian.
 * Coefficients sum to zero for point/triangle and edge/edge contacts, preserving
 * the centre of mass. Positive separation cannot create an attractive impulse.
 */
export function projectSurfaceContact(particles:readonly SurfaceParticle[],coefficients:readonly number[],normal:V,separation:number):number {
  if(particles.length!==coefficients.length)throw new RangeError('Surface contact coefficient count');
  let gap=0,weight=0;
  for(let i=0;i<particles.length;i++){
    gap+=coefficients[i]*dot(particles[i].p,normal);
    weight+=particles[i].inverseMass*coefficients[i]*coefficients[i];
  }
  if(gap>=separation||weight===0)return 0;
  const lambda=(separation-gap)/weight;
  for(let i=0;i<particles.length;i++)for(let k=0;k<3;k++)particles[i].p[k]+=normal[k]*lambda*coefficients[i]*particles[i].inverseMass;
  return lambda;
}

export type SurfaceTriangle = readonly [number,number,number];
type Bounds = [number,number,number,number,number,number];
export interface SurfaceContact {
  indices: [number,number,number,number];
  coefficients: [number,number,number,number];
  normal: SurfaceVec;
  time: number;
  kind: 'point-triangle'|'edge-edge';
}
export interface SurfaceContactReport {
  contacts: SurfaceContact[];
  pointTriangleCandidates: number;
  edgeCandidates: number;
  sweepIterations: number;
  unresolved: number;
  firstUnresolved?: {kind:SurfaceContact['kind'];indices:number[];start:SurfaceVec[];end:SurfaceVec[];time:number;distance:number};
}

const boundsOverlap=(a:Bounds,b:Bounds):boolean=>a[0]<=b[3]&&a[3]>=b[0]&&a[1]<=b[4]&&a[4]>=b[1]&&a[2]<=b[5]&&a[5]>=b[2];
function motionBounds(ids:readonly number[],start:readonly V[],end:readonly V[],padding=0,bounds:Bounds=[0,0,0,0,0,0]):Bounds {
  bounds[0]=bounds[1]=bounds[2]=Infinity;bounds[3]=bounds[4]=bounds[5]=-Infinity;
  for(const id of ids)for(let k=0;k<3;k++){
    bounds[k]=Math.min(bounds[k],start[id][k]-padding,end[id][k]-padding);
    bounds[k+3]=Math.max(bounds[k+3],start[id][k]+padding,end[id][k]+padding);
  }
  return bounds;
}

function containsBounds(outer:Bounds,inner:Bounds):boolean {
  return outer[0]<=inner[0]&&outer[1]<=inner[1]&&outer[2]<=inner[2]&&outer[3]>=inner[3]&&outer[4]>=inner[4]&&outer[5]>=inner[5];
}
function expandBounds(b:Bounds,margin:number):Bounds {
  return [b[0]-margin,b[1]-margin,b[2]-margin,b[3]+margin,b[4]+margin,b[5]+margin];
}
interface SurfaceQuery {bounds:Bounds;ids:number[];requireDynamic:boolean;minLeaf:number}

/** Preorder AABB hierarchy with exact Float64 bounds and bounded temporal
 * candidate reuse. Cached candidates cover enlarged query/feature envelopes;
 * every query still filters them against the current exact swept bounds.
 * An escaping feature or changed mass mask invalidates the entire cache before
 * querying. No cached contact, normal or time of impact enters the narrow phase.
 */
class SurfaceTree {
  private boxes:Float64Array;
  private leaves:Int32Array;
  private escape:Uint32Array;
  private moving:Uint8Array;
  private maxLeaf:Int32Array;
  private envelopes:Bounds[]=[];
  private exact:Bounds[]=[];
  private dynamic:Uint8Array;
  private margin=-1;
  private queries:(SurfaceQuery|null|undefined)[]=[];
  private cachedPairs=0;
  private maxCachedPairs:number;
  private maxCachedQueries:number;
  private result:number[]=[];
  constructor(bounds:Bounds[]){
    if(bounds.length>0x7fffffff)throw new RangeError('Surface hierarchy capacity exceeded');
    const count=bounds.length?bounds.length*2-1:0;
    this.boxes=new Float64Array(count*6);this.leaves=new Int32Array(count);this.leaves.fill(-1);
    this.escape=new Uint32Array(count);this.moving=new Uint8Array(count);this.maxLeaf=new Int32Array(count);
    this.dynamic=new Uint8Array(bounds.length);
    // Dense overlapping input falls back to uncached traversal rather than
    // retaining a quadratic pair table. Query records are bounded as well.
    this.maxCachedPairs=Math.max(256,bounds.length*32);this.maxCachedQueries=Math.max(256,bounds.length*4);
    let next=0;
    const build=(ids:number[]):void=>{
      if(!ids.length)return;
      const id=next++,offset=id*6,b:Bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
      let maximum=-1;
      for(const i of ids){maximum=Math.max(maximum,i);for(let k=0;k<3;k++){b[k]=Math.min(b[k],bounds[i][k]);b[k+3]=Math.max(b[k+3],bounds[i][k+3]);}}
      this.maxLeaf[id]=maximum;for(let k=0;k<6;k++)this.boxes[offset+k]=b[k];
      if(ids.length===1)this.leaves[id]=ids[0];
      else{
        let axis=0;for(let k=1;k<3;k++)if(b[k+3]-b[k]>b[axis+3]-b[axis])axis=k;
        ids.sort((a,b)=>(bounds[a][axis]/2+bounds[a][axis+3]/2)-(bounds[b][axis]/2+bounds[b][axis+3]/2)||a-b);
        const middle=ids.length>>>1;build(ids.slice(0,middle));build(ids.slice(middle));
      }
      this.escape[id]=next;
    };
    build(bounds.map((_,i)=>i));
  }
  refit(bounds:Bounds[],dynamic:readonly boolean[],margin:number):void {
    this.exact=bounds;
    let escaped=this.envelopes.length!==bounds.length||margin!==this.margin,changed=false;
    for(let i=0;i<bounds.length;i++){
      if(!escaped&&!containsBounds(this.envelopes[i],bounds[i]))escaped=true;
      const moving=Number(dynamic[i]);if(moving!==this.dynamic[i]){this.dynamic[i]=moving;changed=true;}
    }
    if(!escaped&&!changed)return;
    this.queries.length=0;this.cachedPairs=0;this.margin=margin;
    if(escaped)this.envelopes=bounds.map(b=>expandBounds(b,margin));
    const boxes=this.boxes;
    for(let i=this.leaves.length-1;i>=0;i--){
      const offset=i*6,leaf=this.leaves[i];
      if(leaf>=0){if(escaped)for(let k=0;k<6;k++)boxes[offset+k]=this.envelopes[leaf][k];this.moving[i]=this.dynamic[leaf];}
      else{
        const left=i+1,right=this.escape[left],a=left*6,c=right*6;
        this.moving[i]=this.moving[left]||this.moving[right];
        if(escaped)for(let k=0;k<3;k++){boxes[offset+k]=Math.min(boxes[a+k],boxes[c+k]);boxes[offset+k+3]=Math.max(boxes[a+k+3],boxes[c+k+3]);}
      }
    }
  }
  private collect(b:Bounds,requireDynamic:boolean,minLeaf:number):number[]{
    const boxes=this.boxes,result=this.result;result.length=0;
    for(let id=0;id<this.leaves.length;){
      const offset=id*6;
      if(this.maxLeaf[id]<minLeaf||requireDynamic&&!this.moving[id]||b[0]>boxes[offset+3]||b[3]<boxes[offset]||b[1]>boxes[offset+4]||b[4]<boxes[offset+1]||b[2]>boxes[offset+5]||b[5]<boxes[offset+2]){
        id=this.escape[id];continue;
      }
      if(this.leaves[id]>=0)result.push(this.leaves[id]);
      id++;
    }
    return result.sort((a,b)=>a-b);
  }
  query(b:Bounds,requireDynamic:boolean,minLeaf:number,queryId:number):number[]{
    let entry=this.queries[queryId],ids:number[];
    if(entry&&entry.requireDynamic===requireDynamic&&entry.minLeaf===minLeaf&&containsBounds(entry.bounds,b))ids=entry.ids;
    else{
      if(entry)this.cachedPairs-=entry.ids.length;
      const cache=queryId<this.maxCachedQueries&&entry!==null&&this.cachedPairs<this.maxCachedPairs;
      const query=cache?expandBounds(b,this.margin):b;
      ids=this.collect(query,requireDynamic,minLeaf);
      if(cache&&this.cachedPairs+ids.length<=this.maxCachedPairs){
        ids=ids.slice();this.queries[queryId]={bounds:query,ids,requireDynamic,minLeaf};this.cachedPairs+=ids.length;
      }else if(queryId<this.maxCachedQueries)this.queries[queryId]=null;
    }
    // The hierarchy and cache use larger envelopes only for candidate discovery.
    // Exact bounds retain the previous candidate counts and sorted contact order.
    const result=this.result;let count=0;
    for(let i=0;i<ids.length;i++){const id=ids[i];if(boundsOverlap(b,this.exact[id]))result[count++]=id;}
    result.length=count;return result;
  }
}

function contactNormal(delta:V,previous:V,fallback:V,relativeMotion:V):SurfaceVec {
  let chosen=delta,length=Math.hypot(...chosen);
  if(length<1e-12){chosen=previous;length=Math.hypot(...chosen);}
  if(length<1e-12){
    chosen=fallback;length=Math.hypot(...chosen);
    if(length<1e-12){chosen=sub([0,0,0],relativeMotion);length=Math.hypot(...chosen);}
    if(length<1e-12)return [0,1,0];
    if(dot(chosen,relativeMotion)>0)chosen=[-chosen[0],-chosen[1],-chosen[2]];
  }
  return [chosen[0]/length,chosen[1]/length,chosen[2]/length];
}

/** Surface topology is immutable between calls to setTriangles. Rebuild it
 * after a tear so deleted faces cannot remain invisible collision barriers.
 */
export class SurfaceContactIndex {
  private triangles:SurfaceTriangle[]=[];
  private edges:[number,number][]=[];
  private triangleBounds:Bounds[]=[];
  private edgeBounds:Bounds[]=[];
  private triangleDynamic:boolean[]=[];
  private edgeDynamic:boolean[]=[];
  private queryBounds:Bounds=[0,0,0,0,0,0];
  private queryPoint=[0];
  private triangleTree?:SurfaceTree;
  private edgeTree?:SurfaceTree;
  constructor(triangles:readonly SurfaceTriangle[]){
    this.setTriangles(triangles);
  }
  setTriangles(triangles:readonly SurfaceTriangle[]):void {
    const next=triangles.map(t=>[...t] as SurfaceTriangle);
    const edges=new Map<string,[number,number]>();
    for(const t of next){
      if(t.length!==3||t.some(i=>!Number.isSafeInteger(i)||i<0)||new Set(t).size!==3)throw new RangeError('Invalid surface triangle indices');
      for(let i=0;i<3;i++){
        const a=Math.min(t[i],t[(i+1)%3]),b=Math.max(t[i],t[(i+1)%3]);edges.set(a+'/'+b,[a,b]);
      }
    }
    this.triangleTree=undefined;this.edgeTree=undefined;
    this.triangleBounds=[];this.edgeBounds=[];this.triangleDynamic=[];this.edgeDynamic=[];
    this.triangles=next;
    this.edges=[...edges.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  }
  detect(start:readonly V[],end:readonly V[],inverseMass:readonly number[],separation:number,tolerance=1e-7,maxIterations=64,pointEnabled?:readonly boolean[],sweepSeparation=separation):SurfaceContactReport {
    if(start.length!==end.length||start.length!==inverseMass.length||!Number.isFinite(separation)||separation<=0)throw new RangeError('Surface motion dimensions or separation');
    if(!Number.isFinite(tolerance)||tolerance<=0||!Number.isInteger(maxIterations)||maxIterations<1)throw new RangeError('Invalid surface sweep limits');
    if(!Number.isFinite(sweepSeparation)||sweepSeparation<0||sweepSeparation>separation)throw new RangeError('Surface sweep separation');
    if(pointEnabled&&pointEnabled.length!==start.length)throw new RangeError('Surface point participation count');
    for(let i=0;i<start.length;i++)if(start[i].length!==3||end[i].length!==3||!start[i].every(Number.isFinite)||!end[i].every(Number.isFinite)||!Number.isFinite(inverseMass[i])||inverseMass[i]<0)throw new RangeError('Invalid surface particle');
    for(const t of this.triangles)if(t.some(i=>i>=start.length))throw new RangeError('Surface index outside motion array');
    const report:SurfaceContactReport={contacts:[],pointTriangleCandidates:0,edgeCandidates:0,sweepIterations:0,unresolved:0};
    const padding=separation+tolerance,triangleBounds=this.triangleBounds,dynamicTriangles=this.triangleDynamic;
    for(let i=0;i<this.triangles.length;i++){
      const t=this.triangles[i];triangleBounds[i]=motionBounds(t,start,end,padding,triangleBounds[i]);dynamicTriangles[i]=t.some(i=>inverseMass[i]>0);
    }
    if(!this.triangleTree)this.triangleTree=new SurfaceTree(triangleBounds);
    // Envelope size changes search work only; narrow-phase separation is unchanged.
    const margin=Math.min(Number.MAX_VALUE/8,Math.max(separation,tolerance))*8;
    this.triangleTree.refit(triangleBounds,dynamicTriangles,margin);
    for(let point=0;point<start.length;point++){
      if(pointEnabled&&!pointEnabled[point])continue;
      this.queryPoint[0]=point;
      for(const id of this.triangleTree.query(motionBounds(this.queryPoint,start,end,0,this.queryBounds),inverseMass[point]===0,0,point)){
        const triangle=this.triangles[id];if(triangle.includes(point)||!inverseMass[point]&&!triangle.some(i=>inverseMass[i]))continue;
        const indices:[number,number,number,number]=[point,...triangle],a=indices.map(i=>start[i]) as [V,V,V,V],b=indices.map(i=>end[i]) as [V,V,V,V];
        report.pointTriangleCandidates++;let hit=sweepSurfacePointTriangle(a,b,sweepSeparation,tolerance,maxIterations);
        // Proximity response has finite thickness; CCD guards actual crossings at
        // a smaller separation. Keeping these separate avoids thousands of tiny
        // advancement steps when a resting fold skims the proximity boundary.
        if(!hit&&sweepSeparation<separation){
          const endClosest=closestSurfaceTriangle(...b);
          if(endClosest.distanceSquared<=(separation+tolerance)**2)hit={time:1,closest:endClosest,iterations:0,converged:true};
          else{const initial=closestSurfaceTriangle(...a);if(initial.distanceSquared<=(separation+tolerance)**2)hit={time:0,closest:initial,iterations:0,converged:true};}
        }
        if(!hit)continue;
        report.sweepIterations+=hit.iterations;if(!hit.converged){report.unresolved++;report.firstUnresolved??={kind:'point-triangle',indices,start:a.map(p=>[...p]),end:b.map(p=>[...p]),time:hit.time,distance:Math.sqrt(hit.closest.distanceSquared)};continue;}
        const weights=hit.closest.weights,p=mix(a[0],b[0],hit.time),before=closestSurfaceTriangle(a[0],a[1],a[2],a[3]);
        const motion=sub(b[0],a[0]);for(let j=0;j<3;j++)for(let k=0;k<3;k++)motion[k]-=weights[j]*(b[j+1][k]-a[j+1][k]);
        const normal=contactNormal(sub(p,hit.closest.point),sub(a[0],before.point),cross(sub(a[2],a[1]),sub(a[3],a[1])),motion);
        report.contacts.push({indices,coefficients:[1,-weights[0],-weights[1],-weights[2]],normal,time:hit.time,kind:'point-triangle'});
      }
    }
    const edgeBounds=this.edgeBounds,dynamicEdges=this.edgeDynamic;
    for(let i=0;i<this.edges.length;i++){
      const e=this.edges[i];edgeBounds[i]=motionBounds(e,start,end,padding,edgeBounds[i]);dynamicEdges[i]=e.some(i=>inverseMass[i]>0);
    }
    if(!this.edgeTree)this.edgeTree=new SurfaceTree(edgeBounds);
    this.edgeTree.refit(edgeBounds,dynamicEdges,margin);
    for(let left=0;left<this.edges.length;left++)for(const right of this.edgeTree.query(motionBounds(this.edges[left],start,end,0,this.queryBounds),!dynamicEdges[left],left+1,left)){
      if(right<=left)continue;const ea=this.edges[left],eb=this.edges[right];
      if(ea.some(i=>eb.includes(i))||![...ea,...eb].some(i=>inverseMass[i]))continue;
      const indices:[number,number,number,number]=[...ea,...eb],a=indices.map(i=>start[i]) as [V,V,V,V],b=indices.map(i=>end[i]) as [V,V,V,V];
      report.edgeCandidates++;let hit=sweepSurfaceEdges(a,b,sweepSeparation,tolerance,maxIterations);
      if(!hit&&sweepSeparation<separation){
        const endClosest=closestSurfaceEdges(...b);
        if(endClosest.distanceSquared<=(separation+tolerance)**2)hit={time:1,closest:endClosest,iterations:0,converged:true};
        else{const initial=closestSurfaceEdges(...a);if(initial.distanceSquared<=(separation+tolerance)**2)hit={time:0,closest:initial,iterations:0,converged:true};}
      }
      if(!hit)continue;
      report.sweepIterations+=hit.iterations;if(!hit.converged){report.unresolved++;report.firstUnresolved??={kind:'edge-edge',indices,start:a.map(p=>[...p]),end:b.map(p=>[...p]),time:hit.time,distance:Math.sqrt(hit.closest.distanceSquared)};continue;}
      const s=hit.closest.fractionA,t=hit.closest.fractionB,coefficients:[number,number,number,number]=[1-s,s,t-1,-t],before=closestSurfaceEdges(...a),motion:SurfaceVec=[0,0,0];
      for(let j=0;j<4;j++)for(let k=0;k<3;k++)motion[k]+=coefficients[j]*(b[j][k]-a[j][k]);
      const normal=contactNormal(sub(hit.closest.a,hit.closest.b),sub(before.a,before.b),cross(sub(a[1],a[0]),sub(a[3],a[2])),motion);
      report.contacts.push({indices,coefficients,normal,time:hit.time,kind:'edge-edge'});
    }
    return report;
  }
}
