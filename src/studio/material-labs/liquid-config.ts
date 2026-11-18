/** Authored comparative controls; physical dimensions are SI, material factors are not calibrated. */
export const LIQUID_RIGS=[
  {id:'flume',name:'Release flume',icon:'waves',note:'Reservoir release, reflected waves and obstacle wakes.'},
  {id:'pipes',name:'Pipe flow bench',icon:'pipe',note:'Pump delivery, bore restriction and interchangeable outlets.'},
  {id:'river',name:'River channel',icon:'tree',note:'Shape the channel, overtop low banks and follow water onto the floodplain.'},
  {id:'rain',name:'Rain table',icon:'cloud-rain',note:'Rainfall, surface storage, infiltration and collected runoff.'},
  {id:'surface',name:'Surface runoff',icon:'drop',note:'Compare liquid films on smooth, rough and porous substrates.'},
] as const;
export type LiquidRig=typeof LIQUID_RIGS[number]['id'];
export const SURFACES=[
  {id:'steel',name:'Brushed steel',color:'#9aa9ac',drag:.1,absorb:0,roughness:.3,note:'Smooth sealed bed · low flow resistance.'},
  {id:'glass',name:'Polished glass',color:'#91b3b5',drag:.035,absorb:0,roughness:.08,note:'Lowest resistance · long, mobile liquid films.'},
  {id:'tile',name:'Glazed tile',color:'#d0d5c9',drag:.16,absorb:0,roughness:.17,note:'Sealed ceramic with modest film resistance.'},
  {id:'epoxy',name:'Sealed epoxy',color:'#506e70',drag:.075,absorb:0,roughness:.24,note:'Continuous coated surface · no absorption.'},
  {id:'asphalt',name:'Asphalt',color:'#434d4e',drag:1.25,absorb:.15,roughness:.94,note:'Rough bed with a small infiltration allowance.'},
  {id:'concrete',name:'Concrete',color:'#b1ad9f',drag:1.6,absorb:1.1,roughness:.93,note:'Rough porous slab · some water enters the bed.'},
  {id:'gravel',name:'River gravel',color:'#9b9581',drag:2.4,absorb:2.2,roughness:1,note:'Strong drag with permeable bed storage.'},
  {id:'rubber',name:'Textured rubber',color:'#343f3d',drag:3.8,absorb:0,roughness:.95,note:'High liquid-flow resistance on a sealed surface.'},
] as const;
export const PIPE_TOOLS=[
  {id:'straight',name:'Straight outlet',loss:.4,note:'Low-loss single discharge.'},
  {id:'elbow',name:'90° elbow',loss:1.4,note:'A turning outlet with added resistance.'},
  {id:'twin',name:'Twin manifold',loss:2.8,note:'Split delivery between two outlets.'},
  {id:'nozzle',name:'Converging nozzle',loss:4.5,note:'Half-bore exit, concentrated discharge.'},
  {id:'spraybar',name:'Six-port distributor',loss:5.2,note:'Six separate outlets spread delivery across the bed.'},
  {id:'bell',name:'Bell diffuser',loss:2.1,note:'A wider exit reduces discharge speed.'},
] as const;
export const TERRAINS=[
  {id:'flat',name:'Planar bed'}, {id:'crown',name:'Crowned road'},
  {id:'gutter',name:'Side gutter'}, {id:'bowl',name:'Shallow hollow'},
  {id:'ridges',name:'Crosswise ridges'}, {id:'steps',name:'Stepped cascade'},
] as const;
export const SUPPLY_PROGRAMS=[{id:'steady',name:'Constant supply'},{id:'ramp',name:'Gradual start'},{id:'pulse',name:'Pulsed delivery'},{id:'surge',name:'Flood surge'}] as const;
export const LIQUID_DISPLAYS=[{id:'natural',name:'Natural'},{id:'depth',name:'Depth'},{id:'speed',name:'Speed'}] as const;
export type LiquidDisplay=typeof LIQUID_DISPLAYS[number]['id'];
export const STORMS=[{id:'steady',name:'Steady rain'},{id:'burst',name:'Storm burst'},{id:'showers',name:'Passing showers'}] as const;
export interface LiquidSettings {rig:LiquidRig;surface:typeof SURFACES[number]['id'];pipe:typeof PIPE_TOOLS[number]['id'];storm:typeof STORMS[number]['id'];terrain:typeof TERRAINS[number]['id'];supply:typeof SUPPLY_PROGRAMS[number]['id'];slope:number;inflow:number;bore:number;pipeLength:number;rain:number;drain:number;rainWind:number;head:number;valve:number;relief:number;bankHeight:number;channelWidth:number;meander:number;runSeconds:number;cutoff:number;}
export const LIQUID_DEFAULTS:LiquidSettings={rig:'flume',surface:'steel',pipe:'elbow',storm:'steady',terrain:'flat',supply:'steady',slope:0,inflow:18,bore:100,pipeLength:3,rain:0,drain:100,rainWind:0,head:4,valve:100,relief:30,bankHeight:.22,channelWidth:.85,meander:1,runSeconds:18,cutoff:0};
export const LIQUID_NUMBERS=[
  {key:'slope',label:'Bed slope',unit:'%',min:0,max:12,step:.5},
  {key:'inflow',label:'Pump demand',unit:'L/s',min:0,max:80,step:1},
  {key:'bore',label:'Pipe bore',unit:'mm',min:20,max:200,step:5},
  {key:'pipeLength',label:'Hydraulic pipe length',unit:'m',min:1,max:20,step:.5},
  {key:'rain',label:'Rain intensity',unit:'mm/h',min:0,max:300,step:5},
  {key:'rainWind',label:'Rain drift',unit:'m/s',min:-6,max:6,step:.5},
  {key:'drain',label:'Outlet opening',unit:'%',min:0,max:100,step:5},
  {key:'head',label:'Pump head',unit:'m',min:0,max:12,step:.1},
  {key:'valve',label:'Supply valve',unit:'%',min:0,max:100,step:5},
  {key:'relief',label:'Surface relief',unit:'mm',min:0,max:100,step:5},
  {key:'bankHeight',label:'Bank height',unit:'m',min:.04,max:.45,step:.01},
  {key:'channelWidth',label:'Channel width',unit:'m',min:.35,max:1.4,step:.05},
  {key:'meander',label:'Meander',unit:'×',min:0,max:1.4,step:.1},
  {key:'runSeconds',label:'Program duration',unit:'s',min:6,max:60,step:1},
  {key:'cutoff',label:'Stop supply at',unit:'s',min:0,max:60,step:.5},
] as const;
export const LIQUID_ENUMS={rig:LIQUID_RIGS,surface:SURFACES,pipe:PIPE_TOOLS,storm:STORMS,terrain:TERRAINS,supply:SUPPLY_PROGRAMS};
export const LIQUID_KEYS=Object.keys(LIQUID_DEFAULTS) as (keyof LiquidSettings)[];
export function liquidSettings(input:Partial<LiquidSettings>):LiquidSettings {
  const p={...LIQUID_DEFAULTS,...input};
  for(const c of LIQUID_NUMBERS)p[c.key]=Number.isFinite(p[c.key])?Math.max(c.min,Math.min(c.max,p[c.key])):LIQUID_DEFAULTS[c.key];
  for(const key of Object.keys(LIQUID_ENUMS) as (keyof typeof LIQUID_ENUMS)[])if(!LIQUID_ENUMS[key].some(v=>v.id===p[key]))Object.assign(p,{[key]:LIQUID_DEFAULTS[key]});
  return Object.fromEntries(LIQUID_KEYS.map(k=>[k,p[k]])) as unknown as LiquidSettings;
}
export const surfaceFor=(id:string)=>SURFACES.find(s=>s.id===id)??SURFACES[0];
export function rainFactor(time:number,storm:LiquidSettings['storm']):number {
  if(storm==='burst')return time<3?time/3:time<9?1:Math.max(0,1-(time-9)/3);
  if(storm==='showers')return Math.max(0,Math.sin(time*Math.PI/5));
  return 1;
}
export function supplyFactor(time:number,program:LiquidSettings['supply']):number {
  if(program==='ramp')return Math.min(1,Math.max(0,time/6));
  if(program==='pulse')return .5-.5*Math.cos(time*Math.PI/2);
  if(program==='surge')return .18+.82*Math.exp(-(((time-8)/2.8)**2));
  return 1;
}
/** Demand-limited Darcy-style resistance; authored viscosity and valve mapping are comparative. */
export function pipeDelivery(p:LiquidSettings,viscosity:number,density:number):{flow:number;speed:number;head:number;reynolds:number} {
  const d=p.bore/1000,area=Math.PI*d*d/4,tool=PIPE_TOOLS.find(t=>t.id===p.pipe)!,nu=(1e-6+viscosity*.00015)/density;
  if(p.valve<=0||p.head<=0)return {flow:0,speed:0,head:0,reynolds:0};
  const valveLoss=2*(1/(p.valve/100)**2-1);
  const headAt=(q:number)=>{const v=q/area,re=v*d/nu,f=re<2300?64/Math.max(re,1):.3164/Math.pow(re,.25);return {head:(f*p.pipeLength/d+tool.loss+valveLoss+1)*v*v/(2*9.81),re};};
  let low=0,high=p.inflow/1000;for(let i=0;i<28;i++){const mid=(low+high)/2;if(headAt(mid).head>p.head)high=mid;else low=mid;}
  const flow=(low+high)/2,exitArea=area*(p.pipe==='nozzle'?.25:p.pipe==='twin'?2:p.pipe==='spraybar'?1.5:p.pipe==='bell'?4:1);
  return {flow,speed:flow/exitArea,head:headAt(flow).head,reynolds:headAt(flow).re};
}
export const LIQUID_THICKNESS=[.1,.25,.5,1,2,4,8,12] as const;
export const FILM_DEPTHS=[.1,.5,1,2,5,10,20,50] as const;
