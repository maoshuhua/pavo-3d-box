import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {namespaceImportedAsset} from '../src/importedAsset.js';

function fixture(){const scene=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:'#963bea'}));scene.name='GLB_ROOT';mesh.name='CUP_BODY';scene.add(mesh);const clip=new THREE.AnimationClip('Turn',1,[new THREE.VectorKeyframeTrack('CUP_BODY.position',[0,1],[0,0,0,1,0,0])]);return{scene,animations:[clip],mesh}}
test('imported GLB keeps geometry, material and readable node names with stable namespaced IDs',()=>{
 const gltf=fixture(),geometry=gltf.mesh.geometry,material=gltf.mesh.material;
 namespaceImportedAsset(gltf,'cup',new THREE.Scene());
 assert.equal(gltf.mesh.name,'CUP_BODY');assert.equal(gltf.scene.name,'GLB_ROOT');assert.equal(gltf.mesh.userData.hf_id,'cup_node_1');assert.equal(gltf.mesh.geometry,geometry);assert.equal(gltf.mesh.material,material);assert.equal(gltf.animations[0].tracks[0].name,'CUP_BODY.position');
});
test('imported GLB resolves scene name collisions and rewires only matching animation bindings',()=>{
 const root=new THREE.Scene(),existing=new THREE.Group();existing.name='CUP_BODY';root.add(existing);const gltf=fixture();namespaceImportedAsset(gltf,'second-cup',root);
 assert.equal(existing.name,'CUP_BODY');assert.equal(gltf.mesh.name,'CUP_BODY_second-cup_1');assert.equal(gltf.animations[0].tracks[0].name,'CUP_BODY_second-cup_1.position');assert.equal(gltf.animations[0].name,'second-cup_Turn');
});
