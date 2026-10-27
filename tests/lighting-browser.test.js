import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer as createViteServer} from 'vite';
import {createServer} from '../server/index.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {validateScene} from '../server/sceneSchema.js';

test('Agent lighting works without a settings panel and preserves undo, replay and browser restoration',{timeout:120000},async()=>{
 let backend,vite,browser;const database=new StudioDatabase(':memory:');
 try{
  const {app}=createServer({database});backend=http.createServer((req,res)=>{
   // This isolated test uses an ephemeral port; production accepts its configured origin.
   if(req.headers.origin===`http://127.0.0.1:${backend.address().port}`)delete req.headers.origin;
   app(req,res);
  });await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
  const port=backend.address().port;
  let executablePath;for(const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'])try{await fs.access(candidate);executablePath=candidate;break;}catch{}
  browser=await chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  await page.goto(`http://127.0.0.1:${port}/runtime/renderer.html`);await page.waitForFunction(()=>!!window.sceneEngine,{},{timeout:15000});
  const spec=validateScene({version:1,mode:'replace',objects:[{id:'subject',type:'mesh',geometry:{type:'box',args:[1,2,1]},transform:{position:[0,1,0]}},{id:'camera',type:'camera',transform:{position:[0,2,7]},lookAt:[0,1,0]}],lighting:[{id:'rig',presetId:'balanced',subjectIds:['subject']},{id:'custom',presetId:'custom',lights:[{id:'ambient',properties:{type:'ambient',color:'#fff0dd',intensity:.2}},{id:'point',position:[2,3,1],properties:{type:'point',intensity:8},keyframes:[{time:0,intensity:8},{time:2,intensity:18}]}]}],timeline:{version:1,duration:2,shots:[{cameraId:'camera',start:0,end:2}]}});
  const compiled=await page.evaluate(spec=>window.sceneEngine.compile({spec,assets:[]}),spec);
  assert.equal(compiled.json.entities.filter(e=>e.state.lightingRig).length,2);
  assert.equal(compiled.json.entities.filter(e=>e.state.light).length,5);
  const preview=await page.evaluate(b=>window.sceneEngine.preview({glb:b.glb,json:b.json,cameraId:'camera',time:1}),compiled);assert(preview.image.length>1000);
  // A patch compiled from the exported baseline must preserve every rig and light.
  const patched=await page.evaluate(async b=>{const blob=new Blob([Uint8Array.from(atob(b.glb),c=>c.charCodeAt(0))]);const url=URL.createObjectURL(blob);try{return await window.sceneEngine.compile({spec:{version:1,mode:'patch',objects:[],remove:[],animations:[],operations:[],cameraMotion:[]},baseUrl:url,baseJson:b.json,assets:[]});}finally{URL.revokeObjectURL(url);}},compiled);
  assert.equal(patched.json.entities.filter(e=>e.state.light).length,5);
  vite=await createViteServer({server:{port:0,host:'127.0.0.1'},logLevel:'error'});await vite.listen();
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/fixtures/lighting-browser/index.html`);await page.waitForFunction(()=>!!window.viewer,{},{timeout:15000});
  await page.evaluate(async()=>{const exported=await window.viewer.exportSceneGlb();window.baseline={bytes:await exported.blob.arrayBuffer(),json:window.viewer.exportSceneJson()};window.edits=[];});
  assert.equal(await page.getByRole('region',{name:'灯光设置',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'创建布光组',exact:true}).count(),0);
  await page.evaluate(()=>{
   const v=window.viewer,subject=window.details.objects.find(o=>o.kind==='mesh').entityId;
   v.setLighting({id:'agent-lighting',presetId:'balanced',subjectIds:[subject]});
   v.convertLightingToCustom('agent-lighting');
   v.select('agent-lighting:key');v.setSelectedLight({intensity:4.2});
  });
  assert.equal(await page.evaluate(()=>window.details.transform.light.intensity),4.2);
  const result=await page.evaluate(async()=>{
   const v=window.viewer,rigId=window.details.lightingRigs[0].config.id;
   v.undo();const undone=v.exportSceneJson().entities.find(e=>e.state.light?.kind==='area').state.light.intensity;
   v.redo();const redone=v.exportSceneJson().entities.find(e=>e.state.light?.kind==='area').state.light.intensity;
   const json=v.exportSceneJson(),exported=await v.exportSceneGlb(),bytes=await exported.blob.arrayBuffer();
   await v.replaceAgentScene({bytes,json});
   const restored=v.exportSceneJson(),rig=restored.entities.find(e=>e.id===rigId).state.lightingRig;
   v.setLightingLocked(rigId,true);let lockWorks=false;try{v.setLighting({...rig.config,intensity:2});}catch{lockWorks=true;}v.setLightingLocked(rigId,false);
   const operation=window.edits.filter(e=>e.kind==='lighting.rig.set').at(-1);
   v.removeLighting(rigId);await v.replayOperation(operation);v.topology();
   const replayed=v.exportSceneJson().entities.find(e=>e.id===rigId).state.lightingRig;
   return {undone,redone,rig,replayed,lockWorks,errors:window.errors,operations:window.edits.filter(e=>e.kind==='lighting.rig.set').length};
  });
  assert.equal(result.undone,3);assert.equal(result.redone,4.2);assert.equal(result.rig.config.presetId,'custom');assert.equal(result.rig.lights[0].properties.intensity,4.2);assert.equal(result.replayed.lights[0].properties.intensity,4.2);assert(result.lockWorks);assert.deepEqual(result.errors,[]);assert(result.operations>=5);assert.deepEqual(errors,[]);
  const manual=await page.evaluate(()=>{
   const v=window.viewer,id=window.viewer.exportSceneJson().entities.find(e=>e.state.lightingRig).id;
   v.addLightingLight(id,'point');
   const custom=v.getCustomLightingConfig(id),point=custom.lights.find(l=>l.properties.type==='point');
   point.keyframes=[{time:0,position:[0,2,0],intensity:1},{time:2,position:[2,2,0],intensity:3}];v.setLighting(custom);v.select(id+':'+point.id);v.seek(1);
   const sampled=window.details.transform.light.intensity;
   v.setTransform('position',0,7);v.flushSceneEdits();
   const moved=v.exportSceneJson().entities.find(e=>e.id===id+':'+point.id).state.transform.position[0];
   v.undo();v.seek(1);const undone=v.exportSceneJson().entities.find(e=>e.id===id+':'+point.id).state.transform.position[0];
   return {sampled,moved,undone};
  });
  assert.equal(manual.sampled,2);assert.equal(manual.moved,7);assert.equal(manual.undone,1);
  await page.evaluate(()=>{
   const light=window.viewer.exportSceneJson().entities.find(e=>e.id===window.details.objects.find(o=>o.id===window.details.selectedId).entityId);
   window.viewer.setLightingLightLocked(light.state.light.rigId,light.id,true);
   window.viewer.setLightingLightLocked(light.state.light.rigId,light.id,false);
  });
  const recovered=await page.evaluate(async()=>{
   const v=window.viewer,json=v.exportSceneJson(),metadata=v.exportLocalMetadata(),operations=window.edits.map((op,i)=>({...op,sequence:i+1,status:'accepted',operationId:'lighting-test-'+i}));
   await v.replaceAgentScene(window.baseline);
   await v.restoreProject(undefined,{json,metadata,operations});
   const entity=v.exportSceneJson().entities.find(e=>e.state.lightingRig);return entity.state.lightingRig;
  });
  assert.equal(recovered.config.presetId,'custom');assert.equal(recovered.lights[0].properties.intensity,4.2);assert.equal(recovered.lights.length,4);
  await page.evaluate(()=>window.viewer.select(window.details.lightingRigs[0]?.config.id||window.viewer.exportSceneJson().entities.find(e=>e.state.lightingRig).id));
  await page.waitForFunction(()=>window.details.transform?.lightingRig?.config.presetId==='custom');
  await fs.mkdir('test-output/lighting-browser',{recursive:true});
  await page.screenshot({path:'test-output/lighting-browser/editor.png'});
 }finally{await browser?.close();await vite?.close();if(backend)await new Promise(resolve=>backend.close(resolve));database.close();}
});
