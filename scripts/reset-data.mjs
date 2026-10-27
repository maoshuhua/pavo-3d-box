import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import {ROOT,DATA,PORT} from '../server/config.js';

const execute=process.argv.includes('--execute');
const extra=process.argv.includes('--artifacts');
// Keep reset targets inside this checkout; an external DATA needs manual review.
const targets=[DATA,...extra?['output','test-output','tmp','.playwright-cli'].map(p=>path.join(ROOT,p)):[]];
for(const target of targets){
 const relative=path.relative(ROOT,target);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error(`Unsafe reset target: ${target}`);
 try{if((await fs.lstat(target)).isSymbolicLink())throw Error(`Linked reset target: ${target}`);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const backup=path.join(path.dirname(ROOT),path.basename(ROOT)+'-backups',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,8));
console.log(JSON.stringify({execute,targets,backup},null,2));
if(!execute)process.exit(0);
for(const port of new Set([PORT,5173,4173])){
 const listening=await new Promise(resolve=>{
  const socket=net.connect({host:'127.0.0.1',port});
  socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(true);});
  socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});
 });
 if(listening)throw Error(`Stop the project service on port ${port} before resetting.`);
}
await fs.mkdir(backup,{recursive:true});
const report={createdAt:new Date().toISOString(),generation:crypto.randomUUID(),moved:[]};
for(const target of targets){
 try{await fs.access(target);}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const destination=path.join(backup,path.relative(ROOT,target));
 await fs.mkdir(path.dirname(destination),{recursive:true});
 try{await fs.rename(target,destination);}catch(error){
  if(target===DATA)throw error;
  report.skipped??=[];report.skipped.push({path:target,error:error.code});
  console.warn(`Artifact folder retained (${error.code}): ${target}`);continue;
 }
 report.moved.push({source:target,backup:destination});
 await fs.writeFile(path.join(backup,'reset-report.json'),JSON.stringify(report,null,2));
}
await fs.mkdir(DATA,{recursive:true});
await fs.writeFile(path.join(DATA,'data-generation.json'),JSON.stringify({generation:report.generation}));
await fs.writeFile(path.join(backup,'reset-report.json'),JSON.stringify(report,null,2));
console.log(`Reset complete. Backup: ${backup}`);
