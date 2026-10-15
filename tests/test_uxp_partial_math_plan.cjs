'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {cases}=require('./fixtures/math_input_cases.json');
const {scanMathPlan}=require('../photoshop/uxp-panel/math_scan_plan');
const {buildPartialParts}=require('../photoshop/uxp-panel/partial_math_plan');
const {buildDescriptor,FONT_PS_NAME}=require('../photoshop/uxp-panel/text_ranges');
const {restorePUAParts}=require('../photoshop/uxp-panel/restore_ranges');
const EOLS=[['LF','\n'],['CRLF','\r\n'],['CR','\r']];
function mapping(report){
  return [...new Set(report.matches.map(x=>x.latex))].map((latex,i)=>({
    latex,char:String.fromCharCode(0xE000+i),codepoint:(0xE000+i).toString(16).toUpperCase()
  }));
}
function at(ranges,pos,key){
  const r=ranges.find(x=>x.from<=pos&&pos<x.to);
  assert.ok(r,'no '+key+' at '+pos);return r[key];
}
function descriptor(source,report){
  const points=[...new Set([0,source.length+1,...report.protected.flatMap(p=>[p.from,p.to])])]
    .sort((a,b)=>a-b);
  const textStyleRange=points.slice(1).map((to,i)=>{
    const from=points[i],code=report.protected.some(p=>p.from<=from&&from<p.to);
    return {_obj:'textStyleRange',from,to,textStyle:{
      _obj:'textStyle',fontPostScriptName:code?'Code-Regular':'Body-Regular',
      fontAvailable:true,size:{_unit:'pointsUnit',_value:12+i},
      tracking:i*7,baselineShift:{_unit:'pointsUnit',_value:i/10}
    }};
  });
  const ends=[];
  const breaks=/\r\n|\r|\n/g;let m;
  while((m=breaks.exec(source)))ends.push(m.index+m[0].length);
  ends.push(source.length+1);
  let cursor=0;
  const paragraphStyleRange=[...new Set(ends)].map((to,i)=>{
    const r={_obj:'paragraphStyleRange',from:cursor,to,
      paragraphStyle:{_obj:'paragraphStyle',align:['left','right','center'][i%3]}};
    cursor=to;return r;
  });
  return {_obj:'textLayer',textKey:source,textStyleRange,paragraphStyleRange};
}
for(const c of cases)for(const [name,eol]of EOLS){
  test(c.id+' / '+name+' / expected scan and preservation',()=>{
    const source=c.source.replace(/\n/g,()=>eol),report=scanMathPlan(source);
    assert.deepEqual(report.matches.map(x=>x.latex),c.expected.latex);
    assert.deepEqual(report.issues.map(x=>x.code),c.expected.issues);
    assert.equal(report.protected.length,c.expected.protectedCount);
    assert.equal(report.fatal,c.expected.fatal);
    assert.equal(report.complete,!report.fatal&&!report.issues.length);
    for(const match of report.matches){
      assert.equal(source.slice(match.from,match.to),match.raw);
      assert.ok(!report.protected.some(p=>match.from<p.to&&p.from<match.to));
      assert.ok(!report.issues.some(p=>match.from<p.to&&p.from<match.to));
    }
    if(report.fatal){
      assert.throws(()=>buildPartialParts(source,report,[]),/全体停止/);return;
    }
    const entries=mapping(report),saved=JSON.stringify(report);
    const original=source.length?descriptor(source,report):null;
    const snapshot=JSON.stringify(original);
    const converted=buildPartialParts(source,report,entries,
      {paragraphStyleRange:original?original.paragraphStyleRange:null});
    assert.equal(JSON.stringify(report),saved);
    assert.equal(converted.mathCount,c.expected.latex.length-(c.expectedHeldFormulas||0));
    assert.equal(converted.heldFormulaCount,c.expectedHeldFormulas||0);
    let sourceCursor=0,outputCursor=0;
    for(const seg of converted.segments){
      assert.equal(seg.sourceFrom,sourceCursor);
      assert.equal(seg.from,outputCursor);
      const value=converted.text.slice(seg.from,seg.to);
      if(seg.kind==='body')assert.equal(value,source.slice(seg.sourceFrom,seg.sourceTo));
      else assert.equal(value.length,1);
      sourceCursor=seg.sourceTo;outputCursor=seg.to;
    }
    assert.equal(sourceCursor,source.length);
    assert.equal(outputCursor,converted.text.length);
    if(!source.length)return;
    const projected=buildDescriptor(original,converted);
    assert.equal(JSON.stringify(original),snapshot);
    for(const seg of converted.segments){
      if(seg.kind==='math'){
        assert.equal(at(projected.textStyleRange,seg.from,'textStyle').fontPostScriptName,FONT_PS_NAME);
        continue;
      }
      for(let p=seg.sourceFrom;p<seg.sourceTo;p++){
        const q=seg.from+p-seg.sourceFrom;
        assert.deepEqual(at(projected.textStyleRange,q,'textStyle'),at(original.textStyleRange,p,'textStyle'));
        assert.deepEqual(at(projected.paragraphStyleRange,q,'paragraphStyle'),at(original.paragraphStyleRange,p,'paragraphStyle'));
      }
    }
    // Existing inverse can be exercised where the source had no literal PUA.
    // Code containing an actual PUA needs code protection in the inverse too;
    // this is deliberately a later integration task, not hidden by this test.
    if(converted.mathCount&&!/[\uE000-\uF8FF]/.test(source)){
      const restored=restorePUAParts(converted.text,entries,projected.textStyleRange,FONT_PS_NAME);
      const expected=converted.segments.map(seg=>seg.kind==='body'?
        source.slice(seg.sourceFrom,seg.sourceTo):
        '$'+report.matches.find(m=>m.from===seg.sourceFrom).latex+'$').join('');
      assert.equal(restored.text,expected);
      assert.equal(restored.mathCount,converted.mathCount);
    }
  });
}
test('unavailable glyph is held while other occurrences convert',()=>{
  const source='前 $x$ / $$bad$$ / $x$ / \\(y\\)';
  const scan=scanMathPlan(source);
  const ready=[{latex:'x',char:'\uE000',codepoint:'E000'},{latex:'y',char:'\uE001',codepoint:'E001'}];
  const result=buildPartialParts(source,scan,ready);
  assert.equal(result.text,'前 \uE000 / $$bad$$ / \uE000 / \uE001');
  assert.equal(result.mathCount,3);
  assert.equal(result.heldFormulaCount,1);
  assert.deepEqual(result.issues.map(x=>x.code),['unregistered-formula']);
});
test('invalid mapping still prevents an unsafe replacement plan',()=>{
  const source='$x$ / $y$',report=scanMathPlan(source);
  assert.throws(()=>buildPartialParts(source,report,[{latex:'x',char:'\uE000'},{latex:'y',char:'\uE000'}]),/対応表/);
  assert.throws(()=>buildPartialParts(source,report,[{latex:'x',char:'x'}]),/対応表/);
});
test('stale raw match and overlap with code are rejected',()=>{
  const report=scanMathPlan('$x$');
  assert.throws(()=>buildPartialParts('$y$',report,[{latex:'x',char:'\uE000'}]),/原文と不一致/);
  const tampered={...report,protected:[{from:0,to:3}]};
  assert.throws(()=>buildPartialParts('$x$',tampered,[{latex:'x',char:'\uE000'}]),/コード範囲/);
});
test('mixed physical line endings are retained outside a display formula',()=>{
  const source='前 $a$\r\n\rコード §$fake$§\n$$\rb\r\n$$終わり';
  const actual=source.replace(/\u00a7/g,()=>String.fromCharCode(96));
  const report=scanMathPlan(actual);
  assert.deepEqual(report.matches.map(x=>x.latex),['a','b']);
  const result=buildPartialParts(actual,report,mapping(report));
  assert.equal(result.text,'前 \uE000\r\n\rコード '+String.fromCharCode(96)+'$fake$'+String.fromCharCode(96)+'\n\uE001終わり');
});
test('adding ordinary body and closed source blocks preserves local formulas',()=>{
  const core='前 $x$ / \\[y\\]';
  const prefix='見出し\n'+String.fromCharCode(96).repeat(3)+'python\n"$notMath$"\n'+String.fromCharCode(96).repeat(3)+'\n';
  const suffix='\n~~~r\n"$notMath$"\n~~~\n説明';
  const baseline=scanMathPlan(core),whole=scanMathPlan(prefix+core+suffix);
  assert.deepEqual(whole.matches.map(x=>x.latex),baseline.matches.map(x=>x.latex));
  assert.deepEqual(whole.matches.map(x=>x.from),baseline.matches.map(x=>x.from+prefix.length));
});
test('long source with many paragraphs completes without crossing boundaries',()=>{
  const source=('本文の説明。'.repeat(50)+' $x$\n\n').repeat(160);
  const report=scanMathPlan(source);
  assert.equal(report.matches.length,160);
  assert.deepEqual(report.issues,[]);
  assert.ok(source.length>32767);
});

test('one paragraph-crossing formula is held while another formula converts',()=>{
  const source='複数行 $a+\nb$\n\n独立 $x$';
  const scan=scanMathPlan(source),original=descriptor(source,scan);
  const result=buildPartialParts(source,scan,mapping(scan),
    {paragraphStyleRange:original.paragraphStyleRange});
  assert.equal(result.mathCount,1);
  assert.equal(result.heldFormulaCount,1);
  assert.equal(result.text,'複数行 $a+\nb$\n\n独立 \uE001');
  assert.deepEqual(result.issues.map(x=>x.code),['paragraph-crossing']);
  assert.doesNotThrow(()=>buildDescriptor(original,result));
});
