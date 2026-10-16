import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {DATA,BASE,MAX_GLB,MAX_ATTACHMENT} from './config.js';
import {StudioDatabase,integer,validateConfig} from './studioDatabase.js';
import {atomicWrite,safeId} from './storage.js';
import {validateGlb} from './uploads.js';
import {collaborationSchema} from '../src/agentSchemas.js';
import presetConfig from './studioPresets.json' with {type:'json'};

const allowedMime=new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp','image/svg+xml','text/plain','text/markdown','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','model/gltf-binary','application/json','application/octet-stream','text/csv']);
export const presets={banners:[],prompts:[{title:'预演一段城市街头的警匪追车戏',text:'帮我创建一段警匪在城市街道中飙车对战的预演动画，重点展现惊险的竞速和运镜效果。包含全景、中景、特写等多种镜头。',aspectRatio:'16:9',durationSeconds:8},{title:'环绕香水瓶运镜，预演产品广告',text:'搭建一个简洁的香水瓶，放在圆形展台上。瓶子不动，镜头围绕瓶身缓慢旋转一整圈（360度），最后推进到瓶盖特写，做一段产品广告预演。采用极简几何模型精度。',aspectRatio:'9:16',durationSeconds:10},{title:'用多个镜头预演古装庭院对峙戏',text:'创建一段古装庭院中的人物对峙戏，保留可编辑的人物和庭院场景，使用全景、中景和特写表现紧张气氛。',aspectRatio:'16:9',durationSeconds:15}]};
export function mountStudioApi(app,{database,dataDir=DATA,onStop=()=>{},isRunning=()=>false}={}){
 Object.assign(presets,presetConfig);
 const store=database||new StudioDatabase(),sql=store.db,filesDir=path.join(dataDir,'studio-files');
 const ok=(res,data={})=>res.json({code:0,msg:'',data});
 const route=(method,url,fn)=>app[method](url,async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}});
 const json=express.json({limit:'23mb'});app.use('/api',json);app.use('/gateway',json);
 const multipart=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_GLB,files:2,fields:5,fieldSize:22*1024*1024}});
 const localUrl=id=>`${BASE}/local-assets/${id}`;
 const requireProject=req=>store.detail(safeId(req.body?.studioUuid||req.query.projectId||req.params.projectId));
 const asset=id=>{safeId(id);const row=sql.prepare('SELECT * FROM assets WHERE id=?').get(id);if(!row)throw Object.assign(Error('本地素材不存在'),{status:404});return row;};
 const ticket=id=>{safeId(id);const row=sql.prepare('SELECT * FROM upload_tickets WHERE id=? AND completed=0 AND expires_at>?').get(id,Date.now());if(!row)throw Error('上传凭证已过期或已完成');return row;};
 async function registerAsset(id,bytes,name,mime,source='upload'){
  if(bytes.length>MAX_GLB)throw Error('文件过大');
  const target=path.join(filesDir,id,'asset');await atomicWrite(target,bytes);
  const kind=mime.startsWith('image/')?'image':mime==='model/gltf-binary'?'glb':'document';
  sql.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)').run(id,name,mime,kind,target,bytes.length,Date.now(),source);
  return {id,name,mimeType:mime,kind,size:bytes.length,url:localUrl(id)};
 }
 route('get','/api/task/agent-task/modes',(_,res)=>ok(res,{agentName:'libtv_coding_agent',modes:[{key:'G6',name:'3D-BOX Model Pro',isVip:false,version:''},{key:'DV4',name:'3D-BOX Model',isVip:false,version:''}]}));
 route('get','/api/task/free-quota/remaining',(req,res)=>ok(res,{scene:req.query.scene||'3D_animation',model:req.query.model||'G6',matched:false,limit:0,remaining:0}));
 route('get','/api/www/landing-activities/getById',(req,res)=>ok(res,{id:String(req.query.id),linkUrl:JSON.stringify(presets)}));
 route('get','/api/www/landing-activities/listByIds',(req,res)=>ok(res,{list:String(req.query.ids||'318').split(',').map(id=>({id,linkUrl:JSON.stringify(presets)}))}));
 route('post','/api/studio/list',(req,res)=>ok(res,store.list(req.body)));
 route('post','/api/studio/create',(req,res)=>ok(res,store.create(req.body,req.get('Idempotency-Key')||null)));
 route('get','/api/studio/detail',(req,res)=>ok(res,store.detail(safeId(req.query.uuid))));
 route('post','/api/studio/update',(req,res)=>{safeId(req.body.studioUuid);ok(res,store.update(req.body));});
 route('post','/api/studio/delete',(req,res)=>{const id=safeId(req.body.studioUuid);if(isRunning(id))throw Object.assign(Error('请先停止项目中的生成任务'),{status:409});store.remove(id);ok(res);});
 route('post','/api/studio/draft',(req,res)=>{const {prompt='',promptParts=[],generationSettings}=req.body;if(typeof prompt!=='string'||prompt.length>10000||!Array.isArray(promptParts)||promptParts.length>12)throw Error('无效的生成草稿');validateConfig(JSON.stringify({animationPreview:{version:1,generationSettings}}));for(const part of promptParts)asset(part.assetId);const id=crypto.randomUUID();sql.prepare('DELETE FROM drafts WHERE created_at<?').run(Date.now()-1800000);sql.prepare('INSERT INTO drafts VALUES(?,?,?)').run(id,JSON.stringify({prompt:prompt.trim(),promptParts,generationSettings}),Date.now());ok(res,{draftPromptId:id});});
 route('get','/api/studio/draft/:id',(req,res)=>{const row=sql.prepare('SELECT * FROM drafts WHERE id=? AND created_at>?').get(safeId(req.params.id),Date.now()-1800000);if(!row)throw Object.assign(Error('生成草稿已过期'),{status:404});ok(res,JSON.parse(row.body));});
 route('delete','/api/studio/draft/:id',(req,res)=>{sql.prepare('DELETE FROM drafts WHERE id=?').run(safeId(req.params.id));ok(res);});
 route('get','/api/studio/snapshot',(req,res)=>{const id=safeId(req.query.projectId),row=store.snapshot(id);ok(res,row?{revision:row.revision,savedAtMs:row.saved_at,generation:JSON.parse(store.detail(id).config).animationPreview?.generation,glbUrl:`${BASE}/api/studio/${id}/snapshot/${row.revision}/studio.glb`,jsonUrl:`${BASE}/api/studio/${id}/snapshot/${row.revision}/studio-collaboration.json`}:null);});
 route('get','/api/studio/:projectId/snapshot/:revision/:file',async(req,res)=>{const id=safeId(req.params.projectId),row=store.snapshot(id);if(!row||row.revision!==Number(req.params.revision))return res.sendStatus(404);if(!['studio.glb','studio-collaboration.json'].includes(req.params.file))return res.sendStatus(404);res.set('Cache-Control','no-store');res.sendFile(req.params.file==='studio.glb'?row.glb_path:row.json_path,{dotfiles:'allow'});});
 app.post('/api/studio/snapshot',multipart.fields([{name:'scene',maxCount:1},{name:'cover',maxCount:1}]),async(req,res,next)=>{try{
  const id=safeId(req.body.projectId);store.detail(id);const revision=integer(req.body.revision,1,Number.MAX_SAFE_INTEGER),bytes=req.files?.scene?.[0]?.buffer;if(!bytes)throw Error('缺少场景 GLB');validateGlb(bytes);
  const scene=collaborationSchema.parse(JSON.parse(req.body.sceneJson));
  const old=store.snapshot(id);if(old&&revision<=old.revision){
   if(revision===old.revision){const saved=JSON.parse(await fs.readFile(old.json_path,'utf8')),current={...scene};delete saved.savedAtMs;delete current.savedAtMs;if(JSON.stringify(saved)===JSON.stringify(current)&&bytes.equals(await fs.readFile(old.glb_path)))return ok(res,{revision,savedAtMs:old.saved_at});}
   throw Object.assign(Error('项目已有更新版本，请重新打开后重试'),{status:409});
  }
  const dir=path.join(filesDir,id,'snapshots',crypto.randomUUID()),glbPath=path.join(dir,'studio.glb'),jsonPath=path.join(dir,'studio-collaboration.json');
  await atomicWrite(glbPath,bytes);await atomicWrite(jsonPath,JSON.stringify(scene));
  let coverUrl;const cover=req.files?.cover?.[0];if(cover&&cover.size<MAX_ATTACHMENT&&cover.mimetype==='image/jpeg'){const saved=await registerAsset(crypto.randomUUID(),cover.buffer,'studio-cover.jpg','image/jpeg','cover');coverUrl=saved.url;}
  const detail=store.detail(id),root=JSON.parse(detail.config),settings={glbUrl:`${BASE}/api/studio/${id}/snapshot/${revision}/studio.glb`,...req.body.generation?{generation:JSON.parse(req.body.generation)}:{}};
  if(req.body.promptHandled==='true'){settings.prompt=undefined;settings.promptParts=undefined;}
  store.commitSnapshot(id,revision,glbPath,jsonPath,settings);if(coverUrl)store.update({studioUuid:id,coverUrl});
  ok(res,{revision,savedAtMs:Date.now()});
 }catch(e){next(e);}});
 // Browser-only legacy scene migration is idempotent; it never replaces a newer DB project.
 app.post('/api/studio/import-local',multipart.single('scene'),async(req,res,next)=>{try{const id=safeId(req.body.projectId);let detail;try{detail=store.detail(id);}catch(e){if(e.status!==404)throw e;detail=store.create({name:req.body.name||'未命名 3D-BOX'},`legacy:${id}`,id);}if(req.file&&!store.snapshot(id)){validateGlb(req.file.buffer);const scene=collaborationSchema.parse(JSON.parse(req.body.sceneJson)),dir=path.join(filesDir,id,'snapshots',crypto.randomUUID()),glb=path.join(dir,'studio.glb'),jsonPath=path.join(dir,'studio-collaboration.json');await atomicWrite(glb,req.file.buffer);await atomicWrite(jsonPath,JSON.stringify(scene));store.commitSnapshot(id,Math.max(1,Number(req.body.revision)||1),glb,jsonPath);}
  if(req.body.agentState){const state=JSON.parse(req.body.agentState);if(state.sessionId){const sid=store.createSession({projectId:id,sessionId:safeId(state.sessionId)});for(const message of state.messages||[])if(message.id&&['user','assistant','tool'].includes(message.role))store.addMessage(sid,message);const root=JSON.parse(store.detail(id).config);root.animationPreview.sessionId=sid;store.update({studioUuid:id,config:JSON.stringify(root)});}}
  ok(res,store.detail(id));}catch(e){next(e);}});
 route('post','/gateway/oss-server-api/oss-service/api/oss/pre-sign/4',(req,res)=>{const mime=String(req.body.contentType||'application/octet-stream');if(!allowedMime.has(mime))throw Error('不支持的上传类型');const key=String(req.body.path||'');if(!/^upload-images\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.\u4e00-\u9fff-]+$/.test(key)||key.includes('..'))throw Error('无效的上传路径');const id=crypto.randomUUID();sql.prepare('INSERT INTO upload_tickets(id,path,mime,expires_at) VALUES(?,?,?,?)').run(id,key,mime,Date.now()+1200000);ok(res,{ossUrl:`${BASE}/local-upload/${id}`,cdnUrl:localUrl(id),assetId:id});});
 app.put('/local-upload/:id',express.raw({type:()=>true,limit:MAX_GLB}),async(req,res,next)=>{try{const row=ticket(req.params.id);if(!Buffer.isBuffer(req.body)||!req.body.length)throw Error('文件为空');await registerAsset(row.id,req.body,path.basename(String(req.query.name||row.path)),row.mime);sql.prepare('UPDATE upload_tickets SET completed=1 WHERE id=?').run(row.id);res.sendStatus(200);}catch(e){next(e);}});
 route('post','/gateway/oss-server-api/oss-service/api/oss/pre-sign/multipart/init/4',(req,res)=>{const {path:key,contentType:mime,fileSize,partSize=5242880}=req.body;if(!allowedMime.has(mime)||typeof key!=='string'||!/^upload-images\/[\w-]+\/[\w.\u4e00-\u9fff-]+$/.test(key)||key.includes('..'))throw Error('无效的上传参数');const size=integer(fileSize,1,MAX_GLB),chunk=integer(partSize,1,5242880),count=Math.ceil(size/chunk);if(count>100)throw Error('分片数量过多');const id=crypto.randomUUID();sql.prepare('INSERT INTO upload_tickets(id,path,mime,size,part_size,parts,expires_at) VALUES(?,?,?,?,?,?,?)').run(id,key,mime,size,chunk,count,Date.now()+1200000);ok(res,{uploadId:id,parts:Array.from({length:count},(_,i)=>({partNumber:i+1,method:'PUT',url:`${BASE}/local-upload/${id}/part/${i+1}`}))});});
 app.put('/local-upload/:id/part/:part',express.raw({type:()=>true,limit:'5mb'}),async(req,res,next)=>{try{const row=ticket(req.params.id),part=integer(req.params.part,1,row.parts),expected=part===row.parts?row.size-(part-1)*row.part_size:row.part_size;if(req.body.length!==expected)throw Error('分片大小错误');await atomicWrite(path.join(filesDir,row.id,'parts',String(part)),req.body);res.sendStatus(200);}catch(e){next(e);}});
 route('post','/gateway/oss-server-api/oss-service/api/oss/pre-sign/multipart/complete/4',async(req,res)=>{const row=ticket(req.body.uploadId);if(row.path!==req.body.path||!row.size)throw Error('无效的分片会话');const bytes=Buffer.concat(await Promise.all(Array.from({length:row.parts},(_,i)=>fs.readFile(path.join(filesDir,row.id,'parts',String(i+1))))));if(bytes.length!==row.size)throw Error('分片大小不匹配');const result=await registerAsset(row.id,bytes,path.basename(req.body.fileName||row.path),row.mime);sql.prepare('UPDATE upload_tickets SET completed=1 WHERE id=?').run(row.id);ok(res,{path:row.path,cdnUrl:result.url,assetId:row.id});});
 route('get','/local-assets/:id',(req,res)=>{const row=asset(req.params.id);res.type(row.mime).set({'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.sendFile(row.path,{dotfiles:'allow'});});
 route('post','/api/community/image/verify',async(req,res)=>{if(!Array.isArray(req.body.urlList)||req.body.urlList.length>12)throw Error('无效的图片列表');const list=[];for(const url of req.body.urlList){const parsed=new URL(url);if(parsed.origin!==BASE||!/^\/local-assets\/[\w-]+$/.test(parsed.pathname))throw Error('仅支持本地图片');const row=asset(parsed.pathname.split('/').at(-1));if(row.kind!=='image')throw Error('不是图片');list.push({url,result:false,validation:'local-file-only'});}ok(res,{list});});
 const history=(req,res)=>{const page=integer(req.body.page??req.body.pageNo??1,1,100000),pageSize=integer(req.body.pageSize??15,1,100),rows=sql.prepare("SELECT * FROM assets WHERE kind='image' AND source!='cover' ORDER BY created_at DESC LIMIT ? OFFSET ?").all(pageSize,(page-1)*pageSize);ok(res,{list:rows.map(r=>({artifactId:r.id,id:r.id,fileName:r.name,mediaType:'image',previewPath:localUrl(r.id),imageUrl:localUrl(r.id)})),total:sql.prepare("SELECT count(*) AS total FROM assets WHERE kind='image' AND source!='cover'").get().total});};
 route('post','/api/task/artifact/list',history);
 for(const suffix of ['editor/img/history','image/history','comfy/img/history','sd3/image/history','team/images'])route('post',`/gateway/sd-api/generate/${suffix}`,history);
 route('post','/api/v1/project/session/create',(req,res)=>{store.detail(safeId(req.body.projectId));ok(res,{sessionId:store.createSession(req.body)});});
 route('get','/api/v1/project/session/list',(req,res)=>ok(res,{sessions:sql.prepare('SELECT * FROM sessions WHERE project_id=? ORDER BY created_at').all(safeId(req.query.projectId)).map(r=>({sessionId:r.id,name:r.name,libtvMeta:JSON.parse(r.meta)}))}));
 route('get','/api/v1/project/message/list',(req,res)=>ok(res,store.history(safeId(req.query.projectId),req.query.sessionId,req.query.afterSeq)));
 route('post','/api/v1/project/session/stop',(req,res)=>{safeId(req.body.sessionId);onStop(req.body.sessionId);ok(res);});
 route('post','/api/v1/project/session/update-title',(req,res)=>{const title=String(req.body.title||'').trim();if(!title||title.length>128)throw Error('无效的标题');sql.prepare('UPDATE sessions SET name=? WHERE id=?').run(title,safeId(req.body.sessionId));ok(res);});
 route('post','/api/v1/project/session/update-meta',(req,res)=>{sql.prepare('UPDATE sessions SET meta=? WHERE id=?').run(JSON.stringify(req.body.libtvMeta||{}),safeId(req.body.sessionId));ok(res);});
 route('get','/api/canvas/project/get_title_by_message',(req,res)=>ok(res,{title:String(req.query.message||'').trim().slice(0,80)||'未命名 3D-BOX'}));
 return {store,asset,async referencedFiles(ids=[]){if(!Array.isArray(ids)||ids.length>12)throw Error('参考附件过多');return Promise.all(ids.map(async id=>{const row=asset(id);if(row.size>MAX_ATTACHMENT)throw Error('参考附件不能超过20 MiB');return {originalname:row.name,mimetype:row.mime,size:row.size,buffer:await fs.readFile(row.path)};}));}};
}
