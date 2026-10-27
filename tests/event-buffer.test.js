import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventBuffer} from '../server/eventBuffer.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {createRunEvents} from '../server/runEvents.js';

function fixture(){
 const db=new StudioDatabase(':memory:'),projectId=db.create().studioMeta.uuid,sessionId=db.createSession({projectId}),runId='buffer-test';
 db.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(runId,sessionId,projectId,'running',1,1);
 const channel=createRunEvents(db),batches=[],buffer=createEventBuffer({publishMany:events=>{batches.push(events.length);return channel.publishMany(sessionId,runId,events);}});
 return {db,projectId,sessionId,runId,buffer,batches};
}
test('hundreds of adjacent text/argument deltas persist losslessly at state boundaries',()=>{
 const f=fixture();try{
  for(let i=0;i<200;i++)f.buffer.emit({type:'TEXT_MESSAGE_CONTENT',messageId:'reply',delta:'中'+i});
  assert.equal(f.db.runEvents(f.projectId,f.runId).length,0);
  f.buffer.emit({type:'TOOL_CALL_START',toolCallId:'tool',toolCallName:'x_read'});
  for(const delta of ['{"path":','"/scene.js"','}'])f.buffer.emit({type:'TOOL_CALL_ARGS',toolCallId:'tool',delta});
  f.buffer.emit({type:'TOOL_CALL_END',toolCallId:'tool'});f.buffer.emit({type:'RUN_FINISHED'});
  const events=f.db.runEvents(f.projectId,f.runId);
  assert.deepEqual(events.map(e=>e.type),['TEXT_MESSAGE_CONTENT','TOOL_CALL_START','TOOL_CALL_ARGS','TOOL_CALL_END','RUN_FINISHED']);
  assert.equal(events[0].delta,Array.from({length:200},(_,i)=>'中'+i).join(''));assert.equal(events[2].delta,'{"path":"/scene.js"}');
  assert.equal(f.db.history(f.projectId,f.sessionId).messages[0].text,events[0].delta);
  assert.deepEqual(events.map(e=>e.seq),[1,2,3,4,5]);assert.equal(f.db.runEvents(f.projectId,f.runId,3).length,2);
 }finally{f.buffer.close();f.db.close();}
});
test('interleaved identities retain order and batch transaction failures publish nothing',()=>{
 const f=fixture();try{
  for(const messageId of ['a','b','a'])f.buffer.emit({type:'TEXT_MESSAGE_CONTENT',messageId,delta:messageId});
  f.buffer.flush();assert.deepEqual(f.db.runEvents(f.projectId,f.runId).map(e=>e.messageId),['a','b','a']);assert.deepEqual(f.batches,[3]);
  const circular={type:'TEXT_MESSAGE_CONTENT',messageId:'bad',delta:'x'};circular.circular=circular;
  assert.throws(()=>f.db.recordEvents(f.sessionId,f.runId,[{type:'TEXT_MESSAGE_CONTENT',messageId:'rollback',delta:'must not save'},circular]));
  assert.equal(f.db.runEvents(f.projectId,f.runId).length,3);assert(!f.db.history(f.projectId,f.sessionId).messages.some(m=>m.id==='rollback'));
 }finally{f.buffer.close();f.db.close();}
});
test('timer flushes short streams, close drains cancellation text and size bounds flush early',async()=>{
 const saved=[];const b=createEventBuffer({intervalMs:5,maxBytes:8,publishMany:events=>events.map(e=>({...e})),onPersist:frames=>saved.push(...frames)});
 try{b.emit({type:'TEXT_MESSAGE_CONTENT',delta:'hello'});await new Promise(r=>setTimeout(r,30));assert.equal(saved.length,1);
  b.emit({type:'TOOL_CALL_ARGS',delta:'12345678'});assert.equal(saved.length,2);
  b.emit({type:'TEXT_MESSAGE_CONTENT',delta:'cancel'});b.close();assert.equal(saved[2].delta,'cancel');
 }finally{b.close();}
});
test('a background persistence failure is surfaced, never silently dropping pending events',async()=>{
 let failure;const b=createEventBuffer({intervalMs:1,publishMany(){throw Error('disk full');},onError:error=>{failure=error;}});
 b.emit({type:'TEXT_MESSAGE_CONTENT',delta:'keep'});await new Promise(r=>setTimeout(r,20));
 assert.match(failure.message,/disk full/);assert.throws(()=>b.emit({type:'RUN_FINISHED'}),/disk full/);assert.throws(()=>b.close(),/disk full/);
});
