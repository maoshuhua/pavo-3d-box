import * as THREE from 'three';

export function findMotionEntity(root,id,name) {
 let found;root.traverse(node=>{if(id&&node.userData.hf_id===id)found=node;});
 return found||(!id&&name?root.getObjectByName(name):null);
}

// A private mixer samples existing subject/parent animations and restores the live scene afterwards.
export function createScenePoseSampler(root,clips,excludedCameraNames=[]) {
 const original=[];root.traverse(node=>original.push([node,node.position.clone(),node.quaternion.clone(),node.scale.clone()]));
 const mixer=new THREE.AnimationMixer(root),excluded=new Set(excludedCameraNames),actions=[];
 for(const clip of clips){
  const tracks=clip.tracks.filter(t=>![...excluded].some(name=>t.name===name+'.position'||t.name===name+'.quaternion'));
  if(!tracks.length)continue;
  const action=mixer.clipAction(new THREE.AnimationClip(clip.name,clip.duration,tracks));action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();actions.push(action);
 }
 return {
  at(time){for(const action of actions){action.paused=false;action.enabled=true;}mixer.setTime(time);root.updateMatrixWorld(true);},
  restore(){mixer.stopAllAction();mixer.uncacheRoot(root);for(const [node,p,q,s] of original){node.position.copy(p);node.quaternion.copy(q);node.scale.copy(s);}root.updateMatrixWorld(true);}
 };
}

export function pathProgress(settings,elapsed) {
 const speed=Math.abs(settings.speed??1),duration=Math.max(settings.duration,1e-6);
 let fraction=speed===0?0:elapsed*speed/duration;
 fraction=settings.bounce?(fraction<=1?fraction:2-fraction):fraction;
 let u=THREE.MathUtils.clamp(fraction,0,1);
 if((settings.speed??1)<0)u=1-u;
 if(settings.easing==='in')return u*u;
 if(settings.easing==='out')return 1-(1-u)*(1-u);
 if(settings.easing==='inout')return u<.5?2*u*u:1-(-2*u+2)**2/2;
 return u;
}

export function samplePathPose({curve,settings,camera,root},elapsed,previousQuaternion) {
 const u=pathProgress(settings,elapsed),position=curve.getPointAt(u),tangent=curve.getTangentAt(u);
 tangent.multiplyScalar(((settings.speed??1)<0?-1:1)*(settings.bounce&&elapsed*Math.abs(settings.speed??1)>settings.duration?-1:1));
 const follow=settings.follow;
 if(follow){
  const entity=findMotionEntity(root,follow.entityId);
  if(!entity)throw Error('找不到跟随目标：'+follow.entityId);
  const bind=new THREE.Matrix4().fromArray(follow.bindMatrix),offset=new THREE.Vector3(...(follow.offset||[0,0,0]));
  if(follow.positionSpace==='subject'){
   position.applyMatrix4(bind.clone().invert()).add(offset).applyMatrix4(entity.matrixWorld);
   tangent.transformDirection(bind.clone().invert()).transformDirection(entity.matrixWorld);
  }else position.add(entity.getWorldPosition(new THREE.Vector3()).sub(new THREE.Vector3().setFromMatrixPosition(bind))).add(offset);
 }
 let quaternion;
 if(settings.aim==='fixed')quaternion=new THREE.Quaternion().fromArray(settings.fixedQuaternion||camera.getWorldQuaternion(new THREE.Quaternion()).toArray());
 else {
  const target=findMotionEntity(root,settings.targetId,settings.targetName);
  if(settings.targetId&&!target)throw Error('找不到注视目标：'+settings.targetId);
  const aim=settings.aim==='target'?(target?target.getWorldPosition(new THREE.Vector3()):settings.aimPoint?new THREE.Vector3(...settings.aimPoint):position.clone().add(tangent)):position.clone().add(tangent);
  if(settings.aim==='target')aim.add(new THREE.Vector3(...(settings.aimOffset||[0,0,0])));
  if(aim.distanceToSquared(position)<1e-12)throw Error('相机位置与注视点重合');
  quaternion=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(position,aim,new THREE.Vector3(0,1,0)));
 }
 if(settings.roll)quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),THREE.MathUtils.degToRad(settings.roll)));
 if(previousQuaternion&&previousQuaternion.dot(quaternion)<0)quaternion.set(-quaternion.x,-quaternion.y,-quaternion.z,-quaternion.w);
 return {position,quaternion};
}

