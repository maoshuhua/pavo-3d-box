import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFrameAspect,cameraPreviewSize} from '../src/timelineCamera.js';
import {createFloatingLayout} from '../src/agentFloatingLayout.js';

test('preview size fits native aspect in its bounds, including portrait and invalid inputs',()=>{
 for(const aspect of [9/16,1,4/3,16/9,21/9])for(const [w,h] of [[900,600],[160,200],[30,20]]){
  const size=cameraPreviewSize(aspect,w,h);
  assert(Math.abs(size.width/size.height-aspect)<1e-9);
  assert(size.width<=Math.min(260,w)&&size.height<=Math.min(260,h));
 }
 assert.deepEqual(cameraPreviewSize(NaN,900,600),cameraPreviewSize(16/9,900,600));
 assert.deepEqual(cameraPreviewSize(1,-20,200),{width:0,height:0});
 assert.equal(cameraFrameAspect(null,{isOrthographicCamera:true,left:-2,right:2,top:1,bottom:-1,userData:{}}),2);
});

test('PiP keeps its camera aspect after resizing, switching and composer avoidance',()=>{
 for(const aspect of [9/16,1,4/3,16/9,21/9])for(const width of [360,480,720,1400])for(const height of [400,800])for(const side of ['left','right']){
  const layout=createFloatingLayout();layout.setStage(width,height);layout.setPipVisible(true);layout.setPipAspect(aspect);layout.setPipAnchor({horizontal:side,vertical:'bottom'});
  layout.setComposer({width:Math.min(480,width-32),height:420,minimumHeight:180,visible:true,anchor:side});
  const {pip:p,composer:c}=layout.getSnapshot();
  assert(Math.abs(p.width/p.height-aspect)<1e-9);
  assert(p.left>=0&&p.top>=58&&p.left+p.width<=width&&p.top+p.height<=height);
  assert(!(p.left<c.left+c.width&&p.left+p.width>c.left&&p.top<c.top+c.height&&p.top+p.height>c.top));
  layout.setPipAspect(1);assert.equal(layout.getSnapshot().pip.width,layout.getSnapshot().pip.height);
 }
});
