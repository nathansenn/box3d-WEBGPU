export const LAB_IDS=['liquid','glass','concrete','rubber','granular'] as const;
export type LabId=typeof LAB_IDS[number];
export type LabMode='release'|'pulse'|'cycle';
export interface LabSettings {material:string;mode:LabMode;load:number;rate:number;size:number;damping:number;fill:number;seed:number;}
export interface MaterialProfile {id:string;name:string;color:string;note:string;strength:number;damping:number;friction:number;density:number;viscosity:number;retention:number;}
export interface Control {key:Exclude<keyof LabSettings,'material'|'mode'|'seed'>;label:string;unit:string;min:number;max:number;step:number;}
export interface Experiment {id:string;name:string;description:string;settings:Partial<LabSettings>;}
export interface LabDefinition {id:LabId;title:string;subtitle:string;code:string;icon:string;mechanism:string;duration:number;defaults:LabSettings;controls:Control[];experiments:Experiment[];}
const profile=(id:string,name:string,color:string,note:string,p:Partial<MaterialProfile>={}):MaterialProfile=>({id,name,color,note,strength:1,damping:.2,friction:.5,density:1,viscosity:.1,retention:0,...p});
export const MATERIALS:Record<LabId,MaterialProfile[]>={
  liquid:[
    profile('water','Clear water','#248d9c','Fast moving, low resistance flow.',{viscosity:.02}),
    profile('seawater','Sea water','#347d91','Cool blue water with a little more resistance.',{viscosity:.035,density:1.03}),
    profile('oil','Amber oil','#a77420','Viscous amber flow with strongly damped waves.',{viscosity:.7,density:.87}),
    profile('glycerin','Glycerin','#89bdb6','Clear, slow flow. Watch the release front broaden.',{viscosity:1.8,density:1.26}),
    profile('honey','Honey','#b9650e','A thick golden flow with very little oscillation.',{viscosity:5,density:1.4}),
    profile('syrup','Dark syrup','#713620','Dense and highly damped spreading.',{viscosity:3.4,density:1.3}),
    profile('coolant','Blue coolant','#238fc3','A bright flow tracer with moderate damping.',{viscosity:.24}),
    profile('slurry','Mineral slurry','#969184','A coarse mixture represented as a viscous depth field.',{viscosity:1.15,density:1.6}),
  ],
  glass:[
    profile('annealed','Annealed glass','#a5d3d1','Large radial fragments detach after the impact threshold.',{strength:1}),
    profile('tempered','Tempered glass','#c0e3df','Higher onset resistance; finer fragments release together.',{strength:2.2}),
    profile('laminated','Laminated glass','#8fbfba','A retaining layer keeps fractured pieces connected.',{strength:1.35,retention:.94}),
    profile('borosilicate','Borosilicate','#c8e2dc','A stiff brittle comparison specimen.',{strength:1.6}),
    profile('frosted','Frosted glass','#dbe7df','Diffuse surface with annealed-style fracture.',{strength:.95}),
    profile('tinted','Bronze glass','#a79372','Tinted brittle panel with large visible shards.',{strength:1.05}),
    profile('wired','Wired glass','#8daca7','A retaining network restricts fragment travel.',{strength:1.2,retention:.8}),
    profile('acrylic','Acrylic panel','#b5e0de','A tougher, more compliant panel for comparison.',{strength:3.4,retention:.65,damping:.6}),
  ],
  concrete:[
    profile('standard','Standard concrete','#aeaaa0','Aggregate-rich baseline with brittle bond loss.'),
    profile('high-strength','High strength','#9f9d95','Greater resistance before the fragment bonds fail.',{strength:1.7}),
    profile('reinforced','Reinforced concrete','#a6a396','Internal ties retain the core after cover spalls.',{strength:1.3,retention:.82}),
    profile('fiber','Fiber concrete','#b7b2a4','More distributed damage and retained fragments.',{strength:1.2,retention:.55}),
    profile('lightweight','Lightweight concrete','#ccc6b8','Low density with earlier compression damage.',{strength:.6,density:.65}),
    profile('mortar','Mortar','#c1b8a5','A relatively soft, fine-grained specimen.',{strength:.65}),
    profile('aged','Weathered concrete','#a79d89','Reduced bond strength and early corner spall.',{strength:.45}),
    profile('ceramic','Technical ceramic','#dfd8c6','A hard brittle comparison with little retention.',{strength:2.1}),
  ],
  rubber:[
    profile('silicone','Teal silicone','#31999a','Soft compression, rounded bulging and elastic recovery.',{strength:.8,damping:.55,retention:.98}),
    profile('natural','Natural rubber','#403b33','Resilient specimen with lively recovery.',{strength:1.1,damping:.18,retention:.99}),
    profile('neoprene','Neoprene','#343b3b','A firmer response with damped rebound.',{strength:1.4,damping:.65,retention:.97}),
    profile('epdm','EPDM','#3d4240','Firm and strongly damped.',{strength:1.6,damping:.85,retention:.97}),
    profile('polyurethane','Polyurethane','#d17629','High resistance and a restrained rebound.',{strength:2.1,damping:.35,retention:.96}),
    profile('gel','Soft gel','#80bdba','Large deformation with slow recovery.',{strength:.4,damping:.92,retention:.97}),
    profile('foam','Open cell foam','#e4d6ad','Volume decreases under load; some permanent set remains.',{strength:.35,damping:.9,retention:.2}),
    profile('memory-foam','Memory foam','#c8c2a8','Strong creep and slow, incomplete recovery.',{strength:.45,damping:1,retention:.35}),
  ],
  granular:[
    profile('sand','Dry sand','#c4a366','Frictional grains form a stable spreading pile.',{friction:.62}),
    profile('beads','Glass beads','#91bcb7','Smooth particles spread farther and rebound.',{friction:.12,damping:.08}),
    profile('gravel','Rounded gravel','#9b9382','Heavy coarse particles with moderate friction.',{friction:.48,density:1.6}),
    profile('angular','Crushed stone','#827f73','High friction limits spreading.',{friction:.85,density:1.7}),
    profile('pellets','Polymer pellets','#decac0','Light, smooth grains.',{friction:.24,density:.55}),
    profile('rice','Grain surrogate','#d7c28f','A higher-friction spherical surrogate for granular food.',{friction:.72,density:.7}),
    profile('steel','Steel shot','#859297','Dense low-friction shot with metallic reflections.',{friction:.18,density:3.1}),
    profile('damp-sand','Damp sand surrogate','#9f8a60','Strong contact damping; no capillary model is implied.',{friction:.95,damping:.85}),
  ],
};
const c=(key:Control['key'],label:string,unit:string,min:number,max:number,step:number):Control=>({key,label,unit,min,max,step});
const base:LabSettings={material:'',mode:'release',load:60,rate:1,size:1,damping:1,fill:75,seed:42};
const e=(id:string,name:string,description:string,settings:Partial<LabSettings>):Experiment=>({id,name,description,settings});
export const LABS:Record<LabId,LabDefinition>={
  liquid:{id:'liquid',code:'FL–01',title:'Liquid dynamics',subtitle:'A controlled release through a transparent flow channel.',icon:'waves',mechanism:'Gate release → wave → obstacle wakes',duration:18,defaults:{...base,material:'water',load:100,rate:.8,size:.65,fill:10},
    controls:[c('size','Reservoir depth','m',.2,.9,.05),c('load','Gate opening','%',10,100,5),c('rate','Gate speed','m/s',.1,2,.1),c('damping','Viscosity multiplier','×',.25,5,.25),c('fill','Downstream fill','%',0,80,5)],
    experiments:[e('water-release','Clear-water release','A clean wave passes the twin posts.',{}),e('oil-release','Oil through the gate','Watch viscosity suppress the wave.',{material:'oil'}),e('honey-creep','Honey creep','Slow, thick flow with a narrow opening.',{material:'honey',load:35,rate:.2}),e('deep-reservoir','Deep reservoir','A larger head drives a stronger front.',{size:.9,fill:0}),e('slow-gate','Slow gate lift','Meter the release over several seconds.',{rate:.1,load:55}),e('reflected-wave','Reflected wave','Watch a pulse return from the tank end.',{mode:'pulse',fill:65,size:.6}),e('blue-tracer','Blue tracer','Follow the flow around the posts.',{material:'coolant',rate:1.6}),e('slurry-front','Slurry front','A dense viscous depth-field comparison.',{material:'slurry',size:.8})]},
  glass:{id:'glass',code:'GI–02',title:'Glass impact',subtitle:'Pendulum impact, crack propagation and fragment retention.',icon:'diamond',mechanism:'Impact → radial fracture → shard release',duration:12,defaults:{...base,material:'annealed',load:50,rate:1.1,size:8,damping:1,fill:0},
    controls:[c('size','Panel thickness','mm',3,24,1),c('load','Pendulum mass','kg',5,100,5),c('rate','Drop height','m',.1,2,.1),c('damping','Support restraint','×',.5,2,.1),c('fill','Impact offset','%',0,65,5)],
    experiments:[e('radial-impact','Radial impact','A central strike opens large radial shards.',{}),e('tempered-dice','Tempered breakup','A higher-energy strike releases finer fragments.',{material:'tempered',load:90,rate:1.8}),e('laminated-retention','Laminated retention','Broken pieces remain held by a retaining layer.',{material:'laminated',load:80,rate:1.5}),e('thick-panel','Thick panel','A stronger section resists the same impact.',{size:24,load:25,rate:.4}),e('edge-strike','Off-center strike','Move the impact toward one support.',{fill:60}),e('frosted-fracture','Frosted fracture','Read the crack pattern on a diffuse surface.',{material:'frosted',load:65}),e('wired-retention','Wired retention','A retained network limits fragment motion.',{material:'wired',load:80}),e('acrylic-comparison','Acrylic comparison','A compliant high-threshold panel.',{material:'acrylic',load:30,rate:.5})]},
  concrete:{id:'concrete',code:'CC–03',title:'Concrete crush',subtitle:'Controlled compression of a bonded aggregate specimen.',icon:'cube',mechanism:'Compression → bond failure → spalling',duration:16,defaults:{...base,material:'standard',load:35,rate:5,size:1,damping:1,fill:0},
    controls:[c('load','Target compression','%',2,60,2),c('rate','Loading rate','%/s',1,12,1),c('size','Specimen scale','×',.7,1.25,.05),c('damping','Lateral restraint','×',.25,2,.25)],
    experiments:[e('cube-crush','Cube compression','Cracks form as fragment bonds lose integrity.',{}),e('reinforced-core','Reinforced core','Compare retained core and loose cover.',{material:'reinforced',load:48}),e('high-strength','High-strength cube','Increase compression against stronger bonds.',{material:'high-strength',load:50}),e('lightweight-crush','Lightweight crush','A softer, lower-density specimen.',{material:'lightweight',load:40}),e('aged-spall','Weathered spall','Earlier corner and edge failures.',{material:'aged',rate:3}),e('fiber-bridging','Fiber bridging','Distributed retention after cracking.',{material:'fiber',load:45}),e('low-strain','Low-strain comparison','Stop before substantial damage accumulates.',{load:3,rate:1}),e('ceramic-crush','Ceramic comparison','A high-threshold brittle material.',{material:'ceramic',load:55,rate:8})]},
  rubber:{id:'rubber',code:'EL–04',title:'Elastomer lab',subtitle:'Compression, hold, creep and recovery between circular platens.',icon:'cylinder',mechanism:'Compression → bulging → recovery',duration:18,defaults:{...base,material:'silicone',mode:'cycle',load:50,rate:20,size:1,damping:2},
    controls:[c('load','Target compression','%',5,80,5),c('rate','Compression rate','%/s',5,50,5),c('size','Specimen scale','×',.7,1.3,.05),c('damping','Hold at depth','s',0,8,.5)],
    experiments:[e('silicone-cycle','Silicone recovery','Compress, hold and watch the specimen recover.',{}),e('rubber-rebound','Rubber rebound','A livelier return after release.',{material:'natural',rate:40,damping:1}),e('foam-collapse','Foam collapse','A compressible specimen with permanent set.',{material:'foam',load:75}),e('slow-creep','Memory-foam creep','A slow compression and longer hold.',{material:'memory-foam',mode:'pulse',rate:5,damping:6}),e('firm-urethane','Firm polyurethane','A stiffer puck under the same program.',{material:'polyurethane',load:45}),e('soft-gel','Soft gel','Large smooth deformation and slow recovery.',{material:'gel',load:65}),e('neoprene-hold','Neoprene hold','Damped recovery after a long hold.',{material:'neoprene',damping:5}),e('epdm-comparison','EPDM comparison','Firm material at a modest strain.',{material:'epdm',load:35})]},
  granular:{id:'granular',code:'GF–05',title:'Granular flow',subtitle:'Gate release, particle contacts and frictional settling.',icon:'circles-three',mechanism:'Release → avalanche → resting pile',duration:14,defaults:{...base,material:'sand',load:100,rate:1.2,size:10,damping:1,fill:80},
    controls:[c('size','Grain diameter','mm',7,16,1),c('load','Gate opening','%',15,100,5),c('rate','Gate speed','×',.2,2,.2),c('damping','Contact friction','×',.25,2,.25),c('fill','Column fill','%',30,100,10)],
    experiments:[e('sand-avalanche','Sand avalanche','Release the column around a solid obstacle.',{}),e('bead-runout','Glass-bead runout','Low-friction grains spread farther.',{material:'beads'}),e('coarse-gravel','Coarse gravel','Larger particles and a lower column.',{material:'gravel',size:16,fill:60}),e('angular-pile','Crushed-stone pile','High friction holds a steeper deposit.',{material:'angular',damping:1.5}),e('slow-sluice','Metered discharge','Release grains through a small opening.',{load:30,rate:.3}),e('polymer-pellets','Polymer pellets','Light smooth particles spread and settle.',{material:'pellets',size:8}),e('steel-shot','Steel shot','A metallic low-friction comparison.',{material:'steel'}),e('damped-pile','Damped pile','Strong damping suppresses particle rebound.',{material:'damp-sand',damping:1.5})]},
};
export const isLab=(id:string):id is LabId=>(LAB_IDS as readonly string[]).includes(id);
export const materialFor=(id:LabId,material:string):MaterialProfile=>MATERIALS[id].find(m=>m.id===material)??MATERIALS[id][0];
export function normalizeSettings(id:LabId,input:Partial<LabSettings>={}):LabSettings {
  const lab=LABS[id],p={...lab.defaults,...input};p.material=materialFor(id,p.material).id;
  for(const control of lab.controls){const v=p[control.key];p[control.key]=Number.isFinite(v)?Math.min(control.max,Math.max(control.min,v)):lab.defaults[control.key];}
  for(const key of ['load','rate','size','damping','fill'] as const)if(!Number.isFinite(p[key]))p[key]=lab.defaults[key];
  p.seed=Number.isFinite(p.seed)?Math.min(999999,Math.max(1,Math.round(p.seed))):42;
  if(!['release','pulse','cycle'].includes(p.mode))p.mode=lab.defaults.mode;
  return p;
}
export function readSettings(id:LabId,q:URLSearchParams):LabSettings {
  const experiment=LABS[id].experiments.find(e=>e.id===q.get('experiment'));
  const p:Partial<LabSettings>={...experiment?.settings};
  for(const c of LABS[id].controls)if(q.has(c.key))p[c.key]=Number(q.get(c.key));
  if(q.has('material'))p.material=q.get('material')!;
  if(q.has('seed'))p.seed=Number(q.get('seed'));
  if(q.has('mode'))p.mode=q.get('mode') as LabMode;
  return normalizeSettings(id,p);
}
export function writeSettings(id:LabId,p:LabSettings,experiment=''):string {
  const q=new URLSearchParams({studio:id,material:p.material,mode:p.mode,seed:String(p.seed)});
  for(const c of LABS[id].controls)q.set(c.key,String(p[c.key]));
  if(experiment)q.set('experiment',experiment);return '?'+q;
}
