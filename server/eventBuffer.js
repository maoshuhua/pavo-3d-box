// Only adjacent deltas with the same identity may merge. All state transitions
// flush first, so published sequence numbers always describe durable events.
export function createEventBuffer({publishMany,onPersist=()=>{},onError=()=>{},intervalMs=50,maxBytes=32768,maxEvents=128}){
 let pending=[],bytes=0,timer,failure,closed=false;
 const flush=()=>{
  clearTimeout(timer);timer=undefined;
  if(failure)throw failure;if(!pending.length)return [];
  const frames=publishMany(pending);pending=[];bytes=0;onPersist(frames);return frames;
 };
 const schedule=()=>{timer??=setTimeout(()=>{try{flush();}catch(error){failure=error;onError(error);}},intervalMs);};
 return {
  emit(event){
   if(closed)throw Error('Event buffer is closed');if(failure)throw failure;
   const delta=['TEXT_MESSAGE_CONTENT','TOOL_CALL_ARGS'].includes(event.type)&&typeof event.delta==='string';
   if(!delta){flush();const frames=publishMany([event]);onPersist(frames);return frames[0];}
   const size=Buffer.byteLength(event.delta),last=pending.at(-1);
   if(last&&last.type===event.type&&last.messageId===event.messageId&&last.toolCallId===event.toolCallId)last.delta+=event.delta;
   else pending.push({...event});
   bytes+=size;
   if(bytes>=maxBytes||pending.length>=maxEvents)flush();else schedule();
  },
  flush,
  close(){if(closed)return;try{flush();}finally{closed=true;clearTimeout(timer);}},
 };
}
