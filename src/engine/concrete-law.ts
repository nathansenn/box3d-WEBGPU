/**
 * A scoped pressure-dependent plasticity law for concrete (and other quasi-brittle solids) on the tetrahedral solid
 * (solid.ts, `material.concrete`). Composite plasticity in the manner of Feenstra and de Borst (1996):
 *
 *   - compression: a loading surface q r(theta) = k(kappa_c) Psi(xi / f_cm) (q von Mises, xi = -p the mean pressure,
 *     theta the Lode angle). The meridian Psi is the triaxial strength of EN 1992-1-1 3.1.9, (3.24) and (3.25), written
 *     in q and xi; r(theta) is the elliptic deviatoric section of Willam and Warnke, its eccentricity e fitted to the
 *     equal-biaxial strength (1.16 f_cm, Kupfer, Hilsdorf and Rusch 1969). k is fitted so that uniaxial compression follows
 *     the EN 1992-1-1 3.1.5 curve (3.14) from an elastic limit to f_cm at eps_c1 and on to eps_cu1, then a straight tail to
 *     zero; after the peak the abscissa is the plastic displacement w = (axial plastic strain beyond the peak) x h (crack
 *     band), so a crushed band of width h dissipates G_c per unit area.
 *   - non-associated flow: the plastic potential is q r(theta) + psi p, psi = tan(dilatancy angle), below the slope of the
 *     meridian, so confinement raises the strength without the dilatancy of associated flow. The flow rule is not the
 *     gradient of the yield function, so no incremental potential exists for the exact law. Each step is solved instead as
 *     an associated problem whose surface q r(theta) + psi p <= c(kappa) has the slope of the potential and the strength
 *     c = k(kappa) Psi(xi_n) - psi xi_n, xi_n the pressure expected at the end of the step, extrapolated from the last two committed states (Krabbenhoft, Karim, Lyamin and Sloan,
 *     "Associated computational plasticity schemes for nonassociated frictional materials", IJNME 90 (2012), cited from
 *     memory, not opened). At xi = xi_n this surface is the yield surface, and its normal is the potential's. The pressure lag
 *     is an error of the order of the change in the pressure increment between steps; the tests measure it.
 *   - tension: Rankine (each principal stress <= f_t(kappa_t)), with a softening law in the crack opening w = kappa_t h,
 *     of area G_f (linear by default).
 *   - after the compressive peak (postPeak 'band', the default since 2026-11-17): an associated softening surface
 *     q r(theta) + psi_s p <= A s(kappa_c), psi_s = -1.5 (no lateral plastic strain on the compressive meridian, so a crushed
 *     band across the load stays compatible with the material beside it), anchored at the state in which the element passed
 *     its peak (`ConcreteReturn.element`). Each element's softening is laid out on its own band width (`bandScale`).
 *
 * Both are plasticity: a crack or a crushed band unloads with the elastic stiffness and keeps its inelastic strain.
 * The "damage" this module reports is the loss of strength, 1 - k / k_peak after the peak in compression and
 * 1 - f_t / f_t0 in tension. See docs/SOLID_MECHANICS.md.
 *
 * Within a step the return mapping is the exact minimiser of the incremental potential (elastic energy plus the
 * dissipation of the increment): both surfaces are isotropic, so it works in the principal axes of the trial elastic
 * strain; the two blocks (compression, Rankine) are solved in turn until both hold. The stress is then the derivative of
 * the returned energy, which the solid's line search needs, and the tangent is symmetric: the solver is unchanged.
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
  /** The compressive meridian of the peak surface as pairs [xi / f_cm, q / f_cm, ...] (xi the mean pressure, compression
   * positive), concave, through [1/3, 1] (uniaxial compression); extended by its end slopes. Default: EN 1992-1-1 (3.24) and
   * (3.25) for a lateral pressure sigma_2 = sigma_3: [1/3, 1, 0.45, 1.2, 1.875, 2.625] (slopes 1.714 and 1). */
  readonly meridian?:readonly number[];
  /** A straight Drucker-Prager meridian of slope beta instead (q = k + beta xi at the peak), 0 to 2: the law of version 1.
   * With it the dilatancy defaults to beta (associated flow). Not with `meridian`. */
  readonly friction?:number;
  /** psi = tan(dilatancy angle) of the plastic potential q r(theta) + psi p, 0 to 2. Default tan 30 degrees = 0.577: a
   * dilatancy angle of 30 to 35 degrees is the usual base value for normal-strength concrete in the concrete damaged
   * plasticity model (E. A. Isakov, "Concrete damage plasticity parameters for the analysis of reinforced concrete structures", Structural Mechanics of Engineering Constructions and Buildings 22(1) (2025) 28-38, doi:10.22363/1815-5235-2025-22-1-28-38, a review). */
  readonly dilatancy?:number;
  /** psi of the plastic potential after the compressive peak (softening), -2 to 2. Default -1.5: on the compressive meridian
   * the plastic flow is then along the axis alone, (-1 + psi / 3, 1/2 + psi / 3, 1/2 + psi / 3) = (-1.5, 0, 0) per unit kappa_c,
   * so a crushed band across the load has no lateral plastic strain and stays compatible with the elastic material beside
   * it (see docs/SOLID_MECHANICS.md, crack band). */
  readonly softeningDilatancy?:number;
  /** What an element does after its compressive peak. 'band' (default): the softening surface of the crack band
   * (`softeningDilatancy`, `ConcreteReturn.element`), which localises in one band of elements. 'lagged': it stays on the
   * lagged-pressure surface, as before 2026-11-17 (confinement and dilatancy keep acting; a band does not localise in
   * compression). The nonlocal option is 'lagged'. */
  readonly postPeak?:'band'|'lagged';
  /** Equal-biaxial compressive strength over f_cm, which sets the eccentricity of the deviatoric section. Default 1.16
   * (Kupfer, Hilsdorf and Rusch 1969, abstract). The eccentricity must come out between 0.5 and 1. */
  readonly biaxialRatio?:number;
  /** End of the elastic range in compression, a fraction of f_cm. Default 0.4 (E_cm is the secant to 0.4 f_cm).
   * 1 makes the material elastic up to the peak (a brittle ceramic). */
  readonly elasticLimit?:number;
  /** Crack band width h, m, the same for every element. Default: per element (`SolidBody`), the element's width along the
   * major (tension) or minor (compression) principal stress direction of its last committed state, fixed when it starts to
   * soften; the law's own tables are then laid out for (6 V)^(1/3), V the mean element volume, and scaled per element. */
  readonly bandWidth?:number;
  /** Tension softening as stress fractions of f_t at crack openings in m, [w, s, w, s, ...] after (0, 1); the last
   * stress must be 0. Default linear: [2 G_f / f_t, 0]. When given, its area must equal fractureEnergy. */
  readonly tensionSoftening?:readonly number[];
  /** Material length l of a nonlocal average for compressive softening, m. 0 (default): local, crack band in compression.
   * With it the law keeps the lagged-pressure surface after the peak (postPeak 'lagged').
   * Above 0 an element's compressive strength in a step is k(kappa_bar), kappa_bar the average of the committed kappa_c of
   * the elements around it with the weight exp(-(r / l)^2) V (r the distance between centroids, out to 2 l), so a crushed
   * zone cannot be narrower than about l whatever the element size; the compressive softening is then laid out on the band
   * width max(h, l). */
  readonly nonlocalLength?:number;
  /** An element whose crack opening kappa_t h reaches this (m) is eroded (removed) at the end of the step. Default
   * 1 mm, or the end of the tension softening if that is wider. Crushed elements (zero compressive strength left) erode too. */
  readonly erosionOpening?:number;
}

/** The law with its curves tabulated for one solid (its E, nu and band width): frozen, a constant of the solid. */
export interface ConcreteLaw {
  readonly input:Readonly<Required<Omit<ConcreteLawInput,'tensionSoftening'|'bandWidth'|'friction'|'meridian'|'nonlocalLength'|'postPeak'>>&{tensionSoftening:readonly number[];meridian:readonly number[]}>;
  readonly youngModulus:number;readonly poissonRatio:number;
  /** Slope of the meridian at uniaxial compression, d(q / f_cm) / d(xi / f_cm). */
  readonly friction:number;
  /** psi of the plastic potential; eccentricity e of the Willam-Warnke section (1: a circle, Drucker-Prager). */
  readonly dilatancy:number;readonly eccentricity:number;
  /** psi of the plastic potential after the compressive peak (postPeak 'band'), and the post-peak behaviour. */
  readonly softeningDilatancy:number;readonly postPeak:'band'|'lagged';
  /** Meridian breakpoints (xi / f_cm) and values (q / f_cm), extended by the end slopes; floored at 0.05. */
  readonly mx:Float64Array;readonly my:Float64Array;
  readonly bandWidth:number;
  /** Nonlocal length l (0: local) and the band width the compressive softening is laid out on, max(h, NONLOCAL_BAND l). */
  readonly nonlocalLength:number;readonly compressionBand:number;
  /** Reference length L_c of the EN 1992-1-1 descending branch: an element of this band width follows 3.14 to eps_cu1. */
  readonly referenceLength:number;
  /** How many times G_c and G_f the band dissipates: above 1 only when the band is wider than the material's characteristic
   * length and the softening had to be stretched to avoid a snap-back (a brittle ceramic on a coarse mesh). */
  readonly compressionEnergyFactor:number;readonly tensionEnergyFactor:number;
  /** Hardening k(kappa_c): breakpoints, values (Pa; k = f_cm at the peak) and the integral of k from 0 (J/m^3). Constant past the end. */
  readonly kx:Float64Array;readonly ky:Float64Array;readonly kint:Float64Array;
  /** The softening surface after the peak: the uniaxial stress over f_cm against kappa_c (1 up to kappaPeak; past it, kappa_c
   * is kappaPeak plus the axial plastic strain past the peak), and its integral; kx[peakIndex] is the peak. */
  readonly sx:Float64Array;readonly sy:Float64Array;readonly sint:Float64Array;readonly peakIndex:number;
  /** Band widths, m, at which an element snaps back: E over the steepest fall of the softening stress per unit opening
   * (tension; 2 E G_f / f_t^2 for linear softening) or plastic displacement (compression). */
  readonly snapBackLength:Readonly<{tension:number;compression:number}>;
  /** Band widths, m, beyond which the softening is stretched (half the stiffness of the return, below the snap-back
   * length): an element of band width h above it dissipates h / stretchLength times G per unit area. */
  readonly stretchLength:Readonly<{tension:number;compression:number;compressionLagged:number}>;
  /** Whether erosionOpening was given (otherwise it follows the end of each element's tension softening). */
  readonly erosionGiven:boolean;
  /** Rankine strength f_t(kappa_t): breakpoints, values and integral. */
  readonly tx:Float64Array;readonly ty:Float64Array;readonly tint:Float64Array;
  /** kappa_c at the compressive peak and at zero compressive strength (crushed). */
  readonly kappaPeak:number;readonly kappaCrushed:number;
  /** kappa_t at which an element erodes. */
  readonly kappaErode:number;
  /** Axial plastic strain per unit kappa_c in uniaxial compression, 1 - psi / 3 (the lagged-pressure surface, kx), and
   * 1 - psi_s / 3 on the softening surface (sx). */
  readonly axialFlow:number;readonly softeningFlow:number;
  /** kappa_c at which the softening surface reaches zero (crushed; local law). */
  readonly kappaCrushedSoftening:number;
  /** Axial plastic strain of uniaxial compression at kappa_c = kappaCrushed. */
  readonly crushedStrain:number;
  /** Uniaxial compression curve of the law for this band width: total strain and stress (positive in compression). */
  readonly uniaxialStrain:Float64Array;readonly uniaxialStress:Float64Array;
}

