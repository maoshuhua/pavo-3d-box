import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createLocalAutosave,readLocalProject} from '../src/localProject.js';

const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
function viewport(){let value=0;return {set:v=>value=v,isBusy:()=>false,flushSceneEdits(){},exportSceneJson:()=>({version:1,entities:[{id:'mesh',state:{value}}],operations:[]}),exportLocalMetadata:()=>({}),createExportScene:()=>({value}),exportSceneGlb:async(_,snapshot)=>({blob:new Blob([JSON.stringify(snapshot)])})};}

test('failed SQLite commit keeps crash journal and retries without losing the edit',async()=>{
 const id=crypto.randomUUID(),view=viewport();let online=false;
 const save=createLocalAutosave(view,()=>{},{projectId:id,onSnapshot:async()=>{if(!online)throw Error('database unavailable');}});
 try{view.set(7);save.changed();await assert.rejects(save.flush,/database unavailable/);let local=await readLocalProject(id);assert.equal(local.snapshot,undefined);assert.equal(local.journal.json.entities[0].state.value,7);online=true;await save.flush();local=await readLocalProject(id);assert.equal(local.snapshot.json.entities[0].state.value,7);assert.equal(local.journal,undefined);}finally{save.dispose();}
});

test('new edit during SQLite save retains its newer journal and project namespaces stay isolated',async()=>{
 const id=crypto.randomUUID(),other=crypto.randomUUID(),view=viewport();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),commits=[];
 const save=createLocalAutosave(view,()=>{},{projectId:id,onSnapshot:async s=>{commits.push(s);if(commits.length===1){entered();await gate;}}});
 try{view.set(1);save.changed();const pending=save.flush();await started;view.set(2);save.changed();release();await pending;let local=await readLocalProject(id);assert.equal(local.snapshot.json.entities[0].state.value,1);assert.equal(local.journal.json.entities[0].state.value,2);assert.equal((await readLocalProject(other)).snapshot,undefined);await save.flush();local=await readLocalProject(id);assert.equal(local.snapshot.json.entities[0].state.value,2);assert.equal(local.journal,undefined);assert.deepEqual(commits.map(c=>c.revision),[1,2]);}finally{save.dispose();}
});

test('failed generated replacement preserves the last committed snapshot',async()=>{
 const id=crypto.randomUUID(),view=viewport();let fail=false;const save=createLocalAutosave(view,()=>{},{projectId:id,onSnapshot:async()=>{if(fail)throw Error('write failed');}});
 try{view.set(1);save.changed();await save.flush();fail=true;await assert.rejects(()=>save.replaceSnapshot({bytes:new ArrayBuffer(8),json:{entities:[]}}),/write failed/);assert.equal((await readLocalProject(id)).snapshot.json.entities[0].state.value,1);}finally{save.dispose();}
});

test('adopting a server-committed Agent result does not write a conflicting second snapshot',async()=>{
 const id=crypto.randomUUID(),view=viewport(),commits=[],save=createLocalAutosave(view,()=>{},{projectId:id,onSnapshot:async snapshot=>commits.push(snapshot.revision)});
 try{save.initialize(1);await save.adoptSnapshot({revision:4,bytes:new ArrayBuffer(8),json:{version:1,entities:[],operations:[]}});assert.deepEqual(commits,[]);assert.equal((await readLocalProject(id)).snapshot.revision,4);assert.equal((await readLocalProject(id)).journal,undefined);view.set(2);save.changed();await save.flush();assert.deepEqual(commits,[5]);}
 finally{save.dispose();}
});
