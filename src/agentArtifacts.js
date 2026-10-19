import {resultSchema, collaborationSchema, operationSchemas, worldSchema} from './agentSchemas.js';
import {readGlb,saveAsset} from './glb.js';

// libtv loadGeneratedPreview: validate result, checkpoint and accepted operations.
export async function loadAgentArtifacts(value, signal) {
  const result=resultSchema.parse(value);
  const [glbResponse,jsonResponse]=await Promise.all([fetch(result.glb_url,{signal,credentials:'omit'}),fetch(result.collaboration_url,{signal,credentials:'omit'})]);
  if(!glbResponse.ok||!jsonResponse.ok)throw Error('Agent 场景文件下载失败。');
  const [blob,text]=await Promise.all([glbResponse.blob(),jsonResponse.text()]);
  const bytes=await readGlb(new File([blob],'agent.glb'));
  if(result.glb_size!==undefined&&bytes.byteLength!==result.glb_size)throw Error('GLB 文件大小不匹配。');
  if(result.glb_sha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==result.glb_sha256.toLowerCase())throw Error('GLB 校验失败。');}
  if(text.length>0x1400000)throw Error('Agent JSON 文件过大。');
  const json=collaborationSchema.parse(JSON.parse(text)),checkpoint=json.checkpoint?.sequence??-1;
  const operations=json.operations.filter(op=>op.status==='accepted'&&op.sequence>checkpoint).sort((a,b)=>a.sequence-b.sequence).map(op=>{
    if(!Object.hasOwn(operationSchemas,op.kind))throw Error('不支持的场景操作：'+op.kind);
    return {...op,payload:operationSchemas[op.kind].parse(op.payload)};
  });
  const world=json.entities.find(e=>e.kind==='world'&&!e.deleted);
  if(world&&!operations.some(op=>op.kind==='world.settings.set'))operations.unshift({kind:'world.settings.set',entityId:world.id,payload:{settings:worldSchema.parse(world.state.settings)}});
  const timeline=json.entities.find(e=>e.kind==='timeline'&&!e.deleted);
  if(timeline&&!operations.some(op=>op.kind==='timeline.shots.set'))operations.push({kind:'timeline.shots.set',entityId:timeline.id,payload:operationSchemas['timeline.shots.set'].parse({timeline:timeline.state.timeline})});
  for(const entity of json.entities.filter(e=>e.kind==='light'&&!e.deleted)){
    if(entity.state.properties&&!operations.some(op=>op.entityId===entity.id&&(op.kind==='light.create'||op.kind==='light.properties.set')))operations.push({kind:'light.properties.set',entityId:entity.id,payload:operationSchemas['light.properties.set'].parse({properties:entity.state.properties})});
  }
  const assets=new Map();let total=bytes.byteLength;
  for(const op of operations){if(op.kind!=='object.create.from_glb')continue;const url=op.payload.assetId;
    if(!assets.has(url)){if(assets.size>=32)throw Error('Agent 资源数量超限。');const response=await fetch(url,{signal,credentials:'omit'});if(!response.ok)throw Error('Agent 资源下载失败。');const data=await readGlb(new File([await response.blob()],'asset.glb'));total+=data.byteLength;if(total>100*1024*1024)throw Error('Agent 资源总大小超限。');signal.throwIfAborted();const id=crypto.randomUUID();await saveAsset({name:'agent-asset.glb'},data,id);assets.set(url,id);}
    op.payload={...op.payload,assetId:assets.get(url)};
  }
  signal.throwIfAborted();return {bytes,operations,result};
}
