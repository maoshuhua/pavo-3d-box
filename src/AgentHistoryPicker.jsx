import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {studioRequest} from './studioApi.js';
import './StudioHome.css';

export default function AgentHistoryPicker({onClose,onConfirm,remaining=12}){
 const [items,setItems]=useState([]),[selected,setSelected]=useState([]),[page,setPage]=useState(1),[size,setSize]=useState(15),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const close=useRef(null);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setSelected([]);studioRequest('/api/task/artifact/list',{method:'POST',body:{mediaType:'image',page,pageSize:size},signal:controller.signal}).then(data=>{setItems(data.list);setTotal(data.total);}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[page,size]);
 useEffect(()=>{const prior=document.activeElement;close.current?.focus();return()=>prior?.focus?.()},[]);
 const limit=Math.min(10,remaining);
 return createPortal(<div data-agent-popup className="studio-modalOverlay" onPointerDown={e=>{if(e.target===e.currentTarget)onClose()}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose()}if(e.key==='Tab'){const nodes=[...e.currentTarget.querySelectorAll('button:not(:disabled),select,input')],first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}}>
  <div className="studio-historyDialog" role="dialog" aria-modal="true" aria-label="选择图片"><header><h2>选择图片</h2><button ref={close} type="button" aria-label="关闭选择图片" onClick={onClose}>×</button></header>
   <nav>{['Pavo','Pavo生成器','WebUI','ComfyUI','AI应用'].map((name,i)=><button type="button" key={name} disabled={i!==0} aria-pressed={i===0}>{name}</button>)}</nav>
   <div className="studio-historyCount">图片 <span>已选 {selected.length} / {limit} 张</span></div>
   <div className="studio-historyGrid" aria-busy={loading}>{error?<p role="alert">{error}</p>:loading?'加载中…':items.length?items.map(item=><button type="button" key={item.id} aria-label={item.fileName||'图片'} aria-pressed={selected.some(s=>s.id===item.id)} onClick={()=>setSelected(v=>v.some(s=>s.id===item.id)?v.filter(s=>s.id!==item.id):v.length<limit?[...v,item]:v)}><img src={item.previewPath} alt={item.fileName||''}/>{selected.some(s=>s.id===item.id)&&<span>✓</span>}</button>):<p>暂无图片</p>}</div>
   <footer><button type="button" disabled={loading||page<=1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page}</span><button type="button" disabled={loading||page*size>=total} onClick={()=>setPage(p=>p+1)}>下一页</button><select aria-label="每页数量" value={size} onChange={e=>{setSize(+e.target.value);setPage(1)}}>{[15,30,45,60].map(n=><option key={n} value={n}>{n}条/页</option>)}</select><button type="button" className="studio-primary" disabled={!selected.length||loading} onClick={()=>onConfirm(selected.map(s=>({assetId:s.id,name:s.fileName||'图片',type:'image',source:{type:'url',value:s.previewPath,mimeType:'image/png'}})))}>确定</button></footer>
  </div>
 </div>,document.body);
}
