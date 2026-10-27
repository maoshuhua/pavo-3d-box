import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioDatabase} from '../server/studioDatabase.js';

test('partial run outcomes and remaining work survive history and state recovery',()=>{
 const store=new StudioDatabase(':memory:');
 try{
  const projectId=store.create().studioMeta.uuid,sessionId=store.createSession({projectId}),runId='partial-run';
  store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(runId,sessionId,projectId,'partial',1,2);
  const result={task_id:'draft'},outcome={intent:'scene',status:'partial',checksPassed:false,issues:[{code:'preview-coverage',message:'尚未检查结尾。'}]};
  store.recordEvent(sessionId,runId,{type:'RESULT',result,snapshotRevision:3});
  store.recordEvent(sessionId,runId,{type:'RUN_FINISHED',status:'partial',outcome,message:'本轮部分完成，已保留场景。'});
  const detail=store.runDetail(projectId,runId);assert.equal(detail.status,'partial');assert.equal(detail.snapshotRevision,3);assert.deepEqual(detail.outcome,outcome);assert.equal(detail.error,null);
  const history=store.history(projectId,sessionId);assert.equal(history.runStatus,'partial');assert.deepEqual(history.latestRun.outcome,outcome);
  assert.equal(history.messages.filter(m=>m.id===`${runId}:outcome`).length,1);assert.match(history.messages[0].text,/部分完成/);
 }finally{store.close();}
});


test('legacy user cancellation is recovered as cancelled while original events stay intact',()=>{
 const store=new StudioDatabase(':memory:');
 try{
  const projectId=store.create().studioMeta.uuid,sessionId=store.createSession({projectId}),runId='old-cancel';
  store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(runId,sessionId,projectId,'failed',1,2);
  store.recordEvent(sessionId,runId,{type:'RUN_ERROR',message:'Cancelled by user'});
  assert.equal(store.runDetail(projectId,runId).status,'cancelled');assert.equal(store.runDetail(projectId,runId).error,null);
  assert.equal(store.history(projectId,sessionId).runStatus,'cancelled');assert.equal(store.runEvents(projectId,runId).at(-1).type,'RUN_ERROR');
 }finally{store.close();}
});
