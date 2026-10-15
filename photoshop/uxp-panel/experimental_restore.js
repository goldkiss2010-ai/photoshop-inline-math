/* Development-only style run hypotheses.
 * The pure preflight is read-only; explicit Photoshop trial actions may apply
 * these candidates only to temporary duplicates with postflight verification.
 * Gaps, partial overlaps and terminal errors are never overridden.
 */
'use strict';
const {sameDescriptor}=require('./safe_range_normalization');
const {restorePUAParts,buildRestoredDescriptor}=require('./restore_ranges');
const {auditTextDescriptors}=require('./range_integrity_diagnostic');

function fail(message){throw Error(message);}

function changedKeys(a,b){
  const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
  return [...keys].filter(k=>{
    try{return !sameDescriptor({value:a&&a[k]===undefined?null:a[k]},
                               {value:b&&b[k]===undefined?null:b[k]});}
    catch(_){return true;}
  }).sort();
}

function chooseIdenticalBounds(ranges,property,length,policy){
  if(policy!=='first'&&policy!=='last')fail('未対応の比較方式です。');
  if(!Array.isArray(ranges)||!ranges.length)fail(property+'を取得できません。');
  const out=[], conflicts=[];
  for(let i=0;i<ranges.length;i++){
    const item=ranges[i];
    if(!item||!Number.isInteger(item.from)||!Number.isInteger(item.to)||
       item.from<0||item.to<=item.from||!item[property]||
       typeof item[property]!=='object')
      fail(property+'の不正な範囲が残っています（'+i+'）。');
    const prior=out[out.length-1];
    if(prior&&prior.from===item.from&&prior.to===item.to){
      if(!sameDescriptor(prior,item)){
        conflicts.push({
          index:i,from:item.from,to:item.to,
          differentStyleKeys:changedKeys(prior[property],item[property]),
          differentRangeKeys:changedKeys(
            Object.fromEntries(Object.entries(prior).filter(([k])=>k!==property)),
            Object.fromEntries(Object.entries(item).filter(([k])=>k!==property))
          )
        });
      }
      if(policy==='last')out[out.length-1]=item;
      continue;
    }
    if(item.from!==(prior?prior.to:0))
      fail(property+'に解決できない重複または欠落があります（'+i+'）。');
    out.push(item);
  }
  if(!out.length||![0,1].includes(out[out.length-1].to-length))
    fail(property+'の終端が本文長と一致しません。');
  return {ranges:out,conflicts};
}


function prepareRestoreHypothesis(descriptor,entries,postscriptName,policy){
  if(!descriptor||typeof descriptor.textKey!=='string')fail('本文が取得できません。');
  const length=descriptor.textKey.length;
  const tr=chooseIdenticalBounds(descriptor.textStyleRange,'textStyle',length,policy);
  const pr=chooseIdenticalBounds(descriptor.paragraphStyleRange,'paragraphStyle',length,policy);
  const normalized={...descriptor,textStyleRange:tr.ranges,paragraphStyleRange:pr.ranges};
  const restored=restorePUAParts(normalized.textKey,entries,normalized.textStyleRange,postscriptName);
  const intended=buildRestoredDescriptor(normalized,restored);
  // Nonportable inherited kerning indices belong to the original glyph text.
  delete intended.kerningRange;
  return {policy,restored,intended,textStyleConflicts:tr.conflicts,paragraphStyleConflicts:pr.conflicts};
}

function examineRestoreChoices(descriptor,entries,postscriptName){
  if(!descriptor||typeof descriptor.textKey!=='string')
    fail('元の本文が取得できません。');
  const source=descriptor.textKey;
  const inputAudit=auditTextDescriptors(descriptor);
  const results=[];
  for(const policy of ['first','last']){
    const result={policy,status:'blocked',mathCount:0,
      textStyleConflictCount:0,paragraphStyleConflictCount:0,
      textStyleConflicts:[],paragraphStyleConflicts:[]};
    try{
      const tr=chooseIdenticalBounds(descriptor.textStyleRange,'textStyle',source.length,policy);
      const pr=chooseIdenticalBounds(descriptor.paragraphStyleRange,'paragraphStyle',source.length,policy);
      result.textStyleConflictCount=tr.conflicts.length;
      result.paragraphStyleConflictCount=pr.conflicts.length;
      result.textStyleConflicts=tr.conflicts;
      result.paragraphStyleConflicts=pr.conflicts;
      const clean={...descriptor,textStyleRange:tr.ranges,paragraphStyleRange:pr.ranges};
      const restored=restorePUAParts(source,entries,clean.textStyleRange,postscriptName);
      const projected=buildRestoredDescriptor(clean,restored);
      if(projected.textKey!==restored.text)fail('復元文字列が一致しません。');
      result.status='preflight-ok';
      result.mathCount=restored.mathCount;
      result.restoredTextLength=restored.text.length;
      result.originalTextLength=source.length;
      result.newlineCountBefore=(source.match(/[\r\n]/g)||[]).length;
      result.newlineCountAfter=(restored.text.match(/[\r\n]/g)||[]).length;
    }catch(error){
      result.reason=error.message;
    }
    results.push(result);
  }
  return {
    scope:'development/read-only',
    originalTextLength:source.length,
    originalTopology:inputAudit,
    results,
    writesToPhotoshop:false
  };
}
module.exports={chooseIdenticalBounds,examineRestoreChoices,prepareRestoreHypothesis,changedKeys};
