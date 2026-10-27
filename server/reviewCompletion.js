import {missingPreviewFrames} from './previewPlan.js';
// Bound repeated visual polishing, while still requiring real checks of the
// latest build at the beginning, middle and end of the actual shot sequence.
export function reviewCompletion(ctx,limit=3) {
 if((ctx.completedBuilds||0)<limit||!ctx.current?.result)return null;
 const timeline=ctx.current.json.entities.find(e=>e.kind==='timeline')?.state.timeline;
 const duration=timeline?.duration,shots=timeline?.shots||[];
 const covers=(frame,shot)=>frame.camera_id===shot.cameraId&&frame.time>=shot.start-.05&&frame.time<=shot.end+.05;
 const frames=(ctx.previewChecks||[]).filter(p=>p.task_id===ctx.current.result.task_id&&(!shots.length||shots.some(shot=>covers(p,shot))));
 if(!frames.length||!Number.isFinite(duration))return null;
 if(missingPreviewFrames(ctx.current.json,frames).length)return null;
 const start=frames.some(p=>p.time<=0.05),end=frames.some(p=>p.time>=duration-0.05);
 const middle=duration<=0.1||frames.some(p=>p.time>=duration*0.25&&p.time<=duration*0.75);
 if(!start||!middle||!end||shots.some(shot=>!frames.some(frame=>covers(frame,shot))))return null;
 return {builds:ctx.completedBuilds,taskId:ctx.current.result.task_id,times:frames.map(p=>p.time)};
}

// The model declares intent through x_list. Only a declaration made before any
// scene work may select chat; a mutation or a scene declaration cannot downgrade.
export function declareTaskIntent(ctx,intent) {
 if(intent==='scene'){ctx.taskIntent='scene';ctx.sceneWorkStarted=true;}
 else if(intent==='chat'&&!ctx.sceneWorkStarted&&ctx.taskIntent!=='scene')ctx.taskIntent='chat';
 return ctx.taskIntent==='chat'?'chat':'scene';
}

export function latestTaskReview(ctx) {
 return ctx.taskReview?.task_id===ctx.current?.result?.task_id?ctx.taskReview:null;
}

export const previewCheckKey=frame=>[frame.task_id,frame.camera_id,frame.time,frame.image_url].join('\0');

// These are objective delivery checks, not a claim that artistic quality has
// passed. The report always refers to this invocation's latest successful build.
export function sceneAcceptance(ctx,{requireReview=true}={}) {
 const issues=[],add=(code,message,details={})=>issues.push({code,message,...details});
 const result=ctx.current?.result,taskId=result?.task_id;
 if(!taskId||!(ctx.completedBuilds>0))add('no-new-build','本轮尚未生成新的成功场景产物。');
 const committed=taskId&&typeof ctx.isBuildCommitted==='function'?ctx.isBuildCommitted(taskId):null;
 if(committed===false)add('artifact-not-committed','最新场景产物尚未提交保存。');
 if(ctx.unbuiltChanges)add('unbuilt-changes','成功构建后仍有未构建的场景程序修改。');
 if(ctx.latestBuildFailed)add('latest-build-failed','最近一次构建失败，保留的成功产物未代表最后一次修改。');
 const entities=ctx.current?.json?.entities||[],cameras=new Map(entities.filter(e=>e.kind==='camera'&&!e.deleted).map(e=>[e.id,e]));
 const timeline=entities.find(e=>e.kind==='timeline'&&!e.deleted)?.state?.timeline;
 const duration=timeline?.duration,shots=Array.isArray(timeline?.shots)?timeline.shots:[];
 if(!Number.isFinite(duration)||duration<=0||duration>600||!shots.length)add('invalid-timeline','最新场景需要有效时长及至少一个镜头。');
 if(!cameras.size)add('missing-camera','最新场景没有可用机位。');
 let previousEnd=0;
 for(const [index,shot] of shots.entries()){
  if(!cameras.has(shot.cameraId))add('missing-shot-camera','镜头引用的机位不存在。',{shot:index,cameraId:shot.cameraId});
  if(!Number.isFinite(shot.start)||!Number.isFinite(shot.end)||Math.abs(shot.start-previousEnd)>.05||shot.end<=shot.start||shot.end>duration+.05)add('invalid-shot-range','镜头时段必须连续、不重叠且位于时间轴内。',{shot:index});
  previousEnd=shot.end;
 }
 if(shots.length&&Number.isFinite(duration)&&Math.abs(previousEnd-duration)>.05)add('incomplete-timeline','镜头未覆盖完整时间轴。');
 const settings=ctx.generationSettings||{},requestedDuration=Number(settings.durationSeconds);
 if(settings.durationSeconds!==undefined&&settings.durationSeconds!=='auto'&&Number.isFinite(requestedDuration)&&Math.abs(duration-requestedDuration)>.001)add('duration-mismatch','场景时长与本轮指定时长不一致。');
 const ratio=typeof settings.aspectRatio==='string'?settings.aspectRatio.split(':').map(Number):[];
 if(ratio.length===2&&ratio.every(v=>Number.isFinite(v)&&v>0))for(const id of new Set(shots.map(s=>s.cameraId))){
  const aspect=cameras.get(id)?.state?.camera?.aspect;
  if(!Number.isFinite(aspect)||Math.abs(aspect-ratio[0]/ratio[1])>.001)add('aspect-mismatch','镜头机位画幅与本轮指定画幅不一致。',{cameraId:id});
 }
 const review=latestTaskReview(ctx);
 const frames=(ctx.previewChecks||[]).filter(p=>p.task_id===taskId&&p.status==='completed'&&Number.isFinite(p.time)&&p.width>0&&p.height>0&&typeof p.image_url==='string'&&(!(ctx.observedPreviewKeys instanceof Set)||ctx.observedPreviewKeys.has(previewCheckKey(p)))&&(!review||!(ctx.taskReviewObservedKeys instanceof Set)||ctx.taskReviewObservedKeys.has(previewCheckKey(p))));
 const missing=missingPreviewFrames(ctx.current?.json,frames);
 if(missing.length)add('preview-coverage','最新产物尚未检查每个镜头的起点、中段和结尾。',{missing});
 const diagnostics=Array.isArray(result?.diagnostics)?result.diagnostics:[];
 const blockingDiagnostics=diagnostics.filter(d=>['error','fatal'].includes(d.severity)||d.kind==='inside-subject-bounds');
 if(blockingDiagnostics.length)add('blocking-diagnostics','最新构建仍有需要处理的严重诊断。',{diagnostics:blockingDiagnostics});
 if(requireReview&&!review)add('review-missing','尚未提交最新产物的结构化交付检查。');
 if(review?.status==='partial'||review?.issues?.length)add('unfinished-work','交付检查仍报告未完成内容。',{remaining:review.issues||[]});
 if(ctx.budgetExhausted)add('budget-exhausted','本轮执行预算已用尽，尚未完成的工作不能视为通过。');
 if(ctx.repeatedErrorStop)add('repeated-error-stop',ctx.repeatedErrorStop.hint,{repeat:ctx.repeatedErrorStop});
 return {intent:'scene',status:issues.length?'partial':'completed',taskId:taskId||null,checksPassed:issues.length===0,artifactCommitted:committed,issues,coverage:{required:shots.length*3,checked:shots.length*3-missing.length,missing},diagnostics};
}

export function agentOutcome(ctx) {
 if(ctx.taskIntent==='chat'&&!ctx.sceneWorkStarted&&!(ctx.completedBuilds>0))return {intent:'chat',status:'chat',checksPassed:false,issues:[]};
 return sceneAcceptance(ctx);
}
