import '../server/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {projectDir,sourcePath} from '../server/storage.js';
const output=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('请指定验证输出目录');
const run=JSON.parse(await fs.readFile(path.join(output,'run.json'),'utf8'));
await fs.copyFile(sourcePath(projectDir(run.projectId),'/scene.js'),path.join(output,'generated-scene.js'));
const events=(await fs.readFile(path.join(output,'events.sse'),'utf8')).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
const latest=run.results.at(-1);const frames=[];
for(const frame of events.filter(e=>e.type==='PREVIEW'&&e.task_id===latest.task_id)){
 const file='frame-'+String(frame.time).replace('.','_')+'.png',response=await fetch(frame.image_url);if(!response.ok)throw Error('无法读取检查帧');
 await fs.writeFile(path.join(output,file),Buffer.from(await response.arrayBuffer()));frames.push({file,time:frame.time});
}
const bytes=await fs.readFile(path.join(output,'generated.glb'));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const materials=[],cameras=[],lights=[];
gltf.scene.traverse(n=>{
 if(n.material){for(const m of Array.isArray(n.material)?n.material:[n.material])materials.push({entityId:n.userData.hf_id,physical:!!m.isMeshPhysicalMaterial,transmission:m.transmission||0,metallic:m.metalness});}
 if(n.isCamera){const paths=[];gltf.scene.traverse(p=>{if(p.userData.blockingStudioPathFor===n.name)paths.push({id:p.userData.hf_id,settings:p.userData.blockingStudioPath,waypoints:p.children.filter(c=>c.userData.blockingStudioWaypoint).map(c=>c.position.toArray())});});cameras.push({entityId:n.userData.hf_id,paths});}
 if(n.isLight)lights.push({entityId:n.userData.hf_id,preset:n.userData.productLighting||null});
});
const review={model:run.model,status:run.status,unmodifiedModelOutput:true,frames,materials,cameras,lights,seconds:(Date.parse(run.finishedAt)-Date.parse(run.startedAt))/1000};
await fs.writeFile(path.join(output,'inspection.json'),JSON.stringify(review,null,2));console.log(JSON.stringify(review));
