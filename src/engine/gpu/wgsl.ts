/**
 * A small WGSL preprocessor, so that compute shaders can share snippets and be built in variants.
 *
 *   #include "name"        the snippet of that name (from `includes`), once per shader; snippets may include others
 *   #define NAME value     a definition for the rest of the text (and for the conditionals)
 *   #if NAME / #ifdef NAME  ... #else ... #endif   kept when NAME is defined and neither false, 0 nor ''
 *   #ifndef NAME           the opposite
 *   ${NAME}                replaced by the definition (a number that is not whole is written with a decimal point or
 *                          exponent, so that WGSL reads it as a float; write `${NAME}u` for an unsigned constant)
 *
 * Every error (an unknown snippet, a missing definition, an unbalanced conditional, an include cycle) throws an
 * EngineError with code GPU_SHADER that names the line.
 */
import {EngineError} from '../contracts.ts';

export type WgslDefine=string|number|boolean;
export interface WgslOptions {readonly defines?:Readonly<Record<string,WgslDefine>>;readonly includes?:Readonly<Record<string,string>>}
const bad=(message:string):never=>{throw new EngineError('GPU_SHADER',message);};

/** A number as a WGSL float literal (always with a decimal point or an exponent). */
export function wgslFloat(value:number):string {
  if(!Number.isFinite(value))bad(`${value} cannot be written in WGSL.`);
  const text=String(value);
  return /[.e]/.test(text)?text:`${text}.0`;
}
const literal=(value:WgslDefine):string=>typeof value==='number'?(Number.isInteger(value)?String(value):wgslFloat(value)):String(value);
const truthy=(value:WgslDefine|undefined):boolean=>value!==undefined&&value!==false&&value!==0&&value!=='';

export function preprocessWgsl(source:string,options:WgslOptions={}):string {
  const defines=new Map<string,WgslDefine>(Object.entries(options.defines??{})),includes=options.includes??{},seen=new Set<string>();
  const expand=(text:string,label:string,stack:readonly string[]):string=>{
    const out:string[]=[],active:boolean[]=[],taken:boolean[]=[];
    const on=():boolean=>active.every(Boolean);
    const lines=text.split('\n');
    for(let n=0;n<lines.length;n++){
      const line=lines[n],where=`${label}:${n+1}`,m=/^\s*#(\w+)\s*(.*?)\s*$/.exec(line);
      if(m){
        const [,word,rest]=m;
        if(word==='if'||word==='ifdef'||word==='ifndef'){
          if(!/^\w+$/.test(rest))bad(`${where}: #${word} needs one name.`);
          const value=truthy(defines.get(rest)),keep=word==='ifndef'?!value:value;active.push(keep);taken.push(keep);
        }else if(word==='else'){
          if(active.length===0)bad(`${where}: #else without #if.`);
          active[active.length-1]=!taken[taken.length-1];
        }else if(word==='endif'){
          if(active.length===0)bad(`${where}: #endif without #if.`);
          active.pop();taken.pop();
        }else if(!on()){/* skipped */}
        else if(word==='define'){
          const d=/^(\w+)(?:\s+(.*))?$/.exec(rest);if(!d)bad(`${where}: #define needs a name.`);
          defines.set(d![1],d![2]??true);
        }else if(word==='include'){
          const q=/^"([^"]+)"$/.exec(rest);if(!q)bad(`${where}: #include needs a name in double quotes.`);
          const name=q![1];
          if(stack.includes(name))bad(`${where}: "${name}" includes itself (${[...stack,name].join(' -> ')}).`);
          if(!(name in includes))bad(`${where}: there is no snippet "${name}".`);
          if(!seen.has(name)){seen.add(name);out.push(expand(includes[name],name,[...stack,name]));}
        }else bad(`${where}: unknown directive #${word}.`);
        continue;
      }
      if(!on())continue;
      out.push(line.replace(/\$\{(\w+)\}/g,(_,name:string)=>{
        const value=defines.get(name);
        if(value===undefined)bad(`${where}: \${${name}} is not defined.`);
        return literal(value as WgslDefine);
      }));
    }
    if(active.length)bad(`${label}: #if without #endif.`);
    return out.join('\n');
  };
  return expand(source,'shader',[]);
}
