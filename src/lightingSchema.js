import {z} from 'zod';
import {lightingPresetIds} from './lightingPresets.js';
const n=z.number().finite(),id=z.string().regex(/^[a-zA-Z0-9_:.-]{1,200}$/),vec=z.tuple([n,n,n]);
const color=z.string().regex(/^#[a-f\d]{6}$/i);
export const lightTypes=['directional','point','spot','area','hemisphere','ambient'];
export const lightPropertiesSchema=z.object({
 type:z.enum(lightTypes),color:color.default('#ffffff'),intensity:n.min(0).max(1000000).default(1),
 groundColor:color.optional(),range:n.min(0).max(100000).optional(),decay:n.min(0).max(4).optional(),
 angle:n.gt(0).lt(90).optional(),penumbra:n.min(0).max(1).optional(),width:n.positive().max(100000).optional(),height:n.positive().max(100000).optional(),
 castShadow:z.boolean().default(false),shadow:z.object({mapSize:z.union([z.literal(512),z.literal(1024),z.literal(2048),z.literal(4096)]).optional(),bias:n.min(-1).max(1).optional(),normalBias:n.min(0).max(10).optional(),radius:n.min(0).max(20).optional()}).strict().optional(),
}).strict().superRefine((p,ctx)=>{if(p.castShadow&&['area','hemisphere','ambient'].includes(p.type))ctx.addIssue({code:'custom',message:'面积光、半球光和环境光不支持投影'});});
const target=z.object({entityId:id.optional(),point:vec.optional(),follow:z.boolean().default(false)}).strict().refine(t=>!!t.entityId!==!!t.point,'目标须且只能提供 entityId 或 point');
const frame=z.object({time:n.min(0).max(600),position:vec.optional(),color:color.optional(),intensity:n.min(0).max(1000000).optional()}).strict();
export const authoredLightSchema=z.object({
 id,name:z.string().min(1).max(512).optional(),label:z.string().min(1).max(128).optional(),role:z.enum(['key','fill','separation','ambient','practical','bounce','background']).default('key'),
 properties:lightPropertiesSchema,position:vec.default([0,0,0]),rotation:z.tuple([n,n,n,n]).optional(),target:target.optional(),
 sourceEntityId:id.optional(),enabled:z.boolean().default(true),locked:z.boolean().default(false),
 keyframes:z.array(frame).max(1000).optional(),
}).strict().superRefine((l,ctx)=>{if(l.keyframes?.some((f,i,a)=>i&&f.time<=a[i-1].time))ctx.addIssue({code:'custom',message:'灯光关键帧时间须严格递增'});});
export const lightingRigSchema=z.object({
 id,name:z.string().min(1).max(128).optional(),presetId:z.enum([...lightingPresetIds,'custom']),
 subjectIds:z.array(id).max(100).default([]),origin:vec.optional(),rotation:z.tuple([n,n,n,n]).optional(),scale:n.positive().max(100000).optional(),
 reference:z.object({space:z.enum(['world','subject','camera']).default('world'),entityId:id.optional(),cameraId:id.optional(),follow:z.boolean().default(false)}).strict().default({space:'world',follow:false}),
 sourceIds:z.array(id).max(32).default([]),
 contrast:n.min(0).max(1).optional(),softness:n.min(0).max(1).default(.7),intensity:n.min(0).max(20).default(1),temperature:n.min(1000).max(15000).default(5500),
 shadows:z.enum(['soft','none']).default('soft'),enabled:z.boolean().default(true),locked:z.boolean().default(false),
 lights:z.array(authoredLightSchema).max(64).optional(),
}).strict().superRefine((r,ctx)=>{
 const issue=message=>ctx.addIssue({code:'custom',message});
 if(r.presetId==='custom'&&!r.lights?.length)issue('自定义布光需要 lights');
 if(r.presetId!=='custom'&&r.lights)issue('预设布光不能同时指定 lights，请先转为自定义');
 if(r.presetId!=='custom'&&!r.subjectIds.length&&!r.origin)issue('预设布光需要 subjectIds 或 origin');
 if(r.presetId==='practical'&&!r.sourceIds.length)issue('场景光源预设需要 sourceIds');
 if(r.reference.space==='camera'&&!r.reference.cameraId)issue('摄像机参考需要 cameraId');
 if(r.reference.space==='subject'&&!r.reference.entityId&&!r.subjectIds.length)issue('主体参考需要 entityId 或 subjectIds');
 const ids=new Set();for(const l of r.lights||[]){if(ids.has(l.id))issue('灯光 ID 重复：'+l.id);ids.add(l.id);}
});
export const lightingRigsSchema=z.array(lightingRigSchema).max(32).superRefine((rigs,ctx)=>{
 const ids=new Set();for(const r of rigs){if(ids.has(r.id))ctx.addIssue({code:'custom',message:'布光组 ID 重复：'+r.id});ids.add(r.id);}
});
export const lightingRigStateSchema=z.object({config:lightingRigSchema,transform:z.object({position:vec,rotation:z.tuple([n,n,n,n]),scale:vec}).strict(),lights:z.array(authoredLightSchema).max(64),binding:z.object({entityId:id,center:vec}).strict().nullable().optional(),shadowBounds:z.object({center:vec,radius:n.positive()}).strict().optional()}).strict();
