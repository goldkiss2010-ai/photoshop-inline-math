'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {probeTextSelection,summarizeResponse}=
  require('../photoshop/uxp-panel/text_selection_probe.js');

test('only GET commands and zero Photoshop state modification',async()=>{
  const calls=[];
  const mock={batchPlay:async(cmds)=>{
    const cmd=cmds[0];
    calls.push(cmd);
    if(cmd._target[0]._property==='textSelection')
      return [{_obj:'error',message:'Property not available',result:-1}];
    if(cmd._target[0]._property==='textSelectionRange')
      return [{selectionRange:{from:3,to:10,text:'DO NOT ECHO'}}];
    if(cmd._target[0]._property==='currentTool')
      return [{currentTool:{_enum:'tool',_value:'typeCreateOrEditTool'}}];
    if(cmd._target[0]._property==='currentToolOptions')
      return [{currentToolOptions:{isEditing:true,secretText:'DO NOT ECHO'}}];
    return [{textKey:{textKey:'DOCUMENT PRIVATE TEXT'},
      selection:{from:3,to:10},textStyleRange:[{},{}]}];
  }};
  const out=await probeTextSelection(mock,22);
  assert.equal(calls.length,5);
  for(const cmd of calls)assert.equal(cmd._obj,'get');
  assert.equal(calls[0]._target[0]._id,22);
  assert.equal(out.results.layerTextSelection.status,'unsupported-or-error');
  assert.equal(out.results.layerTextSelectionRange.candidates.selectionRange.fields.from,3);
  assert.equal(out.results.layerTextSelectionRange.candidates.selectionRange.fields.to,10);
  const dumped=JSON.stringify(out);
  assert.equal(dumped.includes('DO NOT ECHO'),false);
  assert.equal(dumped.includes('DOCUMENT PRIVATE TEXT'),false);
  assert.equal(out.results.applicationCurrentTool.status,'returned');
});

test('an unsupported property does not abort following read-only probes',async()=>{
  let count=0;
  const out=await probeTextSelection({batchPlay:async()=>{
    count++;
    if(count===1)throw Error('No such property');
    return [{_obj:'error',message:'Unknown'}];
  }},31);
  assert.equal(count,5);
  assert.equal(out.results.layerProperties.status,'threw');
  assert.equal(out.results.applicationToolOptions.status,'unsupported-or-error');
});

test('empty selection candidate is inconclusive; non-text and invalid descriptors are guarded',async()=>{
  assert.equal(summarizeResponse({textKey:{textKey:'secret'}}).status,'returned');
  assert.deepEqual(summarizeResponse(undefined),{status:'no-response'});
  await assert.rejects(probeTextSelection(null,10),/不正/);
});
