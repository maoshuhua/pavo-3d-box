import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zipSync,strToU8} from 'fflate';
import * as XLSX from 'xlsx';
import {saveAttachments} from '../server/uploads.js';

test('local attachments extract DOCX, XLSX and UTF-8 text without uploading externally',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'3dbox-upload-'));
 try{
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['节点','位置'],['相机',3]]),'场景');
  const files=[{originalname:'scene.md',buffer:Buffer.from('机位跟拍'),mimetype:'text/plain'},{originalname:'scene.docx',buffer:Buffer.from(zipSync({'word/document.xml':strToU8('<w:document><w:t>镜头 &amp; 场景</w:t></w:document>')})),mimetype:'application/octet-stream'},{originalname:'scene.xlsx',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'}),mimetype:'application/octet-stream'}];
  const result=await saveAttachments(files,dir,'test-project');assert.equal(result.length,3);assert(result[0].text.includes('跟拍'));assert(result[1].text.includes('镜头 & 场景'));assert(result[2].text.includes('相机'));
  for(const asset of result)assert((await fs.stat(asset.file)).size>0);
  await assert.rejects(()=>saveAttachments([{originalname:'bad.exe',buffer:Buffer.from('bad')}],dir,'test-project'),/暂不支持/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
