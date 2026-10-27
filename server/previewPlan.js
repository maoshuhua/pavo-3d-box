export function requiredPreviewFrames(json){
 const shots=json?.entities?.find(e=>e.kind==='timeline'&&!e.deleted)?.state?.timeline?.shots||[];
 return shots.flatMap((shot,index)=>[shot.start,(shot.start+shot.end)/2,shot.end].map(time=>({shot:index,cameraId:shot.cameraId,time})));
}

export function missingPreviewFrames(json,checks=[]){
 return requiredPreviewFrames(json).filter(frame=>!checks.some(p=>p.status==='completed'&&p.camera_id===frame.cameraId&&Math.abs(p.time-frame.time)<=.05));
}

export function resolvePreviewFrames(args,json){
 const frames=args.frames||[{camera_id:args.camera_id,time:args.time??0}];
 if(!Array.isArray(frames)||!frames.length||frames.length>12)throw Error('每次预览需要 1 到 12 个检查帧。');
 const cameras=(json.entities||[]).filter(e=>e.kind==='camera'&&!e.deleted);
 const duration=json.entities.find(e=>e.kind==='timeline')?.state.timeline.duration;
 return frames.map(frame=>{
  const camera=frame.camera_id===undefined?cameras[0]:cameras.find(c=>c.id===frame.camera_id);
  if(!camera)throw Error(frame.camera_id===undefined?'场景没有可用的预览机位。':`预览机位不存在：${frame.camera_id}`);
  if(!Number.isFinite(frame.time)||frame.time<0||frame.time>600||duration!==undefined&&frame.time>duration)throw Error(`检查时间超出有效时间轴：${frame.time}`);
  return {cameraId:camera.id,time:frame.time};
 });
}
