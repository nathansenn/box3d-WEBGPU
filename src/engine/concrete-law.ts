/**
 * A scoped pressure-dependent damage-plasticity law for concrete (and other quasi-brittle solids) on the tetrahedral
 * solid (solid.ts, `material.concrete`). Composite plasticity in the manner of Feenstra and de Borst (1996):
 *
 *   - compression: associated Drucker-Prager, f_D = q + beta p - k(kappa_c) (q von Mises, p mean stress, tension
 *     positive), whose hardening and softening are fitted so that uniaxial compression follows the EN 1992-1-1 3.1.5
 *     curve (expression 3.14, after Sargin) from an elastic limit (0.4 f_cm) to f_cm at eps_c1 and on to eps_cu1, then a
 *     straight tail to zero stress. The softening is regularised by the crack band: the stress after the peak is a
 *     function of the inelastic displacement w = (axial plastic strain beyond the peak) x h, h the band width, so the
 *     energy dissipated per unit area of a crushed band is G_c whatever the element size;
 *   - tension: Rankine (each principal stress <= f_t(kappa_t)), with a softening law in the crack opening
 *     w = kappa_t h, of area G_f (linear by default).
 *
 * Both are plasticity: a crack or a crushed band unloads with the elastic stiffness and keeps its inelastic strain
 * (no secant unloading, no stiffness recovery on crack closure). The "damage" this module reports is the loss of
 * strength, 1 - k / k_peak after the peak in compression and 1 - f_t / f_t0 in tension. Associated flow overstates
 * the dilatancy (plastic volume growth beta per unit kappa_c). See docs/SOLID_MECHANICS.md.
 *
 * The return mapping is the exact minimiser of the incremental potential (elastic energy plus the dissipation of the
 * increment): both surfaces are isotropic, so it works in the principal axes of the trial elastic strain; the two
 * blocks (Drucker-Prager, Rankine) are solved in turn until both hold (block coordinate descent on a convex function
 * while the softening stays slower than the elastic stiffness, which the crack band ensures). The stress is then the
 * derivative of the returned energy, which the solid's line search needs.
 */
import {EngineError,finite,onlyKeys,record} from './contracts.ts';

/** Inputs of the law. SI units. Strains as fractions (0.0022, not 2.2 per mille). */
export interface ConcreteLawInput {
  /** Mean uniaxial compressive strength f_cm, Pa (cylinder). */
  readonly compressiveStrength:number;
  /** Mean axial tensile strength f_ctm, Pa. */
  readonly tensileStrength:number;
  /** Strain at the compressive peak eps_c1 (EN 1992-1-1 Table 3.1). */
  readonly peakStrain:number;
  /** Nominal ultimate strain eps_cu1 (EN 1992-1-1 Table 3.1). At or below peakStrain: no descending branch of 3.14,
   * the tail starts at the peak. */
  readonly ultimateStrain:number;
  /** Tensile fracture energy G_f, J/m^2 (fib Model Code 2010: 73 f_cm^0.18 N/m). */
  readonly fractureEnergy:number;
  /** Compressive fracture energy G_c, J/m^2. Default f_cm w_d / 2 with w_d = 0.5 mm (the plastic displacement that ends
   * compressive softening in the ATENA crack band model, after van Mier). */
  readonly crushingEnergy?:number;
  /** Drucker-Prager friction beta in f = q + beta p - k, 0 to 2. Raises the strength under confinement: in a
   * triaxial test sigma_1 = f_c + m sigma_3 with m = (1 + 2 beta / 3) / (1 - beta / 3); the equal biaxial strength is
   * f_c (1 - beta / 3) / (1 - 2 beta / 3). Default 0.3636, which gives the biaxial ratio 1.16 of Kupfer, Hilsdorf and Rusch
   * (1969) as widely quoted (not read in the paper), the fit Feenstra and de Borst use; m is then 1.41, below the 2.5 to 5
   * of EN 1992-1-1 (3.24) and (3.25). Larger values raise m and, with associated flow, the dilatancy. */
  readonly friction?:number;
  /** End of the elastic range in compression, a fraction of f_cm. Default 0.4 (E_cm is the secant to 0.4 f_cm).
   * 1 makes the material elastic up to the peak (a brittle ceramic). */
  readonly elasticLimit?:number;
  /** Crack band width h, m: the width of a band of elements that localises. Default (6 V)^(1/3), V the mean element
   * volume (the cell size of a box mesh of six tetrahedra per cell). */
  readonly bandWidth?:number;
  /** Tension softening as stress fractions of f_t at crack openings in m, [w, s, w, s, ...] after (0, 1); the last
   * stress must be 0. Default linear: [2 G_f / f_t, 0]. When given, its area must equal fractureEnergy. */
  readonly tensionSoftening?:readonly number[];
  /** An element whose crack opening kappa_t h reaches this (m) is eroded (removed) at the end of the step. Default
   * 1 mm, or the end of the tension softening if that is wider. Crushed elements (zero compressive strength left) erode too. */
  readonly erosionOpening?:number;
}

