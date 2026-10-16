export const sceneSource=`function build(ctx) {
 const objects=[
 {id:'ground',type:'mesh',name:'地面',geometry:{type:'box',args:[12,.1,40]},transform:{position:[0,-.2,-12]},material:{color:'#7c8591'}},
 {id:'runner',type:'group',name:'跑酷少年'},
 {id:'body',type:'mesh',parentId:'runner',name:'上衣',geometry:{type:'box',args:[.8,1,.5]},transform:{position:[0,1,0]},material:{color:'#ff7711'}},
 {id:'head',type:'mesh',parentId:'runner',name:'头部',geometry:{type:'sphere',args:[.35,12,8]},transform:{position:[0,1.8,0]},material:{color:'#ffd0a0'}},
 {id:'camera',type:'camera',name:'跟拍机位',camera:{fov:50,aspect:16/9},transform:{position:[0,3,8]},lookAt:[0,1,0]},
 {id:'sun',type:'light',name:'太阳光',light:{type:'directional',color:[1,1,1],intensity:3},transform:{position:[5,8,6]},lookAt:[0,0,0]}
 ];
 for(let i=0;i<12;i++)objects.push({id:'coin-'+i,type:'mesh',name:'金币'+i,geometry:{type:'torus',args:[.25,.08,6,12]},transform:{position:[0,1,-3-i*2]},material:{color:'#ffd020'}});
 return {version:1,mode:'replace',objects,world:{type:'solid',color:[.22,.24,.27],strength:2},timeline:{version:1,duration:3,shots:[{cameraId:'camera',start:0,end:3}]},animations:[{id:'movement',name:'角色与跟拍',duration:3,tracks:[{entityId:'runner',property:'position',times:[0,1.5,3],values:[0,0,0, 2,1,-6, 0,0,-12]},{entityId:'camera',property:'position',times:[0,1.5,3],values:[0,3,8, 2,4,2, 0,3,-4]}]}]};
}`;
