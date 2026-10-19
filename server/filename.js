// Busboy decodes multipart filenames as Latin-1. Only undo a valid, lossless
// UTF-8 decoding; names already supplied through JSON/URL APIs stay unchanged.
export function normalizeUploadName(name='') {
 const value=String(name);
 if(!/^[\u0000-\u00ff]*$/.test(value)||!/[\u0080-\u00ff]/.test(value))return value;
 const bytes=Buffer.from(value,'latin1'),decoded=bytes.toString('utf8');
 return !decoded.includes('\ufffd')&&Buffer.from(decoded,'utf8').equals(bytes)?decoded:value;
}
