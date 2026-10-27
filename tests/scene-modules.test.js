import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadSceneProgram} from '../server/sceneModules.js';
import {evaluateProgram} from '../server/program.js';
import {sha256} from '../server/storage.js';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scene-modules-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const write=async(p,s)=>{const f=path.join(dir,'workspace',p);await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(f,s);};
 const manifest={version:1,entry:'/scene.js',modules:[{path:'/content/main.js',dependsOn:['/shared/constants.js']},{path:'/shared/constants.js',dependsOn:[]}]};
 await write('manifest.json',JSON.stringify(manifest));
 await write('shared/constants.js','function create(){return {size:2};}');
 await write('content/main.js',`function create(ctx,deps){return {objects:[{id:'cube',type:'mesh',geometry:{type:'box',args:[deps['/shared/constants.js'].size,1,1]}}]};}`);
 await write('scene.js',`function build(ctx,modules){return {version:1,objects:modules['/content/main.js'].objects};}`);
 return {dir,write,manifest};
}
test('module dependency order, isolated scope and complete source hashing',async t=>{
 const {dir,write}=await fixture(t),loaded=await loadSceneProgram(dir);
 assert.equal((await evaluateProgram(loaded.sourceCode,{})).objects[0].geometry.args[0],2);
 assert.deepEqual(loaded.sources.map(s=>s.path),['/manifest.json','/shared/constants.js','/content/main.js','/scene.js']);
 await write('shared/constants.js','function create(){return {size:3};}');
 const next=await loadSceneProgram(dir);assert.notEqual(sha256(next.sourceCode),sha256(loaded.sourceCode));
 await write('content/main.js','function create(){return constants;}');
 await assert.rejects(async()=>evaluateProgram((await loadSceneProgram(dir)).sourceCode,{}),/\/content\/main.js/);
});
test('reject cycles, absent dependencies, case aliases, unsafe paths and missing files',async t=>{
 const {dir,write,manifest}=await fixture(t);
 for(const modules of [
  [{path:'/a.js',dependsOn:['/b.js']},{path:'/b.js',dependsOn:['/a.js']}],
  [{path:'/a.js',dependsOn:['/missing.js']}],
  [{path:'/a.js'},{path:'/A.js'}],
  [{path:'/../secret.js'}],
  [{path:'/absent.js'}]
 ]){await write('manifest.json',JSON.stringify({...manifest,modules}));await assert.rejects(()=>loadSceneProgram(dir));}
 await write('manifest.json',JSON.stringify({...manifest,entry:'/other.js'}));await assert.rejects(()=>loadSceneProgram(dir),/入口/);
});
test('single-file compatibility, missing factory/entry and host isolation',async t=>{
 const {dir,write}=await fixture(t);
 await write('shared/constants.js','const x=1;');
 await assert.rejects(async()=>evaluateProgram((await loadSceneProgram(dir)).sourceCode,{}),/Define function create/);
 await write('shared/constants.js','function create(){return require("node:fs");}');
 await assert.rejects(async()=>evaluateProgram((await loadSceneProgram(dir)).sourceCode,{}),/require/);
 await write('shared/constants.js','function create(){return {size:1};}');await write('scene.js','const x=1;');
 await assert.rejects(async()=>evaluateProgram((await loadSceneProgram(dir)).sourceCode,{}),/Define function build/);
 await fs.unlink(path.join(dir,'workspace','manifest.json'));await write('scene.js','function build(){return {version:1};}');
 assert.equal((await evaluateProgram((await loadSceneProgram(dir)).sourceCode,{})).version,1);
});
