import {HumanMessage,ToolMessage} from '@langchain/core/messages';

export const conversationSummaryPrompt=`你负责压缩三维预演制作对话。请用中文生成简洁、准确、可继续执行的摘要。
保留用户最新意图、明确约束、关键决定、已完成工作、当前源码与交付版本、真实证据 ID、失败观察、剩余任务和下一步。
区分已执行、已通过、失败与未验证；不能把历史版本或源码草稿当作当前 GLB 验收。
工具名、文件路径、代码 API、字段名、枚举值和稳定 ID 保持原样。省略重复过程和无关细节，不编造结果。

待压缩的对话：
{conversation}

中文摘要：`;

// 只转换框架生成的固定包装文字，不翻译用户原文、代码或原始工具诊断。
export function localizeFrameworkMessage(message){
 if(typeof message.content!=='string'){
  if(!Array.isArray(message.content)||!message.additional_kwargs?.lc_evicted_to)return message;
  let changed=false;
  const content=message.content.map(block=>{
   if(block.type!=='text')return block;
   const translated=localizeFrameworkMessage(new HumanMessage({...message,content:block.text})).content;
   if(translated===block.text)return block;
   changed=true;return {...block,text:translated};
  });
  return changed?new HumanMessage({...message,content}):message;
 }
 let content=message.content;
 if(message.additional_kwargs?.lc_source==='summarization'){
  content=content
   .replace('You are in the middle of a conversation that has been summarized.','当前对话的较早内容已压缩。')
   .replace(/The full conversation history has been saved to (.+?) should you need to refer back to it for details\./,'完整对话历史已保存至 $1，需要细节时可回查。')
   .replace('A condensed summary follows:','以下是压缩摘要：')
   .replace('Here is a summary of the conversation to date:','以下是当前对话摘要：');
 }
 if(message.additional_kwargs?.lc_evicted_to){
  content=content
   .replace('Message content too large and was saved to the filesystem at:','消息内容较长，完整内容已保存至：')
   .replace('You can read the full content using the read_file tool with pagination (offset and limit parameters).','可使用 read_file 工具的 offset 和 limit 参数分页读取完整内容。')
   .replace('Here is a preview showing the head and tail of the content:','以下是内容开头与结尾的预览：');
 }
 if(message.getType?.()==='tool'){
  content=content.replace(/^Tool call (\S+) with id (\S+) was cancelled - another message came in before it could be completed\.$/,'工具调用 $1（ID：$2）尚未完成时收到新消息，本次调用已取消。');
  if(content.startsWith('Tool result too large,'))content=content
   .replace(/Tool result too large, the result of this tool call (.+?) was saved in the filesystem at this path: (.+)/,'工具结果较长，调用 $1 的完整结果已保存至：$2')
   .replace('You can read the result from the filesystem by using the read_file tool, but make sure to only read part of the result at a time.','可使用 read_file 从文件读取结果，每次只读一部分。')
   .replace('You can do this by specifying an offset and limit in the read_file tool call.','调用 read_file 时指定 offset 和 limit。')
   .replace('For example, to read the first 100 lines, you can use the read_file tool with offset=0 and limit=100.','例如读取前 100 行时设置 offset=0、limit=100。')
   .replace(/Here is a preview showing the head and tail of the result \(lines of the form\s+\.\.\. \[N lines truncated\] \.\.\.\s+indicate omitted lines in the middle of the content\):/,'以下是结果开头与结尾的预览，中间省略的行会标明数量：')
   .replace('Tool result too large, but the result could not be saved to the filesystem:','工具结果较长，但无法保存到文件：');
 }
 if(content===message.content)return message;
 return message.getType?.()==='tool'?new ToolMessage({...message,content}):new HumanMessage({...message,content});
}
