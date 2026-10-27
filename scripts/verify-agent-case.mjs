// Generic real-model smoke runner. Briefs and outputs are test inputs, never production prompts.
import '../server/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createServer} from '../server/index.js';
import {StudioDatabase} from '../server/studioDatabase.js';
import {resolveAgentModel} from '../server/agentModels.js';
import {closeRenderer} from '../server/renderService.js';
import {runDeepAgent} from '../server/agent.js';
const briefFile=process.argv[2];if(!briefFile)throw Error('请传入包含 prompt 和 generationSettings 的测试 JSON');
const brief=JSON.parse(await fs.readFile(briefFile,'utf8'));
if(typeof brief.prompt!=='string'||!brief.prompt.trim())throw Error('测试提示词不能为空');
const output=path.resolve(brief.output||'output/playwright/agent-case-'+Date.now());await fs.mkdir(output,{recursive:true});
const execution=[],modelBatches=[];
const database=new StudioDatabase(':memory:'),{app}=createServer({database,runAgent:ctx=>runDeepAgent({...ctx,
 onToolExecution:event=>execution.push(event),
 onModelToolBatch:calls=>{modelBatches.push(calls.map(c=>({id:c.id,name:c.name,path:c.args?.path})));}
})}),server=http.createServer(app);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,projectId='effects-'+crypto.randomUUID(),runId=crypto.randomUUID();
const model=resolveAgentModel(brief.generationSettings?.agentMode);
const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[]}]})),size=Math.ceil(json.length/4)*4;
const glb=Buffer.alloc(20+size,32);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(size,12);glb.writeUInt32LE(0x4e4f534a,16);json.copy(glb,20);
const form=new FormData();form.set('payload',JSON.stringify({projectId,runId,prompt:brief.prompt,generationSettings:brief.generationSettings,sceneJson:{version:1,entities:[],operations:[]}}));form.set('scene',new Blob([glb]),'empty.glb');
const summary={projectId,runId,model,brief,startedAt:new Date().toISOString(),results:[],tools:[],status:'running'};
await fs.writeFile(path.join(output,'run.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({projectId,runId,model}));
try{
 const response=await fetch(base+'/api/agent/run',{method:'POST',body:form});if(!response.ok)throw Error(await response.text());
 const decoder=new TextDecoder();let pending='';
 for await(const bytes of response.body){
  const text=decoder.decode(bytes,{stream:true});await fs.appendFile(path.join(output,'events.sse'),text);pending+=text;
  let newline;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(!line.startsWith('data:'))continue;
   const event=JSON.parse(line.slice(5));
   if(event.type==='TOOL_CALL_START'){summary.tools.push(event.toolCallName);console.log('tool',event.toolCallName);}
   if(event.type==='RESULT'){summary.results.push(event.result);console.log('build',event.result.task_id);}
   if(event.type==='RUN_ERROR'){summary.status='failed';summary.error=event.message;console.log('error',event.message);}
   if(event.type==='RUN_FINISHED'){summary.status='completed';console.log('completed');}
  }
 }
 const result=summary.results.at(-1);
 if(result){for(const [key,file] of [['glb_url','generated.glb'],['collaboration_url','generated.json']]){const r=await fetch(result[key]);if(!r.ok)throw Error('无法读取产物');await fs.writeFile(path.join(output,file),Buffer.from(await r.arrayBuffer()));}}
}finally{summary.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'run.json'),JSON.stringify(summary,null,2));await fs.writeFile(path.join(output,'execution.json'),JSON.stringify({execution,modelBatches},null,2));await closeRenderer();await new Promise(resolve=>server.close(resolve));database.close();}
if(summary.status!=='completed')process.exitCode=1;
