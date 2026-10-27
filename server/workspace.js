import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWrite,sourcePath,sha256} from './storage.js';
import {WORKSPACE_FILE as FILE,WORKSPACE_DIRECTORY as DIRECTORY,WORKSPACE_DEVICE as DEVICE,parseWorkspacePath} from './workspacePaths.js';

const READ_LIMIT = 32 * 1024 * 1024;
const OUTPUT_LIMIT = 64000;
const SCAN_LIMIT = 10000;

// All paths are virtual and relative to this project's workspace. Inspect each
// existing component: a local junction/symlink must not turn listing into host access.
export async function workspaceTarget(dir,virtualPath,{directory=false,write=false}={}) {
 const {path:normalized,parts}=parseWorkspacePath(virtualPath,{directory});
 if(write&&['/context.json','/scene-api.txt'].includes(normalized.toLowerCase()))throw Error('Context and scene API files are read-only');
 const root=path.resolve(dir,'workspace');
 const file=directory?path.resolve(root,...parts):sourcePath(dir,normalized);
 if(file!==root&&!file.startsWith(root+path.sep))throw Error('Invalid workspace path');
 let current=root;
 for(const part of ['',...parts]){
  if(part)current=path.join(current,part);
  try {if((await fs.lstat(current)).isSymbolicLink())throw Error('Symbolic links and junctions are not allowed in workspace paths');}
  catch(error){if(error.code==='ENOENT')break;throw error;}
 }
 return {file,path:normalized};
}

async function textFile(file) {
 const stat=await fs.stat(file);
 if(!stat.isFile())throw Error('A workspace file is required');
 if(stat.size>READ_LIMIT)throw Error('Workspace text file exceeds 32 MiB');
 return fs.readFile(file,'utf8');
}

