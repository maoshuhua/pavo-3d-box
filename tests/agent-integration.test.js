import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {ChatOpenAI} from '@langchain/openai';
import {createServer} from '../server/index.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {runDeepAgent} from '../server/agent.js';
import {closeRenderer,renderCall} from '../server/renderService.js';
import {sceneSource} from './fixture.js';
import {validateGlb} from '../server/uploads.js';
import {projectDir} from '../server/storage.js';
import {BASE,PORT} from '../server/config.js';
import {resultSchema,collaborationSchema} from '../src/agentSchemas.js';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
const close=server=>new Promise(resolve=>server.close(resolve));
const testDatabases=[];
function testServer(options={}){const database=new StudioDatabase(':memory:');testDatabases.push(database);return createServer({...options,database});}
after(()=>{for(const database of testDatabases)database.close();});
function emptyGlb(){const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]}));const size=Math.ceil(json.length/4)*4;const b=Buffer.alloc(20+size,32);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(size,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);return b;}
const emptyJson={version:1,entities:[{id:'world',kind:'world',state:{settings:{type:'solid',color:[.22,.24,.27],strength:2}}}],operations:[]};

test('Deep Agents + seven tools + GLB/PNG + bounded visual review',{timeout:180000},async()=>{
 const projectId='test-'+crypto.randomUUID(),modelRequests=[];let api,server,renderHost;
 const previousPassLimit=process.env.AGENT_MAX_BUILD_PASSES;process.env.AGENT_MAX_BUILD_PASSES='3';
 const plan=[['x_list',{path:'/'}],['x_read',{path:'/scene-api.txt'}],['x_write',{path:'/scene.js',content:sceneSource,overwrite:true}],['x_grep',{pattern:'#ff7711',path:'/scene.js'}],['x_edit',{path:'/scene.js',old_string:'#ff7711',new_string:'#ee3344',replace_all:false}],
  ...Array.from({length:3},()=>[['build_3D_scene',{source:'/scene.js'}],...[0,1.5,3].map(time=>['preview_3D_scene',{camera_id:'camera',time}])]).flat()];
 try{
  // A deterministic model fixture exercises real ChatOpenAI and Deep Agents.
  // It does not pretend to validate a paid model's reasoning or scene quality.
  api=http.createServer(async(req,res)=>{
   let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);modelRequests.push(request);
   const completed=request.messages.filter(m=>m.role==='tool').length;
   // Keep asking to build forever unless the agent actually closes tool use.
   const call=request.tool_choice==='none'?null:(plan[completed]||['build_3D_scene',{source:'/scene.js'}]),id='test-completion-'+completed;
   const delta=call?{role:'assistant',tool_calls:[{index:0,id:'call-'+completed,type:'function',function:{name:call[0],arguments:JSON.stringify(call[1])}}]}:{role:'assistant',content:'已生成并检查地铁跑酷测试场景。'};
   if(request.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(`data: ${JSON.stringify({id,object:'chat.completion.chunk',model:'test',created:1,choices:[{index:0,delta,finish_reason:null}]})}\n\n`);res.end(`data: ${JSON.stringify({id,object:'chat.completion.chunk',model:'test',created:1,choices:[{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}]})}\n\ndata: [DONE]\n\n`);}
   else res.end(JSON.stringify({id,object:'chat.completion',created:1,model:'test',choices:[{index:0,message:delta,finish_reason:call?'tool_calls':'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
  });
  const modelPort=await listen(api);
  const model=new ChatOpenAI({model:'test-scene-model',apiKey:'local-test-key',configuration:{baseURL:`http://127.0.0.1:${modelPort}/v1`},maxRetries:0});
  const {app}=testServer({requireConfiguration:false,runAgent:ctx=>runDeepAgent(ctx,{model})});
  server=http.createServer(app);const port=await listen(server);
  // Renderer uses the production loopback origin; reuse the running server when present.
  try{const r=await fetch(BASE+'/api/agent/health');if(!r.ok)throw Error();}
  catch{const {app}=testServer();renderHost=http.createServer(app);await new Promise(resolve=>renderHost.listen(PORT,'127.0.0.1',resolve));}
  const form=new FormData();form.set('payload',JSON.stringify({projectId,runId:crypto.randomUUID(),prompt:'生成并检查跑酷场景',sceneJson:emptyJson}));form.set('scene',new Blob([emptyGlb()]),'current.glb');
  const response=await fetch(`http://127.0.0.1:${port}/api/agent/run`,{method:'POST',body:form});assert.equal(response.status,200);
  const text=await response.text(),events=text.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
  const error=events.find(e=>e.type==='RUN_ERROR');assert.equal(error,undefined,error?.message);
  assert(events.some(e=>e.type==='RUN_FINISHED'));
  assert.deepEqual(events.filter(e=>e.type==='TOOL_CALL_START').map(e=>e.toolCallName),plan.map(p=>p[0]));
  assert.equal(modelRequests.at(-1).tool_choice,'none','bounded review must close tools through the real model transport');
  const result=resultSchema.parse(events.find(e=>e.type==='RESULT').result);
  const glb=Buffer.from(await (await fetch(result.glb_url)).arrayBuffer());validateGlb(glb);assert.equal(glb.length,result.glb_size);
  assert.equal(crypto.createHash('sha256').update(glb).digest('hex'),result.glb_sha256);
  const json=collaborationSchema.parse(await (await fetch(result.collaboration_url)).json());
  assert(json.entities.some(e=>e.id==='runner'));assert.equal(json.entities.find(e=>e.kind==='timeline').state.timeline.duration,3);
  assert.equal(json.entities.find(e=>e.id==='body').state.color,'#ee3344');
  const preview=events.find(e=>e.type==='PREVIEW'&&e.time===1.5);assert(preview);const png=Buffer.from(await(await fetch(preview.image_url)).arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');
  const sawVision=modelRequests.some(r=>r.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));assert(sawVision,'preview pixels must reach model');
  const expectedTools=['x_list','x_read','x_write','x_edit','x_grep','preview_3D_scene','build_3D_scene'].sort();
  assert(modelRequests.every(r=>JSON.stringify(r.tools.map(t=>t.function.name).sort())===JSON.stringify(expectedTools)),'every model request must expose exactly the seven supported tools');
  for(const name of ['x_list','x_read','x_grep']){
   const start=events.find(event=>event.type==='TOOL_CALL_START'&&event.toolCallName===name);
   const value=JSON.parse(events.find(event=>event.type==='TOOL_CALL_RESULT'&&event.toolCallId===start.toolCallId).content);
   assert.equal(value.status,'completed',`${name} must execute successfully inside the Deep Agents tool loop`);
  }
  await fs.mkdir('test-output',{recursive:true});await fs.writeFile('test-output/agent-preview.png',png);await fs.writeFile('test-output/agent-events.json',JSON.stringify(events,null,2));
  const later=await renderCall('preview',{glb:glb.toString('base64'),json,cameraId:'camera',time:0});
  assert.notEqual(later.image,png.toString('base64'),'animation must change the rendered image');
  const patched=await renderCall('compile',{spec:{version:1,mode:'patch',objects:[{id:'body',material:{color:'#0066ff'}}],remove:[],animations:[],operations:[]},baseUrl:result.glb_url,baseJson:json,assets:[]});
  assert.equal(patched.json.entities.find(e=>e.id==='body').state.color,'#0066ff');
  assert(patched.json.entities.some(e=>e.id==='coin-11'),'unrelated scene assets must survive patch');
  assert.equal(patched.json.entities.find(e=>e.kind==='timeline').state.timeline.duration,3);
 }finally{if(previousPassLimit===undefined)delete process.env.AGENT_MAX_BUILD_PASSES;else process.env.AGENT_MAX_BUILD_PASSES=previousPassLimit;await closeRenderer();if(server)await close(server);if(renderHost)await close(renderHost);if(api)await close(api);await fs.rm(projectDir(projectId),{recursive:true,force:true});}
});

test('server rejects missing model configuration and remote origins',async()=>{
 const {app}=testServer();const server=http.createServer(app),port=await listen(server);
 try{
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/agent/health`,{headers:{Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await fetch(`http://127.0.0.1:${port}/runtime/renderer.html`,{headers:{Origin:BASE}})).status,200,'configured renderer origin must work with a non-default Agent port');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/agent/health`,{headers:{Origin:'http://127.0.0.1:9999'}})).status,403);
 }
 finally{await close(server);}
});

test('cancel stops the running agent and does not publish a result',{timeout:15000},async()=>{
 const id='cancel-'+crypto.randomUUID();let stopped=false;
 const {app}=testServer({requireConfiguration:false,runAgent:async ctx=>{await new Promise(resolve=>{const stop=()=>{stopped=true;resolve();};if(ctx.signal.aborted)stop();else ctx.signal.addEventListener('abort',stop,{once:true});});ctx.signal.throwIfAborted();}});
 const server=http.createServer(app),port=await listen(server),runId=crypto.randomUUID();
 try{
  const form=new FormData();form.set('payload',JSON.stringify({projectId:id,runId,prompt:'cancel test',sceneJson:emptyJson}));form.set('scene',new Blob([emptyGlb()]),'current.glb');
  const response=await fetch(`http://127.0.0.1:${port}/api/agent/run`,{method:'POST',body:form});
  await fetch(`http://127.0.0.1:${port}/api/agent/runs/${runId}?projectId=${id}`,{method:'DELETE'});
  const text=await response.text();assert(stopped);assert(text.includes('RUN_ERROR'));assert(!text.includes('"type":"RESULT"'));
 }finally{await close(server);await fs.rm(projectDir(id),{recursive:true,force:true});}
});
