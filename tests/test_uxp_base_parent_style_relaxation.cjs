'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeExactDuplicateRuns,sameExceptBaseParentStyle}=
  require('../photoshop/uxp-panel/safe_range_normalization');
const {buildDescriptor,inlineParts}=require('../photoshop/uxp-panel/text_ranges');
const {restorePUAParts,buildRestoredDescriptor}=
  require('../photoshop/uxp-panel/restore_ranges');
const PS='InlineMathLab-Regular',BODY='BIZUDPGothic-Bold';
const bodyStyle=parent=>({
  fontPostScriptName:BODY,fontName:'BIZ UDPGothic',fontAvailable:true,
  size:{_unit:'pointsUnit',_value:16},
  baseParentStyle:{fontPostScriptName:parent,size:{_unit:'pointsUnit',_value:12}}
});
const run=(from,to,key,style)=>({from,to,_obj:key+'Range',[key]:style});
const entries=[{char:'\uE004',latex:'x_i^2',codepoint:'E004'}];

test('identical ranges differing only in baseParentStyle collapse; final style survives',()=>{
  const first=run(0,6,'textStyle',bodyStyle('KozGoPr6N-Regular'));
  const last=run(0,6,'textStyle',bodyStyle('OtherParent-Regular'));
  const original=[first,last];
  const originalJSON=JSON.stringify(original);
  assert.equal(sameExceptBaseParentStyle(first,last,'textStyle'),true);
  const result=normalizeExactDuplicateRuns(original,'textStyle',6);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].textStyle,last.textStyle);
  assert.equal(JSON.stringify(original),originalJSON);
});

test('repeated copies with different inherited styles do not multiply runs',()=>{
  const items=[run(0,5,'textStyle',bodyStyle('A')),
    run(0,5,'textStyle',bodyStyle('B')),
    run(0,5,'textStyle',bodyStyle('A')),
    run(5,10,'textStyle',bodyStyle('C')),
    run(5,10,'textStyle',bodyStyle('D'))];
  assert.deepEqual(normalizeExactDuplicateRuns(items,'textStyle',10).map(x=>x.textStyle.baseParentStyle.fontPostScriptName),['A','D']);
});

test('different explicit font, size, availability and baseline take final input run',()=>{
  const first=run(0,5,'textStyle',bodyStyle('A'));
  const incompatible=[
    {textStyle:{...first.textStyle,fontPostScriptName:PS}},
    {textStyle:{...first.textStyle,size:{_unit:'pointsUnit',_value:15}}},
    {textStyle:{...first.textStyle,fontAvailable:false}},
    {textStyle:{...first.textStyle,baselineShift:2}},
    {textStyle:{...first.textStyle,styleSheetHasParent:true}},
    {_obj:'anotherRunType'}
  ];
  for(const override of incompatible){
    const second={...first,...override};
    assert.equal(sameExceptBaseParentStyle(first,second,'textStyle'),false);
    const result=normalizeExactDuplicateRuns([first,second],'textStyle',5);
    assert.deepEqual(result[0].textStyle,second.textStyle);
  }
});

test('paragraphStyle conflicts remain strict even if named baseParentStyle differs',()=>{
  const a=run(0,8,'paragraphStyle',{align:'left',baseParentStyle:{align:'right'}});
  const b=run(0,8,'paragraphStyle',{align:'left',baseParentStyle:{align:'left'}});
  assert.equal(sameExceptBaseParentStyle(a,b,'paragraphStyle'),false);
  assert.throws(()=>normalizeExactDuplicateRuns([a,b],'paragraphStyle',8),/異なる書式/);
});

test('partial overlap resolves by last-write-wins but a real gap still blocks',()=>{
  const a=run(0,5,'textStyle',bodyStyle('A'));
  const overlap=run(4,10,'textStyle',bodyStyle('B'));
  const normalized=normalizeExactDuplicateRuns([a,overlap],'textStyle',10);
  assert.deepEqual(normalized.map(x=>[x.from,x.to,x.textStyle.baseParentStyle.fontPostScriptName]),[[0,4,'A'],[4,10,'B']]);
  assert.throws(()=>normalizeExactDuplicateRuns([a,run(6,10,'textStyle',bodyStyle('B'))],'textStyle',10),/書式がない/);
});

test('forward LaTeX conversion supports inherited-parent conflict with Japanese CR',()=>{
  const source='日本語 $x_i^2$。\r後続';
  const a=run(0,source.length+1,'textStyle',bodyStyle('KozGoPr6N-Regular'));
  const b=run(0,source.length+1,'textStyle',bodyStyle('OtherParent-Regular'));
  const original={textKey:source,textStyleRange:[a,b],
    paragraphStyleRange:[run(0,source.length+1,'paragraphStyle',{align:'left'})]};
  const frozen=JSON.stringify(original);
  const result=buildDescriptor(original,inlineParts(source,entries));
  assert.equal(result.textKey,'日本語 \uE004。\r後続');
  assert.equal(result.textStyleRange.at(-1).to,result.textKey.length+1);
  assert.equal(JSON.stringify(original),frozen);
});

test('reverse eight PUA with baseParentStyle conflict, preserving fourteen newlines',()=>{
  const paragraph='本文 \uE004 は数式です。';
  const source=Array.from({length:8},(_,i)=>paragraph+(i<7?'\r\r':'')).join('');
  assert.equal((source.match(/\r/g)||[]).length,14);
  const mark=source.indexOf('\uE004');
  const body0=run(0,mark,'textStyle',bodyStyle('KozGoPr6N-Regular'));
  const body1=run(0,mark,'textStyle',bodyStyle('DifferentParent-Regular'));
  const tr=[body0,body1];
  for(let i=mark;i<source.length;){
    const cp=source.indexOf('\uE004',i);
    if(cp<0){
      tr.push(run(i,source.length+1,'textStyle',bodyStyle('KozGoPr6N-Regular')));
      break;
    }
    if(cp>i)tr.push(run(i,cp,'textStyle',bodyStyle('KozGoPr6N-Regular')));
    tr.push(run(cp,cp+1,'textStyle',{fontPostScriptName:PS,fontAvailable:true,
      size:{_unit:'pointsUnit',_value:16}}));
    i=cp+1;
  }
  const original={textKey:source,textStyleRange:tr,
    paragraphStyleRange:[run(0,source.length+1,'paragraphStyle',{align:'left'})]};
  const snapshot=JSON.stringify(original);
  const restored=restorePUAParts(source,entries,original.textStyleRange,PS);
  assert.equal(restored.mathCount,8);
  assert.equal((restored.text.match(/\r/g)||[]).length,14);
  const output=buildRestoredDescriptor(original,restored);
  assert.equal(output.textKey,restored.text);
  assert.equal(output.textStyleRange.at(-1).to,restored.text.length+1);
  assert.equal(JSON.stringify(original),snapshot);
});

test('PUA with incorrect actual font remains rejected despite parent-style relaxation',()=>{
  const source='前 \uE004 後';
  const a=run(0,source.length+1,'textStyle',bodyStyle('ParentA'));
  const b=run(0,source.length+1,'textStyle',bodyStyle('ParentB'));
  assert.throws(()=>restorePUAParts(source,entries,[a,b],PS),/フォントが一致/);
});
