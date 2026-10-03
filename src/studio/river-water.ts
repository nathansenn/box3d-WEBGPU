import { Color, Mesh, NodeMaterial, PlaneGeometry, Vector3, Vector4, type Texture } from 'three/webgpu';
import { Fn, cameraPosition, normalize, positionWorld, positionLocal, texture, vec2, vec3, vec4, max, dot, reflect, pow, length, float, uniform, reflector, mix, sin, cos, exp, sqrt, smoothstep, mx_noise_float, uniformArray, Loop, If } from 'three/tsl';
import { RIVER_CURRENT } from './physics';
import { MAX_SPLASHES, MAX_CONTACTS, type SplashEvent, type WaterContact } from './river-impacts';
import { DEFAULT_RIVER, normalizeRiver, advanceRiverClock, type RiverSettings } from './river-settings';
import { riverWakeTexture } from './bridge-ecology';

/** Adapted from Three.js r185 WaterMesh (MIT, Copyright three.js authors).
 * The reflection/Fresnel model stays native to TSL. Material Forge's workflow
 * drives a private flow clock, shallow wave envelope and localized bank foam.
 * This is visual water, not a fluid/structure simulation or the full river engine.
 */
export class RiverWater extends Mesh<PlaneGeometry, NodeMaterial> {
  readonly sunDirection = uniform(new Vector3(1,1,0).normalize());
  readonly sunColor = uniform(new Color('#fff4df'));
  readonly waterColor = uniform(new Color('#224c4d'));
  readonly distortionScale = uniform(1.7);
  readonly size = uniform(11);
  readonly clock = uniform(0);
  /** Simulation time of the impact field; splash ages are measured against it. */
  readonly impactClock = uniform(0);
  /** (x, z, impact time, strength) per splash; strength 0 = unused slot. */
  private impacts = uniformArray(Array.from({length:MAX_SPLASHES},()=>new Vector4()),'vec4' as const);
  /** (x, z, wetted strength, 0) per particle currently at the surface. */
  private contacts = uniformArray(Array.from({length:MAX_CONTACTS},()=>new Vector4()),'vec4' as const);
  private energy = uniform(1);
  private foamAmount = uniform(1);
  private settings:RiverSettings={...DEFAULT_RIVER};
  private lastTime:number|undefined;
  private wakeMap=riverWakeTexture();

