import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRendererService} from '../server/renderService.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
class Browser extends EventEmitter {
 constructor(id){super();this.id=id;this.connected=true;this.contexts=[];}
 isConnected(){return this.connected;}
 disconnect(){this.connected=false;this.emit('disconnected');}
 async close(){this.disconnect();}
 async newContext(){const context={browser:()=>this,closed:false,close:async()=>{context.closed=true;}};this.contexts.push(context);return context;}
}
const render=async(context)=>{await context.close();return context.browser().id;};

test('renderer shares launch, rebuilds disconnected browsers and ignores stale disconnect events',async()=>{
 const browsers=[];const service=createRendererService({launch:async()=>{const b=new Browser(browsers.length);browsers.push(b);return b;},render});
 try{
  assert.deepEqual(await Promise.all([service.renderCall('preview',{}),service.renderCall('compile',{})]),[0,0]);
  assert.equal(browsers.length,1);browsers[0].disconnect();
  assert.equal(await service.renderCall('preview',{}),1);
  browsers[0].emit('disconnected');
  assert.equal(await service.renderCall('preview',{}),1);assert.equal(browsers.length,2);
 }finally{await service.close();}
 assert.ok(browsers.every(b=>!b.isConnected()));
});

test('browser exit while creating a context or rendering retries once before publication',async()=>{
 for(const phase of ['context','render']){
  const browsers=[];let renders=0;
  const service=createRendererService({launch:async()=>{
   const b=new Browser(browsers.length);browsers.push(b);
   if(phase==='context'&&b.id===0)b.newContext=async()=>{b.disconnect();throw Error('browser exited');};
   return b;
  },render:async context=>{renders++;if(phase==='render'&&context.browser().id===0){context.browser().disconnect();throw Error('browser exited');}return render(context);}});
  try{assert.equal(await service.renderCall('compile',{}),1);assert.equal(browsers.length,2);assert.equal(renders,phase==='context'?1:2);}
  finally{await service.close();}
 }
});

test('renderer does not retry application errors and limits repeated browser exits',async()=>{
 let launches=0;const service=createRendererService({launch:async()=>new Browser(++launches),render:async()=>{throw Error('invalid scene');}});
 try{await assert.rejects(service.renderCall('compile',{}),/invalid scene/);assert.equal(launches,1);}
 finally{await service.close();}
 launches=0;const crashing=createRendererService({launch:async()=>new Browser(++launches),render:async context=>{context.browser().disconnect();throw Error('crash');}});
 try{await assert.rejects(crashing.renderCall('preview',{}),/crash/);assert.equal(launches,2);}
 finally{await crashing.close();}
});

test('launch failure can be retried by the next request',async()=>{
 let launches=0;const service=createRendererService({launch:async()=>{if(++launches===1)throw Error('launch failed');return new Browser(launches);},render});
 try{await assert.rejects(service.renderCall('preview',{}),/launch failed/);assert.equal(await service.renderCall('preview',{}),2);}
 finally{await service.close();}
});

test('cancelling a pending launch does not cancel the browser shared with other runs',async()=>{
 const pending=deferred(),controller=new AbortController(),browser=new Browser(1),reason=Error('cancelled');
 const service=createRendererService({launch:()=>pending.promise,render});
 try{
  const cancelled=service.renderCall('preview',{},controller.signal),other=service.renderCall('preview',{});
  controller.abort(reason);await assert.rejects(cancelled,e=>e===reason);
  pending.resolve(browser);assert.equal(await other,1);assert.equal(browser.contexts.length,1);
 }finally{pending.resolve(browser);await service.close();}
});

test('contexts arriving after cancellation are disposed without rendering',async()=>{
 const browser=new Browser(1),pending=deferred(),controller=new AbortController();let renders=0;
 browser.newContext=()=>pending.promise;
 const service=createRendererService({launch:async()=>browser,render:async()=>{renders++;}});
 try{
  const request=service.renderCall('preview',{},controller.signal);await tick();controller.abort(Error('cancelled'));
  await assert.rejects(request,/cancelled/);let closed=false;pending.resolve({close:async()=>{closed=true;}});await tick();
  assert.equal(closed,true);assert.equal(renders,0);
 }finally{await service.close();}
});

test('launch timeout discards a late browser without invalidating its replacement',async()=>{
 const pending=deferred(),old=new Browser(1),fresh=new Browser(2);let launches=0;
 const service=createRendererService({launch:()=>++launches===1?pending.promise:Promise.resolve(fresh),render,acquireTimeoutMs:25});
 try{
  await assert.rejects(service.renderCall('preview',{}),e=>e.code==='RENDERER_ACQUIRE_TIMEOUT');
  assert.equal(await service.renderCall('preview',{}),2);
  pending.resolve(old);await tick();assert.equal(old.isConnected(),false);
  assert.equal(await service.renderCall('preview',{}),2);assert.equal(launches,2);
 }finally{pending.resolve(old);await service.close();}
});

test('closing during launch disposes the late process and permits a fresh service request',async()=>{
 const pending=deferred(),browser=new Browser(1);let launches=0;
 const service=createRendererService({launch:()=>++launches===1?pending.promise:Promise.resolve(new Browser(2)),render});
 const request=service.renderCall('preview',{});await tick();await service.close();pending.resolve(browser);
 await assert.rejects(request,/渲染器已关闭/);assert.equal(browser.isConnected(),false);
 try{assert.equal(await service.renderCall('preview',{}),2);}finally{await service.close();}
});

test('a real renderer browser process can exit and rebuild within the same call',{timeout:45000},async()=>{
 const browsers=[];
 const service=createRendererService({render:async context=>{
  const browser=context.browser();browsers.push(browser);
  if(browsers.length===1){await browser.close();throw Error('browser exited during render');}
  await context.close();return {ok:true};
 }});
 try{assert.deepEqual(await service.renderCall('compile',{}),{ok:true});assert.equal(browsers.length,2);assert.notEqual(browsers[0],browsers[1]);}
 finally{await service.close();}
});
