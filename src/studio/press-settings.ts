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
  {id:'al-3003',name:'Aluminum 3003',family:'Aluminum',description:'A soft sheet comparison for shallow drawing and beads.',stiffness:.6,yield:.016,rupture:.4,density:.35,color:'#d0d6d8',finish:'plate-machined'},
  {id:'al-2024',name:'Aluminum 2024',family:'Aluminum',description:'A resistant aluminum profile with a shorter forming range.',stiffness:1.05,yield:.043,rupture:.19,density:.36,color:'#afbfc8',finish:'plate-titanium'},
  {id:'hsla-steel',name:'HSLA steel',family:'Steel',description:'Higher yield resistance than the mild steel baseline.',stiffness:1.32,yield:.052,rupture:.24,density:1,color:'#83949e',finish:'plate-gunmetal'},
  {id:'tool-steel',name:'Hardened tool steel',family:'Steel',description:'Strong elastic resistance and a short rupture margin.',stiffness:1.85,yield:.082,rupture:.13,density:1,color:'#6c7b86',finish:'plate-gunmetal'},
  {id:'stainless-430',name:'Stainless steel 430',family:'Steel',description:'A less ductile stainless comparison for corner strain.',stiffness:1.15,yield:.034,rupture:.23,density:1,color:'#b2bec2',finish:'plate-machined'},
  {id:'copper-hard',name:'Hard copper',family:'Copper alloys',description:'Compare work-hardened resistance with annealed copper.',stiffness:.89,yield:.038,rupture:.22,density:1.15,color:'#bc7756',finish:'plate-burnished-copper'},
  {id:'cupronickel',name:'Cupronickel',family:'Copper alloys',description:'A dense, ductile copper alloy for smooth forming.',stiffness:1.08,yield:.031,rupture:.39,density:1.14,color:'#c1b1a0',finish:'plate-pewter'},
  {id:'zinc',name:'Zinc sheet',family:'Specialty',description:'A light-pressure sheet comparison with early yielding.',stiffness:.42,yield:.018,rupture:.21,density:.92,color:'#aebec5',finish:'plate-galvalume'},
];
export type PressToolId='round'|'wide'|'ball'|'cone'|'square'|'wedge'|'bead'|'ring'|'cross'|'four-point'|'hex'|'capsule';
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
  {id:'hex',name:'Hexagonal punch',description:'Six corners concentrate strain around a flat hexagonal face.',symbol:'⬡'},
  {id:'capsule',name:'Capsule former',description:'An elongated flat face with rounded ends draws an oblong pocket.',symbol:'▯'},
];
export const THICKNESSES=[.5,.8,1,1.2,1.5,2,2.5,3,4,5,6,8,10,12,16,20];
export const STRIKE_SPEEDS=[2,5,10,25,50,100,150,250];
export interface PressAttachmentConfig {id:string;name:string;tool:PressToolId;toolScale:number;angle:number}
/** Tool cartridges are configurations of the matched visible/contact geometries. */
export const PRESS_ATTACHMENTS:PressAttachmentConfig[]=([
  ['round','Compact drawing punch',.65,0],['round','Standard drawing punch',1,0],['round','Broad drawing punch',1.3,0],
  ['wide','Compact flattening platen',.65,0],['wide','Full face platen',1,0],['wide','Oversize flattening platen',1.15,0],
  ['ball','Small ball former',.65,0],['ball','Deep bowl former',1,0],['ball','Broad radius former',1.3,0],
  ['cone','Fine conical point',.65,0],['cone','Standard piercing cone',1,0],['cone','Wide conical former',1.3,0],
  ['square','Small square punch',.65,0],['square','Standard square punch',1,0],['square','Diamond corner punch',1,45],
  ['wedge','Short V blade',.65,0],['wedge','Diagonal crease blade',1,45],['wedge','Crosswise long V blade',1.3,90],
  ['bead','Short round bead',.65,0],['bead','Diagonal beading bar',1,45],['bead','Crosswise long bead',1.3,90],
  ['ring','Small annular punch',.65,0],['ring','Standard annular punch',1,0],['ring','Large annular punch',1.3,0],
  ['cross','Fine cross emboss',.65,0],['cross','Standard cross former',1,0],['cross','Diagonal broad cross',1.3,45],
  ['four-point','Compact four point',.65,0],['four-point','Standard four point',1,0],['four-point','Wide four point',1.3,0],
  ['hex','Compact hexagonal punch',.65,0],['hex','Standard hexagonal punch',1,0],['hex','Rotated broad hexagon',1.3,30],
  ['capsule','Compact capsule former',.65,0],['capsule','Diagonal capsule former',1,45],['capsule','Crosswise broad capsule',1.3,90],
] as [PressToolId,string,number,number][]).map(([tool,name,toolScale,angle],i)=>({id:`cartridge-${i+1}`,tool,name,toolScale,angle}));
export function toolDimensions(p:Pick<PressSettings,'tool'|'toolScale'|'angle'>):string {
  const dimensions:Record<PressToolId,[number,number]>={round:[172,172],wide:[284,224],ball:[176,176],cone:[180,180],square:[160,160],wedge:[116,330],bead:[72,310],ring:[190,190],cross:[250,250],'four-point':[196,196],hex:[184,92*Math.sqrt(3)],capsule:[84,214]};
  let [width,depth]=dimensions[p.tool];const c=Math.abs(Math.cos(p.angle*Math.PI/180)),s=Math.abs(Math.sin(p.angle*Math.PI/180));
  if(p.tool==='hex'){
    const points=Array.from({length:6},(_,i)=>{const a=i*Math.PI/3-p.angle*Math.PI/180;return [92*Math.cos(a),92*Math.sin(a)];});
    width=2*Math.max(...points.map(v=>Math.abs(v[0])));depth=2*Math.max(...points.map(v=>Math.abs(v[1])));
  }
  else if(p.tool==='capsule'){width=84+130*s;depth=84+130*c;}
  else if(p.tool==='four-point')width=depth=136*(c+s)+60;
  else if(p.tool==='cross')width=depth=2*Math.max(125*c+27*s,27*c+125*s);
  else if(!['round','ball','cone','ring'].includes(p.tool))[width,depth]=[width*c+depth*s,width*s+depth*c];
  const [x,z]=[width,depth].map(n=>Math.round(n*p.toolScale));
  return ['round','ball','cone','ring'].includes(p.tool)?`Ø ${x} mm envelope`:`${x} × ${z} mm envelope`;
}
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
    case 'hex':h=Math.abs(v)<=Math.sqrt(3)*.46&&Math.sqrt(3)*Math.abs(u)+Math.abs(v)<=Math.sqrt(3)*.92?0:Infinity;break;
    case 'capsule':h=u*u+Math.max(0,Math.abs(v)-.65)**2<=.42**2?0:Infinity;break;
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
  experiment('3003-bowl','Soft aluminum bowl','Form','3003 · 1.2 mm · broad radius former',{metal:'al-3003',thickness:1.2,tool:'ball',toolScale:1.3,pressure:28,stroke:55,strikeSpeed:25}),
  experiment('2024-point','2024 point rupture','Fracture','2024 · 1 mm · fine conical point',{metal:'al-2024',thickness:1,tool:'cone',toolScale:.65,pressure:95,stroke:140,strikeSpeed:150}),
  experiment('hsla-draw','High strength drawing','Form','HSLA · 2 mm · compact drawing punch',{metal:'hsla-steel',toolScale:.65,pressure:65,stroke:65,strikeSpeed:25}),
  experiment('tool-steel-break','Hardened sheet impact','Fracture','Tool steel · 0.8 mm · diamond corners',{metal:'tool-steel',thickness:.8,tool:'square',angle:45,pressure:100,stroke:140,strikeSpeed:250}),
  experiment('430-crease','Ferritic stainless crease','Form','430 · 1.5 mm · diagonal V blade',{metal:'stainless-430',thickness:1.5,tool:'wedge',angle:45,pressure:48,stroke:50,strikeSpeed:25}),
  experiment('hard-copper-bowl','Hard copper bowl','Compare','2 mm · compare with annealed copper bowl',{metal:'copper-hard',tool:'ball',pressure:35,stroke:80,strikeSpeed:25}),
  experiment('cupronickel-draw','Cupronickel draw','Form','1.5 mm · broad circular impression',{metal:'cupronickel',thickness:1.5,toolScale:1.3,pressure:40,stroke:55,strikeSpeed:25}),
  experiment('zinc-bead','Zinc beading','Form','1 mm · short bead · gentle approach',{metal:'zinc',thickness:1,tool:'bead',toolScale:.65,pressure:20,stroke:40,strikeSpeed:10}),
  experiment('annealed-cross','Soft aluminum emboss','Form','Annealed aluminum · 0.8 mm · fine cross',{metal:'al-annealed',thickness:.8,tool:'cross',toolScale:.65,pressure:18,stroke:35,strikeSpeed:10}),
  experiment('galvanized-fold','Galvanized fold','Form','1.2 mm · crosswise V blade',{metal:'galvanized',thickness:1.2,tool:'wedge',angle:90,pressure:38,stroke:55,strikeSpeed:25}),
  experiment('316-bowl','316 stainless bowl','Form','2.5 mm · rounded contact · long hold',{metal:'stainless-316',thickness:2.5,tool:'ball',pressure:75,stroke:70,strikeSpeed:25,hold:5}),
  experiment('nickel-dimple','Nickel dimple','Form','1.5 mm · small ball former',{metal:'nickel',thickness:1.5,tool:'ball',toolScale:.65,pressure:45,stroke:60,strikeSpeed:25}),
  experiment('annealed-copper-bowl','Annealed copper bowl','Compare','2 mm · same settings as hard copper bowl',{metal:'copper',tool:'ball',pressure:35,stroke:80,strikeSpeed:25}),
  experiment('foil-ring','Thin annular tear','Fracture','0.5 mm aluminum · small annular tool',{metal:'al-7075',thickness:.5,tool:'ring',toolScale:.65,pressure:90,stroke:140,strikeSpeed:150}),
  experiment('diagonal-cross','Cross corner fracture','Fracture','1 mm magnesium · diagonal broad cross',{metal:'magnesium',thickness:1,tool:'cross',toolScale:1.3,angle:45,pressure:100,stroke:140,strikeSpeed:150}),
  experiment('broad-four-point','Separated point tears','Fracture','0.8 mm spring steel · wide four point',{metal:'spring-steel',thickness:.8,tool:'four-point',toolScale:1.3,pressure:100,stroke:140,strikeSpeed:150}),
  experiment('blade-tear','Blade line tear','Fracture','1 mm 2024 · short V blade',{metal:'al-2024',thickness:1,tool:'wedge',toolScale:.65,pressure:100,stroke:140,strikeSpeed:100}),
  experiment('steel-1mm','1 mm thickness trial','Compare','Steel · 60% drive · fixed stroke and speed',{thickness:1,pressure:60,stroke:110,strikeSpeed:25}),
  experiment('steel-3mm','3 mm thickness trial','Compare','Steel · 60% drive · fixed stroke and speed',{thickness:3,pressure:60,stroke:110,strikeSpeed:25}),
  experiment('steel-6mm','6 mm thickness trial','Compare','Steel · 60% drive · fixed stroke and speed',{thickness:6,pressure:60,stroke:110,strikeSpeed:25}),
  experiment('steel-20mm','20 mm plate trial','Compare','Steel · 60% drive · fixed stroke and speed',{thickness:20,pressure:60,stroke:110,strikeSpeed:25}),
  experiment('compact-ball','Small contact footprint','Compare','Copper · Ø 114 mm ball · 35% drive',{metal:'copper',tool:'ball',toolScale:.65,pressure:35,stroke:80,strikeSpeed:25}),
  experiment('broad-ball','Large contact footprint','Compare','Copper · Ø 229 mm ball · 35% drive',{metal:'copper',tool:'ball',toolScale:1.3,pressure:35,stroke:80,strikeSpeed:25}),
  experiment('zero-hold','Immediate retraction','Compare','1 mm copper · shallow stroke · no dwell',{metal:'copper',thickness:1,tool:'ball',pressure:40,stroke:35,strikeSpeed:100,hold:0}),
  experiment('long-hold','Extended dwell','Compare','1 mm copper · same stroke · 8 second hold',{metal:'copper',thickness:1,tool:'ball',pressure:40,stroke:35,strikeSpeed:100,hold:8}),
  experiment('crease-lengthwise','Lengthwise crease','Compare','Brass · V blade · 0° orientation',{metal:'brass',tool:'wedge',pressure:50,stroke:65,strikeSpeed:25,angle:0}),
  experiment('crease-crosswise','Crosswise crease','Compare','Brass · V blade · 90° orientation',{metal:'brass',tool:'wedge',pressure:50,stroke:65,strikeSpeed:25,angle:90}),
  experiment('medium-pressure','Mid drive pressure','Compare','2 mm · 50% drive · compare low and high',{pressure:50,strikeSpeed:50}),
  experiment('copper-capsule','Copper capsule pocket','Form','2 mm copper · oblong face · shallow draw',{metal:'copper',tool:'capsule',pressure:38,stroke:55,strikeSpeed:25,hold:2}),
  experiment('hex-emboss','Six corner emboss','Form','1.2 mm 3003 · compact hexagonal face',{metal:'al-3003',thickness:1.2,tool:'hex',toolScale:.65,pressure:30,stroke:45,strikeSpeed:25}),
  experiment('hex-tear','Hexagonal corner tears','Fracture','0.8 mm 2024 · rotated six corner punch',{metal:'al-2024',thickness:.8,tool:'hex',angle:30,pressure:100,stroke:140,strikeSpeed:150}),
  experiment('capsule-tear','Oblong end fracture','Fracture','1 mm magnesium · diagonal capsule · full stroke',{metal:'magnesium',thickness:1,tool:'capsule',angle:45,pressure:100,stroke:140,strikeSpeed:100}),
  experiment('capsule-lengthwise','Lengthwise pocket','Compare','2 mm steel · capsule · 0° orientation',{tool:'capsule',pressure:65,stroke:100,strikeSpeed:50,angle:0}),
  experiment('capsule-crosswise','Crosswise pocket','Compare','2 mm steel · same capsule · 90° orientation',{tool:'capsule',pressure:65,stroke:100,strikeSpeed:50,angle:90}),
];
/** Fields normalizePress would silently change (unknown ids, NaN, out-of-range), so imports can surface a warning. */
export function pressAdjustments(p:Partial<PressSettings>):(keyof PressSettings)[] {
  const n=normalizePress(p),merged={...DEFAULT_PRESS,...p} as Record<string,unknown>;
  return (Object.keys(n) as (keyof PressSettings)[]).filter(k=>p[k]!==undefined&&merged[k]!==n[k]);
}
