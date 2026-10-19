import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ChatOpenAI} from '@langchain/openai';
import {runDeepAgent} from '../server/agent.js';
import {DiskSaver} from '../server/storage.js';
import {agentRecursionLimit,createStepBudget} from '../server/agentBudget.js';

test('recursion limit is expanded and invalid configuration falls back safely',()=>{
 for(const value of ['', '0','-10','NaN','Infinity','500.5','5001'])assert.equal(agentRecursionLimit(value),500);
 for(const value of [50,100,500,1000,5000])assert.equal(agentRecursionLimit(String(value)),value);
});

test('step budget measures this run, reserving finalization steps across old checkpoints',()=>{
 const budget=createStepBudget(500);
 assert.deepEqual(budget(10000),{limit:500,used:0,exhausted:false});
 assert.equal(budget(10475).exhausted,false);
 assert.equal(budget(10476).exhausted,true);
 assert.equal(createStepBudget(500)(10480).exhausted,false);
 const fallback=createStepBudget(60);
 assert.equal(fallback(undefined).exhausted,false);
 for(let i=0;i<20;i++)fallback(undefined);
 assert.equal(fallback(undefined).exhausted,true);
});

// Three real graph invocations include >100 steps, durable checkpoints and two
// restarts of the same thread. Allow I/O contention with the renderer; this is
// a correctness test, while production model/generation deadlines are tested
// separately by the heartbeat fixtures.
test('real Deep Agents loop exceeds old 100 steps, stops safely, and resets per turn',{timeout:120000},async()=>{
 const parent=path.resolve(os.tmpdir()),dir=await fs.mkdtemp(path.join(parent,'3d-box-budget-'));
 const sessionId=crypto.randomUUID(),previous=process.env.AGENT_RECURSION_LIMIT;
 const requests=[];let ignoreStop=false;
 const api=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body),index=requests.length;requests.push(request);
  const closing=request.tool_choice==='none'&&!ignoreStop;
  const delta=closing?{role:'assistant',content:'已达到本轮步数预算，保留已有场景；尚未完成全部检查。'}:{role:'assistant',tool_calls:[{index:0,id:`call-${index}`,type:'function',function:{name:'x_list',arguments:'{"path":"/"}'}}]};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const frame=(delta,finish_reason)=>`data: ${JSON.stringify({id:`model-${index}`,object:'chat.completion.chunk',created:1,model:'budget-test',choices:[{index:0,delta,finish_reason}]})}\n\n`;
  res.end(frame(delta,null)+frame({},closing?'stop':'tool_calls')+'data: [DONE]\n\n');
 });
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const model=new ChatOpenAI({model:'budget-test',apiKey:'local-test-key',configuration:{baseURL:`http://127.0.0.1:${api.address().port}/v1`},maxRetries:0});
 const makeContext=(current)=>{
  const events=[];
  return {dir,projectId:'budget-test',sessionId,runId:crypto.randomUUID(),messageId:crypto.randomUUID(),prompt:'检查项目文件',signal:new AbortController().signal,sceneJson:{entities:[],operations:[]},assets:[],current,events,emit:event=>events.push(event),async writeContext(context,contract){await fs.mkdir(path.join(dir,'workspace'),{recursive:true});await fs.writeFile(path.join(dir,'workspace','context.json'),JSON.stringify(context));await fs.writeFile(path.join(dir,'workspace','scene-api.txt'),contract);}};
 };
 try{
  process.env.AGENT_RECURSION_LIMIT='160';
  const empty=makeContext();
  await assert.rejects(runDeepAgent(empty,{model}),/尚未生成新的成功产物/);
  const checkpoint=await DiskSaver.open(path.join(dir,'sessions',sessionId,'checkpoint.bin'));
  const saved=await checkpoint.getTuple({configurable:{thread_id:sessionId}});
  assert(saved.metadata.step>100,'the expanded real graph must run beyond the previous 100-step ceiling');
  assert(empty.events.some(e=>e.type==='TOOL_CALL_END'));
  assert(!empty.events.some(e=>e.type==='RESULT'),'exhaustion must not fabricate a scene result');

  process.env.AGENT_RECURSION_LIMIT='60';
  const start=requests.length,existing={result:{task_id:'existing-success'},json:{entities:[]}},withResult=makeContext(existing);
  await runDeepAgent(withResult,{model});
  assert.notEqual(requests[start].tool_choice,'none','old checkpoint steps must not consume the new run budget');
  assert.equal(requests.at(-1).tool_choice,'none');
  assert(withResult.events.some(e=>e.type==='TEXT_MESSAGE_CONTENT'&&e.delta.includes('尚未完成')));
  assert.equal(withResult.current,existing,'the last successful scene must remain untouched');
  assert(!withResult.events.some(e=>e.type==='RESULT'));

  ignoreStop=true;
  const ignored=makeContext(existing);
  await assert.rejects(runDeepAgent(ignored,{model}),/模型在收尾时仍请求调用工具/);
  const finalCall=ignored.events.filter(e=>e.type==='TOOL_CALL_START').at(-1);
  assert(!ignored.events.some(e=>e.type==='TOOL_CALL_END'&&e.toolCallId===finalCall.toolCallId),'a provider ignoring stop must not execute another tool');
 }finally{
  if(previous===undefined)delete process.env.AGENT_RECURSION_LIMIT;else process.env.AGENT_RECURSION_LIMIT=previous;
  await new Promise(resolve=>api.close(resolve));
  assert(path.resolve(dir).startsWith(parent+path.sep));await fs.rm(dir,{recursive:true,force:true});
 }
});
