import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {atomicWrite,readJson,sha256} from './storage.js';

const id=z.string().min(1).max(120), text=z.string().min(1).max(6000);
const refs=z.array(id).max(100).default([]);
export const directorPlanSchema=z.object({
 intent:text,duration:z.number().positive().max(600),aspectRatio:z.string().regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/),
 subjects:z.array(z.object({id,name:z.string().max(200).optional(),description:text})).max(100).default([]),
 constraints:z.array(z.object({id,description:text,subjectIds:refs})).max(100).default([]),
 shots:z.array(z.object({id,start:z.number().nonnegative(),end:z.number().positive(),cameraRef:id,purpose:text,subjects:refs,action:text,framing:text,movement:z.string().max(6000).default(''),criterionIds:refs})).min(1).max(100),
 criteria:z.array(z.object({id,description:text,kind:z.enum(['structural','visual','motion']),required:z.boolean().default(true),shotIds:refs})).min(1).max(200),
}).strict();
const mutation={requestId:id,expectedRevision:z.number().int().nonnegative().optional()};
const taskSchema=z.object({id,title:text,kind:z.enum(['plan','implement','review','deliver']),status:z.enum(['pending','in_progress','completed','blocked','cancelled']),dependsOn:refs,criterionIds:refs,evidenceIds:refs,note:z.string().max(6000).default('')}).strict();
const reviewSchema=z.object({criterionId:id,verdict:z.enum(['pass','fail','unverified']),evidenceIds:refs,observation:text}).strict();
export const codingTodoSchema=z.discriminatedUnion('op',[
 z.object({op:z.literal('read')}).strict(),
 z.object({op:z.literal('set_plan'),...mutation,plan:directorPlanSchema}).strict(),
 z.object({op:z.literal('update_tasks'),...mutation,tasks:z.array(taskSchema).min(1).max(200)}).strict(),
 z.object({op:z.literal('record_reviews'),...mutation,reviews:z.array(reviewSchema).min(1).max(200)}).strict(),
]);
// Compatible chat gateways require an object at the function schema root.
// Keep operation-specific validation above in apply(), after tool invocation.
export const codingTodoToolSchema=z.object({op:z.enum(['read','set_plan','update_tasks','record_reviews']),requestId:id.optional(),expectedRevision:z.number().int().nonnegative().optional(),plan:directorPlanSchema.optional(),tasks:z.array(taskSchema).min(1).max(200).optional(),reviews:z.array(reviewSchema).min(1).max(200).optional()}).strict();
const clone=value=>structuredClone(value);
const unique=(values,label)=>{if(new Set(values).size!==values.length)throw Error(`Duplicate ${label}`);};
const binding=(a,b)=>!!a&&!!b&&a.sourceHash===b.sourceHash&&a.baselineRevision===b.baselineRevision;
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<.025;
const now=()=>new Date().toISOString();
const currentKey=value=>({sourceHash:value.sourceHash,baselineRevision:String(value.baselineRevision??'initial')});

function validatePlan(plan){
 const ratio=plan.aspectRatio.split(':').map(Number);if(ratio.some(n=>!Number.isFinite(n)||n<=0))throw Error('Aspect ratio must be positive');
 unique(plan.shots.map(s=>s.id),'shot IDs');unique(plan.criteria.map(c=>c.id),'criterion IDs');unique(plan.subjects.map(s=>s.id),'subject IDs');unique(plan.constraints.map(c=>c.id),'constraint IDs');
 const shotIds=new Set(plan.shots.map(s=>s.id)),criterionIds=new Set(plan.criteria.map(c=>c.id)),subjects=new Set(plan.subjects.map(s=>s.id));
 let end=0;
 for(const shot of plan.shots){
  if(Math.abs(shot.start-end)>1e-6||shot.end<=shot.start||shot.end>plan.duration+1e-6)throw Error('Shots must be ordered, contiguous and cover the duration');
  end=shot.end;
  for(const subject of shot.subjects)if(!subjects.has(subject))throw Error(`Unknown subject ${subject}`);
  for(const criterion of shot.criterionIds)if(!criterionIds.has(criterion))throw Error(`Unknown criterion ${criterion}`);
 }
 if(Math.abs(end-plan.duration)>1e-6)throw Error('Shots must cover the full duration');
 for(const criterion of plan.criteria)for(const shotId of criterion.shotIds)if(!shotIds.has(shotId))throw Error(`Unknown shot ${shotId}`);
 for(const constraint of plan.constraints)for(const subject of constraint.subjectIds)if(!subjects.has(subject))throw Error(`Unknown subject ${subject}`);
}

