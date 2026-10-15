/* Explicit, temporary Photoshop write experiment.
 * Every trial duplicates the source layer, writes to the temporary layer,
 * reads the result, verifies, and attempts cleanup inside a modal operation.
 * An unsuccessful cleanup stops further trials and reports the surviving layer.
 * Never modifies source text, styles, name, or visibility.
 */
'use strict';
const {auditTextDescriptors}=require('./range_integrity_diagnostic');

function fail(message){throw Error(message);}
function summarizeError(error){
  if(error&&typeof error.message==='string')return error.message;
  if(typeof error==='string')return error;
  return 'Photoshopから詳細のないエラーが返りました。';
}
async function readTextKey(action,id){
  const [result]=await action.batchPlay([{
    _obj:'get',_target:[{_property:'textKey'},{_ref:'textLayer',_id:id}]
  }],{});
  if(!result||result._obj==='error'||!result.textKey||
     typeof result.textKey.textKey!=='string')
    fail('テキストレイヤーの読み戻しに失敗しました。');
  return result.textKey;
}
function sameSource(before,after){
  return before.textKey===after.textKey&&
    JSON.stringify(before.textStyleRange)===JSON.stringify(after.textStyleRange)&&
    JSON.stringify(before.paragraphStyleRange)===JSON.stringify(after.paragraphStyleRange);
}
async function runTemporaryRestoreTrial({
  sourceLayer,originalDescriptor,plans,action,core,
  verifyRestoredLayer,mathPostScriptName
}){
  if(!sourceLayer||!Number.isInteger(sourceLayer.id)||
     !originalDescriptor||!Array.isArray(plans)||
     plans.length<1||plans.length>2||
     !plans.every(p=>p&&['first','last'].includes(p.policy)&&
       p.restored&&p.intended&&p.intended.textKey===p.restored.text))
    fail('試験対象と復元計画が不正です。');
  const report={scope:'development/temporary-duplicate-write',
    sourceLayerId:sourceLayer.id,sourceLayerIntendedUnchanged:true,
    sourceStillMatches:null,trialResults:[],persistentExtraLayerPossible:false};
  await core.executeAsModal(async()=>{
    const fresh=await readTextKey(action,sourceLayer.id);
    if(!sameSource(originalDescriptor,fresh))
      fail('試験開始前に元レイヤーの本文か書式が変わりました。何も書き込んでいません。');
    for(const p of plans){
      const result={policy:p.policy,status:'not-run',mathCount:p.restored.mathCount,
        sourceTextLength:originalDescriptor.textKey.length,
        intendedTextLength:p.restored.text.length,temporaryLayerCleaned:false};
      let temporary=null,cleanupFailed=false;
      try{
        temporary=await sourceLayer.duplicate();
        if(!temporary||!Number.isInteger(temporary.id))
          fail('試験レイヤーの複製が不正です。');
        temporary.name='[Paper Math temporary '+p.policy+']';
        const [write]=await action.batchPlay([{
          _obj:'set',
          _target:[{_ref:'textLayer',_id:temporary.id}],
          to:p.intended
        }],{});
        if(write&&write._obj==='error')
          fail(write.message||'Photoshopが試験書き込みを拒否しました。');
        const actual=await readTextKey(action,temporary.id);
        result.textReadbackMatches=actual.textKey===p.restored.text;
        result.readbackTopology=auditTextDescriptors(actual);
        verifyRestoredLayer(p.restored,p.intended,actual,mathPostScriptName);
        result.status='verified';
        result.verifiedMathCount=p.restored.mathCount;
      }catch(error){
        result.status='failed';
        result.reason=summarizeError(error);
      }finally{
        if(temporary){
          try{
            await temporary.delete();
            result.temporaryLayerCleaned=true;
          }catch(error){
            cleanupFailed=true;
            result.status='cleanup-failed';
            result.cleanupError=summarizeError(error);
            result.temporaryLayerId=temporary.id;
            report.persistentExtraLayerPossible=true;
          }
        }
      }
      report.trialResults.push(result);
      if(cleanupFailed)break;
    }
    try{
      const after=await readTextKey(action,sourceLayer.id);
      report.sourceStillMatches=sameSource(originalDescriptor,after);
      if(!report.sourceStillMatches)report.sourceCheckWarning='元レイヤーの本文または書式が試験前と一致しません。PSDを保存しないでください。';
    }catch(error){
      report.sourceCheckWarning='元レイヤーの再確認ができません: '+summarizeError(error);
    }
  },{commandName:'Paper Math: temporary restoration test'});
  return report;
}
module.exports={runTemporaryRestoreTrial,sameSource,readTextKey};
