import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatOpenAI} from '@langchain/openai';
import {modelPolicy,deadlineFetch,ModelDeadlineError} from '../server/modelPolicy.js';

process.env.LANGSMITH_TRACING='false';process.env.LANGCHAIN_TRACING_V2='false';

test('provider extensions are explicit, configurable, and absent on unknown providers',()=>{
 assert.deepEqual(modelPolicy('other-model',{}),{maxTokens:32768,timeout:180000,maxRetries:0});
 assert.deepEqual(modelPolicy('deepseek-v4.1-flash',{}).modelKwargs,{reasoning_effort:'none'});
 assert.equal(modelPolicy('deepseek-v4.1-flash',{AGENT_MODEL_PROFILE:'quality'}).modelKwargs.reasoning_effort,'high');
 assert.equal(modelPolicy('deepseek-v4.1-flash',{AGENT_REASONING_EFFORT:'medium'}).modelKwargs.reasoning_effort,'medium');
 assert.equal(modelPolicy('deepseek-v4.1-flash',{AGENT_MODEL_CAPABILITIES:'{"deepseek-v4.1-flash":{}}'}).modelKwargs,undefined);
 assert.throws(()=>modelPolicy('unknown',{AGENT_REASONING_EFFORT:'none'}),/not declared supported/);
 assert.throws(()=>modelPolicy('unknown',{AGENT_MODEL_CAPABILITIES:'broken'}),/JSON object/);
 assert.equal(modelPolicy('known',{AGENT_MAX_TOKENS:'NaN',AGENT_MODEL_TIMEOUT_MS:'0'}).timeout,180000);
 assert.equal(modelPolicy('custom',{AGENT_MODEL_CAPABILITIES:'{"custom":{"reasoningEfforts":["low"]}}',AGENT_REASONING_EFFORT:'low',AGENT_MAX_TOKENS:'8192'}).maxTokens,8192);
});

test('actual ChatOpenAI transport sends the declared DeepSeek wire parameter',{timeout:10000},async()=>{
 let request;
 const fetchImpl=async(_input,init)=>{
  request=JSON.parse(init.body);
  return new Response(JSON.stringify({id:'fixture',object:'chat.completion',created:1,model:'deepseek-v4.1-flash',choices:[{index:0,message:{role:'assistant',content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{headers:{'Content-Type':'application/json'}});
 };
 const policy=modelPolicy('deepseek-v4.1-flash',{});
 const model=new ChatOpenAI({model:'deepseek-v4.1-flash',apiKey:'fixture-key',...policy,configuration:{baseURL:'http://model.invalid/v1',fetch:deadlineFetch(3000,{fetchImpl})}});
 await model.invoke('test');
 assert.equal(request.reasoning_effort,'none');assert.equal(request.max_tokens,32768);
 assert.equal(request.thinking,undefined);
});

test('whole-response deadline stops an SSE stream that keeps sending heartbeats',{timeout:5000},async()=>{
 let heartbeat,cancelled=false;const events=[];
 const fetchImpl=async()=>new Response(new ReadableStream({start(controller){heartbeat=setInterval(()=>controller.enqueue(new TextEncoder().encode(': heartbeat\n\n')),10);},cancel(){cancelled=true;clearInterval(heartbeat);}}),{headers:{'Content-Type':'text/event-stream'}});
 try{
  const response=await deadlineFetch(120,{fetchImpl,onFinish:event=>events.push(event)})('http://model.invalid');
  await assert.rejects(response.text(),error=>error instanceof ModelDeadlineError&&error.code==='MODEL_CALL_TIMEOUT');
  assert.equal(cancelled,true);assert.equal(events.length,1);assert.equal(events[0].outcome,'timeout');
  assert(events[0].elapsedMs>=100&&events[0].elapsedMs<1000);
 }finally{clearInterval(heartbeat);}
});

test('deadline includes waiting for headers and preserves caller cancellation',{timeout:5000},async()=>{
 await assert.rejects(deadlineFetch(60,{fetchImpl:()=>new Promise(()=>{})})('http://model.invalid'),ModelDeadlineError);
 const aborter=new AbortController(),reason=new Error('explicit stop');
 let cancelled=false;
 const response=await deadlineFetch(1500,{fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))})('http://model.invalid',{signal:aborter.signal});
 const reading=response.text();aborter.abort(reason);
 await assert.rejects(reading,error=>error===reason);assert.equal(cancelled,true);
});

test('a completed body clears the deadline and records one completion',{timeout:5000},async()=>{
 const events=[];
 const response=await deadlineFetch(60,{fetchImpl:async()=>new Response('complete'),onFinish:event=>events.push(event)})('http://model.invalid');
 assert.equal(await response.text(),'complete');
 await new Promise(resolve=>setTimeout(resolve,90));
 assert.equal(events.length,1);assert.equal(events[0].outcome,'completed');
});
