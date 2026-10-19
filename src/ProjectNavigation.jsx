import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import './ProjectNavigation.css';
import BrandLogo from './BrandLogo.jsx';

const projectNameLimit=128;
export default function ProjectNavigation({name,onRename,onSave,onGoHome,onAllProjects,onCreateProject,onDeleteProject,onToggleMonitor,monitorOpened=false,monitorVisible=true,busy=false,disabled=false,pending=null,dirty=false,onError,onRect}){
 const [opened,setOpened]=useState(false),[present,setPresent]=useState(false),[editing,setEditing]=useState(false),[draft,setDraft]=useState(name),[confirming,setConfirming]=useState(false),[renaming,setRenaming]=useState(false),[position,setPosition]=useState({left:16,top:50});
 const root=useRef(null),trigger=useRef(null),menu=useRef(null),input=useRef(null),cancelDelete=useRef(null),renamePending=useRef(false),renameCancelled=useRef(false),returnFocus=useRef(null),menuId=useId();
 const report=error=>onError?.(error.message||'项目操作失败。');
 const close=(focus=false)=>{setOpened(false);if(focus)trigger.current?.focus();};
 const perform=async callback=>{close();try{await callback?.();}catch(error){report(error);}};
 useLayoutEffect(()=>{
  if(opened){setPresent(true);return;}
  const timer=setTimeout(()=>setPresent(false),150);
  return()=>clearTimeout(timer);
 },[opened]);
 useLayoutEffect(()=>{
  const update=()=>{if(root.current)onRect?.(root.current.getBoundingClientRect());};
  update();const observer=new ResizeObserver(update);if(root.current)observer.observe(root.current);window.addEventListener('resize',update);
  return()=>{observer.disconnect();window.removeEventListener('resize',update);};
 },[onRect,monitorOpened,monitorVisible]);
 useEffect(()=>{if(disabled)close();},[disabled]);
 useLayoutEffect(()=>{
  if(!opened)return;
  const update=()=>{const rect=trigger.current.getBoundingClientRect();setPosition({left:Math.max(8,Math.min(rect.left,window.innerWidth-208)),top:rect.bottom+6});};
  update();const frame=requestAnimationFrame(()=>menu.current?.querySelector('[role=menuitem]:not(:disabled)')?.focus());
  const outside=e=>{if(!menu.current?.contains(e.target)&&!trigger.current?.contains(e.target))close();};
  const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);window.addEventListener('resize',update);window.addEventListener('scroll',update,true);
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',update);window.removeEventListener('scroll',update,true);};
 },[opened]);
 useEffect(()=>{if(editing){input.current?.focus();input.current?.select();}},[editing]);
 useEffect(()=>{
  if(!confirming)return;
  returnFocus.current=document.activeElement;cancelDelete.current?.focus();
  const key=e=>{
   if(e.key==='Escape'&&!pending){e.preventDefault();e.stopPropagation();setConfirming(false);}
   if(e.key==='Tab'){const buttons=cancelDelete.current?.parentElement.querySelectorAll('button:not(:disabled)');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
  };
  document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);returnFocus.current?.isConnected&&returnFocus.current.focus();};
 },[confirming,pending]);
 async function commitName(){
  if(renamePending.current||renameCancelled.current||disabled)return;
  const value=draft.trim();if(!value||value===name){setEditing(false);return;}
  renamePending.current=true;setRenaming(true);
  try{await onRename(value);setEditing(false);}catch(error){report(error);input.current?.focus();}finally{renamePending.current=false;setRenaming(false);}
 }
 function menuKey(event){
  if(event.key==='Tab'){close();return;}
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const items=[...menu.current.querySelectorAll('[role=menuitem]:not(:disabled)')],index=items.indexOf(document.activeElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
 }
 return <>
  <div ref={root} className="editor-leftChrome" data-open={monitorOpened&&monitorVisible} data-preview-navigation="">
   <div className="editor-projectNavigation">
    <button ref={trigger} type="button" className="editor-projectMenuTrigger" aria-label="项目菜单" aria-haspopup="menu" aria-expanded={opened} aria-controls={opened?menuId:undefined} disabled={disabled||!!pending} onClick={()=>setOpened(value=>!value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setOpened(true);}}}>
     <BrandLogo className="editor-projectLogo" size={20}/>
     <svg className="editor-projectMenuChevron" data-open={opened||undefined} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m5 7 3 3 3-3"/></svg>
    </button>
    {editing?<input ref={input} className="editor-projectNameInput" aria-label="重命名项目" maxLength={projectNameLimit} value={draft} readOnly={renaming} disabled={disabled||!!pending} onChange={e=>setDraft(e.target.value)} onBlur={commitName} onClick={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();commitName();}if(e.key==='Escape'&&!renamePending.current){e.preventDefault();renameCancelled.current=true;setEditing(false);}}}/>:<span className="editor-projectName" title={name} onDoubleClick={()=>{if(disabled||pending)return;renameCancelled.current=false;setDraft(name);setEditing(true);}}>{name||'未命名 3D-BOX'}</span>}
    {monitorVisible&&<button type="button" className="editor-projectSidebarToggle" aria-label={monitorOpened?'收起监视器':'展开监视器'} aria-expanded={monitorOpened} onClick={onToggleMonitor} disabled={disabled||!!pending}>
     <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1.5" y="2" width="13" height="12" rx="2"/><path d="M6 2v12"/></svg>
    </button>}
   </div>
  </div>
  {present&&createPortal(<div ref={menu} id={menuId} className="editor-projectMenu editor-projectDropdown" data-region="cn" data-open={opened} inert={!opened} aria-hidden={!opened} role="menu" aria-label="项目操作" style={{left:position.left,top:position.top,maxHeight:`calc(100dvh - ${position.top+8}px)`}} onKeyDown={menuKey}>
   <button className="editor-projectMenuItem" role="menuitem" disabled={disabled} onClick={()=>perform(onGoHome)}>回到 Pavo 首页</button>
   <button className="editor-projectMenuItem" role="menuitem" disabled={disabled} onClick={()=>perform(onAllProjects)}>查看全部 3D-BOX</button>
   <hr className="editor-projectMenuDivider"/>
   <button className="editor-projectMenuItem" role="menuitem" disabled={disabled} onClick={()=>perform(onCreateProject)}>创建新 3D-BOX</button>
   <hr className="editor-projectMenuDivider"/>
   <div className="editor-projectMenuLabel">{dirty?'有未保存的编辑':'已保存到 3D-BOX'}</div>
   <button className="editor-projectMenuItem" role="menuitem" disabled={disabled||busy} onClick={()=>perform(onSave)}>保存 3D-BOX</button>
   <hr className="editor-projectMenuDivider"/>
   <button className="editor-projectMenuItem" role="menuitem" disabled={disabled} onClick={()=>{close();if(!busy)setConfirming(true);}}>删除当前 3D-BOX</button>
  </div>,document.body)}
  {confirming&&createPortal(<div className="confirm-overlay editor-projectDeleteOverlay" onPointerDown={e=>{if(e.target===e.currentTarget&&!pending)setConfirming(false);}}><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label="删除 3D-BOX"><h2>删除 3D-BOX</h2><p>确定删除“{name||'未命名 3D-BOX'}”吗？删除后无法恢复。</p><div><button ref={cancelDelete} disabled={!!pending} onClick={()=>setConfirming(false)}>取消</button><button className="confirm-delete" disabled={!!pending} onClick={async()=>{try{await onDeleteProject();}catch(error){report(error);setConfirming(false);}}}>{pending==='delete'?'正在删除…':'删除'}</button></div></div></div>,document.body)}
 </>;
}
