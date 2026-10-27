// Only invoked as an isolated child by DiskSaver.open; never reads application
// configuration, credentials or unrelated sessions. Keep the legacy file intact.
import fs from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {DiskSaver} from './checkpointStore.js';

const [legacyFile,destination,budgetValue]=process.argv.slice(2);
let saver;
async function readLegacy(){
 const handle=await fs.open(legacyFile,'r');
 try{
  const size=(await handle.stat()).size;
  if(size*3+256*1024*1024>Number(budgetValue))throw Error('Legacy checkpoint exceeds migration memory budget; release memory and retry');
  const bytes=Buffer.allocUnsafe(size);
  // fs.readFile rejects files above 2 GiB even where Buffer/V8 support them.
  // Bounded reads also avoid asking Windows for a single enormous read.
  for(let offset=0;offset<size;){const {bytesRead}=await handle.read(bytes,offset,Math.min(16*1024*1024,size-offset),offset);if(!bytesRead)throw Error('Legacy checkpoint was truncated during migration');offset+=bytesRead;}
  return bytes;
 }finally{await handle.close();}
}
try{
 let bytes=await readLegacy();const saved=deserialize(bytes),budget=Number(budgetValue);bytes=null;global.gc?.();
 if(!saved||typeof saved.storage!=='object'||typeof saved.writes!=='object')throw Error('Invalid legacy checkpoint structure');
 if(process.memoryUsage().rss>budget)throw Error('Legacy checkpoint exceeds migration memory budget; release memory and retry');
 saver=new DiskSaver(destination,{migration:true});saver.db.exec('BEGIN IMMEDIATE');saver.migrationTransaction=true;
 for(const thread of Object.keys(saved.storage)){
  const namespaces=saved.storage[thread];
  for(const namespace of Object.keys(namespaces))for(const id of Object.keys(namespaces[namespace])){
   const checkpoints=namespaces[namespace],record=checkpoints[id];
   const [rawCheckpoint,rawMetadata,parent]=record;
   const checkpoint=await saver.serde.loadsTyped('json',rawCheckpoint),metadata=await saver.serde.loadsTyped('json',rawMetadata);
   if(checkpoint.id!==id)throw Error('Legacy checkpoint identifier mismatch');
   await saver.put({configurable:{thread_id:thread,checkpoint_ns:namespace,...parent!==undefined?{checkpoint_id:parent}:{}}},checkpoint,metadata);
   delete checkpoints[id];
  }
  delete saved.storage[thread];global.gc?.();
 }
 for(const key of Object.keys(saved.writes)){
  const records=saved.writes[key];
  const [thread,namespace,id]=JSON.parse(key);
  for(const [writeKey,[task,channel,bytes,taskPath='']] of Object.entries(records)){
   const idx=Number(writeKey.slice(writeKey.lastIndexOf(',')+1));if(!Number.isSafeInteger(idx))throw Error('Invalid legacy write index');
   const payload=saver._savePayload('json',bytes);
   saver.db.prepare('INSERT INTO checkpoint_writes VALUES(?,?,?,?,?,?,?,?)').run(thread,namespace??'',id,task,idx,channel,payload,taskPath);
  }
  delete saved.writes[key];
 }
 saver.db.prepare('INSERT INTO checkpoint_store_meta VALUES(?,?)').run('legacy_import_completed','1');
 saver.db.exec('COMMIT');saver.migrationTransaction=false;await saver.close();
}catch(error){
 try{if(saver?.migrationTransaction)saver.db.exec('ROLLBACK');await saver?.close();}catch{}
 process.stderr.write(String(error.message));process.exitCode=1;
}
