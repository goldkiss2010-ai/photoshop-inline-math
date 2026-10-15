/* Deterministic, read-only maths scan audit for QMD/Pandoc troubleshooting.
 * This fingerprint is only for comparing observations, never for security.
 */
'use strict';
const {fencedSpans}=require('./math_syntax');
function fingerprint(source){
  if(typeof source!=='string')throw Error('本文がありません。');
  let h=0x811c9dc5;
  for(let i=0;i<source.length;i++){
    h=Math.imul(h ^ source.charCodeAt(i),0x01000193)>>>0;
  }
  return h.toString(16).padStart(8,'0').toUpperCase();
}
function standaloneDisplayMarkers(source){
  const result=[],lines=source.split(/(\r\n|\r|\n)/);
  let offset=0;
  for(let i=0;i<lines.length;i+=2){
    const line=lines[i],breaks=lines[i+1]||'';
    if(line.trim()==='$$'){
      result.push({offset:offset+line.indexOf('$$'),line:Math.floor(i/2)+1});
    }
    offset+=line.length+breaks.length;
  }
  return result;
}
function excludedDisplayMarkers(source,matches){
  // Only *standalone* Quarto display delimiters are inspected here, not
  // arbitrary dollar signs in Python source or informal documentation.
  // This function cannot change conversion behavior.
  const fences=fencedSpans(source),markers=standaloneDisplayMarkers(source);
  const missing=[];
  for(const m of markers){
    const hit=matches.find(x=>x.notation==='dollars-display' &&
      (x.from===m.offset || x.to-2===m.offset));
    if(hit)continue;
    const insideFence=fences.find(x=>x.from<=m.offset&&m.offset<x.to);
    const insideMath=matches.find(x=>x.from<=m.offset&&m.offset<x.to);
    let reason;
    if(insideFence)reason='コードブロックとして除外（開始文字位置 '+insideFence.from+
      (insideFence.to===source.length?'／本文末尾まで未閉鎖':'')+'）';
    else if(insideMath)reason='別の数式の範囲内（開始文字位置 '+insideMath.from+'）';
    else reason='どの数式にも含まれません（解析漏れ候補）';
    const around=source.slice(Math.max(0,m.offset-36),Math.min(source.length,m.offset+48))
      .replace(/\r\n|\r|\n/g,' ↵ ');
    missing.push({line:m.line,offset:m.offset,reason,around});
  }
  return {markerCount:markers.length,matchedCount:markers.length-missing.length,
    skipped:missing,fenceCount:fences.length};
}
function diagnosticSummary(source,docId,layerId,matches){
  if(!Array.isArray(matches))throw Error('数式一覧がありません。');
  const unique=new Set(matches.map(x=>x.latex)).size;
  const label='文書 '+docId+' / レイヤー '+layerId+
    ' / 本文 '+source.length+'文字 / 簡易ID '+fingerprint(source);
  const details=matches.map((m,i)=>
    String(i+1).padStart(2,'0')+'  '+(m.mode==='display'?'display':'inline')+
    ' / '+m.notation+' / 位置 '+m.from+'–'+m.to+'\n'+m.latex
  ).join('\n\n');
  const audit=excludedDisplayMarkers(source,matches);
  const excludedSummary='単独行の $$：'+audit.markerCount+'個／検出した式の区切り：'+
    audit.matchedCount+'個／検出対象外：'+audit.skipped.length+'個';
  const excludedDetails=audit.skipped.slice(0,30).map(x=>
    '行 '+x.line+' / 文字位置 '+x.offset+'：'+x.reason+'\n'+x.around
  ).join('\n\n');
  const truncated=audit.skipped.length>30?
    '\n（ほか '+(audit.skipped.length-30)+'個。先頭30件のみ表示）':'';
  return {label,unique,details,excludedSummary,
    excludedDetails:excludedDetails+truncated};
}
module.exports={fingerprint,standaloneDisplayMarkers,excludedDisplayMarkers,
  diagnosticSummary};
