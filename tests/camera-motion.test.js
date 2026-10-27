import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {buildCameraPaths} from '../src/cameraMotionRuntime.js';
import {cameraMotionSchema} from '../src/sceneEffectSchema.js';
import {cameraPathPresets,cameraPathPresetIds,commonCameraMotions} from '../src/cameraPathPresets.js';
import {createCameraPath,applyPathPreset,readPathSettings,updatePathSettings,pathForCamera,pathWaypoints,bakeCameraPath,readCameraRig,applyCameraRig,replaceCameraAnimation,pathDuration,makePathPreview} from '../src/libtvCameraRig.js';
import {normalizeCameraPathBindings} from '../src/cameraPathBindings.js';
import {operationSchemas} from '../src/agentSchemas.js';
import {validateScene} from '../server/sceneSchema.js';

function fixture(){
 const root=new THREE.Group(),subject=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial()),camera=new THREE.PerspectiveCamera(40,9/16,.05,10000);
 subject.name='Subject';subject.userData.hf_id='subject';subject.position.y=1;camera.userData.hf_id='cam';camera.name='Camera';camera.position.set(0,2,8);camera.lookAt(0,1,0);root.add(subject,camera);root.updateMatrixWorld(true);
 return {root,subject,camera};
}
const motion=patch=>cameraMotionSchema.parse({id:'path',cameraId:'cam',presetId:'custom',start:0,end:4,path:{points:[[0,2,8],[0,2,4]]},aim:{mode:'target',point:[0,1,0]},easing:'linear',...patch});
const paths=root=>{const result=[];root.traverse(n=>{if(n.userData.blockingStudioPathFor)result.push(n);});return result;};
function playback(root,clips){
 const mixer=new THREE.AnimationMixer(root),actions=clips.map(c=>{const a=mixer.clipAction(c);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();return a;});
 return time=>{for(const a of actions){a.paused=false;a.enabled=true;}mixer.setTime(time);root.updateMatrixWorld(true);};
}
const near=(actual,expected,tol=1e-5)=>assert(actual.distanceTo(new THREE.Vector3(...expected))<tol,`${actual.toArray()} != ${expected}`);

test('all 18 presets share editor geometry and baked poses, with a six-card common entry',()=>{
 assert.equal(cameraPathPresetIds.length,18);assert.equal(commonCameraMotions.length,6);
 for(const preset of cameraPathPresets){
  const agent=fixture(),editor=fixture();
  const spec=cameraMotionSchema.parse({id:'motion',cameraId:'cam',presetId:preset.id,origin:[0,2,8],aim:{mode:preset.id==='s-curve'?'tangent':'target',point:[0,1,0]},start:0,end:4});
  const generated=buildCameraPaths(agent.root,[spec]);
  const path=createCameraPath(editor.root,editor.camera,new THREE.Vector3(0,1,0),4);
  applyPathPreset(path,editor.camera,preset.id,new THREE.Vector3(0,1,0));updatePathSettings(path,{enabled:true,duration:4});
  assert.deepEqual(pathWaypoints(paths(agent.root)[0]).map(p=>p.position.toArray()),pathWaypoints(path).map(p=>p.position.toArray()),preset.id+' geometry');
  const expected=bakeCameraPath(THREE,editor.root,path,editor.camera);
  assert.deepEqual(Array.from(generated.clips[0].tracks[0].values),Array.from(expected.tracks[0].values),preset.id+' positions');
  assert.deepEqual(Array.from(generated.clips[0].tracks[1].values),Array.from(expected.tracks[1].values),preset.id+' orientation');
 }
});

test('custom paths preserve world coordinates under animated camera parents and delayed holds',()=>{
 const {root,camera}=fixture(),parent=new THREE.Group();parent.name='Rig';parent.position.set(2,3,4);parent.rotation.y=.4;root.add(parent);parent.attach(camera);root.updateMatrixWorld(true);
 const animation=new THREE.AnimationClip('parent',6,[new THREE.VectorKeyframeTrack('Rig.position',[0,6],[2,3,4,8,3,4]),new THREE.QuaternionKeyframeTrack('Rig.quaternion',[0,6],[0,0,0,1,0,Math.sin(.5),0,Math.cos(.5)])]);
 const result=buildCameraPaths(root,[motion({start:2,end:6})],[animation]),seek=playback(root,result.clips);
 for(const time of [0,1,2,4,6]){seek(time);near(camera.getWorldPosition(new THREE.Vector3()),[0,2,time<2?8:8-(time-2)]);}
 assert.equal(result.clips.at(-1).duration,6);
});

