/** The Metal press study on the SI press brake (src/engine/press-brake.ts): what the Studio's settings mean in
 * SI, the ram cycle, and how the plane-strain section is drawn on the Studio's sheet. See docs/STUDIO_METAL_PRESS.md.
 *
 * Scene scale: 1 scene unit = 0.1 m (100 mm). The sheet is 520 x 440 mm. The bend line runs along the blade
 * (its rotation is the tool angle); every section across it bends the same way (plane strain), so the solved
 * section is swept along the bend line, and beyond the modelled strip the flanges continue straight.
 */
import {PressBrake,PRESS_BRAKE_MODEL_ID} from '../engine/press-brake.ts';
import {plasticMaterial} from '../engine/materials.ts';
import type {SolidMaterial} from '../engine/solid.ts';
import {normalizePress,type PressSettings,type PressToolId,type PressExperiment} from './press-settings.ts';

export const PRESS_SI_MODEL=PRESS_BRAKE_MODEL_ID;
/** Rated force of the Studio's press, N: the pressure setting is a percentage of it. */
export const PRESS_RATED_FORCE=1e6;
export const SI_PRESS_METAL_IDS=['structural-steel-s355','aluminium-6061-t6'] as const;
export const SI_PRESS_TOOL_IDS:readonly PressToolId[]=['wedge','bead'];
export const PRESS_SHEET={length:.52,width:.44};
/** Punch travel per solve, in sheet thicknesses. */
export const PRESS_STEP_TRAVEL=.25;
/** Section mesh: cells through the thickness, and along the half section cells of about 1.5 thicknesses (16 to 40). */
export const PRESS_SECTION_CELLS=4;
const UNIT=.1;

/** Short statement of what the study models, shown in the Studio. */
export const PRESS_SI_NOTE='SI model. Modelled: an elastic-plastic sheet section (J2 plasticity, library E, yield, tensile strength and elongation), rigid punch and die with friction, springback on release, ductile cracking by element erosion. Not modelled: the sheet\'s ends along the bend line, the die\'s V faces, strain rate and heating; the S355 elongation is unverified and the failure strain comes from a tensile test, so cracks come early.';
export const SI_THICKNESSES=[1,1.5,2,3,4,5,6,8,10,12];
/** Settings the SI press can run: a library metal and a line punch; other values pass through. */
export function siPress(p:PressSettings):PressSettings {return normalizePress({...p,metal:siMetalId(p.metal),tool:siToolId(p.tool)});}
const experiment=(id:string,name:string,intent:PressExperiment['intent'],note:string,p:Partial<PressSettings>):PressExperiment=>({id,name,intent,note,settings:normalizePress({metal:'structural-steel-s355',tool:'bead',thickness:2,pressure:40,strikeSpeed:10,stroke:30,hold:1,...p})});
/** Prepared SI cases. */
export const SI_PRESS_EXPERIMENTS:PressExperiment[]=[
  experiment('s355-radius-bend','S355 radius bend','Form','2 mm S355 · 36 mm radius bar · 30 mm stroke · 400 kN limit',{}),
  experiment('al6061-radius-bend','6061-T6 radius bend','Form','2 mm 6061-T6 · 36 mm radius bar · springback larger than steel',{metal:'aluminium-6061-t6'}),
  experiment('s355-v-bend','S355 V bend','Fracture','2 mm S355 · V blade, nose radius = t · cracks at the outer fibre',{tool:'wedge',stroke:8}),
  experiment('al6061-v-bend','6061-T6 V bend','Fracture','2 mm 6061-T6 · V blade · cracks early',{metal:'aluminium-6061-t6',tool:'wedge',stroke:8}),
  experiment('s355-shallow','S355 shallow bend','Compare','2 mm S355 · radius bar · 10 mm stroke · mostly springback',{stroke:10}),
  experiment('s355-force-limit','Force-limited stroke','Compare','4 mm S355 · radius bar · 10 kN limit stops the ram',{thickness:4,pressure:1}),
  experiment('s355-diagonal','Diagonal bend line','Form','2 mm S355 · radius bar turned 45°',{angle:45}),
];
export function siMetalId(id:string):string {return (SI_PRESS_METAL_IDS as readonly string[]).includes(id)?id:SI_PRESS_METAL_IDS[0];}
export function siToolId(id:PressToolId):PressToolId {return SI_PRESS_TOOL_IDS.includes(id)?id:'wedge';}
/** Elastic-plastic input of a library metal. The S355 elongation is unverified in the library (docs/MATERIALS.md). */
export function siPressMaterial(id:string):SolidMaterial {return plasticMaterial(siMetalId(id),{allowUnverified:true});}

