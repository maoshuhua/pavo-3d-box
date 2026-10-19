import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {agentModels,resolveAgentModel} from '../server/agentModels.js';
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
