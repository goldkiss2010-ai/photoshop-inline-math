'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanMath}=require('../photoshop/uxp-panel/math_syntax');
const {inlineParts,buildDescriptor}=require('../photoshop/uxp-panel/text_ranges');
const {describeTextMismatch}=require('../photoshop/uxp-panel/text_readback_diagnostic');

function descriptor(source){
  const bounds=[0];
  for(let i=0;i<source.length;i++)if(source[i]==='\r')bounds.push(i+1);
  bounds.push(source.length+1);
  return {
    textKey:source,
    textStyleRange:[{from:0,to:source.length+1,textStyle:{
      _obj:'textStyle',fontPostScriptName:'Body-Regular',
      size:{_unit:'pointsUnit',_value:14}}}],
    paragraphStyleRange:bounds.slice(1).map((to,i)=>({
      from:bounds[i],to,
      paragraphStyle:{_obj:'paragraphStyle',align:'left',tag:'p'+i}
    }))
  };
}
const cases=[
  ['no blank line','本文\r$$\rE=mc^2\r$$\r次','本文\r\uE000\r次'],
  ['one blank before','本文\r\r$$\rE=mc^2\r$$\r次','本文\r\r\uE000\r次'],
  ['one blank after','本文\r$$\rE=mc^2\r$$\r\r次','本文\r\uE000\r\r次'],
  ['blank on both sides','本文\r\r$$\rE=mc^2\r$$\r\r次','本文\r\r\uE000\r\r次'],
  ['two blank before','本文\r\r\r$$\rE=mc^2\r$$\r次','本文\r\r\r\uE000\r次'],
  ['whitespace-only line before','本文\r  \r$$\rE=mc^2\r$$\r次','本文\r  \r\uE000\r次'],
  ['two display formulas','前\r\r$$\rE=mc^2\r$$\r\r中\r\r$$\rx^2\r$$\r後',
    '前\r\r\uE000\r\r中\r\r\uE001\r後']
];

for(const [label,source,expected] of cases){
  test('display math with '+label+' retains all external blank paragraphs',()=>{
    const formulas=scanMath(source);
    const entries=[...new Set(formulas.map(x=>x.latex))]
      .map((latex,i)=>({latex,char:String.fromCharCode(0xE000+i)}));
    const parts=inlineParts(source,entries);
    const projected=buildDescriptor(descriptor(source),parts);
    assert.equal(parts.text,expected);
    assert.equal(projected.textKey,expected);
    assert.equal(projected.textStyleRange.at(-1).to,expected.length+1);
    assert.equal(projected.paragraphStyleRange.at(-1).to,expected.length+1);
    assert.equal((expected.match(/\r/g)||[]).length,
      (source.match(/\r/g)||[]).length -
      formulas.reduce((sum,m)=>sum+(m.raw.match(/\r/g)||[]).length,0));
  });
}

test('readback diagnostic detects one lost blank paragraph after Photoshop write',()=>{
  const expected='本文\r\r\uE000\r次',actual='本文\r\uE000\r次';
  const description=describeTextMismatch(expected,actual);
  assert.match(description,/要求文字数=7、読み戻し文字数=6/);
  assert.match(description,/初めて異なる位置=3/);
  assert.match(description,/改行数\(CR\/LF\)=要求3\/0／実際2\/0/);
});
