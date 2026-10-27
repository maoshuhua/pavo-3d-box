import test from 'node:test';
import assert from 'node:assert/strict';
import {renderInContext} from '../server/renderService.js';

test('renderer reports initialization stage, script and HTTP failures and closes context',async()=>{
 const handlers={};let closed=false;
 const page={on:(name,fn)=>handlers[name]=fn,goto:async(_,options)=>{assert.equal(options.waitUntil,'domcontentloaded');handlers.pageerror(Error('module failed'));handlers.response({status:()=>404,url:()=>'/src/missing.js'});handlers.requestfailed({url:()=>'/src/blocked.js',failure:()=>({errorText:'blocked'})});},waitForFunction:async()=>{throw Error('Timeout 20000ms exceeded');}};
 await assert.rejects(()=>renderInContext({route:async()=>{},newPage:async()=>page,close:async()=>{closed=true;}},'compile',{}),error=>{assert.equal(error.stage,'initialize');assert.equal(error.diagnostics.length,3);assert.match(error.message,/module failed/);assert.match(error.message,/404/);return true;});
 assert.equal(closed,true);
});

test('renderer caps diagnostics and preserves abort reason',async()=>{
 const controller=new AbortController(),reason=Error('cancelled');let closed=0;
 const handlers={},page={on:(name,fn)=>handlers[name]=fn,goto:async()=>{for(let i=0;i<30;i++)handlers.pageerror(Error('x'.repeat(1000)));},waitForFunction:async()=>{},evaluate:async()=>{controller.abort(reason);throw Error('page closed');}};
 await assert.rejects(()=>renderInContext({route:async()=>{},newPage:async()=>page,close:async()=>{closed++;}},'compile',{},controller.signal),error=>error===reason);
 assert.ok(closed>0);
});


test('streamed frame callbacks arrive before a timed-out context closes and expose a typed timeout',async()=>{
 let callback,closed=false;const saved=[];
 const page={on:()=>{},exposeFunction:async(_name,fn)=>{callback=fn;},goto:async()=>{},waitForFunction:async()=>{},evaluate:async()=>{
  await callback({cameraId:'camera',time:0,image:'eA==',width:960,height:540});
  await new Promise(resolve=>setTimeout(resolve,20));throw Error('context closed');
 }};
 await assert.rejects(renderInContext({route:async()=>{},newPage:async()=>page,close:async()=>{closed=true;}},'previewBatch',{},undefined,{timeoutMs:10,onFrame:f=>saved.push(f)}),e=>e.code==='RENDERER_TIMEOUT'&&e.stage==='previewBatch');
 assert.equal(saved.length,1);assert(closed);
});
