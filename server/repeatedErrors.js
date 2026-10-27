import crypto from 'node:crypto';

export function createRepeatedErrorTracker({stopAfter=3,maxEntries=128}={}){
 const recent=new Map();
 return {
  success(tool){recent.delete(tool);},
  failure(tool,result,inputKey){
   const normalized=JSON.stringify([tool,result.stage||'',result.groups?.map(g=>[g.path,g.code,g.message])||result.error])
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,'<id>').replace(/https?:\/\/[^\s"\\]+/g,'<url>');
   const fingerprint=crypto.createHash('sha256').update(normalized).digest('hex').slice(0,24),previous=recent.get(tool);
   const same=previous?.fingerprint===fingerprint;
   const count=same?previous.count+1:1,identicalInputCount=same&&previous.inputKey===inputKey?previous.identicalInputCount+1:1;
   const stop=identicalInputCount>=stopAfter;
   recent.delete(tool);if(recent.size>=maxEntries)recent.delete(recent.keys().next().value);
   recent.set(tool,{fingerprint,inputKey,count,identicalInputCount});
   return {fingerprint,count,identicalInputCount,stop,hint:stop?'相同输入连续失败，已停止重复执行；保留最近成功产物，请修正输入后再继续。':count>=2?'同类错误再次出现，请读取具体错误并改变修复方案，避免原样重试。':undefined};
  },
 };
}