/** The law with its curves tabulated for one solid (its E, nu and band width): frozen, a constant of the solid. */
export interface ConcreteLaw {
  readonly input:Readonly<Required<Omit<ConcreteLawInput,'tensionSoftening'|'bandWidth'>>&{tensionSoftening:readonly number[]}>;
  readonly youngModulus:number;readonly poissonRatio:number;
  readonly friction:number;readonly bandWidth:number;
  /** Reference length L_c of the EN 1992-1-1 descending branch: an element of this band width follows 3.14 to eps_cu1. */
  readonly referenceLength:number;
  /** How many times G_c and G_f the band dissipates: above 1 only when the band is wider than the material's characteristic
   * length and the softening had to be stretched to avoid a snap-back (a brittle ceramic on a coarse mesh). */
  readonly compressionEnergyFactor:number;readonly tensionEnergyFactor:number;
  /** Drucker-Prager hardening k(kappa_c): breakpoints, values (Pa) and the integral of k from 0 (J/m^3). Constant past the end. */
  readonly kx:Float64Array;readonly ky:Float64Array;readonly kint:Float64Array;
  /** Rankine strength f_t(kappa_t): breakpoints, values and integral. */
  readonly tx:Float64Array;readonly ty:Float64Array;readonly tint:Float64Array;
  /** kappa_c at the compressive peak and at zero compressive strength (crushed). */
  readonly kappaPeak:number;readonly kappaCrushed:number;
  /** kappa_t at which an element erodes. */
  readonly kappaErode:number;
  /** Uniaxial compression curve of the law for this band width: total strain and stress (positive in compression). */
  readonly uniaxialStrain:Float64Array;readonly uniaxialStress:Float64Array;
}

const freeze=<T extends object>(o:T):T=>Object.freeze(o);
/** Default Drucker-Prager friction: the equal-biaxial strength ratio 1.16, beta = 3 (r - 1) / (2 r - 1). */
export const DEFAULT_FRICTION=3*(1.16-1)/(2*1.16-1);

/** Ascending (and descending) branch of EN 1992-1-1 (3.14): sigma / f_cm = (k eta - eta^2) / (1 + (k - 2) eta). */
export function ec2CompressionStress(strain:number,fcm:number,peakStrain:number,secantModulus:number):number {
  const k=1.05*secantModulus*peakStrain/fcm,eta=strain/peakStrain;
  return fcm*(k*eta-eta*eta)/(1+(k-2)*eta);
}
/** Strain of the ascending branch of (3.14) at the stress s f_cm, 0 <= s <= 1. */
function ec2AscendingStrain(s:number,k:number,peakStrain:number):number {
  const b=k-s*(k-2),disc=Math.max(0,b*b-4*s);
  return peakStrain*(2*s/(b+Math.sqrt(disc)));
}

