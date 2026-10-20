import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {AIMessage,HumanMessage,ToolMessage} from '@langchain/core/messages';
import {createSummarizationMiddleware,StateBackend} from 'deepagents';
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import {conversationSummaryPrompt,localizeFrameworkMessage} from '../server/agentPrompts.js';
import {createSceneTools} from '../server/tools.js';

test('director, scene contract, tool instructions and schema descriptions use Chinese',async()=>{
 for(const file of ['server/skills/studio-director/SKILL.md','server/scene-api.txt']){
  const text=await fs.readFile(file,'utf8');
  assert.match(text,/中文/);assert.doesNotMatch(text,/\b[A-Za-z]+(?: +[A-Za-z]+){4,}\b/,file);
 }
 assert.match(conversationSummaryPrompt,/中文摘要/);assert.equal(conversationSummaryPrompt.match(/\{conversation\}/g).length,1);
 const tools=createSceneTools({signal:new AbortController().signal,assets:[],emit(){}});
 const inspect=(value)=>{
  if(!value||typeof value!=='object')return;
  if(typeof value.description==='string')assert.match(value.description,/[\u4e00-\u9fff]/,value.description);
  for(const child of Object.values(value))if(typeof child==='object')inspect(child);
 };
 assert.equal(tools.length,8);for(const tool of tools)inspect(convertToOpenAITool(tool));
});

test('framework summaries are localized without changing identity, paths or content',()=>{
 const message=new HumanMessage({id:'summary-1',content:'You are in the middle of a conversation that has been summarized.\nThe full conversation history has been saved to /conversation_history/a.md should you need to refer back to it for details.\nA condensed summary follows:\n<summary>已构建 scene-a，仍需检查 camera-1。</summary>',additional_kwargs:{lc_source:'summarization'},response_metadata:{fixture:true}});
 const localized=localizeFrameworkMessage(message);
 assert.equal(localized.id,message.id);assert.deepEqual(localized.additional_kwargs,message.additional_kwargs);assert.deepEqual(localized.response_metadata,message.response_metadata);
 assert.match(localized.content,/完整对话历史已保存至 \/conversation_history\/a.md/);assert.match(localized.content,/已构建 scene-a，仍需检查 camera-1/);assert.doesNotMatch(localized.content,/You are|The full conversation|A condensed/);
 assert.match(localizeFrameworkMessage(new HumanMessage({content:'Here is a summary of the conversation to date:\n已完成',additional_kwargs:{lc_source:'summarization'}})).content,/以下是当前对话摘要/);
 assert.match(message.content,/You are/,'original checkpoint message must remain unchanged');
});

test('only framework wrappers are translated; user text and tool payloads remain intact',()=>{
 const user=new HumanMessage({content:'Here is a summary of the conversation to date: leave this user quote unchanged'});
 const pixels=new HumanMessage({content:[{type:'text',text:'You are in the middle of a conversation that has been summarized.'},{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]});
 const data=new ToolMessage({content:'{"status":"completed","code":"return SPEC;"}',tool_call_id:'call-data'});
 for(const message of [user,pixels,data])assert.equal(localizeFrameworkMessage(message),message);
 const cancelled=new ToolMessage({id:'cancel',content:'Tool call x_read with id call-1 was cancelled - another message came in before it could be completed.',tool_call_id:'call-1'});
 const localized=localizeFrameworkMessage(cancelled);assert.equal(localized.tool_call_id,'call-1');assert.equal(localized.id,'cancel');assert.match(localized.content,/本次调用已取消/);
 const evicted=new HumanMessage({content:'Message content too large and was saved to the filesystem at: /history/a\nYou can read the full content using the read_file tool with pagination (offset and limit parameters).\nHere is a preview showing the head and tail of the content:\nreturn SPEC;',additional_kwargs:{lc_evicted_to:'/history/a'}});
 assert.match(localizeFrameworkMessage(evicted).content,/消息内容较长/);assert.match(localizeFrameworkMessage(evicted).content,/return SPEC;/);
 const image={type:'image_url',image_url:{url:'data:image/png;base64,fixture'}};
 const multimodal=new HumanMessage({content:[{type:'text',text:evicted.content},image],additional_kwargs:evicted.additional_kwargs});
 const translated=localizeFrameworkMessage(multimodal);assert.match(translated.content[0].text,/消息内容较长/);assert.deepEqual(translated.content[1],image);
});

test('actual framework compression sends Chinese instructions and its restored summary stays readable',async()=>{
 const requests=[],model={async invoke(messages){requests.push(messages);return new AIMessage('已生成可播放场景；接下来检查当前 GLB。');}};
 const middleware=createSummarizationMiddleware({model,backend:runtime=>new StateBackend(runtime),summaryPrompt:conversationSummaryPrompt,trigger:{type:'messages',value:4},keep:{type:'messages',value:1}});
 const messages=[new HumanMessage('创建场景'),new AIMessage('已制定计划'),new HumanMessage('保持原画幅'),new AIMessage('已完成初版'),new HumanMessage('继续检查')];
 let restored;
 await middleware.wrapModelCall({model,messages,state:{messages},tools:[]},async request=>{restored=request.messages.map(localizeFrameworkMessage);return new AIMessage('继续检查。');});
 assert.equal(requests.length,1);assert.match(requests[0][0].content,/你负责压缩三维预演制作对话/);assert.match(requests[0][0].content,/创建场景/);
 assert.match(restored[0].content,/以下是压缩摘要/);assert.match(restored[0].content,/已生成可播放场景/);assert.doesNotMatch(restored[0].content,/You are|The full conversation|A condensed/);
 assert.equal(restored.at(-1).content,'继续检查');
});
