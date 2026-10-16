import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createServer} from '../server/index.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {WebSocket} from 'ws';

function emptyGlb(){const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]})),n=Math.ceil(json.length/4)*4,b=Buffer.alloc(20+n,32);b.writeUInt32LE(0x46546c67);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(n,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;}
const scene={version:1,entities:[{id:'world',kind:'world',state:{settings:{type:'solid',color:[.22,.24,.27],strength:2}}}],operations:[]};
async function fixture(fn){const parent=path.resolve('test-output');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'studio-api-')),filename=path.join(dir,'studio.sqlite'),database=new StudioDatabase(filename),{app,attachSocket}=createServer({database,dataDir:dir,requireConfiguration:false,runAgent:async ctx=>{ctx.emit({type:'TEXT_MESSAGE_CONTENT',messageId:'reply',delta:'真实测试服务已接收'});}}),server=http.createServer(app);attachSocket(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(url,body,method=body===undefined?'GET':'POST',headers={})=>{const response=await fetch(base+url,{method,headers:{...(body!==undefined&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,...await response.json()};};
 try{await fn({base,request,database,filename});}finally{await new Promise(r=>server.close(r));database.close();assert.ok(path.resolve(dir).startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});}}
function snapshotForm(id,revision=1,bytes=emptyGlb(),json=scene){const form=new FormData();form.set('projectId',id);form.set('revision',String(revision));form.set('scene',new Blob([bytes]),'studio.glb');form.set('sceneJson',JSON.stringify(json));return form;}

test('SQLite studio CRUD, pagination, entry idempotency, drafts and deletion',async()=>fixture(async({request})=>{
 const body={name:'项目 A',config:JSON.stringify({animationPreview:{version:1,generationSettings:{aspectRatio:'9:16',durationSeconds:12,agentMode:'G6'}}})};
 const first=await request('/api/studio/create',body,'POST',{'Idempotency-Key':'entry-one'}),again=await request('/api/studio/create',body,'POST',{'Idempotency-Key':'entry-one'});assert.equal(first.code,0);assert.equal(first.data.studioMeta.uuid,again.data.studioMeta.uuid);const id=first.data.studioMeta.uuid;
 assert.equal((await request('/api/studio/list',{page:1,pageSize:20})).data.total,1);
 const renamed=await request('/api/studio/update',{studioUuid:id,name:'重命名'});assert.equal(renamed.data.studioMeta.name,'重命名');assert.equal(JSON.parse(renamed.data.config).animationPreview.generationSettings.aspectRatio,'9:16');
 assert.notEqual((await request('/api/studio/create',{name:'错误',config:'{"animationPreview":{"version":2}}'})).code,0);
 const draft=await request('/api/studio/draft',{prompt:'生成测试',promptParts:[],generationSettings:{aspectRatio:'16:9',durationSeconds:'auto',agentMode:'G6'}});assert.equal((await request('/api/studio/draft/'+draft.data.draftPromptId)).data.prompt,'生成测试');
 assert.equal((await request('/api/studio/delete',{studioUuid:id})).code,0);assert.equal((await request('/api/studio/list',{})).data.total,0);assert.equal((await request('/api/studio/detail?uuid='+id)).status,404);
}));

test('SQLite snapshots keep GLB/JSON atomic, isolate projects and survive reopening',async()=>fixture(async({request,database,filename,base})=>{
 const a=(await request('/api/studio/create',{name:'A'})).data.studioMeta.uuid,b=(await request('/api/studio/create',{name:'B'})).data.studioMeta.uuid;
 assert.equal((await request('/api/studio/snapshot',snapshotForm(a))).code,0);
 assert.equal((await request('/api/studio/snapshot?projectId='+b)).data,null);
 assert.notEqual((await request('/api/studio/snapshot',snapshotForm(a,2,Buffer.from('invalid')))).code,0);
 assert.notEqual((await request('/api/studio/snapshot',snapshotForm(a,2,emptyGlb(),{entities:[{bad:true}]}))).code,0);
 assert.equal(database.snapshot(a).revision,1);
 assert.equal((await request('/api/studio/snapshot',snapshotForm(a,1))).code,0,'identical retry is idempotent');
 const conflicting=structuredClone(scene);conflicting.entities[0].state.settings.strength=3;
 assert.equal((await request('/api/studio/snapshot',snapshotForm(a,1,emptyGlb(),conflicting))).status,409);
 const info=(await request('/api/studio/snapshot?projectId='+a)).data;
 const response=await fetch(base+new URL(info.glbUrl).pathname);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),emptyGlb());
 const second=new StudioDatabase(filename);assert.equal(second.snapshot(a).revision,1);assert.equal(second.detail(b).studioMeta.name,'B');second.close();
}));

