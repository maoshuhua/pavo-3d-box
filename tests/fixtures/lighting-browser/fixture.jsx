import React from 'react';
import {createRoot} from 'react-dom/client';
import {createViewport} from '/src/glb.js';
import SceneInspector from '/src/SceneInspector.jsx';
import '/src/style.css';

const panel=createRoot(document.getElementById('panel'));
let viewer;
window.edits=[];
window.errors=[];
viewer=createViewport(document.getElementById('stage'),details=>{
 window.details=details;
 queueMicrotask(()=>panel.render(<SceneInspector details={details} editor={viewer} bottom={0} width={320} onWidth={()=>{}} onError={message=>window.errors.push(message)} onRequestDelete={row=>viewer.deleteEntity(row.id)}/>));
},{onEdit:operation=>{if(operation)window.edits.push(structuredClone(operation));}});
window.viewer=viewer;
viewer.addElement('box',false);
viewer.addElement('camera',false);
viewer.select(null);
