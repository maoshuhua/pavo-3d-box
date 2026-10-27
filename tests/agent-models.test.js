import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {agentModels,resolveAgentModel,agentModelTransport} from '../server/agentModels.js';
import {selectedAgentModel} from '../src/agentModels.js';
import {configured} from '../server/config.js';
import {runDeepAgent} from '../server/agent.js';
import {createServer} from '../server/index.js';
import {StudioDatabase} from '../server/studioDatabase.js';

function environment(values){
 const old=new Map(Object.keys(values).map(key=>[key,process.env[key]]));
 for(const [key,value] of Object.entries(values))if(value===undefined)delete process.env[key];else process.env[key]=value;
 return ()=>{for(const [key,value] of old)if(value===undefined)delete process.env[key];else process.env[key]=value;};
}

test('Responses-only models preserve reasoning while other model transports remain compatible',()=>{
 for(const name of ['gpt-6.1-sol','provider/gpt-6.1-sol','gpt-6.1-sol-2026-10-01','gpt-6-astra']){
  const options=agentModelTransport(name);assert.equal(options.useResponsesApi,true);assert.equal(options.modelKwargs.store,false);assert.deepEqual(options.modelKwargs.include,['reasoning.encrypted_content']);assert(!('reasoning_effort' in options.modelKwargs));
 }
 assert.deepEqual(agentModelTransport('deepseek-v4.1-flash'),{modelKwargs:{reasoning_effort:'none'}});
 for(const name of ['model-a','Provider/Model-B','gpt-4.1','not-gpt-6.1-sol'])assert.deepEqual(agentModelTransport(name),{});
});

test('model catalog uses real names, list priority, deduplication and shared credentials',()=>{
 const env={AGENT_MODEL:'fallback',AGENT_MODELS:' model-a, Provider/Model-B，model-a\nmodel-c ',AGENT_API_KEY:'must-stay-private',AGENT_BASE_URL:'https://private.example/v1'};
 const models=agentModels(env);
 assert.deepEqual(models.map(m=>m.key),['model-a','Provider/Model-B','model-c']);
 assert.deepEqual(models.map(m=>m.name),models.map(m=>m.key));
 assert(!JSON.stringify(models).includes(env.AGENT_API_KEY));assert(!JSON.stringify(models).includes(env.AGENT_BASE_URL));
 assert.equal(resolveAgentModel('Provider/Model-B',env),'Provider/Model-B');
 assert.equal(resolveAgentModel('removed-model',env),'model-a');
 assert.deepEqual(agentModels({AGENT_MODEL:'model-a, model-b'}).map(m=>m.key),['model-a','model-b']);
 assert.equal(agentModels({}).length,0);assert.throws(()=>resolveAgentModel(undefined,{}),/配置 AGENT_MODEL/);
});

test('old project modes and the frontend resolve to the same configured model',()=>{
 const env={AGENT_MODEL:'default-model',AGENT_MODEL_G6:'Pro/Exact-Case',AGENT_MODEL_DV4:'fast-model'},models=agentModels(env);
 for(const key of ['G6','DV4',undefined,'removed-model','Pro/Exact-Case'])assert.equal(selectedAgentModel(models,key).key,resolveAgentModel(key,env));
 assert.equal(resolveAgentModel('G6',env),'Pro/Exact-Case');assert.equal(resolveAgentModel('DV4',env),'fast-model');
 const restricted={...env,AGENT_MODELS:'only-model'};
 assert.equal(resolveAgentModel('G6',restricted),'only-model');
 assert.deepEqual(agentModels(restricted).map(m=>m.key),['only-model']);
});

test('modes endpoint and real model transport honor selection while sharing URL and key',{timeout:30000},async()=>{
 const parent=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'3d-box-models-')),calls=[];
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const value=JSON.parse(body),id=crypto.randomUUID();calls.push({model:value.model,authorization:req.headers.authorization,url:req.url});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const frame=(delta,finish_reason)=>`data: ${JSON.stringify({id,object:'chat.completion.chunk',created:1,model:value.model,choices:[{index:0,delta,finish_reason}]})}\n\n`;
  res.end(frame({role:'assistant',content:'模型连接测试完成。'},null)+frame({},'stop')+'data: [DONE]\n\n');
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const restore=environment({AGENT_MODELS:'model-a,Provider/Model-B',AGENT_MODEL:'',AGENT_MODEL_G6:undefined,AGENT_MODEL_DV4:undefined,AGENT_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,AGENT_API_KEY:'shared-local-test-key'});
 const database=new StudioDatabase(':memory:'),service=createServer({database,requireConfiguration:false}),server=http.createServer(service.app);
 try{
  assert(configured(),'AGENT_MODELS alone must be accepted when the shared key is configured');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await(await fetch(base+'/api/task/agent-task/modes')).json();
  assert.deepEqual(response.data.modes.map(m=>m.name),['model-a','Provider/Model-B']);
  assert(!JSON.stringify(response).includes('shared-local-test-key'));
  assert.equal((await(await fetch(base+'/api/agent/health')).json()).model,'model-a');
  const sessionId=crypto.randomUUID();
  for(const agentMode of ['G6','Provider/Model-B','removed-model']){
   await runDeepAgent({dir,projectId:'model-test',sessionId,messageId:crypto.randomUUID(),prompt:'检查模型连接',generationSettings:{agentMode,aspectRatio:'16:9',durationSeconds:5},sceneJson:{entities:[],operations:[]},assets:[],signal:new AbortController().signal,emit(){},async writeContext(context,api){await fs.mkdir(path.join(dir,'workspace'),{recursive:true});await fs.writeFile(path.join(dir,'workspace','context.json'),JSON.stringify(context));await fs.writeFile(path.join(dir,'workspace','scene-api.txt'),api);}});
  }
  assert.deepEqual(calls.map(c=>c.model),['model-a','Provider/Model-B','model-a']);
  assert(calls.every(c=>c.authorization==='Bearer shared-local-test-key'&&c.url==='/v1/chat/completions'));
 }finally{
  restore();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>upstream.close(resolve));database.close();
  assert(path.resolve(dir).startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});
 }
});

