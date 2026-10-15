'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeTextStyleRuns,normalizeExactDuplicateRuns}=
  require('../photoshop/uxp-panel/safe_range_normalization');
const {restorePUAParts,buildRestoredDescriptor}=
  require('../photoshop/uxp-panel/restore_ranges');
const {verifyRestoredLayer}=
  require('../photoshop/uxp-panel/restore_postflight');
const {verifyAppliedMathFonts}=
  require('../photoshop/uxp-panel/postflight');
const {buildDescriptor,inlineParts}=require('../photoshop/uxp-panel/text_ranges');
const BODY='BIZUDPGothic-Bold',MATH='InlineMathLab-Regular';
const sr=(from,to,font,extra={})=>({from,to,textStyle:{
  fontPostScriptName:font,fontAvailable:true,
  size:{_unit:'pointsUnit',_value:16},...extra}});
const pr=(from,to)=>({from,to,paragraphStyle:{align:'left'}});
const at=(ranges,pos)=>ranges.find(x=>x.from<=pos&&pos<x.to).textStyle.fontPostScriptName;
const mapping=[{char:'\ue004',latex:'x',codepoint:'E004'}];

test('last run wins even with partially overlapping font changes',()=>{
 const ranges=[sr(0,7,'A'),sr(3,11,'B'),sr(6,9,'C')];
 const before=JSON.stringify(ranges);
 const result=normalizeTextStyleRuns(ranges,11);
 assert.deepEqual(result.map(x=>[x.from,x.to,x.textStyle.fontPostScriptName]),
   [[0,3,'A'],[3,6,'B'],[6,9,'C'],[9,11,'B']]);
 assert.equal(JSON.stringify(ranges),before);
});

test('repeated same-run edits use newest style and discard zero width runs',()=>{
 const source=[sr(0,7,'A'),sr(0,7,'B'),{from:4,to:4},sr(0,7,'C')];
 const output=normalizeTextStyleRuns(source,7);
 assert.equal(output.length,1);
 assert.equal(at(output,5),'C');
});

test('terminal style N+1 survives and empty insertion point is ignored',()=>{
 const source=[sr(0,4,'A'),sr(4,5,'Terminal'),{from:5,to:5}];
 const out=normalizeTextStyleRuns(source,4);
 assert.deepEqual(out.map(x=>[x.from,x.to]),[[0,4],[4,5]]);
});

test('uncovered text and runs beyond N+1 remain rejected',()=>{
 assert.throws(()=>normalizeTextStyleRuns([sr(0,3,'A'),sr(4,7,'B')],7),/書式がない/);
 assert.throws(()=>normalizeTextStyleRuns([sr(0,8,'A')],4),/不正/);
});

test('paragraph conflict remains an error',()=>{
 assert.throws(()=>normalizeExactDuplicateRuns([
   {from:0,to:7,paragraphStyle:{align:'left'}},
   {from:0,to:7,paragraphStyle:{align:'right'}}
 ],'paragraphStyle',7),/異なる書式/);
});

test('forward transformation works across repeated body edits while preserving original',()=>{
 const source='日本語 $x$ と $x$。\r後続です';
 const math=source.indexOf('$x$');
 const ranges=[
   sr(0,source.length+1,BODY),
   sr(0,source.length+1,'KozGoPr6N-Regular'),
   sr(math,math+3,BODY),
   sr(math,math+3,'YuGothic-Regular'),
   sr(math,math+3,BODY)
 ];
 const raw=JSON.stringify(ranges);
 const desc={textKey:source,textStyleRange:ranges,
   paragraphStyleRange:[pr(0,source.length+1)]};
 const conv=inlineParts(source,[{latex:'x',char:'\ue004'}]);
 const out=buildDescriptor(desc,conv);
 assert.equal(out.textKey,'日本語 \ue004 と \ue004。\r後続です');
 assert.equal(out.textStyleRange.at(-1).to,out.textKey.length+1);
 assert.equal(out.paragraphStyleRange.at(-1).to,out.textKey.length+1);
 assert.equal(JSON.stringify(ranges),raw);
});