async function* walk(dir,virtualPath,recursive,signal,state,depth=0) {
 signal?.throwIfAborted();
 const target=await workspaceTarget(dir,virtualPath,{directory:true});
 const entries=(await fs.readdir(target.file,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 for(const entry of entries){
  signal?.throwIfAborted();
  if(++state.scanned>SCAN_LIMIT){state.truncated=true;return;}
  if(entry.isSymbolicLink()||DEVICE.test(entry.name))continue;
  const entryPath=(target.path==='/'?'':target.path)+'/'+entry.name;
  if(entry.isDirectory()&&DIRECTORY.test(entry.name)){
   yield {path:entryPath,type:'directory'};
   if(recursive){
    if(depth>=64){state.truncated=true;continue;}
    yield* walk(dir,entryPath,true,signal,state,depth+1);
    if(state.scanned>SCAN_LIMIT)return;
   }
  }else if(entry.isFile()&&FILE.test(entry.name)){
   const child=await workspaceTarget(dir,entryPath);
   yield {path:entryPath,type:'file',bytes:(await fs.stat(child.file)).size};
  }
 }
}

export async function listWorkspace(dir,{path:virtualPath='/',recursive=false,max_entries=200},signal) {
 const target=await workspaceTarget(dir,virtualPath,{directory:true});
 const entries=[],state={scanned:0,truncated:false};
 for await(const entry of walk(dir,target.path,recursive,signal,state)){
  if(entries.length===max_entries){state.truncated=true;break;}
  entries.push(entry);
 }
 return {status:'completed',path:target.path,entries,truncated:state.truncated};
}

export async function readWorkspace(dir,{path:virtualPath,offset=0,column=0,limit=300},signal) {
 signal?.throwIfAborted();
 const target=await workspaceTarget(dir,virtualPath);
 const lines=(await textFile(target.file)).split('\n');
 signal?.throwIfAborted();
 let content='',next;
 for(let i=offset;i<Math.min(offset+limit,lines.length);i++){
  const start=i===offset?column:0,prefix=`${content?'\n':''}${i+1}: `;
  const available=OUTPUT_LIMIT-content.length-prefix.length;
  if(available<=0){next={offset:i,column:start};break;}
  const line=lines[i].slice(start),part=line.slice(0,available);
  content+=prefix+part;
  if(part.length<line.length){next={offset:i,column:start+part.length};break;}
  if(i+1<lines.length)next={offset:i+1,column:0};else next=undefined;
 }
 return {status:'completed',path:target.path,totalLines:lines.length,offset,content,truncated:!!next,...next?{next}:{}};
}

export async function grepWorkspace(dir,{pattern,path:virtualPath='/',case_sensitive=true,max_results=100},signal) {
 const isFile=FILE.test(virtualPath.split('/').at(-1)||'');
 const target=await workspaceTarget(dir,virtualPath,{directory:!isFile});
 const matches=[],state={scanned:0,truncated:false};
 const needle=case_sensitive?pattern:pattern.toLowerCase();
 let outputSize=0;
 const files=isFile?[{path:target.path,type:'file'}]:walk(dir,target.path,true,signal,state);
 for await(const entry of files){
  if(entry.type!=='file')continue;
  const file=await workspaceTarget(dir,entry.path);
  const lines=(await textFile(file.file)).split('\n');
  for(let i=0;i<lines.length;i++){
   if(i%256===0)signal?.throwIfAborted();
   const hit=(case_sensitive?lines[i]:lines[i].toLowerCase()).indexOf(needle);
   if(hit<0)continue;
   const available=OUTPUT_LIMIT-outputSize-entry.path.length-32;
   if(matches.length===max_results||available<Math.min(pattern.length,lines[i].length)){state.truncated=true;break;}
   const start=lines[i].length>available?Math.max(0,hit-Math.min(200,Math.floor((available-pattern.length)/2))):0;
   const text=lines[i].slice(start,start+available),textTruncated=text.length<lines[i].length;
   matches.push({path:entry.path,line:i+1,text,...textTruncated?{textOffset:start,textTruncated:true}:{}});outputSize+=text.length+entry.path.length+32;
  }
  if(state.truncated)break;
 }
 return {status:'completed',pattern,path:target.path,matches,truncated:state.truncated};
}

export async function writeWorkspace(dir,{path:virtualPath,content,overwrite=false}) {
 const target=await workspaceTarget(dir,virtualPath,{write:true});
 if(Buffer.byteLength(content)>1024*1024)throw Error('Scene program exceeds 1 MiB');
 let exists=false;try{await fs.access(target.file);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists&&!overwrite)throw Error('File exists; use x_edit or explicitly set overwrite=true');
 await atomicWrite(target.file,content);
 return {status:'completed',path:target.path,bytes:Buffer.byteLength(content),sha256:sha256(content)};
}

export async function copyWorkspace(dir,{source,destination,overwrite=false},signal) {
 signal?.throwIfAborted();
 const from=await workspaceTarget(dir,source),to=await workspaceTarget(dir,destination,{write:true});
 if(from.file.toLowerCase()===to.file.toLowerCase())throw Error('Source and destination must differ');
 const stat=await fs.stat(from.file);
 if(!stat.isFile()||stat.size>1024*1024)throw Error('Copy requires a workspace file of at most 1 MiB');
 const content=await fs.readFile(from.file);
 if(content.length>1024*1024)throw Error('Copy source exceeds 1 MiB');
 let exists=false;try{await fs.lstat(to.file);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
 if(exists&&!overwrite)throw Error('Destination exists; explicitly set overwrite=true');
 signal?.throwIfAborted();
 if(overwrite)await atomicWrite(to.file,content);
 else {
  await fs.mkdir(path.dirname(to.file),{recursive:true});
  const temp=to.file+'.'+crypto.randomUUID()+'.tmp';
  try {await fs.writeFile(temp,content,{flag:'wx'});signal?.throwIfAborted();await fs.link(temp,to.file);}
  finally {await fs.rm(temp,{force:true});}
 }
 return {status:'completed',source:from.path,destination:to.path,bytes:content.length,sha256:sha256(content),overwritten:exists};
}

export async function editWorkspace(dir,{path:virtualPath,old_string,new_string,replace_all=false}) {
 if(!old_string)throw Error('old_string must not be empty');
 const target=await workspaceTarget(dir,virtualPath,{write:true}),text=await textFile(target.file);
 const count=text.split(old_string).length-1;
 if(!count)throw Error('old_string not found');
 if(count>1&&!replace_all)throw Error('Multiple matches; provide a unique match or set replace_all=true');
 const content=replace_all?text.split(old_string).join(new_string):text.replace(old_string,()=>new_string);
 if(Buffer.byteLength(content)>1024*1024)throw Error('Scene program exceeds 1 MiB');
 await atomicWrite(target.file,content);
 return {status:'completed',path:target.path,replacements:replace_all?count:1,sha256:sha256(content)};
}