const freeze=<T extends object>(o:T):T=>Object.freeze(o);
/** Drucker-Prager friction of version 1 of this law: the equal-biaxial strength ratio 1.16, beta = 3 (r - 1) / (2 r - 1). */
export const DEFAULT_FRICTION=3*(1.16-1)/(2*1.16-1);
/** Default dilatancy psi = tan 30 degrees. */
export const DEFAULT_DILATANCY=Math.tan(Math.PI/6);
/** Default dilatancy after the compressive peak: no lateral plastic strain on the compressive meridian. */
export const DEFAULT_SOFTENING_DILATANCY=-1.5;

/** EN 1992-1-1 (3.24) and (3.25), sigma_2 = sigma_3 = x f_ck, f_ck,c = f_ck (1 + 5 x) to x = 0.05, then f_ck (1.125 + 2.5 x):
 * as [xi / f, q / f] with xi = (f_c,c + 2 sigma_2) / 3 and q = f_c,c - sigma_2. */
export const EN1992_MERIDIAN:readonly number[]=Object.freeze([1/3,1,(1.25+.1)/3,1.25-.05,(3.625+2)/3,3.625-1]);
/** The strength of EN 1992-1-1 3.1.9 under a lateral pressure x f_c: f_c,c / f_c. */
export const en1992Confined=(x:number)=>x<=.05?1+5*x:1.125+2.5*x;
const PSI_FLOOR=.05;
/** Width of the crushed zone of the nonlocal average, in units of l, on which the compressive softening is laid out. */
export const NONLOCAL_BAND=1;

/** Meridian value Psi at xi / f_cm. */
export function meridianValue(law:{mx:Float64Array;my:Float64Array},xi:number):number {
  const x=law.mx,y=law.my,n=x.length;let v:number;
  if(xi<=x[0])v=y[0]+(y[1]-y[0])/(x[1]-x[0])*(xi-x[0]);
  else if(xi>=x[n-1])v=y[n-1]+(y[n-1]-y[n-2])/(x[n-1]-x[n-2])*(xi-x[n-1]);
  else{let i=1;while(x[i]<xi)i++;v=y[i-1]+(y[i]-y[i-1])*(xi-x[i-1])/(x[i]-x[i-1]);}
  return Math.max(PSI_FLOOR,v);
}

/** Willam-Warnke elliptic deviatoric section: r(theta) with theta the Lode angle, 0 on the tensile meridian (r = 1 / e)
 * and pi / 3 on the compressive meridian (r = 1); the surface is q r(theta) = const. Writes [r, dr/dtheta] into out. */
