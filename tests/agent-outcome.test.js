import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {ChatOpenAI} from '@langchain/openai';
import {agentOutcome,sceneAcceptance,declareTaskIntent,previewCheckKey} from '../server/reviewCompletion.js';
import {committedRunOutcome} from '../server/index.js';
import {createSceneTools} from '../server/tools.js';
import {runDeepAgent} from '../server/agent.js';

const frame=(camera_id,time,task_id='latest')=>({status:'completed',task_id,camera_id,time,width:960,height:540,image_url:'http://127.0.0.1/preview.png'});
function sceneContext(){
 return {taskIntent:'scene',sceneWorkStarted:true,completedBuilds:1,isBuildCommitted:id=>id==='latest',current:{result:{status:'completed',task_id:'latest',diagnostics:[]},json:{entities:[
  {id:'main',kind:'camera',state:{camera:{aspect:16/9}}},
  {id:'timeline',kind:'timeline',state:{timeline:{version:1,duration:6,shots:[{cameraId:'main',start:0,end:6}]}}}
 ]}},previewChecks:[0,3,6].map(t=>frame('main',t)),taskReview:{task_id:'latest',status:'ready',issues:[]},generationSettings:{durationSeconds:6,aspectRatio:'16:9'}};
}

test('scene delivery needs a new build, latest previews and explicit review even when the model stops normally',()=>{
 const empty=agentOutcome({});assert.equal(empty.status,'partial');assert(empty.issues.some(i=>i.code==='no-new-build'));
 const ctx=sceneContext();ctx.previewChecks=[];
 assert.equal(agentOutcome(ctx).status,'partial');assert(agentOutcome(ctx).issues.some(i=>i.code==='preview-coverage'));
 ctx.previewChecks=[0,3,6].map(t=>frame('main',t));ctx.taskReview=null;
 assert.equal(agentOutcome(ctx).status,'partial');assert(agentOutcome(ctx).issues.some(i=>i.code==='review-missing'));
 ctx.taskReview={task_id:'latest',status:'ready',issues:[]};assert.equal(agentOutcome(ctx).status,'completed');
 assert.equal(agentOutcome(ctx).checksPassed,true);assert.equal(agentOutcome(ctx).artifactCommitted,true);
});

test('declared unfinished work, severe diagnostics, failed builds and budget exhaustion remain partial',()=>{
 for(const change of [
  ctx=>{ctx.taskReview.status='partial';ctx.taskReview.issues=['仍需修正最后一个镜头'];},
  ctx=>{ctx.taskReview.issues=['主体动作未完成'];},
  ctx=>{ctx.current.result.diagnostics=[{kind:'inside-subject-bounds',time:2,entityId:'subject',pathId:'p'}];},
  ctx=>{ctx.current.result.diagnostics=[{kind:'runtime-failure',severity:'error'}];},
  ctx=>{ctx.latestBuildFailed=true;},ctx=>{ctx.unbuiltChanges=true;},ctx=>{ctx.budgetExhausted=true;},
 ]){const ctx=sceneContext();change(ctx);assert.equal(agentOutcome(ctx).status,'partial');assert(agentOutcome(ctx).issues.length>0);}
 const warning=sceneContext();warning.current.result.diagnostics=[{kind:'subject-outside-frame',time:1,entityId:'subject',pathId:'p'}];
 const outcome=agentOutcome(warning);assert.equal(outcome.status,'completed');assert.equal(outcome.diagnostics.length,1,'nonfatal composition warnings remain visible');
});

test('old build checks and old task reviews cannot validate a newer artifact',()=>{
 const ctx=sceneContext();ctx.previewChecks=ctx.previewChecks.map(p=>({...p,task_id:'old'}));
 assert.equal(sceneAcceptance(ctx).status,'partial');
 ctx.previewChecks=[0,3,6].map(t=>frame('main',t));ctx.taskReview.task_id='old';
 assert(sceneAcceptance(ctx).issues.some(i=>i.code==='review-missing'));
 ctx.taskReview.task_id='latest';ctx.completedBuilds=0;
 assert(sceneAcceptance(ctx).issues.some(i=>i.code==='no-new-build'),'an earlier run artifact is not a new delivery');
});

