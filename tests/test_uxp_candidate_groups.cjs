'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanCandidates,groupedCandidates,selectedInlineGroupParts}=
  require('../photoshop/uxp-panel/selected_inline');
const {buildDescriptor}=require('../photoshop/uxp-panel/text_ranges');

test('candidate menu lists each distinct LaTeX source just once',()=>{
  const src='前 $x$、$x$ と $y$ と $x$ 後';
  const choices=groupedCandidates(src);
  assert.equal(scanCandidates(src).length,4);
  assert.equal(choices.length,2);
  assert.deepEqual(choices.map(x=>[x.latex,x.count]),[['x',3],['y',1]]);
});

test('whitespace around TeX source does not create a duplicate candidate',()=>{
  const src='文章 $x$ と $ x $ に続けて $\\alpha$';
  const choices=groupedCandidates(src);
  assert.equal(choices.length,2);
  assert.equal(choices[0].count,2);
  assert.equal(choices[0].latex,'x');
});

test('selecting one formula source converts all its occurrences only',()=>{
  const src='前 $x$ / $y$ / $x$ 後';
  const item=groupedCandidates(src)[0];
  const converted=selectedInlineGroupParts(src,[{latex:'x',char:'\uE000'}],item);
  assert.equal(converted.text,'前 \uE000 / $y$ / \uE000 後');
  assert.equal(converted.mathCount,2);
  assert.equal(converted.segments.filter(x=>x.kind==='math').length,2);
  assert.equal(converted.pua,'\uE000');
});

test('preserves Japanese paragraph newline and per-formula style anchors',()=>{
  const src='日本語 $x$。\r二段落 $ x $ と $y$\r終';
  const chosen=groupedCandidates(src)[0];
  const result=selectedInlineGroupParts(src,[{latex:'x',char:'\uE000'}],chosen);
  assert.equal(result.text,'日本語 \uE000。\r二段落 \uE000 と $y$\r終');
  const mk=(key)=>({
    _obj:key+'Range',from:0,to:src.length+1,
    [key]:key==='textStyle'?
      {fontPostScriptName:'Body-Regular',size:{_unit:'pointsUnit',_value:12}}:
      {align:{_enum:'alignmentType',_value:'alignLeft'}}
  });
  const desc={textKey:src,textStyleRange:[mk('textStyle')],paragraphStyleRange:[mk('paragraphStyle')]};
  const projected=buildDescriptor(desc,result);
  assert.equal(projected.textKey,result.text);
  assert.equal(projected.textStyleRange.at(-1).to,result.text.length+1);
  assert.equal(projected.paragraphStyleRange.at(-1).to,result.text.length+1);
});

test('stale chosen occurrence and incorrect registry mapping fail safely',()=>{
  const src='$x$ と $x$';
  const chosen=groupedCandidates(src)[0];
  assert.throws(()=>selectedInlineGroupParts('新 '+src,[{latex:'x',char:'\uE000'}],chosen),/変更/);
  assert.throws(()=>selectedInlineGroupParts(src,[{latex:'x',char:'not-PUA'}],chosen),/対応/);
});
