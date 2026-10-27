import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createViewport,saveAsset,readGlb} from '/src/glb.js';
import {assignEntityIds,entityId,entityKind,transformOf} from '/src/sceneEditor.js';
import {namespaceImportedAsset} from '/src/importedAsset.js';
import {patchMaterial,materialState,applyProductLighting} from '/src/sceneEffects.js';
import {buildLightingRigs,readLightingRig,lightProperties,createLight,setLightProperties,normalizeLightProperties,prepareLightingExport,restoreLightingNodes} from '/src/lightingRuntime.js';
import {buildCameraPaths} from '/src/cameraMotionRuntime.js';
import {replaceCameraAnimation} from '/src/libtvCameraRig.js';
import {normalizeCameraPathBindings} from '/src/cameraPathBindings.js';

const loader=new GLTFLoader();
let viewer, details;
const encode=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
const decode=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer;
function ensureViewer(){return viewer??=createViewport(document.getElementById('stage'),value=>details=value);}
async function parse(url){const r=await fetch(url);if(!r.ok)throw Error('GLB download failed');const gltf=await loader.parseAsync(await r.arrayBuffer(),'');restoreLightingNodes(gltf.scene);return gltf;}
function snapshot(root,world,timeline){
 const targets=new Set();root.traverse(o=>o.target&&targets.add(o.target));
 const entities=[{id:'world',kind:'world',state:{settings:world}}];
 root.traverse(o=>{if(o===root||o.isBone||targets.has(o)||o.userData.libtvLightTarget)return;
  const material=Array.isArray(o.material)?o.material[0]:o.material;
  entities.push({id:entityId(o),kind:entityKind(o),state:{name:o.name,parentId:o.parent===root?null:entityId(o.parent),visible:o.visible,transform:transformOf(o),color:material?.color?'#'+material.color.getHexString():null,
    material:materialState(o.material),camera:o.isPerspectiveCamera?{fov:o.fov,near:o.near,far:o.far,aspect:o.userData.blockingStudioAspect??null,focalLength:o.getFocalLength()}:null,
   lightingRig:o.userData.studioLighting?readLightingRig(o):null,light:o.isLight?{...lightProperties(o),kind:lightProperties(o).type,distance:o.distance??null,angle:o.angle===undefined?null:THREE.MathUtils.radToDeg(o.angle),penumbra:o.penumbra??null}:null}});
 });
 if(timeline)entities.push({id:'timeline',kind:'timeline',state:{timeline}});
 return {version:1,savedAtMs:Date.now(),entities,operations:[]};
}
function meshGeometry(g){
 const constructors={box:THREE.BoxGeometry,plane:THREE.PlaneGeometry,sphere:THREE.SphereGeometry,cylinder:THREE.CylinderGeometry,cone:THREE.ConeGeometry,torus:THREE.TorusGeometry,capsule:THREE.CapsuleGeometry};
 if(g.type!=='buffer')return new constructors[g.type](...(g.args||[]));
 if(!g.positions?.length||g.positions.length%3)throw Error('buffer positions must contain XYZ triples');
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(g.positions,3));
 if(g.indices){if(g.indices.some(i=>i>=g.positions.length/3))throw Error('Mesh index outside vertices');geometry.setIndex(g.indices);}
 geometry.computeVertexNormals();return geometry;
}
function applyMaterial(object,data){
 patchMaterial(object,data);
}
async function compile({spec,baseUrl,baseJson,assets}){
 const root=new THREE.Scene();let animations=[];
 if(spec.mode==='patch'&&baseUrl){const gltf=await parse(baseUrl);root.userData={...gltf.scene.userData};while(gltf.scene.children.length)root.add(gltf.scene.children[0]);animations=gltf.animations;}
 assignEntityIds(root,'agent');
 const lookup=()=>{const map=new Map();root.traverse(o=>map.set(entityId(o),o));return map;};
 let map=lookup();
 for(const id of spec.remove){const object=map.get(id);if(!object)throw Error('Entity to remove not found: '+id);const names=new Set();object.traverse(n=>names.add(n.name));object.removeFromParent();const owned=[];root.traverse(p=>{if(names.has(p.userData.blockingStudioPathFor))owned.push(p);});owned.forEach(p=>p.removeFromParent());animations=animations.map(c=>new THREE.AnimationClip(c.name,c.duration,c.tracks.filter(t=>!names.has(t.name.split('.')[0])))).filter(c=>c.tracks.length);}
 map=lookup();
 for(const n of spec.objects){
  let object=map.get(n.id);
  if(!object){
   if(!n.type)throw Error('New entity requires type: '+n.id);
   if(n.type==='mesh'){if(!n.geometry)throw Error('New mesh requires geometry');object=new THREE.Mesh(meshGeometry(n.geometry),new THREE.MeshStandardMaterial({color:'#b7bec9',roughness:.65,side:THREE.DoubleSide}));}
   else if(n.type==='camera')object=new THREE.PerspectiveCamera(50,n.camera?.aspect||16/9,.05,1000);
   else if(n.type==='light'){if(!n.light)throw Error('New light requires light properties');object=createLight(normalizeLightProperties(n.light));}
   else if(n.type==='asset'){
    const asset=assets.find(a=>a.id===n.assetId&&a.kind==='glb');if(!asset)throw Error('Uploaded GLB asset not found');
    const gltf=await parse(asset.url);object=namespaceImportedAsset(gltf,n.id,root);
    animations.push(...gltf.animations);
   }
   else object=new THREE.Group();
   object.userData.hf_id=n.id;root.add(object);object.traverse(child=>map.set(entityId(child),child));
  }else if(n.geometry){if(!object.isMesh)throw Error('Geometry target is not a mesh');object.geometry=meshGeometry(n.geometry);}
  if(n.name){const old=object.name;object.name=n.name;root.traverse(p=>{if(p.userData.blockingStudioPathFor===old)p.userData.blockingStudioPathFor=n.name;if(p.userData.blockingStudioPath?.targetName===old)p.userData.blockingStudioPath.targetName=n.name;});for(const clip of animations)for(const track of clip.tracks)if(old&&track.name.startsWith(old+'.'))track.name=n.name+track.name.slice(old.length);}
  if(!object.name)object.name=n.id;
  if(n.visible!==undefined)object.visible=n.visible;
  if(n.transform?.position)object.position.fromArray(n.transform.position);
  if(n.transform?.rotation)object.quaternion.fromArray(n.transform.rotation).normalize();
  if(n.transform?.scale)object.scale.fromArray(n.transform.scale);
  if(n.material){if(!object.isMesh)throw Error('Material target is not a mesh');applyMaterial(object,n.material);}
  if(n.camera){if(!object.isPerspectiveCamera)throw Error('Camera target is not a camera');Object.assign(object,n.camera);if(n.camera.aspect)object.userData.blockingStudioAspect=n.camera.aspect;object.updateProjectionMatrix();}
  if(n.light){if(!object.isLight)throw Error('Light target is not a light');setLightProperties(object,normalizeLightProperties(n.light));}
  if(object.isMesh)object.castShadow=object.receiveShadow=true;
 }
 for(const n of spec.objects){const object=map.get(n.id);if(n.parentId!==undefined){const parent=n.parentId===null?root:map.get(n.parentId);if(!parent)throw Error('Parent not found: '+n.parentId);for(let p=parent;p;p=p.parent)if(p===object)throw Error('Cyclic hierarchy');parent.add(object);}}
 root.updateMatrixWorld(true);
 for(const n of spec.objects)if(n.lookAt)map.get(n.id).lookAt(...n.lookAt);
 // Three's exporter binds animation names. Reject ambiguous authored names.
 const used=new Set();root.traverse(o=>{if(o===root)return;if(!o.name)o.name=entityId(o);if(used.has(o.name))o.name=`${o.name}_${entityId(o)}`;used.add(o.name);});
 normalizeCameraPathBindings(root);
 // Remove the previous camera controller before installing explicitly authored keyframes.
 const explicitCameraTracks=spec.animations.flatMap(a=>a.tracks.filter(t=>['position','quaternion'].includes(t.property)).map(t=>t.entityId));
 for(const id of new Set(explicitCameraTracks)){const camera=map.get(id);if(camera?.isCamera)animations=replaceCameraAnimation(animations,camera.name,null);}
 for(const animation of spec.animations){
  const tracks=animation.tracks.map(t=>{const object=map.get(t.entityId);if(!object)throw Error('Animation target not found: '+t.entityId);const Class=t.property==='quaternion'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;return new Class(`${object.name}.${t.property}`,t.times,t.values);});
  const clip=new THREE.AnimationClip(animation.name,animation.duration,tracks);clip.userData={hf_id:animation.id};animations=animations.filter(c=>c.name!==animation.name);animations.push(clip);
 }
 if(Array.isArray(spec.lighting))buildLightingRigs(root,spec.lighting);
 else if(spec.lighting)applyProductLighting(root,spec.lighting);
 const motionResult=buildCameraPaths(root,spec.cameraMotion||[],animations,explicitCameraTracks);
 animations=motionResult.clips;
 const world=structuredClone(spec.world||baseJson?.entities?.find(e=>e.kind==='world')?.state.settings||{type:'solid',color:[.22,.24,.27],strength:2});
 if(spec.lighting&&!Array.isArray(spec.lighting)&&!world.environment)world.environment={preset:'studio',strength:.8};
 if(spec.lighting){world.exposure??=1;world.toneMapping??='aces';}
 let timeline=spec.timeline;
 if(!timeline&&spec.mode==='patch')timeline=baseJson?.entities?.find(e=>e.kind==='timeline')?.state.timeline;
 if(timeline&&(spec.cameraMotion||[]).some(m=>m.end>timeline.duration))throw Error('相机运动超出已有时间轴');
 if(timeline&&Array.isArray(spec.lighting)&&spec.lighting.some(r=>(r.lights||[]).some(l=>l.keyframes?.at(-1)?.time>timeline.duration)))throw Error('灯光关键帧超出已有时间轴');
 if(timeline){for(const shot of timeline.shots)if(!map.get(shot.cameraId)?.isCamera)throw Error('Timeline camera not found: '+shot.cameraId);root.userData.blockingStudioTimeline=JSON.stringify(timeline);}
 const compiledJson=snapshot(root,world,timeline);
 prepareLightingExport(root);
 const raw=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false,animations});
 const operations=structuredClone(spec.operations);
 for(const op of operations)if(op.kind==='object.create.from_glb'){
  const response=await fetch(op.payload.assetId);if(!response.ok)throw Error('Referenced GLB asset download failed');
  const bytes=await readGlb(new File([await response.blob()],'asset.glb')),id=crypto.randomUUID();
  await saveAsset({name:'agent-asset.glb'},bytes,id);op.payload.assetId=id;
 }
 const viewport=ensureViewer();
 await viewport.replaceAgentScene({bytes:raw,json:compiledJson},operations.map((op,i)=>({...op,sequence:i+1,status:'accepted',operationId:'agent-'+i})));
 viewport.seek(0);viewport.flushSceneEdits();
 const result=await viewport.exportSceneGlb();const json=viewport.exportSceneJson();
 let triangles=0;for(const node of root.children)node.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position?.count??0)/3;});
 return {glb:await encode(result.blob),json,triangles:Math.round(triangles),diagnostics:motionResult.diagnostics};
}
async function previewBatch({glb,json,frames,streamFrames=false}){
 if(!Array.isArray(frames)||!frames.length||frames.length>12)throw Error('Preview requires 1–12 frames');
 const cameras=(json.entities||[]).filter(e=>e.kind==='camera'&&!e.deleted),duration=json.entities.find(e=>e.kind==='timeline')?.state.timeline.duration;
 const plan=frames.map(({cameraId,time=0})=>{
  const camera=cameraId===undefined?cameras[0]:cameras.find(c=>c.id===cameraId);
  if(!camera)throw Error('Preview camera not found: '+cameraId);
  if(!Number.isFinite(time)||time<0||time>600||duration!==undefined&&time>duration)throw Error('Preview time outside timeline');
  return {camera,time};
 });
 const viewport=ensureViewer(),start=performance.now();
 await viewport.replaceAgentScene({bytes:decode(glb),json});
 const restoreMs=performance.now()-start,output=[];let renderMs=0,encodeMs=0;
 for(const {camera,time} of plan){
  const row=details.objects.find(o=>o.entityId===camera.id||o.id===camera.id);if(!row)throw Error('Camera not found in loaded scene');
  const at=performance.now();viewport.setCameraView(row.id);viewport.seek(time);
  const frame=await viewport.renderCurrentFrame();renderMs+=performance.now()-at;
  const encoding=performance.now(),image=await encode(frame.blob);encodeMs+=performance.now()-encoding;
  const result={image,width:frame.width,height:frame.height,cameraId:camera.id,time};
  if(streamFrames)await window.__reportPreviewFrame(result);
  output.push(result);
 }
 return {frames:output,timings:{restore:restoreMs,frames:renderMs,encode:encodeMs},sceneLoads:1};
}
async function preview({glb,json,cameraId,time=0}){return (await previewBatch({glb,json,frames:[{cameraId,time}]})).frames[0];}
window.sceneEngine={compile,preview,previewBatch};
