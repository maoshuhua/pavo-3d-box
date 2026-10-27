import {studioRequest} from './studioApi.js';

// Check before opening any scene cache or importing a legacy browser project.
export async function synchronizeDataGeneration() {
 const {generation}=await studioRequest('/api/studio/data-generation');
 if(!generation||localStorage.getItem('3d-box:data-generation')===generation)return;
 await Promise.all(['3d-box-local-project','3d-box-local-assets'].map(name=>new Promise((resolve,reject)=>{
  const request=indexedDB.deleteDatabase(name);
  request.onsuccess=resolve;
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(Error('请关闭其他 3D-BOX 页面后重试，以完成本地数据初始化。'));
 })));
 for(const key of Object.keys(localStorage))if(key.startsWith('3d-box:'))localStorage.removeItem(key);
 localStorage.setItem('3d-box:data-generation',generation);
}
