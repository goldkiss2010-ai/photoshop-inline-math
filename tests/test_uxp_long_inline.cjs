'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inlineParts,buildDescriptor,FONT_PS_NAME}=
  require('../photoshop/uxp-panel/text_ranges');
const {scanCandidates,selectedInlineParts}=
  require('../photoshop/uxp-panel/selected_inline');

const mapping=[
  {latex:'x_i^2',codepoint:'E004',char:'\uE004'},
  {latex:'\\alpha+\\beta',codepoint:'E005',char:'\uE005'}
];
function descriptor(source, breaks){
  const ends=[...breaks,source.length+1],starts=[0,...breaks];
  const range=(type,i,from,to)=>({
    _obj:type+'Range',from,to,
    [type]:type==='textStyle'?{
      _obj:'textStyle',fontPostScriptName:'BodyFont-'+i,
      fontName:'BodyFont-'+i,fontStyleName:'Regular',
      size:{_unit:'pointsUnit',_value:14+i}
    }:{_obj:'paragraphStyle',align:'paragraph-'+i}
  });
  return {_obj:'textLayer',textKey:source,
          textStyleRange:ends.map((end,i)=>range('textStyle',i,starts[i],end)),
          paragraphStyleRange:ends.map((end,i)=>range('paragraphStyle',i,starts[i],end))};
}
function at(ranges,position,name){
  const found=ranges.find(r=>r.from<=position&&position<r.to);
  assert.ok(found,'No style at offset '+position);
  return found[name];
}
test('long poster copy preserves CR, LF, CRLF, paragraphs and body fonts',()=>{
  const source='見出し $x_i^2$ と説明\r'+
    '本文A。価格 \\$10 は数式ではない。$\\alpha+\\beta$ を評価する。\r\n'+
    '本文Bでは $x_i^2$ が再度登場する。\n'+
    '結語と通常の文字。';
  const breaks=[
    source.indexOf('\r')+1,
    source.indexOf('\r\n')+2,
    source.indexOf('\n',source.indexOf('\r\n')+2)+1
  ];
  const before=descriptor(source,breaks);
  const saved=JSON.stringify(before);
  const matches=scanCandidates(source);
  assert.equal(matches.length,3);
  assert.deepEqual(matches.map(x=>x.latex),['x_i^2','\\alpha+\\beta','x_i^2']);
  const result=inlineParts(source,mapping);
  assert.equal(result.mathCount,3);
  assert.equal(result.text,'見出し \uE004 と説明\r'+
    '本文A。価格 \\$10 は数式ではない。\uE005 を評価する。\r\n'+
    '本文Bでは \uE004 が再度登場する。\n'+
    '結語と通常の文字。');
  const output=buildDescriptor(before,result);
  assert.equal(output.textKey,result.text);
  assert.equal(JSON.stringify(before),saved,'source descriptor must not mutate');
  const textPositions=['見出し','本文A','本文B','結語'].map(v=>result.text.indexOf(v));
  textPositions.forEach((pos,i)=>{
    assert.equal(at(output.paragraphStyleRange,pos,'paragraphStyle').align,'paragraph-'+i);
    assert.equal(at(output.textStyleRange,pos,'textStyle').fontPostScriptName,'BodyFont-'+i);
  });
  for(const cp of ['\uE004','\uE005']){
    const pos=result.text.indexOf(cp);
    assert.equal(at(output.textStyleRange,pos,'textStyle').fontPostScriptName,FONT_PS_NAME);
  }
  assert.equal((result.text.match(/\r/g)||[]).length,2);
  assert.equal((result.text.match(/\n/g)||[]).length,2);
  assert.equal(output.textStyleRange.at(-1).to,result.text.length+1);
  assert.equal(output.paragraphStyleRange.at(-1).to,result.text.length+1);
});
test('blank paragraphs and terminal newline preserve paragraph styles',()=>{
  const source='一行 $x_i^2$\r\r次行 $\\alpha+\\beta$\r';
  const breaks=[source.indexOf('\r')+1,source.indexOf('\r')+2,source.length];
  const out=buildDescriptor(descriptor(source,breaks),inlineParts(source,mapping));
  assert.equal(out.textKey,'一行 \uE004\r\r次行 \uE005\r');
  assert.equal(out.paragraphStyleRange.at(-1).to,out.textKey.length+1);
  assert.equal(at(out.paragraphStyleRange,out.textKey.indexOf('次行'),'paragraphStyle').align,'paragraph-2');
});
test('long source, repeated equations and optional one-formula conversion',()=>{
  const source='はじめ '+'日本語と英語 '.repeat(1000)+
    '\r$x_i^2$ と $x_i^2$ が同じ対応。\n';
  const all=inlineParts(source,mapping);
  assert.equal(all.mathCount,2);
  assert.equal(all.text.split('\uE004').length-1,2);
  const selected=scanCandidates(source)[1];
  const individual=selectedInlineParts(source,mapping,selected);
  assert.equal(individual.mathCount,1);
  assert.equal(individual.text.split('\uE004').length-1,1);
  assert.equal(individual.text.includes('$x_i^2$'),true);
  assert.equal(individual.text.endsWith(' が同じ対応。\n'),true);
});
