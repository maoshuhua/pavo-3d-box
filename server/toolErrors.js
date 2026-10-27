import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWrite} from './storage.js';

const clip=(value,max=400)=>String(value).slice(0,max);
const fieldPath=(parts,wildcard=false)=>parts.map((p,i)=>typeof p==='number'?`[${wildcard?'*':p}]`:`${i?'.':''}${clip(p,80)}`).join('');

// Never read Zod's message/stack here: those serialize every repeated issue.
export function summarizeToolError(error){
 const issues=Array.isArray(error?.issues)?error.issues:null;
 if(!issues){
  const result={status:'error',error:clip(error?.message||error,1200),...(error?.stage?{stage:clip(error.stage,80)}:{}),...(error?.diagnostics?{diagnostics:error.diagnostics.slice(0,12).map(d=>({type:clip(d.type,30),message:clip(d.message,300)}))}: {})};
  while(Buffer.byteLength(JSON.stringify(result))>7800&&result.diagnostics?.length)result.diagnostics.pop();
  return result;
 }
 const grouped=new Map();
 for(const issue of issues){
  const field=fieldPath(issue.path||[],true),message=clip(issue.message);
  const key=JSON.stringify([field,issue.code,issue.expected,message]);
  let group=grouped.get(key);
  if(!group){group={path:field,code:issue.code,message,count:0,examples:[]};grouped.set(key,group);}
  group.count++;
  if(group.examples.length<3)group.examples.push(clip(fieldPath(issue.path||[]),240));
 }
 const groups=[];
 for(const group of grouped.values()){
  if(groups.length===10)break;
  if(group.path.endsWith('.values[*]')&&group.code==='invalid_type')group.hint='values 必须是扁平数字数组，例如 [x0,y0,z0,x1,y1,z1]。';
  if(group.path.endsWith('.material')&&group.code==='unrecognized_keys')group.hint='使用 metallic；透明度用 baseColor 的第 4 项；仅提交 scene-api.txt 支持的字段。';
  groups.push(group);
 }
 const result={status:'error',stage:'validate',error:`场景校验失败：${issues.length} 项问题，${grouped.size} 类。`,issueCount:issues.length,groups,omittedGroups:grouped.size-groups.length};
 while(Buffer.byteLength(JSON.stringify(result))>7800&&groups.length){groups.pop();result.omittedGroups=grouped.size-groups.length;}
 return result;
}

export async function reportToolError(error,dir,toolName){
 const result=summarizeToolError(error),logId=crypto.randomUUID();
 try{
  const detail=Array.isArray(error?.issues)?{issues:error.issues}:{message:String(error?.message||error),stack:error?.stack,stage:error?.stage,diagnostics:error?.diagnostics,cause:error?.cause?.stack};
  await atomicWrite(path.join(dir,'errors',`${logId}.json`),JSON.stringify({logId,toolName,createdAt:new Date().toISOString(),...detail}));
  result.logId=logId;
 }catch{result.logSaved=false;}
 return result;
}
