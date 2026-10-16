import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {WebSocket} from 'ws';
import {createServer} from '../server/index.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {projectDir} from '../server/storage.js';
import {BASE,DATA} from '../server/config.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const json={version:1,entities:[{id:'world',kind:'world',state:{settings:{type:'solid',color:[.2,.3,.4],strength:1}}}],operations:[]};
function glb(){const raw=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]})),length=Math.ceil(raw.length/4)*4,b=Buffer.alloc(20+length,32);b.writeUInt32LE(0x46546c67);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(length,12);b.writeUInt32LE(0x4e4f534a,16);raw.copy(b,20);return b;}
async function until(fn){for(let n=0;n<150;n++){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('State did not converge');}
async function fixture(runAgent,fn){
 const parent=path.resolve('test-output');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'run-recovery-')),db=new StudioDatabase(path.join(dir,'studio.sqlite')),id='recovery-'+crypto.randomUUID();
 db.create({config:JSON.stringify({animationPreview:{version:1,prompt:'只生成一次'}})},null,id);const sid=db.createSession({projectId:id}),runId=crypto.randomUUID();
 const service=createServer({database:db,dataDir:dir,requireConfiguration:false,runAgent:async ctx=>{let abort;try{return await Promise.race([runAgent(ctx),new Promise((_,reject)=>{abort=()=>reject(ctx.signal.reason);ctx.signal.addEventListener('abort',abort,{once:true});})]);}finally{ctx.signal.removeEventListener('abort',abort);}}}),server=http.createServer(service.app);service.attachSocket(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const form=(projectId=id,rid=runId)=>{const f=new FormData();f.set('payload',JSON.stringify({projectId,sessionId:sid,runId:rid,prompt:'恢复测试',sceneJson:json,messages:[{id:'only-user',role:'user',text:'恢复测试'}]}));f.set('scene',new Blob([glb()]),'scene.glb');return f;};
 try{await fn({id,sid,runId,base,db,form});}finally{await service.abortAll();await new Promise(r=>server.close(r));db.close();assert.ok(path.resolve(dir).startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});const project=projectDir(id);assert.ok(path.resolve(project).startsWith(path.resolve(DATA,'projects')+path.sep));await fs.rm(project,{recursive:true,force:true});}
}

test('refresh detaches the observer; background result commits and replays after reopening',{timeout:15000},async()=>{
 const started=deferred(),finish=deferred();let context,calls=0;
 await fixture(async ctx=>{calls++;context=ctx;ctx.emit({type:'TEXT_MESSAGE_CONTENT',messageId:'reply',delta:'开始'});started.resolve();await finish.promise;ctx.signal.throwIfAborted();const task=crypto.randomUUID(),result={status:'completed',task_id:task,glb_url:`${BASE}/artifacts/${ctx.projectId}/${task}/model.glb`,collaboration_url:`${BASE}/artifacts/${ctx.projectId}/${task}/collaboration.json`};await ctx.onBuild({result,json,bytes:glb()});ctx.emit({type:'RESULT',result});ctx.emit({type:'TEXT_MESSAGE_CONTENT',messageId:'reply',delta:'完成'});},async({id,sid,runId,base,db,form})=>{
  const controller=new AbortController(),response=await fetch(base+'/api/agent/run',{method:'POST',body:form(),signal:controller.signal});await started.promise;assert.equal(response.status,200);const cursor=db.runDetail(id,runId).eventSeq;controller.abort();await new Promise(r=>setTimeout(r,25));assert.equal(context.signal.aborted,false);
  const history=db.history(id,sid);assert.equal(history.runStatus,'running');assert.equal(history.latestRun.runId,runId);assert.equal(JSON.parse(db.detail(id).config).animationPreview.prompt,undefined);
  const replay=await fetch(`${base}/api/agent/run`,{method:'POST',body:form()});assert.equal(replay.status,200);assert.equal(calls,1,'reposting the same run must attach without a second model call');
  finish.resolve();const frames=(await replay.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));assert.ok(frames.some(e=>e.type==='RUN_FINISHED'));assert.ok(frames.find(e=>e.type==='RESULT').snapshotRevision>0);
  const snapshot=db.snapshot(id);assert.deepEqual(await fs.readFile(snapshot.glb_path),glb());assert.deepEqual(JSON.parse(await fs.readFile(snapshot.json_path,'utf8')),json);
  const done=db.history(id,sid);assert.equal(done.runStatus,'completed');assert.equal(done.messages.filter(m=>m.role==='user').length,1);assert.equal(done.messages.find(m=>m.id==='reply').text,'开始完成');assert.ok(done.latestRun.result);
  const recovered=await fetch(`${base}/api/agent/runs/${runId}/events?projectId=${id}&afterSeq=${cursor}`),events=(await recovered.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));assert.ok(events.every(e=>e.seq>cursor));assert.equal(new Set(events.map(e=>e.seq)).size,events.length);assert.ok(events.some(e=>e.type==='RESULT'));assert.equal(events.at(-1).type,'RUN_FINISHED');
  const other=db.create().studioMeta.uuid;assert.equal((await fetch(`${base}/api/agent/runs/${runId}?projectId=${other}`)).status,404);
 });
});

