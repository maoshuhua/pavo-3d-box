import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CodingTodo,codingTodoSchema,requiredFrames} from '../server/codingTodo.js';

const plan=()=>({intent:'Show a subject crossing the frame',duration:2,aspectRatio:'16:9',subjects:[{id:'subject',description:'The subject requested by the user'}],shots:[{id:'shot',start:0,end:2,cameraRef:'camera',purpose:'Establish the action',subjects:['subject'],action:'Cross the frame',framing:'Wide',movement:'Still'}],criteria:[{id:'structure',description:'Requested timeline and camera',kind:'structural',required:true,shotIds:['shot']},{id:'visible',description:'Subject remains visible',kind:'visual',required:true,shotIds:['shot']},{id:'motion',description:'Subject moves across time',kind:'motion',required:true,shotIds:['shot']}]});
const scene=()=>({entities:[{id:'camera',kind:'camera',state:{camera:{aspect:16/9}}},{id:'timeline',kind:'timeline',state:{timeline:{duration:2,shots:[{cameraId:'camera',start:0,end:2}]}}}]});
async function setup(t){
 const base=path.resolve('test-output','coding-todo');await fs.mkdir(base,{recursive:true});
 const dir=await fs.mkdtemp(path.join(base,'run-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const events=[],ctx={dir,runId:'run-1',emit:event=>events.push(event)},todo=await CodingTodo.open(ctx);
 await todo.apply({op:'set_plan',requestId:'plan',plan:plan()});return {todo,dir,ctx,events};
}
async function evidence(todo,{target='build',sourceHash='source-a',taskId='build-1',times=[0,1,2],json=scene()}={}){
 const key={sourceHash,baselineRevision:'base-1',taskId},result=await (target==='build'?todo.registerBuild({...key,json}):todo.registerDraft({...key,json}));
 const frames=await todo.registerFrames({...key,target,frames:times.map(time=>({camera_id:'camera',time,image_url:`/evidence/${target}-${time}.png`,width:1280,height:720}))});
 return {result,frames,key};
}
async function pass(todo,e,id='pass',{tasks=true}={}){
 const result=await todo.apply({op:'record_reviews',requestId:id,reviews:[{criterionId:'structure',verdict:'pass',evidenceIds:[e.result.id],observation:'Timeline and camera match the requested settings.'},{criterionId:'visible',verdict:'pass',evidenceIds:[e.frames[1]?.id??e.frames[0].id],observation:'The subject is visible in the shot.'},{criterionId:'motion',verdict:'pass',evidenceIds:e.frames.map(f=>f.id),observation:'Distinct sampled times show the intended movement.'}]});
 if(!tasks)return result;
 return todo.apply({op:'update_tasks',requestId:`${id}:tasks`,tasks:[
  {id:'implement-result',title:'Implement the requested source',kind:'implement',status:'completed',evidenceIds:[e.result.id]},
  {id:'review-result',title:'Inspect required results',kind:'review',status:'completed',dependsOn:['implement-result'],criterionIds:['structure','visible','motion'],evidenceIds:e.frames.map(frame=>frame.id)},
 ]});
}

test('one accepted exported build is sufficient and survives reopening',async t=>{
 const {todo,ctx,events}=await setup(t),e=await evidence(todo);await pass(todo,e);
 assert.equal(todo.ready().ready,true);await todo.finish('completed','Verified current delivery');
 const reopened=await CodingTodo.open(ctx);assert.equal(reopened.ready().ready,true);assert.equal(reopened.snapshot().outcome,'completed');
 assert.ok(events.some(event=>event.type==='DIRECTOR_STATE'&&event.state.acceptance.ready));
});

test('a completed inspection can record failure and is not rolled back by a later task error',async t=>{
 const {todo,dir}=await setup(t),e=await evidence(todo);
 await todo.apply({op:'record_reviews',requestId:'failed-view',reviews:[{criterionId:'visible',verdict:'fail',evidenceIds:[e.frames[1].id],observation:'An object blocks the subject.'}]});
 await todo.apply({op:'update_tasks',requestId:'review-done',tasks:[{id:'inspect',title:'Inspect visibility',kind:'review',status:'completed',criterionIds:['visible'],evidenceIds:[e.frames[1].id]}]});
 assert.equal(todo.snapshot().tasks[0].status,'completed');assert.equal(todo.ready().ready,false);
 await assert.rejects(todo.apply({op:'update_tasks',requestId:'bad-dependency',tasks:[{id:'fix',title:'Correct visibility',kind:'implement',status:'completed',dependsOn:['missing']}]}),/Unknown dependency/);
 const persisted=JSON.parse(await fs.readFile(path.join(dir,'workspace','agent-state.json'),'utf8'));
 assert.equal(persisted.reviews[0].verdict,'fail');assert.equal(persisted.tasks.length,1);
});

test('draft checks can guide review but cannot certify exported delivery',async t=>{
 const {todo}=await setup(t),draft=await evidence(todo,{target:'draft'});await pass(todo,draft,'draft-pass');assert.equal(todo.ready().ready,false);
 const build=await evidence(todo);assert.equal(todo.ready().ready,false,'source preview evidence does not certify the GLB');
 await pass(todo,build,'build-pass');assert.equal(todo.ready().ready,true);
});

test('editing source and replacing a build invalidate old acceptance',async t=>{
 const {todo}=await setup(t),first=await evidence(todo);await pass(todo,first);assert.equal(todo.ready().ready,true);
 await todo.noteSource({sourceHash:'source-b',baselineRevision:'base-1'});assert.equal(todo.ready().ready,false);
 await assert.rejects(todo.registerFrames({...first.key,target:'build',frames:[{camera_id:'camera',time:1}]}),/current source/);
 const second=await evidence(todo,{sourceHash:'source-b',taskId:'build-2'});assert.equal(todo.ready().ready,false);
 await pass(todo,second,'second-pass');assert.equal(todo.ready().ready,true);
 await evidence(todo,{sourceHash:'source-b',taskId:'build-3'});assert.equal(todo.ready().ready,false,'even identical source does not certify a different export');
});

test('motion acceptance requires distinct current times for every relevant shot',async t=>{
 const {todo}=await setup(t),e=await evidence(todo,{times:[1,1]});
 await assert.rejects(pass(todo,e),/Insufficient current evidence/);assert.equal(todo.snapshot().reviews.length,0);
 const [extra]=await todo.registerFrames({...e.key,target:'build',frames:[{camera_id:'camera',time:2}]});
 e.frames.push(extra);await pass(todo,e,'motion-complete');assert.equal(todo.ready().ready,false,'final delivery still requires start coverage');
 await todo.registerFrames({...e.key,target:'build',frames:[{camera_id:'camera',time:0}]});assert.equal(todo.ready().ready,true);
});

test('server evidence IDs cannot be invented and model-supplied paths are rejected',async t=>{
 const {todo}=await setup(t);
 await assert.rejects(todo.apply({op:'record_reviews',requestId:'fake',reviews:[{criterionId:'visible',verdict:'pass',evidenceIds:['invented'],observation:'Looks correct'}]}),/Unknown server evidence/);
 assert.equal(codingTodoSchema.safeParse({op:'record_reviews',requestId:'path',reviews:[{criterionId:'visible',verdict:'pass',evidenceIds:[],observation:'Looks correct',imagePath:'fake.png'}]}).success,false);
});

test('exported timing, camera and aspect mismatches block structural acceptance',async t=>{
 const {todo}=await setup(t),json=scene();json.entities[0].state.camera.aspect=1;json.entities[1].state.timeline.duration=3;
 const e=await evidence(todo,{json});assert.ok(e.result.checks.some(c=>!c.pass));
 await assert.rejects(pass(todo,e),/Structural checks/);assert.equal(todo.ready().ready,false);
});

test('task dependency cycles and premature completion are atomic errors',async t=>{
 const {todo}=await setup(t);
 await todo.apply({op:'update_tasks',requestId:'pending',tasks:[{id:'plan',title:'Confirm plan',kind:'plan',status:'pending'}]});
 await assert.rejects(todo.apply({op:'update_tasks',requestId:'premature',tasks:[{id:'build',title:'Build',kind:'implement',status:'completed',dependsOn:['plan']}]}),/Complete dependencies/);
 assert.equal(todo.snapshot().tasks.length,1);
 await assert.rejects(todo.apply({op:'update_tasks',requestId:'cycle',tasks:[{id:'a',title:'A',kind:'plan',status:'pending',dependsOn:['b']},{id:'b',title:'B',kind:'plan',status:'pending',dependsOn:['a']}]}),/cycle/);
 assert.equal(todo.snapshot().tasks.length,1);
});

test('plan revisions clear acceptance and new runs retain only prior-plan context',async t=>{
 const {todo,ctx}=await setup(t),e=await evidence(todo);await pass(todo,e);
 await todo.apply({op:'set_plan',requestId:'replan',plan:plan()});assert.equal(todo.ready().ready,false);assert.equal(todo.snapshot().reviews.length,0);assert.equal(todo.snapshot().planRevision,2);
 const next=await CodingTodo.open({...ctx,runId:'run-2'});assert.equal(next.snapshot().plan,null);assert.equal(next.snapshot().priorPlan.intent,plan().intent);assert.equal(next.snapshot().evidence.length,0);assert.equal(next.ready().ready,false);
});

test('idempotent mutations tolerate response retries but reject reused IDs and stale revisions',async t=>{
 const {todo}=await setup(t),args={op:'update_tasks',requestId:'task',expectedRevision:todo.snapshot().revision,tasks:[{id:'plan',title:'Confirm plan',kind:'plan',status:'completed'}]};
 const result=await todo.apply(args);assert.equal((await todo.apply(args)).revision,result.revision);
 await assert.rejects(todo.apply({...args,tasks:[{...args.tasks[0],title:'Different'}]}),/different contents/);
 await assert.rejects(todo.apply({...args,requestId:'new'}),/revision conflict/);
});

test('noncontiguous and ambiguous plans are rejected without replacing valid state',async t=>{
 const {todo}=await setup(t),bad=plan();bad.shots[0].start=.01;
 await assert.rejects(todo.apply({op:'set_plan',requestId:'gap',plan:bad}),/contiguous/);
 const duplicate=plan();duplicate.criteria.push(duplicate.criteria[0]);
 await assert.rejects(todo.apply({op:'set_plan',requestId:'duplicate',plan:duplicate}),/Duplicate/);
 assert.equal(todo.snapshot().planRevision,1);
});

test('an unverified inspection is retained and completion cannot conceal unresolved criteria',async t=>{
 const {todo}=await setup(t);await todo.apply({op:'record_reviews',requestId:'unknown',reviews:[{criterionId:'motion',verdict:'unverified',observation:'No usable motion preview yet'}]});
 await todo.apply({op:'update_tasks',requestId:'inspection',tasks:[{id:'inspect',title:'Attempt motion review',kind:'review',status:'completed',criterionIds:['motion']} ]});
 assert.equal(todo.snapshot().tasks[0].status,'completed');await assert.rejects(todo.finish('completed'),/acceptance/);
 await todo.finish('partial','Motion remains unverified');assert.equal(todo.snapshot().outcome,'partial');assert.equal(todo.snapshot().reviews[0].verdict,'unverified');
});

test('unfinished work blocks delivery while optional cancellation retains required criteria',async t=>{
 const {todo}=await setup(t),e=await evidence(todo);await pass(todo,e);
 await todo.apply({op:'update_tasks',requestId:'polish',tasks:[{id:'polish',title:'Optional detail',kind:'implement',status:'pending'}]});assert.equal(todo.ready().ready,false);
 await todo.apply({op:'update_tasks',requestId:'cancel-polish',tasks:[{id:'polish',title:'Optional detail',kind:'implement',status:'cancelled',note:'Optional polish omitted to preserve the requested delivery.'}]});assert.equal(todo.ready().ready,true);
 await todo.finish('accepted');assert.equal(todo.snapshot().outcome,'accepted');
});

test('replanning cannot discard required criteria or explicit constraints',async t=>{
 const {todo}=await setup(t),first=plan();first.constraints=[{id:'distance',description:'Keep the requested distance'}];
 await todo.apply({op:'set_plan',requestId:'constraint',plan:first});
 const weaker=plan();weaker.criteria[2].required=false;
 await assert.rejects(todo.apply({op:'set_plan',requestId:'weaken',plan:weaker}),/Required criterion/);
 await assert.rejects(todo.apply({op:'set_plan',requestId:'remove-constraint',plan:plan()}),/Required constraint/);
});

test('explicit generation settings constrain the plan and auto duration remains flexible',async t=>{
 const {ctx}=await setup(t),configured=await CodingTodo.open({...ctx,runId:'settings',generationSettings:{durationSeconds:8,aspectRatio:'9:16'}});
 await assert.rejects(configured.apply({op:'set_plan',requestId:'wrong',plan:plan()}),/aspect ratio/);
 const p=plan();p.aspectRatio='9:16';await assert.rejects(configured.apply({op:'set_plan',requestId:'wrong-duration',plan:p}),/duration/);
 const auto=await CodingTodo.open({...ctx,runId:'auto',generationSettings:{durationSeconds:'auto',aspectRatio:'16:9'}});
 await auto.apply({op:'set_plan',requestId:'auto-plan',plan:plan()});assert.equal(auto.snapshot().plan.duration,2);
});

test('sampling includes both sides of cuts and final shot coverage',()=>{
 const p=plan();p.shots=[{...p.shots[0],end:1},{...p.shots[0],id:'second',start:1,cameraRef:'insert'}];
 const samples=requiredFrames(p);assert.ok(samples.some(s=>s.camera_id==='camera'&&Math.abs(s.time-(1-1/30))<1e-6));assert.ok(samples.some(s=>s.camera_id==='insert'&&s.time===1));assert.ok(samples.some(s=>s.camera_id==='insert'&&s.time===2));
});

test('source corrections do not prevent adding work after an earlier implementation completed',async t=>{
 const {todo}=await setup(t),e=await evidence(todo);
 await todo.apply({op:'update_tasks',requestId:'first-implementation',tasks:[{id:'first',title:'Implement first draft',kind:'implement',status:'completed',evidenceIds:[e.result.id]}]});
 await todo.noteSource({sourceHash:'source-b',baselineRevision:'base-1'});
 await todo.apply({op:'update_tasks',requestId:'correction',tasks:[{id:'fix',title:'Correct the failed view',kind:'implement',status:'in_progress',dependsOn:['first']}]});
 assert.equal(todo.snapshot().tasks.find(t=>t.id==='first').status,'completed');assert.equal(todo.ready().ready,false);
});

test('implementation tasks accept current draft metadata and rendered frames without erasing failed inspections',async t=>{
 const {todo}=await setup(t),e=await evidence(todo,{target:'draft'});
 await todo.apply({op:'record_reviews',requestId:'motion-failed',reviews:[{criterionId:'motion',verdict:'fail',evidenceIds:e.frames.map(frame=>frame.id),observation:'The requested movement is not yet readable.'}]});
 await todo.apply({op:'update_tasks',requestId:'implementation-results',tasks:[
  {id:'t-impl-scene',title:'Create the scene source',kind:'implement',status:'completed',evidenceIds:[e.result.id]},
  {id:'t-impl-motion',title:'Implement and render the motion',kind:'implement',status:'completed',dependsOn:['t-impl-scene'],evidenceIds:e.frames.map(frame=>frame.id)},
 ]});
 assert.deepEqual(todo.snapshot().tasks.map(task=>task.status),['completed','completed']);
 assert.equal(todo.snapshot().reviews.find(review=>review.criterionId==='motion').verdict,'fail');
 assert.equal(todo.ready().ready,false,'source implementation and failed inspection cannot certify delivery');
 await todo.noteSource({sourceHash:'source-b',baselineRevision:'base-1'});
 await assert.rejects(todo.apply({op:'update_tasks',requestId:'stale-motion',tasks:[{id:'t-impl-correction',title:'Correct the motion',kind:'implement',status:'completed',evidenceIds:e.frames.map(frame=>frame.id)}]}),error=>{
  assert.match(error.message,/t-impl-correction/);assert.match(error.message,/draft, build or rendered frame evidence/);assert.match(error.message,/preview_3D_scene/);assert.match(error.message,/Available current evidence: none/);return true;
 });
 assert.equal(todo.snapshot().reviews.find(review=>review.criterionId==='motion').verdict,'fail');
});

test('implementation may close using an actual current exported frame',async t=>{
 const {todo}=await setup(t),e=await evidence(todo);
 await todo.apply({op:'update_tasks',requestId:'built-frame',tasks:[{id:'t-build-frame',title:'Render the implemented action',kind:'implement',status:'completed',evidenceIds:[e.frames[1].id]}]});
 assert.equal(todo.snapshot().tasks[0].status,'completed');assert.equal(todo.ready().ready,false,'frame-backed task closure still requires final criterion acceptance');
});

test('review completion errors identify the task and missing criterion observations with a recovery action',async t=>{
 const {todo}=await setup(t);
 await todo.apply({op:'record_reviews',requestId:'motion-unverified',reviews:[{criterionId:'motion',verdict:'unverified',observation:'Motion could not be inspected yet.'}]});
 await assert.rejects(todo.apply({op:'update_tasks',requestId:'review-missing',tasks:[{id:'t-review-action',title:'Inspect the action',kind:'review',status:'completed',criterionIds:['visible','motion']}]}),error=>{
  assert.match(error.message,/Task t-review-action/);assert.match(error.message,/criteria visible\./);assert.match(error.message,/record_reviews/);assert.match(error.message,/pass, fail or unverified/);return true;
 });
 assert.equal(todo.snapshot().reviews[0].verdict,'unverified');
 await assert.rejects(todo.apply({op:'update_tasks',requestId:'review-no-criteria',tasks:[{id:'t-review-empty',title:'Inspect the result',kind:'review',status:'completed'}]}),/t-review-empty.*no criterionIds supplied.*record_reviews/);
});

test('passing current reviews and frames cannot bypass an empty task list',async t=>{
 const {todo}=await setup(t),e=await evidence(todo);await pass(todo,e,'reviews-only',{tasks:false});
 assert.deepEqual(todo.snapshot().tasks,[]);assert.equal(todo.snapshot().reviews.length,3);
 const acceptance=todo.ready();assert.equal(acceptance.ready,false);
 assert.ok(acceptance.reasons.some(reason=>reason.includes('No completed implementation task')));
 assert.ok(acceptance.reasons.some(reason=>reason.includes('review task for required criterion: motion')));
 await assert.rejects(todo.finish('accepted'),/acceptance/);
});

test('completed review tasks must cover every required criterion and failure still blocks acceptance',async t=>{
 const {todo}=await setup(t),e=await evidence(todo);await pass(todo,e,'reviews',{tasks:false});
 await todo.apply({op:'update_tasks',requestId:'partial-task-coverage',tasks:[
  {id:'implemented',title:'Implement the source',kind:'implement',status:'completed',evidenceIds:[e.frames[1].id]},
  {id:'review-image',title:'Inspect structure and image',kind:'review',status:'completed',criterionIds:['structure','visible']},
 ]});
 assert.equal(todo.ready().ready,false);assert.ok(todo.ready().reasons.some(reason=>reason.includes('review task for required criterion: motion')));
 await todo.apply({op:'record_reviews',requestId:'motion-problem',reviews:[{criterionId:'motion',verdict:'fail',evidenceIds:e.frames.map(frame=>frame.id),observation:'The motion inspection found a failure.'}]});
 await todo.apply({op:'update_tasks',requestId:'motion-inspected',tasks:[{id:'review-action',title:'Inspect the action',kind:'review',status:'completed',criterionIds:['motion']}]});
 assert.equal(todo.snapshot().tasks.find(task=>task.id==='review-action').status,'completed');
 assert.equal(todo.ready().ready,false);assert.ok(todo.ready().reasons.some(reason=>reason==='Unaccepted criterion: motion'));
 assert.ok(!todo.ready().reasons.some(reason=>reason.includes('No completed review task')));
 await pass(todo,e,'motion-fixed',{tasks:false});assert.equal(todo.ready().ready,true);
});

test('historical completed work needs current source proof before a new delivery can pass',async t=>{
 const {todo}=await setup(t),first=await evidence(todo);await pass(todo,first);assert.equal(todo.ready().ready,true);
 await todo.noteSource({sourceHash:'source-b',baselineRevision:'base-1'});
 const second=await evidence(todo,{sourceHash:'source-b',taskId:'build-2'});await pass(todo,second,'new-reviews',{tasks:false});
 assert.equal(todo.snapshot().tasks.find(task=>task.id==='implement-result').status,'completed','earlier completed work remains historical');
 assert.equal(todo.ready().ready,false);assert.ok(todo.ready().reasons.some(reason=>reason.includes('No completed implementation task with current source evidence')));
 await todo.apply({op:'update_tasks',requestId:'current-proof',tasks:[{id:'implement-result',title:'Implement the requested source',kind:'implement',status:'completed',evidenceIds:[second.frames[1].id]}]});
 assert.equal(todo.ready().ready,true);
});

test('rejected motion review identifies missing current camera times and can recover without weakening coverage',async t=>{
 const {todo}=await setup(t),old=await evidence(todo,{target:'draft'});
 const current=await evidence(todo,{target:'draft',sourceHash:'source-b',times:[1]});
 const reviews=[{criterionId:'visible',verdict:'pass',evidenceIds:[current.frames[0].id],observation:'The current image shows the subject.'},{criterionId:'motion',verdict:'pass',evidenceIds:[old.frames[0].id,current.frames[0].id],observation:'Check the movement.'}];
 await assert.rejects(todo.apply({op:'record_reviews',requestId:'insufficient-motion',reviews}),error=>{
  assert.match(error.message,/motion/);assert.match(error.message,/shot: camera camera, time range \[0, 2\], needs 2 distinct current frame times; linked 1 \(1\)/);
  assert.match(error.message,/1 linked evidence record\(s\) are stale/);assert.match(error.message,/preview_3D_scene/);assert.match(error.message,/No reviews from this request were saved/);return true;
 });
 assert.equal(todo.snapshot().reviews.length,0,'a rejected batch must not silently partially save');
 const [second]=await todo.registerFrames({...current.key,target:'draft',frames:[{camera_id:'camera',time:2}]});
 reviews[1].evidenceIds=[current.frames[0].id,second.id];
 await todo.apply({op:'record_reviews',requestId:'recovered-motion',reviews});
 assert.equal(todo.snapshot().reviews.find(review=>review.criterionId==='motion').verdict,'pass');
 assert.equal(todo.ready().ready,false,'recovering a draft review cannot certify delivery');
});
