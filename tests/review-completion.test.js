import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCompletion} from '../server/reviewCompletion.js';

const context=(ready,completedBuilds=1)=>({completedBuilds,current:{result:{task_id:'latest'}},director:{ready:()=>({ready,taskId:'latest',planRevision:2,reasons:ready?[]:['Unaccepted criterion: motion']})}});

test('one successful build can finish when its director acceptance passes',()=>{
 const result=reviewCompletion(context(true,1));
 assert(result);assert.equal(result.taskId,'latest');
});

test('build count and preview count cannot replace failed director acceptance',()=>{
 const ctx=context(false,100);ctx.previewChecks=[0,1,2,3].map(time=>({task_id:'latest',camera_id:'main',time}));
 assert.equal(reviewCompletion(ctx),null);
});

test('missing director state cannot approve a legacy set of builds or images',()=>{
 const ctx=context(true,3);delete ctx.director;
 ctx.previewChecks=[0,1.5,3].map(time=>({task_id:'latest',camera_id:'main',time}));
 assert.equal(reviewCompletion(ctx),null);
});

test('the acceptance gate is rechecked rather than cached across source revisions',()=>{
 let ready=true;const ctx=context(true);ctx.director.ready=()=>({ready,taskId:'latest',reasons:ready?[]:['No build of the current plan and source']});
 assert(reviewCompletion(ctx));ready=false;assert.equal(reviewCompletion(ctx),null);
});
