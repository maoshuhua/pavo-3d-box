import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {BaseCheckpointSaver,WRITES_IDX_MAP,copyCheckpoint,getCheckpointId,compareWritesSortKeys,writesSortKey,maxChannelVersion} from '@langchain/langgraph-checkpoint';

const CHUNK_SIZE=64*1024,MiB=1024*1024;
const migrations=new Map();
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const sqlitePath=file=>file.endsWith('.bin')?file.slice(0,-4)+'.sqlite':file+'.sqlite';
function identifier(field,value,allowEmpty=false){
 if(typeof value!=='string'||(!allowEmpty&&!value)||['__proto__','constructor','prototype'].includes(value))throw Error(`Invalid configurable ${field}`);
 return value;
}
function keys(config,{required=true}={}){
 const c=config?.configurable||{},thread=c.thread_id,namespace=c.checkpoint_ns??'';
 if(required||thread!==undefined)identifier('thread_id',thread);
 identifier('checkpoint_ns',namespace,true);
 const id=getCheckpointId(config||{});if(id)identifier('checkpoint_id',id);
 return {thread,namespace,id};
}
async function exists(file){try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

// V8's old monolithic format cannot be decoded incrementally. Decode it only in
// a disposable process with an explicit heap, memory preflight and cancellation.
// Its SQLite output is not published until the entire import commits and closes.
async function migrateLegacy(file,destination,{signal,migrationTimeoutMs=600000}={}){
 signal?.throwIfAborted();
 const size=(await fs.stat(file)).size;
 const available=Math.min(os.freemem(),process.availableMemory?.()||Infinity);
 const memoryBudget=Math.floor(available*.75),required=size*3+256*MiB;
 if(required>memoryBudget)throw Error('旧 Agent checkpoint 迁移所需内存暂不足，原 checkpoint.bin 已保留。请释放内存后重试，或在内存充足的环境离线迁移；未创建空会话。');
 const heapMiB=Math.max(128,Math.min(4096,Math.floor((memoryBudget-size*2)/MiB)));
 const temporary=destination+'.migration-'+crypto.randomUUID();
 try{
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[`--max-old-space-size=${heapMiB}`,'--expose-gc',fileURLToPath(new URL('./checkpointMigration.js',import.meta.url)),file,temporary,String(memoryBudget)],{windowsHide:true,stdio:['ignore','ignore','pipe']});
   let detail='',failure;
   child.stderr.on('data',chunk=>{if(detail.length<1200)detail+=String(chunk).slice(0,1200-detail.length);});
   const stop=reason=>{failure=reason;child.kill();};
   const abort=()=>stop(signal.reason||new DOMException('Aborted','AbortError'));
   const timeout=setTimeout(()=>stop(Error('Agent checkpoint migration exceeded time limit; original checkpoint.bin is preserved and migration can be retried')),migrationTimeoutMs);
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
   child.once('error',error=>{failure=error;});
   child.once('close',code=>{clearTimeout(timeout);signal?.removeEventListener('abort',abort);if(failure)reject(failure);else if(code!==0)reject(Error(`Agent checkpoint migration failed; original checkpoint.bin is preserved and migration can be retried${detail?': '+detail.trim():''}`));else resolve();});
  });
  signal?.throwIfAborted();
  // Publish without replacing a database another service may already be using.
  // A same-directory hard link is atomic; the temporary name is removed below.
  try{await fs.link(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;}
 }finally{for(const suffix of ['', '-journal','-wal','-shm'])await fs.rm(temporary+suffix,{force:true}).catch(()=>{});}
}

