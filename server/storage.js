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

// MemorySaver's serializer and tuple semantics remain those of LangGraph.
// V8 preserves Uint8Array checkpoint blobs; each update commits atomically on disk.
export class DiskSaver extends MemorySaver {
  constructor(file) { super(); this.file=file; this.queue=Promise.resolve(); }
  static async open(file) {
    const saver=new DiskSaver(file);
    try { const saved=deserialize(await fs.readFile(file)); saver.storage=saved.storage; saver.writes=saved.writes; }
    catch(e) {if(e.code!=='ENOENT')throw Error('Agent checkpoint is unreadable',{cause:e});}
    return saver;
  }
  persist() { const bytes=serialize({storage:this.storage,writes:this.writes}); this.queue=this.queue.then(()=>atomicWrite(this.file,bytes));return this.queue; }
  async put(...args) {const result=await super.put(...args);await this.persist();return result;}
  async putWrites(...args) {await super.putWrites(...args);await this.persist();}
  async deleteThread(...args) {await super.deleteThread(...args);await this.persist();}
}

