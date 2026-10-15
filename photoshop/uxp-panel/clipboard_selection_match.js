/* Read-only matching of explicitly copied Photoshop text against one text layer. */
'use strict';
const {scanCandidates}=require('./selected_inline');

function matchCopiedText(source, copied) {
  if(typeof source!=='string')throw Error('テキストレイヤー本文がありません。');
  if(typeof copied!=='string'||copied.length===0)
    throw Error('クリップボードに文字列がありません。文字ツールで選択してCtrl+Cを押してください。');
  if(copied.length>source.length)
    return {status:'not-in-layer',clipboardLength:copied.length,occurrences:[]};
  if(/[\uD800-\uDFFF]/.test(source)||/[\uD800-\uDFFF]/.test(copied))
    throw Error('絵文字などのサロゲートペアを含む本文は未対応です。');
  const matches=[];
  let offset=0;
  while(offset<=source.length-copied.length){
    const pos=source.indexOf(copied,offset);
    if(pos<0)break;
    matches.push({from:pos,to:pos+copied.length});
    offset=pos+1;
  }
  let formulas=[];
  try{
    formulas=scanCandidates(source);
  }catch(e){
    // Malformed latex in a different part of the paragraph should not
    // prevent the read-only clipboard test from reporting matching spans.
  }
  const occurrences=matches.map(({from,to})=>{
    const selected=formulas.find(f=>f.from===from && f.to===to);
    return {from,to,wholeInlineFormula:!!selected};
  });
  return {
    status:occurrences.length===0?'not-in-layer':
      occurrences.length>1?'ambiguous':'unique',
    clipboardLength:copied.length,
    occurrenceCount:occurrences.length,
    occurrences
  };
}
module.exports={matchCopiedText};
