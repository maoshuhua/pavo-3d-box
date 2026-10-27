import {z} from 'zod';
import {lightTypes} from '../src/lightingSchema.js';
import {operationSchemas,worldSchema} from '../src/agentSchemas.js';
import {physicalMaterialFields,lightingSchema,cameraMotionSchema} from '../src/sceneEffectSchema.js';

const num=z.number().finite(), id=z.string().regex(/^[a-zA-Z0-9_:.-]{1,200}$/, 'ID 必须为 1–200 位 ASCII 字母、数字或 _ : . -；中文和空格请放在 name。');
const vec=z.tuple([num,num,num]), quat=z.tuple([num,num,num,num]);
const transform=z.object({position:vec.optional(),rotation:quat.optional(),scale:vec.optional()}).strict();
const geometry=z.object({type:z.enum(['box','plane','sphere','cylinder','cone','torus','capsule','buffer']),args:z.array(num).max(8).optional(),positions:z.array(num).max(1800000).optional(),indices:z.array(z.number().int().nonnegative()).max(1800000).optional()}).strict();
const material=z.object({color:z.string().regex(/^#[a-f\d]{6}$/i).optional(),baseColor:z.tuple([num,num,num,num]).optional(),metallic:num.min(0).max(1).optional(),roughness:num.min(0).max(1).optional(),emissive:z.string().regex(/^#[a-f\d]{6}$/i).optional(),...physicalMaterialFields}).strict();
const node=z.object({id,type:z.enum(['group','mesh','camera','light','asset']).optional(),name:z.string().min(1).max(128).optional(),parentId:id.nullable().optional(),visible:z.boolean().optional(),transform:transform.optional(),lookAt:vec.optional(),geometry:geometry.optional(),material:material.optional(),assetId:id.optional(),camera:z.object({fov:num.gt(0).lt(179).optional(),near:num.positive().optional(),far:num.positive().optional(),aspect:num.positive().optional()}).strict().optional(),light:z.object({type:z.enum(lightTypes),color:vec,intensity:num.nonnegative().max(1000000),castShadow:z.boolean().optional(),range:num.nonnegative().optional(),outerConeAngle:num.positive().optional(),innerConeAngle:num.nonnegative().optional(),groundColor:vec.optional(),width:num.positive().max(100000).optional(),height:num.positive().max(100000).optional(),decay:num.min(0).max(4).optional()}).strict().optional()}).strict();
export const sceneSchema=z.object({version:z.literal(1),mode:z.enum(['patch','replace']).default('patch'),objects:z.array(node).max(20000).default([]),remove:z.array(id).max(20000).default([]),world:worldSchema.optional(),lighting:lightingSchema.optional(),cameraMotion:z.array(cameraMotionSchema).max(100).default([]),timeline:operationSchemas['timeline.shots.set'].shape.timeline.optional(),animations:z.array(z.object({id,name:z.string().max(128),duration:num.positive().max(600),tracks:z.array(z.object({entityId:id,property:z.enum(['position','quaternion','scale']),times:z.array(num.nonnegative()).min(1).max(18000),values:z.array(num).max(72000)}).strict()).max(3000)}).strict()).max(100).default([]),operations:z.array(z.object({entityId:id,kind:z.string(),payload:z.record(z.string(),z.unknown())}).strict()).max(10000).default([])}).strict();

export function validateScene(spec,baseScene) {
  const parsed=sceneSchema.parse(spec), ids=new Set();
  for(const node of parsed.objects) {
    if(ids.has(node.id))throw Error(`Duplicate entity id: ${node.id}`);ids.add(node.id);
    if(node.camera?.near&&node.camera?.far&&node.camera.near>=node.camera.far)throw Error('Camera far must exceed near');
    if(node.geometry?.args){const start={box:3,plane:2,sphere:1,cylinder:3,cone:2,torus:2,capsule:2}[node.geometry.type]??8;
      const index=node.geometry.args.findIndex((v,i)=>Math.abs(v)>100000||(i>=start&&(v<1||v>256)));
      if(index!==-1)throw Error(`Geometry dimensions or segment count exceeds limit: object=${node.id}, geometry=${node.geometry.type}, args[${index}]=${node.geometry.args[index]}, allowed=${index>=start?'1..256':'-100000..100000'}`);}
  }
  // Validate the whole hierarchy before launching the renderer, so a missing
  // group does not require a separate render/retry for each dangling parent.
  const parents=new Map(parsed.mode==='patch'?(baseScene?.entities||[]).map(n=>[n.id,n.state?.parentId??null]):[]);
  const removed=new Set(parsed.remove);
  let changed=true;
  while(changed){changed=false;for(const [entityId,parentId] of parents)if(removed.has(parentId)&&!removed.has(entityId)){removed.add(entityId);changed=true;}}
  for(const entityId of removed)parents.delete(entityId);
  for(const n of parsed.objects)parents.set(n.id,n.parentId===undefined?(parents.get(n.id)??null):n.parentId);
  const hierarchyIssues=[];
  for(const [index,n] of parsed.objects.entries()){
    if(n.parentId!=null&&!parents.has(n.parentId)&&(parsed.mode==='replace'||Array.isArray(baseScene?.entities)))
      hierarchyIssues.push({code:'custom',path:['objects',index,'parentId'],message:`父节点不存在：${n.parentId}（对象 ${n.id}）。请在 objects 中创建对应 group，或使用已有实体 ID；根层级使用 null。`});
  }
  // Iterative walk avoids overflowing the host stack for deep scene trees.
  const checked=new Set();
  for(const start of parents.keys()){
    const chain=new Set();let next=start;
    while(next!=null&&parents.has(next)&&!checked.has(next)){
      if(chain.has(next)){hierarchyIssues.push({code:'custom',path:['objects'],message:`父子关系存在循环：${[...chain,next].join(' -> ')}`});break;}
      chain.add(next);next=parents.get(next);
    }
    for(const entityId of chain)checked.add(entityId);
  }
  if(hierarchyIssues.length)throw new z.ZodError(hierarchyIssues);
  for(const clip of parsed.animations)for(const track of clip.tracks){
    if(track.values.length!==track.times.length*(track.property==='quaternion'?4:3))throw Error(`Invalid animation samples: ${clip.id}`);
    if(track.times.some((v,i,a)=>i>0&&v<=a[i-1]) || track.times.at(-1)>clip.duration)throw Error(`Animation times must increase and fit duration: ${clip.id}`);
  }
  const motionIds=new Set();
  for(const motion of parsed.cameraMotion){
    if(motionIds.has(motion.id))throw Error('相机运动 ID 重复：'+motion.id);motionIds.add(motion.id);
    if(parsed.timeline&&motion.end>parsed.timeline.duration)throw Error('相机运动超出时间轴');
  }
  if(Array.isArray(parsed.lighting))for(const rig of parsed.lighting)for(const light of rig.lights||[])if(parsed.timeline&&light.keyframes?.at(-1)?.time>parsed.timeline.duration)throw Error('灯光关键帧超出时间轴');
  for(const node of parsed.objects)if(node.light){const l=node.light;if(l.castShadow&&['area','hemisphere','ambient'].includes(l.type))throw Error('该灯型不支持投影');if(l.outerConeAngle!==undefined&&(l.outerConeAngle>=Math.PI/2||(l.innerConeAngle??0)>l.outerConeAngle))throw Error('聚光角度无效');}
  for(const op of parsed.operations){if(!Object.hasOwn(operationSchemas,op.kind))throw Error(`Unsupported operation: ${op.kind}`);op.payload=operationSchemas[op.kind].parse(op.payload);}
  return parsed;
}