/** Tabulates the law for a solid of Young's modulus E (the secant E_cm), Poisson's ratio nu and mean element volume. */
export function buildConcreteLaw(input:unknown,youngModulus:number,poissonRatio:number,meanVolume:number):ConcreteLaw {
  const c=record(input,'concrete');
  onlyKeys(c,['compressiveStrength','tensileStrength','peakStrain','ultimateStrain','fractureEnergy','crushingEnergy','friction','elasticLimit','bandWidth','tensionSoftening','erosionOpening'],'concrete');
  const E=youngModulus,fcm=finite(c.compressiveStrength,'compressiveStrength',1e3,1e11),ft=finite(c.tensileStrength,'tensileStrength',1,1e10);
  const ec1=finite(c.peakStrain,'peakStrain',1e-7,.5),ecu=finite(c.ultimateStrain,'ultimateStrain',1e-7,.5),Gf=finite(c.fractureEnergy,'fractureEnergy',1e-6,1e8);
  const wdDefault=5e-4,Gc=c.crushingEnergy===undefined?fcm*wdDefault/2:finite(c.crushingEnergy,'crushingEnergy',1e-6,1e9);
  const beta=c.friction===undefined?DEFAULT_FRICTION:finite(c.friction,'friction',0,2),limit=c.elasticLimit===undefined?.4:finite(c.elasticLimit,'elasticLimit',.05,1);
  const h=c.bandWidth===undefined?Math.cbrt(6*meanVolume):finite(c.bandWidth,'bandWidth',1e-9,1e6);
  if(ft>=fcm)throw new EngineError('INVALID_PAYLOAD','The tensile strength must be below the compressive strength.');
  const scale=1-beta/3;
  // Drucker-Prager would yield in uniaxial tension at limit f_cm (1 - beta/3) / (1 + beta/3): it must not come before Rankine.
  if(limit*fcm*scale/(1+beta/3)<ft)throw new EngineError('INVALID_PAYLOAD','Drucker-Prager would yield before the tensile strength in uniaxial tension: lower friction or raise elasticLimit.');
  // ---- Uniaxial compression: stress against the axial plastic strain (reference band) ----
  const k=1.05*E*ec1/fcm;let s0=limit;
  const pre:[number,number][]=[];
  if(limit<1){
    const raw=(s:number)=>ec2AscendingStrain(s,k,ec1)-s*fcm/E;
    // Where the curve is still stiffer than E (a nearly linear curve, k close to 1) its plastic strain would fall: the
    // elastic range then extends to the stress where the tangent of (3.14) drops to E.
    for(let i=0;i<=400;i++){const s=limit+(1-limit)*i/400;if(raw(s)<raw(s0))s0=s;}
    if(s0>1-1e-9)s0=1;
  }
  if(s0<1){
    const raw=(s:number)=>ec2AscendingStrain(s,k,ec1)-s*fcm/E,raw0=raw(s0),N=40;
    for(let i=0;i<=N;i++){
      // Denser near the peak.
      const t=1-(1-i/N)**2,s=s0+(1-s0)*t;
      // The offset at the start of plasticity is blended out by the peak when it is positive (the curve then still meets
      // f_cm at eps_c1); a negative one (a curve stiffer than E below s0) is a constant shift, which moves the peak strain.
      pre.push([raw(s)-raw0*(raw0>0?(1-s)/(1-s0):1),s*fcm]);
    }
    for(let i=1;i<pre.length;i++)if(!(pre[i][0]>pre[i-1][0]))throw new EngineError('INVALID_PAYLOAD',`The EN 1992-1-1 curve from ${limit} f_cm to the peak gives no growing plastic strain with E = ${E} Pa: check peakStrain (k = ${k.toFixed(3)}).`);
  }else pre.push([0,fcm]);
  const ep1=pre[pre.length-1][0];
  // Descending branch of (3.14) to eps_cu1, in the reference band; then a straight tail along its final slope.
  const post:[number,number][]=[[0,fcm]];// [plastic strain beyond the peak (reference), stress]
  let referenceLength:number;
  const descending=ecu>ec1*(1+1e-9)&&s0<1&&1+(k-2)*(ecu/ec1)>0;
  if(descending){
    const M=24;let last=[0,fcm];
    for(let i=1;i<=M;i++){
      const eta=1+(ecu/ec1-1)*i/M,s=Math.max(0,(k*eta-eta*eta)/(1+(k-2)*eta));
      const p=eta*ec1-s*fcm/E-ep1;if(!(p>last[0]))throw new EngineError('INVALID_PAYLOAD','The descending branch of EN 1992-1-1 (3.14) is steeper than the elastic unloading.');
      last=[p,s*fcm];post.push([p,s*fcm]);
    }
    const [pa,sa]=post[post.length-2],[pb,sb]=post[post.length-1],slope=(sb-sa)/(pb-pa);
    const end=sb>0?pb+sb/(-slope):pb;if(sb>0)post.push([end,0]);
    let area=0;for(let i=1;i<post.length;i++)area+=(post[i][0]-post[i-1][0])*(post[i][1]+post[i-1][1])/2;
    referenceLength=Gc/area;
  }else{
    // A straight line from the peak to zero over the displacement 2 G_c / f_cm, written for a reference length of 1 m.
    referenceLength=1;post.push([2*Gc/fcm,0]);
  }
  // Breakpoints in kappa_c for this band: kappa = plastic strain / (1 - beta / 3); after the peak the reference plastic
  // strain is reached at plastic displacement w = p L_c, i.e. at strain w / h in the band.
  const xs:number[]=[],ys:number[]=[];
  for(const [p,s] of pre){xs.push(p/scale);ys.push(s*scale);}
  for(let i=1;i<post.length;i++){xs.push((ep1+post[i][0]*referenceLength/h)/scale);ys.push(post[i][1]*scale);}
  const kx=Float64Array.from(xs),ky=Float64Array.from(ys);
  // k is constant (k0) below the first breakpoint, which is at kappa = 0.
  // Softening must stay slower than the elastic stiffness of the return: (3 mu + K beta^2) + k' > 0.
  const mu=E/(2*(1+poissonRatio)),K=E/(3*(1-2*poissonRatio));
  // A band wider than the material's characteristic length would snap back: its softening would be steeper than the
  // elastic stiffness of the return. The softening is then stretched until it is half as steep as that stiffness, and
  // dissipates more than G_c by the stretch factor (compressionEnergyFactor).
  let cStretch=1;const cLimit=.5*(3*mu+K*beta*beta),np=pre.length-1;
  for(let i=np+1;i<kx.length;i++){const slope=(ky[i]-ky[i-1])/(kx[i]-kx[i-1]);if(-slope>cLimit)cStretch=Math.max(cStretch,-slope/cLimit);}
  if(cStretch>1)for(let i=np+1;i<kx.length;i++)kx[i]=kx[np]+(kx[i]-kx[np])*cStretch;
  // ---- Tension: f_t(w), w = kappa_t h ----
  let table:number[];
  if(c.tensionSoftening===undefined)table=[2*Gf/ft,0];
  else{
    if(!Array.isArray(c.tensionSoftening)||c.tensionSoftening.length<2||c.tensionSoftening.length%2)throw new EngineError('INVALID_PAYLOAD','tensionSoftening takes pairs [w, s, ...].');
    table=c.tensionSoftening.map((v:unknown,i:number)=>finite(v,`tensionSoftening[${i}]`,0,1e3));
    if(table[table.length-1]!==0)throw new EngineError('INVALID_PAYLOAD','tensionSoftening must end at zero stress.');
    let area=0,w0=0,s0=1;for(let i=0;i<table.length;i+=2){if(!(table[i]>w0))throw new EngineError('INVALID_PAYLOAD','tensionSoftening openings must grow.');area+=(table[i]-w0)*(table[i+1]+s0)/2*ft;w0=table[i];s0=table[i+1];}
    if(Math.abs(area-Gf)>1e-6*Gf)throw new EngineError('INVALID_PAYLOAD',`The area of tensionSoftening, ${area} J/m^2, must equal fractureEnergy ${Gf}.`);
  }
  const txs=[0],tys=[ft];for(let i=0;i<table.length;i+=2){txs.push(table[i]/h);tys.push(table[i+1]*ft);}
  const tx=Float64Array.from(txs),ty=Float64Array.from(tys);
  const lambda=E*poissonRatio/((1+poissonRatio)*(1-2*poissonRatio));
  let tStretch=1;const tLimit=.5*(lambda+2*mu);
  for(let i=1;i<tx.length;i++){const slope=(ty[i]-ty[i-1])/(tx[i]-tx[i-1]);if(-slope>tLimit)tStretch=Math.max(tStretch,-slope/tLimit);}
  if(tStretch>1)for(let i=1;i<tx.length;i++)tx[i]*=tStretch;
  const wEnd=table[table.length-2]*tStretch,erosionOpening=c.erosionOpening===undefined?Math.max(1e-3,wEnd):finite(c.erosionOpening,'erosionOpening',1e-9,1);
  const integral=(x:Float64Array,y:Float64Array)=>{const out=new Float64Array(x.length);for(let i=1;i<x.length;i++)out[i]=out[i-1]+(x[i]-x[i-1])*(y[i]+y[i-1])/2;return out;};
  // The law's own uniaxial curve for this band (total strain, stress), for plots and tests.
  const ue:number[]=[0],us:number[]=[0];
  for(let i=0;i<kx.length;i++){const s=ky[i]/scale,p=kx[i]*scale;ue.push(p+s/E);us.push(s);}
  return freeze({
    input:freeze({compressiveStrength:fcm,tensileStrength:ft,peakStrain:ec1,ultimateStrain:ecu,fractureEnergy:Gf,crushingEnergy:Gc,friction:beta,elasticLimit:s0,erosionOpening,tensionSoftening:freeze(table)}),
    youngModulus:E,poissonRatio,friction:beta,bandWidth:h,referenceLength,compressionEnergyFactor:cStretch,tensionEnergyFactor:tStretch,
    kx,ky,kint:integral(kx,ky),tx,ty,tint:integral(tx,ty),
    kappaPeak:kx[pre.length-1],kappaCrushed:kx[kx.length-1],kappaErode:erosionOpening/h,
    uniaxialStrain:Float64Array.from(ue),uniaxialStress:Float64Array.from(us),
  });
}

