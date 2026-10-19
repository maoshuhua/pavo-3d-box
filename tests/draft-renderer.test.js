import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {chromium} from 'playwright';
import {ROOT} from '../server/config.js';
import {renderCall,closeRenderer} from '../server/renderService.js';

const fixture=()=>({version:1,mode:'replace',remove:[],operations:[],
 objects:[
  {id:'subject',type:'mesh',name:'Subject',geometry:{type:'box',args:[1,1,1]},material:{color:'#dd3311'}},
  {id:'wide',type:'camera',name:'Wide',camera:{fov:50,aspect:16/9},transform:{position:[0,0,6]},lookAt:[0,0,0]},
  {id:'close',type:'camera',name:'Close',camera:{fov:35,aspect:16/9},transform:{position:[0,0,6]},lookAt:[0,0,0]},
 ],world:{type:'solid',color:[.1,.15,.2],strength:2},
 timeline:{version:1,duration:2,shots:[{cameraId:'wide',start:0,end:1},{cameraId:'close',start:1,end:2}]},
 animations:[{id:'move',name:'Move',duration:2,tracks:[{entityId:'subject',property:'position',times:[0,1,2],values:[-1,0,0,0,0,0,1,0,0]}]}],
});

async function executable(){
 for(const candidate of [process.env.AGENT_BROWSER_EXECUTABLE,'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean))
  try{await fs.access(candidate);return candidate;}catch{}
}

test('draft frames share the production scene path without temporary GLB; final frames load once per batch',{timeout:120000},async()=>{
 const app=express();let builtBytes;
 app.get('/runtime/renderer.html',(_,res)=>res.sendFile(path.join(ROOT,'server','renderer.html')));
 app.get('/runtime/renderer.js',(_,res)=>res.sendFile(path.join(ROOT,'server','renderer.js')));
 app.get('/baseline.glb',(_,res)=>res.type('model/gltf-binary').send(builtBytes));
 app.use('/src',express.static(path.join(ROOT,'src')));
 app.use('/three',express.static(path.join(ROOT,'node_modules','three')));
 app.use('/draco',express.static(path.join(ROOT,'public','draco')));
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const baseUrl=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:await executable(),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:960,height:540}});
  await page.goto(baseUrl+'/runtime/renderer.html');
  await page.waitForFunction(()=>Boolean(window.sceneEngine));
  await page.evaluate(async()=>{
   const {GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');
   const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
   window.renderCounts={exports:0,loads:0};
   const exportOriginal=GLTFExporter.prototype.parseAsync,loadOriginal=GLTFLoader.prototype.parseAsync;
   GLTFExporter.prototype.parseAsync=function(...args){window.renderCounts.exports++;return exportOriginal.apply(this,args);};
   GLTFLoader.prototype.parseAsync=function(...args){window.renderCounts.loads++;return loadOriginal.apply(this,args);};
  });
  const args={spec:fixture(),assets:[],frames:[{time:0},{time:1},{time:2}]};
  const draft=await page.evaluate(args=>window.sceneEngine.draftPreview(args),args);
  assert.equal(draft.target,'draft');
  assert.deepEqual(draft.frames.map(f=>[f.cameraId,f.time,f.target]),[['wide',0,'draft'],['close',1,'draft'],['close',2,'draft']]);
  assert(draft.frames.every(f=>Buffer.from(f.image,'base64').subarray(1,4).toString()==='PNG'));
  assert.notEqual(draft.frames[1].image,draft.frames[2].image,'absolute animation time must change pixels');
  assert.deepEqual(await page.evaluate(()=>window.renderCounts),{exports:0,loads:0});

  await assert.rejects(page.evaluate(args=>window.sceneEngine.draftPreview(args),{...args,frames:[{cameraId:'missing',time:0}]}),/Preview camera not found: missing/);
  await assert.rejects(page.evaluate(args=>window.sceneEngine.draftPreview(args),{...args,frames:[{time:2.1}]}),/Time exceeds timeline duration/);
  const built=await page.evaluate(args=>window.sceneEngine.compile(args),args);
  builtBytes=Buffer.from(built.glb,'base64');
  assert.equal(builtBytes.readUInt32LE(0),0x46546c67);
  assert.equal(built.triangles,12);
  assert.deepEqual(await page.evaluate(()=>window.renderCounts),{exports:1,loads:0},'compile exports the directly assembled graph once');
  const final=await page.evaluate(args=>window.sceneEngine.previewBatch(args),{glb:built.glb,json:built.json,frames:args.frames});
  assert.equal(final.target,'build');
  assert.deepEqual(await page.evaluate(()=>window.renderCounts),{exports:1,loads:1},'three final frames parse one GLB');
  assert.deepEqual(final.frames.map(f=>f.cameraId),draft.frames.map(f=>f.cameraId));
  assert.deepEqual(final.frames.map(f=>[f.width,f.height]),draft.frames.map(f=>[f.width,f.height]));
  assert.deepEqual(final.frames.map(f=>f.image),draft.frames.map(f=>f.image),'draft and exported graph must evaluate the same camera, world and motion');
  await assert.rejects(page.evaluate(args=>window.sceneEngine.preview(args),{glb:built.glb,json:built.json,cameraId:'missing',time:0}),/Preview camera not found: missing/);

  const patched={spec:{version:1,mode:'patch',objects:[],remove:[],animations:[],operations:[
   {entityId:'subject',kind:'object.material.set',payload:{material:{baseColor:[0,0,1,1],metallic:0,roughness:.5}}},
   {entityId:'world',kind:'world.settings.set',payload:{settings:{type:'solid',color:[.4,.1,.1],strength:1}}},
  ]},baseUrl:baseUrl+'/baseline.glb',baseJson:built.json,assets:[],frames:[{time:1.5}]};
  const patchedDraft=await page.evaluate(args=>window.sceneEngine.draftPreview(args),patched);
  assert.equal(patchedDraft.frames[0].cameraId,'close');
  assert.equal(patchedDraft.json.entities.find(e=>e.id==='subject').state.color,'#0000ff');
  assert.deepEqual(patchedDraft.json.entities.find(e=>e.kind==='world').state.settings.color,[.4,.1,.1]);
  assert.equal(patchedDraft.json.entities.find(e=>e.kind==='timeline').state.timeline.duration,2);
  const counts=await page.evaluate(()=>window.renderCounts);
  assert.equal(counts.exports,1,'patch draft may load its baseline but must never export');

  // Exercise production renderCall dispatch and its single-context batch path,
  // using an isolated local test origin rather than a running project server.
  const isolated=await renderCall('draftPreview',args,undefined,{baseUrl});
  assert.equal(isolated.frames.length,3);assert.equal(isolated.target,'draft');
  await assert.rejects(renderCall('unknown',{},undefined,{baseUrl}),/Unknown scene renderer method/);
 }finally{
  await closeRenderer();await browser?.close();await new Promise(resolve=>server.close(resolve));
 }
});
