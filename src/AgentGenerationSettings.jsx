import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {studioRequest} from './studioApi.js';
import BrandLogo from './BrandLogo.jsx';
import './HomeSettings.css';
import {selectedAgentModel} from './agentModels.js';
import {ModelChevronIcon} from './AgentIcons.jsx';

export default function AgentGenerationSettings({value,onChange,disabled,modelOnly=true}){
 const [models,setModels]=useState([]),[open,setOpen]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[draft,setDraft]=useState(value);
 const anchor=useRef(null);
 useEffect(()=>setDraft(value),[value]);
 useEffect(()=>{const c=new AbortController();studioRequest('/api/task/agent-task/modes?agentName=libtv_coding_agent',{signal:c.signal}).then(d=>setModels(d.modes)).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>c.abort()},[]);
 useEffect(()=>{if(disabled)setOpen(null)},[disabled]);
 useEffect(()=>{if(!open)return;const close=e=>{if(e.type==='keydown'){if(e.key==='Escape'){e.stopPropagation();setOpen(null)}}else if(!e.target.closest('[data-agent-settings]'))setOpen(null)};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close)}},[open]);
 useLayoutEffect(()=>{
  const root=anchor.current,popup=root?.querySelector('[data-agent-popup]');if(!open||!popup)return;
  const place=()=>{popup.style.left='0px';const rect=popup.getBoundingClientRect();popup.style.left=`${Math.max(16-rect.left,Math.min(0,window.innerWidth-16-rect.right))}px`;};
  let frame;const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(place);};
  place();const observer=new ResizeObserver(place);observer.observe(root);observer.observe(popup);window.addEventListener('resize',resize);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',resize);};
 },[open]);
 const current=draft||{aspectRatio:'16:9',durationSeconds:'auto'};
 const selected=selectedAgentModel(models,current.agentMode);
 const change=async patch=>{const next={...current,agentMode:selected?.key,reasoningModel:selected?.key,...patch};setDraft(next);setSaving(true);setError('');try{await onChange(next);}catch(e){setDraft(value);setError(e.message)}finally{setSaving(false)}};
 return <div ref={anchor} data-agent-settings className="agent-generationSettings" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();setOpen(null);}}}>
  <button type="button" className="studio-setting agent-modelTrigger" aria-label={`模型选择: ${selected?.name||'正在加载'}`} title={selected?.name} aria-haspopup="menu" aria-expanded={open==='model'} disabled={disabled||saving||!models.length} onClick={()=>setOpen(v=>v==='model'?null:'model')}><BrandLogo size={18}/><span>{selected?.name||'正在加载…'}</span><ModelChevronIcon/></button>
  {!modelOnly&&<><button type="button" className="studio-setting" disabled={disabled||saving} aria-label={`画面比例: ${current.aspectRatio}`} aria-expanded={open==='ratio'} onClick={()=>setOpen(v=>v==='ratio'?null:'ratio')}>{current.aspectRatio}</button><button type="button" className="studio-setting" disabled={disabled||saving} aria-label={`时长: ${current.durationSeconds==='auto'?'自动':current.durationSeconds+'s'}`} aria-expanded={open==='duration'} onClick={()=>setOpen(v=>v==='duration'?null:'duration')}>{current.durationSeconds==='auto'?'自动':current.durationSeconds+'s'}</button></>}
  {open==='model'&&<div data-agent-popup className="studio-modelMenu agent-settingsPopup" role="menu" aria-label="选择模型">{models.map(m=><button type="button" role="menuitemradio" aria-checked={m.key===selected?.key} disabled={saving} key={m.key} onClick={async()=>{await change({agentMode:m.key,reasoningModel:m.key,agentVersion:m.version||''});setOpen(null)}}><span className="studio-modelMenuIcon"><BrandLogo size={24}/></span><span title={m.name}>{m.name}</span>{m.key===selected?.key&&<span className="studio-check">✓</span>}</button>)}</div>}
  {open==='ratio'&&<div data-agent-popup className="agent-settingsPopup agent-ratioPopup"><p>画面比例</p><div className="studio-ratios">{['16:9','9:16','4:3','3:4','21:9','1:1'].map(r=><button type="button" key={r} aria-pressed={r===current.aspectRatio} disabled={saving} onClick={async()=>{await change({aspectRatio:r});setOpen(null)}}><span style={{aspectRatio:r.replace(':','/')}}/>{r}</button>)}</div></div>}
  {open==='duration'&&<div data-agent-popup className="agent-settingsPopup agent-durationPopup"><p>时长 <strong>{current.durationSeconds==='auto'?'自动':current.durationSeconds+'s'}</strong></p><input type="range" aria-label="时长" min={5} max={60} value={current.durationSeconds==='auto'?5:current.durationSeconds} disabled={saving} onChange={e=>change({durationSeconds:+e.target.value})}/><label className="studio-auto">Agent 自动匹配<input type="checkbox" role="switch" checked={current.durationSeconds==='auto'} disabled={saving} onChange={e=>change({durationSeconds:e.target.checked?'auto':5})}/></label></div>}
  {error&&<span className="agent-settingsError" role="alert">{error}</span>}
 </div>;
}
