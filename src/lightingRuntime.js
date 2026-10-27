import * as THREE from 'three';
import {subjectBounds} from './sceneEffects.js';
import {lightingRigSchema,lightingRigsSchema,lightPropertiesSchema} from './lightingSchema.js';
import {lightingPresets} from './lightingPresets.js';

const identity=()=>new THREE.Quaternion();
export const findLightingEntity=(root,id)=>{let found;root.traverse(n=>{if(n.userData.hf_id===id||n.uuid===id)found=n;});return found;};
export const lightType=l=>l.isRectAreaLight?'area':l.isHemisphereLight?'hemisphere':l.isAmbientLight?'ambient':l.isDirectionalLight?'directional':l.isSpotLight?'spot':'point';
// Compatibility with existing scene-node, operation and snapshot formats.
export function normalizeLightProperties(p){
 const color=c=>Array.isArray(c)?'#'+new THREE.Color().fromArray(c).getHexString():c;
 return {type:p.type||p.kind,color:color(p.color)||'#ffffff',intensity:p.intensity??1,castShadow:p.castShadow??false,
  ...p.groundColor?{groundColor:color(p.groundColor)}:{},...p.range!=null||p.distance!=null?{range:p.range??p.distance}:{},
  ...p.decay!=null?{decay:p.decay}:{},...p.angle!=null?{angle:p.angle}:{},...p.outerConeAngle!=null?{angle:THREE.MathUtils.radToDeg(p.outerConeAngle)}:{},
  ...p.penumbra!=null?{penumbra:p.penumbra}:p.innerConeAngle!=null&&p.outerConeAngle?{penumbra:1-p.innerConeAngle/p.outerConeAngle}:{},
  ...p.width!=null?{width:p.width}:{},...p.height!=null?{height:p.height}:{},...p.shadow?{shadow:p.shadow}:{}};
}
export function lightProperties(l){
 const p={type:lightType(l),color:'#'+l.color.getHexString(),intensity:l.intensity,castShadow:!!l.castShadow};
 if(l.groundColor)p.groundColor='#'+l.groundColor.getHexString();
 if(l.distance!==undefined){p.range=l.distance;p.decay=l.decay;}
 if(l.isSpotLight){p.angle=THREE.MathUtils.radToDeg(l.angle);p.penumbra=l.penumbra;}
 if(l.isRectAreaLight){p.width=l.width;p.height=l.height;}
 if(l.shadow)p.shadow={mapSize:l.shadow.mapSize.x,bias:l.shadow.bias,normalBias:l.shadow.normalBias,radius:l.shadow.radius};
 return p;
}
export function setLightProperties(l,input){
 const p=lightPropertiesSchema.parse(input);
 if(lightType(l)!==p.type)throw Error('修改灯型需要重新创建灯光');
 l.color.set(p.color);l.intensity=p.intensity;l.castShadow=p.castShadow;l.userData.hf_cast_shadow=p.castShadow;
 if(l.groundColor)l.groundColor.set(p.groundColor??'#444444');
 if(l.distance!==undefined){l.distance=p.range??0;l.decay=p.decay??2;}
 if(l.isSpotLight){l.angle=THREE.MathUtils.degToRad(p.angle??45);l.penumbra=p.penumbra??.5;}
 if(l.isRectAreaLight){l.width=p.width??1;l.height=p.height??1;}
 if(l.shadow&&p.shadow){const s=p.shadow;if(s.mapSize){if(l.shadow.mapSize.x!==s.mapSize){l.shadow.map?.dispose();l.shadow.map=null;}l.shadow.mapSize.set(s.mapSize,s.mapSize);}for(const k of ['bias','normalBias','radius'])if(s[k]!==undefined)l.shadow[k]=s[k];l.userData.studioShadow=structuredClone(s);}
 return l;
}
export function createLight(properties){
 const p=lightPropertiesSchema.parse(properties);
 const classes={directional:THREE.DirectionalLight,point:THREE.PointLight,spot:THREE.SpotLight,area:THREE.RectAreaLight,hemisphere:THREE.HemisphereLight,ambient:THREE.AmbientLight};
 const l=new classes[p.type]();setLightProperties(l,p);
 if(l.target){l.target.userData.libtvLightTarget=true;l.add(l.target);l.target.position.set(0,0,-1);}
 return l;
}
function aimLight(light,worldPoint){
 if(!light.target&&!light.isRectAreaLight)return;
 light.updateWorldMatrix(true,false);
 // Light objects face -Z; Object3D.lookAt uses +Z for ordinary objects.
 const matrix=new THREE.Matrix4().lookAt(light.getWorldPosition(new THREE.Vector3()),worldPoint,new THREE.Vector3(0,1,0));
 const q=new THREE.Quaternion().setFromRotationMatrix(matrix);
 if(light.parent)q.premultiply(light.parent.getWorldQuaternion(identity()).invert());
 light.quaternion.copy(q);
 if(light.target){if(light.target.parent!==light)light.add(light.target);light.target.position.set(0,0,-1);}
 light.updateWorldMatrix(true,true);
}
function temperatureColor(k){
 const t=k/100,clamp=v=>Math.max(0,Math.min(255,v))/255;
 const r=t<=66?255:329.698727446*Math.pow(t-60,-.1332047592);
 const g=t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-.0755148492);
 const b=t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307;
 return '#'+new THREE.Color().setRGB(clamp(r),clamp(g),clamp(b),THREE.SRGBColorSpace).getHexString();
}
const requireEntity=(root,id,label)=>{const n=findLightingEntity(root,id);if(!n)throw Error('找不到'+label+'：'+id);return n;};
function worldPose(group,position,quaternion){
 const matrix=new THREE.Matrix4().compose(position,quaternion,new THREE.Vector3(1,1,1));
 if(group.parent){group.parent.updateWorldMatrix(true,false);matrix.premultiply(group.parent.matrixWorld.clone().invert());}
 matrix.decompose(group.position,group.quaternion,group.scale);group.updateWorldMatrix(true,true);
}
function presetLights(config,scale){
 const p=lightingPresets.find(p=>p.id===config.presetId),color=temperatureColor(config.temperature),power=config.intensity;
 const fill=config.contrast===undefined?p.fill:Math.pow(1-config.contrast,2)*.8;
 const lights=[];
 const add=(id,type,role,position,intensity,extra={})=>lights.push({id,role,name:({key:'主光',fill:'补光',ambient:'环境底光'})[id]||id,position:position.map(v=>v*scale),target:{point:[0,0,0]},properties:{type,color,intensity,...extra}});
 if(!p.practical){
  const type=p.spot?'spot':p.sun||config.softness<.15?'directional':'area';
  add('key',type,'key',p.key,(type==='spot'?12*scale*scale:3)*power,{castShadow:config.shadows!=='none'&&['spot','directional'].includes(type),...type==='area'?{width:scale*(.3+config.softness*2.5),height:scale*(.3+config.softness*2)}:{},...type==='spot'?{angle:28,penumbra:config.softness}: {}});
  if(fill)add('fill','area','fill',[1.5,.6,p.id==='cross'?-1.1:1.2],3*fill*power,{width:scale*2,height:scale*2});
 }
 lights.push({id:'ambient',name:'环境底光',role:'ambient',position:[0,1,0],properties:{type:'hemisphere',color:p.sun?'#c9ddff':color,groundColor:'#675b50',intensity:p.ambient*power,castShadow:false}});
 return lights;
}
function describeLight(light,group){
 const d={id:light.userData.studioLightId||light.userData.hf_id,name:light.name,label:light.userData.studioLabel||light.name.slice(0,128),role:light.userData.studioRole||'key',properties:lightProperties(light),position:light.position.toArray(),rotation:light.quaternion.toArray(),enabled:light.visible,locked:!!light.userData.studioLocked};
 if(light.userData.studioTarget)d.target=structuredClone(light.userData.studioTarget);
 else if(light.target){group.updateWorldMatrix(true,true);d.target={point:group.worldToLocal(light.target.getWorldPosition(new THREE.Vector3())).toArray(),follow:false};}
 if(light.userData.studioSource)d.sourceEntityId=light.userData.studioSource;
 if(light.userData.studioKeyframes)d.keyframes=structuredClone(light.userData.studioKeyframes);
 return d;
}
export function readLightingRig(group){
 return {config:structuredClone(group.userData.studioLighting),transform:{position:group.position.toArray(),rotation:group.quaternion.toArray(),scale:group.scale.toArray()},lights:group.children.filter(l=>l.isLight).map(l=>describeLight(l,group)),binding:structuredClone(group.userData.studioLightingBinding||null),...group.userData.studioLightingBounds?{shadowBounds:structuredClone(group.userData.studioLightingBounds)}:{}};
}
function populate(root,group,lights){
 const rigId=group.userData.studioLighting.id;
 for(const d of lights){
  if(d.target?.entityId)requireEntity(root,d.target.entityId,'灯光目标');
  if(d.sourceEntityId)requireEntity(root,d.sourceEntityId,'光源实体');
  const light=createLight(d.properties);light.name=d.name||`${rigId}_${d.id}`;
  light.userData.studioLabel=d.label||d.name?.slice(0,128)||({directional:'平行光',point:'点光',spot:'聚光灯',area:'面积光',hemisphere:'半球光',ambient:'环境光'})[d.properties.type];
  // Unique names also keep Three animation bindings unambiguous.
  const suffix=`_${rigId}_${d.id}`;if(!light.name.endsWith(suffix))light.name=light.name.slice(0,512-suffix.length)+suffix;
  light.userData.hf_id=rigId+':'+d.id;light.userData.studioLightId=d.id;light.userData.studioRole=d.role;
  light.userData.studioRigId=rigId;light.userData.studioLocked=d.locked??false;
  light.userData.studioTarget=d.target?structuredClone(d.target):null;
  light.userData.studioSource=d.sourceEntityId||null;light.userData.studioKeyframes=d.keyframes?structuredClone(d.keyframes):null;
  light.position.fromArray(d.position);if(d.rotation)light.quaternion.fromArray(d.rotation).normalize();light.visible=d.enabled!==false;
  group.add(light);
 }
 group.updateWorldMatrix(true,true);
 for(const l of group.children){if(!l.isLight)continue;const t=l.userData.studioTarget;if(t)aimLight(l,t.entityId?requireEntity(root,t.entityId,'灯光目标').getWorldPosition(new THREE.Vector3()):group.localToWorld(new THREE.Vector3(...t.point)));}
}
export function buildLightingRigs(root,input){
 const configs=lightingRigsSchema.parse(input),plans=[];
 root.updateMatrixWorld(true);
 for(const config of configs){
  const old=findLightingEntity(root,config.id);
  if(old&&!old.userData.studioLighting)throw Error('布光组 ID 与已有实体冲突：'+config.id);
  if(old?.userData.studioLighting.locked||old?.children.some(n=>n.userData.studioLocked))throw Error('布光组或其中灯光已锁定：'+config.id);
  const bounds=config.subjectIds.length?subjectBounds(root,config.subjectIds):null;
  const center=config.origin?new THREE.Vector3(...config.origin):config.presetId==='custom'?new THREE.Vector3():bounds.center;
  const scale=config.scale??Math.max(bounds?.size.length()??1,.1);
  const ref=config.reference,anchor=ref.space==='camera'?requireEntity(root,ref.cameraId,'参考机位'):ref.space==='subject'?requireEntity(root,ref.entityId||config.subjectIds[0],'参考主体'):null;
  if(ref.space==='camera'&&!anchor.isCamera)throw Error('参考实体不是摄像机');
  if(anchor)for(let n=anchor;n;n=n.parent)if(n===old)throw Error('布光组不能跟随自身内部实体');
  const group=new THREE.Group();group.userData={hf_id:config.id,studioLighting:structuredClone(config)};group.name=config.name||'布光_'+config.id;group.visible=config.enabled;
  // Build with root's coordinate system without mutating root until validation succeeds.
  group.parent=root;worldPose(group,center,config.rotation?new THREE.Quaternion(...config.rotation).normalize():anchor?anchor.getWorldQuaternion(identity()):identity());group.parent=null;
  group.userData.studioLightingBinding=anchor&&ref.follow?{entityId:anchor.userData.hf_id||anchor.uuid,center:anchor.worldToLocal(center.clone()).toArray()}:null;
  let lights=config.presetId==='custom'?config.lights:presetLights(config,scale);
  if(config.presetId==='practical')lights=[...lights,...config.sourceIds.map((id,i)=>{
   const source=requireEntity(root,id,'光源实体');const local=source.getWorldPosition(new THREE.Vector3()).sub(center);
   if(anchor)local.applyQuaternion(anchor.getWorldQuaternion(identity()).invert());
   return {id:'source-'+i,role:'practical',sourceEntityId:id,position:local.toArray(),properties:{type:'point',color:temperatureColor(config.temperature),intensity:20*scale*scale*config.intensity,castShadow:config.shadows!=='none',range:scale*8,decay:2}};
  })];
  for(const l of lights){const conflict=findLightingEntity(root,config.id+':'+l.id);if(conflict){let owner=conflict;while(owner&&owner!==old)owner=owner.parent;if(!owner)throw Error('灯光 ID 与已有实体冲突：'+config.id+':'+l.id);}}
  // Detached groups still need root's matrix during target conversion.
  group.parent=root;populate(root,group,lights);group.parent=null;
  const shadowBounds={center:center.toArray(),radius:(bounds?.radius??scale)*1.8};
  group.userData.studioLightingBounds=shadowBounds;
  group.traverse(l=>{if(l.isLight)l.userData.lightingShadowBounds=shadowBounds;});
  plans.push({old,group});
 }
 const plannedIds=new Set();
 for(const {group} of plans)group.traverse(n=>{const id=n.userData.hf_id;if(!id)return;if(plannedIds.has(id))throw Error('布光组与灯光 ID 冲突：'+id);plannedIds.add(id);});
 for(const {old,group} of plans){old?.removeFromParent();root.add(group);}
 root.updateMatrixWorld(true);updateLightingRuntime(root,0);
 return plans.map(p=>p.group);
}
export function restoreLightingRig(root,state){
 const old=findLightingEntity(root,state.config.id);if(old&&!old.userData.studioLighting)throw Error('布光组 ID 冲突');
 const group=new THREE.Group();group.name=state.config.name||'布光_'+state.config.id;
 group.userData={hf_id:state.config.id,studioLighting:structuredClone(state.config),studioLightingBinding:structuredClone(state.binding||null),...state.shadowBounds?{studioLightingBounds:structuredClone(state.shadowBounds)}:{}};
 group.position.fromArray(state.transform.position);group.quaternion.fromArray(state.transform.rotation);group.scale.fromArray(state.transform.scale);group.visible=state.config.enabled;
 group.parent=root;populate(root,group,state.lights);group.parent=null;
 if(state.shadowBounds)group.children.forEach(l=>l.userData.lightingShadowBounds=structuredClone(state.shadowBounds));
 // Preserve authored names exactly across snapshots and operation replay.
 group.children.forEach((l,i)=>{l.name=state.lights[i].name||l.name;});
 old?.removeFromParent();root.add(group);return group;
}
export function convertLightingToCustom(group){
 group.userData.studioLighting=customLightingConfig(group);
 return group;
}
export function customLightingConfig(group){
 const state=readLightingRig(group);group.updateWorldMatrix(true,true);
 return lightingRigSchema.parse({...state.config,presetId:'custom',origin:group.getWorldPosition(new THREE.Vector3()).toArray(),rotation:group.getWorldQuaternion(identity()).toArray(),lights:state.lights});
}
export function updateLightingRuntime(root,time=0){
 const groups=[];root.traverse(n=>{if(n.userData.studioLighting)groups.push(n);});
 for(const g of groups){
  const binding=g.userData.studioLightingBinding;
  if(binding){const anchor=findLightingEntity(root,binding.entityId);if(anchor){anchor.updateWorldMatrix(true,false);worldPose(g,anchor.localToWorld(new THREE.Vector3(...binding.center)),anchor.getWorldQuaternion(identity()));}}
  for(const l of g.children){
   if(!l.isLight)continue;
   const frames=l.userData.studioKeyframes||[];
   for(const key of ['position','color','intensity']){
    const samples=frames.filter(f=>f[key]!==undefined);if(!samples.length)continue;
    const next=samples.findIndex(f=>f.time>time),a=next===0?samples[0]:next<0?samples.at(-1):samples[next-1],b=next<=0?a:samples[next],t=a===b?0:THREE.MathUtils.clamp((time-a.time)/(b.time-a.time),0,1);
    if(key==='position')l.position.fromArray(a.position).lerp(new THREE.Vector3(...b.position),t);
    if(key==='color')l.color.set(a.color).lerp(new THREE.Color(b.color),t);
    if(key==='intensity')l.intensity=THREE.MathUtils.lerp(a.intensity,b.intensity,t);
   }
   const source=l.userData.studioSource&&findLightingEntity(root,l.userData.studioSource);
   if(source)l.position.copy(g.worldToLocal(source.getWorldPosition(new THREE.Vector3())));
   const target=l.userData.studioTarget;
   if(target?.follow){const point=target.entityId?findLightingEntity(root,target.entityId)?.getWorldPosition(new THREE.Vector3()):g.localToWorld(new THREE.Vector3(...target.point));if(point)aimLight(l,point);}
  }
 }
 root.updateMatrixWorld(true);
}