export function lodeFactor(theta:number,e:number,out:Float64Array|number[]):void {
  if(e>=1){out[0]=1;out[1]=0;return;}
  const a=1-e*e,b=2*e-1,u=Math.cos(theta),S=Math.sqrt(Math.max(0,4*a*u*u+5*e*e-4*e)),N=4*a*u*u+b*b,D=2*a*u+b*S;
  const dN=8*a*u,dD=2*a+(S>0?b*4*a*u/S:0);
  out[0]=N/D;out[1]=-Math.sin(theta)*(dN*D-N*dD)/(D*D);
}
/** r(theta), r'(theta) and r''(theta) of the same section into out[0..2] (the Newton step of the deviatoric return). */
export function lodeFactor2(theta:number,e:number,out:Float64Array|number[]):void {
  if(e>=1){out[0]=1;out[1]=0;out[2]=0;return;}
  const a=1-e*e,b=2*e-1,u=Math.cos(theta),v=Math.sin(theta),S=Math.sqrt(Math.max(0,4*a*u*u+5*e*e-4*e)),N=4*a*u*u+b*b,D=2*a*u+b*S;
  const Su=S>0?4*a*u/S:0,Nu=8*a*u,Du=2*a+b*Su,Suu=S>0?4*a*(S-u*Su)/(S*S):0,Duu=b*Suu;
  const ru=(Nu*D-N*Du)/(D*D),ruu=(8*a*D-N*Duu)/(D*D)-2*Du*(Nu*D-N*Du)/(D*D*D);
  out[0]=N/D;out[1]=-v*ru;out[2]=-u*ru+v*v*ruu;
}
const LF=new Float64Array(2),LF3=new Float64Array(3);

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
  onlyKeys(c,['compressiveStrength','tensileStrength','peakStrain','ultimateStrain','fractureEnergy','crushingEnergy','meridian','friction','dilatancy','softeningDilatancy','postPeak','biaxialRatio','elasticLimit','bandWidth','tensionSoftening','erosionOpening','nonlocalLength'],'concrete');
  const E=youngModulus,fcm=finite(c.compressiveStrength,'compressiveStrength',1e3,1e11),ft=finite(c.tensileStrength,'tensileStrength',1,1e10);
  const ec1=finite(c.peakStrain,'peakStrain',1e-7,.5),ecu=finite(c.ultimateStrain,'ultimateStrain',1e-7,.5),Gf=finite(c.fractureEnergy,'fractureEnergy',1e-6,1e8);
  const wdDefault=5e-4,Gc=c.crushingEnergy===undefined?fcm*wdDefault/2:finite(c.crushingEnergy,'crushingEnergy',1e-6,1e9);
  const limit=c.elasticLimit===undefined?.4:finite(c.elasticLimit,'elasticLimit',.05,1);
  const h=c.bandWidth===undefined?Math.cbrt(6*meanVolume):finite(c.bandWidth,'bandWidth',1e-9,1e6);
  const nonlocal=c.nonlocalLength===undefined?0:finite(c.nonlocalLength,'nonlocalLength',0,1e6),hc=Math.max(h,nonlocal*NONLOCAL_BAND);
  if(ft>=fcm)throw new EngineError('INVALID_PAYLOAD','The tensile strength must be below the compressive strength.');
  // ---- Peak surface: meridian, dilatancy, deviatoric section ----
  if(c.friction!==undefined&&c.meridian!==undefined)throw new EngineError('INVALID_PAYLOAD','Give either friction (a straight meridian) or meridian, not both.');
  let meridian:number[];
  if(c.friction!==undefined){const b=finite(c.friction,'friction',0,2);meridian=[1/3,1,4/3,1+b];}
  else if(c.meridian!==undefined){
    if(!Array.isArray(c.meridian)||c.meridian.length<4||c.meridian.length%2)throw new EngineError('INVALID_PAYLOAD','meridian takes pairs [xi / f_cm, q / f_cm, ...], at least two.');
    meridian=c.meridian.map((v:unknown,i:number)=>finite(v,`meridian[${i}]`,-10,100));
  }else meridian=[...EN1992_MERIDIAN];
  const mxs:number[]=[],mys:number[]=[];for(let i=0;i<meridian.length;i+=2){mxs.push(meridian[i]);mys.push(meridian[i+1]);}
  for(let i=1;i<mxs.length;i++)if(!(mxs[i]>mxs[i-1]))throw new EngineError('INVALID_PAYLOAD','meridian abscissae must grow.');
  for(let i=2;i<mxs.length;i++)if((mys[i]-mys[i-1])/(mxs[i]-mxs[i-1])>(mys[i-1]-mys[i-2])/(mxs[i-1]-mxs[i-2])+1e-12)throw new EngineError('INVALID_PAYLOAD','The meridian must be concave (its slope may not grow).');
  if((mys[mys.length-1]-mys[mys.length-2])/(mxs[mxs.length-1]-mxs[mxs.length-2])<0)throw new EngineError('INVALID_PAYLOAD','The meridian may not fall with pressure.');
  const mx=Float64Array.from(mxs),my=Float64Array.from(mys),M={mx,my};
  if(Math.abs(meridianValue(M,1/3)-1)>1e-9)throw new EngineError('INVALID_PAYLOAD','The meridian must pass through [1/3, 1] (uniaxial compression at f_cm).');
  const friction=(()=>{const d=1e-6;return (meridianValue(M,1/3+d)-meridianValue(M,1/3-d))/(2*d);})();
  const psi=c.dilatancy===undefined?(c.friction!==undefined?friction:DEFAULT_DILATANCY):finite(c.dilatancy,'dilatancy',0,2);
  const biaxial=c.biaxialRatio===undefined?1.16:finite(c.biaxialRatio,'biaxialRatio',1,3);
  // Equal biaxial compression (-s, -s, 0) lies on the tensile meridian: q = s, xi = 2 s / 3, s r(0) = s / e = Psi(2 s / 3).
  let ecc=biaxial/meridianValue(M,2*biaxial/3);
  // A ratio a little above what a circular section gives (a rounded friction) takes the circle.
  if(ecc>1&&ecc<1.01)ecc=1;
  if(!(ecc>.5&&ecc<=1))throw new EngineError('INVALID_PAYLOAD',`The biaxial ratio ${biaxial} needs a deviatoric eccentricity ${ecc.toFixed(3)} outside (0.5, 1] with this meridian.`);
  const flow=1-psi/3;
  if(!(flow>0))throw new EngineError('INVALID_PAYLOAD','The dilatancy must be below 3.');
  const psiS=c.softeningDilatancy===undefined?DEFAULT_SOFTENING_DILATANCY:finite(c.softeningDilatancy,'softeningDilatancy',-2,2),flowS=1-psiS/3;
  if(c.postPeak!==undefined&&c.postPeak!=='band'&&c.postPeak!=='lagged')throw new EngineError('INVALID_PAYLOAD','postPeak is \'band\' or \'lagged\'.');
  const postPeak:'band'|'lagged'=nonlocal>0?'lagged':c.postPeak??'band';
  if(nonlocal>0&&c.postPeak==='band')throw new EngineError('INVALID_PAYLOAD','The nonlocal option keeps the lagged-pressure surface after the peak (postPeak \'lagged\').');
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
    const Mn=24;let last=[0,fcm];
    for(let i=1;i<=Mn;i++){
      const eta=1+(ecu/ec1-1)*i/Mn,s=Math.max(0,(k*eta-eta*eta)/(1+(k-2)*eta));
      const p=eta*ec1-s*fcm/E-ep1;if(!(p>last[0]))throw new EngineError('INVALID_PAYLOAD','The descending branch of EN 1992-1-1 (3.14) is steeper than the elastic unloading.');
      last=[p,s*fcm];post.push([p,s*fcm]);
    }
    const [pa,sa]=post[post.length-2],[pb,sb]=post[post.length-1],slope=(sb-sa)/(pb-pa);
    const end=sb>0?pb+sb/(-slope):pb;
    // The tail in several pieces: k = s / Psi(s / 3 f_cm) is not linear in s, and the table is linear in k between breakpoints.
    if(sb>0)for(let i=1;i<=16;i++)post.push([pb+(end-pb)*i/16,sb*(1-i/16)]);
    let area=0;for(let i=1;i<post.length;i++)area+=(post[i][0]-post[i-1][0])*(post[i][1]+post[i-1][1])/2;
    referenceLength=Gc/area;
  }else{
    // A straight line from the peak to zero over the displacement 2 G_c / f_cm, written for a reference length of 1 m.
    referenceLength=1;for(let i=1;i<=16;i++)post.push([2*Gc/fcm*i/16,fcm*(1-i/16)]);
  }
  // Breakpoints in kappa_c for this band: the axial plastic strain is (1 - psi / 3) kappa_c on the compressive meridian; a
  // uniaxial stress s needs k = s / Psi(s / (3 f_cm)). After the peak the reference plastic strain is reached at plastic
  // displacement w = p L_c, i.e. at strain w / h in the band.
  const kOf=(s:number)=>s/meridianValue(M,s/(3*fcm));
  const xs:number[]=[],ys:number[]=[];
  for(const [p,s] of pre){xs.push(p/flow);ys.push(kOf(s));}
  for(let i=1;i<post.length;i++){xs.push((ep1+post[i][0]*referenceLength/hc)/flow);ys.push(kOf(post[i][1]));}
  const kx=Float64Array.from(xs),ky=Float64Array.from(ys);
  // Uniaxial tension at f_t must reach Rankine before the compression surface: f_t / e <= Psi(-f_t / 3 f_cm) k_0.
  if(ft/ecc>meridianValue(M,-ft/(3*fcm))*ky[0])throw new EngineError('INVALID_PAYLOAD','The compression surface would yield before the tensile strength in uniaxial tension: raise elasticLimit or change the meridian.');
  // Softening must stay slower than the elastic stiffness of the return: in uniaxial compression the strength c falls
  // with kappa_c as the stress s does, and (3 mu + K psi^2) + dc/dkappa > 0 is needed. A band wider than the material's
  // characteristic length would snap back: the softening is then stretched until it is half as steep, and dissipates more
  // than G_c by the stretch factor (compressionEnergyFactor).
  const mu=E/(2*(1+poissonRatio)),K=E/(3*(1-2*poissonRatio));
  let cStretch=1;const cLimit=.5*(3*mu+K*psi*psi)/flow,np=pre.length-1;
  for(let i=np+1;i<kx.length;i++){const slope=(post[i-np][1]-post[i-np-1][1])/(kx[i]-kx[i-1]);if(-slope>cLimit)cStretch=Math.max(cStretch,-slope/cLimit);}
  if(cStretch>1)for(let i=np+1;i<kx.length;i++)kx[i]=kx[np]+(kx[i]-kx[np])*cStretch;
  // Band widths of compression: the steepest fall of the post-peak stress per unit plastic displacement w (= p L_c) gives
  // the snap-back length E / max|ds/dw| (a bar element of this band width unloads elastically as fast as its band softens)
  // and the stretch length, beyond which the table above is stretched.
  let steepC=0;for(let i=1;i<post.length;i++)steepC=Math.max(steepC,(post[i-1][1]-post[i][1])/((post[i][0]-post[i-1][0])*referenceLength));
  const snapC=steepC>0?E/steepC:Infinity,stretchPre=steepC>0?cLimit/(flow*steepC):Infinity;
  // The softening surface after the peak (local law; `ConcreteReturn.element`): the uniaxial stress over f_cm against kappa_c,
  // whose axial plastic strain grows by flowS per unit (the softening dilatancy), on the band hc; stretched like the table
  // above when hc is wider than its stretch length (the uniqueness of the associated return: (3 mu + K psi_s^2) / flowS^2).
  const cLimitS=.5*(3*mu+K*psiS*psiS)/flowS,stretchC=steepC>0?cLimitS/(flowS*steepC):Infinity,ibS=Math.max(1/hc,1/stretchC);
  // Its abscissa past the peak is the axial plastic strain past the peak (not kappa_c): the flow per unit multiplier,
  // 1 - psi / 3, changes with psi along the softening (a step converts it with the flow of psi_s (ConcreteReturn.setup).
  const sxs=[0,kx[np]],sys=[1,1];for(let i=1;i<post.length;i++){sxs.push(kx[np]+post[i][0]*referenceLength*ibS);sys.push(post[i][1]/fcm);}
  const sx=Float64Array.from(sxs),sy=Float64Array.from(sys),local=postPeak==='band',fl=local?flowS:flow;
  // ---- Tension: f_t(w), w = kappa_t h ----
  let table:number[];
  if(c.tensionSoftening===undefined)table=[2*Gf/ft,0];
  else{
    if(!Array.isArray(c.tensionSoftening)||c.tensionSoftening.length<2||c.tensionSoftening.length%2)throw new EngineError('INVALID_PAYLOAD','tensionSoftening takes pairs [w, s, ...].');
    table=c.tensionSoftening.map((v:unknown,i:number)=>finite(v,`tensionSoftening[${i}]`,0,1e3));
    if(table[table.length-1]!==0)throw new EngineError('INVALID_PAYLOAD','tensionSoftening must end at zero stress.');
    let area=0,w0=0,sv=1;for(let i=0;i<table.length;i+=2){if(!(table[i]>w0))throw new EngineError('INVALID_PAYLOAD','tensionSoftening openings must grow.');area+=(table[i]-w0)*(table[i+1]+sv)/2*ft;w0=table[i];sv=table[i+1];}
    if(Math.abs(area-Gf)>1e-6*Gf)throw new EngineError('INVALID_PAYLOAD',`The area of tensionSoftening, ${area} J/m^2, must equal fractureEnergy ${Gf}.`);
  }
  const txs=[0],tys=[ft];for(let i=0;i<table.length;i+=2){txs.push(table[i]/h);tys.push(table[i+1]*ft);}
  const tx=Float64Array.from(txs),ty=Float64Array.from(tys);
  const lambda=E*poissonRatio/((1+poissonRatio)*(1-2*poissonRatio));
  let tStretch=1;const tLimit=.5*(lambda+2*mu);
  for(let i=1;i<tx.length;i++){const slope=(ty[i]-ty[i-1])/(tx[i]-tx[i-1]);if(-slope>tLimit)tStretch=Math.max(tStretch,-slope/tLimit);}
  if(tStretch>1)for(let i=1;i<tx.length;i++)tx[i]*=tStretch;
  let steepT=0;{let w0=0,s0=1;for(let i=0;i<table.length;i+=2){steepT=Math.max(steepT,(s0-table[i+1])*ft/(table[i]-w0));w0=table[i];s0=table[i+1];}}
  const snapT=E/steepT,stretchT=tLimit/steepT;
  const wEnd=table[table.length-2]*tStretch,erosionOpening=c.erosionOpening===undefined?Math.max(1e-3,wEnd):finite(c.erosionOpening,'erosionOpening',1e-9,1);
  const integral=(x:Float64Array,y:Float64Array)=>{const out=new Float64Array(x.length);for(let i=1;i<x.length;i++)out[i]=out[i-1]+(x[i]-x[i-1])*(y[i]+y[i-1])/2;return out;};
  // The law's own uniaxial curve for this band (total strain, stress), for plots and tests.
  const ue:number[]=[0],us:number[]=[0];
  for(let i=0;i<pre.length;i++){ue.push(pre[i][0]+pre[i][1]/E);us.push(pre[i][1]);}
  for(let i=1;i<post.length;i++){const p=ep1+(local?sx[i+1]-sx[1]:(kx[np+i]-kx[np])*fl);ue.push(p+post[i][1]/E);us.push(post[i][1]);}
  return freeze({
    input:freeze({compressiveStrength:fcm,tensileStrength:ft,peakStrain:ec1,ultimateStrain:ecu,fractureEnergy:Gf,crushingEnergy:Gc,dilatancy:psi,softeningDilatancy:psiS,postPeak,biaxialRatio:biaxial,meridian:freeze(meridian),elasticLimit:s0,erosionOpening,tensionSoftening:freeze(table)}),
    youngModulus:E,poissonRatio,friction,dilatancy:psi,softeningDilatancy:psiS,eccentricity:ecc,mx,my,bandWidth:h,nonlocalLength:nonlocal,compressionBand:hc,referenceLength,compressionEnergyFactor:local?Math.max(1,hc/stretchC):cStretch,tensionEnergyFactor:tStretch,
    kx,ky,kint:integral(kx,ky),tx,ty,tint:integral(tx,ty),sx,sy,sint:integral(sx,sy),peakIndex:np,
    snapBackLength:freeze({tension:snapT,compression:snapC}),stretchLength:freeze({tension:stretchT,compression:local?stretchC:stretchPre,compressionLagged:stretchPre}),erosionGiven:c.erosionOpening!==undefined,
    kappaPeak:kx[pre.length-1],kappaCrushed:kx[kx.length-1],kappaCrushedSoftening:sx[sx.length-1],kappaErode:erosionOpening/h,axialFlow:flow,softeningFlow:flowS,
    crushedStrain:ep1+(local?sx[sx.length-1]-sx[1]:(kx[kx.length-1]-kx[np])*flow),postPeak,
    uniaxialStrain:Float64Array.from(ue),uniaxialStress:Float64Array.from(us),
  });
}

/** Cumulative trapezoidal integral of the table (x, y) into out (out[0] = 0). */
function integrate(x:Float64Array,y:Float64Array,out:Float64Array):void {out[0]=0;for(let i=1;i<x.length;i++)out[i]=out[i-1]+(x[i]-x[i-1])*(y[i]+y[i-1])/2;}
/** Scale of the softening abscissae of an element of band width h against the law's band (`ConcreteReturn.element`):
 * the softening of a band h is laid out on 1 / h, or on the stretch length when h is wider than that. 1 for the law's band. */
