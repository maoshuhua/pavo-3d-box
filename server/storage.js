import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {serialize, deserialize} from 'node:v8';
import {setTimeout as delay} from 'node:timers/promises';
import {MemorySaver} from '@langchain/langgraph-checkpoint';
import {DATA} from './config.js';

export function safeId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ['__proto__','constructor','prototype'].includes(value)) throw Error('Invalid project/session/run identifier');
  return value;
}
export function projectDir(projectId) { return path.join(DATA, 'projects', safeId(projectId)); }
export async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp,data);
    for(let attempt=0;;attempt++){
      try {await fs.rename(tmp,file);break;}
      catch(error){
        // Windows indexing/antivirus can briefly hold a newly replaced file.
        // Retry the atomic rename; never remove the last good checkpoint first.
        if(process.platform!=='win32'||!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=6)throw error;
        await delay(20*2**attempt);
      }
    }
  }
  finally { await fs.rm(tmp,{force:true}).catch(()=>{}); }
}
export async function readJson(file, fallback) {
  try {return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(e) {if(e.code==='ENOENT')return fallback;throw e;}
}
export function sourcePath(dir, virtualPath) {
  if (typeof virtualPath!=='string' || !/^\/[a-zA-Z0-9_/-]+\.(js|json|txt|md)$/.test(virtualPath) || virtualPath.includes('..')) throw Error('Only virtual .js/.json/.txt/.md workspace paths are allowed');
  const file=path.resolve(dir, 'workspace', `.${virtualPath}`);
  if(!file.startsWith(path.resolve(dir,'workspace')+path.sep))throw Error('Invalid workspace path');
  return file;
}
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export const DEFAULT_CHECKPOINT_HISTORY = 4;

// Older runs put rendered pixels on ToolMessage.artifact. Keep the textual
// result, but do not bring those large raster strings back into model history.
export function stripLegacyPreviewImages(value,seen=new WeakSet()){
 if(!value||typeof value!=='object'||ArrayBuffer.isView(value)||seen.has(value))return false;
 seen.add(value);let changed=false;
 for(const key of Object.keys(value)){
  if(key==='previewImage'&&typeof value[key]==='string'&&/^data:image\//.test(value[key])){delete value[key];changed=true;}
  else if(stripLegacyPreviewImages(value[key],seen))changed=true;
 }
 return changed;
}

// MemorySaver's serializer and pending-write order remain those of LangGraph.
// Mutations AND serialization run in one queue: a later write cannot overtake a
// snapshot whose bytes were captured before an earlier operation completed.
export class DiskSaver extends MemorySaver {
  constructor(file,{historyLimit=DEFAULT_CHECKPOINT_HISTORY}={}) {
    super();this.file=file;this.queue=Promise.resolve();
    if(!Number.isSafeInteger(historyLimit)||historyLimit<2||historyLimit>100)throw Error('Checkpoint history limit must be between 2 and 100');
    this.historyLimit=historyLimit;
  }
  static async open(file,options) {
    const saver=new DiskSaver(file,options);let loaded=false;
    try { const saved=deserialize(await fs.readFile(file)); saver.storage=saved.storage; saver.writes=saved.writes; }
    catch(e) {if(e.code!=='ENOENT')throw Error('Agent checkpoint is unreadable',{cause:e});}
    if(Object.keys(saver.storage).length||Object.keys(saver.writes).length)loaded=true;
    if(loaded){await saver.migrateLegacy();await saver.persist();}
    return saver;
  }
  enqueue(operation){
    const pending=this.queue.catch(()=>{}).then(operation);this.queue=pending;return pending;
  }
  async migrateLegacy(){
    const clean=async bytes=>{
      if(!Buffer.from(bytes).includes('previewImage'))return bytes;
      const value=await this.serde.loadsTyped('json',bytes);
      if(!stripLegacyPreviewImages(value))return bytes;
      return (await this.serde.dumpsTyped(value))[1];
    };
    for(const namespaces of Object.values(this.storage))for(const checkpoints of Object.values(namespaces))for(const entry of Object.values(checkpoints))entry[0]=await clean(entry[0]);
    for(const writes of Object.values(this.writes))for(const entry of Object.values(writes))entry[2]=await clean(entry[2]);
  }
  async prune(){
    for(const [threadId,namespaces]of Object.entries(this.storage))for(const [namespace,checkpoints]of Object.entries(namespaces)){
      const ids=Object.keys(checkpoints).sort().reverse();if(ids.length<=this.historyLimit)continue;
      const keep=new Set(ids.slice(0,this.historyLimit)),decoded=new Map(),deltaChannels=new Set();
      const decode=async id=>{
        if(!decoded.has(id)){
          const entry=checkpoints[id];if(!entry)return;
          decoded.set(id,{checkpoint:await this.serde.loadsTyped('json',entry[0]),metadata:await this.serde.loadsTyped('json',entry[1])});
        }
        return decoded.get(id);
      };
      // Delta channels intentionally omit their accumulated value. Preserve
      // their on-path ancestors until a snapshot, rather than corrupt resume by
      // blindly truncating the parent chain. Ordinary graph states stay at 4.
      for(const id of ids){const item=await decode(id);for(const name of Object.keys(item.metadata.counters_since_delta_snapshot||{}))deltaChannels.add(name);for(const [name,value]of Object.entries(item.checkpoint.channel_values||{}))if(value?.lg_name==='DeltaSnapshot')deltaChannels.add(name);}
      for(const id of [...keep]){
        const item=await decode(id),values=item.checkpoint.channel_values||{};
        const needed=new Set([...deltaChannels].filter(name=>!Object.hasOwn(values,name)&&(item.metadata.delta_writes_versioned!==true||item.checkpoint.channel_versions?.[name]!==undefined)));
        let parent=checkpoints[id][2];
        if(item.checkpoint.v<4&&parent&&checkpoints[parent])keep.add(parent);
        const visited=new Set();
        while(parent&&needed.size&&!visited.has(parent)){
          visited.add(parent);const ancestor=await decode(parent);if(!ancestor)break;
          keep.add(parent);
          for(const name of needed)if(Object.hasOwn(ancestor.checkpoint.channel_values||{},name))needed.delete(name);
          parent=checkpoints[parent][2];
        }
      }
      for(const id of ids)if(!keep.has(id)){delete checkpoints[id];delete this.writes[JSON.stringify([threadId,namespace,id])];}
    }
  }
  async flush(){await this.prune();await atomicWrite(this.file,serialize({storage:this.storage,writes:this.writes}));}
  persist(){return this.enqueue(()=>this.flush());}
  put(...args){return this.enqueue(async()=>{const result=await super.put(...args);await this.flush();return result;});}
  putWrites(...args){return this.enqueue(async()=>{await super.putWrites(...args);await this.flush();});}
  deleteThread(...args){return this.enqueue(async()=>{await super.deleteThread(...args);await this.flush();});}
  async getTuple(...args){await this.queue;const tuple=await super.getTuple(...args);if(tuple)stripLegacyPreviewImages(tuple);return tuple;}
  async *list(...args){await this.queue;for await(const tuple of super.list(...args)){stripLegacyPreviewImages(tuple);yield tuple;}}
  async getDeltaChannelHistory(...args){await this.queue;const history=await super.getDeltaChannelHistory(...args);stripLegacyPreviewImages(history);return history;}
}

