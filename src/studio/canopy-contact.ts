import {SurfaceContactIndex,projectSurfaceContact,type SurfaceVec,type SurfaceTriangle,type SurfaceContact,type SurfaceContactReport} from '../engine/surface-contact.ts';
import {canopyRig,canopyRigSurface} from './canopy-rig.ts';
interface Node {p:SurfaceVec;prev:SurfaceVec;rest:SurfaceVec;inverseMass:number}
export const CANOPY_CONTACT = Object.freeze({separation:.003,sweepSeparation:1e-6,tolerance:1e-7,residualTolerance:2e-6,maxPasses:16,maxSweepIterations:1024,floorFriction:.28,attachmentRadius:.09});
export interface CanopyContactStats {contacts:number;passes:number;candidates:number;unresolved:number;maxCorrection:number;activeFaces:number}
const dot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
/** Contact post-processing of the candidate PBD displacement. CCD checks the
 * linear trajectory from the accepted start pose, including contact corrections.
 * Internal projection iterates are solver guesses, not additional time samples.
 * Work exhaustion rejects the caller's tick; uncertainty is never called a miss.
 */
export class CanopyContactSolver {
  readonly positions:SurfaceVec[];
  readonly start:SurfaceVec[];
  readonly inverseMass:number[];
  readonly particles:{p:SurfaceVec;inverseMass:number}[];
  private index=new SurfaceContactIndex([]);
  private rigidTriangles:SurfaceTriangle[];
  private nodes:readonly Node[];
  private ground:number;
  private enabled:boolean[];
  private groundCorrection:Float64Array;
  private topology=-1;
  private anchors:SurfaceVec[];
  lastUnresolved?:SurfaceContactReport['firstUnresolved'];
  stats:CanopyContactStats={contacts:0,passes:0,candidates:0,unresolved:0,maxCorrection:0,activeFaces:0};
  constructor(nodes:readonly Node[],config:{span:number;depth:number;supportY:number;floor:number}){
    this.nodes=nodes;this.ground=config.floor+CANOPY_CONTACT.separation/2;
    this.anchors=nodes.filter(n=>n.inverseMass===0).map(n=>n.rest);
    const rigid=canopyRigSurface(canopyRig(config.span,config.depth,config.supportY));
    this.positions=[...nodes.map(n=>n.p),...rigid.positions];this.start=this.positions.map(p=>[...p]);
    this.inverseMass=this.positions.map((_,i)=>i<nodes.length?nodes[i].inverseMass:0);
    this.particles=this.positions.map((p,i)=>({p,inverseMass:this.inverseMass[i]}));
    this.rigidTriangles=rigid.triangles.map(t=>t.map(i=>i+nodes.length) as unknown as SurfaceTriangle);
    this.enabled=this.positions.map((_,i)=>i>=nodes.length);this.groundCorrection=new Float64Array(nodes.length);
  }
  invalidate():void {this.topology=-1;}
  begin():void {
    for(let i=0;i<this.positions.length;i++)for(let k=0;k<3;k++)this.start[i][k]=this.positions[i][k];
    for(let i=0;i<this.nodes.length;i++)this.particles[i].inverseMass=this.inverseMass[i]=this.nodes[i].inverseMass;
    this.groundCorrection.fill(0);
  }
  /** No tangential damping inside the twelve structural iterations. */
  floor():number {
    let maximum=0;
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i];
      if(n.inverseMass===0){for(let k=0;k<3;k++)n.p[k]=n.rest[k];continue;}
      if(n.p[1]<this.ground){
        const correction=this.ground-n.p[1];maximum=Math.max(maximum,correction);
        this.groundCorrection[i]=Math.max(this.groundCorrection[i],correction);n.p[1]=this.ground;
      }
    }
    return maximum;
  }
  solve(triangles:readonly SurfaceTriangle[],topology:number):void {
    if(this.topology!==topology){
      this.enabled.fill(false,0,this.nodes.length);
      for(const t of triangles)for(const i of t)this.enabled[i]=true;
      this.index.setTriangles([...triangles,...this.rigidTriangles]);this.topology=topology;
    }
    const stats:CanopyContactStats={contacts:0,passes:0,candidates:0,unresolved:0,maxCorrection:0,activeFaces:triangles.length};this.stats=stats;
    const active=new Map<string,SurfaceContact>();
    for(let pass=0;pass<CANOPY_CONTACT.maxPasses;pass++){
      const report=this.index.detect(this.start,this.positions,this.inverseMass,CANOPY_CONTACT.separation,CANOPY_CONTACT.tolerance,CANOPY_CONTACT.maxSweepIterations,this.enabled,CANOPY_CONTACT.sweepSeparation);
      stats.passes++;stats.candidates+=report.pointTriangleCandidates+report.edgeCandidates;stats.unresolved+=report.unresolved;
      if(report.unresolved){this.lastUnresolved=report.firstUnresolved;throw new Error(`Canopy continuous contact query did not converge (${report.unresolved} features); tick rejected`);}
      const constraints=report.contacts.filter(c=>!this.atAttachment(c));
      let largest=0;
      // Resolve the nearby contact set together before paying for another full
      // swept query. Fixed Jacobians are cheap; the next outer pass rechecks the
      // complete surface trajectory and discovers any changed closest features.
      for(let iteration=0;iteration<12;iteration++){
        let residual=0;
        for(const contact of constraints){
          const particles=contact.indices.map(i=>this.particles[i]);
          const lambda=projectSurfaceContact(particles,contact.coefficients,contact.normal,CANOPY_CONTACT.separation);
          if(lambda>0){
            for(let i=0;i<4;i++)residual=Math.max(residual,Math.abs(lambda*contact.coefficients[i]*particles[i].inverseMass));
            active.set(contact.kind+':'+contact.indices.join('/'),contact);
          }
        }
        residual=Math.max(residual,this.floor());largest=Math.max(largest,residual);
        if(residual<=CANOPY_CONTACT.residualTolerance)break;
      }
      stats.maxCorrection=Math.max(stats.maxCorrection,largest);
      if(largest<=CANOPY_CONTACT.residualTolerance){
        stats.contacts=active.size;
        // Frictionless surface response retains free tangential motion. Eliminate
        // only approaching normal velocity, once the position solve is accepted.
        for(const c of constraints){
          if(!active.has(c.kind+':'+c.indices.join('/')))continue;
          let speed=0,weight=0;
          for(let j=0;j<4;j++){
            const i=c.indices[j],n=this.nodes[i];if(!n)continue;
            speed+=c.coefficients[j]*dot(n.p.map((v,k)=>v-n.prev[k]),c.normal);
            weight+=n.inverseMass*c.coefficients[j]**2;
          }
          if(speed<0&&weight>0)for(let j=0;j<4;j++){
            const n=this.nodes[c.indices[j]];if(!n)continue;
            for(let k=0;k<3;k++)n.prev[k]+=c.normal[k]*speed/weight*c.coefficients[j]*n.inverseMass;
          }
        }
        this.floorVelocity();return;
      }
    }
    throw new Error('Canopy contact response exceeded its convergence budget; tick rejected');
  }
  private atAttachment(c:SurfaceContact):boolean {
    if(!c.indices.some(i=>i>=this.nodes.length))return false;
    const p:SurfaceVec=[0,0,0],count=c.kind==='point-triangle'?1:2;
    for(let j=0;j<count;j++)for(let k=0;k<3;k++){
      const i=c.indices[j];p[k]+=c.coefficients[j]*(this.start[i][k]+c.time*(this.positions[i][k]-this.start[i][k]));
    }
    return this.anchors.some(a=>Math.hypot(p[0]-a[0],p[1]-a[1],p[2]-a[2])<=CANOPY_CONTACT.attachmentRadius);
  }
  private floorVelocity():void {
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i];if(n.inverseMass===0||n.p[1]>this.ground+CANOPY_CONTACT.tolerance)continue;
      const vx=n.p[0]-n.prev[0],vy=n.p[1]-n.prev[1],vz=n.p[2]-n.prev[2],tangent=Math.hypot(vx,vz);
      const limit=CANOPY_CONTACT.floorFriction*Math.max(this.groundCorrection[i],-vy,0),fraction=tangent?Math.min(1,limit/tangent):0;
      n.prev[0]+=vx*fraction;n.prev[2]+=vz*fraction;if(vy<0)n.prev[1]=n.p[1];
    }
  }
}
