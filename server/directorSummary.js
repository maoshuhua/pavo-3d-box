// Keep historical evidence on disk; give the model current, usable references.
export function directorSummary(state){
 return {revision:state.revision,planRevision:state.planRevision,plan:state.plan,priorPlan:state.plan?undefined:state.priorPlan,
  tasks:state.tasks,reviews:state.reviews,outcome:state.outcome,reason:state.reason,currentSource:state.currentSource,currentBuild:state.currentBuild,
  acceptance:state.acceptance,requiredFrames:state.requiredFrames,
  evidence:(state.evidence||[]).slice(-64).map(({id,kind,target,cameraId,time,sourceHash,taskId,checks})=>({id,kind,target,cameraId,time,sourceHash,taskId,checks}))};
}
