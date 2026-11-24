/**
 * The lattice-Boltzmann step of the flow solver (flow-lattice.ts) on WebGPU compute, in float32, and its float32 CPU
 * reference. One dispatch per step, one invocation per fluid cell, a gather ("pull") over the precomputed table of where
 * each population comes from: streaming, the boundary links (interpolated or half-way bounce-back with a wall or inlet
 * velocity, anti-bounce-back pressure, specular slip), the regularised collision and the Smagorinsky sub-grid model,
 * written to the other population buffer. The links write what they took and gave (`linkOut`, `linkIn`), from which
 * the host sums forces, moments and flow rates in float64 exactly as FlowLattice does.
 *
 * Supported: everything FlowLattice does except the wall function, the WALE model, the two-relaxation-time collision,
 * absorbing inlets, sponges, actuator discs and the start-up viscosity factor; `FlowLattice.program().features` names
 * those in use, and `flowGpuSupport` says whether a lattice can run here. Build the Flow with `wallFunction: false`,
 * `absorbSteps: 0`, `collision: 'regularized'`.
 *
 * `FlowLatticeF32` runs the same program on the CPU, every operation rounded to float32 in the order of the shader.
 * The gate compiles the shader on Dawn and encodes steps; it does not run it (no GPU here). docs/GPU_COMPUTE.md.
 */
import {EngineError} from '../contracts.ts';
import {FLOW_CX,FLOW_CY,FLOW_CZ,FLOW_OPPOSITE,FLOW_WEIGHT,type FlowLattice} from '../flow-lattice.ts';
import type {GpuCompute} from './compute.ts';

/** The solver id of the flow step on WebGPU (float32). */
export const FLOW_GPU_SOLVER_ID='flow-lbm-d3q19-regularized-les-webgpu-f32-v1';
const Q=19,NONE=0xffffffff,WORKGROUP=64;
const F=Math.fround;
// link kinds of FlowLattice
const LINK_WALL=0,LINK_PRESSURE=1;

/** Whether a lattice can run on this backend, and if not, why. */
export function flowGpuSupport(lattice:FlowLattice):{ok:boolean;unsupported:string[]}{
  const features=lattice.program().features;
  return {ok:features.length===0,unsupported:features};
}

/** The tables of a lattice in the layout of the shader (float32 and uint32). */
export interface FlowGpuTables {
  readonly fluidCells:number;readonly links:number;readonly boundaryCells:number;
  readonly source:Uint32Array;readonly linkIndex:Uint32Array;readonly linkStart:Uint32Array;
  /** Per link: direction | kind << 8. */
  readonly linkCode:Uint32Array;readonly linkQ:Float32Array;readonly linkAdd:Float32Array;readonly linkAux:Uint32Array;
  readonly tau0:number;readonly smagorinskyK:number;readonly bulk:number;
}
/** The tables of a lattice in the shader's layout; throws when the lattice uses a feature the kernel does not have. */
export function flowGpuTables(lattice:FlowLattice):FlowGpuTables{
  const p=lattice.program();
  if(p.features.length)throw new EngineError('INVALID_ARGUMENT',`FlowGpu: this lattice uses ${p.features.join(', ')}, which the GPU kernel does not have. Build the Flow with wallFunction: false, absorbSteps: 0 and collision: 'regularized', without sponges or actuators.`);
  const n=p.fluidCells,links=p.linkDir.length,boundaryCells=p.linkStart.length-1;
  const u32=(a:Int32Array):Uint32Array=>{const o=new Uint32Array(a.length);for(let i=0;i<a.length;i++)o[i]=a[i]<0?NONE:a[i];return o;};
  const code=new Uint32Array(links);for(let l=0;l<links;l++)code[l]=p.linkDir[l]|(p.linkKind[l]<<8);
  return {fluidCells:n,links,boundaryCells,source:u32(p.source),linkIndex:u32(p.linkIndex),linkStart:Uint32Array.from(p.linkStart),linkCode:code,
    linkQ:Float32Array.from(p.linkQ),linkAdd:Float32Array.from(p.linkAdd),linkAux:u32(p.linkAux),
    tau0:F(3*p.viscosity+0.5),smagorinskyK:F(18*Math.SQRT2*p.smagorinsky*p.smagorinsky),bulk:F(1-1/p.bulkRelaxation)};
}