export function bandScale(law:ConcreteLaw,h:number,kind:'tension'|'compression'|'compressionLagged'):number {
  const hs=law.stretchLength[kind],h0=kind==='tension'?law.bandWidth:law.compressionBand;
  if(h===h0)return 1;
  return Math.max(1/h,1/hs)/Math.max(1/h0,1/hs);
}
/** The width of a tetrahedron along the unit direction n: max - min of its nodes' positions projected on n. */
export function projectedWidth(X:ArrayLike<number>,tets:ArrayLike<number>,e:number,nx:number,ny:number,nz:number):number {
  let lo=Infinity,hi=-Infinity;
  for(let q=0;q<4;q++){const a=3*tets[4*e+q],v=X[a]*nx+X[a+1]*ny+X[a+2]*nz;if(v<lo)lo=v;if(v>hi)hi=v;}
  return hi-lo;
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
/** Integral of max(F - g, 0) from a to b, g the table (constant before the first and after the last breakpoint). */
function floorExcess(x:Float64Array,y:Float64Array,a:number,b:number,F:number):number {
  const n=x.length;let sum=0;
  const piece=(s:number,e:number,g0:number,g1:number)=>{
    if(!(e>s))return;const d0=F-g0,d1=F-g1;
    if(d0>=0&&d1>=0)sum+=(e-s)*(d0+d1)/2;
    else if(d0>0||d1>0){const t=d0/(d0-d1),pos=d0>0?d0:d1,len=(e-s)*(d0>0?t:1-t);sum+=len*pos/2;}
  };
  // Before the first breakpoint and after the last, g is constant.
  if(a<x[0])piece(a,Math.min(b,x[0]),y[0],y[0]);
  for(let i=1;i<n;i++){
    const s=Math.max(a,x[i-1]),e=Math.min(b,x[i]);if(!(e>s))continue;
    const gs=y[i-1]+(y[i]-y[i-1])*(s-x[i-1])/(x[i]-x[i-1]),ge=y[i-1]+(y[i]-y[i-1])*(e-x[i-1])/(x[i]-x[i-1]);
    piece(s,e,gs,ge);
  }
  if(b>x[n-1])piece(Math.max(a,x[n-1]),b,y[n-1],y[n-1]);
  return sum;
}
/** The lambda >= 0 at which A - B lambda - f g(kappa0 + lambda) = 0, g the table (B + f g' > 0, A > f g(kappa0)). */
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

const SQ6=Math.sqrt(6),SQ2=Math.sqrt(2),SQ15=Math.sqrt(1.5),THIRD_PI=Math.PI/3,TWO_THIRD_PI=2*Math.PI/3;
/** Numbers kept per element for the base point of a concrete tangent (`ConcreteReturn.principal`). */
export const PRINCIPAL_STRIDE=17;
/** Slope of the table at `at` (the segment that ends at or after `at`; 0 outside the table). */
function tableSlope(x:Float64Array,y:Float64Array,at:number):number {
  const n=x.length;if(n<2||at<=x[0]||at>=x[n-1])return 0;
  let i=1;while(x[i]<at)i++;
  return (y[i]-y[i-1])/(x[i]-x[i-1]);
}

/** Result of one return mapping, written by `ConcreteReturn.map`. */
export class ConcreteReturn {
  /** Stress [xx, yy, zz, yz, xz, xy], Pa; plastic strain increment (tensor shear); kappa increments; energy density J/m^3. */
  readonly stress=new Float64Array(6);readonly plastic=new Float64Array(6);
  dKappaC=0;dKappaT=0;energy=0;elastic=0;yielded=false;
  private readonly V=new Float64Array(9);private readonly ev=new Float64Array(3);private readonly a=new Float64Array(3);private readonly b=new Float64Array(3);
  private readonly order=[0,1,2];
  /** The compression surface of this call: c(kappa) = cf k(kappa) + cs. */
  private cf=1;private cs=0;
  readonly law:ConcreteLaw;readonly lambda:number;readonly mu:number;
  constructor(law:ConcreteLaw,lambda:number,mu:number){this.law=law;this.lambda=lambda;this.mu=mu;this.kx=law.kx;this.ky=law.ky;this.ki=law.kint;this.tx=law.tx;this.ti=law.tint;}
  /** Return mapping of the trial elastic strain t [xx, yy, zz, yz, xz, xy] (tensor shear) from kappa_c0, kappa_t0, for
   * an element whose strengths (and so fracture energies) are f times the law's and whose committed mean pressure is xi_n
   * (Pa, compression positive: minus the mean stress of the last committed state). */
  /** A compression multiplier the caller expects within 1e-4 of itself (the base point of a finite-difference tangent), or -1:
   * the regula falsi of the compression return then starts from a bracket around it when that bracket holds the root. */
  lHint=-1;
  map(t:ArrayLike<number>,kc0:number,kt0:number,f=1,xn=0,kbar=-1):void {
    // The Lode-angle warm start lives within one call: a result never depends on an earlier call.
    this.wwRho=-1;
    kc0=this.setup(kc0,f,xn,kbar);
    this.mapNow(t,kc0,kt0,f);
  }
  /**
   * The element of the next `map` and `tangent` calls (it stays until the next call of this method):
   *   - anchor: 0 before the compressive peak (the pressure-dependent surface of the law, solved with the lagged pressure);
   *     above 0 after it, the softening surface q r(theta) + psi_s p <= anchor s(kappa_c) (associated, psi_s the softening
   *     dilatancy, s the law's uniaxial post-peak stress over f_cm), anchored at the state in which the element passed the
   *     peak (`softeningAnchor`), so that the step needs no lagged pressure;
   *   - scaleC, scaleT: factors on the softening abscissae of compression (after the peak) and tension, for an element
   *     whose band width differs from the law's (`bandScale`); 1 uses the law's tables.
   */
  element(anchor:number,bandC=this.law.compressionBand,bandT=this.law.bandWidth):void {
    this.anchor=anchor;
    const L=this.law;
    if(bandC!==this.bandC){
      this.bandC=bandC;const sP=this.scaleP=bandScale(L,bandC,'compressionLagged'),sC=this.scaleC=bandScale(L,bandC,'compression');
      const np=L.peakIndex,kp=L.kx[np];
      if(sP!==1){
        if(!this.kxE||this.kxE.length!==L.kx.length){this.kxE=new Float64Array(L.kx.length);this.kiE=new Float64Array(L.kx.length);}
        for(let i=0;i<L.kx.length;i++)this.kxE[i]=i<=np?L.kx[i]:kp+(L.kx[i]-kp)*sP;
        integrate(this.kxE,L.ky,this.kiE!);
      }
      if(sC!==1){
        if(!this.sxE||this.sxE.length!==L.sx.length){this.sxE=new Float64Array(L.sx.length);this.siE=new Float64Array(L.sx.length);}
        for(let i=0;i<L.sx.length;i++)this.sxE[i]=i<=1?L.sx[i]:kp+(L.sx[i]-kp)*sC;
        integrate(this.sxE,L.sy,this.siE!);
      }
    }
    if(bandT!==this.bandT){
      this.bandT=bandT;const scaleT=this.scaleT=bandScale(L,bandT,'tension');
      if(scaleT!==1){
        if(!this.txE||this.txE.length!==L.tx.length){this.txE=new Float64Array(L.tx.length);this.tiE=new Float64Array(L.tx.length);}
        for(let i=0;i<L.tx.length;i++)this.txE[i]=L.tx[i]*scaleT;
        integrate(this.txE,L.ty,this.tiE!);
      }
    }
    this.tx=this.scaleT===1?L.tx:this.txE!;this.ti=this.scaleT===1?L.tint:this.tiE!;
  }
  private anchor=0;private kFlow=1;private sxF:Float64Array|null=null;private siF:Float64Array|null=null;private bandC=-1;private bandT=-1;private scaleP=1;private scaleC=1;private scaleT=1;
  private kxE:Float64Array|null=null;private kiE:Float64Array|null=null;private sxE:Float64Array|null=null;private siE:Float64Array|null=null;private txE:Float64Array|null=null;private tiE:Float64Array|null=null;
  /** The tension table of this element: f_t(kappa_t) breakpoints and integral (the values are the law's ty). */
  private tx:Float64Array;private ti:Float64Array;
  /** The compression surface of a call: the table, psi, cf, cs and the floor. Returns kappa_c0 in the table's units. */
  private setup(kc0:number,f:number,xn:number,kbar:number):number {
    const L=this.law;
    if(kbar>=0){
      // Nonlocal: the compressive strength of the step is k(kappa_bar) of the committed average, constant within the step.
      this.fy[0]=tableValue(L.kx,L.ky,kbar);this.kx=this.fx;this.ky=this.fy;this.ki=this.fi;kc0=0;
    }else if(this.anchor>0){
      // After the peak: the anchored softening surface, associated, c = anchor s(kappa). The table's abscissa past kappa_c0 is
      // the axial plastic strain; the multiplier of this step moves it by flow = 1 - psi / 3 per unit.
      const psi=this.psi=L.softeningDilatancy,flow=this.kFlow=1-psi/3,sx=this.scaleC===1?L.sx:this.sxE!,n=sx.length;
      if(!this.sxF||this.sxF.length!==n){this.sxF=new Float64Array(n);this.siF=new Float64Array(n);}
      for(let i=0;i<n;i++)this.sxF[i]=kc0+(sx[i]-kc0)/flow;
      integrate(this.sxF,L.sy,this.siF!);
      this.kx=this.sxF;this.ky=L.sy;this.ki=this.siF!;
      this.cf=this.anchor;this.cs=0;this.floor=0;return kc0;
    }else{this.kx=this.scaleP===1?L.kx:this.kxE!;this.ky=L.ky;this.ki=this.scaleP===1?L.kint:this.kiE!;}
    this.kFlow=1;
    // The strength never falls below psi xi (the slope of the potential): k is floored at psi xi_n / cf, so that
    // c = cf k + cs >= 0 and the plastic work sigma : d eps_p = c d lambda of the step stays non-negative, also for a
    // crushed element under pressure, which keeps that friction.
    const psi=this.psi=L.dilatancy;
    const cf=this.cf=f*meridianValue(L,xn/L.input.compressiveStrength),cs=this.cs=-psi*xn;this.floor=Math.max(0,-cs/cf);
    return kc0;
  }
  private kx:Float64Array;private ky:Float64Array;private ki:Float64Array;
  /** psi of the potential of this call: the law's before the compressive peak, softeningDilatancy after it. */
  private psi=0;
  private readonly fx=new Float64Array(1);private readonly fy=new Float64Array(1);private readonly fi=new Float64Array(1);
  private mapNow(t:ArrayLike<number>,kc0:number,kt0:number,f:number):void {
    this.principalValid=false;
    const L=this.law,la=this.lambda,mu=this.mu,K=la+2*mu/3,psi=this.psi,e=L.eccentricity,ev=this.ev,a=this.a,b=this.b;
    let lc=0,lt=0;
    const cf=this.cf,cs=this.cs;
    const c0=cf*this.kv(kc0)+cs,f0=f*tableValue(this.tx,L.ty,kt0);
    // Fast paths in tensor form, without the eigenvectors: the elastic state, and (circular section) a return radial in the
    // deviatoric plane whose result satisfies Rankine. Only the rest needs the principal axes.
    {
      const tr=t[0]+t[1]+t[2],m=tr/3,d0=t[0]-m,d1=t[1]-m,d2=t[2]-m,d3=t[3],d4=t[4],d5=t[5];
      const nd=Math.sqrt(d0*d0+d1*d1+d2*d2+2*(d3*d3+d4*d4+d5*d5)),q=SQ6*mu*nd,p=K*tr;
      let r=1;
      if(e<1&&nd>0){
        // Lode angle of the deviator: cos 3 theta = (3 sqrt 3 / 2) J3 / J2^(3/2), theta = 0 on the tensile meridian.
        const J2=.5*nd*nd,J3=d0*(d1*d2-d3*d3)-d5*(d5*d2-d3*d4)+d4*(d5*d3-d1*d4);
        const c3=Math.max(-1,Math.min(1,1.5*Math.sqrt(3)*J3/(J2*Math.sqrt(J2))));lodeFactor(Math.acos(c3)/3,e,LF);r=LF[0];
      }
      if(q*r+psi*p<=c0){
        if(la*tr+2*mu*largestEigenvalue(t[0],t[1],t[2],t[3],t[4],t[5])<=f0){this.tensorFinish(t,null,0,kc0,f);return;}
      }else if(e>=1){
        const l=this.ksolve(q+psi*p-cs,3*mu+K*psi*psi,kc0,cf);
        if(q-3*mu*l>=0){
          const rr=nd>0?Math.sqrt(1.5)*l/nd:0,v=psi*l/3,P=this.plastic;
          P[0]=rr*d0+v;P[1]=rr*d1+v;P[2]=rr*d2+v;P[3]=rr*d3;P[4]=rr*d4;P[5]=rr*d5;
          const x0=t[0]-P[0],x1=t[1]-P[1],x2=t[2]-P[2];
          if(la*(x0+x1+x2)+2*mu*largestEigenvalue(x0,x1,x2,t[3]-P[3],t[4]-P[4],t[5]-P[5])<=f0){this.tensorFinish(t,P,l,kc0,f);return;}
        }
      }
    }
    jacobi(t,ev,this.V);
    this.principalCore(kc0,kt0,f,f0);
    this.finish(ev,kc0,kt0,this.lcLast,this.ltLast,true,f);
    // The base point of a tangent at this trial strain: principal strains, axes, principal stresses, multiplier.
    const B=this.principal;B[0]=ev[0];B[1]=ev[1];B[2]=ev[2];for(let q=0;q<9;q++)B[3+q]=this.V[q];
    const x0=ev[0]-a[0]-b[0],x1=ev[1]-a[1]-b[1],x2=ev[2]-a[2]-b[2],tr=x0+x1+x2;
    B[12]=la*tr+2*mu*x0;B[13]=la*tr+2*mu*x1;B[14]=la*tr+2*mu*x2;B[15]=this.lcLast;B[16]=this.ltLast;this.principalValid=true;
  }
  /** Use the closed-form principal derivative where it applies (false: differences everywhere, for checks), and how often it was used. */
  closedForm=true;closedFormCount=0;
  /** After `map`: whether the return went through the principal axes, and then [eps_1..3, V (9), sigma_1..3, lambda_c, lambda_t] of it. */
  principalValid=false;readonly principal=new Float64Array(PRINCIPAL_STRIDE);
  /** The general return in the principal axes of this.ev (the trial principal strains), after the set-up of mapNow:
   * leaves the compression plastic part in a, the Rankine part in b and the multipliers in lcLast, ltLast. */
  private principalCore(kc0:number,kt0:number,f:number,f0:number):void {
    const ev=this.ev,a=this.a,b=this.b;let lc=0,lt=0;
    a.fill(0);b.fill(0);
    const scaleE=Math.abs(ev[0])+Math.abs(ev[1])+Math.abs(ev[2])+1e-300;
    // Fixed point b = R(D(b)): D the compression return for a given Rankine part, R the Rankine return for a given
    // compression part. Pure compression returns (no Rankine flow) end after one pass; the corners (both surfaces
    // active) converge linearly, sped up by Anderson mixing of depth one.
    const g=this.g,bp=this.bp,gp=this.gp;let it=0,have=false;
    for(;it<200;it++){
      lc=this.dpBlock(ev,b,a,kc0);
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
    // Make a and b consistent: the compression part of the final b, then its Rankine part.
    if(it>0){lc=this.dpBlock(ev,b,a,kc0);lt=this.rkBlock(ev,a,b,kt0,f0,f,scaleE);}else{b[0]=g[0];b[1]=g[1];b[2]=g[2];}
    this.lcLast=lc;this.ltLast=lt;
  }
  private lcLast=0;private ltLast=0;
  /** The set-up of a return (mapNow's): the compression surface of the step, its floor, and the tensile strength f0. */
  private prepare(kc0:number,kt0:number,f:number,xn:number,kbar:number):{kc0:number;f0:number} {
    this.wwRho=-1;
    kc0=this.setup(kc0,f,xn,kbar);
    return {kc0,f0:f*tableValue(this.tx,this.law.ty,kt0)};
  }
  /** Principal stresses of the general return for the principal trial strains (e0, e1, e2) into out (prepare first). */
  private principalStress(e0:number,e1:number,e2:number,kc0:number,kt0:number,f:number,f0:number,out:Float64Array):void {
    const ev=this.ev,a=this.a,b=this.b,la=this.lambda,mu=this.mu;
    ev[0]=e0;ev[1]=e1;ev[2]=e2;this.wwRho=-1;
    this.principalCore(kc0,kt0,f,f0);
    const x0=ev[0]-a[0]-b[0],x1=ev[1]-a[1]-b[1],x2=ev[2]-a[2]-b[2],tr=x0+x1+x2;
    out[0]=la*tr+2*mu*x0;out[1]=la*tr+2*mu*x1;out[2]=la*tr+2*mu*x2;
  }
  private readonly tEv=new Float64Array(3);private readonly tV=new Float64Array(9);private readonly tS=new Float64Array(3);private readonly tP=new Float64Array(3);private readonly tD=new Float64Array(9);private readonly tW=new Float64Array(18);private readonly tU=new Float64Array(6);
  /**
   * Consistent tangent of the return at the trial strain t [xx, yy, zz, yz, xz, xy] (tensor shear) into out (6 x 6, row major,
   * stress per engineering strain), in the principal axes of t: the return is an isotropic function of the strain, so
   *   dsigma = sum_ij D_ij deps_j n_i n_i  +  sum_(i != j) g_ij deps_ij n_i n_j,   g_ij = (sigma_i - sigma_j) / (eps_i - eps_j),
   * with D = d sigma_principal / d eps_principal (forward differences of the principal return, 3 returns, step `step`) and
   * g_ij = D_ii - D_ij when the two principal strains are within 1e-9 of each other (the limit). The rotation part is exact.
   */
  tangent(t:ArrayLike<number>,kc0:number,kt0:number,f:number,xn:number,kbar:number,out:Float64Array,step=1e-9,base:Float64Array|null=null,at=0):void {
    const set=this.prepare(kc0,kt0,f,xn,kbar),k0=set.kc0,f0=set.f0,ev=this.tEv,V=this.tV,S=this.tS,P=this.tP,D=this.tD;
    let l0:number;
    let lt0:number;
    if(base){
      // The base point kept from the evaluation (`principal` after `map` of the same trial strain): the same numbers.
      ev[0]=base[at];ev[1]=base[at+1];ev[2]=base[at+2];for(let q=0;q<9;q++)V[q]=base[at+3+q];S[0]=base[at+12];S[1]=base[at+13];S[2]=base[at+14];l0=base[at+15];lt0=base[at+16];
    }else{
      jacobi(t,ev,V);this.principalStress(ev[0],ev[1],ev[2],k0,kt0,f,f0,S);l0=this.lcLast;lt0=this.ltLast;
    }
    const e0=ev[0],e1=ev[1],e2=ev[2];
    // A compression return without Rankine flow has its principal derivative in closed form; the rest by differences.
    if(this.closedForm&&lt0===0&&l0>0&&this.compressionDerivative(e0,e1,e2,l0,k0,D))this.closedFormCount++;else
    // The perturbed returns search their compression multiplier around the base one.
    {this.lHint=l0;
    try{for(let j=0;j<3;j++){
      this.principalStress(j===0?e0+step:e0,j===1?e1+step:e1,j===2?e2+step:e2,k0,kt0,f,f0,P);
      for(let i=0;i<3;i++)D[3*i+j]=(P[i]-S[i])/step;
    }}finally{this.lHint=-1;}}
    // The rows of V's columns: n_i = (V[i], V[3 + i], V[6 + i]). w_i holds n_i n_i in Voigt order: the projection of an
    // engineering strain on n_i n_i and the Voigt form of the stress n_i n_i at once.
    const W=this.tW,U=this.tU;
    for(let i=0;i<3;i++){const x=V[i],y=V[3+i],z=V[6+i],o=6*i;W[o]=x*x;W[o+1]=y*y;W[o+2]=z*z;W[o+3]=y*z;W[o+4]=x*z;W[o+5]=x*y;}
    out.fill(0);
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){const d=D[3*i+j];if(d===0)continue;const oi=6*i,oj=6*j;for(let r=0;r<6;r++){const v=d*W[oi+r];for(let c=0;c<6;c++)out[6*r+c]+=v*W[oj+c];}}
    // Pairs (1, 2), (0, 2), (0, 1): eps_ij = u . strain with u the symmetric product of n_i and n_j, the stress 2 u; so 2 g u u.
    for(let q=0;q<3;q++){
      const i=q===0?1:0,j=q===2?1:2,de=ev[i]-ev[j],g=Math.abs(de)>1e-9?(S[i]-S[j])/de:D[3*i+i]-D[3*i+j];
      const ax=V[i],ay=V[3+i],az=V[6+i],bx=V[j],by=V[3+j],bz=V[6+j];
      U[0]=ax*bx;U[1]=ay*by;U[2]=az*bz;U[3]=.5*(ay*bz+az*by);U[4]=.5*(ax*bz+az*bx);U[5]=.5*(ax*by+ay*bx);
      for(let r=0;r<6;r++){const v=2*g*U[r];for(let c=0;c<6;c++)out[6*r+c]+=v*U[c];}
    }
  }
  private readonly g=new Float64Array(3);private readonly bp=new Float64Array(3);private readonly gp=new Float64Array(3);private readonly s3=new Float64Array(3);
  /**
   * d sigma_i / d eps_j of the compression return on the Willam-Warnke section (no Rankine flow), at the principal trial
   * strains e and its multiplier l (from the return), into D (3 x 3, row major), by implicit differentiation of its two
   * equations in (theta, lambda):
   *   h = rho sin(theta_tr - theta) - c l r'(theta) = 0,     c = 2 mu sqrt(3/2),
   *   R = sqrt(3/2) rho_n r(theta) + psi (p - K psi l) - (cf k(kappa_0 + l) + cs) = 0,   rho_n = rho cos(theta_tr - theta) - c l r(theta),
   * with rho, theta_tr (through the fold of the Lode angle) and p = K tr functions of e, and sigma_i = K (tr - psi l) + n_i,
   * n the returned deviator. Returns false (the caller differentiates numerically) for a circular section, a deviator at
   * the apex, or a returned deviator of zero length.
   */
  private compressionDerivative(e0:number,e1:number,e2:number,l:number,kc0:number,D:Float64Array):boolean {
    const L=this.law,mu=this.mu,K=this.lambda+2*mu/3,psi=this.psi,e=L.eccentricity,cf=this.cf;
    if(e>=1)return false;
    const X=2*mu*(2*e0-e1-e2)/SQ6,Y=2*mu*(e1-e2)/SQ2,rho=Math.hypot(X,Y);
    if(!(rho>0))return false;
    let phi=Math.atan2(Y,X);if(phi<0)phi+=2*Math.PI;
    const pm=phi%TWO_THIRD_PI,base=phi-pm,lower=pm<=THIRD_PI,th0=lower?pm:TWO_THIRD_PI-pm,phi0=lower?base:base+TWO_THIRD_PI,sgn=lower?1:-1;
    const c=2*mu*SQ15,state=this.wwState;this.wwRho=-1;
    this.wwDeviator(rho,th0,c*l,e,state);
    const rn=state[0],th=state[1];if(!(rn>0))return false;
    lodeFactor2(th,e,LF3);const r=LF3[0],r1=LF3[1],r2=LF3[2],cs0=Math.cos(th0-th),sn0=Math.sin(th0-th),t=c*l;
    // Partial derivatives of h and R.
    const hTh=-rho*cs0-t*r2,hL=-c*r1,hRho=sn0,hTh0=rho*cs0;
    const at=kc0+l,table=tableValue(this.kx,this.ky,at),slope=table>=this.floor?tableSlope(this.kx,this.ky,at):0;
    const RTh=SQ15*rn*r1,RL=-SQ15*c*r*r-K*psi*psi-cf*slope,RRho=SQ15*cs0*r,RTh0=-SQ15*rho*sn0*r,RP=psi;
    const det=hTh*RL-hL*RTh;if(!(Math.abs(det)>0))return false;
    const ph=phi0+sgn*th,cph=Math.cos(ph),sph=Math.sin(ph);
    for(let j=0;j<3;j++){
      // Inputs for d e_j = 1.
      const dX=2*mu*(j===0?2:-1)/SQ6,dY=2*mu*(j===0?0:j===1?1:-1)/SQ2,dRho=(X*dX+Y*dY)/rho,dPhi=(X*dY-Y*dX)/(rho*rho),dTh0=sgn*dPhi,dP=K;
      const bh=-(hRho*dRho+hTh0*dTh0),bR=-(RRho*dRho+RTh0*dTh0+RP*dP);
      const dTh=(bh*RL-hL*bR)/det,dL=(hTh*bR-bh*RTh)/det;
      const dRn=cs0*dRho-rho*sn0*(dTh0-dTh)-c*r*dL-t*r1*dTh,dPh=sgn*dTh;
      const dXn=dRn*cph-rn*sph*dPh,dYn=dRn*sph+rn*cph*dPh;
      const dn0=2*dXn/SQ6,dn1=-dXn/SQ6+dYn/SQ2,dn2=-dXn/SQ6-dYn/SQ2,dm=K*(1-psi*dL);
      D[j]=dm+dn0;D[3+j]=dm+dn1;D[6+j]=dm+dn2;
    }
    return true;
  }
  /** Compression return of the strain ev - b into the plastic part a; returns the kappa_c increment. */
  private dpBlock(ev:Float64Array,b:Float64Array,a:Float64Array,kc0:number):number {
    const L=this.law,mu=this.mu,K=this.lambda+2*mu/3,psi=this.psi,e=L.eccentricity,cf=this.cf,cs=this.cs;
    const x0=ev[0]-b[0],x1=ev[1]-b[1],x2=ev[2]-b[2],tr=x0+x1+x2,m=tr/3,d0=x0-m,d1=x1-m,d2=x2-m,nd=Math.sqrt(d0*d0+d1*d1+d2*d2);
    const q=SQ6*mu*nd,p=K*tr,c0=cf*this.kv(kc0)+cs;
    if(e>=1){
      if(q+psi*p<=c0){a[0]=a[1]=a[2]=0;return 0;}
      let l=this.ksolve(q+psi*p-cs,3*mu+K*psi*psi,kc0,cf);
      if(q-3*mu*l>=0){const r=nd>0?Math.sqrt(1.5)*l/nd:0,v=psi*l/3;a[0]=r*d0+v;a[1]=r*d1+v;a[2]=r*d2+v;return l;}
      // Apex: the deviatoric elastic strain returns to zero; the volumetric part from psi p = c.
      const lmin=Math.sqrt(2/3)*nd;l=Math.max(lmin,psi!==0?this.ksolve(K*tr*psi-cs,K*psi*psi,kc0,cf):lmin);
      const v=psi*l/3;a[0]=d0+v;a[1]=d1+v;a[2]=d2+v;return l;
    }
    // Willam-Warnke section. Deviatoric stress in the pi-plane: X along the tensile meridian of axis 0, Y across.
    const s0=2*mu*d0,s1=2*mu*d1,s2=2*mu*d2,X=(2*s0-s1-s2)/SQ6,Y=(s1-s2)/SQ2,rho=Math.hypot(X,Y);
    let phi=Math.atan2(Y,X);if(phi<0)phi+=2*Math.PI;
    // Fold: theta in [0, pi/3] from the nearest tensile meridian phi0, sgn the side.
    const pm=phi%TWO_THIRD_PI,base=phi-pm,lower=pm<=THIRD_PI,th0=lower?pm:TWO_THIRD_PI-pm,phi0=lower?base:base+TWO_THIRD_PI,sgn=lower?1:-1;
    lodeFactor(th0,e,LF);
    if(SQ15*rho*LF[0]+psi*p<=c0){a[0]=a[1]=a[2]=0;return 0;}
    const state=this.wwState;
    // R(lambda): yield function at the return of step lambda (decreasing in lambda).
    const R=(l:number):number=>{
      this.wwDeviator(rho,th0,2*mu*l*SQ15,e,state);
      return SQ15*state[0]*state[2]+psi*(p-K*psi*l)-(cf*this.kv(kc0+l)+cs);
    };
    let lo=0,Rlo=0,hi=0,Rhi=0,bracketed=false;
    if(this.lHint>0){
      const a0=this.lHint*(1-1e-4),a1=this.lHint*(1+1e-4),R0=R(a0);
      if(R0>0){const R1=R(a1);if(R1<0){lo=a0;Rlo=R0;hi=a1;Rhi=R1;bracketed=true;}}
    }
    if(!bracketed){
      lo=0;Rlo=R(0);hi=Rlo/(3*mu+K*psi*psi);Rhi=R(hi);
      for(let k=0;k<200&&Rhi>0;k++){lo=hi;Rlo=Rhi;hi*=2;Rhi=R(hi);}
    }
    // Illinois regula falsi on [lo, hi].
    let l=hi,side=0;
    for(let k=0;k<200;k++){
      l=(lo*Rhi-hi*Rlo)/(Rhi-Rlo);
      if(!(l>lo&&l<hi))l=.5*(lo+hi);
      const Rl=R(l);
      if(Rl===0||hi-lo<=4e-16*hi)break;
      if(Rl>0){lo=l;Rlo=Rl;if(side===1)Rhi*=.5;side=1;}else{hi=l;Rhi=Rl;if(side===-1)Rlo*=.5;side=-1;}
    }
    this.wwDeviator(rho,th0,2*mu*l*SQ15,e,state);
    const ph=phi0+sgn*state[1],Xn=state[0]*Math.cos(ph),Yn=state[0]*Math.sin(ph),dp=psi*l/3;
    const n0=2*Xn/SQ6,n1=-Xn/SQ6+Yn/SQ2,n2=-Xn/SQ6-Yn/SQ2;
    a[0]=(s0-n0)/(2*mu)+dp;a[1]=(s1-n1)/(2*mu)+dp;a[2]=(s2-n2)/(2*mu)+dp;
    return l;
  }
  private readonly wwState=new Float64Array(3);
  /** The Lode angle of the last deviatoric return of the present trial (rho, theta_tr): the start of the next one. */
  private wwRho=-1;private wwTh0=-1;private wwLast=0;
  /** Deviatoric return on the Willam-Warnke section for the step t = 2 mu lambda sqrt(3/2) from (rho, theta) of the
   * trial: out = [rho, theta, r(theta)]. theta solves h(theta) = rho_tr sin(theta_tr - theta) - t r'(theta) = 0 on
   * [theta_tr, pi/3] by Newton's method with the exact r'' (safeguarded by bisection), started from the root of the last
   * call with the same trial, until h is at the rounding of its terms. */
  private wwDeviator(rho:number,th0:number,t:number,e:number,out:Float64Array):void {
    let th=th0,fresh=false;
    if(t>0&&th0<THIRD_PI&&rho>0){
      let lo=th0,hi=THIRD_PI;
      if(rho===this.wwRho&&th0===this.wwTh0&&this.wwLast>lo&&this.wwLast<hi)th=this.wwLast;
      for(let k=0;k<100;k++){
        lodeFactor2(th,e,LF3);const sn=rho*Math.sin(th0-th),h=sn-t*LF3[1];
        // h is known to the rounding of rho sin(theta_tr - theta): about rho times the spacing of doubles near theta.
        // r(theta) of lodeFactor2 is lodeFactor's to the bit (the same expression): kept when the loop stops at this theta.
        fresh=true;
        if(h===0||Math.abs(h)<=1e-15*(rho+Math.abs(t*LF3[1])))break;
        if(h>0)lo=th;else hi=th;
        const dh=-rho*Math.cos(th0-th)-t*LF3[2];
        let next=dh<0?th-h/dh:.5*(lo+hi);
        if(next===th)break;
        if(!(next>lo&&next<hi))next=.5*(lo+hi);
        if(hi-lo<=1e-16)break;
        th=next;fresh=false;
      }
      this.wwRho=rho;this.wwTh0=th0;this.wwLast=th;
    }
    let r:number;if(fresh)r=LF3[0];else{lodeFactor(th,e,LF);r=LF[0];}
    out[0]=Math.max(0,rho*Math.cos(th0-th)-t*r);out[1]=th;out[2]=r;
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
      const B=solveTable(this.tx,L.ty,cc/dd,1/dd,kt0,f),ftn=f*tableValue(this.tx,L.ty,kt0+B);
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
  /** Dissipation of the compression surface over [kc0, kc0 + l]: int c d kappa = cf int k + cs l. */
  private compressionWork(kc0:number,l:number):number {
    if(!(l>0))return 0;
    let w=tableIntegral(this.kx,this.ky,this.ki,kc0+l)-tableIntegral(this.kx,this.ky,this.ki,kc0);
    if(this.floor>0)w+=floorExcess(this.kx,this.ky,kc0,kc0+l,this.floor);
    return this.cf*w+this.cs*l;
  }
  /** Floor of k (table units) of this call: psi xi_n / cf. */
  private floor=0;
  /** k(kappa) with the floor. */
  private kv(at:number):number {return Math.max(this.floor,tableValue(this.kx,this.ky,at));}
  /** The lambda >= 0 at which A - B lambda - f max(k, floor)(kappa0 + lambda) = 0. */
  private ksolve(A:number,B:number,kappa0:number,f:number):number {
    const l=solveTable(this.kx,this.ky,A,B,kappa0,f);
    if(this.floor===0||tableValue(this.kx,this.ky,kappa0+l)>=this.floor)return l;
    // The root lies where the floor holds: A - B lambda - f floor = 0.
    return Math.max(0,(A-f*this.floor)/B);
  }
  /** Result of a fast path: elastic (P null) or a radial compression return with the plastic increment P and kappa_c increment l. */
  private tensorFinish(t:ArrayLike<number>,P:Float64Array|null,l:number,kc0:number,f:number):void {
    const la=this.lambda,mu=this.mu,S=this.stress;
    const e0=t[0]-(P?P[0]:0),e1=t[1]-(P?P[1]:0),e2=t[2]-(P?P[2]:0),e3=t[3]-(P?P[3]:0),e4=t[4]-(P?P[4]:0),e5=t[5]-(P?P[5]:0),tr=e0+e1+e2;
    S[0]=la*tr+2*mu*e0;S[1]=la*tr+2*mu*e1;S[2]=la*tr+2*mu*e2;S[3]=2*mu*e3;S[4]=2*mu*e4;S[5]=2*mu*e5;
    this.elastic=.5*(S[0]*e0+S[1]*e1+S[2]*e2)+S[3]*e3+S[4]*e4+S[5]*e5;
    this.energy=this.elastic+this.compressionWork(kc0,l);this.dKappaC=l*this.kFlow;this.dKappaT=0;this.yielded=l>0;
    if(!P)this.plastic.fill(0);
    void f;
  }
  private finish(ev:Float64Array,kc0:number,kt0:number,lc:number,lt:number,yielded:boolean,f:number):void {
    const L=this.law,la=this.lambda,mu=this.mu,a=this.a,b=this.b,V=this.V,S=this.stress,P=this.plastic;
    if(!yielded){a.fill(0);b.fill(0);}
    const e0=ev[0]-a[0]-b[0],e1=ev[1]-a[1]-b[1],e2=ev[2]-a[2]-b[2],tr=e0+e1+e2,s0=la*tr+2*mu*e0,s1=la*tr+2*mu*e1,s2=la*tr+2*mu*e2;
    const p0=a[0]+b[0],p1=a[1]+b[1],p2=a[2]+b[2];
    this.elastic=.5*(s0*e0+s1*e1+s2*e2);
    const dt=lt>0?tableIntegral(this.tx,L.ty,this.ti,kt0+lt)-tableIntegral(this.tx,L.ty,this.ti,kt0):0;
    this.energy=this.elastic+this.compressionWork(kc0,lc)+f*dt;
    this.dKappaC=lc*this.kFlow;this.dKappaT=lt;this.yielded=lc>0||lt>0;
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

/** Strength loss of an element: 1 - s / f_cm after the compressive peak (s the uniaxial strength left; with the nonlocal
 * option 1 - k / k_peak), 1 - f_t / f_t0 in tension, the larger. scaleC and scaleT are the element's band scales (`bandScale`). */
export function concreteDamage(law:ConcreteLaw,kappaC:number,kappaT:number,scaleC=1,scaleT=1,softening=true):number {
  const kp=law.kappaPeak,dt=1-tableValue(law.tx,law.ty,kappaT/scaleT)/law.ty[0];
  // kappa_c after the peak is on the softening surface (local law), or on the lagged-pressure table (nonlocal: 1 - k / k_peak).
  const dc=kappaC<=kp?0:softening?1-tableValue(law.sx,law.sy,kp+(kappaC-kp)/scaleC):1-tableValue(law.kx,law.ky,kappaC)/law.ky[law.peakIndex];
  return Math.max(0,Math.min(1,Math.max(dc,dt)));
}
/** The anchor of an element's softening surface (`ConcreteReturn.element`) from the stress S [xx, yy, zz, yz, xz, xy] of the
 * state in which it passed the compressive peak with kappa_c: q r(theta) + psi_s p over the uniaxial strength left s(kappa_c)
 * / f_cm, so that the surface passes through that state. At least 1e-3 f f_cm (a peak passed in a state near tension). */
export function softeningAnchor(law:ConcreteLaw,S:ArrayLike<number>,kappaC:number,scaleC:number,f:number):number {
  const p=(S[0]+S[1]+S[2])/3,d0=S[0]-p,d1=S[1]-p,d2=S[2]-p,d3=S[3],d4=S[4],d5=S[5];
  const J2=.5*(d0*d0+d1*d1+d2*d2)+d3*d3+d4*d4+d5*d5,q=Math.sqrt(3*J2);
  let r=1;
  if(law.eccentricity<1&&J2>0){
    const J3=d0*(d1*d2-d3*d3)-d5*(d5*d2-d3*d4)+d4*(d5*d3-d1*d4),c3=Math.max(-1,Math.min(1,1.5*Math.sqrt(3)*J3/(J2*Math.sqrt(J2))));
    lodeFactor(Math.acos(c3)/3,law.eccentricity,LF);r=LF[0];
  }
  const kp=law.kappaPeak,left=tableValue(law.sx,law.sy,kp+(kappaC-kp)/scaleC),floor=1e-3*f*law.input.compressiveStrength;
  return Math.max(floor,q*r+law.softeningDilatancy*p)/Math.max(left,1e-6);
}

/** The weights of the nonlocal average of a mesh: for each element, its neighbours within 2 l and exp(-(r / l)^2) V_j,
 * normalised (CSR). A constant of the solid. */
export class ConcreteNonlocal {
  readonly start:Uint32Array;readonly index:Uint32Array;readonly weight:Float64Array;
  constructor(positions:ArrayLike<number>,tets:ArrayLike<number>,volumes:ArrayLike<number>,length:number){
    const n=volumes.length,cx=new Float64Array(3*n);
    for(let e=0;e<n;e++)for(let k=0;k<3;k++){let v=0;for(let q=0;q<4;q++)v+=positions[3*tets[4*e+q]+k];cx[3*e+k]=v/4;}
    // Cells of size 2 l hash the centroids; each element looks in its cell and the 26 around it.
    const R=2*length,R2=R*R,cell=new Map<string,number[]>(),key=(i:number,j:number,k:number)=>`${i},${j},${k}`;
    for(let e=0;e<n;e++){const k=key(Math.floor(cx[3*e]/R),Math.floor(cx[3*e+1]/R),Math.floor(cx[3*e+2]/R));let l=cell.get(k);if(!l){l=[];cell.set(k,l);}l.push(e);}
    const start=[0],index:number[]=[],weight:number[]=[];
    for(let e=0;e<n;e++){
      const i0=Math.floor(cx[3*e]/R),j0=Math.floor(cx[3*e+1]/R),k0=Math.floor(cx[3*e+2]/R),found:number[]=[];
      for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)for(let dk=-1;dk<=1;dk++){const l=cell.get(key(i0+di,j0+dj,k0+dk));if(l)for(const j of l)found.push(j);}
      found.sort((a,b)=>a-b);let sum=0;const at=weight.length;
      for(const j of found){const dx=cx[3*j]-cx[3*e],dy=cx[3*j+1]-cx[3*e+1],dz=cx[3*j+2]-cx[3*e+2],r2=dx*dx+dy*dy+dz*dz;if(r2>R2)continue;const w=Math.exp(-r2/(length*length))*volumes[j];index.push(j);weight.push(w);sum+=w;}
      for(let q=at;q<weight.length;q++)weight[q]/=sum;
      start.push(weight.length);
    }
    this.start=Uint32Array.from(start);this.index=Uint32Array.from(index);this.weight=Float64Array.from(weight);
  }
  /** out_e = sum_j w_ej kappa_j. */
  average(kappa:ArrayLike<number>,out:Float64Array):void {
    const s=this.start,ix=this.index,w=this.weight;
    for(let e=0;e<out.length;e++){let v=0;for(let q=s[e];q<s[e+1];q++)v+=w[q]*kappa[ix[q]];out[e]=v;}
  }
}

/** One reinforcing bar embedded in a solid (perfect bond). SI units. */
export interface ReinforcementBarInput {
  /** The bar's axis as a polyline [x, y, z, x, y, z, ...] in the solid's reference frame, at least two points, inside the mesh. */
  readonly points:readonly number[];
  /** Cross-section area, m^2 (pi d^2 / 4 for one bar of diameter d, or the sum of a layer of bars). */
  readonly area:number;
  /** Steel: Young's modulus and yield stress, Pa; linear hardening modulus after yield, Pa (default 0). */
  readonly youngModulus:number;readonly yieldStress:number;readonly hardeningModulus?:number;
}
/** The reinforcing bars to embed in a solid; see the steel and bar inputs above. */
export interface ReinforcementInput {readonly bars:readonly ReinforcementBarInput[]}

/**
 * Reinforcing bars embedded in a tetrahedral solid: each bar is cut into straight two-node truss segments no longer than
 * half the mean element size, and each segment end is a point inside an element whose displacement is interpolated from
 * that element's four nodes (an embedded-element constraint: perfect bond, no slip). The axial strain of a segment is
 * the Green-Lagrange strain of its chord (or its small-strain projection with the linear model); the steel is elastic-
 * plastic with linear hardening (a one-dimensional return mapping, the incremental potential of which adds to the solid's,
 * so the stiffness stays symmetric). Bending and shear of the bars (dowel action) are not modelled. The geometry is a
 * constant of the solid; the plastic strain and hardening of each segment are the solid's state.
 */
export class ConcreteReinforcement {
  readonly segmentCount:number;
  /** Per segment: the bar it belongs to, its two end points, reference vector (3) and length, area, E, yield stress, H. */
  readonly bar:Uint32Array;readonly ends:Uint32Array;readonly D:Float64Array;readonly length:Float64Array;
  readonly area:Float64Array;readonly E:Float64Array;readonly sy:Float64Array;readonly H:Float64Array;
  /** Per point: the four nodes of its element and their weights (barycentric coordinates). */
  readonly nodes:Uint32Array;readonly weights:Float64Array;
  /** Reference positions of the points (3 per point). */
  readonly points:Float64Array;
  /** Scratch of the last stored evaluation: axial stress, tangent modulus and dEps / dDelta (3) per segment. */
  private readonly tS:Float64Array;private readonly tE:Float64Array;private readonly tg:Float64Array;
  constructor(input:unknown,X:ArrayLike<number>,tets:ArrayLike<number>,meanSize:number){
    const r=record(input,'reinforcement');onlyKeys(r,['bars'],'reinforcement');
    if(!Array.isArray(r.bars)||r.bars.length<1||r.bars.length>4096)throw new EngineError('INVALID_PAYLOAD','reinforcement.bars takes 1 to 4096 bars.');
    const tetCount=tets.length/4,locate=tetLocator(X,tets);
    const pts:number[]=[],nodes:number[]=[],weights:number[]=[],seg:number[][]=[],w=[0,0,0,0];
    const addPoint=(x:number,y:number,z:number,label:string):number=>{
      const e=locate(x,y,z,w);if(e<0)throw new EngineError('INVALID_PAYLOAD',`${label} (${x}, ${y}, ${z}) is outside the solid.`);
      for(let q=0;q<4;q++){nodes.push(tets[4*e+q]);weights.push(w[q]);}pts.push(x,y,z);return pts.length/3-1;
    };
    r.bars.forEach((raw:unknown,b:number)=>{
      const o=record(raw,`bars[${b}]`);onlyKeys(o,['points','area','youngModulus','yieldStress','hardeningModulus'],`bars[${b}]`);
      if(!Array.isArray(o.points)||o.points.length<6||o.points.length%3)throw new EngineError('INVALID_PAYLOAD',`bars[${b}].points takes at least two points [x, y, z, ...].`);
      const P=o.points.map((v:unknown,i:number)=>finite(v,`bars[${b}].points[${i}]`,-1e6,1e6));
      const A=finite(o.area,`bars[${b}].area`,1e-12,1e3),E=finite(o.youngModulus,`bars[${b}].youngModulus`,1,1e13),sy=finite(o.yieldStress,`bars[${b}].yieldStress`,1,1e11),H=o.hardeningModulus===undefined?0:finite(o.hardeningModulus,`bars[${b}].hardeningModulus`,0,1e13);
      let prev=addPoint(P[0],P[1],P[2],`bars[${b}] point 0`);
      for(let i=3;i<P.length;i+=3){
        const dx=P[i]-P[i-3],dy=P[i+1]-P[i-2],dz=P[i+2]-P[i-1],len=Math.hypot(dx,dy,dz);
        if(!(len>0))throw new EngineError('INVALID_PAYLOAD',`bars[${b}] repeats a point.`);
        const n=Math.max(1,Math.ceil(len/(.5*meanSize)));
        for(let k=1;k<=n;k++){const t=k/n,next=addPoint(P[i-3]+t*dx,P[i-2]+t*dy,P[i-1]+t*dz,`bars[${b}] point`);seg.push([b,prev,next,A,E,sy,H]);prev=next;}
      }
    });
    const m=this.segmentCount=seg.length;void tetCount;
    this.bar=new Uint32Array(m);this.ends=new Uint32Array(2*m);this.D=new Float64Array(3*m);this.length=new Float64Array(m);
    this.area=new Float64Array(m);this.E=new Float64Array(m);this.sy=new Float64Array(m);this.H=new Float64Array(m);
    this.points=Float64Array.from(pts);this.nodes=Uint32Array.from(nodes);this.weights=Float64Array.from(weights);
    seg.forEach(([b,a,c,A,E,sy,H],s)=>{
      this.bar[s]=b;this.ends[2*s]=a;this.ends[2*s+1]=c;
      for(let k=0;k<3;k++)this.D[3*s+k]=pts[3*c+k]-pts[3*a+k];
      this.length[s]=Math.hypot(this.D[3*s],this.D[3*s+1],this.D[3*s+2]);this.area[s]=A;this.E[s]=E;this.sy[s]=sy;this.H[s]=H;
    });
    this.tS=new Float64Array(m);this.tE=new Float64Array(m);this.tg=new Float64Array(3*m);
  }
  /** Displacement difference of segment s's ends from the nodal field u into out. */
  private delta(s:number,u:ArrayLike<number>,out:number[]):void {
    const a=this.ends[2*s],b=this.ends[2*s+1],N=this.nodes,W=this.weights;out[0]=out[1]=out[2]=0;
    for(let q=0;q<4;q++){const na=3*N[4*a+q],nb=3*N[4*b+q],wa=W[4*a+q],wb=W[4*b+q];for(let k=0;k<3;k++)out[k]+=wb*u[nb+k]-wa*u[na+k];}
  }
  /** Adds the force f on end b and -f on end a of segment s to out. */
  private scatter(s:number,f:ArrayLike<number>,out:Float64Array):void {
    const a=this.ends[2*s],b=this.ends[2*s+1],N=this.nodes,W=this.weights;
    for(let q=0;q<4;q++){const na=3*N[4*a+q],nb=3*N[4*b+q],wa=W[4*a+q],wb=W[4*b+q];for(let k=0;k<3;k++){out[nb+k]+=wb*f[k];out[na+k]-=wa*f[k];}}
  }
  /** Axial strain of segment s and its gradient with respect to the end displacement difference (into g). */
  private strain(s:number,linear:boolean,d:number[],g:number[]):number {
    const L2=this.length[s]*this.length[s],Dx=this.D[3*s],Dy=this.D[3*s+1],Dz=this.D[3*s+2];
    if(linear){g[0]=Dx/L2;g[1]=Dy/L2;g[2]=Dz/L2;return (Dx*d[0]+Dy*d[1]+Dz*d[2])/L2;}
    g[0]=(Dx+d[0])/L2;g[1]=(Dy+d[1])/L2;g[2]=(Dz+d[2])/L2;
    return (Dx*d[0]+Dy*d[1]+Dz*d[2]+.5*(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]))/L2;
  }
  /** Energy of the bars (elastic plus the plastic work of the increment from the committed ep, alpha), J; adds the nodal
   * forces to fint. With `store`, keeps the tangent data; with `commit`, writes the new plastic state and returns the
   * plastic work of the increment instead; with `storedOnly`, the elastic energy only. */
  energy(linear:boolean,u:ArrayLike<number>,fint:Float64Array|null,ep:Float64Array,alpha:Float64Array,store:boolean,commit=false,storedOnly=false):number {
    const d=[0,0,0],g=[0,0,0],f=[0,0,0];let total=0,work=0;
    for(let s=0;s<this.segmentCount;s++){
      this.delta(s,u,d);const eps=this.strain(s,linear,d,g),E=this.E[s],H=this.H[s],a0=alpha[s];
      const tr=E*(eps-ep[s]),over=Math.abs(tr)-(this.sy[s]+H*a0),dg=over>0?over/(E+H):0,sign=tr<0?-1:1,S=tr-E*dg*sign,AL=this.area[s]*this.length[s];
      const ee=eps-ep[s]-dg*sign,plastic=dg*(this.sy[s]+H*(a0+.5*dg));
      total+=AL*(.5*E*ee*ee+(storedOnly?0:plastic));
      if(fint){for(let k=0;k<3;k++)f[k]=AL*S*g[k];this.scatter(s,f,fint);}
      if(store){this.tS[s]=S;this.tE[s]=dg>0?E*H/(E+H):E;this.tg[3*s]=g[0];this.tg[3*s+1]=g[1];this.tg[3*s+2]=g[2];}
      if(commit){ep[s]+=dg*sign;alpha[s]=a0+dg;work+=AL*plastic;}
    }
    return commit?work:total;
  }
  /** out += K x with the tangent of the last stored evaluation (geometric term with the Green-Lagrange strain). */
  tangent(linear:boolean,x:ArrayLike<number>,out:Float64Array):void {
    const d=[0,0,0],f=[0,0,0];
    for(let s=0;s<this.segmentCount;s++){
      this.delta(s,x,d);const AL=this.area[s]*this.length[s],g0=this.tg[3*s],g1=this.tg[3*s+1],g2=this.tg[3*s+2],gd=g0*d[0]+g1*d[1]+g2*d[2],geo=linear?0:this.tS[s]/(this.length[s]*this.length[s]);
      f[0]=AL*(this.tE[s]*gd*g0+geo*d[0]);f[1]=AL*(this.tE[s]*gd*g1+geo*d[1]);f[2]=AL*(this.tE[s]*gd*g2+geo*d[2]);
      this.scatter(s,f,out);
    }
  }
  /** The distinct nodes of segment s and their signed weights (end b minus end a) into nodes / c; returns their number (2 to 8). */
  private segmentNodes(s:number,nodes:number[],c:number[]):number {
    const a=this.ends[2*s],b=this.ends[2*s+1],N=this.nodes,W=this.weights;let count=0;
    for(let side=0;side<2;side++)for(let q=0;q<4;q++){
      const o=4*(side?b:a)+q,n=N[o],w=side?W[o]:-W[o];let i=0;
      while(i<count&&nodes[i]!==n)i++;
      if(i===count){nodes[count]=n;c[count]=w;count++;}else c[i]+=w;
    }
    return count;
  }
  /** Calls `visit(a, b)` for every pair of different nodes a bar segment couples (each unordered pair at least once): the
   * entries the bars add to the sparse structure of the stiffness beyond the pairs that share an element. */
  couplings(visit:(a:number,b:number)=>void):void {
    const nodes:number[]=[],c:number[]=[];
    for(let s=0;s<this.segmentCount;s++){const m=this.segmentNodes(s,nodes,c);for(let i=0;i<m;i++)for(let j=i+1;j<m;j++)visit(nodes[i],nodes[j]);}
  }
  /** Assembles `scale` times the tangent of the last stored evaluation (the matrix `tangent` multiplies by): `add(a, b, M)`
   * receives the 3 x 3 block of each unordered node pair (and each node's own block) of every segment, M reused between calls. */
  assembleTangent(linear:boolean,scale:number,add:(a:number,b:number,M:Float64Array)=>void):void {
    const nodes:number[]=[],c:number[]=[],K=new Float64Array(9),M=new Float64Array(9);
    for(let s=0;s<this.segmentCount;s++){
      const AL=scale*this.area[s]*this.length[s],tE=this.tE[s],geo=linear?0:this.tS[s]/(this.length[s]*this.length[s]);
      for(let p=0;p<3;p++)for(let q=0;q<3;q++)K[3*p+q]=AL*(tE*this.tg[3*s+p]*this.tg[3*s+q]+(p===q?geo:0));
      const m=this.segmentNodes(s,nodes,c);
      for(let i=0;i<m;i++)for(let j=i;j<m;j++){const w=c[i]*c[j];for(let q=0;q<9;q++)M[q]=w*K[q];add(nodes[i],nodes[j],M);}
    }
  }
  /** Adds an estimate of the diagonal of the bars' elastic stiffness to kd (the preconditioner). */
  diagonal(kd:Float64Array):void {
    for(let s=0;s<this.segmentCount;s++){
      const k=this.area[s]*this.E[s]/this.length[s],L=this.length[s];
      for(const p of [this.ends[2*s],this.ends[2*s+1]])for(let q=0;q<4;q++){const n=3*this.nodes[4*p+q],w=this.weights[4*p+q];for(let c=0;c<3;c++){const t=this.D[3*s+c]/L;kd[n+c]+=k*w*w*t*t;}}
    }
  }
  /** Axial force (N) and axial strain of each segment in the displacement field u, plastic state ep (no commit). */
  forces(linear:boolean,u:ArrayLike<number>,ep:Float64Array,alpha:Float64Array,force:Float64Array,strain:Float64Array):void {
    const d=[0,0,0],g=[0,0,0];
    for(let s=0;s<this.segmentCount;s++){
      this.delta(s,u,d);const eps=this.strain(s,linear,d,g),E=this.E[s],H=this.H[s],tr=E*(eps-ep[s]),over=Math.abs(tr)-(this.sy[s]+H*alpha[s]),dg=over>0?over/(E+H):0;
      force[s]=this.area[s]*(tr-E*dg*(tr<0?-1:1));strain[s]=eps;
    }
  }
}

/** A function that finds the element containing a point and its barycentric coordinates (into w), or -1. */
function tetLocator(X:ArrayLike<number>,tets:ArrayLike<number>):(x:number,y:number,z:number,w:number[])=>number {
  const n=tets.length/4,box=new Float64Array(6*n);let size=0;
  for(let e=0;e<n;e++){
    for(let k=0;k<3;k++){let lo=Infinity,hi=-Infinity;for(let q=0;q<4;q++){const v=X[3*tets[4*e+q]+k];lo=Math.min(lo,v);hi=Math.max(hi,v);}box[6*e+k]=lo;box[6*e+3+k]=hi;size=Math.max(size,hi-lo);}
  }
  const cell=size>0?size:1,grid=new Map<string,number[]>(),key=(i:number,j:number,k:number)=>`${i},${j},${k}`;
  for(let e=0;e<n;e++){
    const i0=Math.floor(box[6*e]/cell),i1=Math.floor(box[6*e+3]/cell),j0=Math.floor(box[6*e+1]/cell),j1=Math.floor(box[6*e+4]/cell),k0=Math.floor(box[6*e+2]/cell),k1=Math.floor(box[6*e+5]/cell);
    for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(let k=k0;k<=k1;k++){const id=key(i,j,k);let l=grid.get(id);if(!l){l=[];grid.set(id,l);}l.push(e);}
  }
  return (x,y,z,w)=>{
    const list=grid.get(key(Math.floor(x/cell),Math.floor(y/cell),Math.floor(z/cell)));if(!list)return -1;
    let best=-1,bestMin=-Infinity;const b=[0,0,0,0];
    for(const e of list){
      const p0=3*tets[4*e],p1=3*tets[4*e+1],p2=3*tets[4*e+2],p3=3*tets[4*e+3];
      const a=X[p1]-X[p0],bb=X[p2]-X[p0],c=X[p3]-X[p0],d=X[p1+1]-X[p0+1],ee=X[p2+1]-X[p0+1],f=X[p3+1]-X[p0+1],g=X[p1+2]-X[p0+2],h=X[p2+2]-X[p0+2],ii=X[p3+2]-X[p0+2];
      const det=a*(ee*ii-f*h)-bb*(d*ii-f*g)+c*(d*h-ee*g),rx=x-X[p0],ry=y-X[p0+1],rz=z-X[p0+2];
      const l1=(rx*(ee*ii-f*h)-bb*(ry*ii-f*rz)+c*(ry*h-ee*rz))/det,l2=(a*(ry*ii-f*rz)-rx*(d*ii-f*g)+c*(d*rz-ry*g))/det,l3=(a*(ee*rz-ry*h)-bb*(d*rz-ry*g)+rx*(d*h-ee*g))/det;
      b[0]=1-l1-l2-l3;b[1]=l1;b[2]=l2;b[3]=l3;const mn=Math.min(b[0],b[1],b[2],b[3]);
      if(mn>bestMin){bestMin=mn;best=e;w[0]=b[0];w[1]=b[1];w[2]=b[2];w[3]=b[3];}
    }
    if(bestMin<-1e-9)return -1;
    // Clamp the rounding of a point on a face so the weights stay a partition of unity.
    let sum=0;for(let q=0;q<4;q++){w[q]=Math.max(0,w[q]);sum+=w[q];}for(let q=0;q<4;q++)w[q]/=sum;
    return best;
  };
}
