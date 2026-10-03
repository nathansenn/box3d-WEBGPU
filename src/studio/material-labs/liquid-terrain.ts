import type {LiquidSettings} from './liquid-config';
const smooth=(v:number)=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
/** Geometry and hydraulics use this same bed, in metres. */
export const bedDatum=(p:LiquidSettings,x:number)=>.57+(3-x)*p.slope/100;
export const channelCenter=(p:LiquidSettings,x:number)=>.24*p.meander*Math.sin((x+2.8)*1.15);
export function bedRelief(p:LiquidSettings,x:number,z:number):number {
  if(p.rig==='river')return p.bankHeight*smooth((Math.abs(z-channelCenter(p,x))-p.channelWidth/2)/.24);
  if(!['surface','rain'].includes(p.rig))return 0;
  const r=p.relief/1000;
  switch(p.terrain){
    case 'crown':return r*(1-z*z);
    case 'gutter':return r*Math.min(1,((z+.55)/.52)**2);
    case 'bowl':return r*(1-Math.exp(-(((x-.45)/1.15)**2+(z/.6)**2)));
    case 'ridges':return r*(.5+.5*Math.cos(x*Math.PI*2/1.2));
    case 'steps':return r*(smooth((1.5-x)/.22)+smooth(-x/.22)+smooth((-1.5-x)/.22))/3;
    default:return 0;
  }
}
export const bedElevation=(p:LiquidSettings,x:number,z:number)=>bedDatum(p,x)+bedRelief(p,x,z);
export const rimHeight=(p:LiquidSettings)=>p.rig==='flume'?1.05:p.rig==='river'?Math.max(.55,p.bankHeight+.12):['rain','surface'].includes(p.rig)?.18:.55;
/** Metered discharge locations are shared by the inlet cells and rendered attachments. */
export function liquidOutlets(p:LiquidSettings):[number,number][] {
  const x=p.rig==='river'?-2.75:-2.52,center=p.rig==='river'?channelCenter(p,x):0;
  return (p.pipe==='twin'?[-.4,.4]:p.pipe==='spraybar'?[-.75,-.45,-.15,.15,.45,.75]:[0]).map(z=>[x,Math.max(-.85,Math.min(.85,z+center))]);
}
