/**
 * Post-processing of a flow field (flow.ts): streamlines, slices, surface pressure, lines, sections, the projected
 * area of the solid and the frequency of a force history. SI units. Deterministic.
 */
import {EngineError} from './contracts.ts';
import {flowSample,type FlowField} from './flow.ts';
import type {FlowSurface,FlowVec3} from './flow-geometry.ts';

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',`flow: ${message}`);};

// ---------------------------------------------------------------------------------------------------------------------
// Streamlines
// ---------------------------------------------------------------------------------------------------------------------
/** Options of `flowStreamlines`: step, stride, length, direction and the speed below which a line stops. */
export interface FlowStreamlineOptions {
  /** Arc length of an integration step, in cells. Default 0.5. */
  readonly step?:number;
  /** Keep every n-th point. Default 2 (one point per cell of path). */
  readonly stride?:number;
  /** Largest number of points kept per line and direction. Default 400. */
  readonly maxPoints?:number;
  /** 'forward' (default), 'backward', or 'both' (through the seed). */
  readonly direction?:'forward'|'backward'|'both';
  /** A line ends where the speed falls below this, m/s. Default 1e-4 of the largest speed of the field. */
  readonly minSpeed?:number;
}
/** One streamline: points, speed and pressure per point, and why it ended. */
export interface FlowStreamline {
  readonly seed:FlowVec3;
  /** x, y, z per point, metres. */
  readonly points:Float32Array;
  /** Speed (m/s) and gauge pressure (Pa) at each point. */
  readonly speed:Float32Array;readonly pressure:Float32Array;
  /** Why the line ended (its downstream end): it entered an opening (an outlet, or an inlet when traced backwards; the
   * field's `opening` marks them), met a wall, left the box, stalled, or reached maxPoints. */
  readonly termination:'opening'|'wall'|'outside'|'stagnation'|'length';
}
/** Streamlines by classical Runge-Kutta (RK4) with a fixed arc-length step through the trilinear field. */
export function flowStreamlines(field:FlowField,seeds:readonly FlowVec3[],options:FlowStreamlineOptions={}):FlowStreamline[]{
  const h=field.grid.cell,ds=(options.step??0.5)*h,stride=Math.max(1,Math.floor(options.stride??2)),maxPoints=Math.max(2,Math.floor(options.maxPoints??400));
  if(!(ds>0))fail('streamlines: step must be positive.');
  let vmax=0;for(let c=0;c<field.ux.length;c++){const s=field.ux[c]*field.ux[c]+field.uy[c]*field.uy[c]+field.uz[c]*field.uz[c];if(s>vmax)vmax=s;}
  const minSpeed=options.minSpeed??1e-4*Math.sqrt(vmax),s=new Float64Array(5),direction=options.direction??'forward';
  // unit direction of the velocity at a point; 0 = ok, 1 = outside, 2 = wall, 3 = stalled, 4 = in an opening
  const dir=[0,0,0],g=field.grid,opening=field.opening;
  const at=(x:number,y:number,z:number,sign:number):number=>{
    if(!flowSample(field,x,y,z,s))return 1;
    if(opening){
      // in an opening: the cell that holds the point is one, or the point is in no fluid and a cell around it is one
      const fx=(x-g.origin[0])/g.cell,fy=(y-g.origin[1])/g.cell,fz=(z-g.origin[2])/g.cell,i=Math.floor(fx),j=Math.floor(fy),k=Math.floor(fz);
      if(i>=0&&j>=0&&k>=0&&i<g.nx&&j<g.ny&&k<g.nz&&opening[i+g.nx*(j+g.ny*k)]>=0)return 4;
      if(s[4]<0){
        const i0=Math.floor(fx-0.5),j0=Math.floor(fy-0.5),k0=Math.floor(fz-0.5);
        for(let n=0;n<8;n++){const a=i0+(n&1),b=j0+((n>>1)&1),e=k0+((n>>2)&1);if(a>=0&&b>=0&&e>=0&&a<g.nx&&b<g.ny&&e<g.nz&&opening[a+g.nx*(b+g.ny*e)]>=0)return 4;}
      }
    }
    if(s[4]<0)return 2;
    const sp=Math.sqrt(s[0]*s[0]+s[1]*s[1]+s[2]*s[2]);
    if(!(sp>minSpeed))return 3;
    dir[0]=sign*s[0]/sp;dir[1]=sign*s[1]/sp;dir[2]=sign*s[2]/sp;return 0;
  };
  const trace=(seed:FlowVec3,sign:number):{p:number[];v:number[];q:number[];end:FlowStreamline['termination']}=>{
    const p:number[]=[],v:number[]=[],q:number[]=[];let x=seed[0],y=seed[1],z=seed[2],end:FlowStreamline['termination']='length';
    const names=['length','outside','wall','stagnation','opening'] as const;
    for(let n=0;n<maxPoints*stride;n++){
      let r=at(x,y,z,sign);if(r!==0){end=names[r];break;}
      if(n%stride===0){p.push(x,y,z);v.push(Math.sqrt(s[0]*s[0]+s[1]*s[1]+s[2]*s[2]));q.push(s[3]);}
      const k1x=dir[0],k1y=dir[1],k1z=dir[2];
      r=at(x+0.5*ds*k1x,y+0.5*ds*k1y,z+0.5*ds*k1z,sign);if(r!==0){end=names[r];break;}
      const k2x=dir[0],k2y=dir[1],k2z=dir[2];
      r=at(x+0.5*ds*k2x,y+0.5*ds*k2y,z+0.5*ds*k2z,sign);if(r!==0){end=names[r];break;}
      const k3x=dir[0],k3y=dir[1],k3z=dir[2];
      r=at(x+ds*k3x,y+ds*k3y,z+ds*k3z,sign);if(r!==0){end=names[r];break;}
      x+=ds*(k1x+2*k2x+2*k3x+dir[0])/6;y+=ds*(k1y+2*k2y+2*k3y+dir[1])/6;z+=ds*(k1z+2*k2z+2*k3z+dir[2])/6;
    }
    return {p,v,q,end};
  };
  const lines:FlowStreamline[]=[];
  for(const seed of seeds){
    let p:number[],v:number[],q:number[],end:FlowStreamline['termination'];
    if(direction==='forward'){({p,v,q,end}=trace(seed,1));}
    else if(direction==='backward'){const b=trace(seed,-1);p=b.p;v=b.v;q=b.q;end=b.end;}
    else{
      const b=trace(seed,-1),f=trace(seed,1);p=[];v=[];q=[];
      for(let i=b.v.length-1;i>=1;i--){p.push(b.p[3*i],b.p[3*i+1],b.p[3*i+2]);v.push(b.v[i]);q.push(b.q[i]);}
      for(let i=0;i<f.v.length;i++){p.push(f.p[3*i],f.p[3*i+1],f.p[3*i+2]);v.push(f.v[i]);q.push(f.q[i]);}
      end=f.end;
    }
    if(v.length<2)continue;
    lines.push({seed:[seed[0],seed[1],seed[2]],points:Float32Array.from(p),speed:Float32Array.from(v),pressure:Float32Array.from(q),termination:end});
  }
  return lines;
}
/** `count` points evenly spaced from `from` to `to` (a rake of seeds). */
export function flowRake(from:FlowVec3,to:FlowVec3,count:number):FlowVec3[]{
  const out:FlowVec3[]=[];
  for(let i=0;i<count;i++){const t=count===1?0.5:i/(count-1);out.push([from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t,from[2]+(to[2]-from[2])*t]);}
  return out;
}
/** A grid of nu x nv points on the parallelogram origin + s u + t v, at the centres of its cells. */
export function flowSeedPlane(origin:FlowVec3,u:FlowVec3,v:FlowVec3,nu:number,nv:number):FlowVec3[]{
  const out:FlowVec3[]=[];
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const s=(i+0.5)/nu,t=(j+0.5)/nv;out.push([origin[0]+s*u[0]+t*v[0],origin[1]+s*u[1]+t*v[1],origin[2]+s*u[2]+t*v[2]]);}
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------------------------------------------------
/** The fields on a plane normal to an axis, sampled at the cell centres. */
export interface FlowSlice {
  readonly axis:'x'|'y'|'z';
  /** Coordinate of the plane along `axis`, metres. */
  readonly position:number;
  /** The two in-plane axes, in cyclic order (x: y, z;  y: z, x;  z: x, y), the grid of samples and its first sample. */
  readonly axes:readonly ['x'|'y'|'z','x'|'y'|'z'];
  readonly nu:number;readonly nv:number;readonly origin:readonly [number,number];readonly cell:number;
  /** Row-major (index u + nu v): speed m/s, gauge pressure Pa, the in-plane velocity, and 1 where the sample is in the fluid. */
  readonly speed:Float32Array;readonly pressure:Float32Array;readonly u:Float32Array;readonly v:Float32Array;readonly fluid:Uint8Array;
}
/** The fields on a plane normal to an axis, sampled at the cell centres of the lattice. */
export function flowSlice(field:FlowField,axis:'x'|'y'|'z',position:number):FlowSlice{
  const a='xyz'.indexOf(axis);if(a<0)fail(`slice: axis must be 'x', 'y' or 'z'.`);
  const g=field.grid,n=[g.nx,g.ny,g.nz],ua=(a+1)%3,va=(a+2)%3,nu=n[ua],nv=n[va],h=g.cell;
  if(!(position>=g.origin[a]&&position<=g.origin[a]+n[a]*h))fail(`slice: ${axis} = ${position} is outside the box.`);
  const speed=new Float32Array(nu*nv),pressure=new Float32Array(nu*nv),u=new Float32Array(nu*nv),v=new Float32Array(nu*nv),fluid=new Uint8Array(nu*nv),s=new Float64Array(5),p=[0,0,0];
  p[a]=position;
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
    p[ua]=g.origin[ua]+(i+0.5)*h;p[va]=g.origin[va]+(j+0.5)*h;
    if(!flowSample(field,p[0],p[1],p[2],s))continue;
    const idx=i+nu*j;
    speed[idx]=Math.sqrt(s[0]*s[0]+s[1]*s[1]+s[2]*s[2]);pressure[idx]=s[3];u[idx]=s[ua];v[idx]=s[va];fluid[idx]=s[4]>=0?1:0;
  }
  // the nearest cell layer says what is fluid (walls of the box included)
  const layer=Math.min(n[a]-1,Math.max(0,Math.floor((position-g.origin[a])/h))),idx3=[0,0,0];idx3[a]=layer;
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){idx3[ua]=i;idx3[va]=j;if(!field.fluid[idx3[0]+g.nx*(idx3[1]+g.ny*idx3[2])])fluid[i+nu*j]=0;}
  const names=['x','y','z'] as const;
  return {axis,position,axes:[names[ua],names[va]],nu,nv,origin:[g.origin[ua]+0.5*h,g.origin[va]+0.5*h],cell:h,speed,pressure,u,v,fluid};
}

