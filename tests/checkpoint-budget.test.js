import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MemorySaver,emptyCheckpoint,DeltaSnapshot} from '@langchain/langgraph-checkpoint';
import {DiskSaver} from '../server/storage.js';
import {createExecutionBudget,executionLimits} from '../server/agentBudget.js';

const config=(id,ns='')=>({configurable:{thread_id:'fixture',checkpoint_ns:ns,...id?{checkpoint_id:id}:{}}});
const checkpoint=(number,values={marker:number})=>({...emptyCheckpoint(),id:String(number).padStart(8,'0'),channel_values:values,channel_versions:Object.fromEntries(Object.keys(values).map(key=>[key,number]))});
const metadata=step=>({source:'loop',step,parents:{}});
const temporaryDir=async(prefix)=>{const root=path.resolve('test-output','checkpoint-tests');await fs.mkdir(root,{recursive:true});return fs.mkdtemp(path.join(root,prefix));};

test('budget categories are independent, bounded, and measure the current invocation',()=>{
 let time=100;
 const budget=createExecutionBudget({tools:2,draftFrames:3,builds:2,buildFailures:1,totalMs:1000},()=>time);
 assert.equal(budget.consume('draftFrames',3).allowed,true);assert.equal(budget.check('draftFrames').reason,'draftFrames');
 assert.equal(budget.consume('buildFailures').allowed,true);assert.equal(budget.status().used.builds,0);
 assert.equal(budget.consume('builds').allowed,true);assert.equal(budget.consume('tools',2).allowed,true);
 assert.equal(budget.check('tools').allowed,false);assert.equal(budget.status().used.tools,2);
 budget.consume('consecutiveErrors');budget.resetErrors();assert.equal(budget.status().used.consecutiveErrors,0);
 time=1100;assert.equal(budget.check('builds').reason,'totalMs');assert.equal(budget.status().remainingMs,0);
 assert.equal(executionLimits({AGENT_MAX_BUILD_PASSES:'garbage'}).builds,3);
 assert.throws(()=>budget.consume('unknown'),/Unknown/);
});

test('checkpoint retention is bounded per namespace and pending writes restore in order',async()=>{
 const dir=await temporaryDir('bounded-');
 try{
  const file=path.join(dir,'checkpoint.bin'),saver=await DiskSaver.open(file);let parent=config();
  for(let i=1;i<=16;i++){
   parent=await saver.put(parent,checkpoint(i),metadata(i));
   await saver.putWrites(parent,[['result',{i}]],`task-${i}`,'work');
  }
  await saver.put(config(undefined,'other'),checkpoint(1,{other:true}),metadata(1));
  const reopened=await DiskSaver.open(file),latest=await reopened.getTuple(config());
  assert.deepEqual(latest.checkpoint.channel_values,{marker:16});
  assert.deepEqual(latest.pendingWrites,[['task-16','result',{i:16}]]);
  const items=[];for await(const tuple of reopened.list({configurable:{thread_id:'fixture'}}))items.push(tuple);
  assert.equal(items.filter(item=>item.config.configurable.checkpoint_ns==='').length,4);
  assert.equal(items.filter(item=>item.config.configurable.checkpoint_ns==='other').length,1);
  assert.equal(Object.keys(reopened.writes).length,4);
  assert.equal(await reopened.getTuple(config('00000001')),undefined);
  assert((await fs.stat(file)).size<20000);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('queued concurrent writes cannot persist an older snapshot over a newer checkpoint',async()=>{
 const dir=await temporaryDir('queued-');
 try{
  const file=path.join(dir,'checkpoint.bin'),saver=await DiskSaver.open(file);
  await Promise.all(Array.from({length:12},(_,index)=>saver.put(config(),checkpoint(index+1),metadata(index+1))));
  const reopened=await DiskSaver.open(file),latest=await reopened.getTuple(config());
  assert.equal(latest.checkpoint.channel_values.marker,12);
  assert.equal(Object.keys(reopened.storage.fixture['']).length,4);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('legacy preview rasters migrate out without removing tool text or pending writes',async()=>{
 const dir=await temporaryDir('migrate-');
 try{
  const file=path.join(dir,'checkpoint.bin'),saver=await DiskSaver.open(file);
  const current=await saver.put(config(),checkpoint(1,{messages:[{content:'actual frame at 1s',artifact:{previewImage:'data:image/png;base64,'+'a'.repeat(200000),time:1}}]}),metadata(1));
  await saver.putWrites(current,[['messages',{content:'frame result',artifact:{previewImage:'data:image/png;base64,'+'b'.repeat(100000),time:2}}]],'task');
  const reopened=await DiskSaver.open(file),tuple=await reopened.getTuple(config());
  assert.equal(tuple.checkpoint.channel_values.messages[0].content,'actual frame at 1s');
  assert.deepEqual(tuple.checkpoint.channel_values.messages[0].artifact,{time:1});
  assert.deepEqual(tuple.pendingWrites[0][2].artifact,{time:2});
  assert((await fs.stat(file)).size<10000);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('delta-channel ancestor dependencies retain the exact history needed for restore',async()=>{
 const dir=await temporaryDir('delta-');
 try{
  const saver=await DiskSaver.open(path.join(dir,'checkpoint.bin')),reference=new MemorySaver();let parent=config();
  for(let i=1;i<=10;i++){
   const cp=checkpoint(i,i===1||i===8?{messages:new DeltaSnapshot(Array.from({length:i-1},(_,index)=>index+1))}:{});cp.channel_versions={messages:i};
   const meta={...metadata(i),delta_writes_versioned:true,...i===1||i===8?{}:{counters_since_delta_snapshot:{messages:[i,i]}}};
   const old=parent;parent=await saver.put(old,cp,meta);await reference.put(old,cp,meta);
   await saver.putWrites(parent,[['messages',i]],`task-${i}`);await reference.putWrites(parent,[['messages',i]],`task-${i}`);
  }
  for(let i=7;i<=10;i++)assert.deepEqual(await saver.getDeltaChannelHistory({config:config(String(i).padStart(8,'0')),channels:['messages']}),await reference.getDeltaChannelHistory({config:config(String(i).padStart(8,'0')),channels:['messages']}));
  // The oldest of the retained four still needs its seed at 1. Advancing all
  // four beyond the snapshot at 8 releases that earlier dependency chain.
  for(let i=11;i<=12;i++){const cp=checkpoint(i,{});cp.channel_versions={messages:i};parent=await saver.put(parent,cp,{...metadata(i),delta_writes_versioned:true,counters_since_delta_snapshot:{messages:[i-8,i-8]}});await saver.putWrites(parent,[['messages',i]],`task-${i}`);}
  assert.equal(saver.storage.fixture['']['00000001'],undefined);
  assert.deepEqual(Object.keys(saver.storage.fixture['']).sort(),['00000008','00000009','00000010','00000011','00000012']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