/** Value of a piecewise-linear table at x (constant before the first and after the last breakpoint). */
export function tableValue(x:Float64Array,y:Float64Array,at:number):number {
  if(at<=x[0])return y[0];const n=x.length;if(at>=x[n-1])return y[n-1];
  let i=1;while(x[i]<at)i++;
  return y[i-1]+(y[i]-y[i-1])*(at-x[i-1])/(x[i]-x[i-1]);
}
/** Integral of the table from 0 to `at` (the first breakpoint is 0). */
function tableIntegral(x:Float64Array,y:Float64Array,I:Float64Array,at:number):number {
  const n=x.length;if(at<=0)return y[0]*at;
  if(at>=x[n-1])return I[n-1]+y[n-1]*(at-x[n-1]);
  let i=1;while(x[i]<at)i++;
  const d=at-x[i-1],s=(y[i]-y[i-1])/(x[i]-x[i-1]);
  return I[i-1]+d*(y[i-1]+.5*s*d);
}
/** The lambda >= 0 at which A - B lambda - g(kappa0 + lambda) = 0, g the table (B + g' > 0, A > g(kappa0)). */
function solveTable(x:Float64Array,y:Float64Array,A:number,B:number,kappa0:number,f=1):number {
  // With a strength factor f the table is f g: solve A / f - (B / f) lambda - g = 0.
  if(f!==1){A/=f;B/=f;}
  const n=x.length;let i=0;while(i<n&&x[i]<=kappa0)i++;
  for(;i<n;i++){
    // Inside the segment that ends at x[i]: g linear between (x[i-1], y[i-1]) and (x[i], y[i]); before x[0], constant y[0].
    const kappa=i===0?kappa0+(A-y[0])/B:(()=>{const slope=(y[i]-y[i-1])/(x[i]-x[i-1]);return (A+B*kappa0-y[i-1]+slope*x[i-1])/(B+slope);})();
    if(kappa<=x[i])return Math.max(0,kappa-kappa0);
  }
  // Past the last breakpoint g is constant.
  return Math.max(0,(A-y[n-1])/B);
}

