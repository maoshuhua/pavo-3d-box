import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {lightingPresets} from '../src/lightingPresets.js';
import {lightingRigSchema} from '../src/lightingSchema.js';
import {buildLightingRigs,readLightingRig,restoreLightingRig,convertLightingToCustom,customLightingConfig,updateLightingRuntime,prepareLightingExport,restoreLightingNodes,findLightingEntity,lightProperties,createLight} from '../src/lightingRuntime.js';
import {operationSchemas} from '../src/agentSchemas.js';
import {validateScene} from '../server/sceneSchema.js';
import {namespaceImportedAsset} from '../src/importedAsset.js';
const near=(a,b)=>assert(a.distanceTo(new THREE.Vector3(...b))<1e-5,`${a.toArray()} != ${b}`);
function fixture(){const root=new THREE.Scene(),subject=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial()),camera=new THREE.PerspectiveCamera();subject.userData.hf_id='subject';subject.position.set(2,1,-3);camera.userData.hf_id='camera';camera.position.set(3,3,8);camera.lookAt(subject.position);root.add(subject,camera);root.updateMatrixWorld(true);return {root,subject,camera};}
const base=(patch={})=>({id:'rig',presetId:'balanced',subjectIds:['subject'],...patch});
test('all lighting presets generate scaled editable rigs and update stable IDs without touching other lights',()=>{
 for(const preset of lightingPresets){
  const {root}=fixture(),existing=createLight({type:'point',intensity:7});root.add(existing);
  const spec=base({presetId:preset.id,...preset.id==='practical'?{sourceIds:['camera']}:{}});
  buildLightingRigs(root,[spec]);const rig=findLightingEntity(root,'rig');
  assert(rig.children.length>=2);assert(rig.children.every(l=>l.isLight&&l.userData.hf_id.startsWith('rig:')));
  near(rig.getWorldPosition(new THREE.Vector3()),[2,1,-3]);
  const first=rig.children.map(l=>l.userData.hf_id);buildLightingRigs(root,[spec]);
  assert.deepEqual(findLightingEntity(root,'rig').children.map(l=>l.userData.hf_id),first);assert.equal(existing.intensity,7);
 }
});
test('camera and subject reference frames support explicit following and static binding',()=>{
 const {root,camera}=fixture();buildLightingRigs(root,[base({reference:{space:'camera',cameraId:'camera',follow:true}})]);
 const rig=findLightingEntity(root,'rig'),before=rig.getWorldPosition(new THREE.Vector3());camera.position.x+=4;camera.rotateY(.4);root.updateMatrixWorld(true);updateLightingRuntime(root);
 assert(rig.getWorldPosition(new THREE.Vector3()).distanceTo(before)>1);
 // The bound local center follows both translation and orientation.
 const expected=camera.localToWorld(new THREE.Vector3(...rig.userData.studioLightingBinding.center));near(rig.getWorldPosition(new THREE.Vector3()),expected.toArray());
 buildLightingRigs(root,[base({reference:{space:'camera',cameraId:'camera',follow:false}})]);const fixed=findLightingEntity(root,'rig').position.clone();camera.position.x+=2;updateLightingRuntime(root);near(findLightingEntity(root,'rig').position,fixed.toArray());
});
test('preset expansion, exact state replay and custom rebuild retain the current light pose',()=>{
 const {root}=fixture();root.position.set(4,0,2);root.rotation.y=.3;
 const [rig]=buildLightingRigs(root,[base({reference:{space:'camera',cameraId:'camera'}})]);
 const poses=rig.children.map(l=>({id:l.userData.hf_id,p:l.getWorldPosition(new THREE.Vector3()),q:l.getWorldQuaternion(new THREE.Quaternion())}));
 convertLightingToCustom(rig);const config=customLightingConfig(rig),state=readLightingRig(rig);
 operationSchemas['lighting.rig.set'].parse({rig:state});
 buildLightingRigs(root,[config]);
 for(const pose of poses){const l=findLightingEntity(root,pose.id);near(l.getWorldPosition(new THREE.Vector3()),pose.p.toArray());assert(l.getWorldQuaternion(new THREE.Quaternion()).angleTo(pose.q)<1e-5);}
 restoreLightingRig(root,state);assert.equal(findLightingEntity(root,'rig').userData.studioLighting.presetId,'custom');
});
test('custom lights preserve all six types, dynamic targets and independently sampled animation',()=>{
 const {root,subject}=fixture();
 const lights=['directional','point','spot','area','hemisphere','ambient'].map((type,i)=>({id:type,properties:{type,intensity:i+1,groundColor:'#123456',width:3,height:2},position:[i,4,5],...['directional','spot','area'].includes(type)?{target:{entityId:'subject',follow:true}}:{}}));
 lights[1].keyframes=[{time:0,intensity:1,position:[0,0,0],color:'#ff0000'},{time:2,intensity:5,position:[2,4,6],color:'#0000ff'}];
 buildLightingRigs(root,[base({presetId:'custom',lights})]);updateLightingRuntime(root,1);
 const point=findLightingEntity(root,'rig:point');assert.equal(point.intensity,3);near(point.position,[1,2,3]);assert(Math.abs(point.color.r-.5)<1e-6);
 subject.position.x+=3;root.updateMatrixWorld(true);updateLightingRuntime(root,2);
 const key=findLightingEntity(root,'rig:directional'),dir=key.target.getWorldPosition(new THREE.Vector3()).sub(key.getWorldPosition(new THREE.Vector3())).normalize(),expected=subject.getWorldPosition(new THREE.Vector3()).sub(key.getWorldPosition(new THREE.Vector3())).normalize();near(dir,expected.toArray());
 updateLightingRuntime(root,0);assert.equal(point.intensity,1);near(point.position,[0,0,0]);
});
test('invalid presets, duplicate IDs, locked rigs and missing targets fail before altering scene',()=>{
 const {root}=fixture();buildLightingRigs(root,[base()]);const old=findLightingEntity(root,'rig');
 for(const input of [[base(),base()],[base({reference:{space:'camera',cameraId:'missing'}})],[base({presetId:'practical'})],[base({presetId:'custom',lights:[{id:'l',properties:{type:'area',castShadow:true}}]})],[base({presetId:'custom',lights:[{id:'l',target:{entityId:'missing'},properties:{type:'point'}}]})]])assert.throws(()=>buildLightingRigs(root,input));
 assert.equal(findLightingEntity(root,'rig'),old);old.userData.studioLighting.locked=true;assert.throws(()=>buildLightingRigs(root,[base()]),/锁定/);
 assert.throws(()=>lightingRigSchema.parse(base({presetId:'custom',lights:[]})));
 assert.throws(()=>validateScene({version:1,timeline:{version:1,duration:1,shots:[]},lighting:[base({presetId:'custom',lights:[{id:'l',properties:{type:'point'},keyframes:[{time:2,intensity:1}]}]})]}),/时间轴/);
});
test('imported lighting remaps group, child, target and follow IDs into the imported instance',()=>{
 const {root}=fixture();buildLightingRigs(root,[base({reference:{space:'camera',cameraId:'camera',follow:true}})]);
 const gltf={scene:root,animations:[]};namespaceImportedAsset(gltf,'imported',new THREE.Scene());
 let rig,subject,camera;root.traverse(n=>{if(n.userData.studioLighting)rig=n;if(n.isMesh)subject=n;if(n.isCamera)camera=n;});
 const config=rig.userData.studioLighting;assert.equal(config.id,rig.userData.hf_id);assert.deepEqual(config.subjectIds,[subject.userData.hf_id]);assert.equal(config.reference.cameraId,camera.userData.hf_id);assert.equal(rig.userData.studioLightingBinding.entityId,camera.userData.hf_id);
 for(const l of rig.children){assert.equal(l.userData.studioRigId,config.id);assert.equal(l.userData.hf_id,config.id+':'+l.userData.studioLightId);}
});
test('real GLB roundtrip restores unsupported light types, shadows, target direction and editable rig metadata',async()=>{
 const old=globalThis.FileReader;globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}};
 try{
  const {root}=fixture();const lights=['directional','point','spot','area','hemisphere','ambient'].map((type,i)=>({id:type,properties:{type,color:'#ffc088',intensity:i+1,groundColor:'#123456',...['directional','point','spot'].includes(type)?{castShadow:true,shadow:{mapSize:1024,bias:-.001}}:{},width:3,height:2},position:[i,4,5],...['directional','spot','area'].includes(type)?{target:{point:[0,0,0],follow:true}}:{}}));
  buildLightingRigs(root,[base({presetId:'custom',lights})]);const before=readLightingRig(findLightingEntity(root,'rig'));prepareLightingExport(root);
  const bytes=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false});const gltf=await new GLTFLoader().parseAsync(bytes,'');restoreLightingNodes(gltf.scene);
  const rig=findLightingEntity(gltf.scene,'rig'),after=readLightingRig(rig);assert.equal(after.lights.length,6);
  assert.deepEqual(after.config,before.config);
  for(let i=0;i<6;i++){assert.deepEqual(after.lights[i].properties,before.lights[i].properties);assert.equal(after.lights[i].id,before.lights[i].id);}
  const directional=findLightingEntity(gltf.scene,'rig:directional');assert(directional.target.parent===directional);updateLightingRuntime(gltf.scene,1);
  operationSchemas['lighting.rig.set'].parse({rig:after});restoreLightingRig(gltf.scene,after);assert.equal(findLightingEntity(gltf.scene,'rig').children.length,6);
 }finally{if(old===undefined)delete globalThis.FileReader;else globalThis.FileReader=old;}
});
