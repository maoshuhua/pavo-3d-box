import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioDatabase} from '../server/studioDatabase.js';

test('database history retains tool error reasons, grouped details and log ID',()=>{
 const database=new StudioDatabase(':memory:');
 try{
  const session=database.createSession({projectId:'test-project'});
  const emit=event=>database.recordEvent(session,'test-run',event);
  emit({type:'TOOL_CALL_START',toolCallId:'build',toolCallName:'build_3D_scene'});
  emit({type:'TOOL_CALL_END',toolCallId:'build',error:'校验失败'});
  const groups=[{path:'objects[*].geometry',message:'invalid',count:2}];
  emit({type:'TOOL_CALL_RESULT',toolCallId:'build',content:JSON.stringify({status:'error',error:'校验失败',stage:'validate',groups,logId:'saved-log'})});
  const message=database.history('test-project',session).messages[0];
  assert.equal(message.toolStatus,'error');assert.equal(message.toolError,'校验失败');
  assert.equal(message.toolErrorDetails.logId,'saved-log');assert.deepEqual(message.toolErrorDetails.groups,groups);
 }finally{database.close();}
});