// ---------------------------------------------------------------------------------------------------------------------
// The shader
// ---------------------------------------------------------------------------------------------------------------------
const f32=(x:number):string=>{const v=F(x);const t=v.toPrecision(9);return t.includes('.')||t.includes('e')?t:t+'.0';};
const W0=F(1/3),W1=F(1/18),W2=F(1/36);
/** The WGSL of the flow step: one dispatch per step, one invocation per fluid cell. */
export const FLOW_WGSL=/* wgsl */`
// flow-gpu.ts: one lattice-Boltzmann step per dispatch, one invocation per fluid cell.
struct Params { cells: u32, les: u32, oIndex: u32, oStart: u32, oCode: u32, oAux: u32, pad0: u32, pad1: u32, tau0: f32, K: f32, bulk: f32, ramp: f32, fx: f32, fy: f32, fz: f32, pad2: f32 }
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> fIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> fOut: array<f32>;
// the integer tables in one buffer: the sources of the populations (19 per cell) at 0, then at the offsets of Params
// the link index per cell, the first link per boundary cell, direction | kind << 8 per link, the auxiliary source per link
@group(0) @binding(3) var<storage, read> T: array<u32>;
@group(0) @binding(4) var<storage, read> linkReal: array<f32>;       // q, add per link
@group(0) @binding(5) var<storage, read_write> moments: array<f32>;  // dr, ux, uy, uz per cell (the last step's on entry)
@group(0) @binding(6) var<storage, read_write> linkFlux: array<f32>; // out, in per link

const CX = array<f32, 19>(${Array.from(FLOW_CX,v=>f32(v)).join(', ')});
const CY = array<f32, 19>(${Array.from(FLOW_CY,v=>f32(v)).join(', ')});
const CZ = array<f32, 19>(${Array.from(FLOW_CZ,v=>f32(v)).join(', ')});
const OPP = array<u32, 19>(${Array.from(FLOW_OPPOSITE,v=>`${v}u`).join(', ')});
const W = array<f32, 19>(${Array.from(FLOW_WEIGHT,v=>f32(v)).join(', ')});

@compute @workgroup_size(${WORKGROUP})
fn step(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) groups: vec3<u32>) {
  let c = id.x + id.y * groups.x * ${WORKGROUP}u;
  if (c >= P.cells) { return; }
  let o = c * 19u;
  var g: array<f32, 19>;
  for (var d = 0u; d < 19u; d++) { let s = T[o + d]; g[d] = select(0.0, fIn[s], s != 0xffffffffu); }
  let bi = T[P.oIndex + c];
  if (bi != 0xffffffffu) {
    var leak = 0.0;
    let ux0 = moments[4u * c + 1u]; let uy0 = moments[4u * c + 2u]; let uz0 = moments[4u * c + 3u];
    for (var l = T[P.oStart + bi]; l < T[P.oStart + bi + 1u]; l++) {
      let code = T[P.oCode + l]; let d = code & 255u; let kind = code >> 8u; let od = OPP[d]; let w = W[d]; let out = fIn[o + od];
      var v: f32;
      if (kind == ${LINK_WALL}u) {
        let q = linkReal[2u * l]; let add = linkReal[2u * l + 1u] * P.ramp;
        if (q == 0.5) { v = out + add; }
        else if (q < 0.5) { v = 2.0 * q * out + (1.0 - 2.0 * q) * fIn[T[P.oAux + l]] + add; leak = leak + (v - out - add); }
        else { v = (out + (2.0 * q - 1.0) * fIn[o + d] + add) / (2.0 * q); leak = leak + (v - out - add / (2.0 * q)); }
      } else if (kind == ${LINK_PRESSURE}u) {
        let cu = CX[d] * ux0 + CY[d] * uy0 + CZ[d] * uz0; let dr = linkReal[2u * l + 1u];
        v = -out + 2.0 * w * (dr + (1.0 + dr) * (4.5 * cu * cu - 1.5 * (ux0 * ux0 + uy0 * uy0 + uz0 * uz0)));
      } else { v = fIn[T[P.oAux + l]]; }
      g[d] = v;
      linkFlux[2u * l] = out; linkFlux[2u * l + 1u] = v;
    }
    g[0] = g[0] - leak;
  }
  let d0 = g[0]; let d1 = g[1]; let d2 = g[2]; let d3 = g[3]; let d4 = g[4]; let d5 = g[5]; let d6 = g[6];
  let d7 = g[7]; let d8 = g[8]; let d9 = g[9]; let d10 = g[10]; let d11 = g[11]; let d12 = g[12];
  let d13 = g[13]; let d14 = g[14]; let d15 = g[15]; let d16 = g[16]; let d17 = g[17]; let d18 = g[18];
  let sxy = d7 + d8; let dxy = d7 - d8; let syx = d9 + d10; let dyx = d9 - d10; let sxz = d11 + d12; let dxz = d11 - d12;
  let szx = d13 + d14; let dzx = d13 - d14; let syz = d15 + d16; let dyz = d15 - d16; let szy = d17 + d18; let dzy = d17 - d18;
  let a12 = d1 + d2; let a34 = d3 + d4; let a56 = d5 + d6;
  let pxx = a12 + sxy + syx + sxz + szx; let pyy = a34 + sxy + syx + syz + szy; let pzz = a56 + sxz + szx + syz + szy;
  let dr = d0 + a12 + a34 + a56 + sxy + syx + sxz + szx + syz + szy;
  let jx = d1 - d2 + dxy + dyx + dxz + dzx; let jy = d3 - d4 + dxy - dyx + dyz + dzy; let jz = d5 - d6 + dxz - dzx + dyz - dzy;
  let r = 1.0 + dr; let inv = 1.0 / r;
  let ux = (jx + 0.5 * P.fx) * inv; let uy = (jy + 0.5 * P.fy) * inv; let uz = (jz + 0.5 * P.fz) * inv;
  moments[4u * c] = dr; moments[4u * c + 1u] = ux; moments[4u * c + 2u] = uy; moments[4u * c + 3u] = uz;
  let rux = r * ux; let ruy = r * uy; let ruz = r * uz; let third = dr * ${f32(W0)};
  let qxx = pxx - rux * ux - third; let qyy = pyy - ruy * uy - third; let qzz = pzz - ruz * uz - third;
  let qxy = sxy - syx - rux * uy; let qxz = sxz - szx - rux * uz; let qyz = syz - szy - ruy * uz;
  let tr = (qxx + qyy + qzz) * ${f32(W0)}; let exx = qxx - tr; let eyy = qyy - tr; let ezz = qzz - tr;
  var tau = P.tau0;
  if (P.les != 0u) { tau = 0.5 * (tau + sqrt(tau * tau + P.K * sqrt(exx * exx + eyy * eyy + ezz * ezz + 2.0 * (qxy * qxy + qxz * qxz + qyz * qyz)) * inv)); }
  let as_ = 1.0 - 1.0 / tau; let bt = P.bulk * tr;
  let txx = rux * ux + as_ * exx + bt; let tyy = ruy * uy + as_ * eyy + bt; let tzz = ruz * uz + as_ * ezz + bt;
  let txy = rux * uy + as_ * qxy; let txz = rux * uz + as_ * qxz; let tyz = ruy * uz + as_ * qyz;
  let mx = 3.0 * (jx + P.fx); let my = 3.0 * (jy + P.fy); let mz = 3.0 * (jz + P.fz);
  let base = dr - 1.5 * (txx + tyy + tzz);
  fOut[o] = ${f32(W0)} * base;
  var e = base + 4.5 * txx; fOut[o + 1u] = ${f32(W1)} * (e + mx); fOut[o + 2u] = ${f32(W1)} * (e - mx);
  e = base + 4.5 * tyy; fOut[o + 3u] = ${f32(W1)} * (e + my); fOut[o + 4u] = ${f32(W1)} * (e - my);
  e = base + 4.5 * tzz; fOut[o + 5u] = ${f32(W1)} * (e + mz); fOut[o + 6u] = ${f32(W1)} * (e - mz);
  var n = mx + my; e = base + 4.5 * (txx + tyy + 2.0 * txy); fOut[o + 7u] = ${f32(W2)} * (e + n); fOut[o + 8u] = ${f32(W2)} * (e - n);
  n = mx - my; e = base + 4.5 * (txx + tyy - 2.0 * txy); fOut[o + 9u] = ${f32(W2)} * (e + n); fOut[o + 10u] = ${f32(W2)} * (e - n);
  n = mx + mz; e = base + 4.5 * (txx + tzz + 2.0 * txz); fOut[o + 11u] = ${f32(W2)} * (e + n); fOut[o + 12u] = ${f32(W2)} * (e - n);
  n = mx - mz; e = base + 4.5 * (txx + tzz - 2.0 * txz); fOut[o + 13u] = ${f32(W2)} * (e + n); fOut[o + 14u] = ${f32(W2)} * (e - n);
  n = my + mz; e = base + 4.5 * (tyy + tzz + 2.0 * tyz); fOut[o + 15u] = ${f32(W2)} * (e + n); fOut[o + 16u] = ${f32(W2)} * (e - n);
  n = my - mz; e = base + 4.5 * (tyy + tzz - 2.0 * tyz); fOut[o + 17u] = ${f32(W2)} * (e + n); fOut[o + 18u] = ${f32(W2)} * (e - n);
}
`;

