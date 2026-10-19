export const DEFAULT_RECURSION_LIMIT = 500;

export function agentRecursionLimit(value = process.env.AGENT_RECURSION_LIMIT) {
 const limit = Number(value);
 return Number.isSafeInteger(limit) && limit >= 50 && limit <= 5000 ? limit : DEFAULT_RECURSION_LIMIT;
}

// LangGraph checkpoint steps continue across turns. Measure this invocation's
// steps relative to its first model call, reserving room for final graph nodes.
export function createStepBudget(limit) {
 let firstStep, calls = 0;
 const reserve = Math.min(24, Math.floor(limit / 4));
 return step => {
  calls++;
  const hasStep = Number.isSafeInteger(step) && step >= 0;
  if (hasStep && firstStep === undefined) firstStep = step;
  const used = hasStep ? Math.max(0, step - firstStep) : (calls - 1) * 4;
  return {limit, used, exhausted: used >= limit - reserve};
 };
}

export function stepLimitMessage(ctx, limit) {
 return `Agent 本轮已接近 ${limit} 步执行上限，已停止继续调用工具。` +
  (ctx.current?.result ? `最近成功产物 ${ctx.current.result.task_id} 已保留；未完成的修改和检查不能视为通过。` : '本轮尚未生成新的成功产物，原场景已保留。请缩小本轮修改范围后继续。');
}
