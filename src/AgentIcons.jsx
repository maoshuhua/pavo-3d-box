import React from 'react';

// LibTV's published icon collection: /icons/libtv.json (down-s and
// icon-chevron-down-small). Stop path comes from its preview composer bundle.
export function CollapseConversationIcon(){
 return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M6.2.12a.4.4 0 0 1 .56 0l.43.42a.4.4 0 0 1 0 .57L4.15 4.15a.7.7 0 0 1-1 0L.13 1.1a.4.4 0 0 1 0-.57L.54.12a.4.4 0 0 1 .57 0l2.54 2.54z" fill="currentColor" transform="translate(4.345 5.825)"/></svg>;
}

export function ModelChevronIcon(){
 return <svg className="agent-modelChevron" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false"><path d="M12.9 7.9a.62.62 0 1 1 .88.88l-2.45 2.44c-.74.74-1.92.74-2.66 0L6.22 8.78a.62.62 0 1 1 .89-.89l2.45 2.45c.24.24.64.24.88 0z" fill="currentColor" fillOpacity=".9"/></svg>;
}

export function StopGenerationIcon(){
 return <svg className="agent-stopIcon" width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false"><path fill="#000" d="M5.063 2.25A2.813 2.813 0 0 0 2.25 5.063v7.875a2.813 2.813 0 0 0 2.813 2.812h7.875a2.813 2.813 0 0 0 2.812-2.812V5.062a2.813 2.813 0 0 0-2.812-2.812z"/></svg>;
}