// Samples are derived from the actual plan rather than a fixed shot template.
// Inspect the outgoing camera just before each cut and the incoming camera at
// the cut. Short shots receive proportionally spaced samples.
export function requiredFrames(plan){
 if(!plan)return [];
 const frames=plan.shots.flatMap((shot,index)=>{
  const epsilon=Math.min(1/30,(shot.end-shot.start)/4);
  return [shot.start,(shot.start+shot.end)/2,index===plan.shots.length-1?shot.end:shot.end-epsilon].map(time=>({camera_id:shot.cameraRef,time:Math.round(time*1e6)/1e6,shotId:shot.id}));
 });
 return frames.filter((frame,index)=>frames.findIndex(other=>other.camera_id===frame.camera_id&&other.time===frame.time)===index);
}

function validateRevision(previous,next,settings){
 if(settings?.aspectRatio){const a=settings.aspectRatio.split(':').map(Number),b=next.aspectRatio.split(':').map(Number);if(Math.abs(a[0]/a[1]-b[0]/b[1])>1e-6)throw Error('Plan aspect ratio does not match the requested generation settings');}
 const duration=settings?.durationSeconds;
 if(typeof duration==='number'&&!close(duration,next.duration))throw Error('Plan duration does not match the requested generation settings');
 if(!previous)return;
 for(const criterion of previous.criteria.filter(c=>c.required)){
  const updated=next.criteria.find(c=>c.id===criterion.id);
  if(!updated||!updated.required||updated.kind!==criterion.kind||updated.description!==criterion.description)throw Error(`Required criterion cannot be removed or weakened: ${criterion.id}`);
 }
 for(const constraint of previous.constraints){
  const updated=next.constraints.find(c=>c.id===constraint.id);
  if(!updated||updated.description!==constraint.description)throw Error(`Required constraint cannot be removed or weakened: ${constraint.id}`);
 }
}

function structuralChecks(plan,json){
 const entities=json?.entities||[],timeline=entities.find(e=>e.kind==='timeline')?.state?.timeline;
 const cameras=entities.filter(e=>e.kind==='camera'),checks=[];
 const add=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
 add('duration',close(timeline?.duration,plan.duration),`Expected ${plan.duration}; actual ${timeline?.duration??'missing'}`);
 const ratio=plan.aspectRatio.split(':').map(Number),aspect=ratio[0]/ratio[1];
 for(const shot of plan.shots){
  const camera=cameras.find(c=>c.id===shot.cameraRef);
  add(`camera:${shot.id}`,!!camera,shot.cameraRef);
  const actualAspect=camera?.state?.camera?.aspect??camera?.camera?.aspect;
  add(`aspect:${shot.id}`,Number.isFinite(actualAspect)&&Math.abs(actualAspect-aspect)<.01,`Expected ${plan.aspectRatio}; actual ${actualAspect??'missing'}`);
  add(`shot:${shot.id}`,(timeline?.shots||[]).some(s=>s.cameraId===shot.cameraRef&&close(s.start,shot.start)&&close(s.end,shot.end)),`${shot.cameraRef} ${shot.start}-${shot.end}`);
 }
 add('shotCount',timeline?.shots?.length===plan.shots.length,`Expected ${plan.shots.length}; actual ${timeline?.shots?.length??0}`);
 return checks;
}