test('ready requires preview pixels to have reached a subsequent model call',()=>{
 const ctx=sceneContext();ctx.observedPreviewKeys=new Set();
 assert.equal(sceneAcceptance(ctx).status,'partial','requesting previews alongside ready is not visual inspection');
 for(const p of ctx.previewChecks)ctx.observedPreviewKeys.add(previewCheckKey(p));
 assert.equal(sceneAcceptance(ctx).status,'completed');
 ctx.taskReviewObservedKeys=new Set();
 assert.equal(sceneAcceptance(ctx).status,'partial','a later model call cannot retroactively validate an earlier ready declaration');
 ctx.taskReviewObservedKeys=new Set(ctx.observedPreviewKeys);assert.equal(sceneAcceptance(ctx).status,'completed');
});

test('each camera shot needs its own latest start, middle and end frames',()=>{
 const ctx=sceneContext();ctx.current.json.entities.push({id:'insert',kind:'camera',state:{camera:{aspect:16/9}}});
 ctx.current.json.entities.find(e=>e.kind==='timeline').state.timeline.shots=[{cameraId:'main',start:0,end:3},{cameraId:'insert',start:3,end:6}];
 assert.equal(sceneAcceptance(ctx).status,'partial','global endpoints alone do not cover both shots');
 ctx.previewChecks=[0,1.5,3].map(t=>frame('main',t)).concat([3,4.5,6].map(t=>frame('insert',t)));
 assert.equal(sceneAcceptance(ctx).status,'completed');
 ctx.previewChecks[4].camera_id='main';assert.equal(sceneAcceptance(ctx).status,'partial','a different camera is not a valid inspection');
 ctx.previewChecks[4]=frame('insert',4.5,'old');assert.equal(sceneAcceptance(ctx).status,'partial');
});

test('invalid timeline, missing cameras and requested duration/aspect mismatches fail delivery',()=>{
 for(const change of [
  ctx=>{ctx.current.json.entities=ctx.current.json.entities.filter(e=>e.kind!=='camera');},
  ctx=>{ctx.current.json.entities.find(e=>e.kind==='timeline').state.timeline.shots=[];},
  ctx=>{ctx.current.json.entities.find(e=>e.kind==='timeline').state.timeline.shots[0].start=1;},
  ctx=>{ctx.generationSettings.durationSeconds=8;},ctx=>{ctx.generationSettings.aspectRatio='9:16';},
  ctx=>{ctx.previewChecks[1].width=0;},ctx=>{ctx.isBuildCommitted=()=>false;},
 ]){const ctx=sceneContext();change(ctx);assert.equal(sceneAcceptance(ctx).status,'partial');}
});

test('only declared question answering is chat, and scene work cannot downgrade',()=>{
 const ctx={};assert.equal(agentOutcome(ctx).status,'partial','unknown requests are conservatively scene work');
 declareTaskIntent(ctx,'chat');assert.equal(agentOutcome(ctx).status,'chat');
 declareTaskIntent(ctx,'scene');declareTaskIntent(ctx,'chat');assert.equal(ctx.taskIntent,'scene');assert.equal(agentOutcome(ctx).status,'partial');
 const built=sceneContext();built.taskIntent='chat';built.sceneWorkStarted=false;assert.equal(agentOutcome(built).intent,'scene');
});

test('server completion requires the exact artifact to have committed and preserves legacy runner API',()=>{
 const outcome=agentOutcome(sceneContext());
 assert.equal(committedRunOutcome(outcome,new Map()).status,'partial');
 assert.equal(committedRunOutcome(outcome,new Map([['older',1]])).status,'partial');
 assert.equal(committedRunOutcome(outcome,new Map([['latest',1]])).status,'completed');
 assert.equal(committedRunOutcome({...outcome,checksPassed:false},new Map([['latest',1]])).status,'partial');
 assert.equal(committedRunOutcome(agentOutcome({taskIntent:'chat'}),new Map()).status,'completed');
 assert.equal(committedRunOutcome(undefined,new Map()).status,'completed');
});

async function workspaceFixture(t,context={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3d-box-outcome-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'workspace'));
 const ctx={dir,projectId:'outcome-test',signal:new AbortController().signal,emit(){},assets:[],sceneJson:{entities:[],operations:[]},...context};
 const tools=new Map(createSceneTools(ctx).map(tool=>[tool.name,tool]));
 const invoke=async(name,args)=>{const value=await tools.get(name).invoke(args);return typeof value==='string'?JSON.parse(value):value;};
 return {dir,ctx,invoke};
}

