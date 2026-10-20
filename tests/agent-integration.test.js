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

test('Deep Agents displays first build before inspection, batches correction and accepts current GLB',{timeout:180000},async()=>{
 const projectId='test-'+crypto.randomUUID(),modelRequests=[];let api,server,renderHost;
 const directorPlan={intent:'三秒单机位运动场景，红衣人物与跟拍机位可见',duration:3,aspectRatio:'16:9',
  subjects:[{id:'runner',description:'带红色上衣的人物'}],constraints:[{id:'duration',description:'三秒、16:9',subjectIds:[]}],
  shots:[{id:'shot',start:0,end:3,cameraRef:'camera',purpose:'显示人物运动',subjects:['runner'],action:'人物与相机移动',framing:'全景',movement:'跟随',criterionIds:['structure','appearance','motion']}],
  criteria:[{id:'structure',description:'正确时长、切镜和画幅',kind:'structural',required:true,shotIds:['shot']},{id:'appearance',description:'人物和场景可见',kind:'visual',required:true,shotIds:['shot']},{id:'motion',description:'人物和相机在多个时刻改变位置',kind:'motion',required:true,shotIds:['shot']}],
 };
 const latestTool=(request,match)=>{
  for(const message of request.messages.filter(m=>m.role==='tool').reverse()){
   try{const value=JSON.parse(message.content);if(match(value))return value;}catch{}
  }
  throw Error('Fixture expected a real build or preview response');
 };
 const plan=[['x_list',{path:'/'}],['x_read',{path:'/scene-api.txt'}],['coding_todo_write',{op:'set_plan',requestId:'plan-fixture',plan:directorPlan,tasks:[
  {id:'implement',title:'创建可播放场景',kind:'implement',status:'in_progress'},
  {id:'review',title:'检查交付件所有必需标准',kind:'review',status:'pending',dependsOn:['implement'],criterionIds:['structure','appearance','motion']},
 ]}],
  ['x_write',{path:'/scene.js',content:sceneSource,overwrite:true}],['build_3D_scene',{}],['preview_3D_scene',{target:'build'}],
  ['coding_todo_write',request=>{const build=latestTool(request,v=>!!v.glb_url),preview=latestTool(request,v=>Array.isArray(v.frames));return {op:'record_reviews',requestId:'failed-inspection',reviews:[{criterionId:'appearance',verdict:'fail',evidenceIds:preview.frames.map(f=>f.evidence_id),observation:'上衣颜色需要改为指定颜色'}],tasks:[
   {id:'implement',title:'创建可播放场景',kind:'implement',status:'completed',evidenceIds:[build.evidence_id]},
   {id:'review',title:'检查初版颜色',kind:'review',status:'completed',dependsOn:['implement'],criterionIds:['appearance']},
   {id:'correct',title:'修正上衣颜色',kind:'implement',status:'in_progress',dependsOn:['review']},
  ]};}],
  ['x_grep',{pattern:'#ff7711',path:'/scene.js'}],['x_edit',{path:'/scene.js',old_string:'#ff7711',new_string:'#ee3344',replace_all:false}],
  ['build_3D_scene',{}],['preview_3D_scene',{target:'build'}],
  ['coding_todo_write',request=>{const build=latestTool(request,v=>!!v.glb_url),preview=latestTool(request,v=>Array.isArray(v.frames)),ids=preview.frames.map(f=>f.evidence_id);assert.equal(preview.frames.length,2);assert.deepEqual(preview.missing_frames,[]);return {op:'record_reviews',requestId:'acceptance-fixture',reviews:[
   {criterionId:'structure',verdict:'pass',evidenceIds:[build.evidence_id],observation:'服务端结构检查通过'},
   {criterionId:'appearance',verdict:'pass',evidenceIds:ids,observation:'当前交付件实际帧已收到'},
   {criterionId:'motion',verdict:'pass',evidenceIds:ids,observation:'两个时刻对应实际动作帧，自动化测试另比较像素变化'},
  ],tasks:[
   {id:'implement',title:'创建可播放场景',kind:'implement',status:'completed',evidenceIds:[build.evidence_id]},
   {id:'correct',title:'修正上衣颜色',kind:'implement',status:'completed',dependsOn:['review'],evidenceIds:[build.evidence_id]},
   {id:'review',title:'检查交付件所有必需标准',kind:'review',status:'completed',dependsOn:['implement'],criterionIds:['structure','appearance','motion'],evidenceIds:ids},
  ]};}],
 ];
 try{
  // A deterministic model fixture exercises real ChatOpenAI and Deep Agents.
  // It does not pretend to validate a paid model's reasoning or scene quality.
  api=http.createServer(async(req,res)=>{
   let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);modelRequests.push(request);
   const completed=request.messages.filter(m=>m.role==='tool').length;
   const step=plan[completed],id='test-completion-'+completed;let call;
   try{call=request.tool_choice==='none'||!step?null:[step[0],typeof step[1]==='function'?step[1](request):step[1]];}
   catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:error.message,type:'fixture_error'}}));return;}
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
  assert.equal(modelRequests.at(-1).tool_choice,'none','accepted current build must close tools through the real model transport');
  const results=events.filter(e=>e.type==='RESULT');assert.equal(results.length,2,'first playable build plus one concrete correction');
  const previewIndex=events.findIndex(e=>e.type==='PREVIEW'),buildIndex=events.findIndex(e=>e.type==='RESULT');
  assert(buildIndex>=0&&previewIndex>buildIndex,'playable first result must be published before any screenshot review');
  assert(!events.some(e=>e.type==='PREVIEW'&&e.target==='draft'));
  assert(!plan.some(([name,args])=>name==='coding_todo_write'&&args.op==='read'),'successful flow needs no routine state read');
  const acceptance=events.filter(e=>e.type==='DIRECTOR_STATE').at(-1)?.state;
  assert(acceptance?.acceptance?.ready,'final director state must retain accepted current-build evidence');
  assert(acceptance.tasks.some(task=>task.kind==='implement'&&task.status==='completed'),'delivery requires completed implementation work');
  for(const criterion of directorPlan.criteria.filter(c=>c.required))assert(acceptance.tasks.some(task=>task.kind==='review'&&task.status==='completed'&&task.criterionIds.includes(criterion.id)),`completed review task must cover ${criterion.id}`);
  const result=resultSchema.parse(results.at(-1).result);
  const glb=Buffer.from(await (await fetch(result.glb_url)).arrayBuffer());validateGlb(glb);assert.equal(glb.length,result.glb_size);
  assert.equal(crypto.createHash('sha256').update(glb).digest('hex'),result.glb_sha256);
  const json=collaborationSchema.parse(await (await fetch(result.collaboration_url)).json());
  assert(json.entities.some(e=>e.id==='runner'));assert.equal(json.entities.find(e=>e.kind==='timeline').state.timeline.duration,3);
  assert.equal(json.entities.find(e=>e.id==='body').state.color,'#ee3344');
  const preview=events.find(e=>e.type==='PREVIEW'&&e.task_id===result.task_id&&e.time===3);assert(preview);const png=Buffer.from(await(await fetch(preview.image_url)).arrayBuffer());assert.equal(png.subarray(1,4).toString(),'PNG');
  const sawVision=modelRequests.some(r=>r.messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url')));assert(sawVision,'preview pixels must reach model');
  const expectedTools=['x_list','x_read','x_write','x_edit','x_grep','preview_3D_scene','build_3D_scene','coding_todo_write'].sort();
  assert(modelRequests.every(r=>JSON.stringify(r.tools.map(t=>t.function.name).sort())===JSON.stringify(expectedTools)),'every model request must expose exactly eight supported tools');
  const skillMessages=modelRequests[0].messages.filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
  assert.match(skillMessages,/coding_todo_write/,'director tool contract must be present in the model context');
  const checkpoint=await fs.readFile(path.join(projectDir(projectId),'sessions',events.find(e=>e.type==='SESSION').sessionId,'checkpoint.bin'));
  assert(!checkpoint.includes(Buffer.from('data:image/png;base64,')),'preview pixel payloads must not be retained in checkpoints');
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
 }finally{await closeRenderer();if(server)await close(server);if(renderHost)await close(renderHost);if(api)await close(api);await fs.rm(projectDir(projectId),{recursive:true,force:true});}
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
