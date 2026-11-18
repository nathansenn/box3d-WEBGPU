/**
 * The granular lab in SI: the discrete element solver (src/engine/granular.ts, docs/GRANULAR.md) with grains from the
 * material library where it has them, in a tray drawn at ten times its size. See docs/STUDIO_FLOW_LABS.md.
 *
 * Coarse-graining: the grains are spheres of the diameter the lab's control sets (7 to 16 mm). They stand for real
 * grains of the named material that are smaller (sand 0.2 to 2 mm, glass beads 1 to 4 mm). Density, grain friction and
 * restitution are the material's; the rolling resistance stands in for grain shape and is set so that a pile of the
 * stand-in grains has the material's measured angle of repose where one was opened (glass beads), authored otherwise.
 * The outcomes compared with experiments (angle of repose, runout over column length against aspect ratio) do not depend
 * on the grain size; times scale with sqrt(length / g) and are those of the apparatus.
 *
 * The contacts are linear springs with k_n = 4000 m g / d, the stiffness of the solver's validated bulk cases (soft: an
 * overlap of about 0.3% of a diameter under a column of ten grains; real glass is about a thousand times stiffer).
 */
import {Granular,granularLattice,type DemExecutor,type GranularMaterial} from '../../engine/granular';
import {grainMaterial} from '../../engine/materials';

export interface GrainSI {readonly material:GranularMaterial;readonly verified:boolean;readonly note:string;readonly library?:string;}
const G=9.81;
/** Rolling resistance that gives the library glass beads (mu 0.12) the 22 degree pile Lajeunesse et al. (2005) measured: fitted with glassBeadRepose (packages/box3d-kit/test/granular-scenarios.mjs, GLASS_BEAD_ROLLING). */
export const BEAD_ROLLING_FRICTION=0.06;
const beads:GrainSI={material:{...grainMaterial('glass-beads',{rollingFriction:BEAD_ROLLING_FRICTION}),youngModulus:undefined,poissonRatio:undefined},verified:true,library:'glass-beads',note:'Material library: glass beads (density 2500 kg/m³, grain friction 0.12, restitution 0.926). Rolling resistance fitted to a 22° pile.'};
const est=(density:number,friction:number,restitution:number,rollingFriction:number,what:string):GrainSI=>({material:{density,friction,restitution,rollingFriction},verified:false,note:`Unverified estimate (${what}); no source was opened for these grains.`});
/** Grain material for each Studio granular profile. */
export const GRAIN_SI:Readonly<Record<string,GrainSI>>={
  beads,
  sand:{material:{density:2650,friction:0.19,restitution:0.6,rollingFriction:0.2},verified:false,library:'sand-quartz',note:'Material library: quartz sand (grain density 2650 kg/m³, grain friction 0.19). Restitution 0.6 and the rolling resistance 0.2 standing in for angular shape are authored, not sourced.'},
  gravel:est(2650,0.4,0.5,0.15,'rounded gravel'),angular:est(2700,0.6,0.4,0.3,'crushed stone'),pellets:est(950,0.25,0.7,0.1,'polymer pellets'),
  rice:est(1450,0.4,0.5,0.2,'grain surrogate'),steel:est(7800,0.15,0.8,0.05,'steel shot'),'damp-sand':est(2650,0.6,0.3,0.3,'damp sand as dry grains with strong damping; no capillary bridges'),
};
export const grainSI=(id:string):GrainSI=>GRAIN_SI[id]??GRAIN_SI.sand;

/** The tray in SI (the scene draws it ten times larger): x from -0.285 to 0.285 m, z from -0.085 to 0.085 m, floor at y = 0. */
export const TRAY={scale:10,halfLength:.285,halfWidth:.085,gateX:-.115,gateThickness:.01,columnStart:-.275,obstacle:{x:.1,radius:.027,height:.06},floorModelY:.58};
export interface TraySettings {diameter:number;fill:number;opening:number;liftSpeed:number;frictionScale:number;seed:number;}
export const STIFFNESS_FACTOR=4000;
/**
 * Threads the trays built from now on step their contacts on (granular-parallel.ts), or null for one thread. The
 * results are the same to the bit either way; the flow worker sets it when the page is cross-origin isolated.
 */
let trayExecutor:DemExecutor|null=null;
export function useTrayExecutor(executor:DemExecutor|null):void {trayExecutor=executor;}

