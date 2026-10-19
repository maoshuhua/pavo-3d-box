import {z} from 'zod';
import {operationSchemas,worldSchema} from '../src/agentSchemas.js';

const num=z.number().finite(), id=z.string().regex(/^[a-zA-Z0-9_:.-]{1,200}$/);
const vec=z.tuple([num,num,num]), quat=z.tuple([num,num,num,num]);
const transform=z.object({position:vec.optional(),rotation:quat.optional(),scale:vec.optional()}).strict();
const geometry=z.object({type:z.enum(['box','plane','sphere','cylinder','cone','torus','capsule','buffer']),args:z.array(num).max(8).optional(),positions:z.array(num).max(1800000).optional(),indices:z.array(z.number().int().nonnegative()).max(1800000).optional()}).strict();
const material=z.object({color:z.string().regex(/^#[a-f\d]{6}$/i).optional(),baseColor:z.tuple([num,num,num,num]).optional(),metallic:num.min(0).max(1).optional(),roughness:num.min(0).max(1).optional(),emissive:z.string().regex(/^#[a-f\d]{6}$/i).optional()}).strict();
const node=z.object({id,type:z.enum(['group','mesh','camera','light','asset']).optional(),name:z.string().min(1).max(128).optional(),parentId:id.nullable().optional(),visible:z.boolean().optional(),transform:transform.optional(),lookAt:vec.optional(),geometry:geometry.optional(),material:material.optional(),assetId:id.optional(),camera:z.object({fov:num.gt(0).lt(179).optional(),near:num.positive().optional(),far:num.positive().optional(),aspect:num.positive().optional()}).strict().optional(),light:z.object({type:z.enum(['directional','point','spot']),color:vec,intensity:num.nonnegative(),castShadow:z.boolean().optional(),range:num.nonnegative().optional(),outerConeAngle:num.positive().optional(),innerConeAngle:num.nonnegative().optional()}).strict().optional()}).strict();
export const sceneSchema=z.object({version:z.literal(1),mode:z.enum(['patch','replace']).default('patch'),objects:z.array(node).max(20000).default([]),remove:z.array(id).max(20000).default([]),world:worldSchema.optional(),timeline:operationSchemas['timeline.shots.set'].shape.timeline.optional(),animations:z.array(z.object({id,name:z.string().max(128),duration:num.positive().max(600),tracks:z.array(z.object({entityId:id,property:z.enum(['position','quaternion','scale']),times:z.array(num.nonnegative()).min(1).max(18000),values:z.array(num).max(72000)}).strict()).max(3000)}).strict()).max(100).default([]),operations:z.array(z.object({entityId:id,kind:z.string(),payload:z.record(z.string(),z.unknown())}).strict()).max(10000).default([])}).strict();

export function validateScene(spec) {
  const parsed=sceneSchema.parse(spec), ids=new Set();
  for(const node of parsed.objects) {
    if(ids.has(node.id))throw Error(`Duplicate entity id: ${node.id}`);ids.add(node.id);
    if(node.camera?.near&&node.camera?.far&&node.camera.near>=node.camera.far)throw Error('Camera far must exceed near');
    if(node.geometry?.args){const start={box:3,plane:2,sphere:1,cylinder:3,cone:2,torus:2,capsule:2}[node.geometry.type]??8;
      if(node.geometry.args.some((v,i)=>Math.abs(v)>100000||(i>=start&&(v<1||v>256))))throw Error('Geometry dimensions or segment count exceeds limit');}
  }
  for(const clip of parsed.animations)for(const track of clip.tracks){
    if(track.values.length!==track.times.length*(track.property==='quaternion'?4:3))throw Error(`Invalid animation samples: ${clip.id}`);
    if(track.times.some((v,i,a)=>i>0&&v<=a[i-1]) || track.times.at(-1)>clip.duration)throw Error(`Animation times must increase and fit duration: ${clip.id}`);
  }
  for(const op of parsed.operations){if(!Object.hasOwn(operationSchemas,op.kind))throw Error(`Unsupported operation: ${op.kind}`);op.payload=operationSchemas[op.kind].parse(op.payload);}
  return parsed;
}

