import fs from 'node:fs/promises';
import path from 'node:path';
const folder=process.argv[2];if(!folder)throw Error('Pass verification output folder');
const {execution,modelBatches}=JSON.parse(await fs.readFile(path.join(folder,'execution.json'),'utf8'));
const starts=new Map(),writes=[];
for(const event of execution){
 if(event.name!=='x_write')continue;
 if(event.phase==='start')starts.set(event.callId,event);
 else{const start=starts.get(event.callId);if(start)writes.push({id:event.callId,path:start.paths[0],start:start.at,end:event.at,durationMs:event.at-start.at});}
}
const overlaps=[];
for(let i=0;i<writes.length;i++)for(let j=i+1;j<writes.length;j++){
 const a=writes[i],b=writes[j],overlapMs=Math.min(a.end,b.end)-Math.max(a.start,b.start);
 if(overlapMs>0&&a.path.toLowerCase()!==b.path.toLowerCase())overlaps.push({paths:[a.path,b.path],overlapMs});
}
const batches=modelBatches.map((calls,index)=>({index,writes:calls.filter(c=>c.name==='x_write')})).filter(b=>b.writes.length);
let active=0,maxConcurrentWrites=0;
for(const point of writes.flatMap(w=>[{at:w.start,delta:1},{at:w.end,delta:-1}]).sort((a,b)=>a.at-b.at||a.delta-b.delta)){active+=point.delta;maxConcurrentWrites=Math.max(maxConcurrentWrites,active);}
const firstBuild=execution.find(e=>e.name==='build_3D_scene'&&e.phase==='start');
const report={writeCalls:writes.length,maxConcurrentWrites,allWritesStartSpreadMs:writes.length?Math.max(...writes.map(w=>w.start))-Math.min(...writes.map(w=>w.start)):null,buildWaitedForWrites:firstBuild?writes.filter(w=>w.start<firstBuild.at).every(w=>w.end<=firstBuild.at):null,files:[...new Set(writes.map(w=>w.path))],modelWriteBatches:batches.map(b=>({index:b.index,paths:b.writes.map(w=>w.path)})),sameResponseMultipleWrites:batches.some(b=>b.writes.length>1),actualOverlappingWrites:overlaps.length>0,overlapPairCount:overlaps.length,overlapExamples:overlaps.slice(0,8),writes};
await fs.writeFile(path.join(folder,'concurrency-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
