// Shared by the editor, scene compiler and Agent API catalogue.
export const lightingPresets = [
  {id:'balanced',label:'柔和均衡',description:'低反差的侧上方主光、补光与环境底光',key:[-1.2,1.6,1.4],fill:.55,ambient:.28},
  {id:'side-shaping',label:'单侧塑形',description:'侧向主光塑造体积，保留暗部',key:[-1.8,1,.7],fill:.18,ambient:.12},
  {id:'high-contrast',label:'强反差',description:'集中主光与较弱底光，突出明暗关系',key:[-1.4,1.4,.8],fill:.06,ambient:.04},
  {id:'backlight',label:'逆光分离',description:'后上方主光与正面弱补光',key:[.3,1.3,-1.6],fill:.3,ambient:.12},
  {id:'top',label:'顶部照明',description:'顶部主光与轻微正面补光',key:[0,2,.1],fill:.2,ambient:.12},
  {id:'underlight',label:'底部照明',description:'下方主光形成向上照明',key:[0,-1.4,1],fill:.1,ambient:.06},
  {id:'cross',label:'交叉光',description:'左右交叉照明，形成双向轮廓',key:[-1.4,1,1],fill:.75,ambient:.12},
  {id:'focused',label:'局部聚焦',description:'聚光灯限定照射范围，背景保持较暗',key:[-.6,1.8,1.2],fill:.08,ambient:.04,spot:true},
  {id:'natural',label:'自然环境光',description:'方向光搭配天空与地面半球光',key:[-1,2,1],fill:0,ambient:.55,sun:true},
  {id:'practical',label:'场景光源',description:'以指定场景内实体位置为局部光源，辅以弱底光',key:[0,1,0],fill:0,ambient:.08,practical:true},
];
export const lightingPresetIds=lightingPresets.map(p=>p.id);
export const listLightingPresets=()=>lightingPresets.map(({id,label,description})=>({id,label,description}));
