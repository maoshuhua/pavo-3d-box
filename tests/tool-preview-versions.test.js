import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import {BASE,PORT,ROOT} from '../server/config.js';
import {projectDir,sha256} from '../server/storage.js';
import {CodingTodo} from '../server/codingTodo.js';
import {createSceneTools} from '../server/tools.js';
import {renderCall,closeRenderer} from '../server/renderService.js';

let renderHost;
before(async()=>{
 try{if((await fetch(BASE+'/api/agent/health')).ok)return;}catch{}
 const app=express();
 app.get('/api/agent/health',(_,res)=>res.json({ok:true}));
 app.get('/runtime/renderer.html',(_,res)=>res.sendFile(path.join(ROOT,'server','renderer.html')));
 app.get('/runtime/renderer.js',(_,res)=>res.sendFile(path.join(ROOT,'server','renderer.js')));
 app.use('/src',express.static(path.join(ROOT,'src')));
 app.use('/three',express.static(path.join(ROOT,'node_modules','three')));
 app.use('/draco',express.static(path.join(ROOT,'public','draco')));
 app.get('/artifacts/:projectId/:taskId/:file',(req,res)=>res.sendFile(path.join(projectDir(req.params.projectId),'artifacts',req.params.taskId,req.params.file)));
 const candidate=http.createServer(app);
 try{await new Promise((resolve,reject)=>{candidate.once('error',reject);candidate.listen(PORT,'127.0.0.1',resolve);});renderHost=candidate;}
 catch(error){if(error.code!=='EADDRINUSE'||!(await fetch(BASE+'/api/agent/health')).ok)throw error;}
});
after(async()=>{await closeRenderer();if(renderHost)await new Promise(resolve=>renderHost.close(resolve));});

const spec=()=>({version:1,mode:'replace',objects:[
 {id:'subject',type:'mesh',name:'Subject',geometry:{type:'box',args:[1,1,1]},material:{color:'#dd3311'},transform:{position:[0,0,0]}},
 {id:'camera',type:'camera',name:'Camera',camera:{fov:50,aspect:16/9},transform:{position:[0,1,6]},lookAt:[0,0,0]},
],remove:[],animations:[],operations:[],world:{type:'solid',color:[.1,.15,.2],strength:2},timeline:{version:1,duration:2,shots:[{cameraId:'camera',start:0,end:2}]}});
const sourceFor=value=>'function build(ctx){return '+JSON.stringify(value)+';}';
const plan={intent:'检查单个物体与单机位的版本一致性',duration:2,aspectRatio:'16:9',subjects:[],constraints:[],shots:[{id:'shot',start:0,end:2,cameraRef:'camera',purpose:'检查版本',subjects:[],action:'显示几何体',framing:'全景',movement:'固定',criterionIds:['structure']}],criteria:[{id:'structure',description:'正确机位、切镜、画幅与时长',kind:'structural',required:true,shotIds:['shot']}]};
const decode=value=>typeof value==='string'?JSON.parse(value):value?.content?JSON.parse(value.content):value;

async function fixture(t,sceneJson={version:1,entities:[],operations:[]},baseUrl){
 const projectId='preview-version-'+crypto.randomUUID(),dir=projectDir(projectId),events=[];
 await fs.mkdir(path.join(dir,'workspace'),{recursive:true});
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const ctx={projectId,dir,runId:crypto.randomUUID(),sessionId:crypto.randomUUID(),sceneJson,baseUrl,assets:[],signal:new AbortController().signal,emit:event=>events.push(event)};
 ctx.director=await CodingTodo.open(ctx);
 const tools=new Map(createSceneTools(ctx).map(tool=>[tool.name,tool]));
 const invoke=async(name,args)=>decode(await tools.get(name).invoke(args));
 assert.equal((await invoke('coding_todo_write',{op:'set_plan',requestId:'plan',plan})).status,'completed');
 return {ctx,invoke,events};
}
async function pixels(ctx,frame){return fs.readFile(path.join(ctx.dir,'artifacts',frame.task_id,new URL(frame.image_url).pathname.split('/').at(-1)));}

test('todo gateway schema has an object root while operation validation remains strict',async t=>{
 const {ctx,invoke}=await fixture(t),todo=createSceneTools(ctx).find(tool=>tool.name==='coding_todo_write');
 const schema=convertToOpenAITool(todo).function.parameters;
 assert.equal(schema.type,'object');assert(!schema.anyOf&&!schema.oneOf,'function root must be accepted by object-only compatible gateways');
 assert.deepEqual(schema.properties.op.enum,['read','set_plan','update_tasks','record_reviews']);
 const revision=ctx.director.state.revision;
 const invalid=await invoke('coding_todo_write',{op:'set_plan',requestId:'missing-plan'});
 assert.equal(invalid.status,'error');assert.equal(ctx.director.state.revision,revision,'provider-compatible schema must not allow an incomplete mutation');
});

