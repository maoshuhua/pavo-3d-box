import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {ChatOpenAI} from '@langchain/openai';
import {runDeepAgent} from '../server/agent.js';

async function fixture(){
 const root=path.resolve('test-output','generation-deadline');await fs.mkdir(root,{recursive:true});
 const dir=await fs.mkdtemp(path.join(root,'run-')),requests=[];let nextRequest;
 const api=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  requests.push(JSON.parse(body));
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.flushHeaders();
  res.write('data: '+JSON.stringify({id:'heartbeat-model',object:'chat.completion.chunk',created:1,model:'heartbeat-fixture',choices:[{index:0,delta:{role:'assistant'},finish_reason:null}]})+'\n\n');
  const timer=setInterval(()=>res.write(': heartbeat\n\n'),25);
  res.on('close',()=>clearInterval(timer));
  nextRequest?.();nextRequest=undefined;
 });
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
 const model=new ChatOpenAI({model:'heartbeat-fixture',apiKey:'fixture-key',configuration:{baseURL:`http://127.0.0.1:${api.address().port}/v1`},maxRetries:0,timeout:10000});
 const makeContext=current=>{
  const events=[],controller=new AbortController();
  const ctx={dir,projectId:'deadline-fixture',sessionId:crypto.randomUUID(),runId:crypto.randomUUID(),messageId:crypto.randomUUID(),prompt:'检查当前项目',signal:controller.signal,sceneJson:{entities:[],operations:[]},assets:[],current,events,emit:event=>events.push(event),async writeContext(context,contract){await fs.mkdir(path.join(dir,'workspace'),{recursive:true});await fs.writeFile(path.join(dir,'workspace','context.json'),JSON.stringify(context));await fs.writeFile(path.join(dir,'workspace','scene-api.txt'),contract);}};
  return {ctx,controller};
 };
 return {dir,model,requests,makeContext,entered:()=>new Promise(resolve=>{nextRequest=resolve;}),async close(){api.closeAllConnections();await new Promise(resolve=>api.close(resolve));await fs.rm(dir,{recursive:true,force:true});}};
}

test('generation deadline interrupts a live heartbeat model stream and preserves cancellation',{timeout:20000},async t=>{
 const previous=process.env.AGENT_GENERATION_TIMEOUT_MS;
 process.env.AGENT_GENERATION_TIMEOUT_MS='1000';
 try{
  await t.test('saved result returns partial within five seconds',async()=>{
   const setup=await fixture(),saved={result:{task_id:'last-success'},json:{entities:[]}}, {ctx,controller}=setup.makeContext(saved),originalSignal=ctx.signal,started=Date.now();
   try{
    const result=await runDeepAgent(ctx,{model:setup.model});
    assert(Date.now()-started<5000);assert.deepEqual(result,{outcome:'partial'});
    assert.equal(ctx.current,saved);assert.equal(ctx.signal,originalSignal);assert.equal(controller.signal.aborted,false);
    assert.equal(ctx.director.snapshot().outcome,'partial');
    assert.equal(setup.requests.length,1);assert.equal(setup.requests[0].stream,true);
    assert(ctx.events.some(event=>event.type==='MODEL_STATUS'&&event.status==='running'));
    assert(ctx.events.some(event=>event.type==='TEXT_MESSAGE_CONTENT'&&event.delta.includes('预算已结束')));
    assert(!ctx.events.some(event=>event.type==='RESULT'));
   }finally{controller.abort();await setup.close();}
  });
  await t.test('no new result rejects with the budget reason within five seconds',async()=>{
   const setup=await fixture(),{ctx,controller}=setup.makeContext(null),originalSignal=ctx.signal,started=Date.now();
   try{
    await assert.rejects(runDeepAgent(ctx,{model:setup.model}),/制作预算已结束/);
    assert(Date.now()-started<5000);assert.equal(ctx.signal,originalSignal);assert.equal(controller.signal.aborted,false);
    assert.equal(ctx.current,null);assert.equal(setup.requests.length,1);
    assert(!ctx.events.some(event=>event.type==='RESULT'));
   }finally{controller.abort();await setup.close();}
  });
  await t.test('explicit in-flight caller abort is never converted to partial',async()=>{
   const setup=await fixture(),saved={result:{task_id:'last-success'},json:{entities:[]}}, {ctx,controller}=setup.makeContext(saved),originalSignal=ctx.signal;
   try{
    const entered=setup.entered(),running=runDeepAgent(ctx,{model:setup.model});running.catch(()=>{});
    await Promise.race([entered,running.then(()=>{throw Error('Model stream did not open');})]);
    const reason=new Error('user explicitly stopped this run'),started=Date.now();controller.abort(reason);
    await assert.rejects(running,error=>error===reason||error.name==='AbortError'||/user explicitly stopped|abort/i.test(error.message));
    assert(Date.now()-started<5000);assert.equal(ctx.signal,originalSignal);assert.equal(controller.signal.reason,reason);
    assert.equal(ctx.current,saved);assert.equal(ctx.director.snapshot().outcome,'cancelled');
    assert(!ctx.events.some(event=>event.type==='TEXT_MESSAGE_CONTENT'&&event.delta.includes('预算已结束')));
    assert(!ctx.events.some(event=>event.type==='RESULT'));
   }finally{controller.abort();await setup.close();}
  });
 }finally{if(previous===undefined)delete process.env.AGENT_GENERATION_TIMEOUT_MS;else process.env.AGENT_GENERATION_TIMEOUT_MS=previous;}
});
