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
import {timelineCameraId} from '../src/timelineCamera.js';

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
  notify('coding_todo_write',async args=>({status:'completed',state:directorSummary(await (await director()).apply(args))}),codingTodoToolSchema,'Persist directing plan, outcome tasks and evidence-based reviews. set_plan accepts plan AND initial tasks in one atomic call. record_reviews accepts reviews AND task updates in one atomic call, including completed inspection or corrective work after failure. update_tasks remains available. read is for recovery; successful responses already contain current evidence and missingFrames. Mutations require unique requestId. Evidence IDs must be issued by actual previews/builds, never invented.'),
  notify('build_3D_scene',async({source:virtualPath})=>{
   if(!(await director()).state.plan)throw Error('Set a director plan and initial tasks, then build to display the first playable scene.');
   const sourceCode=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');
   const baseJson=baselineJson;
   const spec=await evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal);
   // Retrying an unchanged export must not replace its identity or discard
   // current frame/review evidence. Verify the actual file before reusing it.
   if(current?.result.source_sha256===sha256(sourceCode)&&current.result.spec_sha256===sha256(JSON.stringify(spec))&&current.result.baseline_revision===sceneBinding(spec,baseJson)){
    const bytes=await fs.readFile(path.join(dir,'artifacts',current.result.task_id,'model.glb')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(bytes&&sha256(bytes)===current.result.glb_sha256){
     const state=ctx.director.snapshot();
     const evidence=state.currentBuild?.taskId===current.result.task_id&&state.currentBuild.planRevision===state.planRevision
      ?state.evidence.find(e=>e.id===state.currentBuild.evidenceId)
      :await ctx.director.registerBuild({taskId:current.result.task_id,sourceHash:current.result.source_sha256,baselineRevision:current.result.baseline_revision,json:current.json,artifactHash:current.result.glb_sha256});
     // An edit followed by an undo may have invalidated the source binding.
     await ctx.director.noteSource({sourceHash:current.result.source_sha256,baselineRevision:current.result.baseline_revision});
     ctx.activeSourcePath=virtualPath;
     return {...current.result,source:virtualPath,reused:true,evidence_id:evidence.id,checks:evidence.checks,required_frames:ctx.director.snapshot().requiredFrames,missing_frames:ctx.director.missingFrames()};
    }
   }
   const buildBudget=ctx.executionBudget?.check('builds');if(buildBudget&&!buildBudget.allowed){ctx.finishReason='本轮交付构建预算已用完。';throw Error(ctx.finishReason);}
   const built=await renderCall('compile',{spec,baseUrl:baselineUrl,baseJson,assets:ctx.assets},signal);
   const bytes=Buffer.from(built.glb,'base64');if(bytes.length>MAX_GLB)throw Error('GLB exceeds 100 MiB');
   if(JSON.stringify(built.json).length>0x1400000)throw Error('Collaboration JSON exceeds limit');
   const taskId=crypto.randomUUID(),out=path.join(dir,'artifacts',taskId);await fs.mkdir(out,{recursive:true});
   const prefix=`${BASE}/artifacts/${projectId}/${taskId}`;
   const result={status:'completed',task_id:taskId,source:virtualPath,source_sha256:sha256(sourceCode),source_hash:sha256(sourceCode),spec_sha256:sha256(JSON.stringify(spec)),baseline_revision:sceneBinding(spec,baseJson),glb_url:prefix+'/model.glb',collaboration_url:prefix+'/collaboration.json',glb_size:bytes.length,glb_sha256:sha256(bytes),triangles:built.triangles};
   // Publish only after both immutable files exist.
   await atomicWrite(path.join(out,'model.glb'),bytes);await atomicWrite(path.join(out,'collaboration.json'),JSON.stringify(built.json));
   await atomicWrite(path.join(out,'result.json'),JSON.stringify(result));
   await ctx.onBuild?.({result,json:built.json,bytes});
   current={result,json:built.json};ctx.current=current;ctx.activeSourcePath=virtualPath;
   ctx.executionBudget?.consume('builds');
   ctx.completedBuilds=(ctx.completedBuilds||0)+1;ctx.previewChecks=[];
   await atomicWrite(path.join(dir,'latest-build.json'),JSON.stringify(current));
   if(ctx.director){const evidence=await ctx.director.registerBuild({taskId,sourceHash:result.source_sha256,baselineRevision:result.baseline_revision,json:built.json,artifactHash:result.glb_sha256});result.evidence_id=evidence.id;result.required_frames=ctx.director.snapshot().requiredFrames;result.missing_frames=ctx.director.missingFrames();result.checks=evidence.checks;}
   emit({type:'RESULT',result});return result;
  },z.object({source:virtual.default('/scene.js')}),'Build FIRST after source is ready: validate and export editable GLB/JSON, immediately showing the playable scene to the user while inspection continues. Then preview the exported build and fix concrete failures together. Returns evidence_id, structural checks and missing_frames. Unchanged source/baseline reuses the verified export and its evidence; do not rebuild without edits.'),
  notify('preview_3D_scene',async({target,source:virtualPath,camera_id,time,frames},callId)=>{
   const selected=target||'build';
   let requests=frames||[{camera_id,time:time??0}],rendered,sourceHash,baselineRevision,taskId,sourceEvidence;
   const cached=[];
   const checkBudget=count=>{
    const budget=ctx.executionBudget?.check(selected==='draft'?'draftFrames':'deliveryFrames',count);
    if(budget&&!budget.allowed){ctx.finishReason='本轮预览帧预算已用完。';throw Error(ctx.finishReason);}
   };
   requests=requests.filter((frame,index)=>requests.findIndex(other=>other.camera_id===frame.camera_id&&other.time===frame.time)===index);
   if(selected==='draft'){
    const sourceCode=await fs.readFile((await workspaceTarget(dir,virtualPath)).file,'utf8');
    const baseJson=baselineJson;
    sourceHash=sha256(sourceCode);
    const spec=await evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal);
    baselineRevision=sceneBinding(spec,baseJson);
    checkBudget(requests.length);
    rendered=await renderCall('draftPreview',{spec,baseUrl:baselineUrl,baseJson,assets:ctx.assets,frames:requests.map(f=>({cameraId:f.camera_id,time:f.time}))},signal);
    taskId=crypto.randomUUID();ctx.activeSourcePath=virtualPath;
    if(ctx.director)sourceEvidence=await ctx.director.registerDraft({sourceHash,baselineRevision,json:rendered.json});
   }else{
    if(!current)throw Error('No exported build exists. Call build_3D_scene first to display the playable scene.');
    sourceHash=current.result.source_sha256;baselineRevision=current.result.baseline_revision;taskId=current.result.task_id;
    const bytes=await fs.readFile(path.join(dir,'artifacts',taskId,'model.glb'));
    if(ctx.director){
     const authored=await fs.readFile((await workspaceTarget(dir,ctx.activeSourcePath||current.result.source||virtualPath)).file,'utf8');
     if(sha256(authored)!==sourceHash)throw Error('The exported GLB belongs to an earlier source. Build the current source before reviewing this delivery.');
     if(sha256(bytes)!==current.result.glb_sha256)throw Error('Exported GLB hash does not match its immutable build record. Rebuild before reviewing this delivery.');
     const state=ctx.director.snapshot();
     if(state.currentSource&&(state.currentSource.sourceHash!==sourceHash||state.currentSource.baselineRevision!==baselineRevision))throw Error('The exported GLB does not match the current source/baseline evidence. Build the current source before reviewing this delivery.');
     if(state.currentBuild?.taskId!==taskId||state.currentBuild.planRevision!==state.planRevision){
      sourceEvidence=await ctx.director.registerBuild({taskId,sourceHash,baselineRevision,json:current.json,artifactHash:current.result.glb_sha256});
     }else sourceEvidence=state.evidence.find(record=>record.id===state.currentBuild.evidenceId);
    }
    // Default to the server's missing coverage; callers can still request exact
    // action beats. Resolve implicit cameras before deduplicating and caching.
    if(!frames&&time===undefined&&camera_id===undefined&&ctx.director?.state.plan)requests=ctx.director.missingFrames().slice(0,12);
    const timeline=current.json.entities.find(e=>e.kind==='timeline')?.state.timeline;
    const cameras=current.json.entities.filter(e=>e.kind==='camera'&&!e.deleted);
    requests=requests.map(frame=>{
     if(Number.isFinite(timeline?.duration)&&frame.time>timeline.duration)throw Error('Time exceeds timeline duration '+timeline.duration);
     const id=frame.camera_id??timelineCameraId(timeline?.shots||[],frame.time,timeline?.duration??0);
     const camera=id===null||id===undefined?cameras[0]:cameras.find(e=>e.id===id);
     if(!camera)throw Error(id?'Preview camera not found: '+id:'Preview requires a camera');
     return {camera_id:camera.id,time:frame.time};
    }).filter((frame,index,all)=>all.findIndex(other=>other.camera_id===frame.camera_id&&other.time===frame.time)===index);
    const state=ctx.director?.snapshot(),pending=[];
    for(const request of requests){
     const evidence=state?.evidence.findLast(e=>e.kind==='frame'&&e.target==='build'&&e.planRevision===state.planRevision&&e.sourceHash===sourceHash&&e.baselineRevision===baselineRevision&&e.taskId===taskId&&e.cameraId===request.camera_id&&e.time===request.time);
     const filename=evidence?.imageUrl?.split('/').at(-1);
     let exists=false;
     if(filename&&/^preview-[\w-]+\.png$/.test(filename))try{await fs.access(path.join(dir,'artifacts',taskId,filename));exists=true;}catch{}
     if(exists)cached.push({status:'completed',target:selected,task_id:taskId,source_hash:sourceHash,baseline_revision:baselineRevision,camera_id:request.camera_id,time:request.time,width:evidence.width,height:evidence.height,image_url:evidence.imageUrl,evidence_id:evidence.id,reused:true});
     else pending.push(request);
    }
    checkBudget(pending.length);
    rendered=pending.length?await renderCall('previewBatch',{glb:bytes.toString('base64'),json:current.json,frames:pending.map(f=>({cameraId:f.camera_id,time:f.time}))},signal):{frames:[]};
   }
   ctx.executionBudget?.consume(selected==='draft'?'draftFrames':'deliveryFrames',rendered.frames.length);
   const out=path.join(dir,'artifacts',taskId);await fs.mkdir(out,{recursive:true});
   const saved=[],refs=[];
   for(const frame of rendered.frames){
    const filename=`preview-${crypto.randomUUID()}.png`;
    await atomicWrite(path.join(out,filename),Buffer.from(frame.image,'base64'));
    const data={status:'completed',target:selected,task_id:taskId,source_hash:sourceHash,baseline_revision:baselineRevision,camera_id:frame.cameraId,time:frame.time,width:frame.width,height:frame.height,image_url:`${BASE}/artifacts/${projectId}/${taskId}/${filename}`};
    saved.push(data);
    if(selected==='build')(ctx.previewChecks||=[]).push(data);
    emit({type:'PREVIEW',...data});
   }
   if(ctx.director&&saved.length){const evidence=await ctx.director.registerFrames({target:selected,sourceHash,baselineRevision,taskId,frames:saved});evidence.forEach((record,i)=>saved[i].evidence_id=record.id);}
   const combined=[...saved,...cached].sort((a,b)=>requests.findIndex(f=>f.camera_id===a.camera_id&&f.time===a.time)-requests.findIndex(f=>f.camera_id===b.camera_id&&f.time===b.time));
   for(const frame of combined)refs.push({taskId:frame.task_id,file:frame.image_url.split('/').at(-1),cameraId:frame.camera_id,time:frame.time,evidenceId:frame.evidence_id});
   const batch=frames||time===undefined&&camera_id===undefined;
   const coverage=ctx.director?{missing_frames:ctx.director.missingFrames()}:{};
   return new ToolMessage({tool_call_id:callId,content:JSON.stringify({...(batch?{status:'completed',target:selected,frames:combined}:combined[0]),source_evidence_id:sourceEvidence?.id,...coverage,rendered_count:saved.length,reused_count:cached.length}),artifact:{previewRefs:refs}});
  },z.object({target:z.enum(['draft','build']).optional().describe('Default build after first export; draft is optional source debugging.'),source:virtual.default('/scene.js'),camera_id:z.string().optional(),time:z.number().min(0).max(600).optional(),frames:z.array(z.object({camera_id:z.string().optional(),time:z.number().min(0).max(600)})).min(1).max(12).optional()}),'Inspect the displayed GLB after build. With no camera/time/frames, render only missing required samples (up to 12), returning remaining missing_frames and evidence IDs. Exact duplicate current-build samples reuse saved pixels/evidence without rendering or consuming frame budget. Batch key action beats; only sample affected shots after concrete fixes. Source edits or new builds invalidate old frame evidence. target:draft is optional debugging, never a prerequisite for first build.'),
 ];
}
