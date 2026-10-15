'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyRestoredLayer,sameParagraphAlignment}=require('../photoshop/uxp-panel/restore_postflight.js');

function layer(text,font='Body-Regular',align='left'){
  return {
    textKey:text,
    textStyleRange:[{from:0,to:text.length+1,
      textStyle:{fontPostScriptName:font,fontAvailable:true}}],
    paragraphStyleRange:[{from:0,to:text.length+1,
      paragraphStyle:{align}}],
  };
}

test('accepts persisted restored text and body font',()=>{
  const restored={text:'文章 $x_i^2$ です',mathCount:1,
    segments:[{kind:'body',from:0,to:3},
              {kind:'math',from:3,to:10},
              {kind:'body',from:10,to:13}]};
  const intended=layer(restored.text);
  const actual=layer(restored.text);
  const original=JSON.stringify(actual);
  assert.deepEqual(verifyRestoredLayer(restored,intended,actual,'InlineMathLab-Regular'),
                   {verifiedMathCount:1});
  assert.equal(JSON.stringify(actual),original);
});

test('rejects silent font fallback even when text is correct',()=>{
  const restored={text:'$x_i^2$',mathCount:1,
    segments:[{kind:'math',from:0,to:7}]};
  const intended=layer(restored.text);
  const substituted=layer(restored.text,'InlineMathLab-Regular');
  assert.throws(()=>verifyRestoredLayer(restored,intended,substituted,'InlineMathLab-Regular'),
                /フォント/);
  const missing=layer(restored.text);
  missing.textStyleRange[0].textStyle.fontAvailable=false;
  assert.throws(()=>verifyRestoredLayer(restored,intended,missing,'InlineMathLab-Regular'),
                /フォント/);
});

test('rejects changed text, malformed ranges and changed paragraph alignment',()=>{
  const restored={text:'$x_i^2$',mathCount:1,
    segments:[{kind:'math',from:0,to:7}]};
  const intended=layer(restored.text);
  assert.throws(()=>verifyRestoredLayer(restored,intended,layer('different'),'InlineMathLab-Regular'),
                /本文/);
  const malformed=layer(restored.text);
  malformed.textStyleRange[0].from=1;
  assert.throws(()=>verifyRestoredLayer(restored,intended,malformed,'InlineMathLab-Regular'),
                /範囲/);
  assert.throws(()=>verifyRestoredLayer(restored,intended,layer(restored.text,'Body-Regular','right'),
                'InlineMathLab-Regular'),/段落配置/);
});

test('does not allow a mismatched restored math count',()=>{
  const restored={text:'$x_i^2$',mathCount:2,
    segments:[{kind:'math',from:0,to:7}]};
  const intended=layer(restored.text);
  assert.throws(()=>verifyRestoredLayer(restored,intended,layer(restored.text),'InlineMathLab-Regular'),
                /復元数/);
});

test('Photoshop enum alignment objects compare by their values, not reference',()=>{
  const leftA={_enum:'alignmentType',_value:'left'};
  const leftB={_enum:'alignmentType',_value:'left'};
  const right={_enum:'alignmentType',_value:'right'};
  assert.notEqual(leftA,leftB);
  assert.equal(sameParagraphAlignment(leftA,leftB),true);
  assert.equal(sameParagraphAlignment(leftA,right),false);
  assert.equal(sameParagraphAlignment('left',leftB),true);
  assert.equal(sameParagraphAlignment(leftB,'left'),true);
  assert.equal(sameParagraphAlignment('left',{_enum:'unrelatedType',_value:'left'}),false);

  const restored={text:'A$x_i^2$',mathCount:1,
    segments:[{kind:'body',from:0,to:1},{kind:'math',from:1,to:8}]};
  const intended=layer(restored.text,'Body-Regular',leftA);
  const actual=layer(restored.text,'Body-Regular',leftB);
  assert.deepEqual(verifyRestoredLayer(restored,intended,actual,'InlineMathLab-Regular'),
                   {verifiedMathCount:1});
  actual.paragraphStyleRange[0].paragraphStyle.align=right;
  assert.throws(()=>verifyRestoredLayer(restored,intended,actual,'InlineMathLab-Regular'),
                /expected=.*left.*actual=.*right/);
});