// ---------------------------------------------------------------------------------------------------------------------
// The float32 reference: the shader's step on the CPU, each operation rounded to float32 in the shader's order
// ---------------------------------------------------------------------------------------------------------------------
const A=(x:number,y:number):number=>F(x+y),S=(x:number,y:number):number=>F(x-y),M=(x:number,y:number):number=>F(x*y),D=(x:number,y:number):number=>F(x/y);
const CXF=Array.from(FLOW_CX,F),CYF=Array.from(FLOW_CY,F),CZF=Array.from(FLOW_CZ,F),WF=Array.from(FLOW_WEIGHT,F);

/** The state and the sums a host reads after steps: forces per part and mass per patch from the link fluxes. */
export interface FlowGpuSums {force:Float64Array;moment:Float64Array;patchMass:Float64Array}

/** The integer tables in the one buffer of the shader, and where each starts. */
export function flowGpuTable(T:FlowGpuTables):{table:Uint32Array;offsets:{index:number;start:number;code:number;aux:number}}{
  const index=T.source.length,start=index+T.linkIndex.length,code=start+T.linkStart.length,aux=code+T.linkCode.length,table=new Uint32Array(Math.max(1,aux+T.linkAux.length));
  table.set(T.source,0);table.set(T.linkIndex,index);table.set(T.linkStart,start);table.set(T.linkCode,code);table.set(T.linkAux,aux);
  return {table,offsets:{index,start,code,aux}};
}

