/** Authored comparative material profiles, not certified alloy data.
 * Display scale is 100 mm / scene unit. Pressure is percent of model drive capacity.
 */
export interface MetalProfile {id:string;name:string;family:string;description:string;stiffness:number;yield:number;rupture:number;density:number;color:string;finish:string}
export const METALS:MetalProfile[]=[
  {id:'al-annealed',name:'Annealed aluminum',family:'Aluminum',description:'Soft, light and easy to form.',stiffness:.56,yield:.012,rupture:.38,density:.35,color:'#c8d2d6',finish:'plate-machined'},
  {id:'al-5052',name:'Aluminum 5052',family:'Aluminum',description:'A ductile sheet for deep forming.',stiffness:.7,yield:.021,rupture:.34,density:.35,color:'#c8d2d6',finish:'plate-machined'},
  {id:'al-6061',name:'Aluminum 6061',family:'Aluminum',description:'A stiffer aluminum comparison.',stiffness:.82,yield:.034,rupture:.24,density:.35,color:'#b7c6cf',finish:'plate-machined'},
  {id:'al-7075',name:'Aluminum 7075',family:'Aluminum',description:'High resistance, less room to stretch.',stiffness:1.2,yield:.048,rupture:.17,density:.36,color:'#a1aeb8',finish:'plate-titanium'},
  {id:'mild-steel',name:'Mild steel',family:'Steel',description:'A balanced forming and fracture baseline.',stiffness:1,yield:.025,rupture:.3,density:1,color:'#879da6',finish:'plate-machined'},
  {id:'galvanized',name:'Galvanized steel',family:'Steel',description:'Ductile steel beneath a zinc toned finish.',stiffness:1.02,yield:.027,rupture:.28,density:1,color:'#c1cbd0',finish:'plate-galvalume'},
  {id:'stainless-304',name:'Stainless steel 304',family:'Steel',description:'Resistant sheet with a long plastic range.',stiffness:1.18,yield:.036,rupture:.4,density:1.03,color:'#b5bdc2',finish:'plate-machined'},
  {id:'stainless-316',name:'Stainless steel 316',family:'Steel',description:'Tough, ductile stainless comparison.',stiffness:1.3,yield:.04,rupture:.43,density:1.04,color:'#a7b3c0',finish:'plate-titanium'},
  {id:'spring-steel',name:'Spring steel',family:'Steel',description:'High elastic resistance before a sharper failure.',stiffness:1.7,yield:.072,rupture:.16,density:1,color:'#667782',finish:'plate-gunmetal'},
  {id:'copper',name:'Annealed copper',family:'Copper alloys',description:'Low yield, generous permanent forming.',stiffness:.62,yield:.014,rupture:.44,density:1.15,color:'#ca825c',finish:'plate-burnished-copper'},
  {id:'brass',name:'Cartridge brass',family:'Copper alloys',description:'Warm brass with an easy forming response.',stiffness:.78,yield:.022,rupture:.36,density:1.08,color:'#c8ab63',finish:'plate-polished-brass'},
  {id:'bronze',name:'Phosphor bronze',family:'Copper alloys',description:'A harder, more resistant copper alloy.',stiffness:1.04,yield:.042,rupture:.25,density:1.12,color:'#b79257',finish:'plate-alloy-brass'},
  {id:'titanium',name:'Titanium alloy',family:'Specialty',description:'Light and resistant with limited ductility.',stiffness:1.45,yield:.064,rupture:.23,density:.58,color:'#919fab',finish:'plate-titanium'},
  {id:'magnesium',name:'Magnesium alloy',family:'Specialty',description:'Very light sheet with a short forming range.',stiffness:.46,yield:.024,rupture:.15,density:.23,color:'#ced0c8',finish:'plate-pewter'},
  {id:'nickel',name:'Nickel sheet',family:'Specialty',description:'Dense sheet with a broad plastic range.',stiffness:1.14,yield:.03,rupture:.42,density:1.14,color:'#c5c8bd',finish:'plate-pewter'},
  {id:'tin',name:'Soft tin',family:'Specialty',description:'A soft specimen for low pressure impressions.',stiffness:.28,yield:.009,rupture:.32,density:.94,color:'#c4cdc6',finish:'plate-pewter'},
];
export type PressToolId='round'|'wide'|'ball'|'cone'|'square'|'wedge'|'bead'|'ring'|'cross'|'four-point';
export interface PressTool {id:PressToolId;name:string;description:string;symbol:string}
export const PRESS_TOOLS:PressTool[]=[
  {id:'round',name:'Flat punch',description:'A circular face for drawing and punch through.',symbol:'●'},
  {id:'wide',name:'Wide platen',description:'Broad contact spreads the load across the sheet.',symbol:'▬'},
  {id:'ball',name:'Ball nose',description:'Rounded contact grows as the dimple deepens.',symbol:'◡'},
  {id:'cone',name:'Conical punch',description:'A tapered point concentrates the initial contact.',symbol:'▲'},
  {id:'square',name:'Square punch',description:'A square face creates four distinct strain corners.',symbol:'■'},
  {id:'wedge',name:'V blade',description:'A straight wedge forms a crease across the sheet.',symbol:'▽'},
  {id:'bead',name:'Beading bar',description:'A rounded bar creates an elongated impression.',symbol:'▰'},
  {id:'ring',name:'Annular punch',description:'A hollow tool loads a circular band.',symbol:'◎'},
  {id:'cross',name:'Cross former',description:'Intersecting ribs distribute load in two directions.',symbol:'✚'},
  {id:'four-point',name:'Four point',description:'Four spaced tips initiate separate dimples.',symbol:'⁙'},
];
export const THICKNESSES=[.5,.8,1,1.2,1.5,2,2.5,3,4,5,6,8,10,12,16,20];
export const STRIKE_SPEEDS=[2,5,10,25,50,100,150,250];
export interface PressSettings {metal:string;thickness:number;tool:PressToolId;toolScale:number;angle:number;pressure:number;strikeSpeed:number;stroke:number;hold:number}
export const DEFAULT_PRESS:PressSettings={metal:'mild-steel',thickness:2,tool:'round',toolScale:1,angle:0,pressure:80,strikeSpeed:50,stroke:130,hold:2};
export const metalFor=(id:string)=>METALS.find(p=>p.id===id)??METALS[4];
export const toolFor=(id:string)=>PRESS_TOOLS.find(p=>p.id===id)??PRESS_TOOLS[0];
const bound=(v:unknown,f:number,lo:number,hi:number)=>typeof v==='number'&&Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):f;
export function normalizePress(p:Partial<PressSettings>={}):PressSettings {
  return {metal:metalFor(p.metal??DEFAULT_PRESS.metal).id,tool:toolFor(p.tool??DEFAULT_PRESS.tool).id,
    thickness:bound(p.thickness,2,.5,20),toolScale:bound(p.toolScale,1,.65,1.3),angle:bound(p.angle,0,0,90),
    pressure:bound(p.pressure,80,0,100),strikeSpeed:bound(p.strikeSpeed,50,2,250),stroke:bound(p.stroke,130,5,140),hold:bound(p.hold,2,0,10)};
}
const queryKeys={metal:'metal',thickness:'thickness',tool:'tool',toolScale:'toolSize',angle:'toolAngle',pressure:'pressure',strikeSpeed:'strike',stroke:'stroke',hold:'hold'} as const;
export function readPress(q:URLSearchParams,base:Partial<PressSettings>={}):PressSettings {
  const p:Record<string,string|number>={...normalizePress(base)};
  for(const [k,key] of Object.entries(queryKeys)){const v=q.get(key);if(v!==null&&v.trim()!=='')p[k]=k==='metal'||k==='tool'?v:Number(v);}
  return normalizePress(p);
}
export function writePress(q:URLSearchParams,p:PressSettings):void {for(const [k,key] of Object.entries(queryKeys))q.set(key,String(p[k as keyof PressSettings]));}
export const sheetThickness=(p:PressSettings)=>p.thickness/100;
/** Exact lower tool surface shared with the tessellated visible attachment. Infinity means no contact. */
export function toolHeight(p:PressSettings,x:number,z:number):number {
  const a=p.angle*Math.PI/180;return toolHeightAt(p,x,z,Math.cos(a),Math.sin(a));
}
/** A fixed step can reuse its tool rotation across every projection/contact query. */
export function toolHeightAt(p:PressSettings,x:number,z:number,c:number,s:number):number {
  const u=(x*c-z*s)/p.toolScale,v=(x*s+z*c)/p.toolScale,r=Math.hypot(u,v);
  let h=Infinity;
  switch(p.tool){
    case 'round': h=r<=.86?0:Infinity;break;
    case 'wide': h=Math.abs(u)<=1.42&&Math.abs(v)<=1.12?0:Infinity;break;
    case 'square':h=Math.abs(u)<=.8&&Math.abs(v)<=.8?0:Infinity;break;
    case 'ball':h=r<=.88?.88-Math.sqrt(Math.max(0,.88**2-r*r)):Infinity;break;
    case 'cone':h=r<=.9?r*.95:Infinity;break;
    case 'wedge':h=Math.abs(u)<=.58&&Math.abs(v)<=1.65?Math.abs(u)*1.1:Infinity;break;
    case 'bead':h=Math.abs(u)<=.36&&Math.abs(v)<=1.55?.36-Math.sqrt(Math.max(0,.36**2-u*u)):Infinity;break;
    case 'ring':h=r>=.51&&r<=.95?0:Infinity;break;
    case 'cross':h=(Math.abs(u)<=.27&&Math.abs(v)<=1.25)||(Math.abs(v)<=.27&&Math.abs(u)<=1.25)?0:Infinity;break;
    case 'four-point':{const d=Math.hypot(Math.abs(u)-.68,Math.abs(v)-.68);h=d<=.3?.3-Math.sqrt(Math.max(0,.3**2-d*d)):Infinity;break;}
  }
  return h*p.toolScale;
}
export interface PressExperiment {id:string;name:string;intent:'Form'|'Fracture'|'Compare';note:string;settings:PressSettings}
const experiment=(id:string,name:string,intent:PressExperiment['intent'],note:string,p:Partial<PressSettings>):PressExperiment=>({id,name,intent,note,settings:normalizePress(p)});
export const PRESS_EXPERIMENTS:PressExperiment[]=[
  experiment('steel-baseline','Steel baseline','Form','2 mm · flat punch · steady stroke',{pressure:42,stroke:55,strikeSpeed:25}),
  experiment('copper-dimple','Copper dimple','Form','1.5 mm · ball nose · slow forming',{metal:'copper',thickness:1.5,tool:'ball',pressure:30,stroke:60,strikeSpeed:10}),
  experiment('aluminum-draw','Aluminum draw','Form','1 mm · wide platen · broad depression',{metal:'al-5052',thickness:1,tool:'wide',pressure:45,stroke:75,strikeSpeed:25}),
  experiment('brass-crease','Brass crease','Form','1.2 mm · V blade · diagonal fold',{metal:'brass',thickness:1.2,tool:'wedge',angle:30,pressure:38,stroke:65,strikeSpeed:10}),
  experiment('copper-bead','Copper bead','Form','2 mm · rounded bar · controlled impression',{metal:'copper',thickness:2,tool:'bead',pressure:35,stroke:50,strikeSpeed:10}),
  experiment('tin-emboss','Tin emboss','Form','0.8 mm · cross former · light pressure',{metal:'tin',thickness:.8,tool:'cross',pressure:12,stroke:35,strikeSpeed:5}),
  experiment('steel-punch','Steel punch through','Fracture','2 mm · flat punch · full pressure',{pressure:100,strikeSpeed:100,stroke:140}),
  experiment('cone-pierce','Point concentration','Fracture','1 mm · conical punch · fast strike',{metal:'al-6061',thickness:1,tool:'cone',pressure:95,strikeSpeed:150,stroke:140}),
  experiment('square-tear','Four corner tear','Fracture','0.8 mm · square punch · full stroke',{metal:'magnesium',thickness:.8,tool:'square',pressure:100,strikeSpeed:100,stroke:140}),
  experiment('ring-cut','Annular fracture','Fracture','1 mm · ring punch · concentrated band',{metal:'al-7075',thickness:1,tool:'ring',pressure:100,strikeSpeed:100,stroke:140}),
  experiment('four-dimples','Four point impact','Fracture','1 mm · four tips · rapid contact',{metal:'spring-steel',thickness:1,tool:'four-point',pressure:100,strikeSpeed:250,stroke:140}),
  experiment('thin-steel','Thin sheet','Compare','0.5 mm · compare against the thick plate',{thickness:.5,pressure:60,strikeSpeed:25,stroke:110}),
  experiment('thick-steel','Thick plate','Compare','12 mm · same tool, speed and pressure',{thickness:12,pressure:60,strikeSpeed:25,stroke:110}),
  experiment('slow-strike','Slow strike','Compare','2 mm · 5 mm/s · steady approach',{pressure:80,strikeSpeed:5}),
  experiment('fast-strike','Fast strike','Compare','2 mm · 250 mm/s · rapid approach',{pressure:80,strikeSpeed:250}),
  experiment('low-pressure','Low drive pressure','Compare','2 mm · 15% of model drive capacity',{pressure:15,strikeSpeed:50}),
  experiment('high-pressure','High drive pressure','Compare','2 mm · 95% of model drive capacity',{pressure:95,strikeSpeed:50}),
  experiment('titanium-test','Titanium resistance','Compare','4 mm · resistant alloy · ball nose',{metal:'titanium',thickness:4,tool:'ball',pressure:85,strikeSpeed:50}),
  experiment('stainless-draw','Stainless forming','Form','3 mm · 304 stainless · circular draw',{metal:'stainless-304',thickness:3,pressure:80,stroke:80,strikeSpeed:25}),
  experiment('bronze-bar','Bronze impression','Form','2 mm · bronze · a rounded linear tool',{metal:'bronze',tool:'bead',pressure:65,stroke:60,strikeSpeed:10}),
];
