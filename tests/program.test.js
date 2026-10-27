import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {evaluateProgram} from '../server/program.js';
import {sourcePath,DiskSaver} from '../server/storage.js';
import {emptyCheckpoint} from '@langchain/langgraph-checkpoint';
import {sceneSource} from './fixture.js';

test('scene code compiles procedural nodes and animated samples',async()=>{
 const spec=await evaluateProgram(sceneSource,{scene:{entities:[]}});
 assert.equal(spec.objects.length,18);assert.equal(spec.animations[0].tracks.length,2);
});
test('generated programs have no host access and infinite loops are interrupted',async()=>{
 await assert.rejects(()=>evaluateProgram('function build(){return require("node:fs")}',{}),/require/);
 await assert.rejects(()=>evaluateProgram('function build(){while(true){}}',{}),/interrupted/);
 await assert.rejects(()=>evaluateProgram('function build(){return {version:1,animations:[{id:"a",name:"a",duration:2,tracks:[{entityId:"c",property:"position",times:[1,0],values:[0,0,0,0,0,0]}]}]}}',{}),/increase/);
});
test('workspace paths cannot escape project',()=>{
 assert.throws(()=>sourcePath('C:/project','/../../.env'),/Only virtual/);
 assert.throws(()=>sourcePath('C:/project','F:/secret.js'),/Only virtual/);
});
test('LangGraph checkpoints survive service restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-checkpoint-'));
 let saver,reopened;
 try{
  const file=path.join(dir,'checkpoint.bin'),checkpoint=emptyCheckpoint();saver=await DiskSaver.open(file);checkpoint.channel_values={marker:'persistent'};
  await saver.put({configurable:{thread_id:'test-session',checkpoint_ns:''}},checkpoint,{source:'input',step:0,parents:{}});
  await saver.close();reopened=await DiskSaver.open(file);const tuple=await reopened.getTuple({configurable:{thread_id:'test-session'}});
  assert.equal(tuple.checkpoint.channel_values.marker,'persistent');
 }finally{await saver?.close();await reopened?.close();await fs.rm(dir,{recursive:true,force:true});}
});