export function bakePathSequence(root,camera,segments,clips=[]) {
 segments.sort((a,b)=>a.start-b.start);
 const sampler=createScenePoseSampler(root,clips,[camera.name]),times=[],positions=[],quaternions=[],diagnostics=[];
 let previousEnd=-Infinity,previousPose;
 const append=(time,pose)=>{
  sampler.at(time);
  const local=pose.position.clone(),q=pose.quaternion.clone();
  if(camera.parent){
   const scale=camera.parent.getWorldScale(new THREE.Vector3());
   if(Math.min(scale.x,scale.y,scale.z)<=0||Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-5*Math.max(1,scale.length()))throw Error('相机父节点需要正数等比缩放；请将非等比缩放放到模型子节点');
   local.applyMatrix4(camera.parent.matrixWorld.clone().invert());q.premultiply(camera.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
  if(times.at(-1)===time){times.pop();positions.splice(-3);quaternions.splice(-4);}
  times.push(time);positions.push(...local.toArray());quaternions.push(...q.normalize().toArray());
 };
 const hold=(from,to,pose)=>{
  const count=Math.max(1,Math.ceil((to-from)*30));
  for(let i=0;i<count;i++)append(from+(to-from)*i/count,pose);
 };
 try{
  for(const segment of segments){
   const {settings,curve,path,start,duration}=segment;
   if(!Number.isFinite(start)||!Number.isFinite(duration)||start<0||duration<=0||start+duration>600+1e-6)throw Error('相机路径时段必须在 0..600 秒内');
   if(start<previousEnd-1e-6)throw Error('同一机位的路径时间重叠');
   if(previousPose&&start>previousEnd)hold(previousEnd,start,previousPose);
   const count=Math.min(2000,Math.max(1,Math.ceil(duration*30)));
   for(let i=0;i<=count;i++){
    const time=start+i/count*duration;sampler.at(time);
    const pose=samplePathPose({curve,settings,camera,root},i/count*duration,previousPose?.quaternion);
    if(!pose.position.toArray().every(Number.isFinite)||!pose.quaternion.toArray().every(Number.isFinite))throw Error('相机路径产生非有限数值');
    if(i===0&&previousPose){
     const tolerance=Math.max(1e-4,(settings.anchorRadius||1)*.001);
     if(previousPose.position.distanceTo(pose.position)>tolerance||previousPose.quaternion.angleTo(pose.quaternion)>.01)throw Error('路径接点不连续；请调整路径点及注视方向，或使用独立机位切镜');
    }
    if(!previousPose&&start>0)hold(0,start,pose);
    append(time,pose);
    if(i%5===0||i===count){
     for(const id of settings.subjectIds||[]){
      const subject=findMotionEntity(root,id);if(!subject)throw Error('找不到取景主体：'+id);
      const box=new THREE.Box3().setFromObject(subject);
      if(box.containsPoint(pose.position)&&diagnostics.length<30)diagnostics.push({kind:'inside-subject-bounds',time,entityId:id});
      if(camera.isPerspectiveCamera&&!box.isEmpty()){
       const inverse=new THREE.Matrix4().compose(pose.position,pose.quaternion,new THREE.Vector3(1,1,1)).invert(),tan=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
       let outside=false;
       for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
        const p=new THREE.Vector3(x,y,z).applyMatrix4(inverse);
        if(-p.z<camera.near||Math.abs(p.x)>-p.z*tan*camera.aspect||Math.abs(p.y)>-p.z*tan)outside=true;
       }
       if(outside&&diagnostics.length<30)diagnostics.push({kind:'subject-outside-frame',time,entityId:id});
      }
     }
    }
    previousPose=pose;
   }
   path.userData.cameraMotionDiagnostics=diagnostics.filter(d=>d.time>=start&&d.time<=start+duration);
   previousEnd=start+duration;
  }
  const clip=new THREE.AnimationClip('Path_'+camera.name,previousEnd,[new THREE.VectorKeyframeTrack(camera.name+'.position',times,positions),new THREE.QuaternionKeyframeTrack(camera.name+'.quaternion',times,quaternions)]);
  return clip;
 }finally{sampler.restore();}
}
