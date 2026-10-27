import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSceneTools} from '../server/tools.js';

const toolNames=['x_list','x_read','x_write','x_edit','x_grep','x_copy','preview_3D_scene','build_3D_scene'];
const result=value=>typeof value==='string'?JSON.parse(value):value;

test('x_copy preserves bytes, refuses accidental overwrite and supports explicit restore',async t=>{
 const {workspace,invoke,events}=await fixture(t);
 const bytes=Buffer.from([0xef,0xbb,0xbf,0x61,0x0d,0x0a]);
 await fs.writeFile(path.join(workspace,'scene.js'),bytes);
 const copied=await invoke('x_copy',{source:'/scene.js',destination:'/versions/original.js'});
 assert.equal(copied.status,'completed');assert.equal(copied.overwritten,false);
 assert.equal(copied.bytes,bytes.length);assert.match(copied.sha256,/^[a-f0-9]{64}$/);
 assert.deepEqual(await fs.readFile(path.join(workspace,'versions/original.js')),bytes);
 await fs.writeFile(path.join(workspace,'scene.js'),'changed');
 assert.equal((await invoke('x_copy',{source:'/scene.js',destination:'/versions/original.js'})).status,'error');
 assert.deepEqual(await fs.readFile(path.join(workspace,'versions/original.js')),bytes);
 assert.equal((await invoke('x_copy',{source:'/versions/original.js',destination:'/scene.js',overwrite:true})).overwritten,true);
 assert.deepEqual(await fs.readFile(path.join(workspace,'scene.js')),bytes);
 assert(events.some(e=>e.type==='TOOL_CALL_START'&&e.toolCallName==='x_copy'));
});

test('x_copy rejects unsafe paths, protected destinations, missing and oversized sources and cancellation',async t=>{
 const {workspace,invoke,controller}=await fixture(t);
 for(const args of [
  {source:'/context.json',destination:'/context.json'},
  {source:'/context.json',destination:'/scene-api.txt',overwrite:true},
  {source:'/context.json',destination:'/../escape.txt'},
  {source:'C:/secret.txt',destination:'/copy.txt'},
  {source:'/missing.txt',destination:'/copy.txt'},
 ])assert.equal((await invoke('x_copy',args)).status,'error');
 await fs.writeFile(path.join(workspace,'large.txt'),Buffer.alloc(1024*1024+1));
 assert.equal((await invoke('x_copy',{source:'/large.txt',destination:'/copy.txt'})).status,'error');
 await assert.rejects(fs.access(path.join(workspace,'copy.txt')));
 await fs.mkdir(path.join(workspace,'real'));
 await fs.symlink(path.join(workspace,'real'),path.join(workspace,'link'),'junction');
 assert.equal((await invoke('x_copy',{source:'/context.json',destination:'/link/copy.txt'})).status,'error');
 await fs.writeFile(path.join(workspace,'real','source.txt'),'private');
 assert.equal((await invoke('x_copy',{source:'/link/source.txt',destination:'/copy.txt'})).status,'error');
 controller.abort(new Error('test cancelled'));
 await assert.rejects(invoke('x_copy',{source:'/context.json',destination:'/copy.txt'}),/test cancelled/);
});

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'3d-box-workspace-test-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const dir=path.join(root,'project'),workspace=path.join(dir,'workspace'),controller=new AbortController(),events=[];
 await fs.mkdir(workspace,{recursive:true});
 await fs.writeFile(path.join(workspace,'context.json'),'\u007b"scene":"reference"\u007d\n');
 await fs.writeFile(path.join(workspace,'scene-api.txt'),'Scene program API\n');
 const tools=createSceneTools({dir,projectId:'workspace-test',signal:controller.signal,emit:e=>events.push(e),assets:[],sceneJson:{version:1,entities:[],operations:[]}});
 const byName=new Map(tools.map(tool=>[tool.name,tool]));
 const invoke=async(name,args)=>result(await byName.get(name).invoke(args));
 return {root,dir,workspace,controller,events,tools,invoke};
}

