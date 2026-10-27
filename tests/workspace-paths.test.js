import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sourcePath,sha256} from '../server/storage.js';
import {copyWorkspace,writeWorkspace,readWorkspace,editWorkspace,listWorkspace,grepWorkspace,workspaceTarget} from '../server/workspace.js';
import {loadSceneProgram} from '../server/sceneModules.js';
import {evaluateProgram} from '../server/program.js';
import {parseWorkspacePath} from '../server/workspacePaths.js';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-versioned-paths-'));
 t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});
 await fs.mkdir(path.join(dir,'workspace'));return dir;
}

test('versioned backups work across copy/read/edit/list/grep/restore without changing original bytes',async t=>{
 const dir=await fixture(t),bytes=Buffer.from('\ufefffunction build(){return {version:1};}\r\n');
 await fs.mkdir(path.join(dir,'workspace','presentation'));
 await fs.writeFile(sourcePath(dir,'/presentation/view.js'),bytes);
 const copied=await copyWorkspace(dir,{source:'/presentation/view.js',destination:'/presentation/view.v1.js'});
 assert.equal(copied.status,'completed');assert.equal(copied.sha256,sha256(bytes));
 assert.deepEqual(await fs.readFile(sourcePath(dir,'/presentation/view.js')),bytes);
 assert.deepEqual(await fs.readFile(sourcePath(dir,'/presentation/view.v1.js')),bytes);
 assert.match((await readWorkspace(dir,{path:'/presentation/view.v1.js'})).content,/function build/);
 assert((await listWorkspace(dir,{path:'/',recursive:true})).entries.some(e=>e.path==='/presentation/view.v1.js'));
 assert.equal((await grepWorkspace(dir,{path:'/presentation/view.v1.js',pattern:'function build'})).matches.length,1);
 assert((await grepWorkspace(dir,{pattern:'function build'})).matches.some(e=>e.path==='/presentation/view.v1.js'));
 await editWorkspace(dir,{path:'/presentation/view.v1.js',old_string:'version:1',new_string:'version:2'});
 assert.deepEqual(await fs.readFile(sourcePath(dir,'/presentation/view.js')),bytes);
 await assert.rejects(copyWorkspace(dir,{source:'/presentation/view.js',destination:'/presentation/view.v1.js'}),/exists/);
 await copyWorkspace(dir,{source:'/presentation/view.js',destination:'/presentation/view.v1.js',overwrite:true});
 assert.deepEqual(await fs.readFile(sourcePath(dir,'/presentation/view.v1.js')),bytes);
 await writeWorkspace(dir,{path:'/versions/view.before-2026.10.20.js',content:'function build(){return {version:1};}'});
 await copyWorkspace(dir,{source:'/presentation/view.v1.js',destination:'/presentation/view.v2.js'});
 assert.deepEqual(await fs.readFile(sourcePath(dir,'/presentation/view.v2.js')),bytes);
});

test('versioned files support single-file and manifest scene builds with complete source hashes',async t=>{
 const dir=await fixture(t);
 await writeWorkspace(dir,{path:'/scene.v1.js',content:'function build(){return {version:1};}'});
 const single=await loadSceneProgram(dir,'/scene.v1.js');assert.equal((await evaluateProgram(single.sourceCode,{})).version,1);
 await writeWorkspace(dir,{path:'/presentation/view.v1.js',content:'function create(){return {objects:[]};}'});
 await writeWorkspace(dir,{path:'/scene.v2.js',content:'function build(ctx,modules){return {version:1,objects:modules["/presentation/view.v1.js"].objects};}'});
 await writeWorkspace(dir,{path:'/manifest.json',content:JSON.stringify({version:1,entry:'/scene.v2.js',modules:[{path:'/presentation/view.v1.js',dependsOn:[]}]})});
 const multi=await loadSceneProgram(dir,'/scene.v2.js');assert.equal((await evaluateProgram(multi.sourceCode,{})).version,1);
 assert.deepEqual(multi.sources.map(s=>s.path),['/manifest.json','/presentation/view.v1.js','/scene.v2.js']);
});

test('version dots never admit traversal, hidden paths, Windows aliases or forbidden extensions',async t=>{
 const dir=await fixture(t);
 const invalid=['/../escape.v1.js','/folder/../../escape.js','/folder/./view.v1.js','//server/share/view.js','C:/view.v1.js','/folder\\view.v1.js','/.view.js','/folder/.hidden/view.js','/view..v1.js','/view.v1.js.','/view.v1.js:stream','/view.v1.exe','/folder.v1/view.js','/con.v1.js','/AUX.backup.json','/nul/view.v1.js','/view%2ev1.js','/view\0.v1.js'];
 for(const name of invalid){
  assert.throws(()=>sourcePath(dir,name),/Only virtual/,name);
  await assert.rejects(workspaceTarget(dir,name),/Only virtual/,name);
 }
 for(const name of ['/scene.js','/folder/view.v1.js','/view.before-2026.10.20.json','/notes.v2.md','/data.old.txt'])assert.equal(parseWorkspacePath(name).path,name);
 await writeWorkspace(dir,{path:'/original.js',content:'original'});
 for(const destination of invalid)await assert.rejects(copyWorkspace(dir,{source:'/original.js',destination}));
 assert.equal(await fs.readFile(sourcePath(dir,'/original.js'),'utf8'),'original');
});

test('versioned paths retain read-only context and junction protections',async t=>{
 const dir=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-versioned-outside-'));
 t.after(async()=>{assert.equal(path.dirname(outside),path.resolve(os.tmpdir()));await fs.rm(outside,{recursive:true,force:true});});
 await fs.writeFile(path.join(outside,'view.v1.js'),'private');
 await fs.symlink(outside,path.join(dir,'workspace','link'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(readWorkspace(dir,{path:'/link/view.v1.js'}),/junction|symbolic/i);
 await assert.rejects(copyWorkspace(dir,{source:'/link/view.v1.js',destination:'/view.v1.js'}),/junction|symbolic/i);
 await writeWorkspace(dir,{path:'/view.v1.js',content:'safe'});
 for(const destination of ['/context.json','/scene-api.txt'])await assert.rejects(copyWorkspace(dir,{source:'/view.v1.js',destination,overwrite:true}),/read-only/);
 assert.equal(await fs.readFile(path.join(outside,'view.v1.js'),'utf8'),'private');
});
