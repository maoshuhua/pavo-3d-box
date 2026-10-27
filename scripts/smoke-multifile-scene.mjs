import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createSceneTools} from '../server/tools.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {projectDir} from '../server/storage.js';
import {BASE} from '../server/config.js';
import {closeRenderer} from '../server/renderService.js';

const output=path.resolve('output/playwright/multifile-scene');await fs.mkdir(output,{recursive:true});
assert.equal((await fetch(BASE+'/api/agent/health')).ok,true);
const database=new StudioDatabase(),projectId=crypto.randomUUID(),runId=crypto.randomUUID();
database.create({name:'多文件分层与并行写入验证'},null,projectId);
const sessionId=database.createSession({projectId});
database.update({studioUuid:projectId,config:JSON.stringify({animationPreview:{version:1,sessionId}})});
database.db.prepare("INSERT INTO runs VALUES(?,?,?,'completed',?,?)").run(runId,sessionId,projectId,Date.now(),Date.now());
const dir=projectDir(projectId);await fs.mkdir(path.join(dir,'workspace'),{recursive:true});
const events=[],modules=[];
function module(file,dependsOn,body){modules.push({path:file,dependsOn,source:`function create(ctx,deps){${body}}`});}
module('/shared/constants.js',[],'return {duration:3,aspect:16/9};');
module('/shared/identifiers.js',[],'return {root:"subject",camera:"camera"};');
module('/shared/utils.js',[],'return {identity:()=>[0,0,0,1]};');
module('/definitions/materials.js',[],'return {primary:{color:"#35a8e8",metallic:.2,roughness:.35},accent:{color:"#ff984a",roughness:.45}};');
module('/definitions/components.js',['/definitions/materials.js'],'return {mesh:(id,position,color)=>({id,type:"mesh",geometry:{type:"box",args:[1,1,1]},material:deps["/definitions/materials.js"][color],transform:{position}})};');
module('/content/main.js',['/definitions/components.js','/shared/identifiers.js'],`const mesh=deps['/definitions/components.js'].mesh;return {objects:[{id:deps['/shared/identifiers.js'].root,type:'group',name:'旋转组件'},mesh('part-left',[-.7,.6,0],'primary'),mesh('part-right',[.7,.6,0],'accent'),{id:'ground',type:'mesh',geometry:{type:'box',args:[12,.15,12]},transform:{position:[0,-.1,0]},material:{color:'#555e6c',roughness:.8}}]};`);
module('/behavior/hierarchy.js',['/shared/identifiers.js'],`return objects=>objects.map(o=>o.id.startsWith('part-')?{...o,parentId:deps['/shared/identifiers.js'].root}:o);`);
module('/behavior/animation.js',['/shared/constants.js','/shared/identifiers.js','/shared/utils.js'],`const c=deps['/shared/constants.js'],id=deps['/shared/identifiers.js'].root;return [{id:'turn',name:'旋转展示',duration:c.duration,tracks:[{entityId:id,property:'quaternion',times:[0,1.5,3],values:[...deps['/shared/utils.js'].identity(),0,Math.sin(.6),0,Math.cos(.6),...deps['/shared/utils.js'].identity()]}]}];`);
module('/presentation/world.js',[],`return {type:'solid',color:[.16,.19,.24],strength:1};`);
module('/presentation/lighting.js',[],`return [{id:'sun',type:'light',name:'主光',light:{type:'directional',color:[1,1,1],intensity:4},transform:{position:[4,7,6]},lookAt:[0,0,0]},{id:'fill',type:'light',name:'补光',light:{type:'point',color:[.5,.7,1],intensity:30,range:20},transform:{position:[-3,3,3]}}];`);
module('/presentation/cameras.js',['/shared/constants.js','/shared/identifiers.js'],`return [{id:deps['/shared/identifiers.js'].camera,type:'camera',name:'展示机位',camera:{fov:45,aspect:deps['/shared/constants.js'].aspect},transform:{position:[4,3,6]},lookAt:[0,.6,0]}];`);
module('/presentation/timeline.js',['/shared/constants.js','/shared/identifiers.js'],`return {version:1,duration:deps['/shared/constants.js'].duration,shots:[{cameraId:deps['/shared/identifiers.js'].camera,start:0,end:deps['/shared/constants.js'].duration}]};`);
module('/assembly/merge.js',[],`return parts=>parts.flat();`);
module('/assembly/validate.js',[],`return objects=>{const ids=new Set();for(const o of objects){if(ids.has(o.id))throw Error('duplicate '+o.id);ids.add(o.id);}for(const o of objects)if(o.parentId&&!ids.has(o.parentId))throw Error('missing parent '+o.parentId);return objects;};`);
const files=modules.map(m=>({path:m.path,content:m.source}));
files.push({path:'/manifest.json',content:JSON.stringify({version:1,entry:'/scene.js',modules:modules.map(({path,dependsOn})=>({path,dependsOn}))},null,2)});
files.push({path:'/scene.js',content:`function build(ctx,modules){const m=modules;const objects=m['/assembly/merge.js']([m['/behavior/hierarchy.js'](m['/content/main.js'].objects),m['/presentation/lighting.js'],m['/presentation/cameras.js']]);return {version:1,mode:'replace',objects:m['/assembly/validate.js'](objects),animations:m['/behavior/animation.js'],world:m['/presentation/world.js'],timeline:m['/presentation/timeline.js']};}`});
const tools=createSceneTools({dir,projectId,signal:new AbortController().signal,assets:[],sceneJson:{version:1,entities:[],operations:[]},
 emit:event=>{events.push({...event,at:Date.now()});database.recordEvent(sessionId,runId,event);},
 onBuild:async({result})=>database.commitSnapshot(projectId,1,path.join(dir,'artifacts',result.task_id,'model.glb'),path.join(dir,'artifacts',result.task_id,'collaboration.json'),{generation:result,promptHandled:true})});
