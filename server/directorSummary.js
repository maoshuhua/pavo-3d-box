// Keep historical evidence on disk; give the model current, usable references.
export function directorSummary(state){
 return {revision:state.revision,planRevision:state.planRevision,plan:state.plan,priorPlan:state.plan?undefined:state.priorPlan,
  tasks:state.tasks,reviews:state.reviews,outcome:state.outcome,reason:state.reason,currentSource:state.currentSource,currentBuild:state.currentBuild,
  acceptance:state.acceptance,requiredFrames:state.requiredFrames,missingFrames:state.missingFrames,
  evidence:(state.evidence||[]).filter(e=>e.planRevision===state.planRevision&&e.sourceHash===state.currentSource?.sourceHash&&e.baselineRevision===state.currentSource?.baselineRevision&&(e.target==='build'?e.taskId===state.currentBuild?.taskId:!!state.currentDraft&&e.sourceHash===state.currentDraft.sourceHash&&e.baselineRevision===state.currentDraft.baselineRevision)).slice(-64).map(({id,kind,target,cameraId,time,sourceHash,taskId,checks})=>({id,kind,target,cameraId,time,sourceHash,taskId,checks}))};
}
