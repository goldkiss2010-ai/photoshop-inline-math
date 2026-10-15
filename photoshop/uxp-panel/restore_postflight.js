/* Read back the duplicated layer before hiding the original. No writes. */
'use strict';
const {normalizeTextStyleRuns}=require('./safe_range_normalization');

function fail(message){throw Error('LaTeX復元の読み戻し検証に失敗しました: '+message);}
function validRanges(ranges, key, length){
  if(!Array.isArray(ranges)||!ranges.length)fail(key+'がありません。');
  let end=0;
  for(const r of ranges){
    if(!r||!Number.isInteger(r.from)||!Number.isInteger(r.to)||
       r.from!==end||r.to<=end||!r[key])fail(key+'の範囲が不正です。');
    end=r.to;
  }
  if(end!==length&&end!==length+1)fail(key+'の終端が本文と一致しません。');
}
function at(ranges, pos, key){
  const item=ranges.find(r=>r.from<=pos&&pos<r.to);
  if(!item)fail('文字位置 '+pos+' の'+key+'がありません。');
  return item[key];
}
function sameParagraphAlignment(expected, actual) {
  // Photoshop Action Manager may return alignment as a new enum descriptor on
  // each read. Two equivalent {_enum,_value} objects are not === in JS.
  if (Object.is(expected, actual)) return true;
  const isEnum = value => value && typeof value === 'object' &&
    typeof value._enum === 'string' && typeof value._value === 'string';
  if (isEnum(expected) && isEnum(actual))
    return expected._enum === actual._enum && expected._value === actual._value;
  // Scalar vs enum representations can be semantically equal when the enum
  // identifies a paragraph alignment, but not for unrelated enum categories.
  if (isEnum(expected) && typeof actual === 'string')
    return expected._enum === 'alignmentType' && expected._value === actual;
  if (typeof expected === 'string' && isEnum(actual))
    return actual._enum === 'alignmentType' && actual._value === expected;
  return false;
}
function diagnosticValue(value) {
  try {
    const out=JSON.stringify(value);
    if (typeof out === 'string') return out.slice(0, 240);
  } catch (_) {}
  return String(value);
}
function verifyRestoredLayer(restored, intended, actual, mathPostScriptName){
  if(!restored||!intended||!actual||!mathPostScriptName||
     typeof restored.text!=='string'||actual.textKey!==restored.text||
     intended.textKey!==restored.text)fail('本文が一致しません。');
  const length=restored.text.length;
  // Normalize only the character run representation; paragraphs remain
  // structurally validated. Text/font/alignment comparisons stay strict.
  const intendedTextRuns=normalizeTextStyleRuns(intended.textStyleRange,length);
  const actualTextRuns=normalizeTextStyleRuns(actual.textStyleRange,length);
  for(const document of [intended,actual])
    validRanges(document.paragraphStyleRange,'paragraphStyle',length);
  let mathCount=0;
  for(const seg of restored.segments||[]){
    if(!Number.isInteger(seg.from)||!Number.isInteger(seg.to)||seg.from<0||
       seg.from>=seg.to||seg.to>length)fail('復元範囲が不正です。');
    if(seg.kind==='math')mathCount++;
    for(let pos=seg.from;pos<seg.to;pos++){
      const expected=at(intendedTextRuns,pos,'textStyle');
      const observed=at(actualTextRuns,pos,'textStyle');
      if(!expected.fontPostScriptName ||
         observed.fontPostScriptName!==expected.fontPostScriptName ||
         observed.fontAvailable===false ||
         (seg.kind==='math'&&observed.fontPostScriptName===mathPostScriptName)){
        fail('文字位置 '+pos+' のフォントが期待値と異なります。');
      }
      const expectedPara=at(intended.paragraphStyleRange,pos,'paragraphStyle');
      const observedPara=at(actual.paragraphStyleRange,pos,'paragraphStyle');
      if(expectedPara.align!==undefined &&
         !sameParagraphAlignment(expectedPara.align, observedPara.align)){
        fail('文字位置 '+pos+' の段落配置が一致しません。'+
             ' expected='+diagnosticValue(expectedPara.align)+
             ', actual='+diagnosticValue(observedPara.align));
      }
    }
  }
  if(!mathCount||mathCount!==restored.mathCount)fail('数式の復元数が一致しません。');
  return {verifiedMathCount:mathCount};
}
module.exports={verifyRestoredLayer,sameParagraphAlignment};
