import * as THREE from 'three';

const physicalKeys=['transmission','thickness','ior','clearcoat','clearcoatRoughness','attenuationDistance','attenuationColor'];
export function patchMaterial(object,data) {
 const update=original=>{
  let m=original?.clone()||new THREE.MeshStandardMaterial({color:'#b7bec9',roughness:.65,side:THREE.DoubleSide});
  if(physicalKeys.some(key=>data[key]!==undefined)&&!m.isMeshPhysicalMaterial){
   const upgraded=new THREE.MeshPhysicalMaterial();
   THREE.MeshStandardMaterial.prototype.copy.call(upgraded,m);upgraded.defines={STANDARD:'',PHYSICAL:''};m.dispose();m=upgraded;
  }
  if(data.color!==undefined)m.color.set(data.color);
  if(data.baseColor){m.color.fromArray(data.baseColor);m.opacity=data.baseColor[3];m.transparent=m.opacity<1;}
  for(const [key,value] of Object.entries(data)){
   if(['color','baseColor'].includes(key))continue;
   if(['emissive','attenuationColor'].includes(key))m[key].set(value);
   else m[key==='metallic'?'metalness':key]=value;
  }
  m.needsUpdate=true;return m;
 };
 object.material=Array.isArray(object.material)?object.material.map(update):update(object.material);
}

export function materialState(m) {
 if(Array.isArray(m))return m.map(materialState);
 if(!m?.color)return null;
 const state={baseColor:[...m.color.toArray(),m.opacity],metallic:m.metalness,roughness:m.roughness};
 if(m.emissive)state.emissive='#'+m.emissive.getHexString();
 if(m.isMeshPhysicalMaterial)for(const key of physicalKeys){if(key==='attenuationColor')state[key]='#'+m[key].getHexString();else if(Number.isFinite(m[key]))state[key]=m[key];}
 return state;
}

export function restoreMaterialState(object,data) {
 if(Array.isArray(object.material)){
  // Old snapshots described only the first slot; do not flatten imported palettes.
  const slots=Array.isArray(data)?data:[data];
  object.material=object.material.map((material,index)=>{
   if(!slots[index])return material;
   const slot={material};patchMaterial(slot,slots[index]);return slot.material;
  });
 }else if(data&&!Array.isArray(data))patchMaterial(object,data);
}

export function subjectBounds(root,ids) {
 root.updateMatrixWorld(true);
 const box=new THREE.Box3();
 for(const id of ids){
  let object;root.traverse(node=>{if(node.userData.hf_id===id)object=node;});
  if(!object)throw Error('找不到主体：'+id);
  box.union(new THREE.Box3().setFromObject(object));
 }
 if(box.isEmpty())throw Error('主体没有可用的几何范围');
 return {box,center:box.getCenter(new THREE.Vector3()),size:box.getSize(new THREE.Vector3()),radius:Math.max(box.getBoundingSphere(new THREE.Sphere()).radius,.01)};
}

export function applyProductLighting(root,config) {
 const {center,size,radius}=subjectBounds(root,config.subjectIds),scale=Math.max(size.x,size.y,size.z,.1);
 const prefix=config.id||'product-lighting';
 const definitions=[
  ['key',new THREE.DirectionalLight(config.key?.color||'#fff0df',config.key?.intensity??3),[-1.4,1.8,1.4],true],
  ['fill',new THREE.DirectionalLight('#dce9ff',(config.key?.intensity??3)*(config.fillRatio??.25)),[1.5,.5,1],false],
  ['rim',new THREE.SpotLight('#ffffff',(config.key?.intensity??3)*(config.rimRatio??.65)*scale*scale),[.8,1.4,-1.5],false]
 ];
 for(const [name,light,offset,shadow] of definitions){
  const id=prefix+'-'+name;let old;root.traverse(node=>{if(node.userData.hf_id===id)old=node;});
  if(old&&!old.userData.productLighting)throw Error('商品灯光 ID 与已有实体冲突：'+id);
  old?.removeFromParent();
  light.name=id;light.userData.hf_id=id;light.userData.productLighting=prefix;
  light.position.copy(center).add(new THREE.Vector3(...offset).multiplyScalar(scale));
  light.lookAt(center);light.target.position.set(0,0,-1);light.add(light.target);
  light.target.userData.libtvLightTarget=true;
  light.castShadow=shadow&&config.shadows!=='none';light.userData.hf_cast_shadow=light.castShadow;
  if(light.isSpotLight){light.angle=Math.PI/4;light.penumbra=.85;light.distance=scale*10;}
  if(light.shadow){light.shadow.radius=3;light.userData.productShadowBounds={center:center.toArray(),radius:radius*1.8};}
  root.add(light);
 }
 root.updateMatrixWorld(true);
}