/** The press-brake geometry the settings select, in metres. */
export function pressGeometry(p:PressSettings):{thickness:number;punchRadius:number;dieRadius:number;dieOpening:number;width:number;strokeLimit:number} {
  const t=p.thickness/1000,tool=siToolId(p.tool);
  // The beading bar is the drawn 36 mm radius bar (times the tool size); the V blade's nose is rounded to the sheet thickness.
  const punchRadius=tool==='bead'?.036*p.toolScale:t*p.toolScale,dieRadius=t;
  // Air-bending die: eight thicknesses, and wide enough for the punch nose and both shoulders with four thicknesses of
  // clearance on each side, so that the flanges are not pinched between punch and shoulder in a deep bend.
  const dieOpening=Math.max(8*t,2*(punchRadius+dieRadius+4*t));
  // Width of the sheet along the bend line: the sheet's extent along the blade.
  const a=p.angle*Math.PI/180,width=Math.abs(Math.cos(a))*PRESS_SHEET.width+Math.abs(Math.sin(a))*PRESS_SHEET.length;
  // The punch stops at the stroke setting, at 0.6 of the die opening (about a 90 degree bend), or before its centre passes
  // the shoulders' (punch and shoulder radii plus two thicknesses), past which the sheet would be ironed, not bent.
  return {thickness:t,punchRadius,dieRadius,dieOpening,width:Math.min(width,PRESS_SHEET.length),strokeLimit:Math.min(p.stroke/1000,.6*dieOpening,punchRadius+dieRadius+2*t)};
}

