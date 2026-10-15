'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {applyInPlace}=require('../photoshop/uxp-panel/in_place_transaction');
const first={
  textKey:'前 $x$ 後',
  textStyleRange:[{from:0,to:7,textStyle:{fontPostScriptName:'Body'}}],
  paragraphStyleRange:[{from:0,to:7,paragraphStyle:{align:'left'}}]
};
const second={
  textKey:'前 \uE000 後',
  textStyleRange:[{from:0,to:5,textStyle:{fontPostScriptName:'Body'}}],
  paragraphStyleRange:[{from:0,to:5,paragraphStyle:{align:'left'}}]
};
function harness({writeFailure=false,wrongReadback=false,rollbackFailure=false,
  stale=false,missingHistory=false,verifyFailure=false}={}){
  let current=stale?{...first,textKey:'changed'}:first;
  let saved=null;
  const calls=[];
  const action={async batchPlay([cmd]){
    if(cmd._obj==='get'){
      calls.push('get');
      return [{textKey:current}];
    }
    if(cmd._obj==='set'){
      calls.push('set');
      if(writeFailure)return [{_obj:'error',message:'rejected'}];
      current=wrongReadback?{...second,textKey:'bad text'}:cmd.to;
      return [{}];
    }
    throw Error('unexpected Photoshop action');
  }};
  const control={
    async suspendHistory({documentID,name}){
      calls.push('suspend:'+documentID);
      assert.equal(name,'Paper Math: in-place test');
      saved=current;
      return {token:'history'};
    },
    async resumeHistory(token,commit){
      calls.push('resume:'+commit);
      assert.equal(token.token,'history');
      if(!commit){
        if(rollbackFailure)throw Error('rollback unavailable');
        current=saved;
      }
    }
  };
  const core={async executeAsModal(fn,opts){
    calls.push('modal');
    assert.equal(opts.commandName,'Paper Math: in-place test');
    return fn({hostControl:missingHistory?{}:control,isCancelled:false});
  }};
  const run=()=>applyInPlace({
    core,action,documentID:19,layerID:7,before:first,after:second,
    historyName:'Paper Math: in-place test',
    verify:actual=>{
      if(verifyFailure)throw Error('font verification failed');
      assert.equal(actual.textKey,second.textKey);
    },
    confirmTarget:async()=>calls.push('confirm')
  });
  return {run,calls,get current(){return current}};
}
test('verified text is committed once without duplicating a layer',async()=>{
  const h=harness();
  const result=await h.run();
  assert.equal(result.committed,true);
  assert.deepEqual(h.calls,['modal','confirm','get','suspend:19','set','get','resume:true']);
  assert.equal(h.current.textKey,second.textKey);
});
test('Photoshop refusing set triggers history rollback and original preservation',async()=>{
  const h=harness({writeFailure:true});
  await assert.rejects(h.run(),/rejected/);
  assert.equal(h.current.textKey,first.textKey);
  assert.ok(h.calls.includes('resume:false'));
});
test('postflight text mismatch triggers rollback',async()=>{
  const h=harness({wrongReadback:true});
  await assert.rejects(h.run(),/bad text/);
  assert.equal(h.current.textKey,first.textKey);
  assert.ok(h.calls.includes('resume:false'));
});
test('postflight font mismatch triggers rollback',async()=>{
  const h=harness({verifyFailure:true});
  await assert.rejects(h.run(),/font verification failed/);
  assert.equal(h.current.textKey,first.textKey);
  assert.ok(h.calls.includes('resume:false'));
});
test('source changing before transaction blocks with no history or writes',async()=>{
  const h=harness({stale:true});
  await assert.rejects(h.run(),/文字列または書式/);
  assert.equal(h.calls.includes('set'),false);
  assert.equal(h.calls.includes('suspend:19'),false);
});
test('history API missing is a hard stop; no set is attempted',async()=>{
  const h=harness({missingHistory:true});
  await assert.rejects(h.run(),/ヒストリー/);
  assert.equal(h.calls.includes('set'),false);
});
test('failure to roll back is surfaced as a data safety warning',async()=>{
  const h=harness({verifyFailure:true,rollbackFailure:true});
  await assert.rejects(h.run(),/PSDを保存せず/);
  assert.equal(h.current.textKey,second.textKey);
});


test('asynchronous readback rejection also rolls back before commit',async()=>{
  const h=harness();
  const action=harness();
  // Directly use a delayed verification promise; no Photoshop write should commit.
  let current=first,previous=first;
  const calls=[];
  const mockAction={async batchPlay([cmd]){
    if(cmd._obj==='get')return [{textKey:current}];
    if(cmd._obj==='set'){current=cmd.to;calls.push('set');return [{}];}
  }};
  const control={
    async suspendHistory(){previous=current;calls.push('suspend');return {id:1};},
    async resumeHistory(id,commit){calls.push('resume:'+commit);if(!commit)current=previous;}
  };
  const core={executeAsModal:fn=>fn({hostControl:control,isCancelled:false})};
  await assert.rejects(()=>applyInPlace({
    core,action:mockAction,documentID:19,layerID:7,before:first,after:second,
    historyName:'Paper Math: in-place test',
    verify:async()=>{await Promise.resolve();throw Error('async postflight reject');}
  }),/async postflight reject/);
  assert.equal(current.textKey,first.textKey);
  assert.deepEqual(calls,['suspend','set','resume:false']);
});