// glTF has no area/hemisphere/ambient light types. Store complete descriptors in
// node extras; unsupported lights become ordinary transform nodes on export.
export function prepareLightingExport(root){
 root.updateMatrixWorld(true);
 const lights=[];root.traverse(n=>{if(n.isLight)lights.push(n);});
 for(const light of lights){
  light.userData.studioLight={properties:lightProperties(light),targetLocal:light.target?light.worldToLocal(light.target.getWorldPosition(new THREE.Vector3())).toArray():null};
  if(['area','hemisphere','ambient'].includes(lightType(light))){
   const placeholder=new THREE.Object3D();THREE.Object3D.prototype.copy.call(placeholder,light,false);
   const parent=light.parent,index=parent.children.indexOf(light);parent.remove(light);parent.add(placeholder);parent.children.splice(parent.children.indexOf(placeholder),1);parent.children.splice(index,0,placeholder);
   while(light.children.length)placeholder.add(light.children[0]);
  }
 }
 return root;
}
export function restoreLightingNodes(root){
 const nodes=[];root.traverse(n=>{if(n.userData.studioLight)nodes.push(n);});
 for(const node of nodes){
  const data=node.userData.studioLight;let light=node;
  if(!node.isLight||lightType(node)!==data.properties.type){
   light=createLight(data.properties);THREE.Object3D.prototype.copy.call(light,node,false);
   const parent=node.parent,index=parent.children.indexOf(node);parent.remove(node);parent.add(light);parent.children.splice(parent.children.indexOf(light),1);parent.children.splice(index,0,light);
   while(node.children.length)light.add(node.children[0]);
  }else setLightProperties(light,data.properties);
  if(light.target&&data.targetLocal){const targets=light.children.filter(n=>n.userData.libtvLightTarget);targets.forEach(n=>n.removeFromParent());light.target=new THREE.Object3D();light.target.userData.libtvLightTarget=true;light.target.position.fromArray(data.targetLocal);light.add(light.target);}
  delete light.userData.studioLight;
 }
 root.updateMatrixWorld(true);return root;
}