export type PressSICycle='Ready'|'Approach'|'Forming'|'Pressure limited'|'Holding'|'Retracting'|'Complete';
/** Ram cycle and the solved section. The ram reference `punchY` is the bottom of the punch nose in scene units. */
export class StudioPressSI {
  readonly brake:PressBrake;readonly geometry:ReturnType<typeof pressGeometry>;readonly material:SolidMaterial;
  readonly speed:number;readonly modelDt:number;
  cycle:PressSICycle='Ready';
  /** Scene height of the punch nose bottom, units. */
  punchY:number;
  /** Force of the sheet on the punch, N. */
  force=0;peakForce=0;
  /** Wall time the solver took, s, and the model time it advanced. */
  solveSeconds=0;modelSeconds=0;
  private owed=0;private holdElapsed=0;private readonly startY:number;private readonly contactY:number;private readonly section:Float64Array;
  readonly press:PressSettings;readonly supportY:number;
  constructor(press:PressSettings,supportY:number,startY=3.85){
    this.press=press;this.supportY=supportY;
    const g=this.geometry=pressGeometry(press);this.material=siPressMaterial(press.metal);
    this.speed=press.strikeSpeed/1000;
    // About a quarter of the thickness of punch travel per solve keeps the contact and the hinge resolved.
    this.modelDt=Math.min(1/30,PRESS_STEP_TRAVEL*g.thickness/this.speed);
    this.brake=new PressBrake({material:this.material,thickness:g.thickness,width:g.width,dieOpening:g.dieOpening,dieRadius:g.dieRadius,punchRadius:g.punchRadius,friction:.1,dt:this.modelDt,maxNewtonIterations:40,
      element:'tet4-nodal',linearSolver:'ldl',
      cells:{thickness:PRESS_SECTION_CELLS,length:Math.max(16,Math.min(40,Math.ceil((g.dieOpening*.75)/(1.5*g.thickness))))}});
    this.startY=startY;this.contactY=supportY+(g.thickness+.02*g.thickness)/UNIT;this.punchY=startY;
    this.section=new Float64Array(2*this.brake.midRow.length);this.readSection();
  }
  get pressureLimit():number {return this.press.pressure/100*PRESS_RATED_FORCE;}
  /** Advances the ram cycle by dt seconds with the requested drive level (percent of the rated force; 0 retracts). */
  advance(dt:number,pressurePercent:number):void {
    const limit=pressurePercent/100*PRESS_RATED_FORCE,v=this.speed;
    if(this.cycle==='Complete')return;
    if(pressurePercent<=0&&this.cycle!=='Ready'&&this.cycle!=='Approach')this.cycle='Retracting';
    if(this.cycle==='Ready'){if(pressurePercent>0)this.cycle='Approach';else return;}
    if(this.cycle==='Approach'){
      if(pressurePercent<=0){this.punchY=Math.min(this.startY,this.punchY+v/UNIT*dt);if(this.punchY>=this.startY)this.cycle='Complete';return;}
      this.punchY-=v/UNIT*dt;if(this.punchY>this.contactY)return;
      this.punchY=this.contactY;this.cycle='Forming';this.owed=0;return;
    }
    if(this.cycle==='Retracting'&&this.brake.punchTravel<=0&&this.force<=0){
      this.punchY=Math.min(this.startY,this.punchY+v/UNIT*dt);if(this.punchY>=this.startY)this.cycle='Complete';return;
    }
    if(this.cycle==='Holding'||this.cycle==='Pressure limited'){
      this.holdElapsed+=dt;if(this.holdElapsed>=this.press.hold)this.cycle='Retracting';
      // A lowered limit lets the ram back off; a raised one lets a pressure-limited stroke continue.
      if(this.cycle==='Pressure limited'&&this.force<.98*limit&&this.brake.stroke<this.geometry.strokeLimit){this.cycle='Forming';this.holdElapsed=0;}
      else if(this.cycle!=='Retracting')return;
    }
    this.owed+=dt;
    const start=performance.now();
    while(this.owed>=this.modelDt-1e-12){
      this.owed-=this.modelDt;
      if(this.cycle==='Forming'){
        const remaining=this.geometry.strokeLimit-this.brake.stroke;
        this.brake.setPunchSpeed(Math.min(v,Math.max(0,remaining)/this.modelDt));
      }else if(this.cycle==='Retracting'){
        if(this.brake.punchTravel<=0)break;
        this.brake.setPunchSpeed(-Math.min(v,this.brake.punchTravel/this.modelDt));
      }else{this.brake.setPunchSpeed(0);break;}
      this.brake.step();this.modelSeconds+=this.modelDt;
      this.force=Math.max(0,this.brake.punchForce);this.peakForce=Math.max(this.peakForce,this.force);
      if(this.cycle==='Forming'){
        if(this.force>=limit){this.cycle='Pressure limited';this.holdElapsed=0;this.brake.setPunchSpeed(0);}
        else if(this.brake.stroke>=this.geometry.strokeLimit-1e-9){this.cycle='Holding';this.holdElapsed=0;this.brake.setPunchSpeed(0);}
        if(this.cycle!=='Forming')break;
      }
    }
    this.solveSeconds+=(performance.now()-start)/1000;
    this.punchY=this.contactY-this.brake.punchTravel/UNIT;
    this.readSection();
  }
  /** Reads the solved mid-surface. The sheet carries no weight in the model, so after the punch leaves it can drift
   * off the die by a rigid motion; the drawn section is held with its mid-surface over the shoulder at t / 2. */
  private readSection():void {
    const p=this.brake.body.positions(),m=this.brake.midRow,X=this.brake.body.referencePositions;
    let k=0;for(let i=0;i<m.length;i++)if(Math.abs(X[3*m[i]]-this.geometry.dieOpening/2)<Math.abs(X[3*m[k]]-this.geometry.dieOpening/2))k=i;
    const shift=Math.min(0,this.geometry.thickness/2-p[3*m[k]+1]);
    for(let i=0;i<m.length;i++){this.section[2*i]=p[3*m[i]];this.section[2*i+1]=p[3*m[i]+1]+shift;}
    const cols=this.brake.columns,plastic=this.brake.body.equivalentPlasticStrain();
    if(this.columnPlastic.length!==cols.length)this.columnPlastic=new Float64Array(cols.length);
    cols.forEach((c,i)=>{let max=0;for(const e of c)max=Math.max(max,plastic[e]);this.columnPlastic[i]=max;});
  }
  /** Mid-surface point of the sheet at reference distance s (m) from the bend line, in section coordinates (m):
   * along the section and up. Beyond the modelled strip the flange continues straight. */
  sectionPoint(s:number,out:[number,number]):[number,number] {
    const sec=this.section,n=sec.length/2,X=this.brake.body.referencePositions,m=this.brake.midRow,L=X[3*m[n-1]];
    if(s>=L){
      const dx=sec[2*n-2]-sec[2*n-4],dy=sec[2*n-1]-sec[2*n-3],l=Math.hypot(dx,dy)||1,ds=s-L;
      out[0]=sec[2*n-2]+dx/l*ds;out[1]=sec[2*n-1]+dy/l*ds;return out;
    }
    let i=0;while(i<n-2&&X[3*m[i+1]]<s)i++;
    const x0=X[3*m[i]],x1=X[3*m[i+1]],f=(s-x0)/(x1-x0);
    out[0]=sec[2*i]+(sec[2*i+2]-sec[2*i])*f;out[1]=sec[2*i+1]+(sec[2*i+3]-sec[2*i+1])*f;return out;
  }
  /** Largest equivalent plastic strain of the cells of the section column at reference distance s (m). */
  plasticAt(s:number):number {
    const cols=this.brake.columns,L=this.brake.halfLength;if(s>=L)return 0;
    return this.columnPlastic[Math.min(cols.length-1,Math.floor(s/L*cols.length))];
  }
  private columnPlastic=new Float64Array(0);
  /** Fraction of the elements of the column at s that have eroded. */
  crackedAt(s:number):number {
    const cols=this.brake.columns,L=this.brake.halfLength;if(s>=L)return 0;
    const c=cols[Math.min(cols.length-1,Math.floor(s/L*cols.length))],mask=this.brake.body.erodedMask;let k=0;for(const e of c)k+=mask[e];return k/c.length;
  }
  /** Columns of the section cracked through (at least half of their elements eroded), as [from, to] reference intervals in m. */
  crackedIntervals():[number,number][] {
    const cols=this.brake.columns,L=this.brake.halfLength,mask=this.brake.body.erodedMask,out:[number,number][]=[];
    cols.forEach((c,i)=>{let k=0;for(const e of c)k+=mask[e];if(k>=c.length/2)out.push([i*L/cols.length,(i+1)*L/cols.length]);});
    return out;
  }
  /** Real-time factor so far: model seconds per wall second of solving. */
  get realTimeFactor():number {return this.solveSeconds>0?this.modelSeconds/this.solveSeconds:0;}
}
