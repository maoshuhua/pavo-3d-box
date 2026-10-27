// File operations may overlap only when their paths are disjoint. Builds,
// previews and directory reads are barriers, preserving submission order.
export function createToolScheduler(){
 let fence=Promise.resolve();
 const pending=new Set(),files=new Map();
 return (paths,work)=>{
  const keys=paths?.map(p=>p.toLowerCase()),dependencies=keys?[fence,...keys.map(k=>files.get(k))]:[fence,...pending];
  const run=Promise.all(dependencies).then(work),settled=run.then(()=>{},()=>{});
  pending.add(settled);
  if(keys)for(const key of keys)files.set(key,settled);else fence=settled;
  settled.then(()=>{pending.delete(settled);if(keys)for(const key of keys)if(files.get(key)===settled)files.delete(key);});
  return run;
 };
}