test('GPT-6.1 Sol uses Responses streaming through the real Agent tool loop',{timeout:30000},async()=>{
 const parent=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'3d-box-responses-')),calls=[],events=[];
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const value=JSON.parse(body);calls.push({url:req.url,body:value});
  if(req.url!=='/v1/responses'){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Function tools with reasoning_effort are not supported in chat/completions'}}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const send=event=>res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  const response={id:'resp_'+calls.length,object:'response',model:value.model,status:'in_progress',output:[]};send({type:'response.created',response});
  if(!value.input.some(item=>item.type==='function_call_output')){
   const reasoning={id:'rs_probe',type:'reasoning',summary:[],encrypted_content:'local-encrypted-reasoning-fixture'};
   send({type:'response.output_item.added',output_index:0,item:{...reasoning,encrypted_content:undefined}});send({type:'response.output_item.done',output_index:0,item:reasoning});
   const item={id:'fc_probe',type:'function_call',call_id:'call_probe',name:'x_list',arguments:'',status:'in_progress'};
   send({type:'response.output_item.added',output_index:1,item});
   send({type:'response.function_call_arguments.delta',output_index:1,item_id:item.id,delta:'{"path":'});send({type:'response.function_call_arguments.delta',output_index:1,item_id:item.id,delta:'"/"}'});
   const done={...item,arguments:'{"path":"/"}',status:'completed'};send({type:'response.output_item.done',output_index:1,item:done});send({type:'response.completed',response:{...response,status:'completed',output:[reasoning,done]}});
  }else{
   const text='已通过工具读取工作区。',item={id:'msg_probe',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
   send({type:'response.output_item.added',output_index:0,item:{...item,content:[],status:'in_progress'}});send({type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:text});send({type:'response.output_item.done',output_index:0,item});send({type:'response.completed',response:{...response,status:'completed',output:[item]}});
  }res.end();
 });
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const restore=environment({AGENT_MODELS:'gpt-6.1-sol',AGENT_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`,AGENT_API_KEY:'local-test-only'});
 try{
  await runDeepAgent({dir,projectId:'responses-test',sessionId:crypto.randomUUID(),messageId:crypto.randomUUID(),prompt:'检查工作区连接',generationSettings:{agentMode:'gpt-6.1-sol'},sceneJson:{entities:[],operations:[]},assets:[],signal:new AbortController().signal,emit:e=>events.push(e),async writeContext(context,api){await fs.mkdir(path.join(dir,'workspace'),{recursive:true});await fs.writeFile(path.join(dir,'workspace','context.json'),JSON.stringify(context));await fs.writeFile(path.join(dir,'workspace','scene-api.txt'),api);}});
  assert.equal(calls.length,2);assert(calls.every(c=>c.url==='/v1/responses'&&c.body.model==='gpt-6.1-sol'&&c.body.store===false));
  assert(calls[0].body.tools.some(t=>t.type==='function'&&t.name==='x_list'));assert(calls.every(c=>!('reasoning_effort' in c.body)&&c.body.reasoning?.effort!=='none'));
  const output=calls[1].body.input.find(item=>item.type==='function_call_output');assert.equal(output.call_id,'call_probe');assert.equal(JSON.parse(output.output).status,'completed');
  assert(calls[1].body.input.some(item=>item.type==='reasoning'&&item.encrypted_content==='local-encrypted-reasoning-fixture'));
  assert(events.some(e=>e.type==='TOOL_CALL_RESULT'&&e.toolCallId==='call_probe'));assert(events.some(e=>e.type==='TEXT_MESSAGE_CONTENT'&&e.delta.includes('已通过工具')));
 }finally{restore();await new Promise(resolve=>upstream.close(resolve));assert(path.resolve(dir).startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});}
});
