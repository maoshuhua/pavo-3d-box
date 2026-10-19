import React from 'react';
// Shared local brand asset for every existing logo placement.
export default function BrandLogo({size=20,className}) {
  return <img className={className} src="/assets/logo-dark.png" alt="Pavo" width={size*68/80} height={size} draggable={false} style={{display:'block',width:size*68/80,height:size,objectFit:'contain',flexShrink:0}}/>;
}
