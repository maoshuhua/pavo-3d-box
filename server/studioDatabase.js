import {normalizeUploadName} from './filename.js';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DATA} from './config.js';

export class StudioDatabase {
 constructor(filename=path.join(DATA,'studio.sqlite')) {
  if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
  this.db=new DatabaseSync(filename);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS studios(uuid TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover_url TEXT,config TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,entry_key TEXT UNIQUE);
   CREATE TABLE IF NOT EXISTS snapshots(project_id TEXT PRIMARY KEY REFERENCES studios(uuid),revision INTEGER NOT NULL,glb_path TEXT NOT NULL,json_path TEXT NOT NULL,saved_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,body TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,kind TEXT NOT NULL,path TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL,source TEXT NOT NULL DEFAULT 'upload');
   CREATE TABLE IF NOT EXISTS upload_tickets(id TEXT PRIMARY KEY,path TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER,part_size INTEGER,parts INTEGER NOT NULL DEFAULT 1,expires_at INTEGER NOT NULL,completed INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,agent_name TEXT NOT NULL,node_key TEXT,meta TEXT NOT NULL DEFAULT '{}',created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,project_id TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS messages(id TEXT NOT NULL,session_id TEXT NOT NULL,role TEXT NOT NULL,body TEXT NOT NULL,seq INTEGER PRIMARY KEY AUTOINCREMENT,UNIQUE(id,session_id));
   CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,session_id TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS studios_updated ON studios(deleted,updated_at DESC);
   CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id,seq);
   CREATE INDEX IF NOT EXISTS events_run_seq ON events(run_id,seq);
  `);
 }
 close(){this.db.close();}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 meta(row){return {uuid:row.uuid,name:row.name,description:row.description,coverUrl:row.cover_url,createdAtMs:row.created_at,updatedAtMs:row.updated_at};}
 detail(uuid){const row=this.db.prepare('SELECT * FROM studios WHERE uuid=? AND deleted=0').get(uuid);if(!row)throw Object.assign(Error('项目不存在或已删除'),{status:404});return {studioMeta:this.meta(row),config:row.config};}
 create(body={},entryKey=null,uuid=crypto.randomUUID()){
  if(entryKey){const row=this.db.prepare('SELECT uuid FROM studios WHERE entry_key=? AND deleted=0').get(entryKey);if(row)return this.detail(row.uuid);}
  const name=String(body.name||'未命名 3D-BOX').trim();if(!name||name.length>128)throw Error('项目名称长度应为 1 到 128 个字符');
  const config=body.config??JSON.stringify({animationPreview:{version:1}});validateConfig(config);
  const now=Date.now();this.db.prepare('INSERT INTO studios(uuid,name,description,cover_url,config,created_at,updated_at,entry_key) VALUES(?,?,?,?,?,?,?,?)').run(uuid,name,String(body.description||''),body.coverUrl||null,config,now,now,entryKey);
  return this.detail(uuid);
 }
 update(body){const current=this.detail(body.studioUuid);const name=body.name===undefined?current.studioMeta.name:String(body.name).trim();if(!name||name.length>128)throw Error('项目名称长度应为 1 到 128 个字符');const config=body.config??current.config;validateConfig(config);this.db.prepare('UPDATE studios SET name=?,config=?,cover_url=?,updated_at=? WHERE uuid=? AND deleted=0').run(name,config,body.coverUrl===undefined?current.studioMeta.coverUrl:body.coverUrl,Date.now(),body.studioUuid);return this.detail(body.studioUuid);}
 list({page=1,pageSize=20,name,folderId}={}){page=integer(page,1,100000);pageSize=integer(pageSize,1,100);const match=typeof name==='string'?name:'';const where="deleted=0 AND instr(lower(name),lower(?))>0";return {studioMetaList:this.db.prepare(`SELECT * FROM studios WHERE ${where} ORDER BY updated_at DESC,uuid LIMIT ? OFFSET ?`).all(match,pageSize,(page-1)*pageSize).map(r=>this.meta(r)),total:this.db.prepare(`SELECT count(*) AS total FROM studios WHERE ${where}`).get(match).total};}
 remove(uuid){this.detail(uuid);this.db.prepare('UPDATE studios SET deleted=1,updated_at=? WHERE uuid=?').run(Date.now(),uuid);}
 snapshot(uuid){this.detail(uuid);return this.db.prepare('SELECT * FROM snapshots WHERE project_id=?').get(uuid);}
 commitSnapshot(uuid,revision,glbPath,jsonPath,settings={}){return this.transaction(()=>{const old=this.snapshot(uuid);if(old&&revision<=old.revision)throw Object.assign(Error('项目已有更新版本，请重新打开后重试'),{status:409});this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,glb_path=excluded.glb_path,json_path=excluded.json_path,saved_at=excluded.saved_at').run(uuid,revision,glbPath,jsonPath,Date.now());const detail=this.detail(uuid),root=JSON.parse(detail.config);root.animationPreview={...root.animationPreview,...settings,version:1};this.update({studioUuid:uuid,config:JSON.stringify(root)});return {revision};});}
 createSession(body){if(body.sessionId){const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(body.sessionId);if(row){if(row.project_id!==body.projectId)throw Error('会话不属于当前项目');return row.id;}}
  const id=body.sessionId||crypto.randomUUID();this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(id,body.projectId,body.name||'libtv_coding_agent',body.agentName||'libtv_coding_agent',body.nodeKey||'animation-preview',JSON.stringify(body.libtvMeta||{}),Date.now());return id;}
 addMessage(sessionId,message){this.db.prepare('INSERT INTO messages(id,session_id,role,body) VALUES(?,?,?,?) ON CONFLICT(id,session_id) DO UPDATE SET body=excluded.body').run(message.id,sessionId,message.role,JSON.stringify(message));}
 recordEvent(sessionId,runId,event){return this.recordEvents(sessionId,runId,[event])[0];}
 recordEvents(sessionId,runId,events){return this.transaction(()=>events.map(event=>this._recordEvent(sessionId,runId,event)));}
 _recordEvent(sessionId,runId,event){const inserted=this.db.prepare('INSERT INTO events(run_id,session_id,body) VALUES(?,?,?)').run(runId,sessionId,JSON.stringify(event));if(event.type==='TEXT_MESSAGE_CONTENT'){
   const id=event.messageId||`${runId}:assistant`,row=this.db.prepare('SELECT body FROM messages WHERE id=? AND session_id=?').get(id,sessionId),message=row?JSON.parse(row.body):{id,role:'assistant',text:''};message.text+=(event.delta||'');this.addMessage(sessionId,message);
  }else if(event.type==='TOOL_CALL_START')this.addMessage(sessionId,{id:event.toolCallId,role:'tool',toolName:event.toolCallName,toolStatus:'running',text:`正在执行 ${event.toolCallName}`});
  else if(event.type==='TOOL_CALL_END'){const row=this.db.prepare('SELECT body FROM messages WHERE id=? AND session_id=?').get(event.toolCallId,sessionId);if(row){const message=JSON.parse(row.body);message.toolStatus=event.error?'error':'completed';message.text=`${event.error?'执行失败':'已执行'} ${message.toolName}`;message.toolError=event.error?String(event.error).slice(0,1200):undefined;this.addMessage(sessionId,message);}}
  else if(event.type==='TOOL_CALL_RESULT'){
   const row=this.db.prepare('SELECT body FROM messages WHERE id=? AND session_id=?').get(event.toolCallId,sessionId);
   if(row){let result;try{result=JSON.parse(event.content);}catch{}
    if(result?.status==='error'){const message=JSON.parse(row.body);message.toolStatus='error';message.text=`执行失败 ${message.toolName}`;message.toolError=String(result.error||event.error||'工具执行失败').slice(0,1200);message.toolErrorDetails={groups:result.groups?.slice(0,10),logId:result.logId,stage:result.stage,diagnostics:result.diagnostics?.slice(0,12),repeat:result.repeat};this.addMessage(sessionId,message);}
   }
  }
  else if(event.type==='RUN_FINISHED'&&['partial','cancelled'].includes(event.status)){
   const text=event.message||(event.status==='cancelled'?'已取消，已保留最近成功的场景和预览。':['本轮部分完成。',...(event.outcome?.issues||[]).map(issue=>issue.message).filter(Boolean)].join('\n'));
   this.addMessage(sessionId,{id:`${runId}:outcome`,role:'assistant',text});
   if(event.status==='cancelled')for(const row of this.db.prepare("SELECT body FROM messages WHERE session_id=? AND role='tool'").all(sessionId)){const message=JSON.parse(row.body);if(message.toolStatus==='running'){message.toolStatus='cancelled';message.text=`已取消 ${message.toolName}`;this.addMessage(sessionId,message);}}
  }
  else if(event.type==='RUN_ERROR'){for(const row of this.db.prepare("SELECT body FROM messages WHERE session_id=? AND role='tool'").all(sessionId)){const message=JSON.parse(row.body);if(message.toolStatus==='running'){message.toolStatus='interrupted';message.text=`执行已中断 ${message.toolName}`;this.addMessage(sessionId,message);}}}
  return Number(inserted.lastInsertRowid);
 }
 runDetail(projectId,runId){
  const row=this.db.prepare('SELECT * FROM runs WHERE id=? AND project_id=?').get(runId,projectId);
  if(!row)throw Object.assign(Error('任务不存在或不属于当前项目'),{status:404});
  const last=this.db.prepare('SELECT body FROM events WHERE run_id=? AND json_extract(body,\'$.type\')=\'RESULT\' ORDER BY seq DESC LIMIT 1').get(runId);
  const terminal=this.db.prepare('SELECT body FROM events WHERE run_id=? AND json_extract(body,\'$.type\') IN (\'RUN_ERROR\',\'RUN_FINISHED\') ORDER BY seq DESC LIMIT 1').get(runId);
  const value=last?JSON.parse(last.body):null,finished=terminal?JSON.parse(terminal.body):null;
  const legacyCancelled=finished?.type==='RUN_ERROR'&&finished.message==='Cancelled by user';
  return {runId:row.id,sessionId:row.session_id,status:legacyCancelled?'cancelled':row.status,eventSeq:this.db.prepare('SELECT max(seq) AS seq FROM events WHERE run_id=?').get(runId).seq||0,result:value?.result||null,snapshotRevision:value?.snapshotRevision??null,error:finished?.type==='RUN_ERROR'&&!legacyCancelled?finished.message:null,...finished?.outcome?{outcome:finished.outcome}:{},...finished?.metrics?{metrics:finished.metrics}:{},...legacyCancelled?{message:'已取消，已保留最近成功的场景和预览。'}:finished?.type==='RUN_FINISHED'&&finished.message?{message:finished.message}:{}};
 }
 runEvents(projectId,runId,afterSeq=0){this.runDetail(projectId,runId);return this.db.prepare('SELECT seq,body FROM events WHERE run_id=? AND seq>? ORDER BY seq').all(runId,afterSeq).map(row=>({...JSON.parse(row.body),seq:row.seq}));}
 history(projectId,sessionId,afterSeq=0){if(sessionId){const row=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);if(!row||row.project_id!==projectId)throw Error('会话不属于当前项目');}const rows=this.db.prepare('SELECT m.* FROM messages m JOIN sessions s ON s.id=m.session_id WHERE s.project_id=? AND (? IS NULL OR s.id=?) AND m.seq>? ORDER BY m.seq').all(projectId,sessionId||null,sessionId||null,Number(afterSeq)||0);const run=this.db.prepare('SELECT id FROM runs WHERE project_id=? AND (? IS NULL OR session_id=?) ORDER BY created_at DESC,rowid DESC LIMIT 1').get(projectId,sessionId||null,sessionId||null),latestRun=run?this.runDetail(projectId,run.id):null;return {messages:rows.map(row=>({...JSON.parse(row.body),...JSON.parse(row.body).attachments?{attachments:JSON.parse(row.body).attachments.map(file=>({...file,name:normalizeUploadName(file.name)}))}:{},messageId:row.id,seq:row.seq})),latestSeq:rows.at(-1)?.seq||0,runStatus:latestRun?.status||'idle',latestRun};}
}
export function integer(value,min,max){const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('无效的整数参数');return n;}
export function validateConfig(config){if(typeof config!=='string'||config.length>22*1024*1024)throw Error('无效的项目配置');const root=JSON.parse(config);if(!root||Array.isArray(root)||typeof root!=='object')throw Error('无效的项目配置');const s=root.animationPreview;if(s&&s.version!==1)throw Error('不支持的项目版本');const g=s?.generationSettings;if(g){if(!['16:9','9:16','4:3','3:4','21:9','1:1'].includes(g.aspectRatio))throw Error('不支持的画幅比');if(g.durationSeconds!==undefined&&g.durationSeconds!=='auto')integer(g.durationSeconds,5,60);}return root;}
