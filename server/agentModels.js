import {selectedAgentModel} from '../src/agentModels.js';

const names=value=>String(value||'').split(/[,，\r\n]+/).map(name=>name.trim()).filter(Boolean);

export function agentModels(env=process.env) {
 const explicit=names(env.AGENT_MODELS);
 const configured=explicit.length?explicit:[...names(env.AGENT_MODEL),...names(env.AGENT_MODEL_G6),...names(env.AGENT_MODEL_DV4)];
 const models=[...new Set(configured)];
 const legacyTarget=key=>{const alias=names(env[`AGENT_MODEL_${key}`])[0];return models.includes(alias)?alias:models[0];};
 return models.map(name=>({key:name,name,isVip:false,version:'',legacyKeys:['G6','DV4'].filter(key=>legacyTarget(key)===name)}));
}

export function resolveAgentModel(key,env=process.env) {
 const model=selectedAgentModel(agentModels(env),key);
 if(!model)throw Error('请在 .env 配置 AGENT_MODEL 或 AGENT_MODELS。');
 return model.key;
}