/** The float32 program of FLOW_WGSL on the CPU. */
export class FlowLatticeF32 {
  readonly tables:FlowGpuTables;
  f:Float32Array;private next:Float32Array;
  /** dr, ux, uy, uz per fluid cell (of the last step). */
  readonly moments:Float32Array;
  /** out, in per link of the last step. */
  readonly linkFlux:Float32Array;
  force:[number,number,number];ramp=1;les:boolean;stepCount=0;
  private readonly scratch=new Float32Array(Q);
  constructor(lattice:FlowLattice){
    this.tables=flowGpuTables(lattice);
    const n=this.tables.fluidCells;
    this.f=Float32Array.from(lattice.f);this.next=new Float32Array(n*Q);
    this.moments=new Float32Array(4*n);
    for(let a=0;a<n;a++){this.moments[4*a]=lattice.density[a];this.moments[4*a+1]=lattice.ux[a];this.moments[4*a+2]=lattice.uy[a];this.moments[4*a+3]=lattice.uz[a];}
    this.linkFlux=new Float32Array(2*this.tables.links);
    this.force=[F(lattice.force[0]),F(lattice.force[1]),F(lattice.force[2])];this.ramp=F(lattice.ramp);this.les=lattice.smagorinsky>0;
  }
  step():void{
    const T=this.tables,fin=this.f,fout=this.next,mo=this.moments,flux=this.linkFlux,g=this.scratch;
    const fx=this.force[0],fy=this.force[1],fz=this.force[2],hx=M(0.5,fx),hy=M(0.5,fy),hz=M(0.5,fz),ramp=this.ramp,tau0=T.tau0,K=T.smagorinskyK,bulk=T.bulk;
    for(let c=0;c<T.fluidCells;c++){
      const o=c*Q;
      for(let d=0;d<Q;d++){const s=T.source[o+d];g[d]=s!==NONE?fin[s]:0;}
      const bi=T.linkIndex[c];
      if(bi!==NONE){
        let leak=0;const ux0=mo[4*c+1],uy0=mo[4*c+2],uz0=mo[4*c+3];
        for(let l=T.linkStart[bi];l<T.linkStart[bi+1];l++){
          const code=T.linkCode[l],d=code&255,kind=code>>8,od=FLOW_OPPOSITE[d],w=WF[d],out=fin[o+od];
          let v:number;
          if(kind===LINK_WALL){
            const q=T.linkQ[l],add=M(T.linkAdd[l],ramp);
            if(q===0.5)v=A(out,add);
            else if(q<0.5){v=A(A(M(M(2,q),out),M(S(1,M(2,q)),fin[T.linkAux[l]])),add);leak=A(leak,S(S(v,out),add));}
            else{const q2=M(2,q);v=D(A(A(out,M(S(q2,1),fin[o+d])),add),q2);leak=A(leak,S(S(v,out),D(add,q2)));}
          }else if(kind===LINK_PRESSURE){
            const cu=A(A(M(CXF[d],ux0),M(CYF[d],uy0)),M(CZF[d],uz0)),dr=T.linkAdd[l];
            const usq=A(A(M(ux0,ux0),M(uy0,uy0)),M(uz0,uz0));
            v=A(-out,M(M(2,w),A(dr,M(A(1,dr),S(M(M(4.5,cu),cu),M(1.5,usq))))));
          }else v=fin[T.linkAux[l]];
          g[d]=v;flux[2*l]=out;flux[2*l+1]=v;
        }
        g[0]=S(g[0],leak);
      }
      const d0=g[0],d1=g[1],d2=g[2],d3=g[3],d4=g[4],d5=g[5],d6=g[6],d7=g[7],d8=g[8],d9=g[9],d10=g[10],d11=g[11],d12=g[12],d13=g[13],d14=g[14],d15=g[15],d16=g[16],d17=g[17],d18=g[18];
      const sxy=A(d7,d8),dxy=S(d7,d8),syx=A(d9,d10),dyx=S(d9,d10),sxz=A(d11,d12),dxz=S(d11,d12),szx=A(d13,d14),dzx=S(d13,d14),syz=A(d15,d16),dyz=S(d15,d16),szy=A(d17,d18),dzy=S(d17,d18);
      const a12=A(d1,d2),a34=A(d3,d4),a56=A(d5,d6);
      const pxx=A(A(A(A(a12,sxy),syx),sxz),szx),pyy=A(A(A(A(a34,sxy),syx),syz),szy),pzz=A(A(A(A(a56,sxz),szx),syz),szy);
      const dr=A(A(A(A(A(A(A(A(A(d0,a12),a34),a56),sxy),syx),sxz),szx),syz),szy);
      // left to right, as the shader adds: jz = d5 - d6 + dxz - dzx + dyz - dzy
      const jx=A(A(A(A(S(d1,d2),dxy),dyx),dxz),dzx),jy=A(A(S(A(S(d3,d4),dxy),dyx),dyz),dzy),jzz=S(A(S(A(S(d5,d6),dxz),dzx),dyz),dzy);
      const r=A(1,dr),inv=D(1,r),ux=M(A(jx,hx),inv),uy=M(A(jy,hy),inv),uz=M(A(jzz,hz),inv);
      mo[4*c]=dr;mo[4*c+1]=ux;mo[4*c+2]=uy;mo[4*c+3]=uz;
      const rux=M(r,ux),ruy=M(r,uy),ruz=M(r,uz),third=M(dr,W0);
      const qxx=S(S(pxx,M(rux,ux)),third),qyy=S(S(pyy,M(ruy,uy)),third),qzz=S(S(pzz,M(ruz,uz)),third);
      const qxy=S(S(sxy,syx),M(rux,uy)),qxz=S(S(sxz,szx),M(rux,uz)),qyz=S(S(syz,szy),M(ruy,uz));
      const tr=M(A(A(qxx,qyy),qzz),W0),exx=S(qxx,tr),eyy=S(qyy,tr),ezz=S(qzz,tr);
      let tau=tau0;
      if(this.les){
        const norm=F(Math.sqrt(A(A(A(M(exx,exx),M(eyy,eyy)),M(ezz,ezz)),M(2,A(A(M(qxy,qxy),M(qxz,qxz)),M(qyz,qyz))))));
        tau=M(0.5,A(tau,F(Math.sqrt(A(M(tau,tau),M(M(K,norm),inv))))));
      }
      const as=S(1,D(1,tau)),bt=M(bulk,tr);
      const txx=A(A(M(rux,ux),M(as,exx)),bt),tyy=A(A(M(ruy,uy),M(as,eyy)),bt),tzz=A(A(M(ruz,uz),M(as,ezz)),bt);
      const txy=A(M(rux,uy),M(as,qxy)),txz=A(M(rux,uz),M(as,qxz)),tyz=A(M(ruy,uz),M(as,qyz));
      const mx=M(3,A(jx,fx)),my=M(3,A(jy,fy)),mz=M(3,A(jzz,fz));
      const base=S(dr,M(1.5,A(A(txx,tyy),tzz)));
      fout[o]=M(W0,base);
      let e=A(base,M(4.5,txx));fout[o+1]=M(W1,A(e,mx));fout[o+2]=M(W1,S(e,mx));
      e=A(base,M(4.5,tyy));fout[o+3]=M(W1,A(e,my));fout[o+4]=M(W1,S(e,my));
      e=A(base,M(4.5,tzz));fout[o+5]=M(W1,A(e,mz));fout[o+6]=M(W1,S(e,mz));
      let n=A(mx,my);e=A(base,M(4.5,A(A(txx,tyy),M(2,txy))));fout[o+7]=M(W2,A(e,n));fout[o+8]=M(W2,S(e,n));
      n=S(mx,my);e=A(base,M(4.5,S(A(txx,tyy),M(2,txy))));fout[o+9]=M(W2,A(e,n));fout[o+10]=M(W2,S(e,n));
      n=A(mx,mz);e=A(base,M(4.5,A(A(txx,tzz),M(2,txz))));fout[o+11]=M(W2,A(e,n));fout[o+12]=M(W2,S(e,n));
      n=S(mx,mz);e=A(base,M(4.5,S(A(txx,tzz),M(2,txz))));fout[o+13]=M(W2,A(e,n));fout[o+14]=M(W2,S(e,n));
      n=A(my,mz);e=A(base,M(4.5,A(A(tyy,tzz),M(2,tyz))));fout[o+15]=M(W2,A(e,n));fout[o+16]=M(W2,S(e,n));
      n=S(my,mz);e=A(base,M(4.5,S(A(tyy,tzz),M(2,tyz))));fout[o+17]=M(W2,A(e,n));fout[o+18]=M(W2,S(e,n));
    }
    this.f=fout;this.next=fin;this.stepCount++;
  }
}

