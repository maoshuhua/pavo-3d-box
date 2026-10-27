import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createLocalAutosave,readLocalProject} from '../src/localProject.js';
import {commitAgentScene,stageAgentSnapshot} from '../src/agentSceneCommit.js';

const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
const scene=value=>({version:1,entities:[{id:'subject',kind:'object',state:{value}}],operations:[]});
const snapshot=(value,revision)=>({json:scene(value),bytes:new TextEncoder().encode(JSON.stringify({value})).buffer,...revision?{revision}:{}});
function viewport(value=1){
  return {value,fail:undefined,applied:[],isBusy:()=>false,flushSceneEdits(){},exportSceneJson(){return scene(this.value);},exportLocalMetadata:()=>({}),createExportScene(){return {value:this.value};},
    async exportSceneGlb(_,source){return {blob:new Blob([JSON.stringify(source||{value:this.value})])};},
    async replaceAgentScene(next){const value=next.json?.entities[0].state.value??JSON.parse(new TextDecoder().decode(next.bytes)).value;this.applied.push(value);this.value=value;if(this.fail?.(value)){this.value=null;throw Error('injected viewport restore failure');}}
  };
}
const staged=(next,signal,options={})=>stageAgentSnapshot(next,[],()=>({viewport:viewport(),dispose(){options.onDispose?.();}}),signal);
async function fixture(run){
  const id=crypto.randomUUID(),editor=viewport(),commits=[],autosave=createLocalAutosave(editor,()=>{},{projectId:id,onSnapshot:async next=>commits.push(next)});
  try{
    autosave.changed({kind:'initial'});await autosave.flush();
    editor.value=2;autosave.changed({kind:'pending-edit'});
    const release=await autosave.pause();release();
    const before=await readLocalProject(id);
    await run({id,editor,autosave,commits,before,signal:new AbortController().signal});
  }finally{autosave.dispose();}
}

test('valid server snapshot failing in the live viewport restores the old scene and preserves its journal',async()=>fixture(async({id,editor,autosave,commits,before,signal})=>{
  editor.fail=value=>value===3;
  await assert.rejects(()=>commitAgentScene({editor,autosave,signal,serverCommitted:true,prepare:()=>staged(snapshot(3,4),signal)}),error=>error.agentApplyBlocked&&/injected viewport/.test(error.cause.message));
  assert.equal(editor.value,2);
  assert.deepEqual(editor.applied,[3,2]);
  assert.deepEqual(await readLocalProject(id),before);
  assert.equal(commits.length,1,'must not roll the old scene back into the server');
  await assert.rejects(autosave.flush,/重新打开项目/);
}));

test('local adoption failure rolls back the live viewport without deleting the old journal',async()=>fixture(async({id,editor,autosave,before,signal})=>{
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...args){if(this.name==='snapshots'&&value.id===id)throw new DOMException('injected IndexedDB quota failure','QuotaExceededError');return put.call(this,value,...args);};
  try{
    await assert.rejects(()=>commitAgentScene({editor,autosave,signal,serverCommitted:true,prepare:()=>staged(snapshot(3,4),signal)}),error=>error.agentApplyBlocked&&error.cause.name==='QuotaExceededError');
    assert.equal(editor.value,2);
    assert.deepEqual(await readLocalProject(id),before);
  }finally{IDBObjectStore.prototype.put=put;}
}));

test('staging failure never touches the main viewport or local records',async()=>fixture(async({id,editor,autosave,before,signal})=>{
  let disposed=false;
  await assert.rejects(()=>commitAgentScene({editor,autosave,signal,serverCommitted:true,prepare:()=>stageAgentSnapshot(snapshot(3,4),[],()=>({viewport:{replaceAgentScene:async()=>{throw Error('invalid scene');}},dispose(){disposed=true;}}),signal)}),/已保留原场景/);
  assert.equal(disposed,true);
  assert.deepEqual(editor.applied,[]);
  assert.equal(editor.value,2);
  assert.deepEqual(await readLocalProject(id),before);
}));

