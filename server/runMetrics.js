// Numeric, bounded diagnostics only: never retain prompts, tool arguments,
// response text, credentials or image pixels in performance records.
export function createRunMetrics({now=()=>performance.now()}={}) {
 const started=now(),stages={},counters={},models=new Map();let firstArtifactMs=null,firstOutputMs=null,model=null;
 const record=(name,ms,failed=false)=>{
  if(!Number.isFinite(ms)||ms<0)return;
  const item=stages[name]??={count:0,totalMs:0,maxMs:0,errors:0};item.count++;item.totalMs+=ms;item.maxMs=Math.max(item.maxMs,ms);if(failed)item.errors++;
 };
 const count=(name,value=1)=>{if(Number.isFinite(value))counters[name]=(counters[name]||0)+value;};
 const start=name=>{const at=now();let done=false;return (failed=false)=>{if(!done){done=true;record(name,now()-at,failed);}};};
 const measure=async(name,work)=>{const end=start(name);try{const value=await work();end();return value;}catch(error){end(true);throw error;}};
 return {
  record,count,start,measure,
  setModel(value){if(typeof value==='string')model=value.slice(0,160);},
  artifact(){firstArtifactMs??=now()-started;count('artifacts');},
  modelStart(id){if(!models.has(id))models.set(id,{at:now(),first:null});},
  modelChunk(id){const item=models.get(id);if(item&&item.first===null){item.first=now();record('model.firstOutput',item.first-item.at);firstOutputMs??=item.first-started;}},
  modelEnd(id,usage,error=false){
   const item=models.get(id);if(!item)return;models.delete(id);record('model.call',now()-item.at,error);count('model.calls');
   const input=usage?.input_tokens??usage?.prompt_tokens??usage?.promptTokens,output=usage?.output_tokens??usage?.completion_tokens??usage?.completionTokens;
   if(Number.isFinite(input)&&Number.isFinite(output)){count('model.usageReportedCalls');count('model.inputTokens',input);count('model.outputTokens',output);}
  },
  snapshot(){
   const rounded=Object.fromEntries(Object.entries(stages).map(([key,value])=>[key,{...value,totalMs:+value.totalMs.toFixed(3),maxMs:+value.maxMs.toFixed(3)}]));
   return {version:1,model,elapsedMs:+(now()-started).toFixed(3),firstArtifactMs,firstOutputMs,stages:rounded,counters:{...counters},tokens:counters['model.usageReportedCalls']?{input:counters['model.inputTokens'],output:counters['model.outputTokens'],reportedCalls:counters['model.usageReportedCalls']}:null};
  },
  finishModels(){for(const id of models.keys())this.modelEnd(id,null,true);},
 };
}

export function instrumentCheckpoint(saver,metrics){
 if(!metrics)return saver;
 for(const name of ['getTuple','put','putWrites','deleteThread','close']){
  const original=saver[name].bind(saver);
  saver[name]=(...args)=>metrics.measure('checkpoint.'+name,()=>original(...args));
 }
 return saver;
}
