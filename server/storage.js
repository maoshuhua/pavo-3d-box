import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DATA} from './config.js';
import {parseWorkspacePath} from './workspacePaths.js';
export {DiskSaver} from './checkpointStore.js';

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
  const {parts}=parseWorkspacePath(virtualPath);
  const file=path.resolve(dir, 'workspace', ...parts);
  if(!file.startsWith(path.resolve(dir,'workspace')+path.sep))throw Error('Invalid workspace path');
  return file;
}
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
