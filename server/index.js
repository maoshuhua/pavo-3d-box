import express from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ROOT,DATA,BASE,PORT,MAX_GLB,MAX_ATTACHMENT,configured} from './config.js';
import {safeId,projectDir,atomicWrite,sourcePath,readJson} from './storage.js';
import {saveAttachments,validateGlb} from './uploads.js';
import {runDeepAgent} from './agent.js';
import {closeRenderer} from './renderService.js';
import {mountStudioApi} from './studioApi.js';
import {attachStudioSocket} from './studioSocket.js';
import {createRunEvents} from './runEvents.js';
import {collaborationSchema} from '../src/agentSchemas.js';
import {agentModels} from './agentModels.js';

const allowedOrigin=origin=>!origin||origin===BASE||origin===`http://localhost:${PORT}`||/^http:\/\/(127\.0\.0\.1|localhost):(5173|4173|8787)$/.test(origin);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_GLB,files:13,fields:2,fieldSize:22*1024*1024}});
export function createServer({runAgent=runDeepAgent,requireConfiguration=true,database,dataDir}={}){
 const app=express(),runs=new Map(),projects=new Set();
 app.disable('x-powered-by');
 app.use((req,res,next)=>{if(!allowedOrigin(req.headers.origin))return res.status(403).json({error:'Local origin required'});next();});
 app.use(cors({origin:(origin,cb)=>cb(null,allowedOrigin(origin))}));
 const studio=mountStudioApi(app,{database,dataDir,onStop:sessionId=>{for(const run of runs.values())if(run.sessionId===sessionId)run.controller.abort(new DOMException('Cancelled by user','AbortError'));},isRunning:projectId=>projects.has(projectId)});
 const channel=createRunEvents(studio.store);
 app.get('/api/agent/runs/:runId',(req,res,next)=>{try{res.json({code:0,msg:'',data:studio.store.runDetail(safeId(req.query.projectId),safeId(req.params.runId))});}catch(e){next(e);}});
 app.get('/api/agent/runs/:runId/events',(req,res,next)=>{try{const cursor=Number(req.query.afterSeq||req.headers['last-event-id']||0);if(!Number.isSafeInteger(cursor)||cursor<0)throw Error('无效的事件序号');channel.stream(req,res,safeId(req.query.projectId),safeId(req.params.runId),cursor);}catch(e){next(e);}});
 app.get('/api/agent/health',(_,res)=>res.json({ok:true,configured:configured(),engine:'langchain-deepagents',model:agentModels()[0]?.key||null}));
 app.post('/api/agent/run',upload.fields([{name:'scene',maxCount:1},{name:'attachments',maxCount:12}]),async(req,res,next)=>{
  let runId,projectId,controller,sessionId;
  try{
   if(requireConfiguration&&!configured())return res.status(503).json({error:'请在 F:\\3D_BOX\\.env 配置 AGENT_MODEL 或 AGENT_MODELS，以及 AGENT_BASE_URL 和 AGENT_API_KEY，然后重启 Agent 服务。'});
   const payload=JSON.parse(req.body.payload||'{}');
   projectId=safeId(payload.projectId);runId=safeId(payload.runId);sessionId=safeId(payload.sessionId||crypto.randomUUID());
   const existing=studio.store.db.prepare('SELECT * FROM runs WHERE id=?').get(runId);
   if(existing){if(existing.project_id!==projectId||payload.sessionId&&existing.session_id!==payload.sessionId)throw Object.assign(Error('任务不属于当前项目或会话'),{status:409});return channel.stream(req,res,projectId,runId);}
   if(projects.has(projectId))return res.status(409).json({error:'该项目已有任务正在运行。'});
   if(typeof payload.prompt!=='string'||payload.prompt.length>100000)throw Error('Invalid prompt');
   const scene=req.files?.scene?.[0];if(!scene)throw Error('Current scene GLB is required');validateGlb(scene.buffer);
   const sceneJson=payload.sceneJson;if(!sceneJson||!Array.isArray(sceneJson.entities))throw Error('Current scene JSON is required');
   if((req.files?.attachments||[]).some(f=>f.size>MAX_ATTACHMENT))throw Error('附件不能超过 20 MiB');
   const dir=projectDir(projectId),inputId=crypto.randomUUID();
   projects.add(projectId);controller=new AbortController();runs.set(runId,{projectId,controller});
   // Request-local input files prevent a cancelled upload from changing the next run's baseline.
   await atomicWrite(path.join(dir,'artifacts',inputId,'input.glb'),scene.buffer);
   await atomicWrite(path.join(dir,'artifacts',inputId,'input.json'),JSON.stringify(sceneJson));
   const allAttachments=[...(req.files?.attachments||[]),...await studio.referencedFiles(payload.attachmentIds||[])];
   if(allAttachments.length>12)throw Error('每次最多上传12个参考附件');
   const assets=await saveAttachments(allAttachments,dir,projectId);
   studio.store.createSession({projectId,sessionId});runs.get(runId).sessionId=sessionId;
   let detail;try{detail=studio.store.detail(projectId);}catch(error){if(error.status!==404)throw error;detail=studio.store.create({},null,projectId);}
   const root=JSON.parse(detail.config);root.animationPreview={...root.animationPreview,sessionId,version:1,prompt:undefined,promptParts:undefined};studio.store.update({studioUuid:projectId,config:JSON.stringify(root)});
   studio.store.db.prepare("INSERT INTO runs VALUES(?,?,?,'running',?,?)").run(runId,sessionId,projectId,Date.now(),Date.now());
   const userMessage={...(payload.messages?.filter(m=>m.role==='user').at(-1)||{id:crypto.randomUUID(),role:'user',text:payload.prompt}),attachments:assets.map(asset=>({name:asset.name,type:asset.mime,kind:asset.kind,url:asset.url}))};
   studio.store.addMessage(sessionId,userMessage);
   const logFile=path.join(dir,'sessions',sessionId,'runs',runId+'.ndjson');await fs.mkdir(path.dirname(logFile),{recursive:true});
   let logQueue=Promise.resolve();const savedBuilds=new Map(),covered=new Set();
   const emit=event=>{if(controller.signal.aborted)return;
    if(event.type==='RESULT'&&savedBuilds.has(event.result.task_id))event={...event,snapshotRevision:savedBuilds.get(event.result.task_id)};
    if(event.type==='PREVIEW')try{const url=new URL(event.image_url),match=url.pathname.match(/^\/artifacts\/([\w-]+)\/([\w-]+)\/(preview-[\w-]+\.png)$/);if(url.origin===BASE&&match&&match[1]===projectId){const id=crypto.createHash('sha256').update(event.image_url).digest('hex');studio.store.db.prepare('INSERT OR IGNORE INTO assets VALUES(?,?,?,?,?,?,?,?)').run(id,`预演-${event.time}s.png`,'image/png','image',path.join(dir,'artifacts',match[2],match[3]),0,Date.now(),'preview');if(!covered.has(event.task_id)&&savedBuilds.has(event.task_id)){studio.store.update({studioUuid:projectId,coverUrl:`${BASE}/local-assets/${id}`});covered.add(event.task_id);}}}catch{}
    const frame=channel.publish(sessionId,runId,event);logQueue=logQueue.catch(()=>{}).then(()=>fs.appendFile(logFile,JSON.stringify(frame)+'\n'));};
   const onBuild=async({result,json,bytes})=>{
    controller.signal.throwIfAborted();validateGlb(bytes);collaborationSchema.parse(json);
    const out=path.join(dir,'artifacts',safeId(result.task_id)),glbPath=path.join(out,'model.glb'),jsonPath=path.join(out,'collaboration.json');
    await atomicWrite(glbPath,bytes);await atomicWrite(jsonPath,JSON.stringify(json));controller.signal.throwIfAborted();
    const revision=(studio.store.snapshot(projectId)?.revision||0)+1;
    studio.store.commitSnapshot(projectId,revision,glbPath,jsonPath,{generation:result,glbUrl:result.glb_url,prompt:undefined,promptParts:undefined});savedBuilds.set(result.task_id,revision);
   };
   emit({type:'SESSION',sessionId});emit({type:'RUN_STARTED'});
   channel.stream(req,res,projectId,runId);
   // The task belongs to the project, not this response's lifetime.
   const job=(async()=>{
    const timer=setTimeout(()=>controller.abort(new Error('Agent run exceeded time limit')),Number(process.env.AGENT_RUN_TIMEOUT_MS||900000));
    try{
     await runAgent({dir,projectId,sessionId,runId,messageId:userMessage.id,prompt:payload.prompt,reference:payload.reference,generationSettings:payload.generationSettings,sceneJson,assets,baseUrl:`${BASE}/artifacts/${projectId}/${inputId}/input.glb`,emit,onBuild,signal:controller.signal,
      writeContext:async(context,api)=>{await atomicWrite(sourcePath(dir,'/context.json'),JSON.stringify(context,null,2));await atomicWrite(sourcePath(dir,'/scene-api.txt'),api);}});
     controller.signal.throwIfAborted();studio.store.db.prepare("UPDATE runs SET status='completed',updated_at=? WHERE id=?").run(Date.now(),runId);emit({type:'RUN_FINISHED'});
    }catch(error){const frame={type:'RUN_ERROR',message:error.message};studio.store.db.prepare("UPDATE runs SET status='failed',updated_at=? WHERE id=?").run(Date.now(),runId);const persisted=channel.publish(sessionId,runId,frame);logQueue=logQueue.catch(()=>{}).then(()=>fs.appendFile(logFile,JSON.stringify(persisted)+'\n'));}
    finally{clearTimeout(timer);await logQueue.catch(()=>{});runs.delete(runId);projects.delete(projectId);}
   })();runs.get(runId).job=job;
  }catch(error){
   if(controller){const row=studio.store.db.prepare('SELECT status FROM runs WHERE id=?').get(runId);if(row?.status==='running'){studio.store.db.prepare("UPDATE runs SET status='failed',updated_at=? WHERE id=?").run(Date.now(),runId);channel.publish(sessionId,runId,{type:'RUN_ERROR',message:error.message});}runs.delete(runId);projects.delete(projectId);}next(error);
  }
 });
 app.delete('/api/agent/runs/:runId', (req,res)=>{const run=runs.get(req.params.runId);if(run&&run.projectId===req.query.projectId)run.controller.abort(new DOMException('Cancelled by user','AbortError'));res.json({ok:true});});
 app.get('/artifacts/:projectId/:taskId/:file',async(req,res,next)=>{try{
  const {projectId,taskId,file}=req.params;safeId(projectId);safeId(taskId);
  if(!/^(model\.glb|collaboration\.json|result\.json|input\.glb|input\.json|preview-[a-f0-9-]+\.png)$/.test(file))return res.sendStatus(404);
  res.sendFile(path.join(projectDir(projectId),'artifacts',taskId,file),{dotfiles:'allow'});
 }catch(e){next(e);}});
 app.get('/uploads/:projectId/:file',(req,res,next)=>{try{safeId(req.params.projectId);if(!/^[a-f0-9-]+\.[a-z0-9]+$/.test(req.params.file))return res.sendStatus(404);res.sendFile(path.join(projectDir(req.params.projectId),'uploads',req.params.file),{dotfiles:'allow'});}catch(e){next(e);}});
 // Explicit static roots, never serve .env, checkpoints or workspace files.
 app.get('/runtime/renderer.html',(_,res)=>res.sendFile(path.join(ROOT,'server','renderer.html')));
 app.get('/runtime/renderer.js',(_,res)=>res.sendFile(path.join(ROOT,'server','renderer.js')));
 app.use('/src',express.static(path.join(ROOT,'src'),{index:false,dotfiles:'deny'}));
 app.use('/three',express.static(path.join(ROOT,'node_modules','three'),{index:false,dotfiles:'deny'}));
 app.use('/draco',express.static(path.join(ROOT,'public','draco'),{index:false}));
 app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status||400).json({code:error.status||400,msg:error.message||'Request failed',error:error.message||'Agent request failed',data:null});});
 return {app,studio:studio.store,attachSocket:server=>attachStudioSocket(server,studio.store,allowedOrigin),abortAll:async()=>{const tasks=[...runs.values()];for(const run of tasks)run.controller.abort();await Promise.allSettled(tasks.map(run=>run.job));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {app,abortAll,studio,attachSocket}=createServer();
 for(const row of studio.db.prepare("SELECT * FROM runs WHERE status='running'").all()){studio.recordEvent(row.session_id,row.id,{type:'RUN_ERROR',runId:row.id,sessionId:row.session_id,message:'本地 Agent 服务已重启，任务已中断，已保留最近成功的场景结果。'});studio.db.prepare("UPDATE runs SET status='interrupted' WHERE id=?").run(row.id);}
 const server=app.listen(PORT,'127.0.0.1',()=>console.log(`3D-BOX Deep Agents: ${BASE} (${configured()?'configured':'configure .env to enable model calls'})`));
 attachSocket(server);
 const stop=async()=>{await abortAll();server.close();await closeRenderer();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}

