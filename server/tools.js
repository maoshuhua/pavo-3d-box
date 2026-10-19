import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {tool} from '@langchain/core/tools';
import {ToolMessage} from '@langchain/core/messages';
import {z} from 'zod';
import {BASE,MAX_GLB} from './config.js';
import {atomicWrite,sha256} from './storage.js';
import {workspaceTarget,listWorkspace,readWorkspace,grepWorkspace,writeWorkspace,editWorkspace} from './workspace.js';
import {evaluateProgram} from './program.js';
import {renderCall} from './renderService.js';

export function createSceneTools(ctx){
 const {dir,emit,signal,projectId}=ctx;
 let current=ctx.current,toolQueue=Promise.resolve();
 const notify=(name,fn,schema,description)=>tool(async(args,config)=>{
  const run=toolQueue.catch(()=>{}).then(async()=>{
  const callId=config?.toolCall?.id||crypto.randomUUID();
  if(!ctx.streamedToolIds?.has(callId)){
   emit({type:'TOOL_CALL_START',toolCallId:callId,toolCallName:name});
   emit({type:'TOOL_CALL_ARGS',toolCallId:callId,delta:JSON.stringify(args)});
  }
  try {
   signal.throwIfAborted();
   if(ctx.finalizing)throw Error('本轮构建和关键帧检查已结束，请仅总结实际成功产物与仍存在的问题，不再调用工具。');
   const value=await fn(args,callId);signal.throwIfAborted();
   emit({type:'TOOL_CALL_END',toolCallId:callId});
   const content=value instanceof ToolMessage?(Array.isArray(value.content)?value.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):value.content):JSON.stringify(value);
   emit({type:'TOOL_CALL_RESULT',messageId:crypto.randomUUID(),toolCallId:callId,content});
   return value;
  }catch(error){
   if(signal.aborted)throw error;
   const result={status:'error',error:error.message};
   emit({type:'TOOL_CALL_END',toolCallId:callId,error:error.message});
   emit({type:'TOOL_CALL_RESULT',messageId:crypto.randomUUID(),toolCallId:callId,content:JSON.stringify(result),error:error.message});
   return JSON.stringify(result);
  }
  });
  toolQueue=run;return run;
 },{name,schema,description});
 const source=z.string().max(1024*1024), virtual=z.string().describe('Virtual project file path, normally /scene.js');
 const directory=z.string().default('/').describe('Virtual workspace directory; / lists the project workspace, never the host filesystem.');
 return [
  notify('x_list',args=>listWorkspace(dir,args,signal),z.object({path:directory,recursive:z.boolean().default(false),max_entries:z.number().int().min(1).max(1000).default(200)}),'List files and directories in this project workspace. Use / to discover scene.js, context.json and scene-api.txt. Returns virtual paths, types, file sizes and truncation status. Never accesses host files or symbolic links.'),
  notify('x_read',args=>readWorkspace(dir,args,signal),z.object({path:virtual,offset:z.number().int().nonnegative().default(0),column:z.number().int().min(0).max(32*1024*1024).default(0),limit:z.number().int().min(1).max(1000).default(300)}),'Read a workspace text file with 1-based line numbers. offset is a 0-based line offset; column is a 0-based character offset in the first line; limit is the maximum number of lines. Use for /context.json, /scene-api.txt and /scene.js. Returns totalLines, offset, content, truncated and, when truncated, a next:{offset,column} cursor to continue even a long line.'),
  notify('x_write',args=>writeWorkspace(dir,args),z.object({path:virtual,content:source,overwrite:z.boolean().default(false)}),'Write a scene program into the project workspace. Use self-contained function build(ctx), returning the documented scene JSON specification. No imports, Three.js calls, shell or network inside the program. Context and scene API files are read-only.'),
  notify('x_edit',args=>editWorkspace(dir,args),z.object({path:virtual,old_string:source,new_string:source,replace_all:z.boolean().default(false)}),'Apply an exact text edit to an existing scene program. Ambiguous matches are rejected. Read the current program before editing. Context and scene API files are read-only.'),
  notify('x_grep',args=>grepWorkspace(dir,args,signal),z.object({pattern:z.string().min(1).max(1000).describe('Literal text to search, not a regular expression.'),path:z.string().default('/').describe('Virtual workspace file or directory to search.'),case_sensitive:z.boolean().default(true),max_results:z.number().int().min(1).max(1000).default(100)}),'Find literal text in a workspace file or recursively in a directory. Returns matches with virtual path, 1-based line and text, plus truncated. Use to locate stable node IDs and code before x_read/x_edit. No regex or shell execution.'),
  notify('build_3D_scene',async({source:virtualPath})=>{
   const sourceCode=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');
   const baseJson=current?.json||ctx.sceneJson;
   const spec=await evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal);
   const built=await renderCall('compile',{spec,baseUrl:current?.result?.glb_url||ctx.baseUrl,baseJson,assets:ctx.assets},signal);
   const bytes=Buffer.from(built.glb,'base64');if(bytes.length>MAX_GLB)throw Error('GLB exceeds 100 MiB');
   if(JSON.stringify(built.json).length>0x1400000)throw Error('Collaboration JSON exceeds limit');
   const taskId=crypto.randomUUID(),out=path.join(dir,'artifacts',taskId);await fs.mkdir(out,{recursive:true});
   const prefix=`${BASE}/artifacts/${projectId}/${taskId}`;
   const result={status:'completed',task_id:taskId,source:virtualPath,source_sha256:sha256(sourceCode),source_hash:sha256(sourceCode),baseline_revision:sha256(JSON.stringify(baseJson)),glb_url:prefix+'/model.glb',collaboration_url:prefix+'/collaboration.json',glb_size:bytes.length,glb_sha256:sha256(bytes),triangles:built.triangles};
   // Publish only after both immutable files exist.
   await atomicWrite(path.join(out,'model.glb'),bytes);await atomicWrite(path.join(out,'collaboration.json'),JSON.stringify(built.json));
   await atomicWrite(path.join(out,'result.json'),JSON.stringify(result));
   await ctx.onBuild?.({result,json:built.json,bytes});
   current={result,json:built.json};ctx.current=current;
   ctx.completedBuilds=(ctx.completedBuilds||0)+1;ctx.previewChecks=[];
   await atomicWrite(path.join(dir,'latest-build.json'),JSON.stringify(current));
   emit({type:'RESULT',result});return result;
  },z.object({source:virtual.default('/scene.js')}),'Compile the workspace scene program into validated editable GLB and collaboration JSON. Returns completed/task_id/glb_url/collaboration_url/glb_size/glb_sha256/triangles. Each successful build is immediately delivered to the user. Fix source errors and rebuild if needed.'),
  notify('preview_3D_scene',async({target,source:virtualPath,camera_id,time,frames},callId)=>{
   const selected=target||(current?'build':'draft');
   const requests=frames||[{camera_id,time}];
   let rendered,sourceHash,baselineRevision,taskId;
   if(selected==='draft'){
    const sourceCode=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');
    const baseJson=current?.json||ctx.sceneJson;
    sourceHash=sha256(sourceCode);baselineRevision=sha256(JSON.stringify(baseJson));
    const spec=await evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal);
    rendered=await renderCall('draftPreview',{spec,baseUrl:current?.result?.glb_url||ctx.baseUrl,baseJson,assets:ctx.assets,frames:requests.map(f=>({cameraId:f.camera_id,time:f.time}))},signal);
    taskId=crypto.randomUUID();
   }else{
    if(!current)throw Error('No exported build exists. Use target:"draft" to preview source before building.');
    sourceHash=current.result.source_sha256;baselineRevision=current.result.baseline_revision;taskId=current.result.task_id;
    const bytes=await fs.readFile(path.join(dir,'artifacts',taskId,'model.glb'));
    rendered=await renderCall('previewBatch',{glb:bytes.toString('base64'),json:current.json,frames:requests.map(f=>({cameraId:f.camera_id,time:f.time}))},signal);
   }
   const out=path.join(dir,'artifacts',taskId);await fs.mkdir(out,{recursive:true});
   const saved=[],refs=[];
   for(const frame of rendered.frames){
    const filename=`preview-${crypto.randomUUID()}.png`;
    await atomicWrite(path.join(out,filename),Buffer.from(frame.image,'base64'));
    const data={status:'completed',target:selected,task_id:taskId,source_hash:sourceHash,baseline_revision:baselineRevision,camera_id:frame.cameraId,time:frame.time,width:frame.width,height:frame.height,image_url:`${BASE}/artifacts/${projectId}/${taskId}/${filename}`};
    saved.push(data);refs.push({taskId,file:filename,cameraId:frame.cameraId,time:frame.time});
    if(selected==='build')(ctx.previewChecks||=[]).push(data);
    emit({type:'PREVIEW',...data});
   }
   return new ToolMessage({tool_call_id:callId,content:JSON.stringify(frames?{status:'completed',target:selected,frames:saved}:saved[0]),artifact:{previewRefs:refs}});
  },z.object({target:z.enum(['draft','build']).optional().describe('draft previews current source without exporting or replacing the saved scene; build checks an exported GLB.'),source:virtual.default('/scene.js'),camera_id:z.string().optional(),time:z.number().min(0).max(600).default(0),frames:z.array(z.object({camera_id:z.string().optional(),time:z.number().min(0).max(600)})).min(1).max(12).optional()}),'Render actual source draft or exported build frames. Use target:draft before the first build to inspect and repair composition, motion and occlusion cheaply. Batch up to 12 camera/time samples. Explicit invalid camera IDs fail. Draft previews never publish a scene result or replace the saved project. Build previews verify the actual delivery artifact.'),
 ];
}
