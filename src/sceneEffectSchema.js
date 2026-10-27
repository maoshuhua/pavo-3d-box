import {cameraPathPresetIds} from './cameraPathPresets.js';
import {z} from 'zod';
import {lightingRigsSchema} from './lightingSchema.js';
const num=z.number().finite(),vec=z.tuple([num,num,num]),hex=z.string().regex(/^#[a-f\d]{6}$/i);
export const worldSettingsSchema=z.object({
 type:z.literal('solid'),color:vec,strength:num.nonnegative(),
 exposure:num.min(.05).max(10).optional(),toneMapping:z.enum(['aces','none']).optional(),
 environment:z.object({preset:z.enum(['solid','studio']),color:vec.optional(),strength:num.min(0).max(10)}).strict().optional()
});
export const physicalMaterialFields={
 transmission:num.min(0).max(1).optional(),thickness:num.min(0).max(100).optional(),ior:num.min(1).max(2.333).optional(),
 clearcoat:num.min(0).max(1).optional(),clearcoatRoughness:num.min(0).max(1).optional(),
 attenuationColor:hex.optional(),attenuationDistance:num.positive().max(100000).optional()
};
const legacyLightingSchema=z.object({preset:z.literal('product'),id:z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),subjectIds:z.array(z.string()).min(1).max(100),
 key:z.object({color:hex.optional(),intensity:num.min(0).max(20).optional()}).strict().optional(),
 fillRatio:num.min(0).max(2).optional(),rimRatio:num.min(0).max(3).optional(),shadows:z.enum(['soft','none']).optional()
}).strict();
export const lightingSchema=z.union([lightingRigsSchema,legacyLightingSchema]);
const aimSchema=z.object({mode:z.enum(['target','tangent','fixed']),entityId:z.string().optional(),point:vec.optional(),offset:vec.optional()}).strict().refine(a=>!(a.entityId&&a.point),'注视目标不能同时指定实体和点');
export const cameraMotionSchema=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]+$/),cameraId:z.string(),presetId:z.enum([...cameraPathPresetIds,'custom']),
 subjectIds:z.array(z.string()).max(100).default([]),start:num.min(0).max(600),end:num.min(.1).max(600),
 origin:vec.optional(),aim:aimSchema.optional(),
 path:z.object({points:z.array(vec).min(2).max(128),curve:z.enum(['centripetal','chordal','catmullrom']).default('centripetal'),tension:num.min(0).max(1).default(.5),closed:z.boolean().default(false)}).strict().optional(),
 follow:z.object({entityId:z.string(),positionSpace:z.enum(['world','subject']).default('world'),offset:vec.default([0,0,0])}).strict().optional(),
 easing:z.enum(['linear','in','out','inout']).optional(),intensity:num.min(.25).max(2).optional(),framing:z.enum(['close','medium','wide']).optional(),
 speed:num.min(-10).max(10).optional(),bounce:z.boolean().optional(),roll:num.min(-360).max(360).optional(),margin:num.min(1).max(3).default(1.15)
}).strict().superRefine((m,ctx)=>{
 if(m.end-m.start<.1)ctx.addIssue({code:'custom',message:'相机运动至少持续 0.1 秒'});
 if(m.presetId==='custom'&&!m.path)ctx.addIssue({code:'custom',message:'自定义路径必须提供 path.points'});
 if(m.presetId!=='custom'&&m.path)ctx.addIssue({code:'custom',message:'预设路径不能同时指定自定义点'});
 if(m.presetId!=='custom'&&!m.subjectIds.length&&!m.origin)ctx.addIssue({code:'custom',message:'预设路径需要取景主体或显式起点'});
});
const rigNode=z.object({id:z.string(),name:z.string(),transform:z.object({position:vec,rotation:z.tuple([num,num,num,num]),scale:vec})});
export const cameraRigPathSchema=rigNode.extend({settings:z.record(z.string(),z.unknown()),waypoints:z.array(rigNode),anchor:z.object({origin:vec,focus:vec,radius:num}).nullable(),aim:rigNode.nullable(),focus:rigNode.nullable(),focusParent:z.enum(['aim','path'])});
