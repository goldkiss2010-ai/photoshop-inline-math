'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanMath}=require('../photoshop/uxp-panel/math_syntax');
const {excludedDisplayMarkers,diagnosticSummary}=
  require('../photoshop/uxp-panel/math_scan_report');
const fence='\x60\x60\x60';
const equations='\r\r$$\r(1.02,0.01,0.00)\r$$\r'+
  'だったのか\r\r$$\r(2.8,-0.4,-0.2)\r$$\r';

test('closed Quarto Python fence does not hide following display formulas',()=>{
  const source=fence+'{python}\rax.set_title("RGB")\r'+fence+equations;
  const matches=scanMath(source);
  assert.deepEqual(matches.map(m=>m.latex),
    ['(1.02,0.01,0.00)','(2.8,-0.4,-0.2)']);
  const report=excludedDisplayMarkers(source,matches);
  assert.equal(report.markerCount,4);
  assert.equal(report.matchedCount,4);
  assert.deepEqual(report.skipped,[]);
});

test('unclosed code fence reports all four skipped display delimiters',()=>{
  const source=fence+'{python}\rax.set_title("RGB")'+equations;
  const matches=scanMath(source);
  const report=excludedDisplayMarkers(source,matches);
  assert.equal(matches.length,0);
  assert.equal(report.skipped.length,4);
  assert.ok(report.skipped.every(x=>x.reason.includes('コードブロックとして除外')));
  assert.match(diagnosticSummary(source,1,2,matches).excludedDetails,/本文末尾まで未閉鎖/);
});

test('mispaired $$ can be detected as another formula swallowing an inner marker',()=>{
  const source='$$\nfirst\n$$\n$$\nsecond\n$$';
  const matches=scanMath(source);
  const report=excludedDisplayMarkers(source,matches);
  assert.equal(matches.length,2);
  assert.equal(report.skipped.length,0);
});

test('a standalone display marker within fenced code is explicitly classified',()=>{
  const source=fence+'{python}\r$$\rnot_math\r$$\r'+fence+'\r$$\rx\r$$';
  const matches=scanMath(source);
  assert.deepEqual(matches.map(x=>x.latex),['x']);
  const report=excludedDisplayMarkers(source,matches);
  assert.equal(report.skipped.length,2);
  assert.match(report.skipped[0].reason,/コードブロックとして除外/);
});

test('inline $math$ and unrelated dollar signs are not flagged as missing display',()=>{
  const source='本文 $x$。価格は\\$20。\r$$\rE=mc^2\r$$';
  const matches=scanMath(source);
  const report=excludedDisplayMarkers(source,matches);
  assert.equal(report.markerCount,2);
  assert.equal(report.skipped.length,0);
});
