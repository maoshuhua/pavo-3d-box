import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createProjectNavigationActions} from '../src/projectNavigationActions.js';
import {createLocalAutosave,readLocalProject} from '../src/localProject.js';

const memory=new Map();
globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};

test('leaving waits for Agent shutdown, then saves before navigating',async()=>{
 const events=[],stopped=deferred(),navigation=createProjectNavigationActions(()=>({
  onPending:value=>events.push(value),beforeLeave:async()=>{events.push('stopping');await stopped.promise;events.push('stopped');},
  save:async force=>events.push(['save',force]),navigate:url=>events.push(['navigate',url]),
 }));
 const leaving=navigation.leave('/3d-box');
 assert.equal(navigation.pending,'leave');assert.deepEqual(events,['leave','stopping']);
 stopped.resolve();assert.equal(await leaving,true);
 assert.deepEqual(events,['leave','stopping','stopped',['save',false],['navigate','/3d-box'],null]);
});

test('save failure keeps the editor open and releases the pending operation for retry',async()=>{
 let fail=true,navigated=false;
 const navigation=createProjectNavigationActions(()=>({save:async()=>{if(fail)throw Error('database unavailable');},navigate:()=>{navigated=true;}}));
 await assert.rejects(navigation.leave('/'),/database unavailable/);
 assert.equal(navigated,false);assert.equal(navigation.pending,null);
 fail=false;assert.equal(await navigation.leave('/'),true);assert.equal(navigated,true);
});

test('Agent shutdown failure keeps the editor open without saving',async()=>{
 let saved=false,navigated=false;
 const navigation=createProjectNavigationActions(()=>({beforeLeave:async()=>{throw Error('stop failed');},save:async()=>{saved=true;},navigate:()=>{navigated=true;}}));
 await assert.rejects(navigation.leave('/'),/stop failed/);
 assert.equal(saved,false);assert.equal(navigated,false);assert.equal(navigation.pending,null);
});

test('repeated clicks cannot start another save, delete or navigation',async()=>{
 const gate=deferred(),calls=[];
 const navigation=createProjectNavigationActions(()=>({save:async force=>{calls.push(force);await gate.promise;},navigate:()=>assert.fail('unexpected navigation'),deleteProject:()=>assert.fail('unexpected deletion')}));
 const saving=navigation.save();
 assert.equal(await navigation.save(),false);assert.equal(await navigation.leave('/'),false);assert.equal(await navigation.remove(),false);
 assert.deepEqual(calls,[true]);gate.resolve();assert.equal(await saving,true);assert.equal(navigation.pending,null);
});

test('deletion flushes first, navigates only on success and can retry a rejected deletion',async()=>{
 const calls=[];let fail=true;
 const navigation=createProjectNavigationActions(()=>({save:async force=>calls.push(['save',force]),deleteProject:async()=>{calls.push('delete');if(fail)throw Error('project busy');},navigate:url=>calls.push(['navigate',url])}));
 await assert.rejects(navigation.remove(),/project busy/);assert.equal(navigation.pending,null);
 assert.deepEqual(calls,[['save',false],'delete']);
 fail=false;assert.equal(await navigation.remove(),true);assert.deepEqual(calls.slice(2),[['save',false],'delete',['navigate','/']]);
});

test('leaving preserves a real GLB/JSON autosave journal on failure and commits it before navigation on retry',async()=>{
 const id=randomUUID(),view={isBusy:()=>false,flushSceneEdits(){},exportSceneJson:()=>({version:1,entities:[{id:'camera',state:{position:[1,2,3]}}],operations:[]}),exportLocalMetadata:()=>({}),createExportScene:()=>({position:[1,2,3]}),exportSceneGlb:async(_,snapshot)=>({blob:new Blob([JSON.stringify(snapshot)])})};
 let online=false,navigated=false;
 const save=createLocalAutosave(view,()=>{},{projectId:id,onSnapshot:async()=>{if(!online)throw Error('SQLite unavailable');}});
 const navigation=createProjectNavigationActions(()=>({save:()=>save.flush(),navigate:()=>{navigated=true;}}));
 try{
  save.changed();await assert.rejects(navigation.leave('/3d-box'),/SQLite unavailable/);
  assert.equal(navigated,false);assert.equal((await readLocalProject(id)).journal.json.entities[0].id,'camera');
  online=true;await navigation.leave('/3d-box');assert.equal(navigated,true);
  const local=await readLocalProject(id);assert.equal(local.journal,undefined);assert.deepEqual(local.snapshot.json.entities[0].state.position,[1,2,3]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(local.snapshot.bytes)),{position:[1,2,3]});
 }finally{save.dispose();}
});
