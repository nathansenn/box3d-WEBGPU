import type { StudyId, Vec } from './physics';

/** Appearance never changes the solver's coefficients. Load recipes are explicitly separate. */
export type PresetSource = 'StudiCraft' | 'HouseBuilder' | 'Commander Academy' | 'Material Forge';
export type SurfacePack = 'linen' | 'navy' | 'metal' | 'iron' | 'copper' | 'bronze' | 'timber' | 'oak';
export interface FinishPreset {
  id:string; name:string; study:StudyId; source:PresetSource; pack:SurfacePack;
  color:string; roughness:number; metalness:number; normal:number; description:string;
}
export interface LightingPreset {
  id:string; name:string; source:PresetSource; description:string;
  sky:string; horizon:string; ground:string; key:string; fill:string;
  intensity:number; ambient:number; environment:number; exposure:number; sun:Vec; haze:number;
}
export interface LoadPreset {
  id:string; name:string; study:StudyId; source:'Commander Academy';
  target:number; strength:number; wind:number; speed:number; description:string;
}
export const PACKS:Record<SurfacePack,{base:string;normal?:string;roughness?:string}> = {
  linen:{base:'linen-basecolor.webp',normal:'linen-normal.webp',roughness:'linen-roughness.webp'},
  navy:{base:'navy-basecolor.jpg',normal:'linen-normal.webp',roughness:'navy-roughness.jpg'},
  metal:{base:'machined-metal.png',normal:'iron-normal.webp',roughness:'iron-roughness.webp'},
  iron:{base:'iron-basecolor.webp',normal:'iron-normal.webp',roughness:'iron-roughness.webp'},
  copper:{base:'copper-basecolor.jpg',normal:'iron-normal.webp',roughness:'copper-roughness.jpg'},
  bronze:{base:'bronze-basecolor.jpg',normal:'iron-normal.webp',roughness:'bronze-roughness.jpg'},
  timber:{base:'timber-basecolor.webp',normal:'timber-normal.webp',roughness:'timber-roughness.webp'},
  oak:{base:'weathered-oak.png',normal:'timber-normal.webp',roughness:'timber-roughness.webp'},
};
type FinishRow=[string,string,SurfacePack,string,number,number,string,PresetSource?];
function finishes(study:StudyId,rows:FinishRow[]):FinishPreset[] {
  return rows.map(([slug,name,pack,color,roughness,metalness,description,source])=>({
    id:`${study}-${slug}`,name,study,pack,color,roughness,metalness,normal:study==='plate'?.18:study==='bridge'?.55:.34,
    description,source:source??(study==='canopy'?'Commander Academy':study==='plate'?'Material Forge':'HouseBuilder'),
  }));
}
export const FINISH_PRESETS:FinishPreset[] = [
  ...finishes('canopy',[
    ['linen','Natural linen','linen','#eee7d6',.93,0,'Warm woven fibers with a soft grazing sheen.'],
    ['chalk','Architectural chalk','linen','#ffffff',.88,0,'A bright membrane for reading curvature.','HouseBuilder'],
    ['sand','Desert sand','linen','#c6ac7e',.95,0,'Warm canvas with distinct fiber relief.'],
    ['sage','Sage canvas','linen','#9aa888',.91,0,'Muted botanical color and open weave.','HouseBuilder'],
    ['olive','Expedition olive','linen','#68724f',.97,0,'Deep field canvas with a dry surface.','StudiCraft'],
    ['clay','Terracotta weave','linen','#bc7157',.9,0,'Clay colored textile with warm highlights.','HouseBuilder'],
    ['ochre','Saffron sailcloth','linen','#cfaa54',.85,0,'A golden sail finish for warm environments.','Material Forge'],
    ['navy','Marine canvas','navy','#5c82c6',.94,0,'Deep blue canvas with a fine textile normal.','Material Forge'],
    ['slate','Blue slate','linen','#8499a4',.92,0,'Cool gray fibers reveal tension lines.','HouseBuilder'],
    ['graphite','Graphite textile','linen','#51565b',.84,0,'Charcoal cloth with a restrained sheen.','Material Forge'],
    ['rust','Oxide red','linen','#a4553e',.95,0,'Warm industrial red on a woven base.','Material Forge'],
    ['pearl','Pearl sail','linen','#e0e7e6',.74,0,'Cool pearl fibers with a smoother finish.','StudiCraft'],
  ]),
  ...finishes('plate',[
    ['machined','Machined aluminum','metal','#e4e7e6',.32,.92,'Directional machining and a clean reflected edge.'],
    ['iron','Worn iron','iron','#d6d9d6',.75,.78,'Oxidized pits, rolling marks and worn highlights.','Commander Academy'],
    ['copper','Aged copper','copper','#ffffff',.66,.82,'Copper oxidation from the local material library.'],
    ['bronze','Verdigris bronze','bronze','#ffffff',.84,.64,'Patinated bronze with mottled mineral color.'],
    ['titanium','Satin titanium','metal','#9eaab5',.55,.94,'Cool satin metal with a broad specular response.'],
    ['black','Matte black','iron','#292e33',.84,.2,'Architectural black coating over a rolled surface.','HouseBuilder'],
    ['galvalume','Natural galvalume','metal','#c6d1d4',.47,.86,'Bright zinc toned sheet with subdued gloss.','HouseBuilder'],
    ['brass','Brushed brass','metal','#ccab65',.43,.9,'Warm brass tone with fine directional scratches.'],
    ['oxide','Red oxide steel','iron','#ad6348',.91,.38,'Weathered oxide tones and coarse surface relief.'],
    ['white','Warm white enamel','metal','#ebe6da',.35,.08,'Warm architectural enamel on a fine metal base.','HouseBuilder'],
    ['blue','Midnight powder coat','iron','#3a5368',.63,.16,'A deep blue coating for the research atelier.','StudiCraft'],
    ['champagne','Champagne alloy','metal','#c7b59b',.28,.92,'Warm champagne metal and narrow highlights.'],
  ]),
  ...finishes('bridge',[
    ['weathered','Weathered oak','oak','#e1dbcb',.91,0,'Silvered grain, checks and weathered deck edges.'],
    ['aged','Reclaimed timber','timber','#eee3cf',.96,0,'Aged planks from the rope bridge study.','Commander Academy'],
    ['natural','Natural oak','oak','#dab583',.81,0,'Warm natural grain with a lightly oiled surface.'],
    ['walnut','Warm walnut','oak','#8b6750',.78,0,'Rich walnut tones with visible open grain.'],
    ['cedar','Western cedar','timber','#c58e66',.9,0,'Reddish outdoor timber and weathered checks.'],
    ['teak','Oiled teak','oak','#b29562',.62,0,'Golden timber with a restrained oil sheen.','Material Forge'],
    ['charred','Charred timber','timber','#464943',.98,0,'Dark charred boards with rough grain.'],
    ['driftwood','Coastal driftwood','oak','#bcc7c2',.96,0,'Pale silver boards for coastal lighting.','Material Forge'],
    ['redwood','Redwood deck','timber','#ac6c52',.86,0,'Warm red grain against the cool river.'],
    ['smoked','Smoked oak','oak','#8c8172',.85,0,'Smoked brown timber with a matte finish.'],
    ['pine','Honey pine','timber','#cbbb8a',.88,0,'Light honey boards and a visible aged grain.','Commander Academy'],
    ['ebonized','Ebonized oak','oak','#41494d',.65,0,'A near black oiled deck with fine highlights.','Material Forge'],
  ]),
];
export const LIGHTING_PRESETS:LightingPreset[] = [
  {id:'daylight',name:'North light',source:'HouseBuilder',description:'Balanced daylight, a cool sky and warm directional sun.',sky:'#849daf',horizon:'#d8dedc',ground:'#6b6d60',key:'#fff0d6',fill:'#cbdff1',intensity:3.1,ambient:.75,environment:.65,exposure:.88,sun:[-14,26,9],haze:1},
  {id:'softbox',name:'Material studio',source:'Material Forge',description:'Broad studio reflections reveal finish and surface relief.',sky:'#879197',horizon:'#d2d8d6',ground:'#64686a',key:'#fff4e7',fill:'#dbe7f4',intensity:2.6,ambient:.72,environment:1.15,exposure:.94,sun:[-18,18,14],haze:.5},
  {id:'raking',name:'Raking inspection',source:'Material Forge',description:'A low side light makes dents, tears and texture readable.',sky:'#677e92',horizon:'#cad5d8',ground:'#5a605c',key:'#ffe4be',fill:'#b4cee6',intensity:3.8,ambient:.35,environment:.58,exposure:.89,sun:[-30,9,8],haze:.5},
  {id:'overcast',name:'Overcast field',source:'StudiCraft',description:'Diffuse gray daylight with quiet, broad shadows.',sky:'#a0afb9',horizon:'#d5dcda',ground:'#737b72',key:'#e1e9ee',fill:'#c6d8e2',intensity:1.25,ambient:1.1,environment:.8,exposure:1.05,sun:[-14,35,12],haze:1.45},
  {id:'golden',name:'Golden hour',source:'StudiCraft',description:'Low warm sun against a cooler open sky.',sky:'#7290ab',horizon:'#f0cf9d',ground:'#735d45',key:'#ffd39a',fill:'#b6cde9',intensity:3.6,ambient:.55,environment:.62,exposure:.85,sun:[-28,10,18],haze:1.2},
  {id:'dawn',name:'First light',source:'StudiCraft',description:'Soft rose light and a mist colored horizon.',sky:'#8793b0',horizon:'#d7bdb1',ground:'#606268',key:'#ffdec9',fill:'#b7c8ef',intensity:2.2,ambient:.65,environment:.6,exposure:.99,sun:[22,9,-18],haze:1.6},
  {id:'blue-hour',name:'Blue hour',source:'StudiCraft',description:'A cool twilight study with a warm opposing fill.',sky:'#3c5775',horizon:'#9caebc',ground:'#3c4c55',key:'#b0cff5',fill:'#ffd5a5',intensity:1.65,ambient:.55,environment:.62,exposure:1.13,sun:[-14,14,20],haze:1.2},
  {id:'workshop',name:'Warm workshop',source:'Commander Academy',description:'Amber key light, cool windows and warm task lamps.',sky:'#6c8594',horizon:'#c6c8bf',ground:'#6b6254',key:'#ffd7a1',fill:'#afcbe4',intensity:3.4,ambient:.5,environment:.75,exposure:.92,sun:[-8,16,14],haze:.7},
  {id:'neutral',name:'Neutral evaluation',source:'HouseBuilder',description:'A neutral palette for comparing finish choices.',sky:'#9caaae',horizon:'#d9dedb',ground:'#747975',key:'#fffdf5',fill:'#d9e1e7',intensity:2.65,ambient:.85,environment:.8,exposure:.93,sun:[-10,28,18],haze:.7},
  {id:'storm',name:'Storm front',source:'StudiCraft',description:'A dark sky and cool directional light. Appearance only.',sky:'#465a70',horizon:'#85929d',ground:'#485149',key:'#c0d0e6',fill:'#a6b8d3',intensity:1.4,ambient:.5,environment:.4,exposure:1.01,sun:[-20,18,-9],haze:2},
  {id:'night',name:'Night shift',source:'Commander Academy',description:'Cool evening ambient with a focused warm inspection light.',sky:'#172a41',horizon:'#4d667c',ground:'#283038',key:'#ffddb1',fill:'#7998ce',intensity:2.5,ambient:.26,environment:.33,exposure:1.05,sun:[-8,16,10],haze:1.1},
  {id:'mist',name:'Morning mist',source:'Material Forge',description:'A pale mist softened valley with restrained highlights.',sky:'#aabdbd',horizon:'#d5ded5',ground:'#73847b',key:'#f2f2dd',fill:'#c7dce0',intensity:2,ambient:.95,environment:.65,exposure:.94,sun:[14,18,-15],haze:2.5},
];
function recipes(study:StudyId,rows:[string,string,number,number,number,number,string][]):LoadPreset[] {
  return rows.map(([slug,name,target,strength,wind,speed,description])=>({id:`${study}-${slug}`,study,name,target,strength,wind,speed,description,source:'Commander Academy'}));
}
export const LOAD_PRESETS:LoadPreset[] = [
  ...recipes('canopy',[
    ['service','Service pressure',.8,1,.1,1,'A modest pressure ramp for studying membrane deflection.'],
    ['calm','Calm tension',1.4,1.4,0,1,'An even pressure field with no crosswind.'],
    ['wind','Crosswind study',1.8,1,1.6,1,'Combine surface pressure with strong lateral forcing.'],
    ['tear','Tear propagation',4,1,.25,1,'Trace connection rupture and the growing tear.'],
    ['fragile','Weakened connections',3,.55,.6,.5,'Lower the connection limit and inspect damage slowly.'],
    ['reinforced','Reinforced comparison',4,1.8,.25,1,'Repeat the overload with stronger connections.'],
  ]),
  ...recipes('plate',[
    ['service','Shallow forming',.8,1,0,1,'A shallow indentation for studying plastic deformation.'],
    ['deep','Deep draw',1.7,1.5,0,.5,'Drive the punch deeper through a strengthened lattice.'],
    ['yield','Yield inspection',1.1,1.25,0,.5,'A slow view of the transition to a permanent dent.'],
    ['fracture','Punch through',4,1,0,1,'Follow yielding, contact and the opening fracture.'],
    ['fragile','Weak sheet connections',3,.55,0,.5,'Reduce the rupture threshold and inspect the damage path.'],
    ['reinforced','Strong sheet comparison',4,1.9,0,1,'Compare the same punch travel at a higher connection limit.'],
  ]),
  ...recipes('bridge',[
    ['service','Service crossing',.8,1,.1,1,'A modest asymmetric deck load in light wind.'],
    ['wind','Crosswind crossing',1.2,1.3,1.7,1,'Observe coupled deck and cable movement in crosswind.'],
    ['heavy','Heavy crossing',2.2,1.6,.25,1,'Explore load redistribution through the cable system.'],
    ['collapse','Progressive collapse',4,1,.25,1,'Trace cable rupture, support loss and falling deck sections.'],
    ['fragile','Weak connections',3,.5,.6,.5,'Inspect early connection losses at half speed.'],
    ['reinforced','Reinforced crossing',4,1.9,.25,1,'Repeat the overload with stronger cable connections.'],
  ]),
];
export const CAMERA_PRESETS = [
  {id:'hero',name:'Hero view',description:'The authored overview of the complete experiment.'},
  {id:'reverse',name:'Reverse angle',description:'Inspect the assembly from the opposing side.'},
  {id:'detail',name:'Specimen detail',description:'Move closer to surface response and connections.'},
  {id:'plan',name:'Plan inspection',description:'Look down on the load path and specimen.'},
  {id:'elevation',name:'Low elevation',description:'Read sag, deflection and support height in profile.'},
] as const;
export type CameraPreset = typeof CAMERA_PRESETS[number]['id'];
export const DEFAULT_FINISH:Record<StudyId,string> = {canopy:'canopy-linen',plate:'plate-machined',bridge:'bridge-weathered'};
export const DEFAULT_LOAD:Record<StudyId,string> = {canopy:'canopy-tear',plate:'plate-fracture',bridge:'bridge-collapse'};
export const PRESET_COUNT=FINISH_PRESETS.length+LIGHTING_PRESETS.length+LOAD_PRESETS.length+CAMERA_PRESETS.length;
export function finishFor(study:StudyId,id?:string|null):FinishPreset {return FINISH_PRESETS.find(p=>p.study===study&&p.id===id)??FINISH_PRESETS.find(p=>p.id===DEFAULT_FINISH[study])!;}
export function lightingFor(id?:string|null):LightingPreset {return LIGHTING_PRESETS.find(p=>p.id===id)??LIGHTING_PRESETS[0];}
export function loadFor(study:StudyId,id?:string|null):LoadPreset {return LOAD_PRESETS.find(p=>p.study===study&&p.id===id)??LOAD_PRESETS.find(p=>p.id===DEFAULT_LOAD[study])!;}
