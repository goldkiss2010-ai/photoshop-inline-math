'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyAppliedMathFonts}=require('../photoshop/uxp-panel/postflight');
const {inlineParts,buildDescriptor,FONT_PS_NAME}=require('../photoshop/uxp-panel/text_ranges');

const source='本文 $x_i$ 中間 $f(x_i)$';
const entries=[{latex:'x_i',char:'\uE00B'}, {latex:'f(x_i)',char:'\uE00C'}];
const converted=inlineParts(source,entries);
const baseStyle={fontPostScriptName:'KozGoPr6N-Regular',fontName:'Kozuka Gothic',
  fontStyleName:'R',fontAvailable:false,size:{_unit:'pointsUnit',_value:16}};
const descriptor={textKey:source,
  textStyleRange:[{from:0,to:source.length+1,textStyle:baseStyle}],
  paragraphStyleRange:[{from:0,to:source.length+1,paragraphStyle:{_obj:'paragraphStyle'}}]};
function applied(){
  return buildDescriptor(descriptor,converted);
}
test('each converted PUA run declares available desired font, not copied unavailable body font',()=>{
  const d=applied();
  for(const math of converted.segments.filter(s=>s.kind==='math')){
    const style=d.textStyleRange.find(x=>x.from<=math.from&&math.from<x.to).textStyle;
    assert.equal(style.fontAvailable,true);
    assert.equal(style.fontPostScriptName,FONT_PS_NAME);
  }
  assert.equal(descriptor.textStyleRange[0].textStyle.fontAvailable,false);
});
test('postflight confirms only math glyphs, independent of body font',()=>{
  const d=applied();
  assert.equal(verifyAppliedMathFonts(converted,d,FONT_PS_NAME).verifiedMathCount,2);
  assert.equal(d.textStyleRange[0].textStyle.fontPostScriptName,'KozGoPr6N-Regular');
});
test('silent font substitution rejects incorrect math, never trusts Windows SHA alone',()=>{
  const d=applied();
  const math=converted.segments.find(s=>s.kind==='math');
  const r=d.textStyleRange.find(x=>x.from<=math.from&&math.from<x.to);
  r.textStyle.fontPostScriptName='KozGoPr6N-Regular';
  assert.throws(()=>verifyAppliedMathFonts(converted,d,FONT_PS_NAME),/Photoshopが数式 U\+E00B .*割り当てました/);
});
test('false fontAvailable fails even when name matches',()=>{
  const d=applied();
  const math=converted.segments.find(s=>s.kind==='math');
  d.textStyleRange.find(x=>x.from<=math.from&&math.from<x.to).textStyle.fontAvailable=false;
  assert.throws(()=>verifyAppliedMathFonts(converted,d,FONT_PS_NAME),/元レイヤーは保持します/);
});
test('postflight fails on unsupported text replacement and missing style',()=>{
  const d=applied();
  assert.throws(()=>verifyAppliedMathFonts(converted,{...d,textKey:'失敗'},FONT_PS_NAME),/文字列/);
  assert.throws(()=>verifyAppliedMathFonts(converted,{...d,textStyleRange:[]},FONT_PS_NAME),/文字スタイル/);
});
test('UXP performs readback before hiding original text layer',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../photoshop/uxp-panel/panel.js'),'utf8');
  const fn=s.slice(s.indexOf('async function applyPrepared()'),s.indexOf('async function convert()'));
  assert.ok(fn.indexOf('verifyAppliedMathFonts(')>0);
  assert.ok(fn.indexOf('verifyAppliedMathFonts(')<fn.indexOf('snap.layer.visible=false;'));
  assert.ok(fn.includes('if(duplicate)try{await duplicate.delete();}'));
});
