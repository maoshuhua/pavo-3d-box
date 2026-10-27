// Local adapter for libtv's project.save and 2-second dirty/revision loop.
// GLB and collaboration JSON are committed together, never as separate versions.
const DB = "3d-box-local-project";
const KEY = "current";
const MIRROR = "3d-box:pending-scene-v1";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("snapshots", { keyPath: "id" });
      request.result.createObjectStore("journal", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(names, mode, work) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      try {
        result = work(tx);
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () =>
        resolve(typeof result === "function" ? result() : result);
      tx.onabort = tx.onerror = () =>
        reject(tx.error || new Error("本地项目保存失败。"));
    });
  } finally {
    db.close();
  }
}

export async function readLocalProject(projectId) {
  const key=projectId||KEY,mirrorKey=projectId?`${MIRROR}:${projectId}`:MIRROR;
  return transact(["snapshots", "journal"], "readonly", (tx) => {
    const base = tx.objectStore("snapshots").get(key);
    const pending = tx.objectStore("journal").get(key);
    return () => {
      let mirrored;
      try {
        mirrored = JSON.parse(localStorage.getItem(mirrorKey));
      } catch {
        /* IndexedDB remains authoritative. */
      }
      const snapshot = base.result;
      const journal = [pending.result, mirrored]
        .filter((item) => item?.revision > (snapshot?.revision ?? -1))
        .sort((a, b) => b.revision - a.revision)[0];
      return { snapshot, journal };
    };
  });
}

export function createLocalAutosave(viewport, onStatus, options={}) {
  const KEY=options.projectId||'current',MIRROR=options.projectId?`3d-box:pending-scene-v1:${options.projectId}`:'3d-box:pending-scene-v1';
  let revision = 0,
    savedRevision = 0,
    operations = [],
    timer,
    running,
    stopped = false,
    pauses = 0,
    suspended;
  let writeQueue = Promise.resolve();
  const report = (state, error) =>
    onStatus?.({ state, revision, savedRevision, error });
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped && !pauses && !suspended && revision > savedRevision)
      timer = setTimeout(() => flush().catch(() => {}), 2000);
  };
  const queue = (task) => {
    writeQueue = writeQueue.catch(() => {}).then(task);
    writeQueue.catch((error) => report("error", error.message));
    return writeQueue;
  };
  const changed = (operation) => {
    if (stopped) return;
    revision++;
    if (operation)
      operations.push({
        ...structuredClone(operation),
        sequence: revision,
        status: "accepted",
      });
    const record = {
      id: KEY,
      revision,
      savedAtMs: Date.now(),
      json: viewport.exportSceneJson(),
      operations: structuredClone(operations),
      metadata: viewport.exportLocalMetadata(),
    };
    // Synchronous crash/reload fallback; imported binary assets are already in IndexedDB.
    try {
      localStorage.setItem(MIRROR, JSON.stringify(record));
    } catch {
      /* Quota: use IndexedDB journal. */
    }
    queue(() =>
      transact(["journal"], "readwrite", (tx) =>
        tx.objectStore("journal").put(record),
      ),
    );
    report("pending");
    schedule();
  };
  async function flush() {
    clearTimeout(timer);
    if (suspended) throw suspended;
    if (pauses) return;
    if (stopped || revision <= savedRevision) return;
    if (running) {
      await running;
      if (revision > savedRevision) return flush();
      return;
    }
    if (viewport.isBusy()) {
      schedule();
      return;
    }
    viewport.flushSceneEdits();
    const targetRevision = revision;
    // Build a private export scene synchronously before awaiting GLTFExporter:
    // animation playback and newer edits cannot alter this revision's GLB.
    const json = viewport.exportSceneJson();
    const source = viewport.createExportScene();
    report("saving");
    running = (async () => {
      const result = await viewport.exportSceneGlb(undefined, source);
      const bytes = await result.blob.arrayBuffer();
      await writeQueue.catch(() => {});
      // Keep the journal intact until the authoritative SQLite/file commit succeeds.
      await options.onSnapshot?.({bytes,json,revision:targetRevision});
      await transact(["snapshots", "journal"], "readwrite", (tx) => {
        tx.objectStore("snapshots").put({
          id: KEY,
          revision: targetRevision,
          savedAtMs: json.savedAtMs,
          bytes,
          json,
          glbName: "studio.glb",
          jsonName: "studio-collaboration.json",
        });
        const journalStore = tx.objectStore("journal");
        const current = journalStore.get(KEY);
        current.onsuccess = () => {
          if (current.result?.revision <= targetRevision)
            journalStore.delete(KEY);
        };
      });
      savedRevision = targetRevision;
      operations = operations.filter(
        (operation) => operation.sequence > targetRevision,
      );
      try {
        const mirror = JSON.parse(localStorage.getItem(MIRROR));
        if (mirror?.revision <= targetRevision) localStorage.removeItem(MIRROR);
      } catch {
        /* Optional mirror. */
      }
      report(revision === savedRevision ? "saved" : "pending");
    })();
    try {
      await running;
    } catch (error) {
      report("error", error.message);
      throw error;
    } finally {
      running = null;
      schedule();
    }
  }
  return {
    changed,
    flush,
    async pause(){
      pauses++;clearTimeout(timer);
      if(running)await running.catch(()=>{});
      await writeQueue.catch(()=>{});
      let released=false;
      return ()=>{if(released)return;released=true;pauses--;schedule();};
    },
    suspendWrites(error){suspended=error;clearTimeout(timer);report('error',error.message);},
    async adoptSnapshot(snapshot){
      clearTimeout(timer);if(running)await running.catch(()=>{});if(stopped)throw Error('本地保存已关闭。');
      await queue(()=>transact(['snapshots','journal'],'readwrite',tx=>{tx.objectStore('snapshots').put({...snapshot,id:KEY,savedAtMs:Date.now(),glbName:'studio.glb',jsonName:'studio-collaboration.json'});tx.objectStore('journal').delete(KEY);}));
      revision=savedRevision=snapshot.revision;operations=[];suspended=undefined;try{localStorage.removeItem(MIRROR);}catch{/* Optional crash mirror. */}report('saved');
    },
    async replaceSnapshot(snapshot) {
      await flush();
      if (stopped) throw Error('本地保存已关闭。');
      const next = revision + 1;
      await options.onSnapshot?.({...snapshot,revision:next});
      await queue(() => transact(["snapshots", "journal"], "readwrite", tx => {
        tx.objectStore("snapshots").put({...snapshot,id:KEY,revision:next,savedAtMs:Date.now(),glbName:'studio.glb',jsonName:'studio-collaboration.json'});
        tx.objectStore("journal").delete(KEY);
      }));
      revision = savedRevision = next;
      operations = [];
      try{localStorage.removeItem(MIRROR);}catch{/* Optional crash mirror. */}
      report('saved');
    },
    initialize(
      baseRevision = 0,
      pendingRevision = baseRevision,
      pendingOperations = [],
    ) {
      revision = pendingRevision;
      savedRevision = baseRevision;
      operations = pendingOperations;
      report(revision > savedRevision ? "pending" : "saved");
      schedule();
    },
    dispose() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export async function migrateLocalCache(projectId,{snapshot,journal}){
 return transact(['snapshots','journal'],'readwrite',tx=>{if(snapshot)tx.objectStore('snapshots').put({...snapshot,id:projectId});if(journal)tx.objectStore('journal').put({...journal,id:projectId});});
}

export async function readImportedAsset(id) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("3d-box-local-assets", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("assets", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("assets").objectStore("assets").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
