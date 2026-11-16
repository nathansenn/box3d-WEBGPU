/**
 * A Granular whose steps are taken by another backend (the float32 CPU reference, or the GPU), so that code written
 * for the float64 solver, the validation set-ups above all, runs on that backend unchanged.
 *
 * `granularProxy(remote)` returns a class to use in place of `Granular`. It is a real Granular: grains and walls are
 * added to it as usual and every accessor works. `step()` hands the present grains and walls to the remote (once; after
 * that only what was changed from outside), lets the remote take the steps, and copies the result back: positions,
 * velocities, spins, removed grains, the moving walls' poses, every wall's force and impulse, the contact counts.
 * Quantities the backend does not compute are the float64 solver's own evaluation of the copied state: the elastic
 * energy of the normal springs is right, the tangential springs' is not (the histories stay on the backend), and the
 * dissipated energies stay zero.
 *
 * The remote is synchronous. The float32 reference is (`f32Remote`); the GPU is reached from a worker that blocks on a
 * shared buffer while the main thread drives the device (scenario-worker.ts).
 */
import {Granular,type GranularConfig,type GranularMaterial,type GranularWallOptions,type GranularWallState} from '../granular.ts';
import {GranularF32,demSetup,packDemGrains,packDemWalls,readDemWall,type DemOptions,type DemSetup,type DemStats} from './granular-f32.ts';

export interface DemFrame {readonly pos:Float32Array;readonly vel:Float32Array;readonly spin:Float32Array;readonly walls:Float32Array;readonly stats:DemStats}
export interface DemRemote {
  create(setup:DemSetup):void;
  /** The setup's grain or wall buffers were rewritten: take them and evaluate the forces again. */
  upload(setup:DemSetup,what:{readonly grains:boolean;readonly walls:boolean}):void;
  step(count:number):void;
  read():DemFrame;
  destroy?():void;
}
/** The float32 CPU reference as a remote. */
export const f32Remote=():DemRemote=>{
  let solver:GranularF32|null=null;
  return {
    create(setup){solver=new GranularF32(setup);},
    upload(){solver!.refresh();},
    step(count){solver!.step(count);},
    read(){const s=solver!;return {pos:s.pos,vel:s.vel,spin:s.spin,walls:s.wallF,stats:s.stats};},
  };
};

type Loads=ReturnType<typeof readDemWall>;
export function granularProxy(remote:()=>DemRemote,options:DemOptions={}):typeof Granular {
  return class GranularProxy extends Granular {
    #remote:DemRemote|null=null;#setup:DemSetup|null=null;#grains=false;#walls=false;#inside=false;#loads:Loads[]=[];
    /** Statistics of the backend (history and bucket overflows among them). */
    backendStats:DemStats|null=null;
    constructor(init:{readonly material:GranularMaterial;readonly config:GranularConfig}) {super(init);}
    override addGrain(position:ArrayLike<number>,radius:number,velocity?:ArrayLike<number>,angularVelocity?:ArrayLike<number>):number {this.#grains=true;return super.addGrain(position,radius,velocity,angularVelocity);}
    override removeGrain(index:number):void {if(!this.#inside)this.#grains=true;super.removeGrain(index);}
    override touch():void {if(!this.#inside)this.#grains=true;super.touch();}
    override addWall(o:GranularWallOptions):number {this.#walls=true;return super.addWall(o);}
    override setWallState(index:number,state:GranularWallState):void {if(!this.#inside)this.#walls=true;super.setWallState(index,state);}
    override setWallVelocity(index:number,linearVelocity:ArrayLike<number>,angularVelocity?:ArrayLike<number>):void {this.#walls=true;super.setWallVelocity(index,linearVelocity,angularVelocity);}
    override setWallEnabled(index:number,enabled:boolean):void {this.#walls=true;super.setWallEnabled(index,enabled);}
    override setWallMass(index:number,mass:number):void {this.#walls=true;super.setWallMass(index,mass);}
    override setWallExternalLoad(index:number,load:ArrayLike<number>,offset=0):void {this.#walls=true;super.setWallExternalLoad(index,load,offset);}
    override resetWallImpulses(index?:number):void {
      this.#walls=true;super.resetWallImpulses(index);
      for(let k=0;k<this.#loads.length;k++)if(index===undefined||index===k){this.#loads[k].impulse.fill(0);this.#loads[k].angularImpulse.fill(0);}
    }
    // What the backend computed for the walls, whatever the float64 evaluation of the copied state has put in the walls since.
    override wallForce(index:number):Float64Array {return this.#loads[index]?Float64Array.from(this.#loads[index].force):super.wallForce(index);}
    override wallTorque(index:number):Float64Array {return this.#loads[index]?Float64Array.from(this.#loads[index].torque):super.wallTorque(index);}
    override wallNormalLoad(index:number):number {return this.#loads[index]?this.#loads[index].normalLoad:super.wallNormalLoad(index);}
    override wallContacts(index:number):number {return this.#loads[index]?this.#loads[index].contacts:super.wallContacts(index);}
    override step(count=1):void {
      if(count<=0)return;
      const walls=this.wallCount;
      if(!this.#remote||!this.#setup||this.#setup.wallCount!==walls){
        // First step, or walls were added since: build the backend from the present state (its contact histories start empty).
        this.#remote?.destroy?.();
        this.#restoreLoads();
        this.#setup=demSetup(this,options);this.#remote=remote();this.#remote.create(this.#setup);
      }else if(this.#grains||this.#walls){
        if(this.#grains)packDemGrains(this,this.#setup);
        if(this.#walls){this.#restoreLoads();packDemWalls(this.backendDescription(),this.#setup.walls,true);}
        this.#remote.upload(this.#setup,{grains:this.#grains,walls:this.#walls});
      }
      this.#grains=false;this.#walls=false;
      this.#remote.step(count);
      this.#absorb(this.#remote.read(),count);
    }
    /** The walls' forces as the backend left them (a float64 evaluation of the copied state may have replaced them). */
    #restoreLoads():void {
      for(let k=0;k<this.#loads.length;k++){const l=this.#loads[k];super.setWallLoads(k,{force:l.force,torque:l.torque,impulse:super.wallImpulse(k),angularImpulse:super.wallAngularImpulse(k),normalLoad:l.normalLoad,contacts:l.contacts});}
    }
    #absorb(frame:DemFrame,count:number):void {
      this.#inside=true;
      const n=this.grainCount,x=this.positions,v=this.velocities,w=this.angularVelocities,alive=this.alive;
      for(let i=0;i<n;i++){
        if(frame.pos[4*i+3]<=0){if(alive[i])super.removeGrain(i);continue;}
        for(let k=0;k<3;k++){x[3*i+k]=frame.pos[4*i+k];v[3*i+k]=frame.vel[4*i+k];w[3*i+k]=frame.spin[4*i+k];}
      }
      const description=this.backendDescription();
      this.#loads=[];
      for(let k=0;k<this.wallCount;k++){
        const wall=readDemWall(frame.walls,k);
        if(description.walls[k].type!==0)super.setWallState(k,wall);
        super.setWallLoads(k,wall);this.#loads.push(wall);
      }
      this.time+=count*this.dt;
      const st=this.stats,b=frame.stats;
      st.steps+=count;st.contacts=b.contacts;st.wallContacts=b.wallContacts;st.overlap=b.overlap;if(b.maxOverlap>st.maxOverlap)st.maxOverlap=b.maxOverlap;
      this.backendStats={...b};
      super.touch();
      this.#inside=false;
    }
  };
}
