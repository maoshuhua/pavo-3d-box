import {apiBase as base,resolveServiceData} from './serviceUrls.js';
const pause=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
async function state(request,signal){const response=await fetch(`${base}/api/agent/runs/${request.runId}?projectId=${encodeURIComponent(request.projectId)}`,{signal});if(response.status===404)return null;if(!response.ok)throw Error('任务状态读取失败');return (await response.json()).data;}
async function observe(request,{signal,emit},initialResponse){
 let cursor=request.afterSeq||0,response=initialResponse,terminal=false,retry=0;
 const consume=event=>{if(event.seq){if(event.seq<=cursor)return;cursor=event.seq;}if(['RUN_FINISHED','RUN_ERROR'].includes(event.type))terminal=true;emit(resolveServiceData(event));};
 for(;;){
  signal.throwIfAborted();
  try{
   response??=await fetch(`${base}/api/agent/runs/${request.runId}/events?projectId=${encodeURIComponent(request.projectId)}&afterSeq=${cursor}`,{signal});
   if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.msg||error.error||'无法订阅任务');}
   if(!response.body)throw Error('Agent 服务未返回事件流');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);if(line.startsWith('data:'))consume(JSON.parse(line.slice(5)));}if(done)break;}if(buffer.startsWith('data:'))consume(JSON.parse(buffer.slice(5)));}
   finally{reader.releaseLock();}
   if(terminal)return;
   const latest=await state(request,signal);
   if(latest&&latest.status!=='running'){if(latest.result)emit({type:'RESULT',result:resolveServiceData(latest.result),snapshotRevision:latest.snapshotRevision});emit(['completed','partial','cancelled'].includes(latest.status)?{type:'RUN_FINISHED',status:latest.status,outcome:latest.outcome,message:latest.message}:{type:'RUN_ERROR',message:latest.error||'任务已中断'});return;}
   retry=0;
  }catch(error){if(signal.aborted)throw error;}
  response=null;await pause(Math.min(5000,500*2**Math.min(retry++,4)),signal);
 }
}
export const localAgentAdapter={
 requiresCommittedResults:true,
 baseUrl:base,
 async generate(request,{signal,emit}){
  const form=new FormData();form.set('payload',JSON.stringify({projectId:request.projectId,sessionId:request.sessionId,runId:request.runId,prompt:request.prompt,reference:request.reference,messages:request.messages.slice(-1),attachmentIds:request.attachmentIds,generationSettings:request.generationSettings,sceneJson:request.scene.json}));form.set('scene',new Blob([request.scene.bytes],{type:'model/gltf-binary'}),'current.glb');for(const file of request.attachments)form.append('attachments',file,file.name);
  let response;
  for(let retry=0;!response;retry++){
   signal.throwIfAborted();
   try{response=await fetch(`${base}/api/agent/run`,{method:'POST',body:form,signal});}
   catch(error){if(signal.aborted)throw error;try{if(await state(request,signal))return observe(request,{signal,emit});}catch{}await pause(Math.min(5000,500*2**Math.min(retry,4)),signal);}
  }
  if(!response.ok){const value=await response.json().catch(()=>({}));throw Error(value.error||value.msg||`Agent 服务错误 ${response.status}`);}
  return observe(request,{signal,emit},response);
 },
 async resume(request,handlers){return observe(request,handlers);},
 async stop(request){const response=await fetch(`${base}/api/agent/runs/${request.runId}?projectId=${encodeURIComponent(request.projectId)}`,{method:'DELETE'});if(!response.ok)throw Error('停止任务失败，请确认本地服务连接。');}
};
