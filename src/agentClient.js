import { resultSchema } from './agentSchemas.js';
import {localAgentAdapter} from './localAgentAdapter.js';
// libtv findPreviewAgentResult: structured events, JSON text and code blocks.
export function findAgentResult(value, depth=0) {
  if(depth>8||value==null)return;
  if(typeof value==='string'){
    if(value.length>2e6)return;
    try{return findAgentResult(JSON.parse(value),depth+1)}catch{}
    for(const match of value.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)){const result=findAgentResult(match[1],depth+1);if(result)return result;}
    const start=value.indexOf('{'),end=value.lastIndexOf('}');
    if(start>=0&&end>start&&(start>0||end<value.length-1))return findAgentResult(value.slice(start,end+1),depth+1);
    return;
  }
  if(Array.isArray(value)){for(const item of [...value].reverse()){const result=findAgentResult(item,depth+1);if(result)return result;}return;}
  if(typeof value!=='object')return;
  const parsed=resultSchema.safeParse(value);if(parsed.success)return parsed.data;
  if(value.role!=='user')for(const key of ['result','output','data','content','text','payload','value','event']){const result=findAgentResult(value[key],depth+1);if(result)return result;}
}
// Backend boundary. The service supplies an adapter; no simulated replies.
export class AgentClient {
  constructor(projectId,initial={}) {
    this.storageKey=projectId?`3d-box:agent-session:${projectId}`:'3d-box:agent-session';
    try { this.state = JSON.parse(localStorage.getItem(this.storageKey)) || {}; } catch { this.state = {}; }
    if(projectId)this.state.projectId=projectId;
    if(initial.sessionId)this.state.sessionId=initial.sessionId;
    if(initial.messages)this.state.messages=initial.messages;
    if(initial.latestRun){this.state.activeRun=initial.latestRun;this.state.runStatus=initial.latestRun.status;this.state.eventSeq=initial.latestRun.eventSeq;}
    else if(initial.runStatus){this.state.activeRun=null;this.state.runStatus=initial.runStatus;this.state.eventSeq=0;}
    this.generationSettings=initial.generationSettings;
    this.state.messages ||= [];
    this.state.projectId ||= crypto.randomUUID();
    for(const message of this.state.messages)if(message.toolStatus==='running'&&this.state.runStatus!=='running'){message.toolStatus='interrupted';message.text=`执行已中断 ${message.toolName}`;}
    this.pending = false;
  }
  save() { try {localStorage.setItem(this.storageKey, JSON.stringify(this.state));} catch { /* Keep the live conversation usable if browser storage is full. */ } }
  needsRecovery(){const run=this.state.activeRun;return !!run&&(run.status==='running'||!!run.snapshotRevision&&!!run.result&&run.result.task_id!==this.state.lastAppliedTaskId);}
  async generate({prompt, reference, attachments=[],attachmentIds=[],attachmentParts=[],scene}, {signal, onEvent, onResult}) {
    signal.throwIfAborted();
    const adapter = globalThis.__3D_BOX_AGENT_ADAPTER__ || localAgentAdapter;
    if(attachments.length>12)throw Error('每次最多上传 12 个附件。');
    if(attachments.some(file=>file.size>20*1024*1024))throw Error('每个参考附件不能超过 20 MiB。');
    if (this.pending) throw Error('Agent 正在处理中。');
    const id = crypto.randomUUID(), runId = crypto.randomUUID();
    const message = {id, role:'user', text:prompt, reference, attachments:[...attachments.map(file=>({name:file.name,type:file.type})),...attachmentParts.map(part=>({name:part.name||'参考附件',kind:part.type,type:part.source?.mimeType,url:part.source?.value,assetId:part.assetId}))]};
    this.state.messages.push(message); this.save(); onEvent();
    this.state.activeRun={runId,status:'running'};this.state.runStatus='running';this.state.eventSeq=0;
    return this.consume({projectId:this.state.projectId,sessionId:this.state.sessionId,runId,messages:this.state.messages,prompt,reference,attachments,attachmentIds,generationSettings:this.generationSettings,scene},'generate',{signal,onEvent,onResult});
  }
  async resume(run,handlers){if(this.pending)throw Error('Agent 正在处理中。');return this.consume({projectId:this.state.projectId,sessionId:run.sessionId,runId:run.runId,afterSeq:run.eventSeq||0},'resume',handlers,run);}
  async cancel(){const adapter=globalThis.__3D_BOX_AGENT_ADAPTER__||localAgentAdapter;if(this.state.activeRun?.runId)await adapter.stop?.({projectId:this.state.projectId,runId:this.state.activeRun.runId});}
  async consume(request,method,{signal,onEvent,onResult},restored){
    const adapter=globalThis.__3D_BOX_AGENT_ADAPTER__||localAgentAdapter,runId=request.runId;this.pending=true;
    let queue = Promise.resolve(), failure, finished = false, closed = false;
    const seen = new Set();
    const emit = event => {
      if (signal.aborted || closed) return;
      if(event.seq){if(event.seq<=(this.state.eventSeq||0))return;this.state.eventSeq=event.seq;}
      if (event.type === 'SESSION') {this.state.sessionId = event.sessionId; this.save();}
      if(event.type==='RUN_STARTED'){this.state.runStatus='running';if(this.state.activeRun)this.state.activeRun.status='running';}
      if (event.type === 'RUN_ERROR') {failure = Error(event.message || 'Agent 生成失败。');this.state.runStatus='failed';if(this.state.activeRun)this.state.activeRun.status='failed';}
      if (event.type === 'RUN_FINISHED') {finished = true;this.state.runStatus='completed';if(this.state.activeRun)this.state.activeRun.status='completed';}
      if(event.type==='TOOL_CALL_START'){
        if(!this.state.messages.some(m=>m.id===event.toolCallId))this.state.messages.push({id:event.toolCallId,role:'tool',toolName:event.toolCallName,toolStatus:'running',text:`正在执行 ${event.toolCallName}`});
        this.save();onEvent();
      }
      if(event.type==='TOOL_CALL_END'){
        const item=this.state.messages.find(m=>m.id===event.toolCallId);
        if(item){item.toolStatus=event.error?'error':'completed';item.text=`${event.error?'执行失败':'已执行'} ${item.toolName}`;this.save();onEvent();}
      }
      if (event.type === 'TEXT_MESSAGE_CONTENT') {
        const key = event.messageId || `${runId}:assistant`;
        let item = this.state.messages.find(item=>item.id===key);
        if (!item) {item={id:key,role:'assistant',text:''};this.state.messages.push(item);}
        item.text += event.delta || ''; this.save(); onEvent();
      }
      if (event.type === 'MESSAGES_SNAPSHOT' && Array.isArray(event.messages)) {
        this.state.messages = event.messages.filter(m=>['user','assistant','tool'].includes(m.role)).map(m=>({...m,text:m.text || (typeof m.content==='string'?m.content:'')}));
        this.save(); onEvent();
      }
      if(event.type!=='RESULT'){
        const result=findAgentResult(event.type==='TEXT_MESSAGE_CONTENT'?this.state.messages.find(m=>m.id===(event.messageId||`${runId}:assistant`))?.text:event.type==='MESSAGES_SNAPSHOT'?event.messages:event);
        if(result)emit({type:'RESULT',result});
      }
      if (event.type === 'RESULT') {
        const result=event.result,key=[result.task_id,result.glb_url,result.collaboration_url].join('\0');
        if(this.state.activeRun){this.state.activeRun.result=result;if(event.snapshotRevision)this.state.activeRun.snapshotRevision=event.snapshotRevision;}
        if (!seen.has(key)&&this.state.lastAppliedTaskId!==result.task_id) {seen.add(key);queue=queue.then(async()=>{signal.throwIfAborted();await onResult(result,signal,event);this.state.lastAppliedTaskId=result.task_id;this.save();}); queue.catch(()=>{});}
      }
    };
    let abort;
    try {
      const aborted=new Promise((resolve,reject)=>{abort=()=>reject(signal.reason||new DOMException('Cancelled','AbortError'));signal.addEventListener('abort',abort,{once:true});});
      if(restored?.result)emit({type:'RESULT',result:restored.result,snapshotRevision:restored.snapshotRevision});
      const result = await Promise.race([adapter[method](request, {signal,emit}),aborted]);
      signal.throwIfAborted(); if (result) emit({type:'RESULT',result});
      await queue; if(failure) throw failure;
      if(!result && !finished && !seen.size) throw Error('Agent 连接已结束，未收到完成事件。');
    } finally {closed=true;signal.removeEventListener('abort',abort);await queue.catch(()=>{});if(signal.reason?.message!=='Detached')for(const item of this.state.messages)if(item.toolStatus==='running'){item.toolStatus='interrupted';item.text=`执行已中断 ${item.toolName}`;}this.save();onEvent();this.pending=false;}
  }
}
