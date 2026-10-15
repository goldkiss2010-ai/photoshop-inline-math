/*
 * Interpret Photoshop's textStyleRange for editing-oriented workflows.
 *
 * textStyle: last declared style wins at any covered character position.
 * This accepts equal-span duplicates, arbitrary overlaps and zero-width runs.
 * The last-wins rule is a Paper Math policy for reconstructing a writable
 * descriptor, not a claim about Photoshop's internal rendering precedence.
 * Gaps, missing styles and out-of-bounds indices still stop conversion.
 *
 * paragraphStyle: strict contiguous ranges, with only identical duplicates
 * discarded, because paragraph boundaries carry document structure.
 *
 * The original Action Manager descriptor is never mutated.
 */
'use strict';
function fail(message){throw Error(message);}
function stableShape(value){
  if(value===null||typeof value==='string'||typeof value==='boolean'||
     typeof value==='number')return value;
  if(Array.isArray(value))return value.map(stableShape);
  if(value&&typeof value==='object'){
    const result={};
    for(const key of Object.keys(value).sort())result[key]=stableShape(value[key]);
    return result;
  }
  fail('書式記述子に比較できない値があります。');
}
function sameDescriptor(a,b){
  return JSON.stringify(stableShape(a))===JSON.stringify(stableShape(b));
}
function sameExceptBaseParentStyle(a,b,key){
  if(key!=='textStyle'||!a||!b||
     !a.textStyle||!b.textStyle||
     typeof a.textStyle!=='object'||typeof b.textStyle!=='object')
    return false;
  const withoutParent=entry=>{
    const {baseParentStyle,...direct}=entry.textStyle;
    return {...entry,textStyle:direct};
  };
  return sameDescriptor(withoutParent(a),withoutParent(b));
}
function validateRun(r,key,i,limit){
  if(!r||!Number.isInteger(r.from)||!Number.isInteger(r.to)||
     r.from<0||r.to<r.from||r.to>limit||
     !r[key]||typeof r[key]!=='object')
    fail(key+'の文字範囲が不正です（範囲 '+i+'）。');
}
function normalizeTextStyleRuns(ranges,sourceLength){
  const key='textStyle';
  if(!Array.isArray(ranges)||!ranges.length)
    fail(key+'が取得できません。');
  if(!Number.isInteger(sourceLength)||sourceLength<0)
    fail('本文の文字数が不正です。');
  // Allow Photoshop's terminal style marker at N+1, but never beyond it.
  const max=sourceLength+1;
  let end=0;
  const active=[];
  for(let i=0;i<ranges.length;i++){
    const r=ranges[i];
    if(r&&Number.isInteger(r.from)&&Number.isInteger(r.to)&&
       r.from===r.to&&r.from>=0&&r.from<=max){
      // Non-rendering insertion-point style. It owns no character.
      continue;
    }
    validateRun(r,key,i,max);
    end=Math.max(end,r.to);
    active.push({run:r,index:i});
  }
  const tail=end-sourceLength;
  if(tail!==0&&tail!==1)
    fail(key+'の終端位置が想定と異なります。');
  const edges=new Set([0,end]);
  for(const {run} of active){edges.add(run.from);edges.add(run.to);}
  const points=[...edges].sort((a,b)=>a-b);
  const result=[];
  for(let i=1;i<points.length;i++){
    const from=points[i-1],to=points[i];
    if(to<=from)continue;
    // Later input entries override earlier entries *only within overlap*.
    let winner=null;
    for(const item of active)
      if(item.run.from<=from&&item.run.to>=to)winner=item;
    if(!winner)
      fail(key+'に書式がない文字範囲があります（文字位置 '+from+'～'+to+'）。');
    const last=result[result.length-1];
    if(last&&last.__owner===winner.index&&last.to===from){
      last.to=to;
    }else{
      result.push({...winner.run,from,to,__owner:winner.index});
    }
  }
  if(!result.length)
    fail(key+'の有効な文字範囲がありません。');
  return result.map(({__owner,...range})=>range);
}
function normalizeParagraphRuns(ranges,key,sourceLength){
  if(!Array.isArray(ranges)||!ranges.length)
    fail(key+'が取得できません。');
  const out=[];
  for(let i=0;i<ranges.length;i++){
    const r=ranges[i],previous=out[out.length-1];
    validateRun(r,key,i,sourceLength+1);
    if(r.to===r.from)
      fail(key+'の長さ0の書式範囲は未対応です（範囲 '+i+'）。');
    if(previous&&r.from===previous.from&&r.to===previous.to){
      if(!sameDescriptor(previous,r))
        fail(key+'に同じ文字範囲の異なる書式があります（範囲 '+i+
          '、文字位置 '+r.from+'～'+r.to+'）。自動削除はできません。');
      continue;
    }
    if(r.from!==(previous?previous.to:0))
      fail(key+'の文字範囲が不連続、または不正です（範囲 '+i+
        '、必要な開始位置 '+(previous?previous.to:0)+'、実際 '+r.from+'）。');
    out.push(r);
  }
  const tail=out[out.length-1].to-sourceLength;
  if(tail!==0&&tail!==1)
    fail(key+'の終端位置が想定と異なります。');
  return out;
}
function normalizeExactDuplicateRuns(ranges,key,sourceLength){
  if(key==='textStyle')return normalizeTextStyleRuns(ranges,sourceLength);
  return normalizeParagraphRuns(ranges,key,sourceLength);
}
module.exports={normalizeExactDuplicateRuns,normalizeTextStyleRuns,
  sameDescriptor,sameExceptBaseParentStyle};
