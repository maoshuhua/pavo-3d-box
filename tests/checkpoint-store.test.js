import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {serialize} from 'node:v8';
import {MemorySaver,emptyCheckpoint} from '@langchain/langgraph-checkpoint';
import {HumanMessage,ToolMessage} from '@langchain/core/messages';
import {StateGraph,Annotation,START,END,messagesStateReducer} from '@langchain/langgraph';
import {DiskSaver} from '../server/checkpointStore.js';

process.env.LANGSMITH_TRACING='false';
process.env.LANGCHAIN_TRACING_V2='false';

const config=(thread='thread',namespace='',id)=>({configurable:{thread_id:thread,checkpoint_ns:namespace,...id?{checkpoint_id:id}:{}}});
const metadata=step=>({source:'loop',step,parents:{},group:step%2});
function checkpoint(id,values={}){return {...emptyCheckpoint(),id,channel_values:values};}
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-sqlite-checkpoint-')),file=path.join(dir,'checkpoint.bin'),savers=[];
 t.after(async()=>{for(const saver of savers)await saver.close();await fs.rm(dir,{recursive:true,force:true});});
 const open=async options=>{const saver=await DiskSaver.open(file,options);savers.push(saver);return saver;};
 return {dir,file,open};
}

test('latest/explicit checkpoints, namespaces, lists and typed messages survive reopening',async t=>{
 const {open}=await fixture(t);let saver=await open();
 const original=new HumanMessage({content:'持久消息',id:'user'}),image=new ToolMessage({content:'image',tool_call_id:'call',artifact:{previewImage:'data:image/png;base64,AAAA'}});
 const first=checkpoint('001',{messages:[original,image],bytes:new Uint8Array([1,3,5]),nothing:undefined});
 const a=await saver.put(config(),first,metadata(1));
 const b=await saver.put(a,checkpoint('002',{messages:[original,image,new HumanMessage('下一轮')]}),metadata(2));
 await saver.put(config('thread','child'),checkpoint('003',{marker:'namespace'}),metadata(3));
 await saver.close();saver=await open();
 const latest=await saver.getTuple(config());assert.equal(latest.checkpoint.id,'002');assert.deepEqual(latest.parentConfig,a);
 const old=await saver.getTuple({...a,tags:['keep-config']});assert.deepEqual(old.config,{...a,tags:['keep-config']});
 assert(old.checkpoint.channel_values.messages[0] instanceof HumanMessage);assert(old.checkpoint.channel_values.messages[1] instanceof ToolMessage);
 assert.deepEqual(old.checkpoint.channel_values.bytes,new Uint8Array([1,3,5]));assert.equal(old.checkpoint.channel_values.messages[1].artifact.previewImage,image.artifact.previewImage);
 assert(Object.hasOwn(old.checkpoint.channel_values,'nothing'));
 assert.deepEqual((await Array.fromAsync(saver.list(config()))).map(v=>v.checkpoint.id),['002','001']);
 assert.deepEqual((await Array.fromAsync(saver.list(config(),{before:b,filter:{group:1},limit:1}))).map(v=>v.checkpoint.id),['001']);
 assert.equal((await saver.getTuple(config('thread','child'))).checkpoint.channel_values.marker,'namespace');
 assert.equal(await saver.getTuple(config('missing')),undefined);
});

test('writes match MemorySaver idempotency, special overwrite and Unicode task ordering',async t=>{
 const {open}=await fixture(t),saver=await open(),memory=new MemorySaver();
 const cp=checkpoint('001');const diskConfig=await saver.put(config(),cp,metadata(0)),memoryConfig=await memory.put(config(),cp,metadata(0));
 const batches=[
  ['z',[['messages','Z']], '\u{10000}'],['a',[['messages','A']], '\uE000'],
  ['once',[['messages','first'],['__error__','old']], ''],['once',[['messages','ignored'],['__error__','new']], ''],
 ];
 for(const [task,writes,taskPath] of batches){await saver.putWrites(diskConfig,writes,task,taskPath);await memory.putWrites(memoryConfig,writes,task,taskPath);}
 assert.deepEqual((await saver.getTuple(diskConfig)).pendingWrites,(await memory.getTuple(memoryConfig)).pendingWrites);
 assert.equal((await saver.getTuple(diskConfig)).pendingWrites.find(([task,channel])=>task==='once'&&channel==='__error__')[2],'new');
 await saver.close();const reopened=await open();assert.deepEqual((await reopened.getTuple(diskConfig)).pendingWrites,(await memory.getTuple(memoryConfig)).pendingWrites);
});

