import * as THREE from 'three';
import {createCameraPath,applyPathPreset,updatePathSettings,bakeCameraPath,pathWaypoints,replaceCameraAnimation,readPathSettings} from './libtvCameraRig.js';
import {createScenePoseSampler,findMotionEntity} from './cameraPathSampling.js';
import {subjectBounds} from './sceneEffects.js';

export function buildCameraPaths(root,motions,clips=[],explicitCameraTracks=[]) {
 root.traverse(node=>{if(node.isCamera)delete node.userData.authoredCameraMotion;});
 const ids=new Set(),groups=new Map();
 for(const motion of motions){
  if(ids.has(motion.id))throw Error('相机路径 ID 重复：'+motion.id);ids.add(motion.id);
  if(explicitCameraTracks.includes(motion.cameraId))throw Error('同一机位不能同时提交手写动画和路径：'+motion.cameraId);
  const segments=groups.get(motion.cameraId)||[];segments.push(motion);groups.set(motion.cameraId,segments);
 }
 const cameras=[...groups.keys()].map(id=>{
  const camera=findMotionEntity(root,id);if(!camera?.isPerspectiveCamera)throw Error('找不到透视机位：'+id);return camera;
 });
 const sceneSampler=createScenePoseSampler(root,clips,cameras.map(c=>c.name)),created=[];
 try{
  sceneSampler.at(0);
  for(const [cameraId,segments] of groups){
   const camera=findMotionEntity(root,cameraId);
   // An explicit new path sequence owns this camera's path, leaving unrelated cameras untouched.
   const old=[];root.traverse(n=>{if(n.userData.blockingStudioPathFor===camera.name)old.push(n);});old.forEach(p=>p.removeFromParent());
   let previousEnd=-Infinity;
   for(const motion of segments.sort((a,b)=>a.start-b.start)){
    sceneSampler.at(motion.start);
    if(motion.start<previousEnd)throw Error('同一机位的路径时间重叠');previousEnd=motion.end;
    const bounds=motion.subjectIds.length?subjectBounds(root,motion.subjectIds):null;
    const aimTarget=motion.aim?.entityId?findMotionEntity(root,motion.aim.entityId):null;
    if(motion.aim?.entityId&&!aimTarget)throw Error('找不到注视目标：'+motion.aim.entityId);
    const focus=motion.aim?.point?new THREE.Vector3(...motion.aim.point):aimTarget?aimTarget.getWorldPosition(new THREE.Vector3()):bounds?.center.clone()||new THREE.Vector3();
    let origin=camera.getWorldPosition(new THREE.Vector3());
    if(motion.origin)origin.fromArray(motion.origin);
    else if(bounds){
     let direction=origin.clone().sub(focus);if(direction.lengthSq()<1e-10)direction.set(0,.2,1);
     const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),fit=bounds.radius/Math.sin(Math.atan(Math.min(tangent,tangent*camera.aspect)))*motion.margin;
     origin=focus.clone().addScaledVector(direction.normalize(),fit);
    }
    const followTarget=motion.follow?findMotionEntity(root,motion.follow.entityId):null;
    if(motion.follow&&!followTarget)throw Error('找不到跟随目标：'+motion.follow.entityId);
    for(const target of [aimTarget,followTarget]){
     for(let p=target;p;p=p.parent)if(cameras.includes(p))throw Error('相机路径不能依赖自身或另一受控机位');
    }
    const savedPosition=camera.position.clone();camera.position.copy(camera.parent?camera.parent.worldToLocal(origin.clone()):origin);camera.updateMatrixWorld(true);
    delete camera.userData.selectedCameraPathId;
    // createCameraPath returns a per-camera existing path; temporarily hide previous segment bindings.
    const others=created.filter(p=>p.userData.blockingStudioPathFor===camera.name);
    others.forEach(p=>p.userData.blockingStudioPathFor='__pending__');
    const path=createCameraPath(root,camera,focus,motion.end-motion.start);
    others.forEach(p=>p.userData.blockingStudioPathFor=camera.name);
    camera.position.copy(savedPosition);camera.updateMatrixWorld(true);
    path.userData.hf_id='camera-path:'+cameraId+':'+motion.id;path.name='Path_'+camera.name+'_'+motion.id;
    path.userData.blockingStudioPathAnchor={origin:origin.toArray(),focus:focus.toArray(),radius:origin.distanceTo(focus)};
    updatePathSettings(path,{intensity:motion.intensity??1,framing:motion.framing??'medium'});
    if(motion.presetId==='custom'){
     for(const point of pathWaypoints(path))point.removeFromParent();
     for(const [index,position] of motion.path.points.entries()){
      const point=new THREE.Object3D();point.name='WP_'+(index+1);point.userData={blockingStudioWaypoint:true,blockingStudioWaypointIndex:index,hf_id:path.userData.hf_id+':point-'+index};point.position.copy(path.worldToLocal(new THREE.Vector3(...position)));path.add(point);
     }
    }else if(!applyPathPreset(path,camera,motion.presetId,focus))throw Error('未知路径预设：'+motion.presetId);
    const settings=readPathSettings(path),follow=motion.follow?{...motion.follow}:undefined;
    if(follow){const entity=findMotionEntity(root,follow.entityId);if(!entity)throw Error('找不到跟随目标：'+follow.entityId);follow.bindMatrix=entity.matrixWorld.toArray();}
    updatePathSettings(path,{
     enabled:true,motionSource:'agent-path',segmentId:motion.id,start:motion.start,presetId:motion.presetId==='custom'?null:motion.presetId,
     duration:(motion.end-motion.start)*(Math.abs(motion.speed??1)>1e-4?Math.abs(motion.speed??1):1)/(motion.bounce?2:1),speed:motion.speed??1,bounce:motion.bounce??false,
     ...motion.path?{curve:motion.path.curve,tension:motion.path.tension,closed:motion.path.closed}:{},
     easing:motion.easing??settings.easing,roll:motion.roll??0,subjectIds:motion.subjectIds,anchorRadius:bounds?.radius??origin.distanceTo(focus),
     aim:motion.aim?.mode??settings.aim,targetId:motion.aim?.entityId??null,aimPoint:focus.toArray(),aimOffset:motion.aim?.offset||[0,0,0],follow,
     fixedQuaternion:camera.getWorldQuaternion(new THREE.Quaternion()).toArray()
    });
    // Helper names must be distinct for each segment, including after GLB sanitization.
    path.traverse(node=>{
     if(node.userData.blockingStudioPathAim){node.name='Aim_'+camera.name+'_'+motion.id;node.userData.hf_id=path.userData.hf_id+':aim';if(!motion.aim?.entityId)updatePathSettings(path,{targetName:node.name});}
     if(node.userData.blockingStudioPathFocus){node.name='Focus_'+camera.name+'_'+motion.id;node.userData.hf_id=path.userData.hf_id+':focus';}
    });
    if(motion.aim?.entityId)updatePathSettings(path,{targetName:aimTarget.name,targetId:motion.aim.entityId});
    else if(motion.follow&&!motion.aim?.point)updatePathSettings(path,{aim:motion.aim?.mode??'target',targetId:motion.follow.entityId});
    else if(motion.presetId==='custom')updatePathSettings(path,{aim:motion.aim?.mode??'tangent'});
    pathWaypoints(path).forEach((point,index)=>{point.userData.hf_id=path.userData.hf_id+':point-'+index;});
    created.push(path);
   }
   camera.userData.selectedCameraPathId=created.find(p=>p.userData.blockingStudioPathFor===camera.name).userData.hf_id;
  }
 }finally{sceneSampler.restore();}
 // Rebuild persisted paths too: changing a subject animation must update its following camera.
 const paths=[];root.traverse(p=>{if(p.userData.blockingStudioPathFor&&readPathSettings(p).enabled)paths.push(p);});
 let result=clips;
 for(const name of new Set(paths.map(p=>p.userData.blockingStudioPathFor))){
  const camera=root.getObjectByName(name),path=paths.find(p=>p.userData.blockingStudioPathFor===name);
  if(!camera?.isCamera)throw Error('路径对应机位不存在：'+name);
  if(explicitCameraTracks.includes(camera.userData.hf_id)){
   if(groups.has(camera.userData.hf_id))throw Error('同一机位不能同时提交手写动画和路径');
   // An explicit keyframe edit takes ownership; stale path definitions cannot overwrite it.
   paths.filter(p=>p.userData.blockingStudioPathFor===name).forEach(p=>p.removeFromParent());continue;
  }
  result=replaceCameraAnimation(result,name,bakeCameraPath(THREE,root,path,camera,clips));
 }
 return {clips:result,diagnostics:paths.filter(p=>p.parent).flatMap(p=>(p.userData.cameraMotionDiagnostics||[]).map(d=>({...d,pathId:p.userData.hf_id})))};
}
