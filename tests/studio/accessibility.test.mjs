// Static accessibility checks of the Studio and Physics Lab markup and colours (run in `npm run test:studio`).
// They read the templates as written: icon-only buttons need an accessible name, form controls a label, the canvases a role
// and name, no positive tabindex reorders focus, and readout colours meet WCAG 2.2 AA (4.5:1 for 11–12 px text,
// https://www.w3.org/TR/WCAG22/#contrast-minimum).
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const list=(dir,ext)=>readdirSync(path.join(root,dir)).filter(f=>f.endsWith(ext)).map(f=>`${dir}/${f}`);
const markup=[...list('src/studio','.ts'),...list('src/studio/material-labs','.ts'),...list('src/lab','.ts'),...list('src/ui','.ts'),'index.html','lab.html'];

test('icon-only buttons have an accessible name',()=>{
  const missing=[];
  for(const file of markup){const text=read(file);
    for(const m of text.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
      const [,attrs,body]=m;if(/aria-label(ledby)?=/.test(attrs))continue;
      const visible=body.replace(/\$\{icon\([^)]*\)\}/g,'').replace(/<i\b[^>]*><\/i>/g,'').replace(/<svg[\s\S]*?<\/svg>/g,'').replace(/<[^>]+>/g,'').replace(/\$\{[^}]*\}/g,'x').trim();
      if(!visible)missing.push(`${file}: <button${attrs.slice(0,80)}>`);
    }}
  assert.deepEqual(missing,[]);
});

test('form controls are labelled',()=>{
  const missing=[];
  for(const file of markup){const text=read(file);
    for(const m of text.matchAll(/<(select|input|textarea)\b([^>]*)>/g)){
      const attrs=m[2];if(/type="hidden"|aria-label(ledby)?=/.test(attrs))continue;
      const id=attrs.match(/\bid="([^"]+)"/)?.[1];if(id&&text.includes(`for="${id}"`))continue;
      const before=text.slice(Math.max(0,m.index-400),m.index);
      if(/<label\b[^>]*>(?![\s\S]*<\/label>)/.test(before))continue;            // inside an open <label>
      if(/aria-hidden="true"[^<]*>\s*$/.test(before))continue;                   // a hidden mirror of a labelled control
      missing.push(`${file}: ${m[0].slice(0,100)}`);
    }}
  assert.deepEqual(missing,[]);
});

test('focus order follows the document: no positive tabindex',()=>{
  for(const file of markup)assert.doesNotMatch(read(file),/tabindex="[1-9]/,file);
});

test('the 3D canvases have a role and a description',()=>{
  for(const file of ['src/studio/world.ts','src/studio/material-labs/world.ts']){
    const text=read(file);assert.match(text,/setAttribute\('role','img'\)/,file);assert.match(text,/setAttribute\('aria-label',/,file);
  }
});

const luminance=hex=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const tokens=(css,selector)=>{const block=css.match(new RegExp(selector.replace(/[[\]().*+?^$|]/g,'\\$&')+'\\{([^}]*)\\}'))?.[1];assert.ok(block,selector);return Object.fromEntries([...block.matchAll(/--([a-z]+):(#[0-9a-f]{6})/g)].map(m=>[m[1],m[2]]));};

test('readout text colours meet 4.5:1 on their panels',()=>{
  const studio=read('src/studio/studio.css'),labs=read('src/studio/material-labs/style.css'),liquid=read('src/studio/material-labs/liquid.css');
  const cases=[];
  for(const theme of ['#studio','#studio[data-theme=atelier]']){const t={...tokens(studio,'#studio'),...tokens(studio,theme)};
    for(const fg of ['text','muted','dim'])for(const bg of ['bg','panel','raised'])cases.push([`${theme} --${fg} on --${bg}`,t[fg],t[bg]]);}
  const lab=tokens(labs,'.material-studio'),flow={...lab,...tokens(liquid,'.material-studio[data-study=liquid]')};
  for(const [name,t] of [['material labs',lab],['liquid lab',flow]])for(const fg of ['ink','muted'])cases.push([`${name} --${fg} on --paper`,t[fg],t.paper]);
  const failing=cases.filter(([,fg,bg])=>contrast(fg,bg)<4.5).map(([name,fg,bg])=>`${name}: ${contrast(fg,bg).toFixed(2)}`);
  assert.deepEqual(failing,[]);
  assert.equal(cases.length,22);
});

test('fields that hide their outline show focus on their box',()=>{
  const studio=read('src/studio/studio.css'),labs=read('src/studio/material-labs/style.css');
  assert.match(studio,/:is\(\.preset-search,\.desk-search,\.collection-search\):focus-within\{outline:2px/);
  assert.match(labs,/\.material-studio \.preset-search:focus-within\{outline:2px/);
  assert.match(studio,/button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible\{outline:2px/);
});