test('ancestor DeltaHistory follows branches and seed/write order exactly like MemorySaver',async t=>{
 const {open}=await fixture(t),saver=await open(),memory=new MemorySaver();
 for(const target of [saver,memory]){
  const a=await target.put(config(),checkpoint('001',{delta:['seed']}),metadata(0));
  await target.putWrites(a,[['delta','first']],'b','0');await target.putWrites(a,[['delta','second']],'a','1');
  const b=await target.put(a,checkpoint('002'),metadata(1));await target.putWrites(b,[['delta','third']],'t','2');
  await target.put(a,checkpoint('003',{delta:['wrong-branch']}),metadata(2));
  await target.put(b,checkpoint('004'),metadata(3));
 }
 assert.deepEqual(await saver.getDeltaChannelHistory({config:config('thread','','004'),channels:['delta','missing']}),await memory.getDeltaChannelHistory({config:config('thread','','004'),channels:['delta','missing']}));
});

test('transaction failure rolls back and does not poison subsequent save queue',async t=>{
 const {open}=await fixture(t),saver=await open();
 await saver.put(config(),checkpoint('001',{ok:1}),metadata(1));
 saver.db.exec("CREATE TRIGGER checkpoint_fail BEFORE INSERT ON checkpoint_channels WHEN new.channel='fail' BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
 await assert.rejects(saver.put(config(),checkpoint('002',{first:'rollback',fail:1}),metadata(2)),/injected write failure/);
 assert.equal(await saver.getTuple(config('thread','','002')),undefined);
 saver.db.exec('DROP TRIGGER checkpoint_fail');
 await saver.put(config(),checkpoint('003',{ok:3}),metadata(3));await saver.close();
 assert.equal((await (await open()).getTuple(config())).checkpoint.channel_values.ok,3);
});

test('deleteThread removes writes/checkpoints and unreferenced payloads, retaining other threads',async t=>{
 const {open}=await fixture(t),saver=await open();
 const a=await saver.put(config('a'),checkpoint('001',{shared:'shared',private:'private-a'}),metadata(1));
 await saver.putWrites(a,[['messages','private-write']],'task');
 await saver.put(config('b'),checkpoint('001',{shared:'shared',private:'private-b'}),metadata(1));
 await saver.deleteThread('a');assert.equal(await saver.getTuple(config('a')),undefined);assert.equal(saver.db.prepare("SELECT count(*) n FROM checkpoint_writes WHERE thread_id='a'").get().n,0);
 assert.equal((await saver.getTuple(config('b'))).checkpoint.channel_values.private,'private-b');
 await saver.deleteThread('b');assert.equal(saver.db.prepare('SELECT count(*) n FROM checkpoint_payloads').get().n,0);assert.equal(saver.db.prepare('SELECT count(*) n FROM checkpoint_chunks').get().n,0);
});

test('legacy V8 migrates all checkpoints/writes in isolation and preserves original bytes',async t=>{
 const {open,file,dir}=await fixture(t),memory=new MemorySaver();
 const a=await memory.put(config(),checkpoint('001',{messages:[new HumanMessage('旧会话')]}),metadata(1));await memory.putWrites(a,[['messages','pending']],'task','2');
 await memory.put(a,checkpoint('002',{value:'latest'}),metadata(2));
 const legacy=serialize({storage:memory.storage,writes:memory.writes});await fs.writeFile(file,legacy);
 let saver=await open();assert.deepEqual(await saver.getTuple(config()),await memory.getTuple(config()));assert.deepEqual(await saver.getTuple(a),await memory.getTuple(a));
 assert((await fs.readFile(file)).equals(legacy));assert((await fs.readdir(dir)).includes('checkpoint.sqlite'));assert(!(await fs.readdir(dir)).some(name=>name.includes('.migration-')));
 await saver.put(config(),checkpoint('003',{value:'new'}),metadata(3));await saver.close();saver=await open();
 assert.equal((await saver.getTuple(config())).checkpoint.id,'003');assert((await fs.readFile(file)).equals(legacy));
});

test('pre-v4 pending-send migration is preserved for both latest and historical tuples',async t=>{
 const {open,file}=await fixture(t),memory=new MemorySaver();
 const a=await memory.put(config(),{...checkpoint('001'),v:3},metadata(1));await memory.putWrites(a,[['__pregel_tasks',{node:'pending'}]],'task');
 await memory.put(a,{...checkpoint('002'),v:3},metadata(2));
 await fs.writeFile(file,serialize({storage:memory.storage,writes:memory.writes}));
 const saver=await open();assert.deepEqual(await saver.getTuple(config()),await memory.getTuple(config()));
 assert.deepEqual((await saver.getTuple(config())).checkpoint.channel_values.__pregel_tasks,[{node:'pending'}]);
});

test('failed/cancelled legacy migration retains original and leaves no partially published database',async t=>{
 const {open,file,dir}=await fixture(t);await fs.writeFile(file,'broken-v8');
 await assert.rejects(open(),/migration failed/);assert.deepEqual((await fs.readdir(dir)).sort(),['checkpoint.bin']);
 const memory=new MemorySaver();await memory.put(config(),checkpoint('001',{ok:true}),metadata(1));
 const legacy=serialize({storage:memory.storage,writes:memory.writes});await fs.writeFile(file,legacy);
 await assert.rejects(open({migrationTimeoutMs:1}),/time limit/);assert.deepEqual((await fs.readdir(dir)).sort(),['checkpoint.bin']);assert((await fs.readFile(file)).equals(legacy));
 const running=new AbortController(),cancel=setTimeout(()=>running.abort(Error('cancel running migration')),10);
 try{await assert.rejects(open({signal:running.signal}),/cancel running migration/);}finally{clearTimeout(cancel);}
 assert.deepEqual((await fs.readdir(dir)).sort(),['checkpoint.bin']);
 const controller=new AbortController();controller.abort(Error('cancel migration'));await assert.rejects(open({signal:controller.signal}),/cancel migration/);
 assert.equal((await (await open()).getTuple(config())).checkpoint.channel_values.ok,true);
});

test('an empty sidecar cannot silently replace a legacy session',async t=>{
 const {open,file,dir}=await fixture(t),memory=new MemorySaver();await memory.put(config(),checkpoint('001',{saved:true}),metadata(1));
 const legacy=serialize({storage:memory.storage,writes:memory.writes});await fs.writeFile(file,legacy);await fs.writeFile(path.join(dir,'checkpoint.sqlite'),'');
 await assert.rejects(open(),/Refusing to open an empty replacement session/);assert((await fs.readFile(file)).equals(legacy));
});

test('fixed large channel is stored once and opening latest does not hydrate history',async t=>{
 const {open}=await fixture(t),saver=await open(),payload='x'.repeat(256*1024);let current=config();
 saver.db.exec('PRAGMA wal_autocheckpoint=0');
 for(let i=1;i<=80;i++)current=await saver.put(current,checkpoint(String(i).padStart(3,'0'),{payload}),metadata(i));
 assert.equal(saver.db.prepare('SELECT count(DISTINCT payload_hash) n FROM checkpoint_channels').get().n,1);
 const stored=saver.db.prepare('SELECT sum(length(data)) n FROM checkpoint_chunks').get().n;
 assert(stored<500*1024,`CAS bytes ${stored} must be far below 80 * 256 KiB`);
 const written=(await fs.stat(saver.file+'-wal')).size;assert(written<16*1024*1024,`incremental WAL ${written} must stay below full-history rewriting`);
 await saver.close();const reopened=await open();let loaded=0;const original=reopened.serde.loadsTyped.bind(reopened.serde);reopened.serde.loadsTyped=async(...args)=>{loaded++;return original(...args);};
 assert.equal((await reopened.getTuple(config())).checkpoint.id,'080');assert.equal(loaded,3,'latest loads its header, one channel and metadata only');
});

test('a real LangGraph graph resumes messages across invocations without model/network calls',async t=>{
 const {open}=await fixture(t),saver=await open();
 const state=Annotation.Root({messages:Annotation({reducer:messagesStateReducer,default:()=>[]})});
 const makeGraph=checkpointer=>new StateGraph(state).addNode('reply',s=>({messages:[new HumanMessage({id:'reply-'+s.messages.length,content:'收到'+s.messages.length})]})).addEdge(START,'reply').addEdge('reply',END).compile({checkpointer});
 await makeGraph(saver).invoke({messages:[new HumanMessage({id:'user-1',content:'第一轮'})]},config());await saver.close();
 const reopened=await open(),result=await makeGraph(reopened).invoke({messages:[new HumanMessage({id:'user-2',content:'第二轮'})]},config());
 assert.equal(result.messages.length,4);assert.equal(result.messages[0].content,'第一轮');assert.equal(result.messages[2].content,'第二轮');
});
