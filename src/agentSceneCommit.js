// Validate in an independent viewport before touching the current scene.
export async function stageAgentSnapshot(snapshot, operations, createStaging, signal, normalize=false) {
  signal.throwIfAborted();
  const staging=createStaging();
  try {
    await staging.viewport.replaceAgentScene(snapshot,operations);
    signal.throwIfAborted();
    if(!normalize)return snapshot;
    staging.viewport.flushSceneEdits();
    const json=staging.viewport.exportSceneJson();
    const bytes=await (await staging.viewport.exportSceneGlb(signal)).blob.arrayBuffer();
    signal.throwIfAborted();
    return {...snapshot,bytes,json};
  } finally {staging.dispose();}
}

// Keep the old local snapshot/journal until both the viewport and persistence
// accept the replacement. A server commit must never be rolled back by writing
// the old scene as a newer server revision.
export async function commitAgentScene({editor,autosave,signal,prepare,serverCommitted=false,beforePersist}) {
  const release=await autosave.pause();
  let backup,applying=false,persisting=false;
  try {
    signal.throwIfAborted();
    const snapshot=await prepare();
    signal.throwIfAborted();
    editor.flushSceneEdits();
    const json=editor.exportSceneJson();
    backup={json,bytes:await (await editor.exportSceneGlb(signal)).blob.arrayBuffer()};
    signal.throwIfAborted();
    applying=true;
    await editor.replaceAgentScene(snapshot);
    signal.throwIfAborted();
    beforePersist?.(snapshot);
    persisting=true;
    if(serverCommitted)await autosave.adoptSnapshot(snapshot);
    else await autosave.replaceSnapshot(snapshot);
    // Once persistence succeeds this is an accepted replacement, even if a
    // detach/cancel arrives while the IndexedDB transaction is completing.
    return snapshot;
  } catch(error) {
    let rollbackError;
    if(applying)try {await editor.replaceAgentScene(backup);}catch(cause){rollbackError=cause;}
    if(serverCommitted||persisting||rollbackError){
      const failure=new Error(rollbackError?'场景恢复失败，请重新打开项目后继续编辑。':'场景应用失败，已保留原场景和本地记录。请重新打开项目同步已保存的结果后继续编辑。',{cause:error});
      failure.agentApplyBlocked=true;
      if(rollbackError)failure.rollbackError=rollbackError;
      autosave.suspendWrites(failure);
      throw failure;
    }
    throw error;
  } finally {release();}
}