/** Result of one return mapping, written by `ConcreteReturn.map`. */
export class ConcreteReturn {
  /** Stress [xx, yy, zz, yz, xz, xy], Pa; plastic strain increment (tensor shear); kappa increments; energy density J/m^3. */
  readonly stress=new Float64Array(6);readonly plastic=new Float64Array(6);
  dKappaC=0;dKappaT=0;energy=0;elastic=0;yielded=false;
  private readonly V=new Float64Array(9);private readonly ev=new Float64Array(3);private readonly a=new Float64Array(3);private readonly b=new Float64Array(3);
  private readonly order=[0,1,2];
  readonly law:ConcreteLaw;readonly lambda:number;readonly mu:number;
  constructor(law:ConcreteLaw,lambda:number,mu:number){this.law=law;this.lambda=lambda;this.mu=mu;}
  /** Return mapping of the trial elastic strain t [xx, yy, zz, yz, xz, xy] (tensor shear) from kappa_c0, kappa_t0, for
   * an element whose strengths (and so fracture energies) are f times the law's. */
  map(t:ArrayLike<number>,kc0:number,kt0:number,f=1):void {
    const L=this.law,la=this.lambda,mu=this.mu,K=la+2*mu/3,beta=L.friction,ev=this.ev,a=this.a,b=this.b;
    let lc=0,lt=0;
    const k0=f*tableValue(L.kx,L.ky,kc0),f0=f*tableValue(L.tx,L.ty,kt0);
    // Fast paths in tensor form, without the eigenvectors: the elastic state, and a Drucker-Prager return (radial in the
    // deviatoric plane) whose result satisfies Rankine. Only the rest needs the principal axes.
    {
      const tr=t[0]+t[1]+t[2],m=tr/3,d0=t[0]-m,d1=t[1]-m,d2=t[2]-m,d3=t[3],d4=t[4],d5=t[5];
      const nd=Math.sqrt(d0*d0+d1*d1+d2*d2+2*(d3*d3+d4*d4+d5*d5)),q=Math.sqrt(6)*mu*nd,p=K*tr;
      if(q+beta*p<=k0){
        if(la*tr+2*mu*largestEigenvalue(t[0],t[1],t[2],t[3],t[4],t[5])<=f0){this.tensorFinish(t,null,0,kc0,f);return;}
      }else{
        const l=solveTable(L.kx,L.ky,q+beta*p,3*mu+K*beta*beta,kc0,f);
        if(q-3*mu*l>=0){
          const r=nd>0?Math.sqrt(1.5)*l/nd:0,v=beta*l/3,P=this.plastic;
          P[0]=r*d0+v;P[1]=r*d1+v;P[2]=r*d2+v;P[3]=r*d3;P[4]=r*d4;P[5]=r*d5;
          const x0=t[0]-P[0],x1=t[1]-P[1],x2=t[2]-P[2];
          if(la*(x0+x1+x2)+2*mu*largestEigenvalue(x0,x1,x2,t[3]-P[3],t[4]-P[4],t[5]-P[5])<=f0){this.tensorFinish(t,P,l,kc0,f);return;}
        }
      }
    }
    jacobi(t,ev,this.V);
    a.fill(0);b.fill(0);
    const scaleE=Math.abs(ev[0])+Math.abs(ev[1])+Math.abs(ev[2])+1e-300;
    // Fixed point b = R(D(b)): D the Drucker-Prager return for a given Rankine part, R the Rankine return for a given
    // Drucker-Prager part. Pure Drucker-Prager returns (no Rankine flow) end after one pass; the corners (both surfaces
    // active) converge linearly, sped up by Anderson mixing of depth one.
    const g=this.g,bp=this.bp,gp=this.gp;let it=0,have=false;
    for(;it<200;it++){
      lc=this.dpBlock(ev,b,a,kc0,k0,f);
      lt=this.rkBlock(ev,a,g,kt0,f0,f,scaleE);
      if(g[0]===0&&g[1]===0&&g[2]===0&&b[0]===0&&b[1]===0&&b[2]===0)break;
      // g holds R(D(b)); the residual is g - b.
      const r0=g[0]-b[0],r1=g[1]-b[1],r2=g[2]-b[2],res=Math.abs(r0)+Math.abs(r1)+Math.abs(r2);
      if(res<=1e-15*scaleE){b[0]=g[0];b[1]=g[1];b[2]=g[2];break;}
      let n0=g[0],n1=g[1],n2=g[2];
      if(have){
        const d0=r0-gp[0],d1=r1-gp[1],d2=r2-gp[2],dd=d0*d0+d1*d1+d2*d2;
        if(dd>0){const th=(r0*d0+r1*d1+r2*d2)/dd;n0-=th*(g[0]-bp[0]-gp[0]);n1-=th*(g[1]-bp[1]-gp[1]);n2-=th*(g[2]-bp[2]-gp[2]);}
      }
      // Keep the plain fixed-point value g = b + r of this iterate for the next mixing step.
      bp[0]=b[0];bp[1]=b[1];bp[2]=b[2];gp[0]=r0;gp[1]=r1;gp[2]=r2;have=true;
      b[0]=n0;b[1]=n1;b[2]=n2;
    }
    // Make a and b consistent: the Drucker-Prager part of the final b, then its Rankine part.
    if(it>0){lc=this.dpBlock(ev,b,a,kc0,k0,f);lt=this.rkBlock(ev,a,b,kt0,f0,f,scaleE);}else{b[0]=g[0];b[1]=g[1];b[2]=g[2];}
    this.finish(ev,kc0,kt0,lc,lt,true,f);
  }
  private readonly g=new Float64Array(3);private readonly bp=new Float64Array(3);private readonly gp=new Float64Array(3);private readonly s3=new Float64Array(3);
  /** Drucker-Prager return of the strain ev - b into the plastic part a; returns the kappa_c increment. */
  private dpBlock(ev:Float64Array,b:Float64Array,a:Float64Array,kc0:number,k0:number,f:number):number {
    const L=this.law,mu=this.mu,K=this.lambda+2*mu/3,beta=L.friction;
    const x0=ev[0]-b[0],x1=ev[1]-b[1],x2=ev[2]-b[2],tr=x0+x1+x2,m=tr/3,d0=x0-m,d1=x1-m,d2=x2-m,nd=Math.sqrt(d0*d0+d1*d1+d2*d2);
    const q=Math.sqrt(6)*mu*nd,p=K*tr;
    if(q+beta*p<=k0){a[0]=a[1]=a[2]=0;return 0;}
    let l=solveTable(L.kx,L.ky,q+beta*p,3*mu+K*beta*beta,kc0,f);
    if(q-3*mu*l>=0){const r=nd>0?Math.sqrt(1.5)*l/nd:0,v=beta*l/3;a[0]=r*d0+v;a[1]=r*d1+v;a[2]=r*d2+v;return l;}
    // Apex: the deviatoric elastic strain returns to zero; the volumetric part from beta p = k.
    const lmin=Math.sqrt(2/3)*nd;l=Math.max(lmin,beta>0?solveTable(L.kx,L.ky,K*tr*beta,K*beta*beta,kc0,f):lmin);
    const v=beta*l/3;a[0]=d0+v;a[1]=d1+v;a[2]=d2+v;return l;
  }
  /** Rankine return of the strain ev - a into the plastic part out (principal, >= 0); returns the kappa_t increment. */
  private rkBlock(ev:Float64Array,a:Float64Array,out:Float64Array,kt0:number,f0:number,f:number,scaleE:number):number {
    const L=this.law,la=this.lambda,mu=this.mu,s=this.s3,o=this.order;
    const y0=ev[0]-a[0],y1=ev[1]-a[1],y2=ev[2]-a[2],tr=y0+y1+y2;s[0]=la*tr+2*mu*y0;s[1]=la*tr+2*mu*y1;s[2]=la*tr+2*mu*y2;
    out[0]=out[1]=out[2]=0;
    if(!(Math.max(s[0],s[1],s[2])>f0))return 0;
    // Principal stresses largest first.
    let i0=0,i1=1,i2=2,t:number;
    if(s[i0]<s[i1]){t=i0;i0=i1;i1=t;}if(s[i1]<s[i2]){t=i1;i1=i2;i2=t;}if(s[i0]<s[i1]){t=i0;i0=i1;i1=t;}
    o[0]=i0;o[1]=i1;o[2]=i2;
    for(let m=1;m<=3;m++){
      let sum=0;for(let q=0;q<m;q++)sum+=s[o[q]];
      const den=2*mu+m*la,cc=sum/den,dd=m/den;
      // B = cc - dd f_t(kt0 + B): A - B' B - f(kt0 + B) with A = cc / dd, B' = 1 / dd.
      const B=solveTable(L.tx,L.ty,cc/dd,1/dd,kt0,f),ftn=f*tableValue(L.tx,L.ty,kt0+B);
      let rsum=0;for(let q=0;q<m;q++)rsum+=s[o[q]]-ftn;
      let ok=true;
      for(let q=0;q<3;q++){
        if(q<m){const v=(s[o[q]]-ftn-la/den*rsum)/(2*mu);out[o[q]]=v;if(v<-1e-14*scaleE)ok=false;}
        else out[o[q]]=0;
      }
      const sumB=out[0]+out[1]+out[2];
      for(let q=m;q<3;q++)if(s[o[q]]-la*sumB>ftn*(1+1e-12)+1e-12*Math.abs(ftn))ok=false;
      if(ok||m===3)return sumB;
    }
    return 0;
  }
  /** Result of a fast path: elastic (P null) or a Drucker-Prager return with the plastic increment P and kappa_c increment l. */
  private tensorFinish(t:ArrayLike<number>,P:Float64Array|null,l:number,kc0:number,f:number):void {
    const L=this.law,la=this.lambda,mu=this.mu,S=this.stress;
    const e0=t[0]-(P?P[0]:0),e1=t[1]-(P?P[1]:0),e2=t[2]-(P?P[2]:0),e3=t[3]-(P?P[3]:0),e4=t[4]-(P?P[4]:0),e5=t[5]-(P?P[5]:0),tr=e0+e1+e2;
    S[0]=la*tr+2*mu*e0;S[1]=la*tr+2*mu*e1;S[2]=la*tr+2*mu*e2;S[3]=2*mu*e3;S[4]=2*mu*e4;S[5]=2*mu*e5;
    this.elastic=.5*(S[0]*e0+S[1]*e1+S[2]*e2)+S[3]*e3+S[4]*e4+S[5]*e5;
    const dc=l>0?tableIntegral(L.kx,L.ky,L.kint,kc0+l)-tableIntegral(L.kx,L.ky,L.kint,kc0):0;
    this.energy=this.elastic+f*dc;this.dKappaC=l;this.dKappaT=0;this.yielded=l>0;
    if(!P)this.plastic.fill(0);
  }
  private finish(ev:Float64Array,kc0:number,kt0:number,lc:number,lt:number,yielded:boolean,f:number):void {
    const L=this.law,la=this.lambda,mu=this.mu,a=this.a,b=this.b,V=this.V,S=this.stress,P=this.plastic;
    if(!yielded){a.fill(0);b.fill(0);}
    const e0=ev[0]-a[0]-b[0],e1=ev[1]-a[1]-b[1],e2=ev[2]-a[2]-b[2],tr=e0+e1+e2,s0=la*tr+2*mu*e0,s1=la*tr+2*mu*e1,s2=la*tr+2*mu*e2;
    const p0=a[0]+b[0],p1=a[1]+b[1],p2=a[2]+b[2];
    this.elastic=.5*(s0*e0+s1*e1+s2*e2);
    const dc=lc>0?tableIntegral(L.kx,L.ky,L.kint,kc0+lc)-tableIntegral(L.kx,L.ky,L.kint,kc0):0,dt=lt>0?tableIntegral(L.tx,L.ty,L.tint,kt0+lt)-tableIntegral(L.tx,L.ty,L.tint,kt0):0;
    this.energy=this.elastic+f*(dc+dt);
    this.dKappaC=lc;this.dKappaT=lt;this.yielded=lc>0||lt>0;
    // Tensor = V diag V^T, V columns the eigenvectors (V[3 r + c]).
    const put=(out:Float64Array,x:number,y:number,z:number)=>{
      const comp=(r:number,c:number)=>V[3*r]*V[3*c]*x+V[3*r+1]*V[3*c+1]*y+V[3*r+2]*V[3*c+2]*z;
      out[0]=comp(0,0);out[1]=comp(1,1);out[2]=comp(2,2);out[3]=comp(1,2);out[4]=comp(0,2);out[5]=comp(0,1);
    };
    put(S,s0,s1,s2);if(this.yielded)put(P,p0,p1,p2);else P.fill(0);
  }
}

