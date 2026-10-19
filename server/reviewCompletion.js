// Build count limits cost; only current delivery evidence can approve quality.
export function reviewCompletion(ctx){
 const acceptance=ctx.director?.ready();
 return acceptance?.ready&&ctx.current?.result?.task_id===acceptance.taskId?acceptance:null;
}