test('x_list declarations are semantic metadata; writes and copies irreversibly select scene work',async t=>{
 const {ctx,invoke}=await workspaceFixture(t);
 assert.equal((await invoke('x_list',{task_intent:'chat'})).task_intent,'chat');
 await invoke('x_write',{path:'/scene.js',content:'function build(){return {version:1};}'});
 assert.equal(ctx.taskIntent,'scene');assert.equal(ctx.unbuiltChanges,true);
 assert.equal((await invoke('x_list',{task_intent:'chat'})).task_intent,'scene');
 const copied=await workspaceFixture(t);await fs.writeFile(path.join(copied.dir,'workspace','scene.js'),'source');
 await copied.invoke('x_list',{task_intent:'chat'});await copied.invoke('x_copy',{source:'/scene.js',destination:'/copy.js'});
 assert.equal(copied.ctx.taskIntent,'scene');
});

test('task reviews reject obsolete IDs and expose unmet checks without changing the latest artifact',async t=>{
 const fixture=await workspaceFixture(t,sceneContext());
 assert.equal((await fixture.invoke('x_list',{task_review:{task_id:'old',status:'ready',issues:[]}})).status,'error');
 const reply=await fixture.invoke('x_list',{task_review:{task_id:'latest',status:'partial',issues:['动作尚未完成']}});
 assert.equal(reply.acceptance.status,'partial');assert.equal(fixture.ctx.current.result.task_id,'latest');
});

async function modelFixture(t,plan){
 const {dir,ctx}=await workspaceFixture(t),requests=[];
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body);requests.push(request);
  const item=plan[requests.length-1]||'测试答复。',id='outcome-'+requests.length;
  const delta=typeof item==='string'?{role:'assistant',content:item}:{role:'assistant',tool_calls:[{index:0,id:'call-'+requests.length,type:'function',function:{name:item[0],arguments:JSON.stringify(item[1])}}]};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const frame=(value,reason)=>`data: ${JSON.stringify({id,object:'chat.completion.chunk',created:1,model:'outcome-test',choices:[{index:0,delta:value,finish_reason:reason}]})}\n\n`;
  res.end(frame(delta,null)+frame({},typeof item==='string'?'stop':'tool_calls')+'data: [DONE]\n\n');
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>upstream.close(resolve)));
 const model=new ChatOpenAI({model:'outcome-test',apiKey:'local-fixture-only',configuration:{baseURL:`http://127.0.0.1:${upstream.address().port}/v1`},maxRetries:0});
 const outcome=await runDeepAgent({...ctx,sessionId:crypto.randomUUID(),messageId:crypto.randomUUID(),prompt:'结合当前项目和整段请求执行任务',async writeContext(context,api){await fs.writeFile(path.join(dir,'workspace','context.json'),JSON.stringify(context));await fs.writeFile(path.join(dir,'workspace','scene-api.txt'),api);}},{model});
 return {outcome,requests};
}

test('real Agent transport returns partial for early text-only stopping and chat only after declaration',async t=>{
 const early=await modelFixture(t,['已经处理。']);assert.equal(early.outcome.status,'partial');
 assert(early.outcome.issues.some(i=>i.code==='no-new-build'));
 const chat=await modelFixture(t,[['x_list',{task_intent:'chat'}],'这里是问题的解释。']);assert.equal(chat.outcome.status,'chat');
 assert.equal(chat.requests.length,2,'intent declaration uses an existing tool turn, not another classifier request');
 assert(chat.requests.every(r=>r.tools.length===8));
});

test('repeating an unchanged failed build closes tools and reports partial without publishing a scene',async t=>{
 const failed=['build_3D_scene',{source:'/missing.js'}];
 const {outcome,requests}=await modelFixture(t,[failed,failed,failed,'未能构建场景，已停止重复执行。']);
 assert.equal(requests.length,4);assert.equal(requests.at(-1).tool_choice,'none');assert.equal(outcome.status,'partial');
 assert(outcome.issues.some(i=>i.code==='repeated-error-stop'));assert.equal(outcome.taskId,null);
});
