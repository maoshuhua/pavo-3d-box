import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {BASE} from './config.js';

const candidates=[process.env.AGENT_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
async function launchBrowser(){
 try{
  let executablePath;for(const file of candidates){try{await fs.access(file);executablePath=file;break;}catch{}}
  return await chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 }catch(error){throw Error('无法启动本地渲染器；请设置 AGENT_BROWSER_EXECUTABLE 或运行 npx playwright install chromium。',{cause:error});}
}

// Waiting for a browser/context is cancellable too. If a context arrives after
// cancellation, dispose it rather than leaking an unobserved render session.
function acquire(promise,signal,timeoutMs,onAbandoned){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(fn,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
  const abort=()=>finish(reject,signal.reason||new DOMException('Cancelled','AbortError'));
  const timer=setTimeout(()=>finish(reject,Object.assign(Error('渲染器准备超过时限'),{code:'RENDERER_ACQUIRE_TIMEOUT'})),Math.max(1,timeoutMs));
  signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{
   if(settled){Promise.resolve().then(()=>onAbandoned?.(value)).catch(()=>{});return;}
   finish(resolve,value);
  },error=>finish(reject,error));
  if(signal?.aborted)abort();
 });
}

export function createRendererService({launch=launchBrowser,render=renderInContext,acquireTimeoutMs=90000}={}){
 let current;
 const invalidate=entry=>{entry.invalidated=true;if(current===entry)current=undefined;};
 function browserEntry(){
  if(current?.browser&&!current.browser.isConnected())invalidate(current);
  if(current)return current;
  const entry={invalidated:false};current=entry;
  entry.promise=Promise.resolve().then(launch).then(async browser=>{
   entry.browser=browser;
   browser.once('disconnected',()=>invalidate(entry));
   if(entry.invalidated){await browser.close().catch(()=>{});throw Error('渲染器已关闭，请重试');}
   return browser;
  }).catch(error=>{invalidate(entry);throw error;});
  return entry;
 }
 return {
  async renderCall(method,args,signal,{onTiming,onFrame}={}){
   const deadline=Date.now()+acquireTimeoutMs;
   // compile/preview only compute local values. Retry a crashed browser once,
   // before the caller can publish or commit any artifact.
   for(let attempt=0;attempt<2;attempt++){
    signal?.throwIfAborted();
    const entry=browserEntry();let context;
    try{
     let at=performance.now();const browser=await acquire(entry.promise,signal,deadline-Date.now());onTiming?.('acquireBrowser',performance.now()-at);
     signal?.throwIfAborted();
     if(!browser.isConnected())throw Error('渲染器连接已断开');
     at=performance.now();context=await acquire(browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1}),signal,deadline-Date.now(),value=>value.close());onTiming?.('context',performance.now()-at);
     signal?.throwIfAborted();
     return await render(context,method,args,signal,{timeoutMs:Math.max(1,deadline-Date.now()),onTiming,onFrame});
    }catch(error){
     if(context)await context.close().catch(()=>{});
     signal?.throwIfAborted();
     if(error.code==='RENDERER_ACQUIRE_TIMEOUT'){invalidate(entry);if(entry.browser)await entry.browser.close().catch(()=>{});throw error;}
     const disconnected=entry.browser&&!entry.browser.isConnected();
     if(disconnected)invalidate(entry);
     if(attempt===0&&disconnected&&!entry.closed)continue;
     throw error;
    }
   }
  },
  async close(){
   const entry=current;if(!entry)return;
   entry.closed=true;invalidate(entry);
   if(entry.browser)await entry.browser.close().catch(()=>{});
   // An in-flight launch sees invalidated and closes its result on arrival.
   else entry.promise.catch(()=>{});
  },
 };
}

const renderer=createRendererService();
export const renderCall=(...args)=>renderer.renderCall(...args);
export async function renderInContext(context,method,args,signal,{timeoutMs=90000,onTiming,onFrame}={}){
 const diagnostics=[];
 const record=(type,message)=>{if(diagnostics.length<12)diagnostics.push({type,message:String(message).slice(0,300)});};
 let stage='load',timedOut=false;
 const close=()=>context.close().catch(()=>{});signal?.addEventListener('abort',close,{once:true});
 const timer=setTimeout(()=>{timedOut=true;close();},timeoutMs);
 try {
  signal?.throwIfAborted();
  // Only the local scene runtime and uploaded assets can be loaded by this renderer.
  await context.route('**/*',route=>{const url=route.request().url();return url.startsWith(BASE+'/')||url.startsWith('data:')||url.startsWith('blob:')?route.continue():route.abort();});
  const page=await context.newPage();
  if(onFrame&&method==='previewBatch')await page.exposeFunction('__reportPreviewFrame',async frame=>{signal?.throwIfAborted();await onFrame(frame);});
  page.on('pageerror',error=>record('script',error.message));
  page.on('console',message=>{if(message.type()==='error')record('console',message.text());});
  page.on('requestfailed',request=>record('request',`${request.url()} : ${request.failure()?.errorText||'failed'}`));
  page.on('response',response=>{if(response.status()>=400)record('http',`${response.status()} ${response.url()}`);});
  let at=performance.now();await page.goto(BASE+'/runtime/renderer.html',{waitUntil:'domcontentloaded',timeout:30000});onTiming?.('pageLoad',performance.now()-at);
  stage='initialize';
  at=performance.now();await page.waitForFunction(()=>Boolean(window.sceneEngine),{},{timeout:20000});onTiming?.('initialize',performance.now()-at);
  stage=method;
  at=performance.now();const value=await page.evaluate(({method,args})=>window.sceneEngine[method](args),{method,args:{...args,...onFrame&&method==='previewBatch'?{streamFrames:true}:{}}});onTiming?.(method,performance.now()-at);
  for(const [name,ms] of Object.entries(value?.timings||{}))if(Number.isFinite(ms))onTiming?.(method+'.'+name,ms);
  signal?.throwIfAborted();return value;
 } catch(error){
  signal?.throwIfAborted();
  const detail=diagnostics.map(d=>`${d.type}: ${d.message}`).join('\n');
  const wrapped=new Error(`渲染器失败（${stage}${timedOut?'，超过执行时限':''}）：${String(error.message).slice(0,600)}${detail?'\n'+detail:''}`,{cause:error});
  wrapped.stage=stage;wrapped.diagnostics=diagnostics;if(timedOut)wrapped.code='RENDERER_TIMEOUT';throw wrapped;
 } finally {clearTimeout(timer);signal?.removeEventListener('abort',close);await close();}
}
export const closeRenderer=()=>renderer.close();