test('failed scratch preview does not hide edits to the accepted scene source',{timeout:90000},async t=>{
 const {ctx,invoke}=await fixture(t),source=sourceFor(spec());
 assert.equal((await invoke('x_write',{path:'/scene.js',content:source})).status,'completed');
 const built=await invoke('build_3D_scene',{});assert.equal(built.status,'completed',built.error);
 const preview=await invoke('preview_3D_scene',{target:'build',frames:built.required_frames});assert.equal(preview.status,'completed',preview.error);
 assert.equal((await invoke('coding_todo_write',{op:'record_reviews',requestId:'accept',reviews:[{criterionId:'structure',verdict:'pass',evidenceIds:[built.evidence_id],observation:'服务端结构与当前 GLB 检查帧齐全'}]})).status,'completed');
 assert.equal(ctx.director.ready().ready,true);
 const acceptedHash=ctx.director.state.currentSource.sourceHash;
 assert.equal((await invoke('x_write',{path:'/scratch.js',content:'function build(){ invalid syntax !!! }'})).status,'completed');
 const failed=await invoke('preview_3D_scene',{target:'draft',source:'/scratch.js',time:0});
 assert.equal(failed.status,'error');assert.equal(ctx.activeSourcePath,'/scene.js');
 assert.equal(ctx.director.ready().ready,true,'a failed scratch experiment must not change accepted source identity');
 const changed=source.replace('#dd3311','#0066ff');
 assert.equal((await invoke('x_edit',{path:'/scene.js',old_string:'#dd3311',new_string:'#0066ff'})).status,'completed');
 assert.equal(ctx.director.state.currentSource.sourceHash,sha256(changed));
 assert.notEqual(ctx.director.state.currentSource.sourceHash,acceptedHash);
 assert.equal(ctx.director.state.currentBuild.sourceHash,acceptedHash);
 assert.equal(ctx.director.ready().ready,false,'editing accepted source must invalidate its old delivery evidence');
});

test('patch draft and build always evaluate against the frozen run input',{timeout:90000},async t=>{
 const initial=await renderCall('compile',{spec:spec(),assets:[]});
 const {ctx,invoke}=await fixture(t,initial.json);
 const baselineDir=path.join(ctx.dir,'artifacts','baseline');await fs.mkdir(baselineDir,{recursive:true});
 await fs.writeFile(path.join(baselineDir,'model.glb'),Buffer.from(initial.glb,'base64'));
 ctx.baseUrl=BASE+'/artifacts/'+ctx.projectId+'/baseline/model.glb';
 // createSceneTools freezes its baseline at creation, so create its final tool
 // set only after the input artifact URL is available.
 const tools=new Map(createSceneTools(ctx).map(tool=>[tool.name,tool]));
 const call=async(name,args)=>decode(await tools.get(name).invoke(args));
 const patch='function build(ctx){const original=ctx.scene.entities.find(e=>e.id==="subject").state.transform.position;return {version:1,mode:"patch",objects:[{id:"subject",transform:{position:[original[0]+1,0,0]}}],remove:[],animations:[],operations:[]};}';
 assert.equal((await call('x_write',{path:'/scene.js',content:patch})).status,'completed');
 const before=await call('preview_3D_scene',{target:'draft',camera_id:'camera',time:1});assert.equal(before.status,'completed',before.error);
 const built=await call('build_3D_scene',{});assert.equal(built.status,'completed',built.error);
 assert.equal(ctx.current.json.entities.find(e=>e.id==='subject').state.transform.position[0],1);
 const final=await call('preview_3D_scene',{target:'build',camera_id:'camera',time:1});assert.equal(final.status,'completed',final.error);
 const after=await call('preview_3D_scene',{target:'draft',camera_id:'camera',time:1});assert.equal(after.status,'completed',after.error);
 assert.equal(before.source_hash,built.source_hash);assert.equal(after.source_hash,built.source_hash);
 assert.equal(before.baseline_revision,built.baseline_revision);assert.equal(after.baseline_revision,built.baseline_revision);
 assert.deepEqual(await pixels(ctx,before),await pixels(ctx,after),'same patch must not be applied a second time after build');
 assert.deepEqual(await pixels(ctx,before),await pixels(ctx,final),'draft and current exported build show the same coordinate');
 assert.equal(ctx.sceneJson.entities.find(e=>e.id==='subject').state.transform.position[0],0,'the run input is unchanged');
 assert.equal(ctx.director.state.currentSource.baselineRevision,built.baseline_revision);
});