export function remapLightingIds(root,mapping){
 const remap=id=>mapping.get(id)||id;
 // Rig child identities are derived from their owner, including imported copies.
 root.traverse(g=>{const c=g.userData.studioLighting;if(!c)return;const next=g.userData.hf_id;
  mapping.set(c.id,next);
  for(const l of g.children)if(l.isLight&&l.userData.studioLightId){const old=c.id+':'+l.userData.studioLightId;l.userData.hf_id=next+':'+l.userData.studioLightId;mapping.set(old,l.userData.hf_id);}
 });
 root.traverse(n=>{
  const c=n.userData.studioLighting;
  const remapLight=d=>{if(d.target?.entityId)d.target.entityId=remap(d.target.entityId);if(d.sourceEntityId)d.sourceEntityId=remap(d.sourceEntityId);};
  if(c){c.id=remap(c.id);c.subjectIds=c.subjectIds.map(remap);c.sourceIds=c.sourceIds.map(remap);if(c.reference.entityId)c.reference.entityId=remap(c.reference.entityId);if(c.reference.cameraId)c.reference.cameraId=remap(c.reference.cameraId);c.lights?.forEach(remapLight);}
  if(n.userData.studioRigId)n.userData.studioRigId=remap(n.userData.studioRigId);
  if(n.userData.studioTarget?.entityId)n.userData.studioTarget.entityId=remap(n.userData.studioTarget.entityId);
  if(n.userData.studioSource)n.userData.studioSource=remap(n.userData.studioSource);
  if(n.userData.studioLightingBinding)n.userData.studioLightingBinding.entityId=remap(n.userData.studioLightingBinding.entityId);
 });
}