/** Eigenvalues and eigenvectors of a symmetric tensor [xx, yy, zz, yz, xz, xy] by cyclic Jacobi rotations:
 * values into ev, vectors as the columns of V (row-major 3 x 3). */
export function jacobi(t:ArrayLike<number>,ev:Float64Array,V:Float64Array):void {
  const m=JACOBI;m[0]=t[0];m[4]=t[1];m[8]=t[2];m[5]=m[7]=t[3];m[2]=m[6]=t[4];m[1]=m[3]=t[5];
  V[0]=1;V[1]=0;V[2]=0;V[3]=0;V[4]=1;V[5]=0;V[6]=0;V[7]=0;V[8]=1;
  const scale=Math.max(Math.abs(m[0]),Math.abs(m[4]),Math.abs(m[8]),Math.abs(m[1]),Math.abs(m[2]),Math.abs(m[5]));
  for(let sweep=0;sweep<50&&scale>0;sweep++){
    if(Math.abs(m[1])+Math.abs(m[2])+Math.abs(m[5])<=1e-300+1e-18*scale)break;
    for(let p=0;p<2;p++)for(let q=p+1;q<3;q++){
      const apq=m[3*p+q];if(apq===0)continue;
      const theta=(m[4*q]-m[4*p])/(2*apq),tn=(theta<0?-1:1)/(Math.abs(theta)+Math.sqrt(theta*theta+1)),c=1/Math.sqrt(tn*tn+1),s=tn*c;
      for(let k=0;k<3;k++){const kp=m[3*k+p],kq=m[3*k+q];m[3*k+p]=c*kp-s*kq;m[3*k+q]=s*kp+c*kq;}
      for(let k=0;k<3;k++){const pk=m[3*p+k],qk=m[3*q+k];m[3*p+k]=c*pk-s*qk;m[3*q+k]=s*pk+c*qk;}
      for(let k=0;k<3;k++){const vp=V[3*k+p],vq=V[3*k+q];V[3*k+p]=c*vp-s*vq;V[3*k+q]=s*vp+c*vq;}
    }
  }
  ev[0]=m[0];ev[1]=m[4];ev[2]=m[8];
}
const JACOBI=new Float64Array(9);

