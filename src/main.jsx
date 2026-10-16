import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';
import StudioHome from './StudioHome.jsx';
import Editor from './Editor.jsx';
import {studioRequest,fetchStudioSnapshot} from './studioApi.js';
import {readLocalProject,migrateLocalCache} from './localProject.js';
import './Theme.css';

async function migrateLegacy(){
 const cached=await readLocalProject();if(!cached.snapshot&&!cached.journal)return;
 let state;try{state=JSON.parse(localStorage.getItem('3d-box:agent-session'));}catch{}
 const projectId=state?.projectId||localStorage.getItem('3d-box:legacy-project-id')||crypto.randomUUID();localStorage.setItem('3d-box:legacy-project-id',projectId);
 if(localStorage.getItem(`3d-box:sqlite-migrated:${projectId}`)==='true')return;
 const form=new FormData();form.set('projectId',projectId);form.set('name','未命名 3D-BOX');if(state)form.set('agentState',JSON.stringify(state));
 if(cached.snapshot){form.set('scene',new Blob([cached.snapshot.bytes]),'studio.glb');form.set('sceneJson',JSON.stringify(cached.snapshot.json));form.set('revision',String(Math.max(1,cached.snapshot.revision)));}
 await studioRequest('/api/studio/import-local',{method:'POST',body:form});
 const namespaced=await readLocalProject(projectId);if(!namespaced.snapshot&&!namespaced.journal){const delta=cached.snapshot?Math.max(1,cached.snapshot.revision)-cached.snapshot.revision:0;await migrateLocalCache(projectId,{snapshot:cached.snapshot?{...cached.snapshot,revision:cached.snapshot.revision+delta}:null,journal:cached.journal?{...cached.journal,revision:cached.journal.revision+delta}:null});}
 if(state&&!localStorage.getItem(`3d-box:agent-session:${projectId}`))localStorage.setItem(`3d-box:agent-session:${projectId}`,JSON.stringify(state));
 localStorage.setItem(`3d-box:sqlite-migrated:${projectId}`,'true');
}
function Router(){
 const [location,setLocation]=useState(()=>window.location.pathname+window.location.search),[loading,setLoading]=useState(true),[error,setError]=useState(''),[loaded,setLoaded]=useState(null),[retry,setRetry]=useState(0);
 const initialMigration=useRef(null);
 const navigate=(url,replace=false)=>{window.history[replace?'replaceState':'pushState'](null,'',url);setLocation(window.location.pathname+window.location.search);};
 useEffect(()=>{const update=()=>setLocation(window.location.pathname+window.location.search);window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update);},[]);
 useEffect(()=>{
  let live=true;const controller=new AbortController();setLoading(true);setError('');setLoaded(null);
  (async()=>{
   const url=new URL(location,window.location.origin);
   if(url.pathname!=='/animation-preview'){
    initialMigration.current??=migrateLegacy().catch(e=>{initialMigration.current=null;throw e;});await initialMigration.current;if(live)setLoading(false);return;
   }
   let projectId=url.searchParams.get('projectId'),project;
   if(!projectId){if(url.searchParams.get('newProject')!=='true')throw Error('项目地址无效');const draftId=url.searchParams.get('draftPromptId'),draft=draftId?await studioRequest(`/api/studio/draft/${encodeURIComponent(draftId)}`,{signal:controller.signal}):null,entryId=url.searchParams.get('entryId')||crypto.randomUUID();
    const animationPreview={version:1,...draft?{prompt:draft.prompt,promptParts:draft.promptParts,generationSettings:draft.generationSettings}:{}};
    project=await studioRequest('/api/studio/create',{method:'POST',body:{name:draft?.prompt?.trim().slice(0,80)||'未命名 3D-BOX',config:JSON.stringify({animationPreview})},headers:{'Idempotency-Key':entryId},signal:controller.signal});
    projectId=project.studioMeta.uuid;if(live)navigate(`/animation-preview?projectId=${projectId}`,true);return;
   }
   project=await studioRequest(`/api/studio/detail?uuid=${encodeURIComponent(projectId)}`,{signal:controller.signal});
   const scene=JSON.parse(project.config).animationPreview||{},[snapshot,history]=await Promise.all([fetchStudioSnapshot(projectId,controller.signal),studioRequest(`/api/v1/project/message/list?projectId=${encodeURIComponent(projectId)}${scene.sessionId?`&sessionId=${encodeURIComponent(scene.sessionId)}`:''}`,{signal:controller.signal})]);
   if(live){setLoaded({project,serverSnapshot:snapshot,history});setLoading(false);}
  })().catch(e=>{if(live&&!controller.signal.aborted){setError(e.message);setLoading(false);}});
  return()=>{live=false;controller.abort();};
 },[location,retry]);
 if(error)return <main className="studio-routeStatus" role="alert"><p>{error}</p><div><button onClick={()=>setRetry(n=>n+1)}>重试</button> <button onClick={()=>navigate('/3d-box')}>返回 3D-BOX</button></div></main>;
 if(loading)return <main className="studio-routeStatus" role="status">正在加载…</main>;
 if(loaded)return <Editor key={loaded.project.studioMeta.uuid} {...loaded}/>;
 return <StudioHome navigate={navigate}/>;
}
createRoot(document.getElementById('root')).render(<Router/>);