test('dynamic follow samples translation, subject rotation, moving aim and later animation changes',()=>{
 for(const space of ['world','subject']){
  const {root,subject,camera}=fixture();
  const anim=new THREE.AnimationClip('walk',4,[new THREE.VectorKeyframeTrack('Subject.position',[0,4],[0,1,0,4,1,0]),new THREE.QuaternionKeyframeTrack('Subject.quaternion',[0,4],[0,0,0,1,0,1,0,0])]);
  const result=buildCameraPaths(root,[motion({path:{points:[[0,2,8],[0,2,8]]},follow:{entityId:'subject',positionSpace:space},aim:{mode:'target',entityId:'subject'}})],[anim]);
  const preview=makePathPreview(paths(root)[0],root,result.clips);near(preview.at(-1),[4,2,space==='subject'?-8:8]);near(subject.position,[0,1,0]);
  const seek=playback(root,result.clips);seek(4);
  near(camera.getWorldPosition(new THREE.Vector3()),[4,2,space==='subject'?-8:8]);
  const direction=subject.getWorldPosition(new THREE.Vector3()).sub(camera.getWorldPosition(new THREE.Vector3())).normalize();assert(camera.getWorldDirection(new THREE.Vector3()).dot(direction)>.9999);
  seek(0);
  const changed=anim.clone();changed.tracks[0].values[3]=10;
  const updated=buildCameraPaths(root,[],[changed,...result.clips.filter(c=>c.name!=='walk')]);playback(root,updated.clips)(4);near(camera.getWorldPosition(new THREE.Vector3()),[10,2,space==='subject'?-8:8]);
 }
});

test('reverse tangent follows travel direction and unsupported camera parent scaling fails explicitly',()=>{
 const {root,camera}=fixture();const result=buildCameraPaths(root,[motion({speed:-1,aim:{mode:'tangent'}})]);
 playback(root,result.clips)(2);assert(camera.getWorldDirection(new THREE.Vector3()).dot(new THREE.Vector3(0,0,1))>.9999);
 const other=fixture(),parent=new THREE.Group();parent.scale.set(2,1,1);other.root.add(parent);parent.add(other.camera);other.root.updateMatrixWorld(true);
 assert.throws(()=>buildCameraPaths(other.root,[motion({})]),/等比缩放/);
});

test('multi-segment paths hold gaps, edit independently and restore all definitions as one rig',()=>{
 const {root,camera}=fixture();
 const seq=[motion({id:'first',end:2}),motion({id:'second',start:3,end:5,path:{points:[[0,2,4],[0,2,2]]}})];
 const result=buildCameraPaths(root,seq),seek=playback(root,result.clips);seek(2.5);near(camera.getWorldPosition(new THREE.Vector3()),[0,2,4]);
 assert(result.clips[0].tracks[0].times.every((t,i,a)=>i===0||t>a[i-1]));
 const second=paths(root)[1];camera.userData.selectedCameraPathId=second.userData.hf_id;
 const before=operationSchemas['camera.rig.set'].parse({rig:readCameraRig(THREE,camera,second,result.clips,null)}).rig;
 updatePathSettings(second,{easing:'out'});const edited=bakeCameraPath(THREE,root,second,camera,result.clips);
 assert.equal(paths(root).length,2);assert.equal(edited.duration,5);
 applyCameraRig(THREE,root,camera,before);assert.equal(paths(root).length,2);assert.equal(readPathSettings(pathForCamera(root,camera.name)).segmentId,'second');assert.equal(readPathSettings(pathForCamera(root,camera.name)).easing,'linear');
 const keyframes={...before,path:null,paths:[],activePathId:null};applyCameraRig(THREE,root,camera,keyframes);assert.equal(paths(root).length,0);
 applyCameraRig(THREE,root,camera,before);assert.equal(paths(root).length,2);
});

test('real GLB roundtrip preserves multiple editable paths, stable target IDs and bake results',async()=>{
 // GLTFExporter only needs FileReader's blob methods in this Node test.
 const old=globalThis.FileReader;
 globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result='data:'+blob.type+';base64,'+Buffer.from(result).toString('base64');this.onloadend?.();});}};
 try{
  const {root,camera}=fixture();camera.name='机位 带空格';
  const result=buildCameraPaths(root,[motion({id:'a',end:2,aim:{mode:'target',entityId:'subject'}}),motion({id:'b',start:2,end:4,path:{points:[[0,2,4],[0,2,2]]},aim:{mode:'target',entityId:'subject'}})]);
  const bytes=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false,animations:result.clips});
  const restored=await new GLTFLoader().parseAsync(bytes,'');normalizeCameraPathBindings(restored.scene);
  const restoredCamera=restored.scene.getObjectByProperty('isCamera',true),restoredPaths=paths(restored.scene);
  assert.equal(restoredPaths.length,2);assert.equal(readPathSettings(restoredPaths[0]).targetId,'subject');
  const rebaked=bakeCameraPath(THREE,restored.scene,restoredPaths[0],restoredCamera,restored.animations);
  const expected=result.clips[0].tracks;
  assert.deepEqual(Array.from(rebaked.tracks[0].values),Array.from(expected[0].values));
  for(let i=0;i<expected[1].values.length;i++)assert(Math.abs(rebaked.tracks[1].values[i]-expected[1].values[i])<1e-6);
 }finally{if(old===undefined)delete globalThis.FileReader;else globalThis.FileReader=old;}
});