// The model can reference evidence IDs but cannot create evidence or supply image
// paths through coding_todo_write. Only actual renderer/build integrations call
// register* methods. Persisted state is exposed as a read-only workspace file.
export class CodingTodo {
 constructor(ctx,state){this.ctx=ctx;this.state=state;this.file=path.join(ctx.dir,'workspace','agent-state.json');this.queue=Promise.resolve();}
 static async open(ctx){
  if(!ctx?.dir||!ctx.runId)throw Error('CodingTodo requires dir and runId');
  const file=path.join(ctx.dir,'workspace','agent-state.json'),previous=await readJson(file,null);
  if(previous?.runId===ctx.runId&&previous.version===1)return new CodingTodo(ctx,previous);
  if(previous)await atomicWrite(path.join(ctx.dir,'director-runs',`${sha256(String(previous.runId)).slice(0,24)}.json`),JSON.stringify(previous));
  const state={version:1,runId:ctx.runId,revision:0,planRevision:0,plan:null,priorPlan:previous?.plan??null,tasks:[],reviews:[],reviewHistory:[],evidence:[],currentSource:null,currentDraft:null,currentBuild:null,outcome:'in_progress',reason:null,requests:[],updatedAt:now()};
  const instance=new CodingTodo(ctx,state);await instance._save(state);return instance;
 }
 snapshot(){return {...clone(this.state),requiredFrames:requiredFrames(this.state.plan),acceptance:this.ready()};}
 read(){return this.snapshot();}
 _serial(fn){const next=this.queue.catch(()=>{}).then(fn);this.queue=next;return next;}
 async _save(state){await atomicWrite(this.file,JSON.stringify(state,null,2));this.state=state;this.ctx.emit?.({type:'DIRECTOR_STATE',state:this.snapshot()});}
 async _commit(state){state.revision++;state.updatedAt=now();await this._save(state);return this.snapshot();}
 apply(raw){return this._serial(async()=>{
  const args=codingTodoSchema.parse(raw);if(args.op==='read')return this.snapshot();
  const fingerprint=sha256(JSON.stringify({...args,expectedRevision:undefined}));
  const old=this.state.requests.find(r=>r.id===args.requestId);
  if(old){if(old.fingerprint!==fingerprint)throw Error('requestId was already used with different contents');return this.snapshot();}
  if(args.expectedRevision!==undefined&&args.expectedRevision!==this.state.revision)throw Error(`State revision conflict: expected ${args.expectedRevision}, current ${this.state.revision}; read state and retry`);
  const state=clone(this.state);
  if(args.op==='set_plan'){
   validatePlan(args.plan);validateRevision(state.plan,args.plan,this.ctx.generationSettings);state.plan=args.plan;state.planRevision++;state.tasks=[];
   state.reviewHistory.push(...state.reviews);state.reviews=[];state.outcome='in_progress';state.reason=null;
  }else{
   if(!state.plan)throw Error('Set a director plan first');
   if(args.op==='record_reviews'){
    unique(args.reviews.map(r=>r.criterionId),'review criterion IDs');
    for(const review of args.reviews){
     const criterion=state.plan.criteria.find(c=>c.id===review.criterionId);if(!criterion)throw Error(`Unknown criterion ${review.criterionId}`);
     this._checkReview(state,criterion,review);
     const oldReview=state.reviews.find(r=>r.criterionId===review.criterionId);if(oldReview)state.reviewHistory.push(oldReview);
     state.reviews=state.reviews.filter(r=>r.criterionId!==review.criterionId);
     state.reviews.push({...review,planRevision:state.planRevision,reviewedAt:now()});
    }
   }else{
    unique(args.tasks.map(t=>t.id),'task IDs');
    for(const task of args.tasks){state.tasks=state.tasks.filter(t=>t.id!==task.id);state.tasks.push(task);}
    this._checkTasks(state,new Set(args.tasks.map(t=>t.id)));
   }
  }
  state.requests.push({id:args.requestId,fingerprint});state.requests=state.requests.slice(-256);
  return this._commit(state);
 });}
 _validEvidence(state,evidence,final=false){
  if(!evidence||evidence.planRevision!==state.planRevision)return false;
  if(!binding(evidence,state.currentSource))return false;
  if(evidence.target==='build')return !!state.currentBuild&&evidence.taskId===state.currentBuild.taskId&&binding(evidence,state.currentBuild);
  return !final&&!!state.currentDraft&&binding(evidence,state.currentDraft);
 }
 _reviewEvidence(state,review,final=false){return review.evidenceIds.map(id=>state.evidence.find(e=>e.id===id)).filter(e=>this._validEvidence(state,e,final));}
 _criterionShots(state,criterion){return criterion.shotIds.length?state.plan.shots.filter(s=>criterion.shotIds.includes(s.id)):state.plan.shots;}
 _coverage(state,criterion,evidence){
  if(criterion.kind==='structural')return evidence.some(e=>e.kind==='build'||e.kind==='draft');
  return this._criterionShots(state,criterion).every(shot=>{
   const times=new Set(evidence.filter(e=>e.kind==='frame'&&e.cameraId===shot.cameraRef&&e.time>=shot.start-.001&&e.time<=shot.end+.001).map(e=>Math.round(e.time*1000)));
   return times.size>=(criterion.kind==='motion'?2:1);
  });
 }
 _checkReview(state,criterion,review){
  for(const evidenceId of review.evidenceIds)if(!state.evidence.some(e=>e.id===evidenceId))throw Error(`Unknown server evidence ${evidenceId}`);
  // A failed or inconclusive inspection is still a completed inspection. Keep it
  // even when it has no usable frame; it cannot make delivery ready.
  if(review.verdict!=='pass')return;
  const evidence=this._reviewEvidence(state,review);
  if(!this._coverage(state,criterion,evidence)){
   const stale=review.evidenceIds.length-evidence.length;
   const missing=criterion.kind==='structural'?['a current source preview or build record']:
    this._criterionShots(state,criterion).flatMap(shot=>{
     const times=[...new Set(evidence.filter(e=>e.kind==='frame'&&e.cameraId===shot.cameraRef&&e.time>=shot.start-.001&&e.time<=shot.end+.001).map(e=>Math.round(e.time*1000)/1000))];
     const required=criterion.kind==='motion'?2:1;
     return times.length<required?[`${shot.id}: camera ${shot.cameraRef}, time range [${shot.start}, ${shot.end}], needs ${required} distinct current frame times; linked ${times.length} (${times.join(', ')||'none'})`]:[];
    });
   throw Error(`Insufficient current evidence for ${criterion.id}. Missing: ${missing.join('; ')}. ${stale} linked evidence record(s) are stale or incompatible with the current source/plan/build. Render these camera/time samples with preview_3D_scene, then retry record_reviews using the returned current evidence IDs. Source edits invalidate earlier frames even for unchanged cameras. If the observation cannot be established, record fail or unverified instead of pass. No reviews from this request were saved.`);
  }
  if(criterion.kind==='structural'){
   const source=evidence.find(e=>e.kind==='build'||e.kind==='draft');
   if(!source?.checks?.length||source.checks.some(c=>!c.pass))throw Error('Structural checks have unresolved issues');
  }
 }
 _checkTasks(state,updatedIds){
  const tasks=new Map(state.tasks.map(t=>[t.id,t])),criteria=new Set(state.plan.criteria.map(c=>c.id));
  const visit=(id,path=new Set())=>{if(path.has(id))throw Error('Task dependency cycle');const task=tasks.get(id);if(!task)throw Error(`Unknown dependency ${id}`);const next=new Set(path).add(id);for(const dep of task.dependsOn)visit(dep,next);};
  for(const task of state.tasks){
   visit(task.id);for(const id of task.criterionIds)if(!criteria.has(id))throw Error(`Task ${task.id}: unknown criterion ${id}`);
   for(const id of task.evidenceIds)if(!state.evidence.some(e=>e.id===id))throw Error(`Task ${task.id}: unknown server evidence ${id}. Use evidence IDs returned by preview_3D_scene or build_3D_scene.`);
   if(['blocked','cancelled'].includes(task.status)&&!task.note.trim())throw Error('Blocked or cancelled tasks require an explanation');
   // Completion records work actually performed. A later source edit makes its
   // evidence unsuitable for delivery, but does not erase that historical work
   // or prevent a separate corrective task from being recorded.
   if(task.status!=='completed'||!updatedIds.has(task.id))continue;
   if(task.dependsOn.some(dep=>tasks.get(dep)?.status!=='completed'))throw Error(`Complete dependencies before ${task.id}`);
   const evidence=task.evidenceIds.map(id=>state.evidence.find(e=>e.id===id)).filter(e=>this._validEvidence(state,e));
   if(task.kind==='implement'&&!evidence.some(e=>['draft','build','frame'].includes(e.kind))){
    const available=state.evidence.filter(e=>this._validEvidence(state,e)&&['draft','build','frame'].includes(e.kind)).slice(-8).map(e=>`${e.id} (${e.target} ${e.kind})`);
    throw Error(`Task ${task.id}: completed implementation needs current draft, build or rendered frame evidence. Use evidence IDs returned by preview_3D_scene or build_3D_scene for the current source; stale evidence cannot complete this task. Available current evidence: ${available.join(', ')||'none; render the current source first'}.`);
   }
   if(task.kind==='review'){
    const missing=task.criterionIds.filter(id=>!state.reviews.some(r=>r.criterionId===id&&r.planRevision===state.planRevision));
    if(!task.criterionIds.length||missing.length)throw Error(`Task ${task.id}: missing recorded observations for criteria ${missing.length?missing.join(', '):'(no criterionIds supplied; provide the criteria inspected)'}. Use coding_todo_write with op:"record_reviews" for these criteria, then retry task completion. A review verdict may be pass, fail or unverified; task completion records inspection, not acceptance.`);
   }
   if(task.kind==='deliver'&&!this._ready(state).ready)throw Error('Delivery acceptance has unresolved issues');
  }
 }
 noteSource(value){return this._serial(async()=>{if(!value?.sourceHash)throw Error('Source hash required');const state=clone(this.state),next=currentKey(value);if(binding(next,state.currentSource))return this.snapshot();state.currentSource=next;state.outcome='in_progress';state.reason=null;return this._commit(state);});}
 registerDraft(value){return this._register('draft',value);}
 registerBuild(value){return this._register('build',value);}
 _register(target,value){return this._serial(async()=>{
  if(!value?.sourceHash||target==='build'&&!value.taskId)throw Error('Source hash and build task ID required');
  const state=clone(this.state),key=currentKey(value);state.currentSource=key;
  const record={id:crypto.randomUUID(),kind:target,target,...key,planRevision:state.planRevision,createdAt:now(),...(target==='build'?{taskId:value.taskId,artifactHash:value.artifactHash??null}:{}),checks:state.plan&&value.json?structuralChecks(state.plan,value.json):[]};
  state.evidence.push(record);state[target==='build'?'currentBuild':'currentDraft']={...key,taskId:value.taskId??null,evidenceId:record.id,planRevision:state.planRevision};state.outcome='in_progress';state.reason=null;
  await this._commit(state);return {...clone(record),stateRevision:this.state.revision};
 });}
 registerFrames(value){return this._serial(async()=>{
  const state=clone(this.state),target=value?.target,key=currentKey(value||{}),current=target==='build'?state.currentBuild:state.currentDraft;
  if(!['draft','build'].includes(target)||!binding(current,key)||!binding(state.currentSource,key)||target==='build'&&current.taskId!==value.taskId)throw Error('Frame does not belong to the current source/build');
  if(!Array.isArray(value.frames)||!value.frames.length)throw Error('Actual rendered frames required');
  const records=value.frames.map(frame=>{
   const cameraId=frame.camera_id??frame.cameraId;
   if(!cameraId||!Number.isFinite(frame.time)||frame.time<0)throw Error('Frame camera and time required');
   return {id:crypto.randomUUID(),kind:'frame',target,...key,planRevision:state.planRevision,...(target==='build'?{taskId:current.taskId}:{}),cameraId,time:frame.time,imageUrl:frame.image_url??frame.imageUrl??null,width:frame.width??null,height:frame.height??null,createdAt:now()};
  });
  state.evidence.push(...records);await this._commit(state);return records.map(record=>({...clone(record),stateRevision:this.state.revision}));
 });}
 _ready(state){
  const reasons=[];
  if(!state.plan)return {ready:false,reasons:['No director plan']};
  if(!state.currentBuild||state.currentBuild.planRevision!==state.planRevision||!binding(state.currentBuild,state.currentSource))reasons.push('No build of the current plan and source');
  const build=state.evidence.find(e=>e.id===state.currentBuild?.evidenceId);
  if(!build?.checks?.length||build.checks.some(c=>!c.pass))reasons.push('Final build structure does not match the plan');
  for(const criterion of state.plan.criteria.filter(c=>c.required)){
   const review=state.reviews.find(r=>r.criterionId===criterion.id&&r.planRevision===state.planRevision);
   if(review?.verdict!=='pass'||!this._coverage(state,criterion,this._reviewEvidence(state,review||{evidenceIds:[]},true)))reasons.push(`Unaccepted criterion: ${criterion.id}`);
  }
  const implemented=state.tasks.some(task=>task.kind==='implement'&&task.status==='completed'&&task.evidenceIds.some(id=>{
   const evidence=state.evidence.find(e=>e.id===id);
   return ['draft','build','frame'].includes(evidence?.kind)&&this._validEvidence(state,evidence);
  }));
  if(!implemented)reasons.push('No completed implementation task with current source evidence; complete an implement task using current preview/build evidence IDs');
  const inspected=new Set(state.tasks.filter(task=>task.kind==='review'&&task.status==='completed').flatMap(task=>task.criterionIds));
  for(const criterion of state.plan.criteria.filter(c=>c.required))if(!inspected.has(criterion.id))reasons.push(`No completed review task for required criterion: ${criterion.id}; record its review, then complete a review task covering it`);
  for(const task of state.tasks)if(task.kind!=='deliver'&&!['completed','cancelled'].includes(task.status))reasons.push(`Unfinished task: ${task.id}`);
  const frames=state.evidence.filter(e=>e.kind==='frame'&&this._validEvidence(state,e,true));
  for(const sample of requiredFrames(state.plan))if(!frames.some(frame=>frame.cameraId===sample.camera_id&&Math.abs(frame.time-sample.time)<=1/30+.000001))reasons.push(`Missing final frame: ${sample.camera_id}@${sample.time}`);
  return {ready:reasons.length===0,reasons,taskId:state.currentBuild?.taskId??null,planRevision:state.planRevision};
 }
 ready(){return this._ready(this.state);}
 finish(outcome,reason=''){return this._serial(async()=>{
  if(!['accepted','completed','partial','not_generated','failed','cancelled'].includes(outcome))throw Error('Invalid director outcome');
  if(['accepted','completed'].includes(outcome)&&!this.ready().ready)throw Error('Cannot complete before current build acceptance');
  const state=clone(this.state);state.outcome=outcome;state.reason=String(reason).slice(0,6000);return this._commit(state);
 });}
}
