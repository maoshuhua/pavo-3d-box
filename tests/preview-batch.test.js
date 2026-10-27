import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createSceneTools} from '../server/tools.js';
import {resolvePreviewFrames} from '../server/previewPlan.js';
import {createRunMetrics} from '../server/runMetrics.js';
import {createRepeatedErrorTracker} from '../server/repeatedErrors.js';
import {previewCheckKey,sceneAcceptance} from '../server/reviewCompletion.js';

const json={entities:[{id:'camera',kind:'camera',state:{}},{id:'insert',kind:'camera',state:{}},{id:'timeline',kind:'timeline',state:{timeline:{duration:6,shots:[{cameraId:'camera',start:0,end:6}]}}}]};
async function fixture(t,render){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-batch-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'artifacts','latest'),{recursive:true});await fs.writeFile(path.join(dir,'artifacts','latest','model.glb'),'unchanged');
 const events=[],ctx={dir,projectId:'batch-test',signal:new AbortController().signal,emit:e=>events.push(e),sceneJson:json,assets:[],current:{result:{task_id:'latest'},json},metrics:createRunMetrics()};
 const tools=new Map(createSceneTools(ctx,{render}).map(t=>[t.name,t]));return {ctx,events,tools};
}
const frames=[{camera_id:'camera',time:0},{camera_id:'insert',time:3},{camera_id:'camera',time:6}];
test('batch preview splits renderer calls, preserves ordered pixels and reuses saved frames',async t=>{
 let calls=0;const {ctx,tools,events}=await fixture(t,async(method,args)=>{
  calls++;assert.equal(method,'previewBatch');return {frames:args.frames.map(f=>({...f,image:Buffer.from(f.cameraId+f.time).toString('base64'),width:960,height:540}))};
 });
 const result=await tools.get('preview_3D_scene').invoke({frames},{toolCall:{id:'batch'}});
 const value=JSON.parse(result.content);assert.equal(calls,2);assert.equal(value.frame_count,3);assert.equal(ctx.previewChecks.length,3);
 assert.deepEqual(result.artifact.previewImages.map(i=>i.preview.time),[0,3,6]);assert.equal(events.filter(e=>e.type==='PREVIEW').length,3);
 assert.equal(ctx.metrics.snapshot().counters['preview.frames'],3);assert.equal(await fs.readFile(path.join(ctx.dir,'artifacts','latest','model.glb'),'utf8'),'unchanged');
 const single=await tools.get('preview_3D_scene').invoke({camera_id:'camera'},{toolCall:{id:'single'}});assert.equal(JSON.parse(single.content).time,0);assert(single.artifact.previewImage);
 assert.equal(calls,2,'a saved frame must not be rendered again');
});
test('invalid batch plans fail before rendering; cancellation and mismatched frames cannot count as inspected',async t=>{
 let calls=0;const f=await fixture(t,async(_method,args)=>{calls++;return {frames:args.frames.map(p=>({...p,time:p.time+1,image:'eA==',width:960,height:540}))};});
 const invalid=await f.tools.get('preview_3D_scene').invoke({frames:[frames[0],{camera_id:'missing',time:3}]});assert.equal(JSON.parse(invalid).status,'error');assert.equal(calls,0);
 const wrong=await f.tools.get('preview_3D_scene').invoke({frames});assert.equal(JSON.parse(wrong).status,'error');assert.equal(f.ctx.previewChecks,undefined);assert(!f.events.some(e=>e.type==='PREVIEW'));
 assert.throws(()=>resolvePreviewFrames({frames:[{time:7}]},json),/时间轴/);
 await assert.rejects(f.tools.get('preview_3D_scene').invoke({frames,time:0}),/frames/);
 const controller=new AbortController(),cancelled=await fixture(t,async()=>{});cancelled.ctx.signal=controller.signal;
 const tool=createSceneTools(cancelled.ctx,{render:async(_m,args)=>{controller.abort(Error('cancel after rendering'));return {frames:args.frames};}}).find(t=>t.name==='preview_3D_scene');
 await assert.rejects(tool.invoke({frames}),/cancel after rendering/);assert.equal(cancelled.ctx.previewChecks,undefined);assert(!cancelled.events.some(e=>e.type==='PREVIEW'));
});
test('repeat detection warns across edits but stops only unchanged heavy-tool inputs',async t=>{
 const tracker=createRepeatedErrorTracker(),error={error:'bad geometry',stage:'compile'};
 assert.equal(tracker.failure('build',error,'a').count,1);assert.equal(tracker.failure('build',error,'b').identicalInputCount,1);
 assert.equal(tracker.failure('build',error,'b').stop,false);assert.equal(tracker.failure('build',error,'b').stop,true);tracker.success('build');assert.equal(tracker.failure('build',error,'b').count,1);
 const f=await fixture(t,async()=>{throw Error('deterministic renderer failure');});
 await fs.mkdir(path.join(f.ctx.dir,'workspace'));await fs.writeFile(path.join(f.ctx.dir,'workspace','scene.js'),'function build(){return {version:1,mode:"replace"};}');
 const build=f.tools.get('build_3D_scene');
 for(let i=0;i<3;i++){const result=JSON.parse(await build.invoke({}));assert.equal(result.repeat.identicalInputCount,i+1);assert.equal(result.repeat.stop,i===2);}
 assert.equal(f.ctx.repeatedErrorStop.stop,true);assert.equal(f.ctx.current.result.task_id,'latest');
});

