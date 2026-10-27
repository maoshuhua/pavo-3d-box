import fs from 'node:fs/promises';
import {z} from 'zod';
import {workspaceTarget} from './workspace.js';
import {sha256} from './storage.js';

const manifestSchema=z.object({version:z.literal(1),entry:z.string(),modules:z.array(z.object({path:z.string(),dependsOn:z.array(z.string()).default([])}).strict()).max(100)}).strict();
const MAX_SOURCE=1024*1024;

export async function loadSceneProgram(dir,entry='/scene.js',signal){
 let total=0;const sources=[];
 const read=async virtual=>{
  signal?.throwIfAborted();
  const target=await workspaceTarget(dir,virtual),stat=await fs.stat(target.file);
  if(!stat.isFile()||stat.size>MAX_SOURCE)throw Error(`场景源文件超过 1 MiB：${virtual}`);
  const content=await fs.readFile(target.file,'utf8');total+=Buffer.byteLength(content);
  if(total>MAX_SOURCE)throw Error('场景多文件源码总量超过 1 MiB');
  sources.push({path:virtual,sha256:sha256(content)});return content;
 };
 let raw;
 try{await fs.access((await workspaceTarget(dir,'/manifest.json')).file);}
 catch(error){if(error.code!=='ENOENT')throw error;return {sourceCode:await read(entry),sources};}
 raw=await read('/manifest.json');
 const manifest=manifestSchema.parse(JSON.parse(raw));
 if(manifest.entry!==entry)throw Error(`构建入口与 manifest.entry 不一致：${entry}`);
 const modules=new Map(),casePaths=new Set([entry.toLowerCase()]);
 if(!entry.endsWith('.js'))throw Error('场景入口必须是 .js 文件');
 for(const module of manifest.modules){
  await workspaceTarget(dir,module.path);
  if(!module.path.endsWith('.js'))throw Error(`模块必须是 .js 文件：${module.path}`);
  if(casePaths.has(module.path.toLowerCase()))throw Error(`重复模块或入口：${module.path}`);
  casePaths.add(module.path.toLowerCase());modules.set(module.path,module);
 }
 const ordered=[],visiting=new Set(),visited=new Set();
 function visit(id){
  if(visited.has(id))return;
  if(visiting.has(id))throw Error(`模块循环依赖：${id}`);
  const module=modules.get(id);if(!module)throw Error(`模块依赖未声明：${id}`);
  visiting.add(id);for(const dep of module.dependsOn)visit(dep);
  visiting.delete(id);visited.add(id);ordered.push(module);
 }
 for(const id of modules.keys())visit(id);
 const compiled=[];
 for(const module of ordered){
  const content=await read(module.path);
  const deps=module.dependsOn.map(dep=>`${JSON.stringify(dep)}:__modules[${JSON.stringify(dep)}]`).join(',');
  compiled.push(`try {__modules[${JSON.stringify(module.path)}]=(function(ctx,deps,create){\n${content}\n;if(typeof create!=="function")throw Error("Define function create(ctx,deps)");return create(ctx,deps);})(ctx,Object.freeze({${deps}}));}catch(e){throw Error(${JSON.stringify(module.path+': ')}+e.message);}`);
 }
 const main=await read(entry);
 const sourceCode=`function build(ctx){const __modules=Object.create(null);\n${compiled.join('\n')}\nreturn (function(build,modules){\n${main}\n;if(typeof build!=="function")throw Error("Define function build(ctx,modules)");return build(ctx,modules);})(undefined,Object.freeze(__modules));}`;
 // evaluateProgram applies the same 1 MiB limit to generated executable code.
 return {sourceCode,sources};
}