test('workspace exposes exactly the eight scene tools and lists only the workspace',async t=>{
 const {dir,workspace,tools,invoke}=await fixture(t);
 assert.deepEqual(tools.map(tool=>tool.name).sort(),toolNames.toSorted());
 await fs.mkdir(path.join(workspace,'nested'));
 await fs.writeFile(path.join(workspace,'nested','scene.js'),'function build(){return {};}');
 await fs.writeFile(path.join(dir,'private.txt'),'must not be listed');
 const listed=await invoke('x_list',{});
 assert.equal(listed.status,'completed');assert.equal(listed.path,'/');assert.equal(listed.truncated,false);
 assert.deepEqual(new Map(listed.entries.map(entry=>[entry.path,entry.type])),new Map([['/context.json','file'],['/scene-api.txt','file'],['/nested','directory']]));
 assert.equal(listed.entries.find(entry=>entry.path==='/context.json').bytes,Buffer.byteLength('{"scene":"reference"}\n'));
 const recursive=await invoke('x_list',{recursive:true});
 assert(recursive.entries.some(entry=>entry.path==='/nested/scene.js'&&entry.type==='file'));
 assert(!recursive.entries.some(entry=>entry.path.includes('private.txt')));
 const bounded=await invoke('x_list',{recursive:true,max_entries:2});
 assert.equal(bounded.entries.length,2);assert.equal(bounded.truncated,true);
 const subdir=await invoke('x_list',{path:'/nested'});
 assert.deepEqual(subdir.entries.map(entry=>entry.path),['/nested/scene.js']);
});

test('x_read returns numbered lines, pagination and accurate truncation',async t=>{
 const {workspace,invoke}=await fixture(t);
 await fs.writeFile(path.join(workspace,'lines.md'),'第一行\nsecond\nthird\nfourth');
 const middle=await invoke('x_read',{path:'/lines.md',offset:1,limit:2});
 assert.deepEqual(middle,{status:'completed',path:'/lines.md',totalLines:4,offset:1,content:'2: second\n3: third',truncated:true,next:{offset:3,column:0}});
 const end=await invoke('x_read',{path:'/lines.md',offset:3,limit:2});
 assert.equal(end.content,'4: fourth');assert.equal(end.truncated,false);
 const beyond=await invoke('x_read',{path:'/lines.md',offset:10});
 assert.equal(beyond.content,'');assert.equal(beyond.totalLines,4);assert.equal(beyond.truncated,false);
 const context=await invoke('x_read',{path:'/context.json'});
 assert.equal(context.status,'completed');assert(context.content.includes('1: {"scene":"reference"}'));
 const missing=await invoke('x_read',{path:'/missing.js'});
 assert.equal(missing.status,'error');assert(missing.error);
});

test('x_read resumes a long UTF-16 line with its cursor without losing characters',async t=>{
 const {workspace,invoke}=await fixture(t);
 const line='😀'.repeat(35000)+'needle-at-the-tail';
 await fs.writeFile(path.join(workspace,'long.txt'),line);
 const first=await invoke('x_read',{path:'/long.txt'});
 assert.equal(first.status,'completed');assert.equal(first.truncated,true);
 assert.equal(first.next.offset,0);assert(first.next.column>0&&first.next.column<line.length);
 assert(first.content.startsWith('1: '));
 const firstText=first.content.slice(3);
 assert.equal(first.next.column,firstText.length,'column points into the raw line, excluding the line-number prefix');
 assert.equal(firstText,line.slice(0,first.next.column));
 const second=await invoke('x_read',{path:'/long.txt',...first.next});
 assert.equal(second.status,'completed');assert.equal(second.truncated,false);assert(!Object.hasOwn(second,'next'));
 assert(second.content.startsWith('1: '));
 assert.equal(firstText+second.content.slice(3),line,'resuming must preserve every UTF-16 code unit');
});

test('x_grep searches text files recursively with literal patterns, case control and bounds',async t=>{
 const {workspace,invoke}=await fixture(t);
 await fs.mkdir(path.join(workspace,'nested'));
 await fs.writeFile(path.join(workspace,'scene.js'),'const camera = "Camera";\nconst literal = "a.*b";\nconst other = "axxb";');
 await fs.writeFile(path.join(workspace,'nested','notes.md'),'camera\nCAMERA\ncamera\n');
 await fs.writeFile(path.join(workspace,'nested','data.json'),'{"camera":true}');
 await fs.writeFile(path.join(workspace,'ignored.bin'),'camera');
 const exact=await invoke('x_grep',{pattern:'a.*b'});
 assert.equal(exact.status,'completed');assert.equal(exact.pattern,'a.*b');assert.equal(exact.path,'/');assert.equal(exact.truncated,false);
 assert.deepEqual(exact.matches,[{path:'/scene.js',line:2,text:'const literal = "a.*b";'}]);
 const sensitive=await invoke('x_grep',{pattern:'camera'});
 assert.equal(sensitive.matches.length,4);assert(!sensitive.matches.some(match=>match.path.endsWith('.bin')));
 const insensitive=await invoke('x_grep',{pattern:'CAMERA',case_sensitive:false});
 assert.equal(insensitive.matches.length,5);
 const nested=await invoke('x_grep',{pattern:'camera',path:'/nested',max_results:2});
 assert.equal(nested.matches.length,2);assert.equal(nested.truncated,true);assert(nested.matches.every(match=>match.path.startsWith('/nested/')));
 const oneFile=await invoke('x_grep',{pattern:'camera',path:'/scene.js'});
 assert.equal(oneFile.matches.length,1);assert.equal(oneFile.truncated,false);
 const none=await invoke('x_grep',{pattern:'not-present'});
 assert.deepEqual(none.matches,[]);assert.equal(none.truncated,false);
});