/** Largest eigenvalue of a symmetric tensor [xx, yy, zz, yz, xz, xy] by the trigonometric solution of the cubic. */
export function largestEigenvalue(xx:number,yy:number,zz:number,yz:number,xz:number,xy:number):number {
  const p1=xy*xy+xz*xz+yz*yz,q=(xx+yy+zz)/3;
  if(p1<=1e-30*(xx*xx+yy*yy+zz*zz))return Math.max(xx,yy,zz);
  const a=xx-q,b=yy-q,c=zz-q,p=Math.sqrt((a*a+b*b+c*c+2*p1)/6);
  const det=(a*(b*c-yz*yz)-xy*(xy*c-yz*xz)+xz*(xy*yz-b*xz))/(p*p*p),r=Math.max(-1,Math.min(1,det/2));
  return q+2*p*Math.cos(Math.acos(r)/3);
}

/** Strength loss of an element: 1 - k / k_peak after the compressive peak, 1 - f_t / f_t0 in tension, the larger. */
export function concreteDamage(law:ConcreteLaw,kappaC:number,kappaT:number):number {
  const kp=law.ky[law.kx.length-1]===0?tableValue(law.kx,law.ky,law.kappaPeak):tableValue(law.kx,law.ky,law.kappaPeak);
  const dc=kappaC>law.kappaPeak?1-tableValue(law.kx,law.ky,kappaC)/kp:0,dt=1-tableValue(law.tx,law.ty,kappaT)/law.ty[0];
  return Math.max(0,Math.min(1,Math.max(dc,dt)));
}
