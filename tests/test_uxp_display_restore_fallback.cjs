'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inlineParts,buildDescriptor}=require('../photoshop/uxp-panel/text_ranges');
const {restorePUAParts,buildRestoredDescriptor}=require('../photoshop/uxp-panel/restore_ranges');
const {verifyRestoredLayer}=require('../photoshop/uxp-panel/restore_postflight');

const mathFont={family:'Paper Math Trial',postscript_name:'PaperMathTrial-Regular'};
const bodyFont='KozGoPr6N-Regular';
const entry={latex:'x^2',char:'\uE000',codepoint:'E000'};
function descriptor(source,body=bodyFont){
  const bounds=[0];
  for(let i=0;i<source.length;i++)if(source[i]==='\r')bounds.push(i+1);
  bounds.push(source.length+1);
  return {textKey:source,
    textStyleRange:[{from:0,to:source.length+1,textStyle:{
      _obj:'textStyle',fontPostScriptName:body,fontName:'Body',
      fontAvailable:true,size:{_unit:'pointsUnit',_value:12}}}],
    paragraphStyleRange:bounds.slice(1).map((to,i)=>({
      from:bounds[i],to,paragraphStyle:{_obj:'paragraphStyle',align:'left'}}))
  };
}
function roundtrip(text,entries=[entry]){
  const forward=inlineParts(text,entries);
  const convertedDescriptor=buildDescriptor(descriptor(text),forward,undefined,mathFont);
  const reverse=restorePUAParts(
    forward.text,entries,convertedDescriptor.textStyleRange,mathFont.postscript_name);
  const restoredDescriptor=buildRestoredDescriptor(convertedDescriptor,reverse);
  assert.equal(verifyRestoredLayer(reverse,restoredDescriptor,restoredDescriptor,mathFont.postscript_name).verifiedMathCount,reverse.mathCount);
  return {forward,reverse,restoredDescriptor};
}
test('display math between body paragraphs can restore even with no same-paragraph body font',()=>{
  for(const source of ['本文\r$$\rx^2\r$$\r続き',
                       '本文\r\r$$\rx^2\r$$\r続き',
                       '本文\r$$\rx^2\r$$\r\r続き']){
    const {reverse,restoredDescriptor}=roundtrip(source);
    assert.equal(reverse.mathCount,1);
    assert.equal(restoredDescriptor.textKey,'本文'+(source.includes('本文\r\r')?'\r\r':'\r')+
      '$x^2$'+(source.includes('$$\r\r続き')?'\r\r':'\r')+'続き');
    const i=restoredDescriptor.textKey.indexOf('$x^2$');
    const style=restoredDescriptor.textStyleRange.find(r=>r.from<=i&&i<r.to).textStyle;
    assert.equal(style.fontPostScriptName,bodyFont);
  }
});
test('when two neighboring body fonts exist, the nearer previous paragraph is chosen',()=>{
  const source='A\r$$\rx^2\r$$\r\r\rZ';
  const forward=inlineParts(source,[entry]);
  const raw=descriptor(source,'Body-Previous');
  const suffix=source.indexOf('Z');
  raw.textStyleRange=[
    {from:0,to:suffix,textStyle:{fontPostScriptName:'Body-Previous',fontAvailable:true,size:{_unit:'pointsUnit',_value:12}}},
    {from:suffix,to:source.length+1,textStyle:{fontPostScriptName:'Body-Following',fontAvailable:true,size:{_unit:'pointsUnit',_value:12}}}
  ];
  const converted=buildDescriptor(raw,forward,undefined,mathFont);
  const parts=restorePUAParts(forward.text,[entry],converted.textStyleRange,mathFont.postscript_name);
  const back=buildRestoredDescriptor(converted,parts);
  const i=back.textKey.indexOf('$x^2$');
  const style=back.textStyleRange.find(r=>r.from<=i&&i<r.to).textStyle;
  assert.equal(style.fontPostScriptName,'Body-Previous');
});
test('a formula-only layer is still blocked without a known body font',()=>{
  const source='$$\rx^2\r$$';
  const forward=inlineParts(source,[entry]);
  const converted=buildDescriptor(descriptor(source),forward,undefined,mathFont);
  const parts=restorePUAParts(forward.text,[entry],converted.textStyleRange,mathFont.postscript_name);
  assert.throws(()=>buildRestoredDescriptor(converted,parts),/本文用フォントが文書内にありません/);
});
test('unavailable body font is not silently reused for math-only paragraph',()=>{
  const source='本文\r$$\rx^2\r$$\r続き';
  const forward=inlineParts(source,[entry]);
  const converted=buildDescriptor(descriptor(source),forward,undefined,mathFont);
  for(const run of converted.textStyleRange)
    if(run.textStyle.fontPostScriptName===bodyFont)run.textStyle.fontAvailable=false;
  const parts=restorePUAParts(forward.text,[entry],converted.textStyleRange,mathFont.postscript_name);
  assert.throws(()=>buildRestoredDescriptor(converted,parts),/本文用フォントが文書内にありません/);
});
