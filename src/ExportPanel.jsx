import React, { useEffect, useRef, useState } from 'react';

export default function ExportPanel({ title, disabled, details, phase, progress, onExport, onCancel }) {
  const [open, setOpen] = useState(false), [tab, setTab] = useState('video');
  const [format, setFormat] = useState('mp4'), [formatsOpen, setFormatsOpen] = useState(false);
  const timer = useRef(null);
  const clear = () => clearTimeout(timer.current);
  const show = () => { clear(); if (!disabled && !phase) setOpen(true); };
  const hide = () => { clear(); timer.current = setTimeout(() => { setOpen(false); setFormatsOpen(false); }, 120); };
  useEffect(() => { if (phase) { setOpen(false); setFormatsOpen(false); } }, [phase]);
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); if (formatsOpen) setFormatsOpen(false); else setOpen(false); } };
    window.addEventListener('keydown', escape, true);
    return () => { clear(); window.removeEventListener('keydown', escape, true); };
  }, [formatsOpen]);
  const size = tab === 'video' ? details?.videoSize : details;
  const noAnimation = tab === 'video' && !(details?.durationSeconds > 0);
  const selectedFormat = tab === 'video' ? format : tab === 'image' ? 'png' : 'glb';
  return <div className="export-area">
    <button className="exportButton" disabled={phase === 'cancelling' || (!phase && disabled)}
      data-exporting={!!phase || undefined} aria-busy={!!phase} aria-haspopup={phase ? undefined : 'dialog'} aria-expanded={phase ? undefined : open}
      title={phase ? '取消导出' : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onClick={phase ? onCancel : show}>
      {phase ? <><span aria-hidden="true">■</span><span role="status">{phase === 'cancelling' ? '正在取消…' : `正在渲染 ${progress}%`}</span></> : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>导出</>}
    </button>
    {open && !phase && <section className="exportPanel export-popover" role="dialog" aria-label="导出" data-cn onMouseEnter={clear} onMouseLeave={hide}>
      <h2 className="exportPanelTitle">{title}</h2>
      <div className="exportPanelBody">
        <div className="exportTabs" role="tablist" aria-label="导出类型">
          {[['video', '视频'], ['image', '图片'], ['asset', '3D 资产']].map(([value, label]) => <button key={value} role="tab" className="exportTab"
            aria-selected={tab === value} data-active={tab === value || undefined} onClick={() => { setTab(value); setFormatsOpen(false); }}>{label}</button>)}
        </div>
        <div className="exportFields">
          {tab === 'video' && <div className="exportField"><span>导出画质</span><strong>高清</strong></div>}
          <div className="exportField"><span>格式</span>{tab === 'video' ? <div className="exportFormatSelect">
            <button className="exportFormatTrigger" aria-label="导出格式" aria-expanded={formatsOpen} onClick={() => setFormatsOpen(value => !value)}>{format === 'mp4' ? 'MP4' : 'WebM'}⌄</button>
            {formatsOpen && <div className="exportFormatMenu" role="listbox" aria-label="导出格式">{['mp4', 'webm'].map(value => <button key={value}
              className="exportFormatOption" role="option" aria-selected={format === value} data-combobox-active={format === value || undefined}
              onClick={() => { setFormat(value); setFormatsOpen(false); }}>{value === 'mp4' ? 'MP4' : 'WebM'}{format === value && ' ✓'}</button>)}</div>}
          </div> : <strong>{selectedFormat.toUpperCase()}</strong>}</div>
          {tab !== 'asset' && <div className="exportField"><span>分辨率</span><strong>{size ? `${size.width} × ${size.height}` : '—'}</strong></div>}
        </div>
        {noAnimation && <p className="exportDisabledHint" role="note">请先添加相机轨迹或动画，再导出视频。</p>}
      </div>
      <footer className="exportPanelFooter">
        <button className="exportDownloadButton" disabled={disabled || noAnimation} onClick={() => { setOpen(false); setFormatsOpen(false); onExport(selectedFormat); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>下载</button>
        {tab !== 'asset' && <button className="exportDownloadButton exportCanvasButton" disabled title="暂未实现"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m14 4 2.5 6.5L23 13l-6.5 2.5L14 22l-2.5-6.5L5 13l6.5-2.5ZM5 1l1.4 3.6L10 6 6.4 7.4 5 11 3.6 7.4 0 6l3.6-1.4Z" /></svg>去画布生成</button>}
      </footer>
    </section>}
  </div>;
}