export class DiskSaver extends BaseCheckpointSaver {
 constructor(file,{serde,migration=false}={}){
  super(serde);this.file=file;this.queue=Promise.resolve();this.closed=false;
  this.db=new DatabaseSync(file);
  try{
   this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=${migration?'DELETE':'WAL'}; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS checkpoint_store_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoint_chunks(hash TEXT PRIMARY KEY,data BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoint_payloads(hash TEXT PRIMARY KEY,type TEXT NOT NULL,size INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS checkpoint_payload_chunks(payload_hash TEXT NOT NULL REFERENCES checkpoint_payloads(hash) ON DELETE CASCADE,ordinal INTEGER NOT NULL,chunk_hash TEXT NOT NULL REFERENCES checkpoint_chunks(hash),PRIMARY KEY(payload_hash,ordinal));
    CREATE INDEX IF NOT EXISTS checkpoint_chunk_refs ON checkpoint_payload_chunks(chunk_hash);
    CREATE TABLE IF NOT EXISTS checkpoints(thread_id TEXT NOT NULL,namespace TEXT NOT NULL,id TEXT NOT NULL,parent_id TEXT,header_hash TEXT NOT NULL REFERENCES checkpoint_payloads(hash),metadata_hash TEXT NOT NULL REFERENCES checkpoint_payloads(hash),PRIMARY KEY(thread_id,namespace,id));
    CREATE TABLE IF NOT EXISTS checkpoint_channels(thread_id TEXT NOT NULL,namespace TEXT NOT NULL,checkpoint_id TEXT NOT NULL,channel TEXT NOT NULL,payload_hash TEXT NOT NULL REFERENCES checkpoint_payloads(hash),PRIMARY KEY(thread_id,namespace,checkpoint_id,channel),FOREIGN KEY(thread_id,namespace,checkpoint_id) REFERENCES checkpoints(thread_id,namespace,id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS checkpoint_writes(thread_id TEXT NOT NULL,namespace TEXT NOT NULL,checkpoint_id TEXT NOT NULL,task_id TEXT NOT NULL,idx INTEGER NOT NULL,channel TEXT NOT NULL,payload_hash TEXT NOT NULL REFERENCES checkpoint_payloads(hash),task_path TEXT NOT NULL,PRIMARY KEY(thread_id,namespace,checkpoint_id,task_id,idx));
   `);
  }catch(error){this.db.close();throw error;}
 }
 static async open(file,options={}){
  options.signal?.throwIfAborted();const database=sqlitePath(file);
  await fs.mkdir(path.dirname(database),{recursive:true});
  const legacyExists=await exists(file);
  if(!await exists(database)&&legacyExists){
   let pending=migrations.get(database);
   if(!pending){pending=migrateLegacy(file,database,options);migrations.set(database,pending);pending.finally(()=>{if(migrations.get(database)===pending)migrations.delete(database);}).catch(()=>{});}
   await pending;
  }
  if(legacyExists){
   let check;
   try{
    check=new DatabaseSync(database,{readOnly:true});
    if(check.prepare("SELECT value FROM checkpoint_store_meta WHERE key='legacy_import_completed'").get()?.value!=='1')throw Error('Incomplete migration');
   }catch(error){throw Error('Agent checkpoint migration is incomplete; original checkpoint.bin is preserved. Refusing to open an empty replacement session.',{cause:error});}
   finally{check?.close();}
  }
  options.signal?.throwIfAborted();return new DiskSaver(database,options);
 }
 _enqueue(work){
  const result=this.queue.then(()=>{if(this.closed)throw Error('Agent checkpoint store is closed');return work();});
  // A failed write is reported to its caller, without poisoning later saves.
  this.queue=result.catch(()=>{});return result;
 }
 _transaction(work){
  if(this.migrationTransaction)return work();
  this.db.exec('BEGIN IMMEDIATE');try{const value=work();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 _savePayload(type,bytes){
  bytes=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const id=crypto.createHash('sha256').update(type).update('\0').update(bytes).digest('hex');
  if(this.db.prepare('SELECT 1 FROM checkpoint_payloads WHERE hash=?').get(id))return id;
  this.db.prepare('INSERT INTO checkpoint_payloads VALUES(?,?,?)').run(id,type,bytes.length);
  for(let offset=0,ordinal=0;offset<bytes.length;offset+=CHUNK_SIZE,ordinal++){
   const chunk=bytes.subarray(offset,offset+CHUNK_SIZE),chunkId=hash(chunk);
   this.db.prepare('INSERT OR IGNORE INTO checkpoint_chunks VALUES(?,?)').run(chunkId,chunk);
   this.db.prepare('INSERT INTO checkpoint_payload_chunks VALUES(?,?,?)').run(id,ordinal,chunkId);
  }
  return id;
 }
 async _loadPayload(id){
  const payload=this.db.prepare('SELECT type,size FROM checkpoint_payloads WHERE hash=?').get(id);
  if(!payload)throw Error('Agent checkpoint payload is missing');
  const rows=this.db.prepare('SELECT c.data FROM checkpoint_payload_chunks p JOIN checkpoint_chunks c ON c.hash=p.chunk_hash WHERE p.payload_hash=? ORDER BY p.ordinal').all(id);
  const bytes=Buffer.concat(rows.map(row=>row.data));
  if(bytes.length!==payload.size)throw Error('Agent checkpoint payload is incomplete');
  return this.serde.loadsTyped(payload.type,new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength));
 }
 _orderedWrites(thread,namespace,id){
  return this.db.prepare('SELECT task_id,idx,channel,payload_hash,task_path FROM checkpoint_writes WHERE thread_id=? AND namespace=? AND checkpoint_id=?').all(thread,namespace,id)
   .sort((a,b)=>compareWritesSortKeys(writesSortKey(a.task_path,a.task_id,a.idx),writesSortKey(b.task_path,b.task_id,b.idx)));
 }
 async _tuple(row,config){
  const checkpoint=await this._loadPayload(row.header_hash);checkpoint.channel_values={};
  for(const channel of this.db.prepare('SELECT channel,payload_hash FROM checkpoint_channels WHERE thread_id=? AND namespace=? AND checkpoint_id=?').all(row.thread_id,row.namespace,row.id))
   Object.defineProperty(checkpoint.channel_values,channel.channel,{value:await this._loadPayload(channel.payload_hash),enumerable:true,writable:true,configurable:true});
  const pendingWrites=[];
  for(const write of this._orderedWrites(row.thread_id,row.namespace,row.id))pendingWrites.push([write.task_id,write.channel,await this._loadPayload(write.payload_hash)]);
  // Compatibility with MemorySaver's pre-v4 pending-send migration.
  if(checkpoint.v<4&&row.parent_id!==null){
   const sends=[];for(const write of this._orderedWrites(row.thread_id,row.namespace,row.parent_id))if(write.channel==='__pregel_tasks')sends.push(await this._loadPayload(write.payload_hash));
   checkpoint.channel_values.__pregel_tasks=sends;checkpoint.channel_versions??={};
   checkpoint.channel_versions.__pregel_tasks=Object.keys(checkpoint.channel_versions).length?maxChannelVersion(...Object.values(checkpoint.channel_versions)):this.getNextVersion(undefined);
  }
  const tuple={config:config||{configurable:{thread_id:row.thread_id,checkpoint_ns:row.namespace,checkpoint_id:row.id}},checkpoint,metadata:await this._loadPayload(row.metadata_hash),pendingWrites};
  if(row.parent_id!==null)tuple.parentConfig={configurable:{thread_id:row.thread_id,checkpoint_ns:row.namespace,checkpoint_id:row.parent_id}};
  return tuple;
 }
 async getTuple(config){
  await this.queue;if(this.closed)throw Error('Agent checkpoint store is closed');
  const {thread,namespace,id}=keys(config,{required:false});if(thread===undefined)return undefined;
  const row=id?this.db.prepare('SELECT * FROM checkpoints WHERE thread_id=? AND namespace=? AND id=?').get(thread,namespace,id):this.db.prepare('SELECT * FROM checkpoints WHERE thread_id=? AND namespace=? ORDER BY id DESC LIMIT 1').get(thread,namespace);
  return row?this._tuple(row,id?config:undefined):undefined;
 }
 async *list(config={},options={}){
  await this.queue;if(this.closed)throw Error('Agent checkpoint store is closed');
  const {thread,id}=keys(config,{required:false}),namespace=config.configurable?.checkpoint_ns,before=getCheckpointId(options.before||{});
  if(before)identifier('checkpoint_id',before);
  const clauses=[],params=[];for(const [column,value] of [['thread_id',thread],['namespace',namespace],['id',id||undefined]])if(value!==undefined){clauses.push(column+'=?');params.push(value);}
  if(before){clauses.push('id<?');params.push(before);}
  const where=clauses.length?' WHERE '+clauses.join(' AND '):'';let remaining=options.limit??Infinity,offset=0;
  // Read keys in small pages; never hydrate the entire checkpoint history.
  while(remaining>0){
   const rows=this.db.prepare(`SELECT * FROM checkpoints${where} ORDER BY id DESC,thread_id,namespace LIMIT 32 OFFSET ?`).all(...params,offset);
   if(!rows.length)return;offset+=rows.length;
   for(const row of rows){
    if(options.filter){const metadata=await this._loadPayload(row.metadata_hash);if(!Object.entries(options.filter).every(([key,value])=>metadata[key]===value))continue;}
    yield await this._tuple(row);if(--remaining<=0)return;
   }
  }
 }
 async put(config,checkpoint,metadata){
  const {thread,namespace}=keys(config),prepared=copyCheckpoint(checkpoint),parent=config.configurable?.checkpoint_id??null;
  identifier('checkpoint_id',prepared.id);if(parent!==null)identifier('checkpoint_id',parent);
  return this._enqueue(async()=>{
   const {channel_values:values,...header}=prepared;
   const serializedHeader=await this.serde.dumpsTyped(header),serializedMetadata=await this.serde.dumpsTyped(metadata),channels=[];
   for(const [channel,value] of Object.entries(values))channels.push([channel,await this.serde.dumpsTyped(value)]);
   this._transaction(()=>{
    const headerId=this._savePayload(...serializedHeader),metadataId=this._savePayload(...serializedMetadata);
    this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?) ON CONFLICT(thread_id,namespace,id) DO UPDATE SET parent_id=excluded.parent_id,header_hash=excluded.header_hash,metadata_hash=excluded.metadata_hash').run(thread,namespace,prepared.id,parent,headerId,metadataId);
    this.db.prepare('DELETE FROM checkpoint_channels WHERE thread_id=? AND namespace=? AND checkpoint_id=?').run(thread,namespace,prepared.id);
    for(const [channel,payload] of channels)this.db.prepare('INSERT INTO checkpoint_channels VALUES(?,?,?,?,?)').run(thread,namespace,prepared.id,channel,this._savePayload(...payload));
   });
   return {configurable:{thread_id:thread,checkpoint_ns:namespace,checkpoint_id:prepared.id}};
  });
 }
 async putWrites(config,writes,taskId,taskPath=''){
  const {thread,namespace,id}=keys(config);identifier('checkpoint_id',id);identifier('task_id',taskId);
  if(typeof taskPath!=='string')throw Error('Invalid task path');
  return this._enqueue(async()=>{
   const serialized=[];for(let i=0;i<writes.length;i++)serialized.push({idx:WRITES_IDX_MAP[writes[i][0]]??i,channel:writes[i][0],payload:await this.serde.dumpsTyped(writes[i][1])});
   this._transaction(()=>{for(const write of serialized){
    const present=this.db.prepare('SELECT 1 FROM checkpoint_writes WHERE thread_id=? AND namespace=? AND checkpoint_id=? AND task_id=? AND idx=?').get(thread,namespace,id,taskId,write.idx);
    if(write.idx>=0&&present)continue;
    this.db.prepare('INSERT INTO checkpoint_writes VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(thread_id,namespace,checkpoint_id,task_id,idx) DO UPDATE SET channel=excluded.channel,payload_hash=excluded.payload_hash,task_path=excluded.task_path').run(thread,namespace,id,taskId,write.idx,write.channel,this._savePayload(...write.payload),taskPath);
   }});
  });
 }
 async deleteThread(threadId){
  identifier('thread_id',threadId);return this._enqueue(()=>this._transaction(()=>{
   this.db.prepare('DELETE FROM checkpoint_writes WHERE thread_id=?').run(threadId);this.db.prepare('DELETE FROM checkpoints WHERE thread_id=?').run(threadId);
   this.db.exec(`DELETE FROM checkpoint_payloads WHERE NOT EXISTS(SELECT 1 FROM checkpoints WHERE header_hash=checkpoint_payloads.hash OR metadata_hash=checkpoint_payloads.hash) AND NOT EXISTS(SELECT 1 FROM checkpoint_channels WHERE payload_hash=checkpoint_payloads.hash) AND NOT EXISTS(SELECT 1 FROM checkpoint_writes WHERE payload_hash=checkpoint_payloads.hash);
    DELETE FROM checkpoint_chunks WHERE NOT EXISTS(SELECT 1 FROM checkpoint_payload_chunks WHERE chunk_hash=checkpoint_chunks.hash);`);
  }));
 }
 async close(){await this.queue;if(!this.closed){this.db.close();this.closed=true;}}
}
