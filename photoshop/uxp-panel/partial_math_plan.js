/* Build a pure replacement plan from a partial scan and verified entries.
 * No registration, font generation, Photoshop writes or reverse conversion.
 */
'use strict';
const {normalizeExactDuplicateRuns}=require('./safe_range_normalization');
function buildPartialParts(source,report,entries,{paragraphStyleRange=null}={}){
  if(typeof source!=='string'||!report||report.sourceLength!==source.length||
     report.fatal||!Array.isArray(report.matches)||!Array.isArray(entries))
    throw Error('部分変換計画の入力が不正、または全体停止の診断があります。');
  const mapping=new Map(),codes=new Set();
  for(const e of entries){
    if(!e||typeof e.latex!=='string'||!e.latex||typeof e.char!=='string'||
       e.char.length!==1||e.char.charCodeAt(0)<0xE000||e.char.charCodeAt(0)>0xF8FF||
       mapping.has(e.latex)||codes.has(e.char)||
       (e.codepoint!==undefined&&(!/^[0-9a-fA-F]{4}$/.test(e.codepoint)||
         parseInt(e.codepoint,16)!==e.char.charCodeAt(0))))
      throw Error('部分変換のPUA対応表が不正、または重複しています。');
    mapping.set(e.latex,e.char);codes.add(e.char);
  }
  const paragraphs=paragraphStyleRange===null?null:
    normalizeExactDuplicateRuns(paragraphStyleRange,'paragraphStyle',source.length);
  let text='',cursor=0,previous=0,mathCount=0,heldFormulaCount=0;
  const segments=[],issues=(report.issues||[]).map(x=>({...x}));
  function append(value,kind,start,end,anchor,match){
    if(!value)return;
    const from=text.length;text+=value;
    const segment={kind,sourceFrom:start,sourceTo:end,from,to:text.length,
      styleAnchor:anchor};
    if(match){segment.mode=match.mode;segment.notation=match.notation;}
    segments.push(segment);
  }
  for(const match of report.matches){
    if(!match||!Number.isInteger(match.from)||!Number.isInteger(match.to)||
       match.from<previous||match.to<=match.from||match.to>source.length||
       source.slice(match.from,match.to)!==match.raw||
       !Number.isInteger(match.styleAnchor)||match.styleAnchor<match.from||
       match.styleAnchor>=match.to||
       (report.protected||[]).some(p=>match.from<p.to&&p.from<match.to))
      throw Error('数式範囲が原文と不一致、重複、またはコード範囲内です。');
    previous=match.to;
    if(paragraphs&&match.mode!=='display'){
      const owner=paragraphs.find(p=>p.from<=match.styleAnchor&&match.styleAnchor<p.to);
      if(!owner)throw Error('数式位置に対応する段落書式がありません。');
      if(owner.to<match.to){
        heldFormulaCount++;
        issues.push({code:'paragraph-crossing',from:match.from,to:match.to,
          latex:match.latex,message:'段落をまたぐインライン数式は原文を保持します。'});
        continue;
      }
    }
    if(!mapping.has(match.latex)){
      heldFormulaCount++;
      issues.push({code:'unregistered-formula',from:match.from,to:match.to,
        latex:match.latex,message:'この式の生成済みPUAがないため原文を保持します。'});
      continue;
    }
    append(source.slice(cursor,match.from),'body',cursor,match.from,cursor);
    append(mapping.get(match.latex),'math',match.from,match.to,match.styleAnchor,match);
    cursor=match.to;mathCount++;
  }
  append(source.slice(cursor),'body',cursor,source.length,cursor);
  issues.sort((a,b)=>a.from-b.from||a.code.localeCompare(b.code));
  return {text,segments,mathCount,heldFormulaCount,issues};
}
module.exports={buildPartialParts};
