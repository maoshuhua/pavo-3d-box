import React from 'react';
import './DirectorProgress.css';

const statuses={pending:'待处理',in_progress:'进行中',completed:'已执行',blocked:'受阻',cancelled:'已取消'};
const verdicts={pass:'通过',fail:'未通过',unverified:'未验证'};
const outcomes={accepted:'验收通过',partial:'部分完成',not_generated:'尚未生成',cancelled:'已取消'};
export default function DirectorProgress({state}){
 if(!state)return null;
 const tasks=state.tasks||state.todos||[],plan=state.plan;
 const reviews=Array.isArray(state.reviews)?state.reviews:Object.values(state.reviews||{});
 const evidence=Array.isArray(state.evidence)?state.evidence:Object.values(state.evidence||{});
 const done=tasks.filter(t=>t.status==='completed').length;
 return <details className="director-progress">
  <summary>{outcomes[state.outcome]||(state.currentBuild?'场景已构建 · 检查中':'制作与验收')}{tasks.length?` · ${done}/${tasks.length} 项任务`:''}</summary>
  {state.reason&&<p>{state.reason}</p>}
  {plan&&<details><summary>分镜计划 · {plan.shots.length} 个镜头 · {plan.duration} 秒 · {plan.aspectRatio}</summary>
   <p>{plan.intent}</p><ol>{plan.shots.map(shot=><li key={shot.id}><strong>{shot.start}–{shot.end} 秒 · {shot.purpose}</strong><p>{shot.action}</p><p>{shot.framing}{shot.movement?` · ${shot.movement}`:''}</p></li>)}</ol>
  </details>}
  <ul className="director-tasks">{tasks.map(task=><li key={task.id} data-status={task.status}><span>{statuses[task.status]||task.status}</span> {task.title}{task.note&&<p>{task.note}</p>}</li>)}</ul>
  {plan&&<details><summary>验收结果与画面证据</summary>{plan.criteria.map(criterion=>{
   const review=[...reviews].reverse().find(r=>r.criterionId===criterion.id);
   return <div className="director-criterion" key={criterion.id} data-verdict={review?.verdict||'unverified'}>
    <strong>{verdicts[review?.verdict]||'未验收'} · {criterion.description}{criterion.required===false?'（可选）':''}</strong>
    {review&&<p>{review.observation||review.note}</p>}
    <div className="director-evidence">{(review?.evidenceIds||[]).map(id=>{
     const frame=evidence.find(e=>(e.id||e.evidenceId)===id),url=frame?.image_url||frame?.imageUrl;
     return url?<a key={id} href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={`${frame.cameraId||frame.camera_id||'机位'} ${frame.time??''}秒`} loading="lazy"/>{frame.target==='draft'?'草稿':'交付件'} · {frame.time} 秒</a>:null;
    })}</div>
   </div>;
  })}</details>}
 </details>;
}
