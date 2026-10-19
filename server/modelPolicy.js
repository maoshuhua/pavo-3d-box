const positiveInteger=(value,fallback,min,max)=>{
 const parsed=Number(value);
 return Number.isSafeInteger(parsed)&&parsed>=min&&parsed<=max?parsed:fallback;
};

// Only explicitly supported provider extensions belong in a request. Unknown
// OpenAI-compatible providers receive the common chat parameters alone.
export function modelPolicy(model,env=process.env){
 let configured={};
 if(env.AGENT_MODEL_CAPABILITIES){
  try{configured=JSON.parse(env.AGENT_MODEL_CAPABILITIES);}
  catch{throw Error('AGENT_MODEL_CAPABILITIES must be a JSON object keyed by model name');}
  if(!configured||Array.isArray(configured)||typeof configured!=='object')throw Error('AGENT_MODEL_CAPABILITIES must be a JSON object keyed by model name');
 }
 const known=/^deepseek[-/]v?4[.]1(?:[-/]flash)?$/i.test(String(model))?{reasoningEfforts:['none','low','medium','high'],defaultEffort:'none'}:{};
 const capabilities=configured[model]??known;
 if(!capabilities||Array.isArray(capabilities)||typeof capabilities!=='object')throw Error('Selected model capabilities must be an object');
 const supported=Array.isArray(capabilities.reasoningEfforts)?capabilities.reasoningEfforts:[];
 const profile=String(env.AGENT_MODEL_PROFILE||'').trim();
 if(profile&&!['fast','balanced','quality'].includes(profile))throw Error('AGENT_MODEL_PROFILE must be fast, balanced, or quality');
 const explicit=String(env.AGENT_REASONING_EFFORT||'').trim();
 const preferred=explicit||(profile?{fast:'none',balanced:'low',quality:'high'}[profile]:capabilities.defaultEffort);
 if(explicit&&!supported.includes(explicit))throw Error('Configured reasoning effort is not declared supported for the selected model');
 const policy={
  maxTokens:positiveInteger(env.AGENT_MAX_TOKENS,32768,256,262144),
  timeout:positiveInteger(env.AGENT_MODEL_TIMEOUT_MS,180000,100,1800000),
  maxRetries:positiveInteger(env.AGENT_MODEL_RETRIES,0,0,3),
 };
 // LangChain 1.6 gates its reasoning field on its own OpenAI model-name list;
 // compatible provider names therefore require the verified wire parameter.
 if(preferred&&supported.includes(preferred))policy.modelKwargs={reasoning_effort:preferred};
 return policy;
}

export class ModelDeadlineError extends Error{
 constructor(ms){super(`Model call exceeded ${ms} ms including its response stream`);this.name='ModelDeadlineError';this.code='MODEL_CALL_TIMEOUT';}
}

// SDK request timeouts often stop at response headers. This deadline remains
// armed until the entire SSE body closes, including endless heartbeat streams.
export function deadlineFetch(totalMs,{fetchImpl=globalThis.fetch,onStart,onFinish}={}){
 if(!Number.isFinite(totalMs)||totalMs<=0)throw Error('A positive model call deadline is required');
 return async(input,init={})=>{
  const started=Date.now(),aborter=new AbortController();
  const signals=[init.signal,input instanceof Request?input.signal:undefined].filter(Boolean);
  let timer,reader,bodyController,finished=false;
  const finish=(outcome)=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   for(const signal of signals)signal.removeEventListener('abort',externalAbort);
   try{onFinish?.({outcome,elapsedMs:Date.now()-started});}catch{/* Telemetry must not alter transport or abort semantics. */}
  };
  const abort=(reason)=>{
   if(aborter.signal.aborted)return;
   aborter.abort(reason);
   bodyController?.error(reason);
   if(reader)reader.cancel(reason).catch(()=>{});
   finish(reason instanceof ModelDeadlineError?'timeout':'aborted');
  };
  const externalAbort=()=>abort(signals.find(signal=>signal.aborted)?.reason||new DOMException('Aborted','AbortError'));
  for(const signal of signals)signal.addEventListener('abort',externalAbort,{once:true});
  if(signals.some(signal=>signal.aborted)){externalAbort();throw aborter.signal.reason;}
  timer=setTimeout(()=>abort(new ModelDeadlineError(totalMs)),totalMs);
  try{onStart?.({deadlineMs:totalMs});}catch{/* Telemetry is optional. */}
  let stopWaiting;
  const interrupted=new Promise((_,reject)=>{
   stopWaiting=()=>reject(aborter.signal.reason);
   aborter.signal.addEventListener('abort',stopWaiting,{once:true});
  });
  try{
   const original=await Promise.race([fetchImpl(input,{...init,signal:aborter.signal}),interrupted]);
   aborter.signal.removeEventListener('abort',stopWaiting);
   aborter.signal.throwIfAborted();
   if(!original.body){finish('completed');return original;}
   reader=original.body.getReader();
   const body=new ReadableStream({
    start(controller){bodyController=controller;if(aborter.signal.aborted)controller.error(aborter.signal.reason);},
    async pull(controller){
     try{
      const next=await reader.read();
      if(aborter.signal.aborted)return;
      if(next.done){controller.close();finish('completed');}
      else controller.enqueue(next.value);
     }catch(error){controller.error(error);finish('failed');}
    },
    async cancel(reason){finish('cancelled');await reader.cancel(reason);},
   });
   const response=new Response(body,{status:original.status,statusText:original.statusText,headers:original.headers});
   for(const key of ['url','redirected','type'])Object.defineProperty(response,key,{value:original[key]});
   return response;
  }catch(error){aborter.signal.removeEventListener('abort',stopWaiting);finish(aborter.signal.aborted?(aborter.signal.reason instanceof ModelDeadlineError?'timeout':'aborted'):'failed');throw aborter.signal.aborted?aborter.signal.reason:error;}
 };
}
