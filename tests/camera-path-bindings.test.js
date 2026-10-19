import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {normalizeCameraPathBindings} from '../src/cameraPathBindings.js';
import {ensureCameraPaths,pathForCamera} from '../src/libtvCameraRig.js';

test('GLB-sanitized camera names reconnect existing rigs without generating duplicates',()=>{
 const root=new THREE.Group(),camera=new THREE.PerspectiveCamera();camera.name='机位1_低机位跟拍';camera.userData.name='机位1 低机位跟拍';root.add(camera);
 const path=new THREE.Group();path.name='Path_机位1_低机位跟拍';path.userData={hf_id:'persistent-path',blockingStudioPathFor:'机位1 低机位跟拍',blockingStudioPath:{targetName:'Aim_机位1 低机位跟拍'}};
 const aim=new THREE.Object3D();aim.name='Aim_机位1_低机位跟拍';aim.userData={blockingStudioPathAim:true,name:'Aim_机位1 低机位跟拍'};path.add(aim);
 const focus=new THREE.Object3D();focus.name='Focus_机位1_低机位跟拍';focus.userData={blockingStudioPathFocus:true,name:'Focus_机位1 低机位跟拍'};aim.add(focus);camera.userData.blockingStudioDofFocus='Focus_机位1 低机位跟拍';root.add(path);
 root.add(path.clone());
 assert.equal(normalizeCameraPathBindings(root),true);ensureCameraPaths(root,[]);
 assert.equal(root.children.filter(n=>n.userData.blockingStudioPathFor).length,1);
 assert.equal(pathForCamera(root,camera.name),path);assert.equal(path.userData.blockingStudioPath.targetName,aim.name);assert.equal(camera.userData.blockingStudioDofFocus,focus.name);
 assert.equal(normalizeCameraPathBindings(root),false);
 camera.name='机位1 低机位跟拍';normalizeCameraPathBindings(root);assert.equal(pathForCamera(root,camera.name),path);
});

test('ambiguous camera aliases and independently authored paths are preserved',()=>{
 const root=new THREE.Group();for(const name of ['A B','A_B']){const c=new THREE.PerspectiveCamera();c.name=name;root.add(c);}
 const path=new THREE.Group();path.userData={blockingStudioPathFor:'A.B',hf_id:'p'};root.add(path);assert.equal(normalizeCameraPathBindings(root),false);
 path.userData.blockingStudioPathFor='A_B';const second=path.clone();second.userData.hf_id='different';root.add(second);normalizeCameraPathBindings(root);assert.equal(root.children.filter(n=>n.userData.blockingStudioPathFor).length,2);
});

test('actual GLTFLoader name sanitization retains a single camera trajectory',async()=>{
 const document={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],cameras:[{type:'perspective',perspective:{yfov:1,znear:.1}}],nodes:[{name:'跟拍 机位',camera:0,extras:{hf_id:'camera'}},{name:'Path_跟拍 机位',extras:{hf_id:'path',blockingStudioPathFor:'跟拍 机位'}}]};
 const loaded=await new GLTFLoader().parseAsync(JSON.stringify(document),'');
 const camera=loaded.scene.children.find(node=>node.isCamera);
 assert.equal(camera.name,'跟拍_机位');normalizeCameraPathBindings(loaded.scene);ensureCameraPaths(loaded.scene,[]);
 assert.equal(loaded.scene.children.filter(node=>node.userData.blockingStudioPathFor).length,1);
 assert.equal(pathForCamera(loaded.scene,camera.name).userData.hf_id,'path');
});
