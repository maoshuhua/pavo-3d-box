import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {z} from 'zod';
import {summarizeToolError,reportToolError} from '../server/toolErrors.js';
import {validateScene} from '../server/sceneSchema.js';

test('large Zod errors are grouped without reading message or stack',()=>{
 const parsed=z.object({animations:z.array(z.object({tracks:z.array(z.object({values:z.array(z.number())}))}))}).safeParse({animations:[{tracks:[{values:Array.from({length:36000},()=>[1,2,3])}]}]});
 const error=parsed.error;
 Object.defineProperty(error,'message',{get(){throw Error('must not serialize message');}});
 Object.defineProperty(error,'stack',{get(){throw Error('must not serialize stack');}});
 const result=summarizeToolError(error);
 assert.equal(result.issueCount,36000);
 assert.equal(result.groups.length,1);
 assert.equal(result.groups[0].count,36000);
 assert.equal(result.groups[0].path,'animations[*].tracks[*].values[*]');
 assert.equal(result.groups[0].examples.length,3);
 assert.match(result.groups[0].hint,/扁平/);
 assert.ok(Buffer.byteLength(JSON.stringify(result))<8192);
});

test('summary respects group and UTF-8 byte limits',()=>{
 const issues=Array.from({length:30},(_,i)=>({code:'custom',path:[`字段${i}`],message:'错误'.repeat(1000)}));
 const result=summarizeToolError({issues});
 assert.ok(result.groups.length<=10);
 assert.equal(result.omittedGroups,30-result.groups.length);
 assert.ok(Buffer.byteLength(JSON.stringify(result))<8192);
});

test('full issues are saved separately and log failures preserve original error',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-errors-'));
 try{
  const issues=[{code:'custom',path:['world'],message:'missing'}];
  const error={issues,get message(){throw Error('do not read');},get stack(){throw Error('do not read');}};
  const result=await reportToolError(error,dir,'build_3D_scene');
  const saved=JSON.parse(await fs.readFile(path.join(dir,'errors',`${result.logId}.json`),'utf8'));
  assert.deepEqual(saved.issues,issues);
  assert.equal(saved.toolName,'build_3D_scene');
  const file=path.join(dir,'file');await fs.writeFile(file,'blocked');
  const failed=await reportToolError(Error('original'),file,'build_3D_scene');
  assert.equal(failed.error,'original');assert.equal(failed.logSaved,false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('geometry validation identifies offending object and parameter',()=>{
 assert.throws(()=>validateScene({version:1,objects:[{id:'wheel',geometry:{type:'cylinder',args:[1,1,2,300]}}]}),/object=wheel, geometry=cylinder, args\[3\]=300, allowed=1\.\.256/);
});
