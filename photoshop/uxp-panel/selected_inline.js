/* Pure, host-independent selected-inline conversion. No Photoshop writes. */
'use strict';
const {scanMathPlan}=require('./math_scan_plan');
function scanCandidates(source){
  const report=scanMathPlan(source);
  if(report.fatal)throw Error(report.issues.map(x=>x.message).join('\n'));
  return report.matches;
}
function selectedInlineParts(source,entries,selected) {
  const match=scanCandidates(source).find(item =>
    item.from===selected.from && item.to===selected.to &&
    item.raw===selected.raw && item.latex===selected.latex);
  if(!match) throw Error('選択した数式の位置または本文が変更されました。候補を読み直してください。');
  const mapping=entries.find(item=>item.latex===match.latex);
  if(!mapping||typeof mapping.char!=='string'||mapping.char.length!==1||
     mapping.char.charCodeAt(0)<0xE000||mapping.char.charCodeAt(0)>0xF8FF)
    throw Error('登録済みのLaTeX/PUA対応が不正です。');
  const before=source.slice(0,match.from),after=source.slice(match.to);
  const segments=[];
  if(before)segments.push({kind:'body',sourceFrom:0,sourceTo:match.from,from:0,to:before.length,styleAnchor:0});
  segments.push({kind:'math',sourceFrom:match.from,sourceTo:match.to,
      from:before.length,to:before.length+1,styleAnchor:match.styleAnchor,
      mode:match.mode,notation:match.notation});
  if(after)segments.push({kind:'body',sourceFrom:match.to,sourceTo:source.length,
      from:before.length+1,to:before.length+1+after.length,styleAnchor:match.to});
  return {text:before+mapping.char+after,segments,mathCount:1,latex:match.latex,pua:mapping.char};
}

/*
 * A candidate is a *LaTeX expression*, not one position in the paragraph.
 * Exact normalized LaTeX strings (trimmed as in scanCandidates) are grouped.
 * Different TeX source is not assumed equivalent even if it renders alike.
 */
function groupedCandidates(source){
  const groups=[];
  const table=new Map();
  for(const item of scanCandidates(source)){
    let group=table.get(item.latex);
    if(!group){
      group={latex:item.latex,from:item.from,to:item.to,raw:item.raw,
        styleAnchor:item.styleAnchor,count:0};
      table.set(item.latex,group);
      groups.push(group);
    }
    group.count++;
  }
  return groups;
}

/*
 * Convert all occurrences of the chosen LaTeX source, leaving all other
 * formulas and body text unchanged. Keep per-occurrence style anchors.
 */
function selectedInlineGroupParts(source,entries,selected){
  if(!selected||typeof selected.latex!=='string')
    throw Error('数式候補が選択されていません。');
  const all=scanCandidates(source);
  if(!all.some(x=>x.from===selected.from&&x.to===selected.to&&
      x.raw===selected.raw&&x.latex===selected.latex))
    throw Error('選択した数式の位置または本文が変更されました。候補を読み直してください。');
  const matches=all.filter(x=>x.latex===selected.latex);
  const mapping=entries.find(x=>x.latex===selected.latex);
  if(!mapping||typeof mapping.char!=='string'||mapping.char.length!==1||
     mapping.char.charCodeAt(0)<0xE000||mapping.char.charCodeAt(0)>0xF8FF)
    throw Error('登録済みのLaTeX/PUA対応が不正です。');

  let cursor=0, text='';
  const segments=[];
  const append=(chars,kind,from,to,anchor)=>{
    if(!chars)return;
    const start=text.length;
    text+=chars;
    segments.push({kind,sourceFrom:from,sourceTo:to,
      from:start,to:text.length,styleAnchor:anchor});
  };
  for(const match of matches){
    append(source.slice(cursor,match.from),'body',cursor,match.from,cursor);
    append(mapping.char,'math',match.from,match.to,match.styleAnchor);
    const last=segments[segments.length-1];
    last.mode=match.mode;last.notation=match.notation;
    cursor=match.to;
  }
  append(source.slice(cursor),'body',cursor,source.length,cursor);
  return {text,segments,mathCount:matches.length,
    latex:selected.latex,pua:mapping.char};
}

module.exports={scanCandidates,selectedInlineParts,groupedCandidates,selectedInlineGroupParts};
