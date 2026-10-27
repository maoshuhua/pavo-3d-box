import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {tool} from '@langchain/core/tools';
import {ToolMessage} from '@langchain/core/messages';
import {z} from 'zod';
import {BASE,MAX_GLB} from './config.js';
import {atomicWrite,sha256} from './storage.js';
import {listWorkspace,readWorkspace,grepWorkspace,writeWorkspace,editWorkspace,copyWorkspace} from './workspace.js';
import {evaluateProgram} from './program.js';
import {renderCall} from './renderService.js';
import {reportToolError} from './toolErrors.js';
import {createToolScheduler} from './toolScheduler.js';
import {loadSceneProgram} from './sceneModules.js';
import {declareTaskIntent,sceneAcceptance,previewCheckKey} from './reviewCompletion.js';
import {createRepeatedErrorTracker} from './repeatedErrors.js';
import {resolvePreviewFrames,missingPreviewFrames} from './previewPlan.js';

export function createSceneTools(ctx,{render=renderCall}={}){
 const {dir,emit,signal,projectId}=ctx;
 let current=ctx.current;const schedule=createToolScheduler(),errors=createRepeatedErrorTracker();
 const timed=(name,work)=>ctx.metrics?ctx.metrics.measure(name,work):work();
 const renderTimed=(method,args)=>render(method,args,signal,{onTiming:(name,ms)=>ctx.metrics?.record('render.'+name,ms)});
 const notify=(name,fn,schema,description)=>tool(async(args,config)=>{
  const queuedAt=performance.now();
  const resources=name==='x_copy'?[args.source,args.destination]:['x_write','x_edit','x_read'].includes(name)?[args.path]:null;
  return schedule(resources,async()=>{
  ctx.metrics?.record('tool.queue.'+name,performance.now()-queuedAt);
  const end=ctx.metrics?.start('tool.'+name);let failed=false;
  const callId=config?.toolCall?.id||crypto.randomUUID();
  if(!ctx.streamedToolIds?.has(callId)){
   emit({type:'TOOL_CALL_START',toolCallId:callId,toolCallName:name});
   emit({type:'TOOL_CALL_ARGS',toolCallId:callId,delta:JSON.stringify(args)});
  }
  try {
   signal.throwIfAborted();
   if(ctx.finalizing)throw Error('本轮构建和关键帧检查已结束，请仅总结实际成功产物与仍存在的问题，不再调用工具。');
   if(ctx.repeatedErrorStop)throw Error('相同输入已连续失败，停止重复执行并保留最近成功产物。');
   if(ctx.reviewOnly&&name!=='x_list')throw Error('本轮已进入交付检查，请仅调用 x_list 提交最新产物的 task_review。');
   if(['x_write','x_edit','x_copy','build_3D_scene'].includes(name))declareTaskIntent(ctx,'scene');
   if(name==='build_3D_scene')ctx.lastBuildInputHash=undefined;
   ctx.onToolExecution?.({phase:'start',name,callId,paths:resources,at:performance.now()});
   const value=await fn(args,callId);signal.throwIfAborted();
   errors.success(name);
   if(['x_write','x_edit'].includes(name)){ctx.unbuiltChanges=true;ctx.workspaceRevision=(ctx.workspaceRevision||0)+1;}
   if(name==='x_copy')ctx.workspaceRevision=(ctx.workspaceRevision||0)+1;
   if(name==='x_copy'&&[current?.result?.source,...(current?.result?.sources||[]).map(s=>s.path)].some(p=>p?.toLowerCase()===args.destination.toLowerCase()))ctx.unbuiltChanges=true;
   emit({type:'TOOL_CALL_END',toolCallId:callId});
   const content=value instanceof ToolMessage?(Array.isArray(value.content)?value.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):value.content):JSON.stringify(value);
   emit({type:'TOOL_CALL_RESULT',messageId:crypto.randomUUID(),toolCallId:callId,content});
   return value;
  }catch(error){
   failed=true;
   if(signal.aborted)throw error;
   if(name==='build_3D_scene')ctx.latestBuildFailed=true;
   const result=await reportToolError(error,dir,name);
   if(['build_3D_scene','preview_3D_scene'].includes(name)){
    const inputKey=name==='build_3D_scene'?(ctx.lastBuildInputHash||[ctx.workspaceRevision||0,JSON.stringify(args)].join(':')):[current?.result.task_id,JSON.stringify(args)].join(':');
    result.repeat=errors.failure(name,result,inputKey);
    ctx.metrics?.count('tool.errors');if(result.repeat.count>1)ctx.metrics?.count('tool.repeatedErrors');
    if(result.repeat.hint)result.error+='\n'+result.repeat.hint;
    if(result.repeat.stop)ctx.repeatedErrorStop=result.repeat;
   }
   emit({type:'TOOL_CALL_END',toolCallId:callId,error:result.error});
   emit({type:'TOOL_CALL_RESULT',messageId:crypto.randomUUID(),toolCallId:callId,content:JSON.stringify(result),error:result.error});
   return JSON.stringify(result);
  }finally{end?.(failed);ctx.onToolExecution?.({phase:'end',name,callId,paths:resources,at:performance.now()});}
  });
 },{name,schema,description});
 const source=z.string().max(1024*1024), virtual=z.string().describe('项目工作区虚拟文件路径，通常为 /scene.js');
 const directory=z.string().default('/').describe('项目工作区虚拟目录；/ 列出当前工作区，不访问主机文件系统。');
 return [
  notify('x_copy',args=>copyWorkspace(dir,args,signal),z.object({source:virtual,destination:virtual,overwrite:z.boolean().default(false)}),'在当前项目工作区复制单个 .js/.json/.txt/.md 文件，保留原始字节，最大 1 MiB。自动创建父目录；目标存在时须显式设置 overwrite=true。上下文和场景接口文档不能作为目标。复制不会构建或更新画面。'),
  notify('x_list',async args=>{
   const listing=await listWorkspace(dir,args,signal);
   if(args.task_intent)declareTaskIntent(ctx,args.task_intent);
   if(args.task_review){
    if(!current?.result||args.task_review.task_id!==current.result.task_id)throw Error('task_review 必须引用最新成功构建的 task_id。');
    declareTaskIntent(ctx,'scene');ctx.taskReview=args.task_review;
    ctx.taskReviewObservedKeys=ctx.observedPreviewKeys instanceof Set?new Set(ctx.observedPreviewKeys):null;
   }
   return {...listing,task_intent:ctx.taskIntent==='chat'?'chat':'scene',...(current?{acceptance:sceneAcceptance(ctx),preview_plan:missingPreviewFrames(current.json,(ctx.previewChecks||[]).filter(p=>p.task_id===current.result.task_id))}:{})};
  },z.object({path:directory,recursive:z.boolean().default(false),max_entries:z.number().int().min(1).max(1000).default(200),task_intent:z.enum(['chat','scene']).optional().describe('本轮语义意图：chat 只回答问题；scene 生成或修改场景。首次调用必须声明，开始场景工作后不可降级为 chat。'),task_review:z.object({task_id:z.string().min(1),status:z.enum(['ready','partial']),issues:z.array(z.string().min(1).max(1200)).max(50)}).strict().optional().describe('场景交付前提交最新 task_id 的检查；ready 且 issues 为空表示需求已完成，partial 必须列出剩余事项。客观检查仍由服务端执行。')}),'列出当前项目工作区中的文件和目录。首次调用通过 task_intent 声明本轮是问答 chat 还是场景工作 scene；意图按整条请求语义判断，不按个别关键词。交付前用 task_review 声明最新构建的完成情况。用 / 查找 scene.js、context.json 和 scene-api.txt。返回虚拟路径、类型、文件大小和截断标志。不访问主机文件或符号链接。'),
  notify('x_read',args=>readWorkspace(dir,args,signal),z.object({path:virtual,offset:z.number().int().nonnegative().default(0),column:z.number().int().min(0).max(32*1024*1024).default(0),limit:z.number().int().min(1).max(1000).default(300)}),'读取工作区文本，显示从 1 开始的行号。offset 是从 0 开始的行偏移；column 是首行内从 0 开始的字符偏移；limit 是最多返回行数。可读取 /context.json、/scene-api.txt、/scene.js。返回 totalLines、offset、content、truncated；截断时返回 next:{offset,column} 游标，可继续读取超长行。'),
  notify('x_write',args=>writeWorkspace(dir,args),z.object({path:virtual,content:source,overwrite:z.boolean().default(false)}),'向项目工作区写入场景程序、模块或 manifest.json。不同文件可在同一轮并行调用，同一文件串行。入口定义 build(ctx,modules)，模块定义 create(ctx,deps)；协议与分层见 /scene-api.txt。禁止 import/export、Three.js、命令和网络。上下文和场景接口文档只读。'),
  notify('x_edit',args=>editWorkspace(dir,args),z.object({path:virtual,old_string:source,new_string:source,replace_all:z.boolean().default(false)}),'对已有场景程序做精确文本替换。默认拒绝多处匹配；修改前先读取当前程序。上下文和场景接口文档只读。'),
  notify('x_grep',args=>grepWorkspace(dir,args,signal),z.object({pattern:z.string().min(1).max(1000).describe('要查找的字面文本，不是正则表达式。'),path:z.string().default('/').describe('要搜索的工作区虚拟文件或目录。'),case_sensitive:z.boolean().default(true),max_results:z.number().int().min(1).max(1000).default(100)}),'在工作区文件或目录中递归查找字面文本。返回 matches（虚拟路径、从 1 开始的行号和文本）及 truncated。用于在 x_read/x_edit 前定位稳定节点 ID 和代码。不执行正则表达式或命令。'),
  notify('build_3D_scene',async({source:virtualPath})=>{
   const {sourceCode,sources}=await timed('build.sources',()=>loadSceneProgram(dir,virtualPath,signal));
   ctx.lastBuildInputHash=sha256(sourceCode);
   const baseJson=current?.json||ctx.sceneJson;
   const spec=await timed('build.evaluate',()=>evaluateProgram(sourceCode,{scene:baseJson,reference:ctx.reference,assets:ctx.assets.map(({id,name,kind})=>({id,name,kind}))},signal));
   const built=await timed('build.render',()=>renderTimed('compile',{spec,baseUrl:current?.result?.glb_url||ctx.baseUrl,baseJson,assets:ctx.assets}));
   const bytes=Buffer.from(built.glb,'base64');if(bytes.length>MAX_GLB)throw Error('GLB 超过 100 MiB 限制');
   if(JSON.stringify(built.json).length>0x1400000)throw Error('协作 JSON 超过大小限制');
   const taskId=crypto.randomUUID(),out=path.join(dir,'artifacts',taskId);await fs.mkdir(out,{recursive:true});
   const prefix=`${BASE}/artifacts/${projectId}/${taskId}`;
   const result={status:'completed',task_id:taskId,source:virtualPath,sources,source_sha256:sha256(sourceCode),source_hash:sha256(sourceCode),glb_url:prefix+'/model.glb',collaboration_url:prefix+'/collaboration.json',glb_size:bytes.length,glb_sha256:sha256(bytes),triangles:built.triangles,diagnostics:built.diagnostics??[]};
   // Publish only after both immutable files exist.
   await timed('build.files',async()=>{await atomicWrite(path.join(out,'model.glb'),bytes);await atomicWrite(path.join(out,'collaboration.json'),JSON.stringify(built.json));await atomicWrite(path.join(out,'result.json'),JSON.stringify(result));});
   await timed('build.commit',async()=>ctx.onBuild?.({result,json:built.json,bytes}));
   current={result,json:built.json};ctx.current=current;
   ctx.completedBuilds=(ctx.completedBuilds||0)+1;ctx.previewChecks=[];ctx.previewCache=new Map();ctx.unbuiltChanges=false;ctx.latestBuildFailed=false;ctx.taskReview=null;ctx.taskReviewObservedKeys=null;
   await atomicWrite(path.join(dir,'latest-build.json'),JSON.stringify(current));
   emit({type:'RESULT',result});return {...result,preview_plan:missingPreviewFrames(current.json)};
  },z.object({source:virtual.default('/scene.js')}),'将工作区场景程序编译为通过校验、可编辑的 GLB 和协作 JSON。返回 completed/task_id/glb_url/collaboration_url/glb_size/glb_sha256/triangles。每次成功构建会立即交付用户；有错误时修复程序后重新构建。'),
  notify('preview_3D_scene',async(args,callId)=>{
   if(!current)throw Error('请先构建场景，再检查预览');
   const checked=()=> (ctx.previewChecks||[]).filter(p=>p.task_id===current.result.task_id);
   const delivered=new Set();
   const remaining=()=>missingPreviewFrames(current.json,checked().filter(p=>!(ctx.observedPreviewKeys instanceof Set)||ctx.observedPreviewKeys.has(previewCheckKey(p))||delivered.has(JSON.stringify([p.task_id,p.camera_id,p.time]))));
   const planned=args.check==='missing'?remaining().slice(0,12).map(f=>({camera_id:f.cameraId,time:f.time})):null;
   const frames=planned?.length===0?[]:resolvePreviewFrames(planned?{frames:planned}:args,current.json);
   const bytes=await timed('preview.read',()=>fs.readFile(path.join(dir,'artifacts',current.result.task_id,'model.glb')));
   const images=[];
   const cache=ctx.previewCache??=new Map(),key=frame=>JSON.stringify([current.result.task_id,frame.cameraId,frame.time]);
   const accept=async frame=>{
    signal.throwIfAborted();
    if(!frames.some(f=>f.cameraId===frame.cameraId&&f.time===frame.time)||!frame.image||!(frame.width>0&&frame.height>0))throw Error('渲染检查帧与请求的机位或时间不一致。');
    if(delivered.has(key(frame)))return;
    const cached=cache.get(key(frame));
    if(cached){images.push({preview:cached.preview,image:`data:image/png;base64,${await fs.readFile(cached.file,'base64')}`});delivered.add(key(frame));return;}
    const filename=`preview-${crypto.randomUUID()}.png`;
    const file=path.join(dir,'artifacts',current.result.task_id,filename);
    await timed('preview.files',()=>atomicWrite(file,Buffer.from(frame.image,'base64')));
    signal.throwIfAborted();
    const data={status:'completed',task_id:current.result.task_id,camera_id:frame.cameraId,time:frame.time,width:frame.width,height:frame.height,image_url:`${BASE}/artifacts/${projectId}/${current.result.task_id}/${filename}`};
    cache.set(key(frame),{preview:data,file});delivered.add(key(frame));
    images.push({preview:data,image:`data:image/png;base64,${frame.image}`});
    (ctx.previewChecks||=[]).push(data);emit({type:'PREVIEW',...data});ctx.metrics?.count('preview.frames');
   };
   for(const frame of frames)if(cache.has(key(frame)))await accept({...frame,image:'cached',width:1,height:1});
   let failure;
   // Keep batches small under software rendering. On timeout retain streamed
   // frames and retry only the missing frames, once, in single-frame contexts.
   const pending=frames.filter(f=>!delivered.has(key(f)));
   const runBatch=async batch=>{
    const rendered=await timed('preview.render',()=>render('previewBatch',{glb:bytes.toString('base64'),json:current.json,frames:batch},signal,{onTiming:(name,ms)=>ctx.metrics?.record('render.'+name,ms),onFrame:accept}));
    for(const frame of rendered.frames||[])await accept(frame);
    if(batch.some(f=>!delivered.has(key(f))))throw Error('渲染器未返回完整的批量检查帧。');
   };
   for(let index=0;index<pending.length;index+=2){
    const batch=pending.slice(index,index+2);
    try{await runBatch(batch);}catch(error){
     signal.throwIfAborted();
     if(error.code==='RENDERER_TIMEOUT'||error.code==='RENDERER_ACQUIRE_TIMEOUT'){
      try{for(const frame of batch)if(!delivered.has(key(frame)))await runBatch([frame]);}catch(retryError){signal.throwIfAborted();failure=retryError;break;}
     }else{failure=error;break;}
    }
   }
   signal.throwIfAborted();
   images.sort((a,b)=>frames.findIndex(f=>f.cameraId===a.preview.camera_id&&f.time===a.preview.time)-frames.findIndex(f=>f.cameraId===b.preview.camera_id&&f.time===b.preview.time));
   if(failure&&!images.length)throw failure;
   // Pixels go to the vision model; a localhost URL alone is not useful to it.
   const single=!args.frames&&!args.check,content=single&&!failure?images[0].preview:{status:failure?'partial':'completed',task_id:current.result.task_id,frame_count:images.length,frames:images.map(i=>i.preview),remaining:remaining(),unrendered:frames.filter(f=>!delivered.has(key(f))),...(failure?{error:failure.message}:{})};
   return new ToolMessage({tool_call_id:callId,content:JSON.stringify(content),artifact:single?{previewImage:images[0].image,preview:images[0].preview}:{previewImages:images}});
  },z.object({check:z.literal('missing').optional().describe('验收首选：服务端自动选择最新产物尚缺的镜头起点、中点、终点，每次最多 12 帧。重复调用直至 remaining 为空。'),camera_id:z.string().optional().describe('机位的稳定 hf_id。'),time:z.number().min(0).max(600).optional(),frames:z.array(z.object({camera_id:z.string().optional(),time:z.number().min(0).max(600)}).strict()).min(1).max(12).optional()}).superRefine((args,refine)=>{if((args.frames&&(args.camera_id!==undefined||args.time!==undefined))||(args.check&&(args.frames||args.camera_id!==undefined||args.time!==undefined)))refine.addIssue({code:'custom',message:'check、frames、顶层 camera_id/time 三种模式不能同时使用'});}),'检查最新构建的真实画面。验收使用 {check:"missing"}，检查点与服务端验收完全一致；自动拆成小批次，逐帧保存，超时只重试缺失帧；部分成功返回 partial 和 remaining/unrendered，可继续执行而无需重建。也支持显式 frames 或单帧 camera_id/time。'),
 ];
}
