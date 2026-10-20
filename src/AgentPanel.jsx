import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './AgentPanel.css';
import DirectorProgress from './DirectorProgress.jsx';
import {SketchIcon} from './MotionAnnotation.jsx';
import {useComposerInteraction,useComposerMorph} from './useComposerCollapse.js';
import {useComposerPosition} from './agentFloatingLayout.js';
import {uploadReference} from './studioApi.js';
import AgentRichInput from './AgentRichInput.jsx';
import AgentHistoryPicker from './AgentHistoryPicker.jsx';
import AgentGenerationSettings from './AgentGenerationSettings.jsx';
import {CollapseConversationIcon,StopGenerationIcon} from './AgentIcons.jsx';
const Spark=()=> <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m14 3 3 7 7 3-7 3-3 7-3-7-7-3 7-3ZM4 0l1.2 3L8 4 5.2 5 4 8 3 5 0 4l3-1Z"/></svg>;
const imageFile=f=>f.kind==='image'||f.type==='image'||f.type?.startsWith('image/');
function MessageAttachment({file}){const url=file.url||file.source?.value;return <span className="agent-messageAttachment">{imageFile(file)&&url&&<img src={url} alt={file.name||'参考图片'}/>}<span>{file.name}</span></span>}
export default function AgentPanel({client,reference,disabled,running,onGenerate,onCancel,onAnnotate,hidden,attachment,bottom,left,right,title,floatingLayout,generationSettings,onSettings,modelOnly}){
 const [text,setText]=useState(''),[files,setFiles]=useState([]),[error,setError]=useState(''),[height,setHeight]=useState(360),[maximum,setMaximum]=useState(540),[selected,setSelected]=useState(null),[menu,setMenu]=useState(false),[history,setHistory]=useState(false),[settingsBusy,setSettingsBusy]=useState(false),[,refresh]=useState(0);
 const form=useRef(null),inputArea=useRef(null),input=useRef(null),upload=useRef(null),messages=useRef(null),drag=useRef(null),nearBottom=useRef(true),filesRef=useRef([]),seenAnnotation=useRef(null),menuButton=useRef(null),submitPending=useRef(false);
 filesRef.current=files;
 const interaction=useComposerInteraction(form),compact=useComposerMorph(form,interaction.compact,hidden),expand=interaction.pin;
 const position=useComposerPosition(form,left,right,compact,null,floatingLayout,hidden,16);
 const minimum=Math.min(56,maximum),actualHeight=Math.max(minimum,Math.min(height,maximum));
 const visibleMessages=client.state.messages.filter(message=>!message.modelStatus&&message.toolName!=='模型响应');
 useLayoutEffect(()=>{const update=()=>{const area=inputArea.current?.offsetHeight||124;floatingLayout?.setComposer({minimumHeight:area+56});setMaximum(Math.max(0,Math.min(540,window.innerHeight-bottom-72-area,(compact?Infinity:floatingLayout?.getSnapshot().composerHeightLimit??Infinity)-area)))};update();const observer=new ResizeObserver(update);if(inputArea.current)observer.observe(inputArea.current);const unsubscribe=floatingLayout?.subscribe(update);window.addEventListener('resize',update);return()=>{observer.disconnect();unsubscribe?.();window.removeEventListener('resize',update)}},[bottom,compact,floatingLayout]);
 useLayoutEffect(()=>{if(!compact&&!hidden&&nearBottom.current&&messages.current)messages.current.scrollTop=messages.current.scrollHeight});
 useEffect(()=>{if(running)expand()},[running,expand]);
 useEffect(()=>{if(hidden||disabled||running){setMenu(false);setHistory(false)}},[hidden,disabled,running]);
 useEffect(()=>{if(!menu)return;const close=e=>{if(e.type==='keydown'){if(e.key==='Escape'){e.stopPropagation();setMenu(false);menuButton.current?.focus()}}else if(!e.target.closest('[data-agent-upload]'))setMenu(false)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close)}},[menu]);
 const addFiles=async picked=>{
  if(disabled||running)return;
  const list=Array.from(picked);if(!list.length)return;expand();setError('');
  if(list.some(f=>f.size>20*1024*1024)){setError('每个参考附件不能超过 20 MiB。');return}
  if(filesRef.current.length+list.length>12){setError('每次最多上传 12 个附件。');return}
  const records=list.map(file=>({id:crypto.randomUUID(),name:file.name,type:file.type,status:'uploading',file}));filesRef.current=[...filesRef.current,...records];setFiles(filesRef.current);
  await Promise.all(records.map(async record=>{try{const part=await uploadReference(record.file);setFiles(v=>v.map(f=>f.id===record.id?{...f,status:'ready',part}:f))}catch(e){setError(e.message);setFiles(v=>v.map(f=>f.id===record.id?{...f,status:'error'}:f))}}));
 };
 useEffect(()=>{if(attachment&&seenAnnotation.current!==attachment){seenAnnotation.current=attachment;addFiles([attachment])}},[attachment]);
 const uploading=files.some(f=>f.status!=='ready');
 const submit=async event=>{
  event.preventDefault();if(submitPending.current||running||disabled||settingsBusy||uploading||(!text.trim()&&!files.length))return;submitPending.current=true;
  setError('');nearBottom.current=true;expand();
  try{const parts=files.map(f=>f.part);await onGenerate({prompt:text.trim(),reference:selected,attachmentIds:parts.map(p=>p.assetId),attachmentParts:parts},()=>refresh(n=>n+1));input.current.clear();setFiles([])}
  catch(cause){if(cause.name!=='AbortError')setError(cause.message||'Agent 生成失败。')}
  finally{submitPending.current=false;refresh(n=>n+1)}
 };
 const endResize=e=>{if(drag.current?.id!==e.pointerId)return;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)};
 return <>
 <form ref={form} {...interaction.formProps} hidden={hidden} className="agent-composer" data-cn data-compact={compact} data-running={running||undefined} data-anchor={position.anchor} data-sliding={position.sliding||undefined} aria-label="Agent 对话" style={{bottom:Math.max(16,bottom+16),'--preview-left-width':`${left}px`,'--preview-right-width':`${right}px`,'--preview-composer-slide':`${position.offset}px`}} onSubmit={submit} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.stopPropagation()}}} onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();e.stopPropagation();addFiles(e.dataTransfer.files)}}}>
  {!compact&&(visibleMessages.length>0||error||running)&&<section className="agent-history" aria-label="对话历史" style={{height:actualHeight}}>
   <header className="agent-historyHeader" {...position.handleProps}>
    <div className="agent-resizeHandle" role="separator" tabIndex={0} aria-label="调整对话高度" aria-orientation="horizontal" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={actualHeight}
     onKeyDown={e=>{const next={ArrowUp:actualHeight+24,ArrowDown:actualHeight-24,Home:minimum,End:maximum}[e.key];if(next!==undefined||e.key==='Enter'){e.preventDefault();e.stopPropagation();if(e.key==='Enter')interaction.collapse();else setHeight(Math.max(minimum,Math.min(maximum,next)))}}}
     onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});drag.current={id:e.pointerId,y:e.clientY,height:actualHeight};e.currentTarget.setPointerCapture(e.pointerId)}}
     onPointerMove={e=>{if(drag.current?.id===e.pointerId){e.preventDefault();e.stopPropagation();setHeight(Math.max(minimum,Math.min(maximum,drag.current.height+drag.current.y-e.clientY)))}}}
     onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={()=>drag.current=null}><span/></div>
    <p className="agent-projectTitle">{title||'3D-BOX'}</p><button type="button" className="agent-iconButton agent-collapseButton" aria-label="收起对话" aria-expanded={!compact} onClick={interaction.collapse}><CollapseConversationIcon/></button>
   </header>
   <div className="agent-messages" ref={messages} role="log" aria-live="polite" onScroll={e=>{nearBottom.current=e.currentTarget.scrollHeight-e.currentTarget.scrollTop-e.currentTarget.clientHeight<48}}>
    {visibleMessages.map(m=><div key={m.id} className="agent-message" data-role={m.role} data-tool-status={m.toolStatus} role={m.role==='tool'?'status':undefined}>
     {m.director&&<DirectorProgress state={m.director}/>}
     {m.reference&&<span className="agent-selectionTag agent-messageReference">{m.reference.label}</span>}
     {m.role==='assistant'?<Markdown remarkPlugins={[remarkGfm]} components={{a:({node,...props})=><a {...props} target="_blank" rel="noopener noreferrer"/>}}>{m.text}</Markdown>:<div>{m.role==='tool'&&<svg className="agent-toolIcon" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 10 5 5a3 3 0 0 0 4-4L9 4a4 4 0 0 0-6 6l8 8M7 6l7 7"/></svg>}{m.text}</div>}
     {m.attachments?.map((f,i)=><MessageAttachment key={i} file={f}/>)}
    </div>)}
    {running&&<span className="agent-pending" role="status">正在生成…</span>}
    {error&&<div className="agent-error" role="alert">{error}</div>}
   </div>
  </section>}
  <div className="agent-inputArea" ref={inputArea}>
   {!!files.length&&!running&&<div className="agent-attachmentRow">{files.map(file=><span className="agent-attachmentChip" data-status={file.status} key={file.id}>{file.part?.type==='image'&&<img className="agent-attachmentThumb" src={file.part.source.value} alt={file.name}/>}<span className="agent-attachmentName">{file.name}{file.status==='uploading'?' · 上传中':file.status==='error'?' · 上传失败':''}</span><button type="button" className="agent-selectionTagRemove" aria-label={`移除 ${file.name}`} disabled={running} onClick={()=>setFiles(v=>v.filter(f=>f.id!==file.id))}>×</button></span>)}</div>}
   <div className="agent-inputSlot"><AgentRichInput ref={input} reference={reference} disabled={disabled} running={running} compact={compact} onChange={setText} onReference={setSelected} onSubmit={submit} onFiles={addFiles} onExpand={expand}/>{running&&<div className="agent-status" role="status"><span>正在生成场景…</span></div>}</div>
   <div className="agent-actions"><div className="agent-options">
    <div className="agent-uploadAnchor" data-agent-upload><button ref={menuButton} type="button" className="agent-iconButton agent-uploadButton" aria-label="添加参考附件" aria-expanded={menu} aria-haspopup="menu" disabled={disabled||running} onClick={()=>setMenu(v=>!v)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M12 3v18M3 12h18"/></svg></button>{menu&&<div data-agent-popup className="agent-uploadMenu" role="menu"><button type="button" role="menuitem" className="agent-uploadMenuItem" onClick={()=>{setMenu(false);upload.current.click()}}>本地上传</button><button type="button" role="menuitem" className="agent-uploadMenuItem" onClick={()=>{setMenu(false);setHistory(true)}}>从生成历史选择</button></div>}</div>
    <button type="button" className="agent-iconButton agent-uploadButton agent-annotateButton" aria-label="运镜轨迹" title="运镜轨迹 · ⇧P" disabled={disabled||running} onClick={onAnnotate}><SketchIcon/></button>
    {!compact&&onSettings&&<AgentGenerationSettings value={generationSettings} onChange={async value=>{setSettingsBusy(true);try{await onSettings(value)}finally{setSettingsBusy(false)}}} disabled={disabled||running||settingsBusy} modelOnly={modelOnly}/>}
    <input ref={upload} type="file" hidden multiple accept="image/*,.glb,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md,.json,.csv" onChange={e=>{addFiles(e.target.files);e.target.value=''}}/>
   </div><button type={running?'button':'submit'} className="agent-sendButton" aria-label={running?'停止生成':'发送'} disabled={!running&&(disabled||settingsBusy||uploading||(!text.trim()&&!files.length))} onClick={running?event=>{event.preventDefault();onCancel()}:undefined}>{running?<StopGenerationIcon/>:<Spark/>}</button></div>
  </div>
 </form>
 {history&&<AgentHistoryPicker remaining={12-files.length} onClose={()=>{setHistory(false);input.current?.focus()}} onConfirm={parts=>{setFiles(v=>[...v,...parts.filter(p=>!v.some(f=>f.part?.assetId===p.assetId)).map(part=>({id:crypto.randomUUID(),name:part.name,type:part.type,status:'ready',part}))].slice(0,12));setHistory(false);input.current?.focus()}}/>}
 </>;
}
