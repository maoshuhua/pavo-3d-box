import test from 'node:test';
import assert from 'node:assert/strict';
import {tool} from '@langchain/core/tools';
import {convertToOpenAITool} from '@langchain/core/utils/function_calling';
import {codingTodoToolSchema,codingTodoSchema} from '../server/codingTodo.js';
test('todo wire schema has an object root while operations stay strictly validated',()=>{
 const definition=convertToOpenAITool(tool(async()=>'',{name:'coding_todo_write',description:'Directing state',schema:codingTodoToolSchema}));
 assert.equal(definition.function.parameters.type,'object');
 assert(definition.function.parameters.properties.op);
 assert(codingTodoSchema.safeParse({op:'read'}).success);
 assert(!codingTodoSchema.safeParse({op:'set_plan'}).success);
 assert(!codingTodoSchema.safeParse({op:'record_reviews',requestId:'review'}).success);
});
