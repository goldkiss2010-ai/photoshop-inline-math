'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeExactDuplicateRuns}=require('../photoshop/uxp-panel/safe_range_normalization');
const {inlineParts,buildDescriptor}=require('../photoshop/uxp-panel/text_ranges');
const {restorePUAParts,buildRestoredDescriptor}=require('../photoshop/uxp-panel/restore_ranges');
const PS='InlineMathLab-Regular',BODY='BIZUDPGothic-Bold';
const entry=[{latex:'x',char:'\uE000',codepoint:'E000'}];
const textStyle=(ps)=>({fontPostScriptName:ps,fontName:ps,
  fontStyleName:'Regular',fontAvailable:true,
  size:{_unit:'pointsUnit',_value:16}});
const r=(from,to,key,style)=>({from,to,_obj:key+'Range',[key]:style});
test('exact duplicate ranges are eliminated without mutating the source array',()=>{
  const a=r(0,3,'textStyle',textStyle(BODY));
  const b=r(3,7,'textStyle',textStyle(BODY));
  const snapshot=[a,b,{to:7,from:3,_obj:'textStyleRange',
    textStyle:{size:{_value:16,_unit:'pointsUnit'},fontAvailable:true,
    fontStyleName:'Regular',fontName:BODY,fontPostScriptName:BODY}}];
  const before=JSON.stringify(snapshot);
  const fixed=normalizeExactDuplicateRuns(snapshot,'textStyle',7);
  assert.equal(fixed.length,2);
  assert.equal(fixed[1].from,b.from);
  assert.equal(fixed[1].to,b.to);
  assert.equal(fixed[1].textStyle.fontPostScriptName,b.textStyle.fontPostScriptName);
  assert.equal(JSON.stringify(snapshot),before);
});
test('same span with a different style keeps last declared text style',()=>{
  const a=r(0,5,'textStyle',textStyle(BODY));
  const b=r(0,5,'textStyle',textStyle(PS));
  assert.deepEqual(normalizeExactDuplicateRuns([a,b],'textStyle',5)[0].textStyle,textStyle(PS));
});
test('partial style overlap is resolved but actual text gaps still fail',()=>{
  const a=r(0,5,'textStyle',textStyle(BODY));
  const overlap=normalizeExactDuplicateRuns([a,r(3,7,'textStyle',textStyle(PS))], 'textStyle',7);
  assert.deepEqual(overlap.map(x=>[x.from,x.to,x.textStyle.fontPostScriptName]),[[0,3,BODY],[3,7,PS]]);
  assert.throws(()=>normalizeExactDuplicateRuns([a,r(6,8,'textStyle',textStyle(BODY))],
      'textStyle',8),/書式がない/);
});
test('forward conversion preserves Japanese paragraph styles after duplicate runs',()=>{
  const src='日本語 $x$。\r二行目 $x$ です';
  const breakAt=src.indexOf('\r')+1;
  const one=r(0,breakAt,'paragraphStyle',{align:'left'});
  const two=r(breakAt,src.length+1,'paragraphStyle',{align:'right'});
  const body=r(0,src.length+1,'textStyle',textStyle(BODY));
  const desc={textKey:src,textStyleRange:[body,{...body}],
    paragraphStyleRange:[one,{...one},two]};
  const raw=JSON.stringify(desc);
  const out=buildDescriptor(desc,inlineParts(src,entry));
  assert.equal(out.textKey,'日本語 \uE000。\r二行目 \uE000 です');
  assert.equal(out.textStyleRange.at(-1).to,out.textKey.length+1);
  assert.equal(out.paragraphStyleRange.at(-1).to,out.textKey.length+1);
  assert.equal(JSON.stringify(desc),raw);
});
test('reverse conversion tolerates duplicate identical body and paragraph runs',()=>{
  const src='本 \uE000 です。\rさらに \uE000 です';
  const first=src.indexOf('\uE000'),second=src.lastIndexOf('\uE000');
  const bounds=[[0,first,BODY],[first,first+1,PS],
    [first+1,second,BODY],[second,second+1,PS],[second+1,src.length+1,BODY]];
  const textRuns=bounds.map(([from,to,font])=>r(from,to,'textStyle',textStyle(font)));
  textRuns.splice(3,0,{...textRuns[2]});
  const para=[r(0,src.indexOf('\r')+1,'paragraphStyle',{align:'left'}),
    r(src.indexOf('\r')+1,src.length+1,'paragraphStyle',{align:'right'})];
  para.push({...para[1]});
  const desc={textKey:src,textStyleRange:textRuns,paragraphStyleRange:para};
  const before=JSON.stringify(desc);
  const out=restorePUAParts(src,entry,desc.textStyleRange,PS);
  assert.equal(out.mathCount,2);
  assert.equal(out.text,'本 $x$ です。\rさらに $x$ です');
  const projected=buildRestoredDescriptor(desc,out);
  assert.equal(projected.textKey,out.text);
  assert.equal(projected.textStyleRange.at(-1).to,out.text.length+1);
  assert.equal(projected.paragraphStyleRange.at(-1).to,out.text.length+1);
  assert.equal(JSON.stringify(desc),before);
});
test('untrusted PUA with different font stays blocked even after duplicate removal',()=>{
  const src='前 \uE000 後';
  const ranges=[r(0,src.length,'textStyle',textStyle('KozGoPr6N-Regular'))];
  ranges.push({...ranges[0]});
  assert.throws(()=>restorePUAParts(src,entry,ranges,PS),/フォントが一致/);
});


test('replicates the two overlap offsets from the observed 110-character report',()=>{
  const chars=Array(110).fill('文');
  chars[21]='\uE000';chars[32]='\uE001';
  chars[62]='\uE002';chars[86]='\uE002';
  chars[23]='\r';chars[64]='\r';
  const src=chars.join('');
  const ranges=[
    [0,21,BODY],[21,22,PS],[22,32,BODY],[22,32,BODY],
    [32,33,PS],[33,62,BODY],[62,63,PS],[63,86,BODY],
    [63,86,BODY],[86,87,PS],[87,111,BODY]
  ].map(([from,to,font])=>r(from,to,'textStyle',textStyle(font)));
  const original=JSON.stringify(ranges);
  const repaired=normalizeExactDuplicateRuns(ranges,'textStyle',110);
  assert.equal(repaired.length,9);
  assert.equal(repaired[2].from,22);
  assert.equal(repaired[6].from,63);
  const restored=restorePUAParts(src,[
    ...entry,
    {latex:'y',char:'\uE001',codepoint:'E001'},
    {latex:'z',char:'\uE002',codepoint:'E002'}
  ],ranges,PS);
  assert.equal(restored.mathCount,4);
  assert.equal((restored.text.match(/\r/g)||[]).length,2);
  const paragraphRanges=[
    r(0,24,'paragraphStyle',{align:'left'}),
    r(24,65,'paragraphStyle',{align:'left'}),
    r(65,111,'paragraphStyle',{align:'left'})
  ];
  const projected=buildRestoredDescriptor({textKey:src,textStyleRange:ranges,
    paragraphStyleRange:paragraphRanges},restored);
  assert.equal(projected.textKey,restored.text);
  assert.equal(JSON.stringify(ranges),original);
});
