import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeUploadName} from '../server/filename.js';import {createFloatingLayout} from '../src/agentFloatingLayout.js';import {StudioDatabase} from '../server/studioDatabase.js';
const overlaps=(a,b)=>a&&b&&a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;
test('UTF-8 multipart names and existing Chinese / Latin names remain readable after history restoration',()=>{
 const name='运镜轨迹-验收😀.png',garbled=Buffer.from(name,'utf8').toString('latin1');assert.equal(normalizeUploadName(garbled),name);assert.equal(normalizeUploadName(name),name);assert.equal(normalizeUploadName('café.doc'),'café.doc');
 const db=new StudioDatabase(':memory:');try{const project=db.create({name:'filename test'}).studioMeta.uuid;const session=db.createSession({projectId:project});db.addMessage(session,{id:'unicode-message',role:'user',text:'ref',attachments:[{name:garbled,kind:'image',url:'/local-assets/test'}]});assert.equal(db.history(project,session).messages[0].attachments[0].name,name);}finally{db.close()}
});
test('composer and PiP avoid each other after either one changes anchor, including narrow layouts',()=>{
 for(const width of [480,720,1400])for(const side of ['left','right'])for(const composerLast of [true,false]){const l=createFloatingLayout();l.setStage(width,800);l.setComposer({width:Math.min(480,width-32),height:420,minimumHeight:180,visible:true,anchor:'center'});l.setPipVisible(true);if(composerLast){l.setPipAnchor({horizontal:side,vertical:'bottom'});l.setComposer({anchor:side});}else{l.setComposer({anchor:side});l.setPipAnchor({horizontal:side,vertical:'bottom'});}const s=l.getSnapshot();assert(!overlaps(s.composer,s.pip),`${width}/${side}/${composerLast}`);assert(s.pip.left>=0);assert(s.composer.top>=58);assert(s.pip.top>=58);assert(s.composer.left+s.composer.width<=width);}
});
