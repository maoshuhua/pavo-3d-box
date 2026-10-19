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

const bounded=(value,fallback,min,max)=>Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max?Number(value):fallback;

// Independent cost categories make a fast draft preview different from a full
// export, and a failed export different from a successful build.
export function executionLimits(env=process.env){
 return {
  tools:bounded(env.AGENT_MAX_TOOL_CALLS,100,8,1000),
  draftFrames:bounded(env.AGENT_MAX_DRAFT_FRAMES,48,1,240),
  deliveryFrames:bounded(env.AGENT_MAX_DELIVERY_FRAMES,36,1,120),
  builds:bounded(env.AGENT_MAX_BUILD_PASSES,6,1,30),
  buildFailures:bounded(env.AGENT_MAX_BUILD_FAILURES,3,1,20),
  consecutiveErrors:bounded(env.AGENT_MAX_CONSECUTIVE_ERRORS,3,1,20),
  totalMs:bounded(env.AGENT_GENERATION_TIMEOUT_MS,720000,1000,3600000),
 };
}

export function createExecutionBudget(overrides={},clock=Date.now){
 const limits={...executionLimits({}),...overrides};
 for(const [key,value]of Object.entries(limits))if(!Number.isSafeInteger(value)||value<1)throw Error(`Invalid execution budget: ${key}`);
 const used=Object.fromEntries(Object.keys(limits).filter(key=>key!=='totalMs').map(key=>[key,0])),started=clock();
 const status=()=>({limits:{...limits},used:{...used},elapsedMs:Math.max(0,clock()-started),remainingMs:Math.max(0,limits.totalMs-(clock()-started))});
 const check=(kind,amount=1)=>{
  if(kind!==undefined&&!(kind in used))throw Error(`Unknown execution budget: ${kind}`);
  if(!Number.isSafeInteger(amount)||amount<0)throw Error('Budget amount must be a non-negative integer');
  const current=status();
  const reason=current.elapsedMs>=limits.totalMs?'totalMs':kind!==undefined&&used[kind]+amount>limits[kind]?kind:null;
  return {allowed:reason===null,reason,...current};
 };
 const consume=(kind,amount=1)=>{const result=check(kind,amount);if(result.allowed)used[kind]+=amount;return {...result,...status()};};
 return {limits,status,check,consume,resetErrors(){used.consecutiveErrors=0;}};
}