test('path validation rejects removed protocols, conflicting controls, discontinuities and missing references',()=>{
 for(const type of ['orbit','dolly'])assert.throws(()=>cameraMotionSchema.parse({id:'old',type,cameraId:'cam',subjectIds:['subject'],start:0,end:4}));
 assert.throws(()=>cameraMotionSchema.parse({...motion({}),type:'orbit'}));
 assert.throws(()=>cameraMotionSchema.parse({id:'x',cameraId:'cam',presetId:'custom',start:0,end:4}));
 for(const kind of ['position','direction','overlap','reference','controls']){
  const {root}=fixture();
  if(kind==='controls'){assert.throws(()=>buildCameraPaths(root,[motion({})],[],['cam']),/同时/);continue;}
  const next={id:'next',start:4,end:6,path:{points:[[0,2,4],[0,2,2]]}};
  if(kind==='position')next.path.points[0]=[9,2,4];
  if(kind==='direction')next.aim={mode:'target',point:[10,1,0]};
  if(kind==='overlap')next.start=3;
  if(kind==='reference')next.follow={entityId:'missing'};
  assert.throws(()=>buildCameraPaths(root,[motion({}),motion(next)]),kind==='overlap'?/重叠/:kind==='reference'?/找不到/:/不连续/);
 }
 assert.throws(()=>validateScene({version:1,timeline:{version:1,duration:3,shots:[]},cameraMotion:[motion({})]}),/超出/);
});

test('speed, bounce, reversal and freeze keep requested end times including short segments',()=>{
 for(const speed of [.25,2,-1,0])for(const bounce of [true,false]){
  const {root,camera}=fixture();const result=buildCameraPaths(root,[motion({speed,bounce,end:.1})]);const path=paths(root)[0];assert(Math.abs(pathDuration(path)-.1)<1e-8);
  const seek=playback(root,result.clips);seek(.1);
  near(camera.getWorldPosition(new THREE.Vector3()),[0,2,speed===0?8:bounce?(speed<0?4:8):(speed<0?8:4)]);
 }
});

test('automatic framing generalizes across IDs, scale, origin and aspect; warnings expose real bounds',()=>{
 for(const scale of [.05,1,50])for(const aspect of [9/16,16/9]){
  const {root,subject,camera}=fixture();subject.userData.hf_id='arbitrary';subject.scale.setScalar(scale);subject.position.set(7*scale,3*scale,-9*scale);camera.aspect=aspect;camera.updateProjectionMatrix();root.updateMatrixWorld(true);
  const result=buildCameraPaths(root,[cameraMotionSchema.parse({id:'fit',cameraId:'cam',presetId:'orbit-360',subjectIds:['arbitrary'],start:0,end:4})]);
  const seek=playback(root,result.clips);
  for(const time of [0,1,2,3,4]){seek(time);const box=new THREE.Box3().setFromObject(subject);for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);assert(Math.abs(p.x)<1&&Math.abs(p.y)<1);}}
  assert.equal(result.diagnostics.length,0);
 }
 const {root}=fixture();const result=buildCameraPaths(root,[motion({subjectIds:['subject'],path:{points:[[0,1,.1],[0,1,.2]]},aim:{mode:'target',point:[0,1,-1]}})]);assert(result.diagnostics.some(d=>d.kind==='inside-subject-bounds'));assert(result.diagnostics.some(d=>d.kind==='subject-outside-frame'));
});

test('manual camera tracks take ownership without removing subject tracks or other camera paths',()=>{
 const {root,camera}=fixture();camera.userData.authoredCameraMotion=[{type:'removed'}];const result=buildCameraPaths(root,[motion({})]);assert(!Object.hasOwn(camera.userData,'authoredCameraMotion'));
 const manual=new THREE.AnimationClip('manual',4,[new THREE.VectorKeyframeTrack('Camera.position',[0,4],[1,2,8,1,2,4]),new THREE.VectorKeyframeTrack('Subject.position',[0,4],[0,1,0,1,1,0])]);
 const taken=buildCameraPaths(root,[],replaceCameraAnimation(result.clips,camera.name,manual),['cam']);assert.equal(paths(root).length,0);assert(taken.clips.some(c=>c.tracks.some(t=>t.name==='Subject.position')));
});
