import {defineConfig,loadEnv} from 'vite';
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),'');
  const target=`http://127.0.0.1:${env.AGENT_PORT || 8787}`;
  const proxy=Object.fromEntries(['/api','/gateway','/artifacts','/local-assets','/local-upload','/uploads','/runtime','/three','/zod','/draco','/ws'].map(route=>[route,{target,ws:route==='/ws'}]));
  const allowedHosts=['pavo-box.agnes-dev.com',...(env.VITE_ALLOWED_HOSTS || '').split(',').map(host=>host.trim()).filter(Boolean)];
  return {server:{proxy,allowedHosts},preview:{proxy,allowedHosts}};
});
