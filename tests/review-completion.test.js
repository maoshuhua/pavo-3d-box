import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewCompletion} from '../server/reviewCompletion.js';

const context=()=>({completedBuilds:3,current:{result:{task_id:'latest'},json:{entities:[{kind:'timeline',state:{timeline:{duration:15,shots:[{cameraId:'main',start:0,end:15}]}}}]}},previewChecks:[0,7.5,15].map(time=>({task_id:'latest',camera_id:'main',time}))});
test('review can finish only after successful builds and real latest-camera coverage',()=>{
 const ctx=context();assert.equal(reviewCompletion(ctx).taskId,'latest');
 ctx.completedBuilds=2;assert.equal(reviewCompletion(ctx),null);
 ctx.completedBuilds=3;assert.equal(reviewCompletion(ctx,4),null);
});
test('old build frames and other camera frames cannot close a new review',()=>{
 const ctx=context();ctx.previewChecks[1].task_id='previous';assert.equal(reviewCompletion(ctx),null);
 ctx.previewChecks[1].task_id='latest';ctx.previewChecks[1].camera_id='overview';assert.equal(reviewCompletion(ctx),null);
});
test('repeated endpoint previews do not count as middle-frame coverage',()=>{
 const ctx=context();ctx.previewChecks[1].time=15;assert.equal(reviewCompletion(ctx),null);
 ctx.previewChecks=[ctx.previewChecks[1]];assert.equal(reviewCompletion(ctx),null);
});

test('multi-camera reviews use the real shot sequence rather than the first camera for the whole film',()=>{
 const ctx=context();ctx.current.json.entities[0].state.timeline={duration:8,shots:[{cameraId:'low',start:0,end:4},{cameraId:'high',start:4,end:8}]};
 ctx.previewChecks=[{task_id:'latest',camera_id:'low',time:0},{task_id:'latest',camera_id:'low',time:4},{task_id:'latest',camera_id:'high',time:8}];
 assert.deepEqual(reviewCompletion(ctx).times,[0,4,8]);
 ctx.previewChecks[2].camera_id='low';assert.equal(reviewCompletion(ctx),null,'an inactive camera cannot pass the final shot');
 ctx.previewChecks[2].camera_id='high';ctx.previewChecks[0].task_id='previous';assert.equal(reviewCompletion(ctx),null,'the latest build must still cover the beginning');
});

test('a short intermediate camera shot must be checked as well',()=>{
 const ctx=context();ctx.current.json.entities[0].state.timeline.shots=[{cameraId:'main',start:0,end:4},{cameraId:'insert',start:4,end:5},{cameraId:'main',start:5,end:15}];
 assert.equal(reviewCompletion(ctx),null);ctx.previewChecks.push({task_id:'latest',camera_id:'insert',time:4.5});assert.ok(reviewCompletion(ctx));
});