const invoke=async(name,args)=>{const value=await tools.find(t=>t.name===name).invoke(args);return typeof value==='string'?JSON.parse(value):value;};
try{
 const writes=files.map(file=>invoke('x_write',file));
 // Submit the build while writes are pending: the barrier must wait for all.
 const building=invoke('build_3D_scene',{});
 const written=await Promise.all(writes);assert.ok(written.every(r=>r.status==='completed'));
 const result=await building;assert.equal(result.status,'completed',result.error);assert.equal(result.sources.length,files.length);
 const firstEnd=events.findIndex(e=>e.type==='TOOL_CALL_END');
 const parallelStarts=events.slice(0,firstEnd).filter(e=>e.type==='TOOL_CALL_START').length;assert.ok(parallelStarts>1);
 const buildStart=events.findIndex(e=>e.type==='TOOL_CALL_START'&&e.toolCallName==='build_3D_scene');
 assert.equal(events.slice(0,buildStart).filter(e=>e.type==='TOOL_CALL_END').length,files.length);
 for(const time of [0,1.5,3]){
  const value=await invoke('preview_3D_scene',{camera_id:'camera',time});
  const frame=JSON.parse(value.content);assert.equal(frame.status,'completed');
  const response=await fetch(frame.image_url);assert.ok(response.ok);await fs.writeFile(path.join(output,`preview-${time}.png`),Buffer.from(await response.arrayBuffer()));
 }
 assert.notDeepEqual(await fs.readFile(path.join(output,'preview-0.png')),await fs.readFile(path.join(output,'preview-1.5.png')));
 await fs.writeFile(path.join(output,'events.json'),JSON.stringify(events,null,2));
 const report={projectId,sessionId,files:files.map(f=>f.path),parallelStartsBeforeFirstCompletion:parallelStarts,result,url:`http://127.0.0.1:5173/animation-preview?projectId=${projectId}`};
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await closeRenderer();database.close();}