/** Forces (lattice units, per part and about the origin of the cell coordinates) and the mass per patch of the last
 * step, from the link fluxes, in float64, as FlowLattice sums them. */
export function flowGpuSums(lattice:FlowLattice,linkFlux:Float32Array):FlowGpuSums{
  const p=lattice.program(),parts=lattice.partCount,force=new Float64Array(3*parts),moment=new Float64Array(3*parts),patchMass=new Float64Array(Math.max(1,lattice.patchCount));
  for(let l=0;l<p.linkDir.length;l++){
    const own=p.linkOwner[l],out=linkFlux[2*l],v=linkFlux[2*l+1],kind=p.linkKind[l];
    if(kind===LINK_WALL&&own>=0){
      const od=FLOW_OPPOSITE[p.linkDir[l]],q=out+v,px=FLOW_CX[od]*q,py=FLOW_CY[od]*q,pz=FLOW_CZ[od]*q,rx=p.linkArm[3*l],ry=p.linkArm[3*l+1],rz=p.linkArm[3*l+2];
      force[3*own]+=px;force[3*own+1]+=py;force[3*own+2]+=pz;
      moment[3*own]+=ry*pz-rz*py;moment[3*own+1]+=rz*px-rx*pz;moment[3*own+2]+=rx*py-ry*px;
    }else if(kind===LINK_WALL&&own<-1)patchMass[-2-own]+=v-out;
    else if(kind===LINK_PRESSURE)patchMass[own]+=v-out;
  }
  return {force,moment,patchMass};
}

