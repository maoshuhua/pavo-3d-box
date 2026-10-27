import {requestBase,publicServiceData} from './serviceUrls.js';
// Socket/SSE connections observe a run; only an explicit stop cancels it.
export function createRunEvents(store){
 const listeners=new Map();
 function publishMany(sessionId,runId,events){
  const frames=events.map(event=>({...event,runId,sessionId}));
  const sequences=store.recordEvents(sessionId,runId,frames);
  for(const [index,frame] of frames.entries()){
   frame.seq=sequences[index];
   for(const listener of listeners.get(runId)||[])try{listener(frame);}catch{listeners.get(runId)?.delete(listener);}
  }
  return frames;
 }
 const publish=(sessionId,runId,event)=>publishMany(sessionId,runId,[event])[0];
 function stream(req,res,projectId,runId,afterSeq=0){
  store.runDetail(projectId,runId);
  res.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
  let cursor=afterSeq,heartbeat;
  const cleanup=()=>{clearInterval(heartbeat);listeners.get(runId)?.delete(send);if(!listeners.get(runId)?.size)listeners.delete(runId);};
  const send=frame=>{if(res.destroyed||res.writableEnded||frame.seq<=cursor)return;cursor=frame.seq;res.write(`id: ${frame.seq}\ndata: ${JSON.stringify(publicServiceData(frame,requestBase(req)))}\n\n`);if(['RUN_FINISHED','RUN_ERROR'].includes(frame.type)){cleanup();res.end();}};
  if(!listeners.has(runId))listeners.set(runId,new Set());listeners.get(runId).add(send);
  res.on('close',cleanup);
  res.on('error',cleanup);
  for(const frame of store.runEvents(projectId,runId,cursor))send(frame);
  if(store.runDetail(projectId,runId).status!=='running'){cleanup();if(!res.writableEnded)res.end();return;}
  heartbeat=setInterval(()=>{if(!res.destroyed&&!res.writableEnded)res.write(': heartbeat\n\n');},15000);
 }
 return {publish,publishMany,stream};
}
