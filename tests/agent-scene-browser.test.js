import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';

test('real viewport preserves objects on GLB parse failure and rolls back a valid server scene that fails to apply',{timeout:60000},async()=>{
  let vite,browser;
  try{
    vite=await createServer({server:{port:0,host:'127.0.0.1'},logLevel:'error',plugins:[{name:'agent-scene-test-page',configureServer(server){server.middlewares.use('/agent-scene-test',(_,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="host" style="width:640px;height:480px"></div><script type="module">import {createViewport} from "/src/glb.js"; import {commitAgentScene,stageAgentSnapshot} from "/src/agentSceneCommit.js"; import {createLocalAutosave,readLocalProject} from "/src/localProject.js"; Object.assign(window,{createViewport,commitAgentScene,stageAgentSnapshot,createLocalAutosave,readLocalProject});window.viewer=createViewport(document.querySelector("#host"));</script>');});}}]});
    await vite.listen();
    let executablePath;for(const candidate of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'])try{await fs.access(candidate);executablePath=candidate;break;}catch{}
    browser=await chromium.launch({headless:true,executablePath,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/agent-scene-test`);
    await page.waitForFunction(()=>!!window.viewer);
    const parsed=await page.evaluate(async()=>{
      const viewer=window.viewer,id=viewer.addElement('box'),object=viewer.find(id);let disposals=0,error;
      object.geometry.addEventListener('dispose',()=>disposals++);
      try{await viewer.replaceAgentScene({bytes:new TextEncoder().encode('invalid GLB').buffer});}catch(cause){error=cause.message;}
      return {error,preserved:viewer.find(id)===object,disposals};
    });
    assert.ok(parsed.error);assert.equal(parsed.preserved,true);assert.equal(parsed.disposals,0);
    const rollback=await page.evaluate(async()=>{
      const viewer=window.viewer,id=crypto.randomUUID(),commits=[];
      const save=window.createLocalAutosave(viewer,()=>{},{projectId:id,onSnapshot:async snapshot=>commits.push(snapshot.revision)});
      const createStaging=()=>{const host=document.createElement('div');host.style.cssText='width:640px;height:480px';document.body.append(host);const viewport=window.createViewport(host);return {viewport,dispose(){viewport.dispose();host.remove();}};};
      try{
        save.changed();await save.flush();viewer.addElement('camera');save.changed();
        const release=await save.pause();release();
        const before=await window.readLocalProject(id),ids=viewer.exportSceneJson().entities.map(e=>e.id).sort();
        const source=createStaging();let candidate;
        try{source.viewport.addElement('sphere');candidate={revision:10,bytes:await (await source.viewport.exportSceneGlb()).blob.arrayBuffer(),json:source.viewport.exportSceneJson()};}finally{source.dispose();}
        const restore=viewer.restoreProject;let fail=true;
        viewer.restoreProject=async function(...args){await restore.apply(this,args);if(fail){fail=false;throw Error('injected after valid restore');}};
        const controller=new AbortController();let failure;
        try{await window.commitAgentScene({editor:viewer,autosave:save,signal:controller.signal,serverCommitted:true,prepare:()=>window.stageAgentSnapshot(candidate,[],createStaging,controller.signal)});}catch(cause){failure={blocked:cause.agentApplyBlocked,cause:cause.cause?.message};}
        viewer.restoreProject=restore;
        const after=await window.readLocalProject(id);
        let blocked=false;try{await save.flush();}catch{blocked=true;}
        return {failure,ids,restoredIds:viewer.exportSceneJson().entities.map(e=>e.id).sort(),snapshotRevision:after.snapshot.revision,journalRevision:after.journal.revision,originalSnapshot:before.snapshot.revision,originalJournal:before.journal.revision,commits,blocked};
      }finally{save.dispose();}
    });
    assert.equal(rollback.failure.blocked,true);assert.match(rollback.failure.cause,/after valid restore/);
    assert.deepEqual(rollback.restoredIds,rollback.ids);assert.equal(rollback.snapshotRevision,rollback.originalSnapshot);assert.equal(rollback.journalRevision,rollback.originalJournal);assert.deepEqual(rollback.commits,[1]);assert.equal(rollback.blocked,true);
  }finally{await browser?.close();await vite?.close();}
});