  constructor(normals:Texture) {
    const material=new NodeMaterial();material.transparent=true;material.depthWrite=false;
    super(new PlaneGeometry(34,580,48,480),material);
    const map=texture(normals),p=positionWorld.xz,t=this.clock;
    // The same downstream displacement advects every octave; domain warping
    // breaks the long parallel reflection bands without sliding layers sideways.
    const warp=vec2(mx_noise_float(p.mul(.24)).mul(1.8),mx_noise_float(p.mul(.19).add(vec2(7,13))).mul(1.2));
    const flow=p.add(warp).sub(vec2(0,t.mul(.72))),pattern=flow.mul(float(8).div(this.size));
    const noise=map.sample(pattern.div(1.45)).mul(.48)
      .add(map.sample(pattern.div(3.2).add(vec2(.31,.67))).mul(.27))
      .add(map.sample(pattern.div(.57).add(vec2(.73,.19))).mul(.25)).mul(2).sub(1);
    // Impact response: each splash radiates a damped ring train (capillary-gravity
    // group speed about 1.7 m/s, 0.45 m wavelength) that drifts with the current,
    // leaves a decaying whitewater patch and foam on the leading crest. Wetted
    // particles add standing foam and short ripples where they cut the surface.
    const field=Fn(()=>{
      const gx=float(0).toVar(),gz=float(0).toVar(),froth=float(0).toVar();
      Loop(MAX_SPLASHES,({i})=>{
        const e=this.impacts.element(i),age=this.impactClock.sub(e.z);
        If(e.w.greaterThan(0).and(age.greaterThan(0)),()=>{
          const d=p.sub(vec2(e.x,e.y.add(age.mul(RIVER_CURRENT)))),r=length(d).max(.001);
          const behind=age.mul(1.7).add(.15).sub(r);
          const env=smoothstep(-.12,.06,behind).mul(exp(behind.max(0).mul(-1.4))).mul(exp(age.mul(-.45))).div(sqrt(r.add(.35)));
          const slope=cos(behind.mul(13.96)).mul(env).mul(e.w).mul(1.4);
          gx.addAssign(d.x.div(r).mul(slope));gz.addAssign(d.y.div(r).mul(slope));
          const patch=exp(r.div(age.mul(.55).add(.4)).pow(2).negate()).mul(exp(age.mul(-.3)));
          const crest=exp(behind.div(.13).pow(2).negate()).mul(exp(age.mul(-.8)));
          froth.addAssign(patch.add(crest).mul(e.w));
        });
      });
      Loop(MAX_CONTACTS,({i})=>{
        const c=this.contacts.element(i);
        If(c.z.greaterThan(0),()=>{
          const d=p.sub(c.xy),r=length(d).max(.001);
          const slope=cos(r.mul(16).sub(this.impactClock.mul(7))).mul(exp(r.mul(-2.2))).mul(c.z).mul(.12);
          gx.addAssign(d.x.div(r).mul(slope));gz.addAssign(d.y.div(r).mul(slope));
          froth.addAssign(exp(r.div(.5).pow(2).negate()).mul(c.z).mul(.55));
        });
      });
      return vec3(gx,gz,froth.min(1.4));
    })();
    const surfaceNormal=normalize(noise.xzy.mul(vec3(this.energy.mul(1.08),1,this.energy.mul(1.08))).sub(vec3(field.x,0,field.y)));
    const toEye=cameraPosition.sub(positionWorld),eye=normalize(toEye);
    const sun=this.sunColor.rgb;
    const specular=sun.mul(pow(max(0,dot(surfaceNormal,normalize(this.sunDirection.add(eye)))),280)).mul(1.05);
    const diffuse=sun.mul(max(dot(this.sunDirection,surfaceNormal),0)).mul(.5);
    const distortion=surfaceNormal.xz.mul(float(.001).add(float(1).div(length(toEye)))).mul(this.distortionScale);
    // Shallow standing waves taper before meeting the bank. Maximum displacement
    // is below 0.08 model units throughout the allowed energy range.
    const edgeFade=float(1).sub(smoothstep(13.5,17,positionLocal.x.abs()));
    const height=sin(positionLocal.y.mul(1.2).add(t.mul(.86)).add(sin(positionLocal.x.mul(.35)).mul(1.7))).mul(.018)
      .add(sin(positionLocal.x.mul(.85).add(positionLocal.y.mul(2.5)).add(t.mul(1.8))).mul(.012)).mul(this.energy).mul(edgeFade);
    material.positionNode=positionLocal.add(vec3(0,0,height));
    material.receivedShadowPositionNode=positionWorld;
    const fresnel=pow(float(1).sub(max(dot(eye,surfaceNormal),0)),5).mul(.9).add(.035);
    // Shallows transmit the actual terrain and submerged geometry beneath them.
    material.opacityNode=mix(.84,.57,smoothstep(9,16.5,p.x.abs())).add(fresnel.mul(.36)).add(field.z.mul(.5)).clamp(0,.98);
    material.colorNode=Fn(()=>{
      const mirror=reflector();mirror.uvNode=mirror.uvNode!.add(distortion);mirror.reflector.resolutionScale=.5;this.add(mirror.target);
      const depth=smoothstep(8.5,16.7,p.x.abs());
      const bed=mix(this.waterColor.rgb.mul(1.55),vec3(.16,.19,.10),depth.mul(.45));
      const tone=sin(flow.x.mul(.63).add(sin(flow.y.mul(.17)).mul(2))).mul(.045).add(.96);
      const scatter=bed.mul(max(.45,dot(surfaceNormal,eye))).mul(tone);
      // Keep the small diffuse contribution subordinate to tinted transmission;
      // a large warm diffuse term makes a clear stream read as opaque mud.
      const albedo=mix(sun.mul(diffuse).mul(.06).add(scatter),mirror.rgb.mul(.84).add(specular),fresnel);
      // Sparse fragments follow the current close to each bank. They are part of
      // the surface shader, so changing foam never allocates particles or draws.
      const bank=smoothstep(12.8,15.7,positionWorld.x.abs()).mul(float(1).sub(smoothstep(16.2,17,positionWorld.x.abs())));
      const strand=sin(flow.y.mul(.9).add(sin(flow.x.mul(2.3)).mul(2.4))).mul(.5).add(.5);
      const flecks=map.sample(flow.mul(vec2(1.8,.85))).r;
      const wakes=texture(this.wakeMap,p.add(vec2(17,70)).div(vec2(34,140))).r;
      const fragmented=smoothstep(.46,.56,flecks);
      const foam=fragmented.mul(smoothstep(.65,.95,strand).mul(bank).mul(.45).add(wakes.mul(.88))).mul(this.foamAmount).clamp(0,.9);
      // Aerated water breaks into flecks at its edges and stays solid at the core.
      const whitewater=smoothstep(.12,.75,field.z.mul(mix(.55,1.25,flecks))).mul(.92);
      return mix(albedo,vec3(.73,.8,.75).mul(sun),foam.max(whitewater));
    })();
    this.rotation.x=-Math.PI/2;this.position.y=-1.48;this.receiveShadow=true;
  }
  dispose():void {this.wakeMap.dispose();}
  configure(settings:RiverSettings):void {this.settings=normalizeRiver(settings);this.energy.value=this.settings.wave;this.foamAmount.value=this.settings.foam;}
  /** Feed splash events and wetted contacts; strength follows impact energy sqrt(sum m v^2). */
  setImpacts(time:number,events:readonly SplashEvent[],contacts:readonly WaterContact[]):void {
    this.impactClock.value=time;
    const a=this.impacts.array as Vector4[],c=this.contacts.array as Vector4[];
    for(let i=0;i<a.length;i++){const e=events[i];if(e)a[i].set(e.x,e.z,e.time,Math.min(1.6,Math.max(.3,Math.sqrt(e.energy)/3)));else a[i].set(0,0,0,0);}
    for(let i=0;i<c.length;i++){const k=contacts[i];if(k)c[i].set(k.x,k.z,Math.min(1,k.strength),0);else c[i].set(0,0,0,0);}
  }
  advance(time:number):void {
    const elapsed=this.lastTime===undefined?0:Math.min(.25,Math.max(0,time-this.lastTime));this.lastTime=time;
    this.clock.value=advanceRiverClock(this.clock.value,elapsed,this.settings);
  }
}
