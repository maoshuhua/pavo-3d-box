import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentClient} from '../src/agentClient.js';

globalThis.localStorage={value:null,getItem(){return this.value;},setItem(key,value){this.value=value;}};
test('client serializes artifact commits, persists tools/session and ignores late events',async()=>{
 localStorage.value=null;const client=new AgentClient(),commits=[];let late;
 globalThis.__3D_BOX_AGENT_ADAPTER__={generate:async(request,{emit})=>{
  emit({type:'SESSION',sessionId:'local-session'});
  emit({type:'TOOL_CALL_START',toolCallId:'build-1',toolCallName:'build_3D_scene'});
  const result={status:'completed',task_id:'one',glb_url:'http://127.0.0.1/a.glb',collaboration_url:'http://127.0.0.1/a.json'};
  emit({type:'RESULT',result});emit({type:'TOOL_CALL_RESULT',content:JSON.stringify(result)});
  emit({type:'TOOL_CALL_END',toolCallId:'build-1'});emit({type:'RUN_FINISHED'});late=emit;
 }};
 try{
  await client.generate({prompt:'生成',attachments:[],scene:{}},{signal:new AbortController().signal,onEvent:()=>{},onResult:async r=>commits.push(r.task_id)});
  assert.deepEqual(commits,['one']);assert.equal(client.state.sessionId,'local-session');assert.equal(client.state.messages.find(m=>m.id==='build-1').toolStatus,'completed');
  late({type:'TEXT_MESSAGE_CONTENT',delta:'late',messageId:'late'});assert(!client.state.messages.some(m=>m.id==='late'));assert(!client.pending);
 }finally{delete globalThis.__3D_BOX_AGENT_ADAPTER__;}
});
test('client abort keeps scene commits out and resets running tool state',async()=>{
 localStorage.value=null;const client=new AgentClient(),controller=new AbortController();let emitLate;
 globalThis.__3D_BOX_AGENT_ADAPTER__={generate:async(request,{emit,signal})=>{emitLate=emit;emit({type:'TOOL_CALL_START',toolCallId:'pending',toolCallName:'build_3D_scene'});controller.abort();await new Promise(resolve=>setTimeout(resolve,1));}};
 try{
  await assert.rejects(()=>client.generate({prompt:'cancel',attachments:[],scene:{}},{signal:controller.signal,onEvent:()=>{},onResult:()=>assert.fail('cancelled run committed')}));
  emitLate({type:'RESULT',result:{}});assert.equal(client.state.messages.find(m=>m.id==='pending').toolStatus,'interrupted');assert(!client.pending);
 }finally{delete globalThis.__3D_BOX_AGENT_ADAPTER__;}
});

test('homepage uploaded reference metadata survives the draft-to-agent handoff and session reload',async()=>{
 localStorage.value=null;const client=new AgentClient('home-project');
 globalThis.__3D_BOX_AGENT_ADAPTER__={generate:async(request,{emit})=>{assert.deepEqual(request.attachmentIds,['local-image']);assert.equal(request.messages.at(-1).attachments[0].name,'reference.png');emit({type:'RUN_FINISHED'});}};
 try{await client.generate({prompt:'参考图片生成',attachmentIds:['local-image'],attachmentParts:[{assetId:'local-image',name:'reference.png',type:'image',source:{type:'url',value:'http://127.0.0.1:8788/local-assets/local-image',mimeType:'image/png'}}],scene:{}},{signal:new AbortController().signal,onEvent:()=>{},onResult:()=>{}});const restored=new AgentClient('home-project');assert.equal(restored.state.messages[0].attachments[0].assetId,'local-image');assert.equal(restored.state.messages[0].attachments[0].kind,'image');}
 finally{delete globalThis.__3D_BOX_AGENT_ADAPTER__;}
});

test('session recovery preserves running tools, deduplicates event replay and never posts a new user message',async()=>{
 localStorage.value=null;const run={runId:'existing-run',sessionId:'existing-session',status:'running',eventSeq:10},messages=[{id:'user',role:'user',text:'生成'},{id:'tool',role:'tool',toolName:'build_3D_scene',toolStatus:'running'}],client=new AgentClient('recover',{messages,latestRun:run,runStatus:'running'});let commits=0;
 assert.equal(client.state.messages[1].toolStatus,'running');
 globalThis.__3D_BOX_AGENT_ADAPTER__={resume:async(request,{emit})=>{assert.equal(request.afterSeq,10);emit({type:'TEXT_MESSAGE_CONTENT',seq:10,messageId:'old',delta:'重复'});emit({type:'TEXT_MESSAGE_CONTENT',seq:11,messageId:'reply',delta:'恢复'});emit({type:'TEXT_MESSAGE_CONTENT',seq:11,messageId:'reply',delta:'恢复'});emit({type:'TOOL_CALL_END',seq:12,toolCallId:'tool'});const result={status:'completed',task_id:'saved',glb_url:'http://127.0.0.1/a.glb',collaboration_url:'http://127.0.0.1/a.json'};emit({type:'RESULT',seq:13,result,snapshotRevision:2});emit({type:'RESULT',seq:14,result,snapshotRevision:2});emit({type:'RUN_FINISHED',seq:15});},generate:()=>assert.fail('recovery started a new generation')};
 try{await client.resume(run,{signal:new AbortController().signal,onEvent:()=>{},onResult:async(_,signal,event)=>{assert.equal(event.snapshotRevision,2);commits++;}});assert.equal(commits,1);assert.equal(client.state.messages.filter(m=>m.role==='user').length,1);assert.equal(client.state.messages.find(m=>m.id==='reply').text,'恢复');assert.equal(client.state.messages[1].toolStatus,'completed');assert.equal(client.state.runStatus,'completed');assert.equal(client.state.eventSeq,15);}
 finally{delete globalThis.__3D_BOX_AGENT_ADAPTER__;}
});

test('a task completing between snapshot and history reads applies its newer result exactly once',async()=>{
 localStorage.value=JSON.stringify({lastAppliedTaskId:'older'});const result={status:'completed',task_id:'newer',glb_url:'http://127.0.0.1/new.glb',collaboration_url:'http://127.0.0.1/new.json'},run={runId:'completed',sessionId:'session',status:'completed',eventSeq:9,snapshotRevision:4,result},client=new AgentClient('race',{messages:[],latestRun:run,runStatus:'completed'});assert.equal(client.needsRecovery(),true);let applied=0;
 globalThis.__3D_BOX_AGENT_ADAPTER__={resume:async(_,{emit})=>emit({type:'RUN_FINISHED'}),generate:()=>assert.fail('must not restart a completed task')};
 try{await client.resume(run,{signal:new AbortController().signal,onEvent:()=>{},onResult:async()=>applied++});assert.equal(applied,1);assert.equal(client.needsRecovery(),false);assert.equal(client.state.messages.length,0);}
 finally{delete globalThis.__3D_BOX_AGENT_ADAPTER__;}
});
