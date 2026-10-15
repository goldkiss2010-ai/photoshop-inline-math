/* Read-only Photoshop Action Manager style diagnostics for existing PUA text. */
'use strict';
const {auditTextDescriptors}=require('./range_integrity_diagnostic');
const PUA_MIN=0xE000,PUA_MAX=0xF8FF;
const STYLE_KEYS=[
  'fontPostScriptName','fontName','fontStyleName','fontAvailable',
  'fontScript','fontTechnology',
  'size','impliedFontSize','baselineShift','impliedBaselineShift',
  'leading','impliedLeading','autoLeading','verticalScale','horizontalScale',
  'baseline','fontBaseline','impliedBaseline','superscript','subscript'
];
function findRange(ranges,offset){
  return (ranges||[]).find(r=>r.from<=offset&&offset<r.to);
}
function styleFields(item){
  const obj=(item&&item.textStyle)||{};
  const data={};
  for(const key of STYLE_KEYS)if(Object.prototype.hasOwnProperty.call(obj,key))
    data[key]=obj[key];
  if(obj.baseParentStyle&&typeof obj.baseParentStyle==='object'){
    const parent={};
    for(const key of STYLE_KEYS)
      if(Object.prototype.hasOwnProperty.call(obj.baseParentStyle,key))
        parent[key]=obj.baseParentStyle[key];
    if(Object.keys(parent).length)data.baseParentStyle=parent;
  }
  return data;
}
function isBody(ch){
  if(!ch || /\s/.test(ch))return false;
  const cp=ch.charCodeAt(0);
  return cp<PUA_MIN||cp>PUA_MAX;
}
function sameParagraphBody(text, offset) {
  let first=offset,last=offset;
  while(first>0&&!/[\r\n]/.test(text[first-1]))first--;
  while(last<text.length&&!/[\r\n]/.test(text[last]))last++;
  for(let i=offset-1;i>=first;i--)if(isBody(text[i]))return i;
  for(let i=offset+1;i<last;i++)if(isBody(text[i]))return i;
  return -1;
}

const PARAGRAPH_KEYS=[
  'align','composer','everyLineComposer','kinsoku','mojikumi',
  'hyphenation','autoLeading','leading','spaceBefore','spaceAfter',
  'firstLineIndent','leftIndent','rightIndent','justification'
];
function paragraphSummary(item){
  const style=item&&item.paragraphStyle||{};
  const fields={};
  for(const key of PARAGRAPH_KEYS)
    if(Object.prototype.hasOwnProperty.call(style,key))
      fields[key]=style[key];
  return fields;
}
function newlineDiagnostic(text,paragraphRanges,{limit=40}={}){
  const breaks=[];
  const kinds={CR:0,LF:0,CRLF:0,VT:0,FF:0,LS:0,PS:0,NEL:0};
  const tokenAt=i=>{
    if(text[i]==='\r'&&text[i+1]==='\n')return {kind:'CRLF',length:2};
    if(text[i]==='\r')return {kind:'CR',length:1};
    if(text[i]==='\n')return {kind:'LF',length:1};
    if(text[i]==='\v')return {kind:'VT',length:1};
    if(text[i]==='\f')return {kind:'FF',length:1};
    if(text[i]==='\u2028')return {kind:'LS',length:1};
    if(text[i]==='\u2029')return {kind:'PS',length:1};
    if(text[i]==='\u0085')return {kind:'NEL',length:1};
    return null;
  };
  for(let i=0;i<text.length;){
    const token=tokenAt(i);
    if(!token){i++;continue;}
    kinds[token.kind]++;
    if(breaks.length<limit){
      const before=findRange(paragraphRanges,i);
      const after=findRange(paragraphRanges,i+token.length);
      breaks.push({offset:i,kind:token.kind,width:token.length,
        beforeParagraphRange:before?[before.from,before.to]:null,
        afterParagraphRange:after?[after.from,after.to]:null});
    }
    i+=token.length;
  }
  return {
    kinds,breakCount:Object.values(kinds).reduce((sum,n)=>sum+n,0),
    truncated:Object.values(kinds).reduce((sum,n)=>sum+n,0)>limit,
    breaks,
    paragraphRanges:Array.isArray(paragraphRanges)
      ?paragraphRanges.slice(0,limit).map(r=>({
        from:r.from,to:r.to,style:paragraphSummary(r)
      }))
      :null,
    paragraphRangesTruncated:Array.isArray(paragraphRanges)&&paragraphRanges.length>limit
  };
}

function diagnose(descriptor,{limit=20}={}){
  if(!descriptor||typeof descriptor.textKey!=='string')
    throw Error('テキスト記述子がありません。');
  const text=descriptor.textKey;
  const ranges=descriptor.textStyleRange;
  // Even a missing run array must be diagnosed, rather than aborting the report.
  const report={
    length:text.length,
    lineBreaks:{CR:(text.match(/\r/g)||[]).length,LF:(text.match(/\n/g)||[]).length},
    newlineDiagnostic:newlineDiagnostic(text,descriptor.paragraphStyleRange),
    rangeTopology:auditTextDescriptors(descriptor),
    puaCount:0,
    sample:[]
  };
  for(let i=0;i<text.length;i++){
    const cp=text.charCodeAt(i);
    if(cp<PUA_MIN||cp>PUA_MAX)continue;
    report.puaCount++;
    if(report.sample.length>=limit)continue;
    const math=findRange(ranges,i);
    const ref=sameParagraphBody(text,i);
    const body=ref>=0?findRange(ranges,ref):null;
    report.sample.push({
      pua:'U+'+cp.toString(16).toUpperCase().padStart(4,'0'),
      offset:i,
      mathRange:math?[math.from,math.to]:null,
      math:styleFields(math),
      nearbyBodyOffset:ref>=0?ref:null,
      bodyRange:body?[body.from,body.to]:null,
      body:body?styleFields(body):null
    });
  }
  return report;
}
module.exports={diagnose,styleFields,sameParagraphBody,newlineDiagnostic};