export class GranularTray {
  readonly solver:Granular;readonly gate:number;readonly count:number;readonly radius:number;readonly dt:number;readonly settings:TraySettings;readonly grain:GrainSI;
  time=0;private solverTime=0;released=false;readonly columnHeight:number;readonly columnLength:number;
  constructor(grain:GrainSI,settings:TraySettings){
    this.grain=grain;this.settings=settings;const d=settings.diameter,r=d/2;this.radius=r;
    const m=4/3*Math.PI*r**3*grain.material.density,kn=STIFFNESS_FACTOR*m*G/d;
    const material:GranularMaterial={...grain.material,friction:Math.min(1.5,grain.material.friction*settings.frictionScale)};
    // The duration of a two-grain impact, pi sqrt(m* / k_n) with m* = m / 2; the step is 17% of it (the solver refuses above 20%).
    this.dt=.17*Math.PI*Math.sqrt(m/2/kn);
    // At most 12 x 6 grains a layer (fewer than the tray's width would hold) keeps a column near 800 grains at 10 mm.
    const cols=Math.min(12,Math.floor(.15/(d*1.03))),rows=Math.min(6,Math.floor(.15/(d*1.03))),layers=Math.max(1,Math.round(settings.fill/100*Math.min(14,.14/(d*1.01)))),z0=-rows*d*1.03/2;
    const lattice=granularLattice({min:[TRAY.columnStart,0,z0],max:[TRAY.columnStart+cols*d*1.03,layers*d*1.01,-z0],radius:[r*.96,r],gap:d*.01,jitter:1,seed:settings.seed});
    this.count=lattice.count;this.columnHeight=layers*d*1.01;this.columnLength=TRAY.gateX-TRAY.gateThickness/2-TRAY.columnStart;
    this.solver=new Granular({material,config:{dt:this.dt,capacity:this.count,law:'linear',normalStiffness:kn,gravity:[0,-G,0]}});
    const g=this.solver;
    g.addWall({shape:{kind:'plane',normal:[0,1,0]}});
    g.addWall({shape:{kind:'plane',normal:[1,0,0]},position:[-TRAY.halfLength,0,0]});g.addWall({shape:{kind:'plane',normal:[-1,0,0]},position:[TRAY.halfLength,0,0]});
    g.addWall({shape:{kind:'plane',normal:[0,0,1]},position:[0,0,-TRAY.halfWidth]});g.addWall({shape:{kind:'plane',normal:[0,0,-1]},position:[0,0,TRAY.halfWidth]});
    const o=TRAY.obstacle;
    g.addWall({shape:{kind:'cylinder',radius:o.radius,from:0,to:o.height},position:[o.x,0,0]});
    g.addWall({shape:{kind:'annulus',innerRadius:0,outerRadius:o.radius,offset:o.height},position:[o.x,0,0]});
    this.gate=g.addWall({shape:{kind:'box',halfExtents:[TRAY.gateThickness/2,.2,TRAY.halfWidth]},type:'kinematic',position:[TRAY.gateX,.2,0]});
    g.addGrains(lattice.positions,lattice.radii);
    if(trayExecutor)g.useExecutor(trayExecutor);
    // Let the column settle behind the closed gate for 0.3 s before the experiment's clock starts, so that it starts as a
    // poured, disordered packing (a lattice column of frictional spheres stands like a wall).
    g.step(Math.round(.3/this.dt));
  }
  /** Gate lift at a time, m. */
  lift(time:number):number {return this.released?.4:Math.min(this.settings.opening,time*this.settings.liftSpeed);}
  release():void {if(this.released)return;this.released=true;this.solver.setWallEnabled(this.gate,false);}
  /** Advance by dt, in solver steps; the gate moves kinematically. */
  step(dt:number):void {
    this.time+=dt;const g=this.solver;
    while(this.solverTime+this.dt<=this.time+1e-12){
      if(!this.released){const lift=this.lift(this.solverTime),next=this.lift(this.solverTime+this.dt);g.setWallState(this.gate,{position:[TRAY.gateX,.2+lift,0],linearVelocity:[0,(next-lift)/this.dt,0]});}
      g.step();this.solverTime+=this.dt;
    }
  }
  /** Runout past the gate face (m), deposit height (m), grains still behind the gate, mean kinetic energy per grain over m g d. */
  measure():{runout:number;height:number;behind:number;agitation:number} {
    const g=this.solver,gateFace=TRAY.gateX+TRAY.gateThickness/2;let front=gateFace,height=0,behind=0,kinetic=0;
    for(let i=0;i<g.grainCount;i++){
      if(!g.alive[i])continue;const x=g.positions[3*i],y=g.positions[3*i+1],r=g.radii[i];
      front=Math.max(front,x+r);height=Math.max(height,y+r);if(x<gateFace)behind++;
      kinetic+=.5*g.masses[i]*(g.velocities[3*i]**2+g.velocities[3*i+1]**2+g.velocities[3*i+2]**2);
    }
    const m=4/3*Math.PI*this.radius**3*g.material.density;
    return {runout:front-gateFace,height,behind,agitation:kinetic/Math.max(1,g.liveCount)/(m*G*2*this.radius)};
  }
}