test('legacy apply failure keeps normal autosave working when the server has not been changed',async()=>fixture(async({id,editor,autosave,commits,before,signal})=>{
  editor.fail=value=>value===3;
  await assert.rejects(()=>commitAgentScene({editor,autosave,signal,prepare:()=>staged(snapshot(3),signal)}),/injected viewport/);
  assert.equal(editor.value,2);
  assert.deepEqual(await readLocalProject(id),before);
  await autosave.flush();
  assert.equal(commits.at(-1).json.entities[0].state.value,2);
}));

test('successive results use the latest applied scene for rollback, including a resumed run',async()=>fixture(async({id,editor,autosave,commits,signal})=>{
  await commitAgentScene({editor,autosave,signal,serverCommitted:true,prepare:()=>staged(snapshot(3,4),signal)});
  assert.equal(editor.value,3);
  const accepted=await readLocalProject(id);
  assert.equal(accepted.snapshot.revision,4);
  assert.equal(accepted.journal,undefined);
  editor.fail=value=>value===4;
  await assert.rejects(()=>commitAgentScene({editor,autosave,signal,serverCommitted:true,prepare:()=>staged(snapshot(4,5),signal)}),/已保留原场景/);
  assert.equal(editor.value,3);
  assert.deepEqual(editor.applied,[3,4,3]);
  assert.deepEqual(await readLocalProject(id),accepted);
  assert.equal(commits.length,1);
}));

test('cancellation after applying a valid snapshot restores the scene before local adoption',async()=>fixture(async({id,editor,autosave,before})=>{
  const controller=new AbortController(),replace=editor.replaceAgentScene.bind(editor);
  editor.replaceAgentScene=async next=>{await replace(next);if(editor.value===3)controller.abort(new DOMException('Cancelled','AbortError'));};
  await assert.rejects(()=>commitAgentScene({editor,autosave,signal:controller.signal,serverCommitted:true,prepare:()=>staged(snapshot(3,4),controller.signal)}),error=>error.agentApplyBlocked&&error.cause.name==='AbortError');
  assert.equal(editor.value,2);
  assert.deepEqual(await readLocalProject(id),before);
}));

test('server persistence failure after legacy apply restores the scene and blocks stale writes',async()=>fixture(async({id,editor,autosave,before,signal})=>{
  autosave.replaceSnapshot=async()=>{throw Error('server commit response lost');};
  await assert.rejects(()=>commitAgentScene({editor,autosave,signal,prepare:()=>staged(snapshot(3),signal)}),error=>error.agentApplyBlocked&&/response lost/.test(error.cause.message));
  assert.equal(editor.value,2);
  assert.deepEqual(await readLocalProject(id),before);
  await assert.rejects(autosave.flush,/重新打开项目/);
}));

test('legacy success persists only the validated replacement and resumes subsequent autosave',async()=>fixture(async({id,editor,autosave,commits,signal})=>{
  await commitAgentScene({editor,autosave,signal,prepare:()=>staged(snapshot(3),signal)});
  const saved=await readLocalProject(id);
  assert.equal(saved.snapshot.json.entities[0].state.value,3);
  assert.equal(saved.journal,undefined);
  assert.equal(commits.at(-1).revision,3);
  editor.value=4;autosave.changed({kind:'next-edit'});await autosave.flush();
  assert.equal(commits.at(-1).revision,4);
  assert.equal(commits.at(-1).json.entities[0].state.value,4);
}));

test('optional localStorage mirror removal does not turn an accepted server snapshot into failure',async()=>fixture(async({id,editor,autosave,signal})=>{
  const remove=localStorage.removeItem;localStorage.removeItem=()=>{throw Error('storage unavailable');};
  try{await commitAgentScene({editor,autosave,signal,serverCommitted:true,prepare:()=>staged(snapshot(3,4),signal)});assert.equal((await readLocalProject(id)).snapshot.revision,4);assert.equal(editor.value,3);}
  finally{localStorage.removeItem=remove;}
}));
