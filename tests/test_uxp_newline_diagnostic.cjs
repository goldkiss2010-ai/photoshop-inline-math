'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {diagnose,newlineDiagnostic}=
  require('../photoshop/uxp-panel/style_diagnostic');

test('count Photoshop hard return, LF and soft line break distinctly',()=>{
  const source='日本語A\r日本語B\n日本語C\v日本語D\r\n日本語E\u2028続行';
  const desc={textKey:source,
    textStyleRange:[{from:0,to:source.length,textStyle:{}}],
    paragraphStyleRange:[
      {from:0,to:5,paragraphStyle:{align:{_enum:'alignmentType',_value:'alignLeft'},
         kinsoku:'japaneseStrict',mojikumi:'mojikumiSet3'}},
      {from:5,to:source.length,paragraphStyle:{align:'alignRight'}}
    ]};
  const report=diagnose(desc);
  assert.equal(report.newlineDiagnostic.kinds.CR,1);
  assert.equal(report.newlineDiagnostic.kinds.LF,1);
  assert.equal(report.newlineDiagnostic.kinds.VT,1);
  assert.equal(report.newlineDiagnostic.kinds.CRLF,1);
  assert.equal(report.newlineDiagnostic.kinds.LS,1);
  assert.equal(report.newlineDiagnostic.breakCount,5);
  assert.equal(report.newlineDiagnostic.paragraphRanges[0].style.kinsoku,'japaneseStrict');
  assert.equal(report.newlineDiagnostic.breaks[0].kind,'CR');
});

test('newline probe does not expose original Japanese content',()=>{
  const text='非公開の情報\r顧客名\u2028後';
  const report=newlineDiagnostic(text,[{from:0,to:text.length,
    paragraphStyle:{align:'alignLeft'}}]);
  const json=JSON.stringify(report);
  assert.equal(json.includes('非公開'),false);
  assert.equal(json.includes('顧客名'),false);
  assert.equal(json.includes('後'),false);
  assert.equal(report.breakCount,2);
});

test('newline probe safely handles missing paragraph ranges and truncation',()=>{
  const report=newlineDiagnostic('a\rb\nc\rd',null,{limit:1});
  assert.equal(report.breakCount,3);
  assert.equal(report.truncated,true);
  assert.equal(report.paragraphRanges,null);
  assert.equal(report.breaks.length,1);
});
