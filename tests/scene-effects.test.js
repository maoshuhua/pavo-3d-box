import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {patchMaterial,materialState,restoreMaterialState,applyProductLighting} from '../src/sceneEffects.js';
import {validateScene} from '../server/sceneSchema.js';

function fixture(){
 const root=new THREE.Scene(),subject=new THREE.Mesh(new THREE.BoxGeometry(1,2,1),new THREE.MeshStandardMaterial()),camera=new THREE.PerspectiveCamera(40,9/16,.05,100);
 subject.userData.hf_id='bottle';subject.position.y=1;camera.userData.hf_id='cam';camera.name='Camera';camera.position.set(0,2,8);root.add(subject,camera);root.updateMatrixWorld(true);
 return {root,subject,camera};
}
test('partial material edits preserve physical properties, maps and independent material slots',()=>{
 const original=new THREE.MeshPhysicalMaterial({color:'red',metalness:.8,roughness:.2,transmission:.7,thickness:.3,ior:1.45,clearcoat:.4});original.map=new THREE.Texture();
 const object={material:[original,original]};patchMaterial(object,{color:'#00ff00'});
 for(const m of object.material){assert.equal(m.metalness,.8);assert.equal(m.transmission,.7);assert.equal(m.map,original.map);assert.equal(m.color.getHexString(),'00ff00');}
 assert.notEqual(object.material[0],object.material[1]);assert.equal(original.color.getHexString(),'ff0000');
 patchMaterial(object,{roughness:.4});assert.equal(object.material[0].transmission,.7);
 const copy={material:new THREE.MeshStandardMaterial()};patchMaterial(copy,materialState(object.material[0]));
 assert(copy.material.isMeshPhysicalMaterial);assert.equal(copy.material.defines.PHYSICAL,'');assert.equal(copy.material.ior,1.45);assert.equal(copy.material.transmission,.7);
 assert.equal(copy.material.attenuationDistance,Infinity);
});
test('product lights scale with the subject, target correctly and bound one shadow independently of floor',()=>{
 const {root}=fixture();root.add(new THREE.Mesh(new THREE.BoxGeometry(10000,.1,10000)));
 applyProductLighting(root,{subjectIds:['bottle']});
 const lights=[];root.traverse(n=>{if(n.isLight)lights.push(n);});assert.equal(lights.length,3);assert.equal(lights.filter(l=>l.castShadow).length,1);
 const key=lights.find(l=>l.userData.hf_id.endsWith('key'));
 assert(key.userData.productShadowBounds.radius<5);assert.equal(key.target.parent,key);
 applyProductLighting(root,{subjectIds:['bottle']});let count=0;root.traverse(n=>{if(n.isLight)count++;});assert.equal(count,3);
});

test('snapshot restoration preserves distinct imported material slots and legacy first-slot snapshots',()=>{
 const object={material:[new THREE.MeshPhysicalMaterial({color:'red',transmission:.8}),new THREE.MeshStandardMaterial({color:'blue',metalness:.9})]};
 const data=materialState(object.material);restoreMaterialState(object,data);
 assert.equal(object.material[0].color.getHexString(),'ff0000');assert.equal(object.material[0].transmission,.8);
 assert.equal(object.material[1].color.getHexString(),'0000ff');assert.equal(object.material[1].metalness,.9);
 restoreMaterialState(object,{baseColor:[0,1,0,1],roughness:.3});
 assert.equal(object.material[0].color.getHexString(),'00ff00');assert.equal(object.material[1].color.getHexString(),'0000ff');
});
