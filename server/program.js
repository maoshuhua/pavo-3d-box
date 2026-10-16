import {getQuickJS} from 'quickjs-emscripten';
import {validateScene} from './sceneSchema.js';

// Generated code gets JSON scene data and Math, not Node, DOM, network or shell.
export async function evaluateProgram(source, context, signal) {
  signal?.throwIfAborted();
  if(Buffer.byteLength(source)>1024*1024)throw Error('Scene program exceeds 1 MiB');
  const QuickJS=await getQuickJS(), runtime=QuickJS.newRuntime();
  runtime.setMemoryLimit(96*1024*1024);runtime.setMaxStackSize(2*1024*1024);
  const deadline=Date.now()+5000;
  runtime.setInterruptHandler(()=>Date.now()>deadline||signal?.aborted);
  const vm=runtime.newContext();
  try {
    const code=`"use strict";\n${source}\n;if(typeof build!=="function")throw Error("Define function build(ctx)"); JSON.stringify(build(${JSON.stringify(context)}));`;
    const result=vm.evalCode(code,'scene.js');
    if(result.error){const error=vm.dump(result.error);result.error.dispose();throw Error(error.message||String(error));}
    try {return validateScene(JSON.parse(vm.getString(result.value)));}
    finally {result.value.dispose();}
  } finally {vm.dispose();runtime.dispose();}
}
