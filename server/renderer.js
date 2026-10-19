import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {createViewport,saveAsset,readGlb} from '/src/glb.js';
import {assignEntityIds,entityId,entityKind,transformOf} from '/src/sceneEditor.js';
import {namespaceImportedAsset} from '/src/importedAsset.js';

const loader=new GLTFLoader();
let viewer, details;
const encode=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
const decode=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer;
function ensureViewer(){return viewer??=createViewport(document.getElementById('stage'),value=>details=value);}
async function parse(url){const r=await fetch(url);if(!r.ok)throw Error('GLB download failed');return loader.parseAsync(await r.arrayBuffer(),'');}
function snapshot(root,world,timeline){
 const targets=new Set();root.traverse(o=>o.target&&targets.add(o.target));
 const entities=[{id:'world',kind:'world',state:{settings:world}}];
 root.traverse(o=>{if(o===root||o.isBone||targets.has(o)||o.userData.libtvLightTarget)return;
  const material=Array.isArray(o.material)?o.material[0]:o.material;
  entities.push({id:entityId(o),kind:entityKind(o),state:{name:o.name,parentId:o.parent===root?null:entityId(o.parent),visible:o.visible,transform:transformOf(o),color:material?.color?'#'+material.color.getHexString():null,
   camera:o.isPerspectiveCamera?{fov:o.fov,near:o.near,far:o.far,aspect:o.userData.blockingStudioAspect??null,focalLength:o.getFocalLength()}:null,
   light:o.isLight?{kind:o.isDirectionalLight?'directional':o.isPointLight?'point':'spot',color:'#'+o.color.getHexString(),intensity:o.intensity,castShadow:o.castShadow,distance:o.distance??null,angle:o.angle===undefined?null:THREE.MathUtils.radToDeg(o.angle),penumbra:o.penumbra??null}:null}});
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
 const m=new THREE.MeshStandardMaterial({color:data.color||'#b7bec9',metalness:data.metallic??0,roughness:data.roughness??.65,side:THREE.DoubleSide});
 if(data.baseColor){m.color.fromArray(data.baseColor);m.opacity=data.baseColor[3];m.transparent=m.opacity<1;}
 if(data.emissive)m.emissive.set(data.emissive);
 object.material=m;
}
async function compile({spec,baseUrl,baseJson,assets}){
 const root=new THREE.Scene();let animations=[];
 if(spec.mode==='patch'&&baseUrl){const gltf=await parse(baseUrl);root.userData={...gltf.scene.userData};while(gltf.scene.children.length)root.add(gltf.scene.children[0]);animations=gltf.animations;}
 assignEntityIds(root,'agent');
 const lookup=()=>{const map=new Map();root.traverse(o=>map.set(entityId(o),o));return map;};
 let map=lookup();
 for(const id of spec.remove){const object=map.get(id);if(!object)throw Error('Entity to remove not found: '+id);const names=new Set();object.traverse(n=>names.add(n.name));object.removeFromParent();animations=animations.map(c=>new THREE.AnimationClip(c.name,c.duration,c.tracks.filter(t=>!names.has(t.name.split('.')[0])))).filter(c=>c.tracks.length);}
 map=lookup();
 for(const n of spec.objects){
  let object=map.get(n.id);
  if(!object){
   if(!n.type)throw Error('New entity requires type: '+n.id);
   if(n.type==='mesh'){if(!n.geometry)throw Error('New mesh requires geometry');object=new THREE.Mesh(meshGeometry(n.geometry),new THREE.MeshStandardMaterial());}
   else if(n.type==='camera')object=new THREE.PerspectiveCamera(50,n.camera?.aspect||16/9,.05,1000);
   else if(n.type==='light'){if(!n.light)throw Error('New light requires light properties');object=new ({directional:THREE.DirectionalLight,point:THREE.PointLight,spot:THREE.SpotLight}[n.light.type])();}
   else if(n.type==='asset'){
    const asset=assets.find(a=>a.id===n.assetId&&a.kind==='glb');if(!asset)throw Error('Uploaded GLB asset not found');
    const gltf=await parse(asset.url);object=namespaceImportedAsset(gltf,n.id,root);
    animations.push(...gltf.animations);
   }
   else object=new THREE.Group();
   object.userData.hf_id=n.id;root.add(object);object.traverse(child=>map.set(entityId(child),child));
  }else if(n.geometry){if(!object.isMesh)throw Error('Geometry target is not a mesh');object.geometry=meshGeometry(n.geometry);}
  if(n.name){const old=object.name;object.name=n.name;for(const clip of animations)for(const track of clip.tracks)if(old&&track.name.startsWith(old+'.'))track.name=n.name+track.name.slice(old.length);}
  if(!object.name)object.name=n.id;
  if(n.visible!==undefined)object.visible=n.visible;
  if(n.transform?.position)object.position.fromArray(n.transform.position);
  if(n.transform?.rotation)object.quaternion.fromArray(n.transform.rotation).normalize();
  if(n.transform?.scale)object.scale.fromArray(n.transform.scale);
  if(n.material){if(!object.isMesh)throw Error('Material target is not a mesh');applyMaterial(object,n.material);}
  if(n.camera){if(!object.isPerspectiveCamera)throw Error('Camera target is not a camera');Object.assign(object,n.camera);if(n.camera.aspect)object.userData.blockingStudioAspect=n.camera.aspect;object.updateProjectionMatrix();}
  if(n.light){if(!object.isLight)throw Error('Light target is not a light');object.color.fromArray(n.light.color);object.intensity=n.light.intensity;object.castShadow=n.light.castShadow??true;if('distance'in object)object.distance=n.light.range??0;if(object.isSpotLight){object.angle=n.light.outerConeAngle??Math.PI/3;object.penumbra=1-(n.light.innerConeAngle??0)/object.angle;}}
  if(object.isMesh)object.castShadow=object.receiveShadow=true;
 }
 for(const n of spec.objects){const object=map.get(n.id);if(n.parentId!==undefined){const parent=n.parentId===null?root:map.get(n.parentId);if(!parent)throw Error('Parent not found: '+n.parentId);for(let p=parent;p;p=p.parent)if(p===object)throw Error('Cyclic hierarchy');parent.add(object);}}
 root.updateMatrixWorld(true);
 for(const n of spec.objects)if(n.lookAt)map.get(n.id).lookAt(...n.lookAt);
 // Three's exporter binds animation names. Reject ambiguous authored names.
 const used=new Set();root.traverse(o=>{if(o===root)return;if(!o.name)o.name=entityId(o);if(used.has(o.name))o.name=`${o.name}_${entityId(o)}`;used.add(o.name);});
 for(const animation of spec.animations){
  const tracks=animation.tracks.map(t=>{const object=map.get(t.entityId);if(!object)throw Error('Animation target not found: '+t.entityId);const Class=t.property==='quaternion'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;return new Class(`${object.name}.${t.property}`,t.times,t.values);});
  const clip=new THREE.AnimationClip(animation.name,animation.duration,tracks);clip.userData={hf_id:animation.id};animations=animations.filter(c=>c.name!==animation.name);animations.push(clip);
 }
 const world=spec.world||baseJson?.entities?.find(e=>e.kind==='world')?.state.settings||{type:'solid',color:[.22,.24,.27],strength:2};
 let timeline=spec.timeline;
 if(!timeline&&spec.mode==='patch')timeline=baseJson?.entities?.find(e=>e.kind==='timeline')?.state.timeline;
 if(timeline){for(const shot of timeline.shots)if(!map.get(shot.cameraId)?.isCamera)throw Error('Timeline camera not found: '+shot.cameraId);root.userData.blockingStudioTimeline=JSON.stringify(timeline);}
 const raw=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false,animations});
 const operations=structuredClone(spec.operations);
 for(const op of operations)if(op.kind==='object.create.from_glb'){
  const response=await fetch(op.payload.assetId);if(!response.ok)throw Error('Referenced GLB asset download failed');
  const bytes=await readGlb(new File([await response.blob()],'asset.glb')),id=crypto.randomUUID();
  await saveAsset({name:'agent-asset.glb'},bytes,id);op.payload.assetId=id;
 }
 const viewport=ensureViewer();
 await viewport.replaceAgentScene({bytes:raw,json:snapshot(root,world,timeline)},operations.map((op,i)=>({...op,sequence:i+1,status:'accepted',operationId:'agent-'+i})));
 viewport.seek(0);viewport.flushSceneEdits();
 const result=await viewport.exportSceneGlb();const json=viewport.exportSceneJson();
 let triangles=0;for(const node of root.children)node.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position?.count??0)/3;});
 return {glb:await encode(result.blob),json,triangles:Math.round(triangles)};
}
async function preview({glb,json,cameraId,time}){
 const viewport=ensureViewer();await viewport.replaceAgentScene({bytes:decode(glb),json});
 const camera=json.entities.find(e=>e.kind==='camera'&&e.id===cameraId)||json.entities.find(e=>e.kind==='camera');
 if(!camera)throw Error('Preview requires a camera');
 const row=details.objects.find(o=>o.entityId===camera.id||o.id===camera.id);if(!row)throw Error('Camera not found in loaded scene');
 viewport.setCameraView(row.id);viewport.seek(time);
 const frame=await viewport.renderCurrentFrame();return {image:await encode(frame.blob),width:frame.width,height:frame.height,cameraId:camera.id,time};
}
window.sceneEngine={compile,preview};
