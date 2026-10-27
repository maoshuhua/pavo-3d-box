// Shared by the editor, Agent schema and generated API documentation.
function eox({ three: e, origin: t, focus: n, radius: r }) {
  let i = new e.Vector3(0, 1, 0),
    o = new e.Vector3().subVectors(t, n);
  1e-8 > o.lengthSq() && o.set(0, 0, Math.max(r, 1));
  let a = new e.Vector3().crossVectors(i, o);
  1e-8 > a.lengthSq() ? a.set(1, 0, 0) : a.normalize();
  let l = new e.Vector3(o.x, 0, o.z);
  return (
    1e-8 > l.lengthSq() ? l.crossVectors(a, i).normalize() : l.normalize(),
    {
      focus: n.clone(),
      offset: o,
      radius: Math.max(r, 0.001),
      up: i,
      right: a,
      horizontal: l,
      height: o.y,
    }
  );
}
function eow(e, t, n = 1, r = 0) {
  let i = e.offset.clone().applyAxisAngle(e.up, t).multiplyScalar(n);
  return ((i.y += e.radius * r), i.add(e.focus));
}
function eoS(e, t, n = 0, r = 0) {
  let i = e.offset.clone().multiplyScalar(t);
  return (
    (i.y += e.radius * n),
    i.add(e.right.clone().multiplyScalar(e.radius * r)),
    i.add(e.focus)
  );
}
function eok(e, t) {
  return t <= 1 ? 0 : e / (t - 1);
}
const RH = 2 * Math.PI;
const RU = [{id:"orbit-360",label:"Orbit 360",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:8},(e,n)=>eow(t,n/8*RH)),settings:{aim:"target",closed:!0,easing:"linear",duration:12}}}},{id:"orbit-half",label:"Orbit 180",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>eow(t,(eok(n,5)-.5)*Math.PI)),settings:{aim:"target",duration:8}}}},{id:"arc-left",label:"Arc left",group:"orbit",build:e=>{let t=eox(e);return{points:[.55,0,-.55].map((e,n)=>eow(t,e,1,.12*(1===n))),settings:{aim:"target",duration:6}}}},{id:"arc-right",label:"Arc right",group:"orbit",build:e=>{let t=eox(e);return{points:[-.55,0,.55].map((e,n)=>eow(t,e,1,.12*(1===n))),settings:{aim:"target",duration:6}}}},{id:"spiral-up",label:"Spiral up",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:10},(e,n)=>{let r=eok(n,10);return eow(t,r*RH*1.5,1-.35*r,.9*r)}),settings:{aim:"target",easing:"linear",duration:14}}}},{id:"spiral-down",label:"Spiral down",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:10},(e,n)=>{let r=eok(n,10);return eow(t,-r*RH*1.5,1+.35*r,.9-.9*r)}),settings:{aim:"target",easing:"linear",duration:14}}}},{id:"figure-eight",label:"Figure eight",group:"orbit",build:e=>{let t=eox(e);return{points:Array.from({length:8},(e,n)=>{let r=n/8*RH,i=t.horizontal.clone().multiplyScalar(.5*t.radius*Math.sin(2*r));return i.add(t.right.clone().multiplyScalar(t.radius*Math.sin(r))),i.y=t.height,i.add(t.focus)}),settings:{aim:"target",closed:!0,easing:"linear",duration:16}}}},{id:"dolly-in",label:"Dolly in",group:"dolly",build:e=>{let t=eox(e);return{points:[1.6,1.1,.6].map(e=>eoS(t,e)),settings:{aim:"target",duration:6}}}},{id:"dolly-out",label:"Dolly out",group:"dolly",build:e=>{let t=eox(e);return{points:[.6,1.1,1.6].map(e=>eoS(t,e)),settings:{aim:"target",duration:6}}}},{id:"push-in-low",label:"Low push in",group:"dolly",build:e=>{let t=eox(e);return{points:[eoS(t,1.7,-.35),eoS(t,1.1,-.1),eoS(t,.65,.15)],settings:{aim:"target",easing:"out",duration:7}}}},{id:"truck-left",label:"Truck left",group:"dolly",build:e=>{let t=eox(e);return{points:[.9,0,-.9].map(e=>eoS(t,1,0,e)),settings:{aim:"target",duration:7}}}},{id:"truck-right",label:"Truck right",group:"dolly",build:e=>{let t=eox(e);return{points:[-.9,0,.9].map(e=>eoS(t,1,0,e)),settings:{aim:"target",duration:7}}}},{id:"s-curve",label:"S curve",group:"dolly",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>{let r=eok(n,5);return eoS(t,1.5-.9*r,0,.35*Math.sin(r*RH))}),settings:{aim:"tangent",duration:8}}}},{id:"crane-up",label:"Crane up",group:"crane",build:e=>{let t=eox(e);return{points:[eoS(t,1.15,-.4),eoS(t,1,.25),eoS(t,.95,.95)],settings:{aim:"target",duration:8}}}},{id:"crane-down",label:"Crane down",group:"crane",build:e=>{let t=eox(e);return{points:[eoS(t,.95,.95),eoS(t,1,.25),eoS(t,1.15,-.4)],settings:{aim:"target",duration:8}}}},{id:"flyover",label:"Flyover",group:"aerial",build:e=>{let t=eox(e);return{points:[eoS(t,1.8,-.15),eoS(t,.8,.7),eoS(t,-.2,1.1),eoS(t,-1.2,.6)],settings:{aim:"target",easing:"linear",duration:10}}}},{id:"drone-pullback",label:"Drone pullback",group:"aerial",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>{let r=eok(n,5);return eoS(t,.5+1.8*r,-.2+1.1*r)}),settings:{aim:"target",easing:"in",duration:10}}}},{id:"reveal-behind",label:"Reveal",group:"reveal",build:e=>{let t=eox(e);return{points:Array.from({length:5},(e,n)=>{let r=eok(n,5);return eow(t,(1-r)*Math.PI*.75,1.3-.3*r,-.3+.3*r)}),settings:{aim:"target",easing:"out",duration:9}}}}];

