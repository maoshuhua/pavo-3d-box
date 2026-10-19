import test from 'node:test';
import assert from 'node:assert/strict';
import {localAgentAdapter} from '../src/localAgentAdapter.js';
const response=events=>new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
test('transport reconnects from its last event cursor without duplicating streamed text',async()=>{
 const original=globalThis.fetch,requests=[],events=[];let subscriptions=0;
 globalThis.fetch=async(url,options)=>{requests.push(String(url));if(String(url).includes('/events?'))return subscriptions++===0?response([{type:'TEXT_MESSAGE_CONTENT',seq:1,delta:'一'}]):response([{type:'TEXT_MESSAGE_CONTENT',seq:1,delta:'一'},{type:'TEXT_MESSAGE_CONTENT',seq:2,delta:'二'},{type:'RUN_FINISHED',seq:3}]);return Response.json({code:0,data:{status:'running'}});};
 try{await localAgentAdapter.resume({projectId:'p',runId:'r'},{signal:new AbortController().signal,emit:e=>events.push(e)});assert.equal(events.filter(e=>e.type==='TEXT_MESSAGE_CONTENT').map(e=>e.delta).join(''),'一二');assert.ok(requests.some(u=>u.includes('afterSeq=1')));}
 finally{globalThis.fetch=original;}
});
test('lost POST acknowledgement attaches to the existing run, and detaching never sends DELETE',async()=>{
 const original=globalThis.fetch,methods=[];let posts=0;globalThis.fetch=async(url,options={})=>{methods.push(options.method||'GET');if(options.method==='POST'){posts++;throw Error('network dropped after acceptance');}if(String(url).includes('/events?'))return response([{type:'RUN_FINISHED',seq:2}]);return Response.json({code:0,data:{status:'running'}});};
 try{await localAgentAdapter.generate({projectId:'p',runId:'r',prompt:'生成',messages:[],attachments:[],scene:{json:{},bytes:new ArrayBuffer(20)}},{signal:new AbortController().signal,emit:()=>{}});assert.equal(posts,1);assert.ok(!methods.includes('DELETE'));const controller=new AbortController();controller.abort(new DOMException('Detached','AbortError'));await assert.rejects(()=>localAgentAdapter.resume({projectId:'p',runId:'r'},{signal:controller.signal,emit:()=>{}}),/Detached/);assert.ok(!methods.includes('DELETE'));await localAgentAdapter.stop({projectId:'p',runId:'r'});assert.equal(methods.at(-1),'DELETE');}
 finally{globalThis.fetch=original;}
});
