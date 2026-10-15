'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inlineParts, buildDescriptor, FONT_PS_NAME } =
  require('../photoshop/uxp-panel/text_ranges.js');

const CP_X = '\ue004', CP_A = '\ue005';
const map = [{ latex: 'x_i^2', char: CP_X },
             { latex: '\\alpha+\\beta', char: CP_A }];
const sty = (font,size) => ({
  _obj:'textStyle', fontPostScriptName:font, fontName:font,
  fontStyleName:'Regular', size:{_unit:'pointsUnit',_value:size}
});
const paragraph = id => ({_obj:'paragraphStyle',align:id});
const at = (ranges,pos,styleKey) => ranges.find(r => r.from<=pos && pos<r.to)[styleKey];
function descriptor(source, charBreaks, paraBreaks, tail=1) {
  const charBounds=[0,...charBreaks,source.length+tail],paraBounds=[0,...paraBreaks,source.length+tail];
  const textStyleRange=charBounds.slice(1).map((x,i)=>({
    _obj:'textStyleRange',from:charBounds[i],to:x,textStyle:sty('Font-'+i, 18+i*5)
  }));
  const paragraphStyleRange=paraBounds.slice(1).map((x,i)=>({
    _obj:'paragraphStyleRange',from:paraBounds[i],to:x,paragraphStyle:paragraph('para-'+i)
  }));
  return { _obj:'textLayer',textKey:source,textStyleRange,paragraphStyleRange,
    textShape:[{_obj:'textShape',orientation:'horizontal'}] };
}

test('single style compatibility with Photoshop terminal index',()=>{
  const source='画素値 $x_i^2$ を比較';
  const before=descriptor(source,[],[]);
  const p=inlineParts(source,map);
  const result=buildDescriptor(before,p,undefined);
  assert.equal(result.textKey,'画素値 '+CP_X+' を比較');
  assert.equal(result.textStyleRange.at(-1).to,p.text.length+1);
  assert.equal(result.paragraphStyleRange.at(-1).to,p.text.length+1);
  assert.equal(at(result.textStyleRange,p.text.indexOf(CP_X),'textStyle').fontPostScriptName,FONT_PS_NAME);
  assert.equal(result.textShape,before.textShape);
  assert.equal(before.textKey,source);
});

test('mixed body character styles are preserved across shortened math ranges',()=>{
  const source='ABC $x_i^2$ DEF $\\alpha+\\beta$ 後';
  const startOne=source.indexOf('$x_i^2$');
  const startTwo=source.indexOf('$\\alpha+\\beta$');
  const before=descriptor(source,[startOne+2,startOne+5,startTwo,startTwo+3],[]);
  const snapshot=JSON.stringify(before);
  const p=inlineParts(source,map);
  const result=buildDescriptor(before,p);
  assert.equal(result.textKey,'ABC '+CP_X+' DEF '+CP_A+' 後');
  for(const seg of p.segments) {
    if(seg.kind==='body') {
      for(let i=0;i<seg.to-seg.from;i++) {
        const old=at(before.textStyleRange,seg.sourceFrom+i,'textStyle');
        const now=at(result.textStyleRange,seg.from+i,'textStyle');
        assert.equal(now.fontPostScriptName,old.fontPostScriptName);
        assert.deepEqual(now.size,old.size);
      }
    } else {
      const old=at(before.textStyleRange,seg.styleAnchor,'textStyle');
      const now=at(result.textStyleRange,seg.from,'textStyle');
      assert.equal(now.size._value,old.size._value);
      assert.equal(now.fontPostScriptName,FONT_PS_NAME);
      assert.equal(now.syntheticBold,false);
      assert.equal(now.syntheticItalic,false);
    }
  }
  assert.equal(result.textStyleRange.at(-1).to,result.textKey.length+1);
  assert.equal(JSON.stringify(before),snapshot,'input batchPlay descriptor should stay untouched');
});

test('multiple paragraph styles and trailing marker remain aligned',()=>{
  const source='前 $x_i^2$\r後 $\\alpha+\\beta$';
  const boundary=source.indexOf('\r')+1;
  const before=descriptor(source,[1,boundary], [boundary]);
  const p=inlineParts(source,map);
  const result=buildDescriptor(before,p);
  assert.equal(result.textKey,'前 '+CP_X+'\r後 '+CP_A);
  const newBoundary=result.textKey.indexOf('\r')+1;
  assert.equal(at(result.paragraphStyleRange,newBoundary-1,'paragraphStyle').align,'para-0');
  assert.equal(at(result.paragraphStyleRange,newBoundary,'paragraphStyle').align,'para-1');
  assert.equal(result.paragraphStyleRange.at(-1).to,result.textKey.length+1);
});

test('terminal character style is preserved even if it differs from preceding style',()=>{
  const source='文字 $x_i^2$';
  const before=descriptor(source,[source.length],[],1);
  const result=buildDescriptor(before,inlineParts(source,map));
  assert.equal(at(result.textStyleRange,result.textKey.length,'textStyle').fontPostScriptName,'Font-1');
  assert.equal(at(result.textStyleRange,result.textKey.length-1,'textStyle').fontPostScriptName,FONT_PS_NAME);
});

test('supports style ranges ending exactly at text length (no terminal marker)',()=>{
  const source='式 $x_i^2$ です';
  const before=descriptor(source,[2],[],0);
  const result=buildDescriptor(before,inlineParts(source,map));
  assert.equal(result.textStyleRange.at(-1).to,result.textKey.length);
  assert.equal(result.paragraphStyleRange.at(-1).to,result.textKey.length);
});

test('rejects paragraphs split inside one equation and malformed style ranges',()=>{
  const source='式 $x_i^2$ です';
  const start=source.indexOf('$x_i^2$');
  const paragraphBoundary=start+4;
  const before=descriptor(source,[],[paragraphBoundary]);
  assert.throws(()=>buildDescriptor(before,inlineParts(source,map)),/複数の段落スタイル/);
  const invalid=descriptor(source,[],[]);
  invalid.textStyleRange[0].to = source.length-2;
  assert.throws(()=>buildDescriptor(invalid,inlineParts(source,map)),/終端位置/);
});

test('rejects unregistered formula and surrogate input, accepts display math',()=>{
  assert.throws(()=>inlineParts('$not_here$',map),/登録簿にない/);
  assert.equal(inlineParts('$x_i^2$',map).text,CP_X);
  assert.throws(()=>inlineParts('絵文字😀 $x_i^2$',map),/サロゲート/);
});
