'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fingerprint,diagnosticSummary}=require('../photoshop/uxp-panel/math_scan_report');
const {scanMath}=require('../photoshop/uxp-panel/math_syntax');
test('same source yields identical count, fingerprint and detected offsets',()=>{
  const src='説明 $x^2$\r$$y$$ と \\(z\\)';
  const a=diagnosticSummary(src,2,19,scanMath(src));
  const b=diagnosticSummary(src,2,19,scanMath(src));
  assert.deepEqual(a,b);
  assert.equal(a.unique,3);
  assert.match(a.label,/文書 2 \/ レイヤー 19/);
  assert.match(a.label,/簡易ID [0-9A-F]{8}/);
  assert.match(a.details,/dollars-display/);
});
test('fingerprint changes on a changed source even if math count stays same',()=>{
  const before='本文 $x$';
  const after='前文 $x$';
  assert.equal(scanMath(before).length,scanMath(after).length);
  assert.notEqual(fingerprint(before),fingerprint(after));
});
test('fenced Python and R code is not counted as math',()=>{
  const src='本文 $x$'+'\r'+
    '\x60\x60\x60{python}\rprint("$nope$")\r\x60\x60\x60\r'+
    '式 $$z$$';
  const parsed=scanMath(src);
  assert.deepEqual(parsed.map(x=>x.latex),['x','z']);
  const r=diagnosticSummary(src,1,100,parsed);
  assert.equal(r.details.includes('nope'),false);
});
