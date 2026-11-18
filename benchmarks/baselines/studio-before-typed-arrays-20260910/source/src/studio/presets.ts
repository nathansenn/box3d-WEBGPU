import type { StudyId, Vec } from './physics';

/** Appearance never changes the solver's coefficients. Load recipes are explicitly separate. */
export type PresetSource = 'StudiCraft' | 'HouseBuilder' | 'Commander Academy' | 'Material Forge';
export type SurfacePack = 'linen' | 'navy' | 'metal' | 'iron' | 'copper' | 'bronze' | 'timber' | 'oak' | 'brass' | 'leather' | 'cloudrest' | 'forged' | 'copper-sheet';
export interface FinishPreset {
  id:string; name:string; study:StudyId; source:PresetSource; pack:SurfacePack;
  color:string; roughness:number; metalness:number; normal:number; description:string;
  sheen?:number; clearcoat?:number; anisotropy?:number;
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
  brass:{base:'brass-basecolor.webp',normal:'brass-normal.webp',roughness:'brass-roughness.webp'},
  leather:{base:'leather-basecolor.webp',normal:'leather-normal.webp',roughness:'leather-roughness.webp'},
  cloudrest:{base:'cloudrest-basecolor.webp',normal:'cloudrest-normal.webp',roughness:'cloudrest-roughness.webp'},
  forged:{base:'forged-basecolor.webp',normal:'forged-normal.webp',roughness:'forged-roughness.webp'},
  'copper-sheet':{base:'copper-sheet-basecolor.webp',normal:'copper-sheet-normal.webp',roughness:'copper-sheet-roughness.webp'},
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
    ['porcelain','Porcelain sailcloth','linen','#fff8ea',.62,0,'Soft reflective fibers in a warm architectural white.','HouseBuilder'],
    ['denim','Indigo sailcloth','navy','#8bade9',.83,0,'A brighter indigo dye over fine marine canvas.','Material Forge'],
    ['jute','Raw flax','linen','#bda373',1,0,'A dry, warm weave with almost no specular sheen.'],
    ['silver','Silver coated canvas','linen','#bac4cf',.46,0,'A smooth protective coating over visible woven fibers.','StudiCraft'],
    ['forest','Forest canopy','linen','#60765c',.96,0,'Deep green canvas with subdued grazing highlights.','HouseBuilder'],
    ['carmine','Carmine sail','linen','#a44843',.8,0,'A saturated sail finish against a neutral fixture.','StudiCraft'],
    ['leather','Heirloom leather finish','leather','#f2cfac',.94,0,'Academy leather grain on the membrane; appearance only.'],
    ['saddle','Saddle leather finish','leather','#ad7655',.69,0,'Dark saddle grain with a light protective surface coat.'],
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
    ['alloy-brass','Workshop brass','brass','#fff2d5',.64,.87,'Matched brass albedo, relief and roughness from the alloy lab.','Commander Academy'],
    ['antique-brass','Antique brass','brass','#cbb99a',.88,.8,'A muted aged brass with broad, worn reflections.','Commander Academy'],
    ['polished-brass','Satin gold brass','brass','#f3daa1',.37,.94,'Lower surface roughness makes the brass highlights travel.','Material Forge'],
    ['forged','Blacksmith iron','forged','#d7d6c8',.87,.79,'Hammered and scaled iron from the blacksmith study.','Commander Academy'],
    ['gunmetal','Gunmetal iron','forged','#78878e',.61,.86,'Cool forged metal with strongly readable tool relief.','StudiCraft'],
    ['copper-sheet','Copper workshop sheet','copper-sheet','#fff7e9',.62,.9,'Matched copper maps preserve the original hammered patina.','Commander Academy'],
    ['burnished-copper','Burnished copper','copper-sheet','#edc8af',.39,.92,'Copper grain with smoother highlight transitions.','Material Forge'],
    ['pewter','Architectural pewter','metal','#bac3ba',.67,.78,'A restrained satin gray for neutral material comparison.','HouseBuilder'],
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
    ['cloudrest','Cloudrest bridge timber','cloudrest','#f3e3c7',.94,0,'Matched grain and checks from the Cloudrest bridge study.','Commander Academy'],
    ['alpine','Alpine silver timber','cloudrest','#ced4ce',.98,0,'Silver washed bridge boards with coarse weathered relief.','Commander Academy'],
    ['amber','Amber bridge timber','cloudrest','#d4ad7d',.76,0,'Warm oil tones follow the original Cloudrest grain.','Material Forge'],
    ['tobacco','Tobacco bridge timber','cloudrest','#92836d',.88,0,'Deep aged grain against the bright valley floor.','StudiCraft'],
    ['limed','Limed oak','oak','#f4e9cf',.97,0,'Pale architectural oak with quiet, open grain.','HouseBuilder'],
    ['espresso','Espresso oak','oak','#5b4b3d',.7,0,'Dark oiled boards with a low, warm sheen.','HouseBuilder'],
    ['silver-pine','Silver pine','timber','#d5d6c1',.96,0,'Pale weathered planks and pronounced longitudinal grain.','Commander Academy'],
    ['red-cedar','Red cedar oil','timber','#bc8465',.69,0,'Warm cedar color under a smooth outdoor oil treatment.','HouseBuilder'],
  ]),
];
// Finish response is authored separately from the immutable source texture maps.
for(const p of FINISH_PRESETS){
  if(p.pack==='leather'){p.normal=.12;p.sheen=.08;p.clearcoat=p.id==='canopy-saddle'?.25:0;}
  if(p.id==='canopy-jute')p.sheen=.12;
  if(p.id==='canopy-silver'){p.sheen=.15;p.clearcoat=.3;}
  if(p.id==='canopy-porcelain')p.sheen=.7;
  if(p.study==='plate')p.anisotropy=p.pack==='metal'?.42:p.pack==='brass'?.2:0;
  if(p.pack==='forged')p.normal=.26;
  if(p.pack==='cloudrest')p.normal=.45;
}
export const LIGHTING_PRESETS:LightingPreset[] = [
  {id:'woodland-daylight',name:'Woodland daylight',source:'StudiCraft',description:'Clear late-morning light, cumulus clouds and soft woodland bounce from the new bridge reference.',sky:'#77a5d3',horizon:'#c8dbe8',ground:'#6b745a',key:'#fff1dd',fill:'#dbe9f1',intensity:4.3,ambient:.85,environment:.72,exposure:.99,sun:[-32,45,25],haze:1.03},
  {id:'reference-daylight',name:'Reference daylight',source:'StudiCraft',description:'A blue sky, warm high sun and restrained haze for the original scene composition.',sky:'#6e9fc6',horizon:'#ccdbe3',ground:'#686f5a',key:'#fff0d5',fill:'#d2e3ed',intensity:4.2,ambient:.62,environment:.62,exposure:.96,sun:[-26,36,-18],haze:.65},
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
  {id:'afternoon',name:'Late afternoon',source:'HouseBuilder',description:'Clear side light and long architectural shadows.',sky:'#7499b8',horizon:'#dce1d4',ground:'#747464',key:'#ffe0ac',fill:'#bad7ee',intensity:3.2,ambient:.65,environment:.72,exposure:.91,sun:[26,15,9],haze:.8},
  {id:'coolbox',name:'Cool inspection booth',source:'Material Forge',description:'Cool broad reflections separate warm metals from their fixture.',sky:'#7c94a8',horizon:'#cedae2',ground:'#596976',key:'#dcecff',fill:'#d1e1eb',intensity:2.8,ambient:.8,environment:1.25,exposure:.96,sun:[16,24,14],haze:.55},
  {id:'crosslight',name:'Cross light',source:'Commander Academy',description:'A key from the opposite side reveals hidden surface relief.',sky:'#90a3af',horizon:'#d9dcd6',ground:'#767b70',key:'#fff4de',fill:'#adcfe7',intensity:3.6,ambient:.48,environment:.9,exposure:.9,sun:[27,12,-18],haze:.65},
  {id:'amber-room',name:'Amber workshop',source:'Commander Academy',description:'Warm task light with enough sky fill to retain dark detail.',sky:'#677f8b',horizon:'#c9b79b',ground:'#645447',key:'#ffcc8b',fill:'#a7c5df',intensity:3,ambient:.58,environment:.9,exposure:.96,sun:[18,15,16],haze:.8},
  {id:'winter',name:'Winter daylight',source:'StudiCraft',description:'Pale blue daylight and low contrast distance haze.',sky:'#9dafc5',horizon:'#e1e4e3',ground:'#7d8785',key:'#eef4ff',fill:'#c5d6f3',intensity:2.2,ambient:1,environment:.85,exposure:.98,sun:[-22,18,17],haze:1.7},
  {id:'sunset',name:'Copper sunset',source:'StudiCraft',description:'Warm low sun falls across a muted violet horizon.',sky:'#7c89a7',horizon:'#d8b698',ground:'#685b54',key:'#ffc588',fill:'#bdc7eb',intensity:3.4,ambient:.65,environment:.7,exposure:.89,sun:[27,8,-15],haze:1.65},
  {id:'diffuse',name:'Diffuse material check',source:'HouseBuilder',description:'Even neutral light for separating color from specular glare.',sky:'#aeb6b8',horizon:'#e1e2da',ground:'#80847e',key:'#f4f4e9',fill:'#dee4e8',intensity:1.1,ambient:1.3,environment:1,exposure:1,sun:[-7,40,5],haze:.6},
  {id:'moonlight',name:'Moonlit field',source:'StudiCraft',description:'Blue moonlight and a softly illuminated valley silhouette.',sky:'#263b5c',horizon:'#748ba7',ground:'#34464e',key:'#c2d8ff',fill:'#b1a4bd',intensity:1.7,ambient:.65,environment:.55,exposure:1.2,sun:[19,25,-11],haze:1.35},
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
    ['gentle','Gentle deflection',.45,1.2,0,.5,'A small pressure ramp for inspecting the initial shape.'],
    ['gust','Wind dominated',.9,1.1,2,.5,'Maximum lateral forcing with a modest pressure target.'],
    ['limit','Slow overload',2.6,.9,.15,.25,'Quarter speed inspection of accumulating connection damage.'],
    ['ultimate','Maximum pressure',5,1.5,.8,1,'Explore the upper pressure control range at increased strength.'],
  ]),
  ...recipes('plate',[
    ['service','Shallow forming',.8,1,0,1,'A shallow indentation for studying plastic deformation.'],
    ['deep','Deep draw',1.7,1.5,0,.5,'Drive the punch deeper through a strengthened lattice.'],
    ['yield','Yield inspection',1.1,1.25,0,.5,'A slow view of the transition to a permanent dent.'],
    ['fracture','Punch through',4,1,0,1,'Follow yielding, contact and the opening fracture.'],
    ['fragile','Weak sheet connections',3,.55,0,.5,'Reduce the rupture threshold and inspect the damage path.'],
    ['reinforced','Strong sheet comparison',4,1.9,0,1,'Compare the same drive pressure at a higher connection limit.'],
    ['gentle','First contact',.4,1.2,0,.25,'Low drive pressure for inspecting first contact.'],
    ['forming','Forming comparison',1.5,1.8,0,.5,'Moderate drive pressure with a high connection limit.'],
    ['limit','Slow perforation',2.8,.8,0,.25,'Quarter speed inspection of the first opening edges.'],
    ['ultimate','Maximum drive pressure',5,1.4,0,1,'Use 100 percent of the model drive capacity.'],
  ]),
  ...recipes('bridge',[
    ['service','Service crossing',.8,1,.1,1,'A modest asymmetric deck load in light wind.'],
    ['wind','Crosswind crossing',1.2,1.3,1.7,1,'Observe coupled deck and cable movement in crosswind.'],
    ['heavy','Heavy crossing',2.2,1.6,.25,1,'Explore load redistribution through the cable system.'],
    ['collapse','Progressive collapse',4,1,.25,1,'Trace cable rupture, support loss and falling deck sections.'],
    ['fragile','Weak connections',3,.5,.6,.5,'Inspect early connection losses at half speed.'],
    ['reinforced','Reinforced crossing',4,1.9,.25,1,'Repeat the overload with stronger cable connections.'],
    ['gentle','Quiet crossing',.45,1.2,0,.5,'Read the unloaded silhouette and initial deck movement.'],
    ['gust','Wind dominated deck',.8,1.1,2,.5,'High lateral forcing with a moderate asymmetric load.'],
    ['limit','Slow connection loss',2.7,.8,.3,.25,'Quarter speed makes the evolving load path easier to inspect.'],
    ['ultimate','Maximum deck load',5,1.5,.6,1,'Explore the upper load range with stronger connections.'],
  ]),
];
export const CAMERA_PRESETS = [
  {id:'approach',name:'Road & open portals',description:'Follow the graded woodland road through the unobstructed bridge entrances.',study:'bridge'},
  {id:'river-hero',name:'River crossing',description:'The new ImageGen hero composition, fitted around the workspace.',study:'bridge'},
  {id:'bearing',name:'Abutment & steelwork',description:'Inspect base plates, cast concrete, timber fascia and riverbank planting.',study:'bridge'},
  {id:'reference',name:'Reference composition',description:'Camera inferred from the original image, with the specimen and its connections in view.'},
  {id:'hero',name:'Hero view',description:'The authored overview of the complete experiment.'},
  {id:'reverse',name:'Reverse angle',description:'Inspect the assembly from the opposing side.'},
  {id:'detail',name:'Specimen detail',description:'Move closer to surface response and connections.'},
  {id:'plan',name:'Plan inspection',description:'Look down on the load path and specimen.'},
  {id:'elevation',name:'Low elevation',description:'Read sag, deflection and support height in profile.'},
  {id:'connection',name:'Connection close-up',description:'Frame a corner anchor, sheet clamp or cable saddle.'},
  {id:'oblique',name:'Oblique inspection',description:'An elevated diagonal view separates the load paths.'},
  {id:'wide',name:'Context view',description:'Step back to see the experiment in its surroundings.'},
  {id:'stream',name:'River corridor',description:'Look along the current toward the crossing.',study:'bridge'},
  {id:'bank',name:'Riverbank detail',description:'Inspect shallow ripples, shoreline foam and bank stones.',study:'bridge'},
] as const;
export type CameraPreset = typeof CAMERA_PRESETS[number]['id'];
export const camerasFor=(study:StudyId)=>CAMERA_PRESETS.filter(p=>!('study' in p)||p.study===study).map(p=>study==='plate'&&p.id==='plan'?{...p,name:'Top · tooling cutaway',description:'Inspect the sheet from above with the crown and ram hidden.'}:p);
export const DEFAULT_FINISH:Record<StudyId,string> = {canopy:'canopy-linen',plate:'plate-machined',bridge:'bridge-weathered'};
export const DEFAULT_LOAD:Record<StudyId,string> = {canopy:'canopy-tear',plate:'plate-fracture',bridge:'bridge-collapse'};
export interface SurroundingPreset {
  id:string;name:string;source:PresetSource;habitat:'hall'|'valley';description:string;
  floor:string;wall:string;steel:string;leaf:string;grass:string;rock:string;terrain:string;water:string;ripple:number;waterScale:number;haze:number;
}
const hallBase={habitat:'hall' as const,leaf:'#abb7a0',grass:'#7b8569',rock:'#d3d4ca',terrain:'#ffffff',water:'#224c4d',ripple:1.25,waterScale:8,haze:1};
const valleyBase={habitat:'valley' as const,floor:'#deddd3',wall:'#cbcfc7',steel:'#aeb9bd'};
export const SURROUNDING_PRESETS:SurroundingPreset[]=[
  {...hallBase,id:'hall-concrete',name:'Concrete laboratory',source:'HouseBuilder',description:'Pale cast concrete and cool steel keep the specimen central.',floor:'#deddd3',wall:'#cbcfc7',steel:'#aeb9bd'},
  {...hallBase,id:'hall-chalk',name:'Chalk gallery',source:'HouseBuilder',description:'Warm white walls and pale concrete for a bright material study.',floor:'#ece7d8',wall:'#eee9df',steel:'#c9cecc'},
  {...hallBase,id:'hall-foundry',name:'Foundry workshop',source:'Commander Academy',description:'Dark fixtures and warm concrete surround the testing frame.',floor:'#b7ae9d',wall:'#ada99c',steel:'#89999f'},
  {...hallBase,id:'hall-slate',name:'Slate research hall',source:'StudiCraft',description:'Cool walls and graphite toned concrete make warm finishes stand out.',floor:'#a9b5b8',wall:'#869da6',steel:'#b3c7d0'},
  {...valleyBase,id:'valley-stream',name:'Woodland stream',source:'Material Forge',description:'Green banks, gray stone and a clear, gently rippled river.',leaf:'#abb7a0',grass:'#7b8569',rock:'#d3d4ca',terrain:'#fffef5',water:'#224c4d',ripple:1.25,waterScale:8,haze:1},
  {...valleyBase,id:'valley-marsh',name:'Quiet wetland',source:'Material Forge',description:'Olive bank cover, dark green water and restrained ripples.',leaf:'#bbc39a',grass:'#98945f',rock:'#afb6a4',terrain:'#c5c7a1',water:'#364a36',ripple:.48,waterScale:5,haze:1.2},
  {...valleyBase,id:'valley-autumn',name:'Autumn river',source:'StudiCraft',description:'Amber foliage and dry grasses against a cool reflective river.',leaf:'#e4be78',grass:'#b7a478',rock:'#d4c7af',terrain:'#dbc5a0',water:'#294f57',ripple:1.4,waterScale:9,haze:.9},
  {...valleyBase,id:'valley-alpine',name:'Alpine river',source:'Commander Academy',description:'Cool foliage, pale granite and blue green mountain water.',leaf:'#9cb7aa',grass:'#91a595',rock:'#dae0df',terrain:'#ccd6ca',water:'#285e68',ripple:1.8,waterScale:10,haze:.85},
];
export function surroundingsFor(study:StudyId,id?:string|null):SurroundingPreset {
  const habitat=study==='bridge'?'valley':'hall';return SURROUNDING_PRESETS.find(p=>p.id===id&&p.habitat===habitat)??SURROUNDING_PRESETS.find(p=>p.habitat===habitat)!;
}
export type SetupIntent='Explore'|'Inspect'|'Failure';
export interface SceneSetup {id:string;name:string;study:StudyId;source:PresetSource;description:string;intent:SetupIntent;finish:string;lighting:string;load:string;camera:CameraPreset;surroundings:string;water?:'calm'|'academy'|'rapids'}
type SetupRow=[string,string,PresetSource,SetupIntent,string,string,string,CameraPreset,string,string];
const setupWater:Record<string,'calm'|'academy'|'rapids'>={'woodland-road':'academy',observatory:'academy',reference:'academy',woodland:'calm',alpine:'rapids',autumn:'academy',wetland:'calm',saddle:'calm',dawn:'calm',overload:'rapids',moon:'calm'};
const setups=(study:StudyId,rows:SetupRow[]):SceneSetup[]=>rows.map(([slug,name,source,intent,finish,lighting,load,camera,surroundings,description])=>({id:`setup-${study}-${slug}`,name,study,source,intent,finish:`${study}-${finish}`,lighting,load:`${study}-${load}`,camera,surroundings,description,...(study==='bridge'?{water:setupWater[slug]}:{})}));
/** Authored combinations, not a Cartesian product. Every setup uses existing compatible model inputs. */
export const SCENE_SETUPS:SceneSetup[]=[
  ...setups('canopy',[
    ['reference','Reference canopy','StudiCraft','Inspect','linen','daylight','service','reference','hall-concrete','Ivory cloth and the four corner fittings, composed from the original image.'],
    ['north','North light pavilion','HouseBuilder','Explore','porcelain','daylight','service','hero','hall-chalk','A bright architectural membrane with a gentle service pressure.'],
    ['sail','Marine crosswind','Material Forge','Explore','denim','coolbox','gust','oblique','hall-concrete','Indigo canvas under strong crosswind, viewed across the load path.'],
    ['weave','The woven surface','Commander Academy','Inspect','jute','raking','gentle','detail','hall-foundry','Grazing light reveals the weave during the first deflection.'],
    ['tear','Anatomy of a tear','Commander Academy','Failure','linen','crosslight','tear','hero','hall-concrete','A neutral membrane and a full pressure ramp reveal growing tears.'],
    ['saddle','Saddle grain study','Commander Academy','Inspect','saddle','amber-room','calm','detail','hall-foundry','Leather appearance on the membrane with a calm, strengthened load case.'],
    ['anchor','At the anchor','HouseBuilder','Inspect','chalk','diffuse','limit','connection','hall-chalk','Watch the corner connection at quarter playback speed.'],
    ['storm','Storm canvas','StudiCraft','Failure','forest','storm','ultimate','oblique','hall-slate','Maximum pressure and lateral forcing against a cool, dark hall.'],
    ['carmine','Carmine tension','StudiCraft','Failure','carmine','afternoon','fragile','reverse','hall-concrete','Low connection strength and warm light from the opposite angle.'],
  ]),
  ...setups('plate',[
    ['reference','Reference press','StudiCraft','Inspect','machined','softbox','service','reference','hall-concrete','The ram and supported sheet in a close inspection view from the original image.'],
    ['aluminum','Aluminum under load','HouseBuilder','Explore','machined','neutral','service','hero','hall-concrete','A neutral starting point for reading sheet and punch contact.'],
    ['brass','Brass forming bench','Commander Academy','Explore','alloy-brass','softbox','forming','hero','hall-foundry','Matched brass textures and a strengthened moderate forming case.'],
    ['copper','Copper in cross light','Material Forge','Inspect','copper-sheet','crosslight','yield','detail','hall-slate','Warm copper grain and slow travel make permanent deformation visible.'],
    ['iron','Blacksmith fracture','Commander Academy','Failure','forged','amber-room','fracture','hero','hall-foundry','Forged iron appearance and the full punch-through sequence.'],
    ['satin','Satin perforation','Material Forge','Failure','polished-brass','raking','limit','detail','hall-concrete','Low light tracks the opening edge at quarter playback speed.'],
    ['clamp','The pinned edge','HouseBuilder','Inspect','pewter','diffuse','gentle','connection','hall-chalk','Inspect a fixed clamp during the first actuator contact.'],
    ['night','After hours test','StudiCraft','Failure','gunmetal','night','ultimate','oblique','hall-slate','Cool forged metal and focused task light during full actuator travel.'],
    ['enamel','White enamel study','HouseBuilder','Explore','white','coolbox','deep','reverse','hall-chalk','Bright architectural coating with a slow deep forming case.'],
  ]),
  ...setups('bridge',[
    ['woodland-road','Woodland approach','StudiCraft','Explore','weathered','woodland-daylight','service','approach','valley-stream','Follow the graded gravel road onto the timber deck and through both open portal towers.'],
    ['observatory','River observatory','StudiCraft','Explore','weathered','woodland-daylight','service','river-hero','valley-stream','A wooded river crossing with refined steelwork, planted banks and fine current, guided by the new ImageGen reference.'],
    ['reference','Reference crossing','StudiCraft','Inspect','weathered','reference-daylight','service','reference','valley-stream','Riveted near tower, wooded banks and running water, composed from the original image.'],
    ['woodland','Woodland crossing','Material Forge','Explore','cloudrest','daylight','service','hero','valley-stream','Weathered timber, a clear stream and a modest crossing load.'],
    ['alpine','Alpine load path','Commander Academy','Inspect','alpine','winter','heavy','oblique','valley-alpine','Pale boards and cool granite make the cable network easy to read.'],
    ['autumn','Autumn connection loss','StudiCraft','Failure','amber','afternoon','collapse','hero','valley-autumn','Amber bank cover frames the progressive loss of deck support.'],
    ['wetland','Wetland crosswind','Material Forge','Explore','driftwood','mist','gust','reverse','valley-marsh','Quiet water contrasts with the wind-driven deck movement.'],
    ['saddle','At the cable saddle','Commander Academy','Inspect','cloudrest','crosslight','limit','connection','valley-stream','Quarter speed inspection of the cable near a fixed tower saddle.'],
    ['dawn','First light crossing','StudiCraft','Explore','limed','dawn','gentle','wide','valley-alpine','A wide valley view with a small initial crossing load.'],
    ['overload','Timber overload','HouseBuilder','Failure','red-cedar','golden','ultimate','elevation','valley-autumn','Warm boards and a low profile reveal the loss of deck continuity.'],
    ['moon','Moonlit collapse','StudiCraft','Failure','silver-pine','moonlight','fragile','hero','valley-stream','Pale planks remain legible as weakened connections begin to fail.'],
  ]),
];
export function setupFor(study:StudyId,id?:string|null):SceneSetup|undefined {return SCENE_SETUPS.find(p=>p.study===study&&p.id===id);}
export const PRESET_COUNT=FINISH_PRESETS.length+LIGHTING_PRESETS.length+LOAD_PRESETS.length+CAMERA_PRESETS.length+SURROUNDING_PRESETS.length+SCENE_SETUPS.length;
export function finishFor(study:StudyId,id?:string|null):FinishPreset {return FINISH_PRESETS.find(p=>p.study===study&&p.id===id)??FINISH_PRESETS.find(p=>p.id===DEFAULT_FINISH[study])!;}
export function lightingFor(id?:string|null):LightingPreset {return LIGHTING_PRESETS.find(p=>p.id===id)??LIGHTING_PRESETS[0];}
export function loadFor(study:StudyId,id?:string|null):LoadPreset {return LOAD_PRESETS.find(p=>p.study===study&&p.id===id)??LOAD_PRESETS.find(p=>p.id===DEFAULT_LOAD[study])!;}
