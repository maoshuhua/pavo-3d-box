// libtv project navigation: leaving flushes edits first; a failed save keeps the
// editor open. One operation owns navigation at a time, including async Agent stop.
export function createProjectNavigationActions(getDependencies) {
 let pending=null;
 async function run(kind,work){
  if(pending)return false;
  pending=kind;getDependencies().onPending?.(kind);
  try{return await work(getDependencies());}
  finally{pending=null;getDependencies().onPending?.(null);}
 }
 return {
  get pending(){return pending;},
  save:()=>run('save',async deps=>{await deps.save(true);return true;}),
  leave:url=>run('leave',async deps=>{
   await deps.beforeLeave?.();
   await deps.save(false);
   deps.navigate(url);
   return true;
  }),
  remove:()=>run('delete',async deps=>{
   await deps.save(false);
   await deps.deleteProject();
   deps.navigate('/');
   return true;
  }),
 };
}