test('timeout preserves streamed frames and retries only missing frames once',async t=>{
 const batches=[];let emittedBeforeTimeout=false;
 const f=await fixture(t,async(_method,args,_signal,{onFrame})=>{
  batches.push(args.frames.map(f=>f.time));
  const frame={...args.frames[0],image:'eA==',width:960,height:540};
  if(batches.length===1){await onFrame(frame);emittedBeforeTimeout=f.events.some(e=>e.type==='PREVIEW');throw Object.assign(Error('timeout'),{code:'RENDERER_TIMEOUT'});}
  return {frames:[frame]};
 });
 const result=await f.tools.get('preview_3D_scene').invoke({frames:frames.slice(0,2)});
 assert.equal(JSON.parse(result.content).status,'completed');assert(emittedBeforeTimeout);
 assert.deepEqual(batches,[[0,3],[3]]);assert.equal(f.ctx.previewChecks.length,2);
 assert.equal(f.events.filter(e=>e.type==='PREVIEW').length,2);
});

test('partial preview returns saved pixels and resumes without rerendering successful frames',async t=>{
 let fail=true,calls=0;
 const f=await fixture(t,async(_method,args,_signal,{onFrame})=>{
  calls++;
  if(fail){if(args.frames[0].time===0)await onFrame({...args.frames[0],image:'eA==',width:960,height:540});throw Object.assign(Error('timeout'),{code:'RENDERER_TIMEOUT'});}
  return {frames:args.frames.map(p=>({...p,image:'eA==',width:960,height:540}))};
 });
 const first=await f.tools.get('preview_3D_scene').invoke({frames:frames.slice(0,2)});
 assert.equal(JSON.parse(first.content).status,'partial');assert.equal(first.artifact.previewImages.length,1);assert.equal(f.ctx.previewChecks.length,1);
 fail=false;const second=await f.tools.get('preview_3D_scene').invoke({frames:frames.slice(0,2)});
 assert.equal(JSON.parse(second.content).status,'completed');assert.equal(second.artifact.previewImages.length,2);assert.equal(f.ctx.previewChecks.length,2);assert.equal(calls,3);
});

test('automatic missing plan matches acceptance and redelivers unobserved cached pixels',async t=>{
 const requested=[];
 const f=await fixture(t,async(_method,args)=>{requested.push(...args.frames);return {frames:args.frames.map(p=>({...p,image:'eA==',width:960,height:540}))};});
 f.ctx.completedBuilds=1;f.ctx.observedPreviewKeys=new Set();
 const first=await f.tools.get('preview_3D_scene').invoke({check:'missing'});
 assert.deepEqual(requested.map(p=>p.time),[0,3,6]);assert.deepEqual(JSON.parse(first.content).remaining,[]);
 assert.equal(sceneAcceptance(f.ctx).coverage.checked,0,'rendered pixels must reach a model before acceptance');
 const cached=await f.tools.get('preview_3D_scene').invoke({check:'missing'});assert.equal(cached.artifact.previewImages.length,3);assert.equal(requested.length,3);
 for(const p of f.ctx.previewChecks)f.ctx.observedPreviewKeys.add(previewCheckKey(p));
 assert.equal(sceneAcceptance(f.ctx).coverage.checked,3);
 const done=await f.tools.get('preview_3D_scene').invoke({check:'missing'});assert.equal(JSON.parse(done.content).frame_count,0);
 await assert.rejects(f.tools.get('preview_3D_scene').invoke({check:'missing',time:0}),/不能同时/);
});


test('five-shot automatic acceptance continues past the twelve-frame tool limit',async t=>{
 const requested=[];
 const f=await fixture(t,async(_method,args)=>{assert(args.frames.length<=2);requested.push(...args.frames);return {frames:args.frames.map(p=>({...p,image:'eA==',width:960,height:540}))};});
 f.ctx.current.json={entities:[...Array.from({length:5},(_,i)=>({id:'cam'+i,kind:'camera',state:{}})),{kind:'timeline',state:{timeline:{duration:10,shots:Array.from({length:5},(_,i)=>({cameraId:'cam'+i,start:i*2,end:i*2+2}))}}}]};
 f.ctx.observedPreviewKeys=new Set();f.ctx.completedBuilds=1;
 const first=await f.tools.get('preview_3D_scene').invoke({check:'missing'});
 assert.equal(JSON.parse(first.content).frame_count,12);assert.equal(JSON.parse(first.content).remaining.length,3);
 for(const p of f.ctx.previewChecks)f.ctx.observedPreviewKeys.add(previewCheckKey(p));
 const last=await f.tools.get('preview_3D_scene').invoke({check:'missing'});
 assert.equal(JSON.parse(last.content).frame_count,3);assert.equal(JSON.parse(last.content).remaining.length,0);
 for(const p of f.ctx.previewChecks)f.ctx.observedPreviewKeys.add(previewCheckKey(p));
 assert.equal(sceneAcceptance(f.ctx).coverage.checked,15);assert.equal(requested.length,15);
});