const labels={"orbit-360": {"label": "环绕360°", "description": "环绕主体一整圈"}, "orbit-half": {"label": "半环绕", "description": "围绕主体半圈"}, "arc-left": {"label": "左弧线", "description": "沿弧线向左移动"}, "arc-right": {"label": "弧线", "description": "围绕主体扫过"}, "spiral-up": {"label": "螺旋上升", "description": "围绕主体向上移动"}, "spiral-down": {"label": "螺旋下降", "description": "围绕主体向下移动"}, "figure-eight": {"label": "八字", "description": "沿八字曲线移动"}, "dolly-in": {"label": "推进", "description": "聚焦主体"}, "dolly-out": {"label": "拉远", "description": "逐步展开视野"}, "push-in-low": {"label": "低位推进", "description": "低机位向主体靠近"}, "truck-left": {"label": "横移", "description": "横向穿过场景"}, "truck-right": {"label": "右横移", "description": "横向向右移动"}, "s-curve": {"label": "S曲线", "description": "沿S形路线移动"}, "crane-up": {"label": "升降", "description": "升高并展开视野"}, "crane-down": {"label": "下降", "description": "降低机位"}, "flyover": {"label": "飞越", "description": "从场景上方飞过"}, "drone-pullback": {"label": "航拍拉远", "description": "拉远并升高"}, "reveal-behind": {"label": "揭示", "description": "从后方显露"}};
export const cameraPathPresets=RU.map(p=>({...p,...labels[p.id]}));
export const cameraPathPresetIds=cameraPathPresets.map(p=>p.id);
const previews={"arc-right": "M 8 31 Q 34 2 72 25", "dolly-in": "M 8 31 L 72 12", "truck-left": "M 72 25 Q 40 14 8 25", "crane-up": "M 10 33 Q 30 32 70 7", "flyover": "M 8 32 Q 38 2 72 17", "reveal-behind": "M 8 34 C 14 5 55 5 72 25"};
export const commonCameraMotions=Object.keys(previews).map(id=>{const p=cameraPathPresets.find(p=>p.id===id);return [id,p.label,p.description,previews[id]];});
export const listMotionPresets=()=>cameraPathPresets.map(({id,label,description,group})=>({id,label,description,group}));
