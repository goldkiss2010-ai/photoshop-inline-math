'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {runTemporaryRestoreTrial}=require('../photoshop/uxp-panel/temporary_restore_trial');
const txt='文章 \\uE004';
const source={textKey:txt,textStyleRange:[{from:0,to:txt.length+1,textStyle:{fontPostScriptName:'Body'}}],paragraphStyleRange:[{from:0,to:txt.length+1,paragraphStyle:{align:'left'}}]};
const restored={text:'文章 $x$',mathCount:1};
const intended={textKey:restored.text,textStyleRange:[{from:0,to:restored.text.length+1,textStyle:{fontPostScriptName:'Body'}}],paragraphStyleRange:[{from:0,to:restored.text.length+1,paragraphStyle:{align:'left'}}]};
test('temporary write test preserves source and cleans up',async()=>{
 const operations=[],copies=new Map();
 const layer={id:7,async duplicate(){
   const d={id:101,name:'copy',async delete(){operations.push('delete');copies.delete(101);}};
   copies.set(101,source);operations.push('duplicate');return d;
 }};
 const action={async batchPlay([q]){
   const id=q._target.at(-1)._id;
   if(q._obj==='get')return [{textKey:id===7?source:copies.get(id)}];
   operations.push('set:'+id);copies.set(id,q.to);return [{}];
 }};
 const core={async executeAsModal(fn){await fn();}};
 const report=await runTemporaryRestoreTrial({
   sourceLayer:layer,originalDescriptor:source,
   plans:[{policy:'first',restored,intended}],
   action,core,verifyRestoredLayer(){},
   mathPostScriptName:'InlineMathLab-Regular'
 });
 assert.equal(report.trialResults[0].status,'verified');
 assert.deepEqual(operations,['duplicate','set:101','delete']);
 assert.equal(copies.size,0);
});


test('Photoshop write error never touches original and cleans duplicate',async()=>{
 const calls=[];
 const layer={id:7,async duplicate(){return {id:102,async delete(){calls.push('delete');}};}};
 const action={async batchPlay([request]){
   const id=request._target[request._target.length-1]._id;
   if(request._obj==='get')return [{textKey:source}];
   calls.push('set:'+id);
   return [{_obj:'error',message:'mock write rejected'}];
 }};
 const core={async executeAsModal(fn){await fn();}};
 const report=await runTemporaryRestoreTrial({
   sourceLayer:layer,originalDescriptor:source,
   plans:[{policy:'first',restored,intended}],
   action,core,verifyRestoredLayer(){},
   mathPostScriptName:'InlineMathLab-Regular'
 });
 assert.equal(report.trialResults[0].status,'failed');
 assert.equal(report.trialResults[0].temporaryLayerCleaned,true);
 assert.equal(report.sourceStillMatches,true);
 assert.deepEqual(calls,['set:102','delete']);
});
test('stale source blocks before Photoshop duplicates the layer',async()=>{
 const calls=[];
 const layer={id:7,async duplicate(){calls.push('duplicate');throw Error('unexpected');}};
 const action={async batchPlay(){return [{textKey:{...source,textKey:'changed'}}];}};
 const core={async executeAsModal(fn){await fn();}};
 await assert.rejects(()=>runTemporaryRestoreTrial({
   sourceLayer:layer,originalDescriptor:source,
   plans:[{policy:'first',restored,intended}],action,core,
   verifyRestoredLayer(){},mathPostScriptName:'InlineMathLab-Regular'
 }),/本文か書式が変わりました/);
 assert.deepEqual(calls,[]);
});
