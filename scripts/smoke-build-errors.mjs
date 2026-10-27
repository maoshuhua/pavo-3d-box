import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createSceneTools} from '../server/tools.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {projectDir} from '../server/storage.js';
import {BASE} from '../server/config.js';
import {closeRenderer} from '../server/renderService.js';
import {sceneSource} from '../tests/fixture.js';

const output=path.resolve('output/playwright/build-error-smoke');
await fs.mkdir(output,{recursive:true});
assert.equal((await fetch(BASE+'/api/agent/health')).ok,true);
const database=new StudioDatabase(),projectId=crypto.randomUUID(),runId=crypto.randomUUID();
database.create({name:'构建错误提示验证'},null,projectId);
const sessionId=database.createSession({projectId});
database.update({studioUuid:projectId,config:JSON.stringify({animationPreview:{version:1,sessionId}})});
database.db.prepare("INSERT INTO runs VALUES(?,?,?,'completed',?,?)").run(runId,sessionId,projectId,Date.now(),Date.now());
const dir=projectDir(projectId),events=[],results=[];
await fs.mkdir(path.join(dir,'workspace'),{recursive:true});
const tools=createSceneTools({dir,projectId,signal:new AbortController().signal,assets:[],sceneJson:{version:1,entities:[],operations:[]},emit:event=>{events.push(event);database.recordEvent(sessionId,runId,event);}});
async function build(label,source){
 await fs.writeFile(path.join(dir,'workspace','scene.js'),source);
 const result=await tools.find(t=>t.name==='build_3D_scene').invoke({source:'/scene.js'});
 const parsed=typeof result==='string'?JSON.parse(result):result;
 if(parsed.logId){const full=JSON.parse(await fs.readFile(path.join(dir,'errors',parsed.logId+'.json'),'utf8'));assert.equal(full.toolName,'build_3D_scene');if(parsed.issueCount)assert.equal(full.issues.length,parsed.issueCount);}
 results.push({label,...parsed,responseBytes:Buffer.byteLength(JSON.stringify(parsed))});
 console.log(label,parsed.status,parsed.error||parsed.task_id);
 return parsed;
}
try{
 const schema=await build('repeated-schema',`function build(){return {version:1,animations:[{id:'bad',name:'bad',duration:1,tracks:[{entityId:'cube',property:'position',times:[0],values:Array.from({length:36000},()=>[1,2,3])}]}]}}`);
 assert.equal(schema.issueCount,36000);assert.equal(schema.groups.length,1);assert.ok(Buffer.byteLength(JSON.stringify(schema))<8192);
 const geometry=await build('geometry',`function build(){return {version:1,objects:[{id:'wheel',geometry:{type:'cylinder',args:[1,1,2,300]}}]}}`);
 assert.match(geometry.error,/object=wheel.*args\[3\]=300/);
 const runtime=await build('renderer',`function build(){return {version:1,mode:'replace',objects:[{id:'cube',type:'mesh',parentId:'missing-parent',geometry:{type:'box',args:[1,1,1]}}]}}`);
 assert.equal(runtime.status,'error');assert.equal(runtime.stage,'compile');assert.match(runtime.error,/Parent not found/);
 const good=await build('valid',sceneSource);assert.equal(good.status,'completed');assert.ok((await fetch(good.glb_url)).ok);
 const preview=await tools.find(t=>t.name==='preview_3D_scene').invoke({camera_id:'camera',time:0});
 assert.ok(preview);
 const history=database.history(projectId,sessionId);
 assert.equal(history.messages.filter(m=>m.toolErrorDetails?.logId).length,3);
 await fs.writeFile(path.join(output,'events.json'),JSON.stringify(events,null,2));
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({projectId,sessionId,runId,url:`http://127.0.0.1:5173/animation-preview?projectId=${projectId}`,results},null,2));
 console.log(JSON.stringify({projectId,summaryBytes:results[0].responseBytes,logId:schema.logId,url:`http://127.0.0.1:5173/animation-preview?projectId=${projectId}`}));
}finally{await closeRenderer();database.close();}
