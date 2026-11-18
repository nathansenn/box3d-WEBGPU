"""Coarse support-contact graphs, derived from the authored apparatus dimensions.

These audit the load path at rest, not every screw, hinge, render triangle or moving
contact. Source pixels provide palette/proportion cues; dimensions are assumed.
"""
from pathlib import Path
import json, subprocess, sys
from PIL import Image
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(__file__).resolve().parent/'geometry'
VERIFIER=Path('/Users/commander/.agents/skills/image-to-procedural-3d/scripts/verify_scene.py')

def box(key,size,position,on='none',color='#69716e',container=False):
 return dict(id=key,label=key.replace('-',' '),primitives=[dict(type='box',params=dict(zip(['w','h','d'],size)))],transform=dict(position=position),material=dict(color=color,roughness=.5,metalness=.3),support=dict(on=on),container=container,confidence='ASSUMED')
def cyl(key,r,h,p,on='none',color='#a4aaa5'):
 o=box(key,[r*2,h,r*2],p,on,color);o['primitives']=[dict(type='cylinder',params=dict(rt=r,rb=r,h=h,seg=32))];return o

def graph(id):
 objects=[]
 if id in ['liquid','granular']:
  for x in [-2.9,2.9]:
   for z in [-.86,.86]:objects.append(cyl(f'foot-{x}-{z}',.08,.29,[x,.145,z],'ground'))
  objects.append(box('bench',[6.3,.22,2.3],[0,.4,0],'foot--2.9--0.86'))
  objects.append(box('floor-plate',[6.03,.06,2.08],[0,.54,0],'bench'))
  wall=1.1 if id=='liquid' else 1.5
  objects.append(box('open-tank',[6.08,wall,2.12],[0,.57+wall/2,0],'floor-plate','#c8dfd6',True))
  if id=='liquid':objects.append(box('reservoir',[1.84,.65,1.93],[-2.03,.895,0],'floor-plate','#36868d'))
  else:objects.append(box('grain-column',[1.2,1.1,.8],[-2.15,1.12,-.34],'floor-plate','#bd9d68'))
  for i,(x,z) in enumerate([(1.25,.48),(2,-.42)] if id=='liquid' else [(1,0)]):objects.append(cyl('obstacle-'+str(i),.19 if id=='liquid' else .27,.65,[x,.895,z],'floor-plate'))
  target=[0,1.55,0];position=[6.8,6.5,10.5];anchor=6.3
 elif id=='glass':
  for x in [-1.55,1.55]:
   for z in [-.71,.71]:objects.append(cyl(f'foot-{x}-{z}',.05,.56,[x,.28,z],'ground'))
  objects.append(box('bench',[3.4,.12,1.62],[0,.62,0],'foot--1.55--0.71'))
  for x in [-1.52,1.52]:
   objects.append(box(f'column-base-{x}',[.4,.1,.44],[x,.73,0],'bench'))
   objects.append(box(f'column-{x}',[.17,3.24,.18],[x,2.4,0],f'column-base-{x}'))
  objects.append(box('crown',[3.36,.3,.31],[0,4.17,0],'column--1.52','#d17b3a'))
  objects.append(box('pane',[2.6,2,.008],[0,2.45,0],'none','#a7c8c1'))
  for x in [-1.33,1.33]:objects.append(box(f'clamp-{x}',[.06,.24,.12],[x,2.45,0],'pane'))
  target=[0,2.2,0];position=[3,4.1,12];anchor=3.4
 else:
  rubber=id=='rubber';w,d,h=(2.5,1.65,3.75) if rubber else (3.4,2.7,4.9)
  for x in [-w/2+.15,w/2-.15]:
   for z in [-d/2+.15,d/2-.15]:objects.append(cyl(f'foot-{x}-{z}',.05,.22,[x,.11,z],'ground'))
  objects.append(box('bench',[w,.48,d],[0,.46,0],objects[0]['id']))
  for x in [-w/2+.24,w/2-.24]:
   for z in ([-.1] if rubber else [-d/2+.24,d/2-.24]):objects.append(cyl(f'column-{x}-{z}',.11,h-.7-.23,[x,(h-.23+.7)/2,z],'bench'))
  objects.append(box('crown',[w+.1,.46,d*.75 if rubber else d-.15],[0,h,0],objects[-1]['id'],'#d47834' if rubber else '#646c68'))
  if rubber:
   objects.extend([cyl('lower-support',.66,.09,[0,.745,0],'bench'),cyl('lower-platen',.88,.21,[0,.895,0],'lower-support'),cyl('specimen',.58,.86,[0,1.43,0],'lower-platen','#318c8d'),cyl('upper-platen',.88,.21,[0,1.965,0],'specimen')])
   top=2.07
  else:
   objects.extend([box('lower-support',[2.5,.13,1.7],[0,.765,0],'bench'),box('lower-platen',[2.7,.12,1.9],[0,.89,0],'lower-support'),box('specimen',[1.3,1.3,1.3],[0,1.6,0],'lower-platen','#aaa59b'),box('upper-platen',[1.9,.19,1.9],[0,2.345,0],'specimen')])
   top=2.44
  ramtop=h-.82;objects.append(cyl('ram',.095 if rubber else .2,ramtop-top,[0,(top+ramtop)/2,0],'upper-platen'))
  objects.append(cyl('housing',.3 if rubber else .44,.59,[0,h-.525,0],'ram'))
  target=[0,h/2,0];position=[4,h/2+2.5,13];anchor=w
 source=ROOT/'public/studio/references/material-labs'/f'{id}.png'
 im=Image.open(source).convert('RGB')
 # Record literal colour samples from the original generated image; no re-generation.
 samples={str(x)+','+str(y):'#%02x%02x%02x'%im.getpixel((x,y)) for x,y in [(300,700),(500,450),(200,250)]}
 return dict(meta=dict(source_image=str(source),image_width=1180,image_height=872,unit='model m' if id=='granular' else 'm',scale_anchor=dict(object_id='bench',axis='x',real_size=anchor,confidence='ASSUMED'),scope='Coarse at-rest apparatus support graph; viewport framing only. Fine fasteners and dynamic collision proxies are verified separately in source/runtime.',source_colour_samples=samples),camera=dict(position=position,target=target,up=[0,1,0],fov_vertical_deg=38,shot_type='high_angle' if id in ['liquid','granular'] else 'eye_level',confidence='INFERRED'),environment=dict(background='#cecfc5',ground=dict(present=True,y=0,size=30,color='#c6c3b6')),objects=objects)

failed=[]
for id in ['liquid','glass','concrete','rubber','granular']:
 path=OUT/f'{id}.json';path.write_text(json.dumps(graph(id),indent=2)+'\n')
 result=subprocess.run([sys.executable,str(VERIFIER),str(path),'--out',str(OUT/f'{id}-composite.png')],capture_output=True,text=True)
 (OUT/f'{id}-verification.log').write_text(result.stdout+result.stderr);print(id,result.returncode,result.stdout[:130])
 if result.returncode:failed.append(id)
sys.exit(bool(failed))