test('x_grep shows the matching end of a long line and records the excerpt offset',async t=>{
 const {workspace,invoke}=await fixture(t);
 const line='a'.repeat(70000)+'needle-at-the-tail';
 await fs.writeFile(path.join(workspace,'long.txt'),line);
 const found=await invoke('x_grep',{path:'/long.txt',pattern:'needle-at-the-tail'});
 assert.equal(found.status,'completed');assert.equal(found.matches.length,1);
 const match=found.matches[0];
 assert.equal(match.path,'/long.txt');assert.equal(match.line,1);assert.equal(match.textTruncated,true);
 assert(Number.isInteger(match.textOffset)&&match.textOffset>0);
 assert(match.text.includes('needle-at-the-tail'),'the bounded excerpt must include the matching text');
 assert.equal(match.text,line.slice(match.textOffset,match.textOffset+match.text.length));
});

test('x_write and x_edit preserve exact replacement safeguards and tool events',async t=>{
 const {workspace,events,invoke}=await fixture(t);
 const created=await invoke('x_write',{path:'/nested/scene.js',content:'const x = "red red";'});
 assert.equal(created.status,'completed');assert.equal(created.bytes,Buffer.byteLength('const x = "red red";'));assert.match(created.sha256,/^[a-f0-9]{64}$/);
 const overwrite=await invoke('x_write',{path:'/nested/scene.js',content:'lost'});
 assert.equal(overwrite.status,'error');
 const ambiguous=await invoke('x_edit',{path:'/nested/scene.js',old_string:'red',new_string:'blue'});
 assert.equal(ambiguous.status,'error');assert.match(ambiguous.error,/multiple|ambig|unique/i);
 assert.equal(await fs.readFile(path.join(workspace,'nested','scene.js'),'utf8'),'const x = "red red";');
 const changed=await invoke('x_edit',{path:'/nested/scene.js',old_string:'red',new_string:'blue',replace_all:true});
 assert.equal(changed.status,'completed');assert.equal(changed.replacements,2);
 const read=await invoke('x_read',{path:'/nested/scene.js'});assert.equal(read.content,'1: const x = "blue blue";');
 const missing=await invoke('x_edit',{path:'/nested/scene.js',old_string:'green',new_string:'blue'});assert.equal(missing.status,'error');
 const replaced=await invoke('x_write',{path:'/nested/scene.js',content:'replacement',overwrite:true});assert.equal(replaced.status,'completed');
 assert(events.some(event=>event.type==='TOOL_CALL_START'&&event.toolCallName==='x_edit'));
 assert(events.some(event=>event.type==='TOOL_CALL_RESULT'&&JSON.parse(event.content).status==='error'));
});

test('x_edit preserves dollar replacement sequences literally in single and replace-all edits',async t=>{
 const {workspace,invoke}=await fixture(t);
 const replacement="literal $$ | $& | $` | $' | $1";
 await invoke('x_write',{path:'/single.txt',content:'before MARK after'});
 const single=await invoke('x_edit',{path:'/single.txt',old_string:'MARK',new_string:replacement});
 assert.equal(single.status,'completed');assert.equal(single.replacements,1);
 assert.equal(await fs.readFile(path.join(workspace,'single.txt'),'utf8'),'before '+replacement+' after');
 await invoke('x_write',{path:'/all.txt',content:'left MARK middle MARK right'});
 const all=await invoke('x_edit',{path:'/all.txt',old_string:'MARK',new_string:replacement,replace_all:true});
 assert.equal(all.status,'completed');assert.equal(all.replacements,2);
 assert.equal(await fs.readFile(path.join(workspace,'all.txt'),'utf8'),'left '+replacement+' middle '+replacement+' right');
});