// ---------------------------------------------------------------------------------------------------------------------
// Surface pressure
// ---------------------------------------------------------------------------------------------------------------------
/** Pressure at the vertices of the surface of one part. */
export interface FlowSurfaceField {
  readonly part:string;readonly positions:Float32Array;readonly indices:Uint32Array;
  /** Gauge pressure at each vertex, Pa, read one cell out from the wall along the gradient of the wall distance. */
  readonly pressure:Float32Array;
}
/** Pressure on the surfaces of the parts. */
export function flowSurfacePressure(field:FlowField,surfaces:readonly FlowSurface[]):FlowSurfaceField[]{
  const h=field.grid.cell,s=new Float64Array(5),g=[0,0,0];
  const distanceAt=(x:number,y:number,z:number):number=>flowSample(field,x,y,z,s)?s[4]:0;
  return surfaces.map(surface=>{
    const P=surface.positions,count=P.length/3,pressure=new Float32Array(count);
    for(let v=0;v<count;v++){
      const x=P[3*v],y=P[3*v+1],z=P[3*v+2];
      // outward direction: the gradient of the distance (it points into the fluid)
      g[0]=distanceAt(x+h,y,z)-distanceAt(x-h,y,z);g[1]=distanceAt(x,y+h,z)-distanceAt(x,y-h,z);g[2]=distanceAt(x,y,z+h)-distanceAt(x,y,z-h);
      const gl=Math.hypot(g[0],g[1],g[2]);
      let value=0,found=false;
      if(gl>0)for(const reach of [1,1.75,2.5,0.5]){
        if(flowSample(field,x+reach*h*g[0]/gl,y+reach*h*g[1]/gl,z+reach*h*g[2]/gl,s)&&s[4]>0){value=s[3];found=true;break;}
      }
      if(!found&&flowSample(field,x,y,z,s))value=s[3];
      pressure[v]=value;
    }
    return {part:surface.part,positions:surface.positions,indices:surface.indices,pressure};
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Lines and sections
// ---------------------------------------------------------------------------------------------------------------------
/** The fields along a line, and where a velocity component changes sign. */
export interface FlowLine {
  readonly from:FlowVec3;readonly to:FlowVec3;
  /** Distance from `from`, m; velocity, speed, pressure and wall distance at each sample. */
  readonly s:Float32Array;readonly ux:Float32Array;readonly uy:Float32Array;readonly uz:Float32Array;readonly speed:Float32Array;readonly pressure:Float32Array;readonly distance:Float32Array;
  /** Distances from `from` at which the velocity component along `along` (default: the line) changes sign. */
  readonly zeroCrossings:number[];
}
/** The fields along a straight line. */
export function flowLine(field:FlowField,from:FlowVec3,to:FlowVec3,samples=101,along?:FlowVec3):FlowLine{
  if(!(samples>=2))fail('line: samples must be at least 2.');
  const dx=to[0]-from[0],dy=to[1]-from[1],dz=to[2]-from[2],len=Math.hypot(dx,dy,dz);
  if(!(len>0))fail('line: from and to coincide.');
  const a=along??[dx/len,dy/len,dz/len],al=Math.hypot(a[0],a[1],a[2]);
  const s=new Float32Array(samples),ux=new Float32Array(samples),uy=new Float32Array(samples),uz=new Float32Array(samples),speed=new Float32Array(samples),pressure=new Float32Array(samples),distance=new Float32Array(samples),o=new Float64Array(5);
  const comp=new Float64Array(samples),zeroCrossings:number[]=[];
  for(let i=0;i<samples;i++){
    const t=i/(samples-1);s[i]=t*len;
    if(!flowSample(field,from[0]+t*dx,from[1]+t*dy,from[2]+t*dz,o)){distance[i]=-1;continue;}
    ux[i]=o[0];uy[i]=o[1];uz[i]=o[2];speed[i]=Math.hypot(o[0],o[1],o[2]);pressure[i]=o[3];distance[i]=o[4];
    comp[i]=(o[0]*a[0]+o[1]*a[1]+o[2]*a[2])/al;
  }
  for(let i=1;i<samples;i++)if(comp[i-1]!==0&&comp[i]!==0&&(comp[i-1]<0)!==(comp[i]<0))zeroCrossings.push(s[i-1]+(s[i]-s[i-1])*comp[i-1]/(comp[i-1]-comp[i]));
  return {from,to,s,ux,uy,uz,speed,pressure,distance,zeroCrossings};
}
/** Integrals over one layer of cells: area, flow rate, mean and peak speeds, mean pressures, momentum factor. */
export interface FlowSection {
  readonly axis:'x'|'y'|'z';readonly position:number;
  /** Fluid area of the section, m^2; volume flow rate along +axis, m^3/s; the mean speed |Q| / area. */
  readonly area:number;readonly flowRate:number;readonly meanSpeed:number;
  /** Largest speed, and largest velocity component along the axis (by magnitude), on the section, m/s. */
  readonly maxSpeed:number;readonly maxNormalSpeed:number;
  /** Area average of the gauge pressure, Pa; the flux-weighted total pressure p + rho |u|^2 / 2; and the momentum-flux
   * factor beta = area int u_n^2 / Q^2 (1 for a flat profile, 4/3 for a parabola in a pipe). */
  readonly meanPressure:number;readonly meanTotalPressure:number;readonly momentumFactor:number;
}
/** Integrals over the cell layer of the lattice that holds the plane `axis = position`, optionally inside a box. */
export function flowSection(field:FlowField,density:number,axis:'x'|'y'|'z',position:number,bounds?:{readonly min:FlowVec3;readonly max:FlowVec3}):FlowSection{
  const a='xyz'.indexOf(axis);if(a<0)fail(`section: axis must be 'x', 'y' or 'z'.`);
  const g=field.grid,n=[g.nx,g.ny,g.nz],ua=(a+1)%3,va=(a+2)%3,h=g.cell;
  const layer=Math.floor((position-g.origin[a])/h);
  if(layer<0||layer>=n[a])fail(`section: ${axis} = ${position} is outside the box.`);
  const vel=[field.ux,field.uy,field.uz][a],idx=[0,0,0];idx[a]=layer;
  let area=0,q=0,p=0,pt=0,m2=0,vmax=0,nmax=0;
  for(let j=0;j<n[va];j++)for(let i=0;i<n[ua];i++){
    idx[ua]=i;idx[va]=j;const c=idx[0]+g.nx*(idx[1]+g.ny*idx[2]);
    if(!field.fluid[c])continue;
    if(bounds){const x=g.origin[ua]+(i+0.5)*h,y=g.origin[va]+(j+0.5)*h;if(x<bounds.min[ua]||x>bounds.max[ua]||y<bounds.min[va]||y>bounds.max[va])continue;}
    const un=vel[c],sq=field.ux[c]*field.ux[c]+field.uy[c]*field.uy[c]+field.uz[c]*field.uz[c];
    area++;q+=un;p+=field.pressure[c];pt+=(field.pressure[c]+0.5*density*sq)*un;m2+=un*un;
    if(sq>vmax)vmax=sq;if(Math.abs(un)>nmax)nmax=Math.abs(un);
  }
  const dA=h*h;
  return {axis,position,area:area*dA,flowRate:q*dA,meanSpeed:area>0?Math.abs(q)/area:0,maxSpeed:Math.sqrt(vmax),maxNormalSpeed:nmax,meanPressure:area>0?p/area:0,meanTotalPressure:q!==0?pt/q:0,momentumFactor:q!==0?area*m2/(q*q):0};
}

// ---------------------------------------------------------------------------------------------------------------------
// Projected area, frequency
// ---------------------------------------------------------------------------------------------------------------------
/** Area of the shadow the solid cells cast along `direction`, m^2: every solid cell is eight sub-cells whose centres are
 * dropped onto a plane grid of half the cell size; the area is the number of grid squares hit times (h/2)^2. Along an
 * axis this counts the columns of cells that hold a solid cell. `solid(c)` says whether cell c counts. */
export function flowProjectedArea(grid:{readonly nx:number;readonly ny:number;readonly nz:number;readonly cell:number},solid:(cell:number)=>boolean,direction:FlowVec3):number{
  const dl=Math.hypot(direction[0],direction[1],direction[2]);if(!(dl>0))fail('projected area: direction must not be zero.');
  const d=[direction[0]/dl,direction[1]/dl,direction[2]/dl];
  // two unit vectors normal to d
  const ref=Math.abs(d[0])<=Math.abs(d[1])&&Math.abs(d[0])<=Math.abs(d[2])?[1,0,0]:Math.abs(d[1])<=Math.abs(d[2])?[0,1,0]:[0,0,1];
  let ux=d[1]*ref[2]-d[2]*ref[1],uy=d[2]*ref[0]-d[0]*ref[2],uz=d[0]*ref[1]-d[1]*ref[0];const ul=Math.hypot(ux,uy,uz);ux/=ul;uy/=ul;uz/=ul;
  const vx=d[1]*uz-d[2]*uy,vy=d[2]*ux-d[0]*uz,vz=d[0]*uy-d[1]*ux;
  const {nx,ny,nz}=grid,hit=new Set<number>(),span=2*(nx+ny+nz)+8;
  for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
    if(!solid(c))continue;
    for(let n=0;n<8;n++){
      const x=2*i+(n&1)+0.5,y=2*j+((n>>1)&1)+0.5,z=2*k+((n>>2)&1)+0.5; // in half cells
      hit.add(Math.floor(x*ux+y*uy+z*uz+span)*4*span+Math.floor(x*vx+y*vy+z*vz+span));
    }
  }
  return hit.size*grid.cell*grid.cell/4;
}
/** Frequency of an oscillating history sampled every `dt`: from the upward crossings of its mean, with linear
 * interpolation. Returns null when there are fewer than three crossings. `amplitude` is the root mean square about the mean. */
export function flowFrequency(samples:ArrayLike<number>,dt:number):{frequency:number;amplitude:number;mean:number;periods:number}|null{
  const n=samples.length;if(n<8)return null;
  let mean=0;for(let i=0;i<n;i++)mean+=samples[i];mean/=n;
  let rms=0;for(let i=0;i<n;i++)rms+=(samples[i]-mean)*(samples[i]-mean);rms=Math.sqrt(rms/n);
  // crossings of the mean with a hysteresis of 0.2 rms, so that noise on a slow signal is not counted
  const band=0.2*rms,crossings:number[]=[];let armed=false;
  for(let i=1;i<n;i++){
    if(samples[i]<mean-band)armed=true;
    if(armed&&samples[i-1]<mean&&samples[i]>=mean){crossings.push(i-1+(mean-samples[i-1])/(samples[i]-samples[i-1]));armed=false;}
  }
  if(crossings.length<3)return null;
  const periods=crossings.length-1;
  return {frequency:periods/((crossings[periods]-crossings[0])*dt),amplitude:rms,mean,periods};
}
