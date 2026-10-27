import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('Vite proxy uses the same backend port despite Vite-specific env overrides',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-proxy-'));
 try{
  await fs.writeFile(path.join(dir,'.env'),'AGENT_PORT=8788\n');
  await fs.writeFile(path.join(dir,'.env.local'),'AGENT_PORT=9999\n');
  const env={...process.env};delete env.AGENT_PORT;delete env.DOTENV_CONFIG_PATH;
  const configUrl=new URL('../vite.config.js',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`import config from ${JSON.stringify(configUrl)}; console.log(JSON.stringify(config({mode:'development'})));`],{cwd:dir,env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const config=JSON.parse(result.stdout);
  assert.equal(config.server.proxy['/api'].target,'http://127.0.0.1:8788');
  assert.equal(config.preview.proxy['/api'].target,'http://127.0.0.1:8788');
  assert.ok(config.server.allowedHosts.includes('pavo-box.agnes-dev.com'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