test('reopened observer retains explicit stop and prevents a concurrent second task',{timeout:15000},async()=>{
 const started=deferred();let stopped=false;
 await fixture(async ctx=>{started.resolve();await new Promise(r=>ctx.signal.addEventListener('abort',()=>{stopped=true;r();},{once:true}));ctx.signal.throwIfAborted();},async({id,runId,base,db,form})=>{
  const response=await fetch(base+'/api/agent/run',{method:'POST',body:form()});await started.promise;
  assert.equal((await fetch(base+'/api/agent/run',{method:'POST',body:form(id,crypto.randomUUID())})).status,409);
  const observer=await fetch(`${base}/api/agent/runs/${runId}/events?projectId=${id}`);await fetch(`${base}/api/agent/runs/${runId}?projectId=other`,{method:'DELETE'});assert.equal(stopped,false);
  await fetch(`${base}/api/agent/runs/${runId}?projectId=${id}`,{method:'DELETE'});assert.ok((await observer.text()).includes('RUN_ERROR'));await response.text();assert.equal(stopped,true);assert.equal(db.runDetail(id,runId).status,'failed');
 });
});

test('WebSocket disconnect and reconnect observe the same running task',{timeout:15000},async()=>{
 const started=deferred(),finish=deferred();let context,calls=0;
 await fixture(async ctx=>{calls++;context=ctx;ctx.emit({type:'TEXT_MESSAGE_CONTENT',messageId:'ws-reply',delta:'继续生成'});started.resolve();await finish.promise;ctx.signal.throwIfAborted();},async({id,sid,base,db})=>{
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws?project_id='+id);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});ws.send(JSON.stringify({threadId:sid,messages:[{id:'only-user',role:'user',content:'恢复测试'}]}));await started.promise;
  const run=db.history(id,sid).latestRun;await new Promise(r=>{ws.once('close',r);ws.close();});assert.equal(context.signal.aborted,false);
  const again=new WebSocket(base.replace('http:','ws:')+`/ws?project_id=${id}&run_id=${run.runId}&after_seq=${run.eventSeq}`),events=[];
  const completed=new Promise((resolve,reject)=>{again.on('error',reject);again.on('message',raw=>{const e=JSON.parse(raw);events.push(e);if(e.type==='RUN_FINISHED')resolve();});});await new Promise(r=>again.once('open',r));finish.resolve();await completed;await new Promise(r=>{again.once('close',r);again.close();});assert.equal(calls,1);assert.equal(db.history(id,sid).runStatus,'completed');assert.ok(events.every(e=>e.seq>run.eventSeq));
 });
});
