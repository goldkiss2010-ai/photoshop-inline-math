'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {describeTextMismatch}=require('../photoshop/uxp-panel/text_readback_diagnostic');
const {verifyAppliedMathFonts}=require('../photoshop/uxp-panel/postflight');

test('readback unchanged original reports missing PUA and first changed position',()=>{
  const expected='本文 \uE000 と式 \uE001',actual='本文 $x$ と式 $y$';
  const msg=describeTextMismatch(expected,actual);
  assert.match(msg,/要求文字数=9、読み戻し文字数=13/);
  assert.match(msg,/初めて異なる位置=3/);
  assert.match(msg,/要求 U\+E000、実際 U\+0024/);
  assert.match(msg,/PUA文字数=要求2／実際0/);
});

test('missing suffix and long Photoshop text explain suspected 32767 boundary without silent changes',()=>{
  const expected='a'.repeat(36365);
  const actual=expected.slice(0,32767);
  const msg=describeTextMismatch(expected,actual);
  assert.match(msg,/要求文字数=36365、読み戻し文字数=32767/);
  assert.match(msg,/初めて異なる位置=32767/);
  assert.match(msg,/実際 \(末尾\)/);
  assert.match(msg,/32,767文字を超える/);
});

test('Photoshop smart quotes are called out as text mutation, never accepted silently',()=>{
  const msg=describeTextMismatch('記述 "RGB" です','記述 “RGB” です');
  assert.match(msg,/要求 U\+0022、実際 U\+201C/);
  assert.match(msg,/スマート引用符を使用/);
  assert.match(msg,/環境設定 → テキスト/);
  const apos=describeTextMismatch("it's", "it’s");
  assert.match(apos,/要求 U\+0027、実際 U\+2019/);
  assert.match(apos,/スマート引用符を使用/);
  const unrelated=describeTextMismatch('abc','abd');
  assert.doesNotMatch(unrelated,/スマート引用符を使用/);
});
test('readback with newline changes reports differences in CR and LF',()=>{
  const msg=describeTextMismatch('A\nB','A\rB');
  assert.match(msg,/初めて異なる位置=1/);
  assert.match(msg,/改行数\(CR\/LF\)=要求0\/1／実際1\/0/);
  assert.match(msg,/改行表現だけが異なります/);
});

test('postflight keeps a safe failure but adds measurable readback evidence',()=>{
  const converted={text:'前 \uE000 後',mathCount:1,segments:[{kind:'math',from:2,to:3}]};
  assert.throws(
    ()=>verifyAppliedMathFonts(converted,{textKey:'前 $x$ 後'},'PaperMath-Regular'),
    /要求文字数=5、読み戻し文字数=7/
  );
});
