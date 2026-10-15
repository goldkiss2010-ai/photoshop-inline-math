'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {chooseIdenticalBounds,examineRestoreChoices}=
  require('../photoshop/uxp-panel/experimental_restore');
const BODY='BIZUDPGothic-Bold',PS='InlineMathLab-Regular';
const mk=(from,to,font,extra={})=>({
  from,to,_obj:'textStyleRange',
  textStyle:{fontPostScriptName:font,fontAvailable:true,
    size:{_unit:'pointsUnit',_value:16},...extra}
});
function example(secondFont=PS){
  const text='日本語 \uE004 文字 \uE005 末尾\r次の段落';
  const a=text.indexOf('\uE004'),b=text.indexOf('\uE005');
  const runs=[mk(0,a,BODY),mk(a,a+1,PS),mk(a,a+1,secondFont,{baselineShift:3}),
    mk(a+1,b,BODY),mk(b,b+1,PS),mk(b+1,text.length+1,BODY)];
  const p=text.indexOf('\r')+1;
  const paragraphStyleRange=[
    {from:0,to:p,paragraphStyle:{align:{_enum:'alignmentType',_value:'left'}}},
    {from:p,to:text.length+1,paragraphStyle:{align:{_enum:'alignmentType',_value:'left'}}}
  ];
  return {textKey:text,textStyleRange:runs,paragraphStyleRange};
}
const entries=[
  {char:'\uE004',latex:'x_i^2',codepoint:'E004'},
  {char:'\uE005',latex:'\\alpha+\\beta',codepoint:'E005'}
];
test('first/last are distinct run hypotheses and original remains unchanged',()=>{
  const exampleDescriptor=example();
  const before=JSON.stringify(exampleDescriptor);
  const a=chooseIdenticalBounds(exampleDescriptor.textStyleRange,'textStyle',exampleDescriptor.textKey.length,'first');
  const b=chooseIdenticalBounds(exampleDescriptor.textStyleRange,'textStyle',exampleDescriptor.textKey.length,'last');
  assert.equal(a.ranges.length,5);
  assert.equal(b.ranges.length,5);
  assert.equal(a.conflicts.length,1);
  assert.equal(a.conflicts[0].differentStyleKeys.includes('baselineShift'),true);
  assert.equal(a.ranges[1].textStyle.baselineShift,undefined);
  assert.equal(b.ranges[1].textStyle.baselineShift,3);
  assert.equal(JSON.stringify(exampleDescriptor),before);
});
test('both interpretations can pass PUA restoration preflight without writing',()=>{
  const d=example();
  const report=examineRestoreChoices(d,entries,PS);
  assert.equal(report.scope,'development/read-only');
  assert.equal(report.writesToPhotoshop,false);
  assert.equal(report.originalTopology.textStyleRange.issueCounts.overlap,1);
  assert.deepEqual(report.results.map(x=>x.status),['preflight-ok','preflight-ok']);
  assert.deepEqual(report.results.map(x=>x.mathCount),[2,2]);
  assert.equal(report.results[0].newlineCountBefore,1);
  assert.equal(report.results[0].newlineCountAfter,1);
  assert.equal(JSON.stringify(report).includes('日本語'),false);
});
test('different math font exposes difference between interpretations',()=>{
  const report=examineRestoreChoices(example('KozGoPr6N-Regular'),entries,PS);
  assert.equal(report.results[0].status,'preflight-ok');
  assert.equal(report.results[1].status,'blocked');
  assert.match(report.results[1].reason,/フォントが一致/);
});
test('partial overlaps cannot be swept away by experiment',()=>{
  const d=example();
  d.textStyleRange[2]={...d.textStyleRange[2],from:d.textStyleRange[2].from-1};
  const r=examineRestoreChoices(d,entries,PS);
  assert.deepEqual(r.results.map(x=>x.status),['blocked','blocked']);
  assert.match(r.results[0].reason,/重複または欠落/);
});
test('no math PUA or incorrect mapping blocks both hypotheses',()=>{
  const r=examineRestoreChoices(example(),[],PS);
  assert.deepEqual(r.results.map(x=>x.status),['blocked','blocked']);
  assert.match(r.results[0].reason,/未登録のPUA/);
});
