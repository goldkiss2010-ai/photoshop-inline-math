/* Transactional same-layer editing, opt-in until verified in Photoshop.
 * Uses Adobe UXP hostControl.suspendHistory/resumeHistory(false) to undo a
 * failed text assignment as a document history transaction. Do not fall back
 * to a second lossy text rewrite when rollback fails.
 */
'use strict';

function fail(message){throw Error(message);}
function describe(error){
  return error && typeof error.message==='string' ? error.message : String(error);
}
function unchangedRelevantText(before,after){
  return !!before && !!after && before.textKey===after.textKey &&
    JSON.stringify(before.textStyleRange)===JSON.stringify(after.textStyleRange) &&
    JSON.stringify(before.paragraphStyleRange)===JSON.stringify(after.paragraphStyleRange);
}
async function getText(action,layerID){
  const [res]=await action.batchPlay([{
    _obj:'get',_target:[{_property:'textKey'},{_ref:'textLayer',_id:layerID}]
  }],{});
  if(!res||res._obj==='error'||!res.textKey||
     typeof res.textKey.textKey!=='string')
    fail('対象レイヤーのテキストを取得できません。');
  return res.textKey;
}
async function applyInPlace({
  core,action,documentID,layerID,before,after,verify,
  historyName,confirmTarget
}){
  if(!core||!action||!Number.isInteger(documentID)||
     !Number.isInteger(layerID)||!before||!after||
     typeof verify!=='function'||!historyName)
    fail('同一レイヤー変換の引数が不正です。');
  return core.executeAsModal(async executionContext=>{
    const control=executionContext&&executionContext.hostControl;
    if(!control||typeof control.suspendHistory!=='function'||
       typeof control.resumeHistory!=='function')
      fail('Photoshopがヒストリーの中断・巻き戻しAPIを提供しません。同一レイヤー変換を実行できません。');
    if(confirmTarget)await confirmTarget();
    const fresh=await getText(action,layerID);
    if(!unchangedRelevantText(before,fresh))
      fail('変換開始前に文字列または書式が変わりました。変更していません。');
    const token=await control.suspendHistory({documentID,name:historyName});
    let resumed=false;
    try{
      if(executionContext.isCancelled)fail('ユーザーが操作を中断しました。');
      const [res]=await action.batchPlay([{
        _obj:'set',_target:[{_ref:'textLayer',_id:layerID}],to:after
      }],{});
      if(res&&res._obj==='error')
        fail(res.message||'Photoshopへの書き込みに失敗しました。');
      const persisted=await getText(action,layerID);
      await verify(persisted);
      if(executionContext.isCancelled)fail('ユーザーが操作を中断しました。');
      await control.resumeHistory(token,true);
      resumed=true;
      return {committed:true};
    }catch(error){
      if(resumed)throw error;
      try{
        await control.resumeHistory(token,false);
      }catch(rollbackError){
        fail('Photoshopの自動巻き戻しに失敗しました。PSDを保存せず、ヒストリーから確認してください。元のエラー: '+
             describe(error)+' / 巻き戻しエラー: '+describe(rollbackError));
      }
      let rolledBack;
      try{rolledBack=await getText(action,layerID);}
      catch(readError){
        fail('巻き戻し後に元レイヤーを再確認できません。PSDを保存せずに確認してください。元のエラー: '+
          describe(error)+' / 再取得エラー: '+describe(readError));
      }
      if(!unchangedRelevantText(before,rolledBack))
        fail('巻き戻し後の本文・文字書式・段落書式が元と一致しません。PSDを保存せずに確認してください。元のエラー: '+
             describe(error));
      throw error;
    }
  },{commandName:historyName});
}
module.exports={applyInPlace,unchangedRelevantText,getText};