/** The step on a WebGPU device. Two population buffers swap each step; `read()` brings the populations, the moments
 * and the link fluxes back. */
export class GpuFlowLattice {
  readonly solver=FLOW_GPU_SOLVER_ID;
  readonly compute:GpuCompute;readonly tables:FlowGpuTables;
  stepCount=0;
  private readonly buffers:{a:GPUBuffer;b:GPUBuffer;moments:GPUBuffer;flux:GPUBuffer;params:GPUBuffer;table:GPUBuffer;real:GPUBuffer};
  private offsets:{index:number;start:number;code:number;aux:number}={index:0,start:0,code:0,aux:0};
  private readonly groups:[GPUBindGroup,GPUBindGroup];private readonly pipeline:GPUComputePipeline;
  private constructor(compute:GpuCompute,tables:FlowGpuTables,buffers:GpuFlowLattice['buffers'],groups:[GPUBindGroup,GPUBindGroup],pipeline:GPUComputePipeline){
    this.compute=compute;this.tables=tables;this.buffers=buffers;this.groups=groups;this.pipeline=pipeline;
  }
  /** Upload a lattice (its tables and its present state). */
  static async create(compute:GpuCompute,lattice:FlowLattice):Promise<GpuFlowLattice>{
    const T=flowGpuTables(lattice),n=T.fluidCells,device=compute.device;
    const module=await compute.module('flow',FLOW_WGSL);
    const kinds=['uniform','read','write','read','read','write','write'] as const;
    const layout=compute.layout('flow',[...kinds]);
    const pipeline=await compute.pipeline('flow step',module,'step',device.createPipelineLayout({label:'flow',bindGroupLayouts:[layout]}));
    const real=new Float32Array(Math.max(2,2*T.links));for(let l=0;l<T.links;l++){real[2*l]=T.linkQ[l];real[2*l+1]=T.linkAdd[l];}
    const moments=new Float32Array(4*n);for(let a=0;a<n;a++){moments[4*a]=lattice.density[a];moments[4*a+1]=lattice.ux[a];moments[4*a+2]=lattice.uy[a];moments[4*a+3]=lattice.uz[a];}
    const {table,offsets}=flowGpuTable(T);
    const buffers={a:compute.storage('flow f a',4*n*Q,Float32Array.from(lattice.f)),b:compute.storage('flow f b',4*n*Q),moments:compute.storage('flow moments',16*n,moments),flux:compute.storage('flow link flux',4*Math.max(2,2*T.links)),
      params:compute.buffer('flow params',64,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),table:compute.storage('flow tables',4*table.length,table),real:compute.storage('flow link real',4*real.length,real)};
    const group=(input:GPUBuffer,output:GPUBuffer):GPUBindGroup=>device.createBindGroup({label:'flow',layout,entries:[buffers.params,input,output,buffers.table,buffers.real,buffers.moments,buffers.flux].map((buffer,binding)=>({binding,resource:{buffer}}))});
    const gpu=new GpuFlowLattice(compute,T,buffers,[group(buffers.a,buffers.b),group(buffers.b,buffers.a)],pipeline);
    gpu.offsets=offsets;gpu.writeParams(lattice);
    return gpu;
  }
  /** The body force, the ramp and the sub-grid switch, from a lattice (call when they change). */
  writeParams(lattice:FlowLattice):void{
    const data=new ArrayBuffer(64),u=new Uint32Array(data),f=new Float32Array(data),T=this.tables,o=this.offsets;
    u[0]=T.fluidCells;u[1]=lattice.smagorinsky>0?1:0;u[2]=o.index;u[3]=o.start;u[4]=o.code;u[5]=o.aux;
    f[8]=T.tau0;f[9]=T.smagorinskyK;f[10]=T.bulk;f[11]=lattice.ramp;f[12]=lattice.force[0];f[13]=lattice.force[1];f[14]=lattice.force[2];
    this.compute.write(this.buffers.params,data);
  }
  /** Encode and submit `steps` steps. */
  step(steps=1):void{
    const groupsNeeded=Math.ceil(this.tables.fluidCells/WORKGROUP),max=this.compute.device.limits.maxComputeWorkgroupsPerDimension,gx=Math.min(groupsNeeded,max),gy=Math.ceil(groupsNeeded/gx);
    const encoder=this.compute.device.createCommandEncoder({label:'flow steps'});
    for(let s=0;s<steps;s++){
      const pass=encoder.beginComputePass({label:'flow step'});
      pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.groups[this.stepCount&1]);pass.dispatchWorkgroups(gx,gy);pass.end();
      this.stepCount++;
    }
    this.compute.device.queue.submit([encoder.finish()]);
  }
  /** Populations, moments and link fluxes of the last step. */
  async read():Promise<{f:Float32Array;moments:Float32Array;linkFlux:Float32Array}>{
    const current=(this.stepCount&1)===0?this.buffers.a:this.buffers.b;
    const [f,moments,flux]=await this.compute.read([{buffer:current},{buffer:this.buffers.moments},{buffer:this.buffers.flux}]);
    return {f:new Float32Array(f),moments:new Float32Array(moments),linkFlux:new Float32Array(flux)};
  }
  destroy():void{for(const b of Object.values(this.buffers))this.compute.release(b);}
}
