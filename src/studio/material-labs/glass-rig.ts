import type {ContactVec3 as V3} from '../../engine/convex-contact';

/** The renderer and collision model share these dimensions, in metres. */
export const GLASS_RIG={panelWidth:2.6,panelHeight:2,panelCenterY:2.45,pivotY:4.35,pendulumLength:1.9,bobOffsetZ:.23,bobRadius:.235,trayWidth:3.4,trayDepth:1.62,trayTop:.68} as const;
export interface GlassFixture {size:V3;position:V3;material:string;bevel:number;}
export function glassFixtures(thickness:number):GlassFixture[] {
  const fixtures:GlassFixture[]=[];
  const box=(size:V3,position:V3,material='steel',bevel=0)=>fixtures.push({size,position,material,bevel});
  const r=GLASS_RIG;
  box([r.trayWidth,.12,r.trayDepth],[0,r.trayTop-.06,0]);
  for(const x of [-r.trayWidth/2,r.trayWidth/2])box([.1,.12,r.trayDepth],[x,r.trayTop+.04,0]);
  for(const z of [-r.trayDepth/2,r.trayDepth/2])box([r.trayWidth,.12,.1],[0,r.trayTop+.04,z]);
  for(const x of [-1.52,1.52]){box([.17,3.24,.18],[x,2.4,0]);box([.4,.1,.44],[x,.73,0]);}
  box([3.36,.3,.31],[0,4.17,0],'orange',.025);
  // Clamping pads touch the pane faces; neither pad starts inside the specimen.
  for(const x of [-1.32,1.32])for(const y of [1.6,2.45,3.3]){
    box([.21,.27,.12],[x,y,thickness/2+.084],'chrome',.014);
    box([.15,.21,.024],[x,y,thickness/2+.012],'rubber');
    box([.15,.21,.06],[x,y,-thickness/2-.03],'chrome');
  }
  return fixtures;
}
export function glassBobPosition(angle:number,impactX:number):V3 {
  const r=GLASS_RIG,c=Math.cos(angle),s=Math.sin(angle);
  return [impactX,r.pivotY-r.pendulumLength*c+r.bobOffsetZ*s,r.pendulumLength*s+r.bobOffsetZ*c];
}
export function glassBobTangent(angle:number):V3 {
  const r=GLASS_RIG,c=Math.cos(angle),s=Math.sin(angle);
  return [0,r.pendulumLength*s+r.bobOffsetZ*c,r.pendulumLength*c-r.bobOffsetZ*s];
}
