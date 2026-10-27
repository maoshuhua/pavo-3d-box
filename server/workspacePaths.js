// Keep file tools, workspace enumeration and scene source resolution on the
// same grammar. Dots separate filename version segments, never directories.
export const WORKSPACE_FILE = /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.(js|json|txt|md)$/;
export const WORKSPACE_DIRECTORY = /^[a-zA-Z0-9_-]+$/;
export const WORKSPACE_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

export function parseWorkspacePath(virtualPath,{directory=false}={}) {
 const invalid=()=>Error('Only virtual .js/.json/.txt/.md workspace paths and directories are allowed. Use /folder/view.v1.js; names allow letters, digits, _ and -, with single dots between filename segments.');
 if(typeof virtualPath!=='string'||!virtualPath.startsWith('/')||virtualPath.includes('\\'))throw invalid();
 const normalized=directory&&virtualPath!=='/'?virtualPath.replace(/\/$/,''):virtualPath;
 const parts=normalized==='/'?[]:normalized.slice(1).split('/');
 if(parts.some((part,index)=>WORKSPACE_DEVICE.test(part)||!(directory||index<parts.length-1?WORKSPACE_DIRECTORY:WORKSPACE_FILE).test(part)))throw invalid();
 if(!directory&&!parts.length)throw invalid();
 return {path:normalized,parts};
}
