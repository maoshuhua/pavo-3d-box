import React,{forwardRef,useImperativeHandle,useLayoutEffect,useRef} from 'react';

function readText(node){
 if(node.nodeType===3)return node.textContent.replace(/\u200b/g,'');
 if(node.nodeType!==1||node.hasAttribute('data-agent-reference'))return '';
 if(node.tagName==='BR')return '\n';
 return [...node.childNodes].map(readText).join('')+(['DIV','P'].includes(node.tagName)?'\n':'');
}
// One tracked inline selection. The editable DOM owns its caret, so streamed
// replies don't reset selection while the user types, pastes, or composes IME.
export default forwardRef(function AgentRichInput({reference,disabled,running,compact,onChange,onReference,onSubmit,onFiles,onExpand},ref){
 const editor=useRef(null),tracked=useRef(null),last=useRef(null),callbacks=useRef({});
 callbacks.current={onChange,onReference,onSubmit,onFiles,onExpand};
 const value=()=>[...editor.current.childNodes].map(readText).join('').replace(/\n$/,'');
 const notify=()=>{if(tracked.current&&!editor.current.querySelector('[data-agent-reference]')){tracked.current=null;callbacks.current.onReference(null)}callbacks.current.onChange(value())};
 const insert=text=>{const el=editor.current;el.focus();const selection=window.getSelection();let range=selection?.rangeCount?selection.getRangeAt(0):null;if(!range||!el.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(el);range.collapse(false)}range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);notify()};
 useImperativeHandle(ref,()=>({focus:()=>editor.current?.focus(),clear:()=>{editor.current.replaceChildren();tracked.current=null;callbacks.current.onReference(null);callbacks.current.onChange('')},getText:value}),[]);
 useLayoutEffect(()=>{
  if(running)return;
  const key=reference?JSON.stringify(reference):null;
  if(!reference){last.current=null;return}
  if(last.current===key)return;
  last.current=key;editor.current.querySelector('[data-agent-reference]')?.remove();
  const chip=document.createElement('span');chip.contentEditable='false';chip.className='agent-selectionTag';chip.setAttribute('data-agent-reference','');chip.title=reference.label;
  const label=document.createElement('span');label.className='agent-selectionTagLabel';label.textContent=reference.label;
  const remove=document.createElement('button');remove.type='button';remove.className='agent-selectionTagRemove';remove.setAttribute('aria-label','移除元素引用');remove.textContent='×';remove.onPointerDown=e=>e.preventDefault();remove.onclick=e=>{e.stopPropagation();chip.remove();tracked.current=null;callbacks.current.onReference(null);notify()};
  chip.append(label,remove);editor.current.prepend(chip);tracked.current=reference;callbacks.current.onReference(reference);
 },[reference,running]);
 return <div ref={editor} role="textbox" aria-label="描述场景调整" aria-multiline="true" aria-disabled={disabled||running} contentEditable={!disabled&&!running} suppressContentEditableWarning className="agent-input agent-richInput" data-placeholder={running?'':'选中一个元素或机位，描述如何调整…'} data-compact={compact} data-running={running||undefined} onInput={notify} onFocus={()=>callbacks.current.onExpand()} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing){e.preventDefault();if(e.shiftKey)insert('\n');else callbacks.current.onSubmit(e)}}} onPaste={e=>{if(disabled||running)return;e.preventDefault();const files=[...e.clipboardData.files];if(files.length)callbacks.current.onFiles(files);else insert(e.clipboardData.getData('text/plain'))}}/>;
});
