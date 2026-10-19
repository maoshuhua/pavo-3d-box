import {PropertyBinding} from 'three';

// GLTFLoader sanitizes node names, while extras keep the authored names.
// Reconnect libtv's name-based rig metadata before ensureCameraPaths runs.
export function normalizeCameraPathBindings(root){
 const nodes=[];root.traverse(node=>nodes.push(node));
 const cameras=nodes.filter(node=>node.isCamera);
 const resolve=(name,candidates)=>{
  if(typeof name!=='string')return null;
  const exact=candidates.filter(node=>node.name===name);
  if(exact.length===1)return exact[0];
  const aliases=candidates.filter(node=>node.userData.name===name||PropertyBinding.sanitizeNodeName(node.name)===PropertyBinding.sanitizeNodeName(name));
  return aliases.length===1?aliases[0]:null;
 };
 const seen=new Map();let changed=false;
 for(const path of nodes.filter(node=>typeof node.userData.blockingStudioPathFor==='string')){
  const camera=resolve(path.userData.blockingStudioPathFor,cameras);
  if(!camera)continue;
  if(path.userData.blockingStudioPathFor!==camera.name){path.userData.blockingStudioPathFor=camera.name;changed=true;}
  const key=camera.uuid,previous=seen.get(key);
  // Older local snapshots may contain the same generated rig twice, with
  // identical persistent IDs. Never remove an independently authored path.
  if(previous&&path.userData.hf_id&&previous.userData.hf_id===path.userData.hf_id){path.removeFromParent();changed=true;continue;}
  seen.set(key,path);
  const children=[];path.traverse(node=>children.push(node));
  const settings=path.userData.blockingStudioPath;
  const aim=settings&&resolve(settings.targetName,children);
  if(aim&&settings.targetName!==aim.name){settings.targetName=aim.name;changed=true;}
  const focus=resolve(camera.userData.blockingStudioDofFocus,children);
  if(focus&&camera.userData.blockingStudioDofFocus!==focus.name){camera.userData.blockingStudioDofFocus=focus.name;changed=true;}
 }
 return changed;
}
