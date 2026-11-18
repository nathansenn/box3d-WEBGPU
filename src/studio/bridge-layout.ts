import { STUDIES } from './physics';

/** Authored model coordinates, shared by road grading, habitat and fixtures. */
export const BRIDGE_LAYOUT={
  halfSpan:STUDIES.bridge.span/2,halfWidth:STUDIES.bridge.depth/2,
  deckTop:STUDIES.bridge.supportY+.08,
  approachStart:STUDIES.bridge.span/2+STUDIES.bridge.span/(STUDIES.bridge.cols-1)/2,
  roadStart:31.5,roadEnd:154,roadHalfWidth:2.6,shoulder:1.15,
  anchorX:31,anchorZ:4.3,clearWidth:3.05,clearHeight:3,
  railHeights:[.2,.38,.56,.74,.92,1.15],
} as const;
export const smooth01=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export function roadCenter(x:number):number {
  const t=(Math.abs(x)-BRIDGE_LAYOUT.roadStart)/(BRIDGE_LAYOUT.roadEnd-BRIDGE_LAYOUT.roadStart);
  return -Math.sign(x)*(28*smooth01(t/.68)-9*smooth01((t-.68)/.32));
}
export function roadHalfWidth(x:number):number {
  return BRIDGE_LAYOUT.halfWidth+(BRIDGE_LAYOUT.roadHalfWidth-BRIDGE_LAYOUT.halfWidth)*smooth01((Math.abs(x)-BRIDGE_LAYOUT.roadStart)/13);
}
export function roadGrade(x:number):number {
  return BRIDGE_LAYOUT.deckTop+8*smooth01((Math.abs(x)-40)/(BRIDGE_LAYOUT.roadEnd-40));
}
export function roadClear(x:number,z:number,padding=0):boolean {
  const ax=Math.abs(x);
  return ax>BRIDGE_LAYOUT.halfSpan-.5&&ax<BRIDGE_LAYOUT.roadEnd+8&&Math.abs(z-roadCenter(x))<roadHalfWidth(x)+BRIDGE_LAYOUT.shoulder+padding;
}
/** Embankment and cut blend into the original valley. The channel is untouched. */
export function gradeRoadTerrain(x:number,z:number,original:number):number {
  const ax=Math.abs(x);if(ax<23.05||ax>BRIDGE_LAYOUT.roadEnd+12)return original;
  const edge=Math.abs(z-roadCenter(x))-roadHalfWidth(x);
  const across=1-smooth01((edge-.9)/5.5),ends=smooth01((ax-23.05)/2)*(1-smooth01((ax-BRIDGE_LAYOUT.roadEnd)/12));
  const underTimber=4.25+.57*smooth01((ax-28)/3);
  const grade=ax<31?underTimber:roadGrade(x)-.06;
  return original+(grade-original)*across*ends;
}