test('restore uses most recent active style for PUA, then verifies normalized readback',()=>{
 const source='日本語 \ue004 です\r次の段落';
 const idx=source.indexOf('\ue004');
 const sourceRuns=[sr(0,source.length+1,BODY),
   sr(idx,idx+1,'KozGoPr6N-Regular'),
   sr(idx,idx+1,MATH)];
 const original={textKey:source,textStyleRange:sourceRuns,
   paragraphStyleRange:[pr(0,source.length+1)]};
 const originalJSON=JSON.stringify(original);
 const restored=restorePUAParts(source,mapping,sourceRuns,MATH);
 assert.equal(restored.mathCount,1);
 const expected=buildRestoredDescriptor(original,restored);
 const observed={...expected,
   textStyleRange:[
     ...expected.textStyleRange,
     {from:0,to:expected.textKey.length+1,
       textStyle:{fontPostScriptName:'KozGoPr6N-Regular',fontAvailable:true}},
     ...expected.textStyleRange
   ]};
 // Later runs match intended styles at every character position.
 assert.deepEqual(verifyRestoredLayer(restored,expected,observed,MATH),
   {verifiedMathCount:1});
 assert.equal(JSON.stringify(original),originalJSON);
});

test('a PUA without selected project math font remains blocked',()=>{
 const source='A\ue004B';
 const ranges=[sr(0,source.length,'KozGoPr6N-Regular')];
 assert.throws(()=>restorePUAParts(source,mapping,ranges,MATH),/フォントが一致/);
});

test('conversion readback accepts duplicated math run if last resolved font is correct',()=>{
 const converted={text:'文\ue004字',mathCount:1,segments:[
   {kind:'body',from:0,to:1},{kind:'math',from:1,to:2},
   {kind:'body',from:2,to:3}]};
 const actual={textKey:converted.text,textStyleRange:[
   sr(0,4,BODY),
   sr(1,2,MATH),
   sr(0,4,BODY),
   sr(1,2,MATH)
 ]};
 assert.deepEqual(verifyAppliedMathFonts(converted,actual,MATH),
   {verifiedMathCount:1});
 actual.textStyleRange.push(sr(1,2,'Wrong-Regular'));
 assert.throws(()=>verifyAppliedMathFonts(converted,actual,MATH),/割り当てました/);
});

test('explicit user restore recovers a registered glyph after a font edit',()=>{
 const source='本文 \ue004 です';
 const ranges=[sr(0,source.length,'KozGoPr6N-Regular')];
 const result=restorePUAParts(source,mapping,ranges,MATH,{allowFontMismatch:true});
 assert.equal(result.text,'本文 $x$ です');
 assert.equal(result.mathCount,1);
 assert.equal(result.fontMismatchCount,1);
 const original={textKey:source,textStyleRange:ranges,
   paragraphStyleRange:[pr(0,source.length)]};
 const expanded=buildRestoredDescriptor(original,result);
 assert.equal(expanded.textKey,result.text);
});

test('lenient font handling never infers an unregistered PUA identity',()=>{
 const source='本文 \ue005 です';
 const ranges=[sr(0,source.length,'KozGoPr6N-Regular')];
 assert.throws(()=>restorePUAParts(source,mapping,ranges,MATH,
   {allowFontMismatch:true}),/未登録のPUA/);
});

test('font edit opt-in still rejects style gaps and unreadable style geometry',()=>{
 const source='本文 \ue004 です';
 const ranges=[sr(0,2,'KozGoPr6N-Regular'),sr(3,source.length,'Other')];
 assert.throws(()=>restorePUAParts(source,mapping,ranges,MATH,
   {allowFontMismatch:true}),/書式がない/);
});
