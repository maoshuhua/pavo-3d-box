import React from 'react';
import {annotationColors} from './libtvAnnotation.js';
import './MotionAnnotation.css';
const tools=[['select','选择','M4 3c-1-.4-2 .5-1.6 1.6l5.1 15c.4 1.1 2 1.1 2.4 0l2.3-6.4 6.4-2.3c1.1-.4 1.1-2 0-2.4Z'],['draw','画笔','M3 14C8 9 13 2 16 3c4 2-9 13-9 16 0 4 9-7 11-6 2 1-3 5-1 6 1 1 3-1 4-2'],['arrow','箭头','M5 19 19 5m-9 0h9v9'],['circle','椭圆',null],['rectangle','矩形','M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z'],['text','文字','M3 6V3h18v3M12 3v18m-4 0h8'],['eraser','橡皮擦','m4 12 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-9 9a3 3 0 0 1-4 0l-4-4a3 3 0 0 1 0-4Zm5-5 8 8']];
export function SketchIcon(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 8c-5-3-8 6-4 7 4 2 10-5 4-7Zm5-3c4-5 8-1 4 3l-5 5m3-1c7-3 9 3 4 3-6 0-4 5 1 6M9 17l2 4 3-2"/></svg>}
export default function MotionAnnotation({controller:c,onExit,onConfirm,busy,bottom,left,right}){
 return <div className="motion-annotate-annotate" role="toolbar" aria-label="运镜轨迹标注" style={{bottom:bottom+16,'--preview-left-width':`${left}px`,'--preview-right-width':`${right}px`}}>
  <div className="motion-annotate-bar motion-annotate-options">
   {c.tool==='text'?<select className="motion-annotate-size" aria-label="文字字号" value={c.fontSize} onChange={e=>c.setFontSize(+e.target.value)}>{[12,24,36,48,60,72,84,96].map(size=><option key={size} value={size}>{size} pt</option>)}</select>:<div className="motion-annotate-strokes">{[['small','细',4],['medium','中',6],['large','粗',8]].map(([value,label,dot])=><button key={value} type="button" className="motion-annotate-stroke" aria-label={`${label}画笔`} aria-pressed={c.stroke===value} data-active={c.stroke===value} onClick={()=>c.setStroke(value)}><span className="motion-annotate-dot" style={{width:dot,height:dot}}/></button>)}</div>}
   <span className="motion-annotate-divider"/>
   <div className="motion-annotate-colors">{annotationColors.map(color=><button key={color} type="button" className="motion-annotate-color" aria-label={color} aria-pressed={c.color===color} data-active={c.color===color} style={{'--preview-annotate-color':color}} onClick={()=>c.setColor(color)}><span className="motion-annotate-swatch"/></button>)}</div>
  </div>
  <div className="motion-annotate-row">
   <div className="motion-annotate-bar motion-annotate-exit"><button type="button" className="motion-annotate-tool" aria-label="退出标注" disabled={busy} onClick={onExit}><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div>
   <div className="motion-annotate-bar motion-annotate-toolbar"><div className="motion-annotate-tools">{tools.map(([tool,label,path])=><button key={tool} type="button" className="motion-annotate-tool" aria-label={label} title={label} aria-pressed={c.tool===tool} data-active={c.tool===tool} onClick={()=>c.setTool(tool)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path?<path d={path}/>:<ellipse cx="12" cy="12" rx="9" ry="8"/>}</svg></button>)}</div>
    <button type="button" className="motion-annotate-confirm" aria-label="确认标注" disabled={busy} onClick={onConfirm}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg></button>
   </div>
  </div>
 </div>
}
