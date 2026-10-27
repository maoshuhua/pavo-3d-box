import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScene} from '../server/sceneSchema.js';
import {evaluateProgram} from '../server/program.js';

test('all missing parent groups are reported together before rendering',()=>{
 assert.throws(()=>validateScene({version:1,mode:'replace',objects:[
  {id:'road',type:'group',parentId:'road-markings'},
  {id:'building',type:'group',parentId:'city-blocks'},
 ]}),error=>error.issues.length===2&&error.issues.every(i=>i.path.at(-1)==='parentId'));
});
test('forward parent declarations are valid; cycles including existing parents are rejected',()=>{
 assert.doesNotThrow(()=>validateScene({version:1,mode:'replace',objects:[{id:'child',type:'group',parentId:'parent'},{id:'parent',type:'group'}]}));
 assert.throws(()=>validateScene({version:1,objects:[{id:'parent',parentId:'child'}]}, {entities:[{id:'parent',state:{parentId:null}},{id:'child',state:{parentId:'parent'}}]}),/循环/);
});
test('patch resolves existing parents and excludes removed descendants',async()=>{
 const scene={entities:[{id:'parent',state:{parentId:null}},{id:'child',state:{parentId:'parent'}}]};
 await assert.doesNotReject(()=>evaluateProgram('function build(){return {version:1,objects:[{id:"new",type:"group",parentId:"child"}]}}',{scene}));
 await assert.rejects(()=>evaluateProgram('function build(){return {version:1,remove:["parent"],objects:[{id:"new",type:"group",parentId:"child"}]}}',{scene}),/父节点不存在/);
 assert.throws(()=>validateScene({version:1,mode:'replace',objects:[{id:'new',type:'group',parentId:'parent'}]},scene),/父节点不存在/);
});
test('invalid IDs explain ASCII restriction while Chinese display names remain valid',()=>{
 assert.throws(()=>validateScene({version:1,objects:[{id:'sidewalk-左',type:'group'}]}),/ASCII/);
 assert.doesNotThrow(()=>validateScene({version:1,objects:[{id:'sidewalk-left',type:'group',name:'左侧人行道'}]}));
});
