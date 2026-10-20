// Bound repeated visual polishing, while still requiring real checks of the
// latest build at the beginning, middle and end of the actual shot sequence.
export function reviewCompletion(ctx,limit=3) {
 if((ctx.completedBuilds||0)<limit||!ctx.current?.result)return null;
 const timeline=ctx.current.json.entities.find(e=>e.kind==='timeline')?.state.timeline;
 const duration=timeline?.duration,shots=timeline?.shots||[];
 const covers=(frame,shot)=>frame.camera_id===shot.cameraId&&frame.time>=shot.start-.05&&frame.time<=shot.end+.05;
 const frames=(ctx.previewChecks||[]).filter(p=>p.task_id===ctx.current.result.task_id&&(!shots.length||shots.some(shot=>covers(p,shot))));
 if(!frames.length||!Number.isFinite(duration))return null;
 const start=frames.some(p=>p.time<=0.05),end=frames.some(p=>p.time>=duration-0.05);
 const middle=duration<=0.1||frames.some(p=>p.time>=duration*0.25&&p.time<=duration*0.75);
 if(!start||!middle||!end||shots.some(shot=>!frames.some(frame=>covers(frame,shot))))return null;
 return {builds:ctx.completedBuilds,taskId:ctx.current.result.task_id,times:frames.map(p=>p.time)};
}
