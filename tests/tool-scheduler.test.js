import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolScheduler} from '../server/toolScheduler.js';
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));

test('different paths overlap, case aliases serialize, builds fence both directions',async()=>{
 const schedule=createToolScheduler(),hold=gate(),events=[];
 const a=schedule(['/a.js'],async()=>{events.push('a');await hold.promise;});
 const b=schedule(['/b.js'],async()=>{events.push('b');await hold.promise;});
 const same=schedule(['/A.js'],()=>events.push('same'));
 const build=schedule(null,()=>events.push('build'));
 const later=schedule(['/c.js'],()=>events.push('later'));
 await tick();assert.deepEqual(events,['a','b']);hold.resolve();
 await Promise.all([a,b,same,build,later]);assert.deepEqual(events,['a','b','same','build','later']);
});
test('copy locks both endpoints and rejected operations release the queue',async()=>{
 const schedule=createToolScheduler(),hold=gate(),events=[];
 const copying=schedule(['/source.js','/dest.js'],async()=>{events.push('copy');await hold.promise;throw Error('failed');});
 const rejected=assert.rejects(copying,/failed/);
 const source=schedule(['/source.js'],()=>events.push('source'));
 const dest=schedule(['/dest.js'],()=>events.push('dest'));
 await tick();assert.deepEqual(events,['copy']);hold.resolve();
 await Promise.all([rejected,source,dest]);assert.deepEqual(events,['copy','source','dest']);
});
