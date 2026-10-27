import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveApiBase,resolveServiceData,resolveServiceUrl} from '../src/serviceUrls.js';
import {allowedOrigin,requestBase,publicServiceData} from '../server/serviceUrls.js';
import {BASE} from '../server/config.js';
test('local and public pages default to same origin; separate APIs remain configurable',()=>{
 for(const origin of ['http://localhost:5173','http://192.168.1.5:5173','https://pavo-box.agnes-dev.com']) assert.equal(resolveApiBase('',origin),origin);
 assert.equal(resolveApiBase('https://api.example.com/','https://app.example.com'),'https://api.example.com');
});
test('legacy GLB, JSON, previews and upload URLs follow the selected service',()=>{
 const base='https://pavo-box.agnes-dev.com';
 for(const path of ['/artifacts/p/t/model.glb','/artifacts/p/t/collaboration.json','/artifacts/p/t/preview-a.png','/local-assets/a','/local-upload/a/part/1','/api/studio/p/snapshot/1/studio.glb']){
  assert.equal(resolveServiceUrl('http://127.0.0.1:8788'+path,base),base+path);
  assert.equal(resolveServiceUrl(path,base),base+path);
 }
 const record=resolveServiceData({config:JSON.stringify({glbUrl:'http://localhost:8787/artifacts/p/t/model.glb'})},base);
 assert.equal(JSON.parse(record.config).glbUrl,base+'/artifacts/p/t/model.glb');
 assert.equal(resolveServiceUrl('https://cdn.example.com/model.glb',base),'https://cdn.example.com/model.glb');
 assert.equal(resolveServiceUrl('blob:example',base),'blob:example');
});
test('public JSON uses request host while internal URLs remain unchanged',()=>{
 const req={headers:{host:'pavo-box.agnes-dev.com'},protocol:'https'};
 assert.equal(requestBase(req),'https://pavo-box.agnes-dev.com');
 assert.ok(allowedOrigin('https://pavo-box.agnes-dev.com',req));
 assert.ok(!allowedOrigin('https://unrelated.example.com',req));
 const data={glbUrl:BASE+'/artifacts/p/t/model.glb'};
 assert.equal(publicServiceData(data,requestBase(req)).glbUrl,'https://pavo-box.agnes-dev.com/artifacts/p/t/model.glb');
 assert.equal(data.glbUrl,BASE+'/artifacts/p/t/model.glb');
});

test('HTTPS pages upgrade managed same-host HTTP resources behind TLS proxies',()=>{
 const base='https://pavo-box.agnes-dev.com';
 for(const file of ['studio.glb','studio-collaboration.json']){
  const path='/api/studio/p/snapshot/15/'+file;
  assert.equal(resolveServiceUrl('http://pavo-box.agnes-dev.com'+path,base),base+path);
 }
 assert.equal(resolveServiceUrl('http://cdn.example.com/file.glb',base),'http://cdn.example.com/file.glb');
});