test('local presigned uploads, chunk completion, history and scoped file references',async()=>fixture(async({request,base})=>{
 const init=await request('/gateway/oss-server-api/oss-service/api/oss/pre-sign/4',{path:'upload-images/local/test.png',contentType:'image/png'});assert.equal(init.code,0);const id=init.data.assetId;
 assert.equal((await fetch(base+new URL(init.data.ossUrl).pathname+'?name=reference.png',{method:'PUT',headers:{'Content-Type':'image/png'},body:Buffer.from([137,80,78,71,13,10,26,10])})).status,200);
 assert.equal((await request('/api/task/artifact/list',{mediaType:'image',page:1,pageSize:15})).data.list[0].fileName,'reference.png');
 assert.equal((await request('/api/community/image/verify',{urlList:[init.data.cdnUrl]})).data.list[0].result,false);
 assert.notEqual((await request('/api/community/image/verify',{urlList:['https://example.com/a.png']})).code,0);
 assert.notEqual((await request('/gateway/oss-server-api/oss-service/api/oss/pre-sign/4',{path:'../../.env',contentType:'text/plain'})).code,0);
 const multi=await request('/gateway/oss-server-api/oss-service/api/oss/pre-sign/multipart/init/4',{path:'upload-images/local/book.txt',contentType:'text/plain',fileSize:6,partSize:3});for(const [i,part] of multi.data.parts.entries())assert.equal((await fetch(base+new URL(part.url).pathname,{method:'PUT',body:Buffer.from(i?'def':'abc')})).status,200);
 const done=await request('/gateway/oss-server-api/oss-service/api/oss/pre-sign/multipart/complete/4',{path:'upload-images/local/book.txt',uploadId:multi.data.uploadId});assert.equal(await(await fetch(base+new URL(done.data.cdnUrl).pathname)).text(),'abcdef');
}));

test('agent request persists sessions, streamed messages and run status in SQLite',async()=>fixture(async({request,database,base})=>{
 const id=(await request('/api/studio/create',{name:'会话测试'})).data.studioMeta.uuid,sid=(await request('/api/v1/project/session/create',{projectId:id,canvasId:id,nodeKey:'animation-preview',agentName:'libtv_coding_agent',sessionType:'Copilot'})).data.sessionId;
 const uploaded=await request('/gateway/oss-server-api/oss-service/api/oss/pre-sign/4',{path:'upload-images/local/reference.txt',contentType:'text/plain'});
 await fetch(base+new URL(uploaded.data.ossUrl).pathname+'?name=reference.txt',{method:'PUT',headers:{'Content-Type':'text/plain'},body:'文字参考'});
 const form=new FormData();form.set('payload',JSON.stringify({projectId:id,sessionId:sid,runId:crypto.randomUUID(),prompt:'测试',messages:[{id:'user-one',role:'user',text:'测试'}],attachmentIds:[uploaded.data.assetId],sceneJson:scene}));form.set('scene',new Blob([emptyGlb()]),'current.glb');
 const response=await fetch(base+'/api/agent/run',{method:'POST',body:form});const text=await response.text();assert.ok(text.includes('RUN_FINISHED'),text);
 const history=(await request(`/api/v1/project/message/list?projectId=${id}&sessionId=${sid}`)).data;assert.equal(history.runStatus,'completed');assert.equal(history.messages.length,2);assert.equal(history.messages[1].text,'真实测试服务已接收');assert.equal(JSON.parse(database.detail(id).config).animationPreview.sessionId,sid);
 assert.equal(history.messages[0].attachments[0].name,'reference.txt');assert.equal(history.messages[0].attachments[0].kind,'document');
 const other=(await request('/api/studio/create',{name:'其他项目'})).data.studioMeta.uuid;assert.notEqual((await request(`/api/v1/project/message/list?projectId=${other}&sessionId=${sid}`)).code,0);
}));

test('libtv-shaped WebSocket sends through the same real agent pipeline and persists history',async()=>fixture(async({request,base})=>{
 const id=(await request('/api/studio/create',{name:'WebSocket'})).data.studioMeta.uuid,sid=(await request('/api/v1/project/session/create',{projectId:id})).data.sessionId;
 const ws=new WebSocket(base.replace('http:','ws:')+'/ws?project_id='+id+'&agent_name=libtv_coding_agent');
 const events=[];await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WebSocket timeout')),5000);ws.on('error',reject);ws.on('open',()=>ws.send(JSON.stringify({threadId:sid,messages:[{id:'ws-user',role:'user',content:JSON.stringify([{type:'text',text:'创建测试'}])}],forwardedProps:{extra:{aspect_ratio:'9:16',duration_seconds:10,agent_mode:'G6'}}})));ws.on('message',bytes=>{const frame=JSON.parse(bytes.toString());events.push(frame);if(['RUN_FINISHED','RUN_ERROR'].includes(frame.type)){clearTimeout(timer);resolve();}});});
 ws.close();assert.ok(events.some(e=>e.type==='RUN_STARTED'));assert.ok(events.some(e=>e.type==='TEXT_MESSAGE_CONTENT'));assert.ok(events.some(e=>e.type==='RUN_FINISHED'),JSON.stringify(events));assert.equal((await request(`/api/v1/project/message/list?projectId=${id}&sessionId=${sid}`)).data.messages.length,2);
}));
