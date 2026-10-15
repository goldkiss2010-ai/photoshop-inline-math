/*
 * Diagnose the Action Manager run-range topology without changing it.
 * The Photoshop descriptors from copy/paste can contain zero-length runs,
 * missing runs, overlaps, or a terminal index outside the supported {N,N+1}.
 * Report only offsets/structure; never expose the user's source text.
 */
'use strict';
const {sameDescriptor,sameExceptBaseParentStyle,normalizeTextStyleRuns}=require('./safe_range_normalization');

function auditRangeTopology(ranges,property,textLength,{limit=24}={}){
  const report={
    status:'ok',
    property,
    textLength,
    rangeCount:Array.isArray(ranges)?ranges.length:0,
    firstFrom:null,
    lastTo:null,
    tail:null,
    issueCount:0,
    issues:[],
    issueCounts:{missing:0,invalid:0,gap:0,overlap:0,empty:0,missingStyle:0,tail:0}
  };
  const add=(kind,details)=>{
    report.status='invalid';
    report.issueCount++;
    report.issueCounts[kind]++;
    if(report.issues.length<limit)report.issues.push({kind,...details});
  };
  if(!Array.isArray(ranges)||ranges.length===0){
    add('missing',{message:'範囲配列が空か取得できていません'});
    return report;
  }
  let previousEnd=0;
  for(let i=0;i<ranges.length;i++){
    const range=ranges[i];
    if(!range||!Number.isInteger(range.from)||!Number.isInteger(range.to)){
      add('invalid',{rangeIndex:i,expectedFrom:previousEnd,
        from:range&&Number.isInteger(range.from)?range.from:null,
        to:range&&Number.isInteger(range.to)?range.to:null,
        fromType:range?typeof range.from:'missing',
        toType:range?typeof range.to:'missing'});
      previousEnd=null;
      continue;
    }
    const {from,to}=range;
    if(i===0)report.firstFrom=from;
    report.lastTo=to;
    if(previousEnd!==null&&from!==previousEnd){
      const prior=ranges[i-1];
      const exactSameBounds=!!prior&&prior.from===from&&prior.to===to;
      let sameAllProperties=null, baseParentOnlyDifference=false;
      if(exactSameBounds){
        try{
          sameAllProperties=sameDescriptor(prior,range);
          baseParentOnlyDifference=sameAllProperties===false&&
            sameExceptBaseParentStyle(prior,range,property);
        }catch(_){}
      }
      add(from>previousEnd?'gap':'overlap',{
        rangeIndex:i,expectedFrom:previousEnd,from,to,delta:from-previousEnd,
        previousFrom:prior&&Number.isInteger(prior.from)?prior.from:null,
        previousTo:prior&&Number.isInteger(prior.to)?prior.to:null,
        exactSameBounds,sameAllProperties,
        safeToDeduplicate:exactSameBounds&&sameAllProperties===true,
        baseParentOnlyDifference,
        acceptedByNormalization:property==='textStyle'
          ? true
          : exactSameBounds&&(sameAllProperties===true||baseParentOnlyDifference)
      });
    }
    if(to<=from)add('empty',{rangeIndex:i,from,to,width:to-from});
    if(!range[property]||typeof range[property]!=='object')
      add('missingStyle',{rangeIndex:i,from,to});
    previousEnd=to;
  }
  if(Number.isInteger(previousEnd)){
    report.tail=previousEnd-textLength;
    if(report.tail!==0&&report.tail!==1)
      add('tail',{expectedEnd:[textLength,textLength+1],actualEnd:previousEnd,
        delta:report.tail});
  }
  if(property==='textStyle'){
    report.normalization={policy:'last-declared-wins',status:'blocked'};
    try{
      const clean=normalizeTextStyleRuns(ranges,textLength);
      report.normalization.status='accepted';
      report.normalization.outputRangeCount=clean.length;
      report.normalization.outputTail=clean[clean.length-1].to-textLength;
    }catch(error){
      report.normalization.reason=error.message;
    }
  }
  report.truncated=report.issueCount>report.issues.length;
  return report;
}

function auditTextDescriptors(descriptor){
  if(!descriptor||typeof descriptor.textKey!=='string')
    throw Error('診断するテキスト情報がありません。');
  const length=descriptor.textKey.length;
  const character=auditRangeTopology(descriptor.textStyleRange,'textStyle',length);
  const paragraph=auditRangeTopology(descriptor.paragraphStyleRange,'paragraphStyle',length);
  return {status:character.status==='ok'&&paragraph.status==='ok'?'ok':'invalid',
    textStyleRange:character,paragraphStyleRange:paragraph};
}

module.exports={auditRangeTopology,auditTextDescriptors};
