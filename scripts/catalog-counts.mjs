import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {emitTypeScriptModuleTree} from './emit-typescript-module-tree.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'box3d-catalog-'));
try{
  const load=async(entry)=>{
    const {entryPath}=emitTypeScriptModuleTree({sourceRoot:path.resolve('src'),outputRoot:path.join(tmp,entry.replaceAll('/','-')),entry});
    return import(pathToFileURL(entryPath).href);
  };
  const [{SCENES},{AAA_SHOWCASES},{MATERIAL_DEMO_RECIPES}]=await Promise.all([load('scenes.ts'),load('showcases.ts'),load('material-demos.ts')]);
  const counts={scenes:SCENES.length,heroes:AAA_SHOWCASES.length,materialPrograms:MATERIAL_DEMO_RECIPES.length};
  const text=JSON.stringify(counts,null,2)+'\n';
  const block=`<!-- catalog:generated:start -->\n| Runtime catalog | Count |\n| --- | ---: |\n| Capability scenes | ${counts.scenes} |\n| Hero demonstrations | ${counts.heroes} |\n| Material programs | ${counts.materialPrograms} |\n<!-- catalog:generated:end -->`;
  if(process.argv.includes('--write')){
    fs.writeFileSync('docs/CATALOG_COUNTS.json',text);
    let readme=fs.readFileSync('README.md','utf8');
    if(readme.includes('<!-- catalog:generated:start -->'))readme=readme.replace(/<!-- catalog:generated:start -->[\s\S]*?<!-- catalog:generated:end -->/,block);
    else readme=readme.replace('## At a glance','## Runtime catalog (generated)\n\n'+block+'\n\n## At a glance');
    readme=readme.replaceAll('**65 hero demonstrations**',`**${counts.heroes} hero demonstrations**`).replaceAll('65 directed cinematic demonstrations',`${counts.heroes} directed cinematic demonstrations`).replaceAll('800 + 65 State Tests',`${counts.scenes} + ${counts.heroes} State Tests`).replaceAll('for all 65 director entries',`for all ${counts.heroes} director entries`);
    readme=readme.replace('34 established heroes plus 31 recipe-driven material programs',`${counts.heroes-counts.materialPrograms} established heroes plus ${counts.materialPrograms} recipe-driven material programs`);
    fs.writeFileSync('README.md',readme);
  }else{
    assert.equal(fs.readFileSync('docs/CATALOG_COUNTS.json','utf8'),text,'Run npm run catalog:sync after catalog changes');
    assert.ok(fs.readFileSync('README.md','utf8').includes(block),'README catalog block is stale');
  }
  console.log(counts);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
