import {remapLightingIds} from './lightingRuntime.js';
// Entity identity is namespaced; readable GLB node names are preserved unless
// they collide with the current scene and would make animation binding ambiguous.
export function namespaceImportedAsset(gltf,id,existingRoot){
 const used=new Set(),renamed=new Map(),ids=new Map();let index=0;
 existingRoot.traverse(child=>{if(child.name)used.add(child.name)});
 gltf.scene.traverse(child=>{
  const suffix=index++,old=child.name,oldId=child.userData.hf_id;child.userData.hf_id=id+'_node_'+suffix;if(oldId)ids.set(oldId,child.userData.hf_id);
  child.name=old||`${id}_${suffix}`;
  if(used.has(child.name))child.name=`${child.name}_${id}_${suffix}`;
  used.add(child.name);if(old&&old!==child.name)renamed.set(old,child.name);
 });
 for(const clip of gltf.animations){
  for(const track of clip.tracks){const dot=track.name.indexOf('.'),name=renamed.get(track.name.slice(0,dot));if(name)track.name=name+track.name.slice(dot)}
  clip.name=id+'_'+clip.name;
 }
 remapLightingIds(gltf.scene,ids);
 return gltf.scene;
}
