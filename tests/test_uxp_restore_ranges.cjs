'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {restorePUAParts, buildRestoredDescriptor} = require('../photoshop/uxp-panel/restore_ranges.js');
const PS = 'InlineMathLab-Regular', BODY = 'Body-Regular';
const entries = [
  {char:'\ue004', latex:'x_i^2', codepoint:'E004'},
  {char:'\ue005', latex:'\\alpha+\\beta', codepoint:'E005'}
];
const style = (ps, size=12) => ({fontPostScriptName:ps, fontName:ps,
  size:{_unit:'pointsUnit', _value:size}, fontStyleName:'Regular'});
const at = (ranges, pos, key) => ranges.find(r=>r.from<=pos && pos<r.to)[key];
function descriptor(source, fontRanges, paragraphBreaks=[], tail=1) {
  const textStyleRange = fontRanges.map(([from,to,ps,size])=>({
    from,to,textStyle:style(ps,size || 12)
  }));
  if (tail === 1) textStyleRange.at(-1).to++;
  const bounds=[0,...paragraphBreaks,source.length+tail];
  const paragraphStyleRange=bounds.slice(1).map((end,i)=>({
    from:bounds[i],to:end,paragraphStyle:{align:'para-'+i}
  }));
  return {textKey:source,textStyleRange,paragraphStyleRange,
          textShape:[{orientation:'horizontal'}]};
}

test('restores multiple/repeated PUA and changes in the surrounding text',()=>{
  const source='編集 \ue004 と \ue005、再び \ue004。';
  const a=source.indexOf('\ue004'), b=source.indexOf('\ue005'), c=source.lastIndexOf('\ue004');
  const before=descriptor(source,[[0,a,BODY],[a,a+1,PS],[a+1,b,BODY],
    [b,b+1,PS],[b+1,c,BODY],[c,c+1,PS],[c+1,source.length,BODY]]);
  const original=JSON.stringify(before);
  const restored=restorePUAParts(source,entries,before.textStyleRange,PS);
  assert.equal(restored.text,'編集 $x_i^2$ と $\\alpha+\\beta$、再び $x_i^2$。');
  assert.equal(restored.mathCount,3);
  const after=buildRestoredDescriptor(before,restored);
  assert.equal(after.textKey,restored.text);
  for(const seg of restored.segments.filter(s=>s.kind==='math')) {
    assert.equal(at(after.textStyleRange,seg.from,'textStyle').fontPostScriptName,BODY);
  }
  assert.equal(after.textStyleRange.at(-1).to,restored.text.length+1);
  assert.equal(after.paragraphStyleRange.at(-1).to,restored.text.length+1);
  assert.equal(after.textShape,before.textShape);
  assert.equal(JSON.stringify(before),original,'the source Photoshop descriptor must stay intact');
});

test('preserves existing body styling across CR paragraphs and unchanged terminal style',()=>{
  const source='A \ue004\rB \ue005';
  const a=source.indexOf('\ue004'), b=source.indexOf('\ue005');
  const boundary=source.indexOf('\r')+1;
  const before=descriptor(source,[[0,a,'BodyA-Regular',13],[a,a+1,PS,13],
    [a+1,b,'BodyB-Regular',15],[b,b+1,PS,15]], [boundary], 0);
  const restored=restorePUAParts(source,entries,before.textStyleRange,PS);
  const result=buildRestoredDescriptor(before,restored);
  assert.equal(result.textKey,'A $x_i^2$\rB $\\alpha+\\beta$');
  assert.equal(at(result.textStyleRange,restored.segments[1].from,'textStyle').fontPostScriptName,'BodyA-Regular');
  const lastMath=restored.segments.findLast(x=>x.kind==='math');
  assert.equal(at(result.textStyleRange,lastMath.from,'textStyle').fontPostScriptName,'BodyB-Regular');
  const newBoundary=result.textKey.indexOf('\r')+1;
  assert.equal(at(result.paragraphStyleRange,newBoundary-1,'paragraphStyle').align,'para-0');
  assert.equal(at(result.paragraphStyleRange,newBoundary,'paragraphStyle').align,'para-1');
  assert.equal(result.textStyleRange.at(-1).to,result.textKey.length);
});

test('preserves independent terminal text style',()=>{
  const source='文章\ue004';
  const before=descriptor(source,[[0,2,BODY],[2,3,PS]], [], 1);
  before.textStyleRange[1].to=3;
  before.textStyleRange.push({from:3,to:4,textStyle:style('Terminal-Regular')});
  const result=buildRestoredDescriptor(before,restorePUAParts(source,entries,before.textStyleRange,PS));
  assert.equal(at(result.textStyleRange,result.textKey.length,'textStyle').fontPostScriptName,'Terminal-Regular');
});

test('math-only paragraph requires explicitly supplied fallback body font',()=>{
  const source='\ue004\ue005';
  const before=descriptor(source,[[0,2,PS]]);
  const restored=restorePUAParts(source,entries,before.textStyleRange,PS);
  assert.throws(()=>buildRestoredDescriptor(before,restored),/本文用フォント/);
  const after=buildRestoredDescriptor(before,restored,{fallbackTextStyle:style(BODY)});
  assert.equal(after.textKey,'$x_i^2$$\\alpha+\\beta$');
  assert.equal(at(after.textStyleRange,0,'textStyle').fontPostScriptName,BODY);
});

test('fails closed on unknown code, wrong font per run, malformed map, no PUA',()=>{
  const before=descriptor('A\ue004',[[0,1,BODY],[1,2,'Wrong-Regular']]);
  assert.throws(()=>restorePUAParts(before.textKey,entries,before.textStyleRange,PS),/フォントが一致/);
  before.textStyleRange[1].textStyle=style(PS);
  assert.throws(()=>restorePUAParts('A\ue006',entries,before.textStyleRange,PS),/未登録/);
  assert.throws(()=>restorePUAParts('AB',entries,before.textStyleRange,PS),/復元対象/);
  assert.throws(()=>restorePUAParts('A\ue004',entries.concat(entries[0]),before.textStyleRange,PS),/重複/);
  assert.throws(()=>restorePUAParts('A\ue004',[{char:'\ue004',latex:'x',codepoint:'E005'}],before.textStyleRange,PS),/一致しません/);
  assert.throws(()=>restorePUAParts('A\ue004',entries,[{from:1,to:3,textStyle:style(PS)}],PS),/書式がない|不連続/);
  assert.throws(()=>restorePUAParts('A\ue004',[{char:'\ue004',latex:'x\r_i'}],before.textStyleRange,PS),/改行/);
  assert.throws(()=>restorePUAParts('😀\ue004',entries,[],PS),/サロゲート/);
});

test('rejects incompatible paragraph range before generating a descriptor',()=>{
  const source='A\ue004';
  const original=descriptor(source,[[0,1,BODY],[1,2,PS]]);
  original.paragraphStyleRange[0].to=source.length+3;
  const restored=restorePUAParts(source,entries,original.textStyleRange,PS);
  assert.throws(()=>buildRestoredDescriptor(original,restored),/文字範囲が不正|終端位置/);
});
