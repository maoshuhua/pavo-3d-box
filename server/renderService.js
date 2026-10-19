import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import {BASE} from './config.js';

let browserPromise;
const candidates=[process.env.AGENT_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
async function getBrowser(){
 if(!browserPromise)browserPromise=(async()=>{let executablePath;for(const file of candidates){try{await fs.access(file);executablePath=file;break;}catch{}}
  return chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 })().catch(e=>{browserPromise=null;throw Error('无法启动本地渲染器；请设置 AGENT_BROWSER_EXECUTABLE 或运行 npx playwright install chromium。',{cause:e});});
 return browserPromise;
}
export async function renderCall(method,args,signal){
 signal?.throwIfAborted();
 const browser=await getBrowser(), context=await browser.newContext({viewport:{width:960,height:540},deviceScaleFactor:1});
 const close=()=>context.close().catch(()=>{});signal?.addEventListener('abort',close,{once:true});
 const timer=setTimeout(close,90000);
 try {
  signal?.throwIfAborted();
  // Only the local scene runtime and uploaded assets can be loaded by this renderer.
  await context.route('**/*',route=>{const url=route.request().url();return url.startsWith(BASE+'/')||url.startsWith('data:')||url.startsWith('blob:')?route.continue():route.abort();});
  const page=await context.newPage();
  await page.goto(BASE+'/runtime/renderer.html');
  await page.waitForFunction(()=>Boolean(window.sceneEngine),{},{timeout:20000});
  const value=await page.evaluate(({method,args})=>window.sceneEngine[method](args),{method,args});
  signal?.throwIfAborted();return value;
 } finally {clearTimeout(timer);signal?.removeEventListener('abort',close);await close();}
}
export async function closeRenderer(){if(browserPromise){const browser=await browserPromise;browserPromise=null;await browser.close();}}

