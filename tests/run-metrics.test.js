import test from 'node:test';
import assert from 'node:assert/strict';
import {createRunMetrics,instrumentCheckpoint} from '../server/runMetrics.js';

test('metrics measure models, first output, reported usage, stages and failures without payloads',async()=>{
 let time=0;const m=createRunMetrics({now:()=>time});m.modelStart('id');time=10;m.modelChunk('id');time=15;m.modelChunk('id');time=30;m.modelEnd('id',{input_tokens:40,output_tokens:8});
 await m.measure('tool.read',async()=>{time=40;});await assert.rejects(m.measure('tool.write',async()=>{time=45;throw Error('secret prompt');}));m.artifact();
 m.modelStart('aborted');time=55;m.finishModels();const result=m.snapshot();
 assert.equal(result.firstOutputMs,10);assert.equal(result.firstArtifactMs,45);assert.equal(result.stages['model.firstOutput'].count,1);
 assert.equal(result.stages['model.call'].count,2);assert.equal(result.stages['model.call'].errors,1);assert.deepEqual(result.tokens,{input:40,output:8,reportedCalls:1});
 assert.equal(result.stages['tool.write'].errors,1);assert(!JSON.stringify(result).includes('secret'));
 assert.equal(createRunMetrics().snapshot().tokens,null,'unknown usage must not be presented as zero tokens');
});
test('checkpoint instrumentation retains receiver, return values and original errors',async()=>{
 const m=createRunMetrics(),error=Error('original'),saver={value:1,async put(){return ++this.value;},async getTuple(){throw error;},async putWrites(){},async deleteThread(){},async close(){this.closed=true;}};
 instrumentCheckpoint(saver,m);assert.equal(await saver.put(),2);await assert.rejects(saver.getTuple(),e=>e===error);await saver.close();
 assert.equal(saver.closed,true);assert.equal(m.snapshot().stages['checkpoint.getTuple'].errors,1);
});