test('workspace paths reject traversal, disk paths and immutable context mutations',async t=>{
 const {invoke}=await fixture(t);
 for(const invalid of ['/../private.txt','/nested/../../private.txt','C:/Windows/win.ini','C:\\Windows\\win.ini','file:///C:/Windows/win.ini','/nested\\scene.js','/scene.js:stream','//server/share/file.js','/bad\0.js']){
  for(const name of ['x_read','x_list','x_grep','x_write']){
   const args={path:invalid,...(name==='x_grep'?{pattern:'x'}:{}),...(name==='x_write'?{content:'must not write'}:{})};
   const rejected=await invoke(name,args);assert.equal(rejected.status,'error',`${name} must reject ${JSON.stringify(invalid)}`);
  }
 }
 for(const immutable of ['/context.json','/scene-api.txt']){
  const write=await invoke('x_write',{path:immutable,content:'changed',overwrite:true});assert.equal(write.status,'error');
  const edit=await invoke('x_edit',{path:immutable,old_string:immutable.endsWith('.json')?'reference':'Scene',new_string:'changed'});assert.equal(edit.status,'error');
  const stillReadable=await invoke('x_read',{path:immutable});assert.equal(stillReadable.status,'completed');assert(!stillReadable.content.includes('changed'));
 }
});

test('directory junctions cannot expose or mutate files outside the workspace',async t=>{
 const {root,workspace,invoke}=await fixture(t),outside=path.join(root,'outside');
 await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.js'),'private secret');
 await fs.symlink(outside,path.join(workspace,'escape'),process.platform==='win32'?'junction':'dir');
 for(const [name,args] of [['x_read',{path:'/escape/secret.js'}],['x_list',{path:'/escape'}],['x_grep',{path:'/escape',pattern:'secret'}],['x_write',{path:'/escape/new.js',content:'escaped'}],['x_edit',{path:'/escape/secret.js',old_string:'secret',new_string:'changed'}]]){
  const rejected=await invoke(name,args);assert.equal(rejected.status,'error',`${name} must reject a junction path`);
 }
 const recursive=await invoke('x_list',{recursive:true});
 assert(recursive.status==='error'||!recursive.entries.some(entry=>entry.path.startsWith('/escape/')));
 const grep=await invoke('x_grep',{pattern:'secret'});
 assert(grep.status==='error'||grep.matches.length===0);
 assert.equal(await fs.readFile(path.join(outside,'secret.js'),'utf8'),'private secret');
 await assert.rejects(fs.access(path.join(outside,'new.js')));
});

test('a substituted workspace root is rejected instead of following a junction',async t=>{
 const {root,workspace,invoke}=await fixture(t),outside=path.join(root,'outside-root');
 await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.js'),'private root');
 await fs.rm(workspace,{recursive:true});
 await fs.symlink(outside,workspace,process.platform==='win32'?'junction':'dir');
 for(const [name,args] of [['x_list',{}],['x_read',{path:'/secret.js'}],['x_grep',{pattern:'private'}],['x_write',{path:'/new.js',content:'escaped'}]]){
  const rejected=await invoke(name,args);assert.equal(rejected.status,'error',`${name} must reject a junction workspace root`);
 }
 await assert.rejects(fs.access(path.join(outside,'new.js')));
});

test('tool schemas reject invalid pagination, empty grep and unbounded result requests',async t=>{
 const {invoke}=await fixture(t);
 for(const [name,args] of [['x_list',{max_entries:0}],['x_list',{max_entries:1001}],['x_read',{path:'/context.json',offset:-1}],['x_read',{path:'/context.json',limit:1001}],['x_grep',{pattern:''}],['x_grep',{pattern:'scene',max_results:1001}]]){
  await assert.rejects(invoke(name,args),undefined,`${name} must reject out-of-range arguments`);
 }
});

test('already cancelled tools stop without writing or reporting success',async t=>{
 const {controller,workspace,events,invoke}=await fixture(t);
 controller.abort(new Error('test cancelled'));
 await assert.rejects(invoke('x_write',{path:'/cancelled.js',content:'must not write'}),/test cancelled|abort/i);
 await assert.rejects(fs.access(path.join(workspace,'cancelled.js')));
 assert(!events.some(event=>event.type==='TOOL_CALL_RESULT'&&JSON.parse(event.content).status==='completed'));
});
