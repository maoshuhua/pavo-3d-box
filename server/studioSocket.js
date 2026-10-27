import {requestBase,publicServiceData} from './serviceUrls.js';
import {WebSocketServer,WebSocket} from 'ws';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {safeId} from './storage.js';
import {validateConfig} from './studioDatabase.js';

function emptyGlb(){const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]})),n=Math.ceil(json.length/4)*4,bytes=Buffer.alloc(20+n,32);bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(n,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);return bytes;}
export function attachStudioSocket(server,store,allowedOrigin){
 const sockets=new WebSocketServer({noServer:true,maxPayload:2*1024*1024});
 server.on('upgrade',(req,socket,head)=>{
  try{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/ws'||!allowedOrigin(req.headers.origin,req))throw Error();const projectId=safeId(url.searchParams.get('project_id'));store.detail(projectId);sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws,projectId,url,req));}catch{socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 sockets.on('connection',(ws,projectId,url,req)=>{
  let active;const send=event=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(publicServiceData(event,requestBase(req))));};
  const relay=async response=>{response=await response;if(!response.ok){const error=await response.json();throw Error(error.msg||error.error);}const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';try{for(;;){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.startsWith('data:')){const frame=JSON.parse(line.slice(5));send({...frame,threadId:frame.sessionId});}}if(done)break;}}finally{reader.releaseLock();}};
  let latest;try{latest=url.searchParams.get('run_id')?store.runDetail(projectId,safeId(url.searchParams.get('run_id'))):store.history(projectId).latestRun;}catch{ws.close(1008);return;}
  if(latest&&(latest.status==='running'||url.searchParams.has('run_id'))){
   const controller=new AbortController();active=controller;const after=Number(url.searchParams.get('after_seq')||0);
   if(!Number.isSafeInteger(after)||after<0){ws.close(1008);return;}
   relay(awaitableFetch()).catch(error=>{if(!controller.signal.aborted)send({type:'RUN_ERROR',message:error.message});}).finally(()=>{if(active===controller)active=null;});
   async function awaitableFetch(){return fetch(`http://127.0.0.1:${server.address().port}/api/agent/runs/${latest.runId}/events?projectId=${projectId}&afterSeq=${after}`,{signal:controller.signal});}
  }
  ws.on('message',async raw=>{
   let sessionId,runId;
   try{
    const frame=JSON.parse(raw.toString());if(String(frame.type).toLowerCase()==='ping'){send({type:'pong'});return;}if(active)throw Error('该连接已有任务正在运行');
    sessionId=safeId(frame.threadId);store.history(projectId,sessionId);
    const user=frame.messages?.at(-1);if(user?.role!=='user'||typeof user.content!=='string')throw Error('缺少用户消息');
    let parts;try{parts=JSON.parse(user.content);}catch{}if(!Array.isArray(parts))parts=[{type:'text',text:user.content}];
    const prompt=parts.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'),attachmentIds=[];
    for(const part of parts.filter(p=>['image','document'].includes(p.type))){const url=new URL(part.source?.value);const id=url.pathname.match(/^\/local-assets\/([\w-]+)$/)?.[1];if(!id||!allowedOrigin(url.origin,req))throw Error('仅支持本地参考素材');attachmentIds.push(id);}
    const root=JSON.parse(store.detail(projectId).config),extra=frame.forwardedProps?.extra||{},generationSettings={aspectRatio:extra.aspect_ratio||root.animationPreview?.generationSettings?.aspectRatio||'16:9',durationSeconds:extra.duration_seconds??root.animationPreview?.generationSettings?.durationSeconds??'auto',agentMode:extra.agent_mode||root.animationPreview?.generationSettings?.agentMode||'G6'};validateConfig(JSON.stringify({animationPreview:{version:1,generationSettings}}));
    const snapshot=store.snapshot(projectId),sceneJson=snapshot?JSON.parse(await fs.readFile(snapshot.json_path,'utf8')):{version:1,entities:[{id:'world',kind:'world',state:{settings:{type:'solid',color:[.22,.24,.27],strength:2}}}],operations:[]};
    const bytes=snapshot?await fs.readFile(snapshot.glb_path):emptyGlb(),body=new FormData();runId=crypto.randomUUID();body.set('payload',JSON.stringify({projectId,sessionId,runId,prompt,sceneJson,generationSettings,attachmentIds,messages:[{id:user.id||crypto.randomUUID(),role:'user',text:prompt}]}));body.set('scene',new Blob([bytes]),'current.glb');
    const controller=new AbortController();active=controller;
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/agent/run`,{method:'POST',body,signal:controller.signal});if(!response.ok){const error=await response.json();throw Error(error.msg||error.error);}
    await relay(response);
   }catch(e){send({type:'RUN_ERROR',threadId:sessionId,runId,message:e.message});}finally{active=null;}
  });
  ws.on('close',()=>active?.abort());ws.on('error',()=>active?.abort());
 });
 return sockets;
}
