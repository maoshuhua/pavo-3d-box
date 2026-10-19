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
import {CodingTodo,codingTodoToolSchema} from './codingTodo.js';
import {directorSummary} from './directorSummary.js';

export function createSceneTools(ctx){
 const {dir,emit,signal,projectId}=ctx;
 let current=ctx.current,toolQueue=Promise.resolve();
 // Source describes changes against this run's immutable input, never its own last output.
 const baselineJson=ctx.sceneJson||current?.json,baselineUrl=ctx.baseUrl||current?.result?.glb_url;
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
   const usage=ctx.executionBudget?.consume('tools');if(usage&&!usage.allowed){ctx.finishReason='工具调用预算已用完，保留最近成功产物。';throw Error(ctx.finishReason);}
   const value=await fn(args,callId);signal.throwIfAborted();ctx.executionBudget?.resetErrors();
   emit({type:'TOOL_CALL_END',toolCallId:callId});
   const content=value instanceof ToolMessage?(Array.isArray(value.content)?value.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):value.content):JSON.stringify(value);
   emit({type:'TOOL_CALL_RESULT',messageId:crypto.randomUUID(),toolCallId:callId,content});
   return value;
  }catch(error){
   if(signal.aborted)throw error;
   const budget=ctx.executionBudget;if(budget){budget.consume('consecutiveErrors');if(name==='build_3D_scene')budget.consume('buildFailures');const used=budget.status();if(used.used.consecutiveErrors>=used.limits.consecutiveErrors||used.used.buildFailures>=used.limits.buildFailures)ctx.finishReason='本轮连续工具错误或构建失败预算已用完，请按已保存证据说明受阻原因。';}
   const result={status:'error',error:error.message};
   emit({type:'TOOL_CALL_END',toolCallId:callId,error:error.message});
   emit({type:'TOOL_CALL_RESULT',messageId:crypto.randomUUID(),toolCallId:callId,content:JSON.stringify(result),error:error.message});
   return JSON.stringify(result);
  }
  });
  toolQueue=run;return run;
 },{name,schema,description});
 const director=async()=>ctx.director ||= await CodingTodo.open({...ctx,runId:ctx.runId ||= crypto.randomUUID()});
 const noteSource=async(virtualPath)=>{if(ctx.director){const code=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');await ctx.director.noteSource({sourceHash:sha256(code),baselineRevision:ctx.director.state.currentSource?.baselineRevision||'initial'});}};
 const sceneBinding=(spec,baseJson)=>sha256(JSON.stringify({base:spec.mode==='replace'?null:baseJson,assets:ctx.assets.map(a=>({id:a.id,kind:a.kind}))}));
 const source=z.string().max(1024*1024), virtual=z.string().describe('Virtual project file path, normally /scene.js');
 const directory=z.string().default('/').describe('Virtual workspace directory; / lists the project workspace, never the host filesystem.');
 return [
  notify('x_list',args=>listWorkspace(dir,args,signal),z.object({path:directory,recursive:z.boolean().default(false),max_entries:z.number().int().min(1).max(1000).default(200)}),'List files and directories in this project workspace. Use / to discover scene.js, context.json and scene-api.txt. Returns virtual paths, types, file sizes and truncation status. Never accesses host files or symbolic links.'),
  notify('x_read',args=>readWorkspace(dir,args,signal),z.object({path:virtual,offset:z.number().int().nonnegative().default(0),column:z.number().int().min(0).max(32*1024*1024).default(0),limit:z.number().int().min(1).max(1000).default(300)}),'Read a workspace text file with 1-based line numbers. offset is a 0-based line offset; column is a 0-based character offset in the first line; limit is the maximum number of lines. Use for /context.json, /scene-api.txt and /scene.js. Returns totalLines, offset, content, truncated and, when truncated, a next:{offset,column} cursor to continue even a long line.'),
  notify('x_write',async args=>{const result=await writeWorkspace(dir,args);if(args.path===(ctx.activeSourcePath||'/scene.js')||args.path===current?.result?.source)await noteSource(args.path);return result;},z.object({path:virtual,content:source,overwrite:z.boolean().default(false)}),'Write a scene program into the project workspace. Use self-contained function build(ctx), returning the documented scene JSON specification. No imports, Three.js calls, shell or network inside the program. Context and scene API files are read-only.'),
  notify('x_edit',async args=>{const result=await editWorkspace(dir,args);if(args.path===(ctx.activeSourcePath||'/scene.js')||args.path===current?.result?.source)await noteSource(args.path);return result;},z.object({path:virtual,old_string:source,new_string:source,replace_all:z.boolean().default(false)}),'Apply an exact text edit to an existing scene program. Ambiguous matches are rejected. Read the current program before editing. Context and scene API files are read-only.'),
  notify('x_grep',args=>grepWorkspace(dir,args,signal),z.object({pattern:z.string().min(1).max(1000).describe('Literal text to search, not a regular expression.'),path:z.string().default('/').describe('Virtual workspace file or directory to search.'),case_sensitive:z.boolean().default(true),max_results:z.number().int().min(1).max(1000).default(100)}),'Find literal text in a workspace file or recursively in a directory. Returns matches with virtual path, 1-based line and text, plus truncated. Use to locate stable node IDs and code before x_read/x_edit. No regex or shell execution.'),
  notify('coding_todo_write',async args=>({status:'completed',state:directorSummary(await (await director()).apply(args))}),codingTodoToolSchema,'Persist directing plan, outcome tasks and evidence-based reviews. op:read returns state; set_plan creates shots and criteria; update_tasks upserts tasks; record_reviews stores pass/fail/unverified observations separately. Mutations require unique requestId. A completed review may find failure. Evidence IDs must be issued by actual previews/builds, never invented.'),
  notify('build_3D_scene',async({source:virtualPath})=>{
   const buildBudget=ctx.executionBudget?.check('builds');if(buildBudget&&!buildBudget.allowed){ctx.finishReason='本轮交付构建预算已用完。';throw Error(ctx.finishReason);}
   if(!(await director()).state.plan)throw Error('Set a director plan before exporting. Source draft previews are available before build.');
   const sourceCode=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');
   const baseJson=baselineJson;
   const spec=await evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal);
   const built=await renderCall('compile',{spec,baseUrl:baselineUrl,baseJson,assets:ctx.assets},signal);
   const bytes=Buffer.from(built.glb,'base64');if(bytes.length>MAX_GLB)throw Error('GLB exceeds 100 MiB');
   if(JSON.stringify(built.json).length>0x1400000)throw Error('Collaboration JSON exceeds limit');
   const taskId=crypto.randomUUID(),out=path.join(dir,'artifacts',taskId);await fs.mkdir(out,{recursive:true});
   const prefix=`${BASE}/artifacts/${projectId}/${taskId}`;
   const result={status:'completed',task_id:taskId,source:virtualPath,source_sha256:sha256(sourceCode),source_hash:sha256(sourceCode),baseline_revision:sceneBinding(spec,baseJson),glb_url:prefix+'/model.glb',collaboration_url:prefix+'/collaboration.json',glb_size:bytes.length,glb_sha256:sha256(bytes),triangles:built.triangles};
   // Publish only after both immutable files exist.
   await atomicWrite(path.join(out,'model.glb'),bytes);await atomicWrite(path.join(out,'collaboration.json'),JSON.stringify(built.json));
   await atomicWrite(path.join(out,'result.json'),JSON.stringify(result));
   await ctx.onBuild?.({result,json:built.json,bytes});
   current={result,json:built.json};ctx.current=current;ctx.activeSourcePath=virtualPath;
   ctx.executionBudget?.consume('builds');
   ctx.completedBuilds=(ctx.completedBuilds||0)+1;ctx.previewChecks=[];
   await atomicWrite(path.join(dir,'latest-build.json'),JSON.stringify(current));
   if(ctx.director){const evidence=await ctx.director.registerBuild({taskId,sourceHash:result.source_sha256,baselineRevision:result.baseline_revision,json:built.json,artifactHash:result.glb_sha256});result.evidence_id=evidence.id;result.required_frames=ctx.director.snapshot().requiredFrames;}
   emit({type:'RESULT',result});return result;
  },z.object({source:virtual.default('/scene.js')}),'Compile the workspace scene program into validated editable GLB and collaboration JSON. Returns completed/task_id/glb_url/collaboration_url/glb_size/glb_sha256/triangles. Each successful build is immediately delivered to the user. Fix source errors and rebuild if needed.'),
  notify('preview_3D_scene',async({target,source:virtualPath,camera_id,time,frames},callId)=>{
   const selected=target||(current?'build':'draft');
   const requests=frames||[{camera_id,time}];
   const frameBudget=ctx.executionBudget?.check(selected==='draft'?'draftFrames':'deliveryFrames',requests.length);if(frameBudget&&!frameBudget.allowed){ctx.finishReason='本轮预览帧预算已用完。';throw Error(ctx.finishReason);}
   let rendered,sourceHash,baselineRevision,taskId,sourceEvidence;
   if(selected==='draft'){
    const sourceCode=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');
    const baseJson=baselineJson;
    sourceHash=sha256(sourceCode);
    const spec=await evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal);
    baselineRevision=sceneBinding(spec,baseJson);
    rendered=await renderCall('draftPreview',{spec,baseUrl:baselineUrl,baseJson,assets:ctx.assets,frames:requests.map(f=>({cameraId:f.camera_id,time:f.time}))},signal);
    taskId=crypto.randomUUID();ctx.activeSourcePath=virtualPath;
    if(ctx.director)sourceEvidence=await ctx.director.registerDraft({sourceHash,baselineRevision,json:rendered.json});
   }else{
    if(!current)throw Error('No exported build exists. Use target:"draft" to preview source before building.');
    sourceHash=current.result.source_sha256;baselineRevision=current.result.baseline_revision;taskId=current.result.task_id;
    const bytes=await fs.readFile(path.join(dir,'artifacts',taskId,'model.glb'));
    rendered=await renderCall('previewBatch',{glb:bytes.toString('base64'),json:current.json,frames:requests.map(f=>({cameraId:f.camera_id,time:f.time}))},signal);
   }
   ctx.executionBudget?.consume(selected==='draft'?'draftFrames':'deliveryFrames',requests.length);
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
   if(ctx.director){const evidence=await ctx.director.registerFrames({target:selected,sourceHash,baselineRevision,taskId,frames:saved});evidence.forEach((record,i)=>{saved[i].evidence_id=record.id;refs[i].evidenceId=record.id;});}
   return new ToolMessage({tool_call_id:callId,content:JSON.stringify(frames?{status:'completed',target:selected,source_evidence_id:sourceEvidence?.id,frames:saved}:{...saved[0],source_evidence_id:sourceEvidence?.id}),artifact:{previewRefs:refs}});
  },z.object({target:z.enum(['draft','build']).optional().describe('draft previews current source without exporting or replacing the saved scene; build checks an exported GLB.'),source:virtual.default('/scene.js'),camera_id:z.string().optional(),time:z.number().min(0).max(600).default(0),frames:z.array(z.object({camera_id:z.string().optional(),time:z.number().min(0).max(600)})).min(1).max(12).optional()}),'Render actual source draft or exported build frames. Use target:draft before the first build to inspect and repair composition, motion and occlusion cheaply. Batch up to 12 camera/time samples. Explicit invalid camera IDs fail. Draft previews never publish a scene result or replace the saved project. Build previews verify the actual delivery artifact.'),
 ];
}
