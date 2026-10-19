import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {PDFParse} from 'pdf-parse';
import {unzipSync} from 'fflate';
import * as XLSX from 'xlsx';
import WordExtractor from 'word-extractor';
import {atomicWrite} from './storage.js';
import {BASE,MAX_ATTACHMENT} from './config.js';
import {normalizeUploadName} from './filename.js';

export function validateGlb(bytes){
 if(bytes.length<20||bytes.length>100*1024*1024||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid glTF 2.0 GLB');
}
export async function saveAttachments(files,dir,projectId){
 const assets=[];
 for(const file of files){
  if(file.buffer.length>MAX_ATTACHMENT)throw Error('附件不能超过 20 MiB');
  const name=path.basename(normalizeUploadName(file.originalname)),ext=path.extname(name).toLowerCase(),id=crypto.randomUUID();
  let kind,text,mime=file.mimetype;
  if(['.png','.jpg','.jpeg','.webp','.gif','.avif','.bmp','.svg'].includes(ext)){kind='image';mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.bmp':'image/bmp','.svg':'image/svg+xml'}[ext];}
  else if(ext==='.glb'){validateGlb(file.buffer);kind='glb';mime='model/gltf-binary';}
  else if(['.txt','.md','.json','.csv'].includes(ext)){kind='document';text=file.buffer.toString('utf8');}
  else if(ext==='.pdf'){kind='document';const parser=new PDFParse({data:file.buffer});try{text=(await parser.getText()).text;}finally{await parser.destroy();}}
  else if(ext==='.doc'){kind='document';const document=await new WordExtractor().extract(file.buffer);text=document.getBody();}
  else if(ext==='.docx'){
   kind='document';const entry=unzipSync(new Uint8Array(file.buffer),{filter:f=>f.name==='word/document.xml'&&f.originalSize<=MAX_ATTACHMENT})['word/document.xml'];
   if(!entry)throw Error('DOCX 正文缺失或过大。');
   const xml=new TextDecoder().decode(entry);text=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')).join(' ');
  }
  else if(ext==='.xlsx'||ext==='.xls'){
   kind='document';const book=XLSX.read(file.buffer,{type:'buffer',sheetRows:3000,cellFormula:false});
   text=book.SheetNames.slice(0,20).map(name=>`工作表 ${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name])}`).join('\n\n');
  }
  else throw Error(`暂不支持附件格式 ${ext}；可上传图片、GLB、PDF、DOC、DOCX、XLS、XLSX、TXT、MD、JSON、CSV。`);
  const filename=id+ext,local=path.join(dir,'uploads',filename);
  await atomicWrite(local,file.buffer);
  assets.push({id,name,kind,mime,file:local,url:`${BASE}/uploads/${projectId}/${filename}`,...text?{text:text.slice(0,120000),textTruncated:text.length>120000}:{}});
 }
 return assets;
}

